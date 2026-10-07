# test: infer attack hit / miss from whether damage was rolled after it; compares with logged AC and the AC slider
# Usage Syntax: python3 hit_inference_test.py [--slider-ac 14] [--out-dir .]
#--------------------------------------------------------------------------------------------------------------
#setup
#   SOURCES, GAP_MS, NOT_DAMAGE_DICE
#roll20
#   template_events, attack_groups, attacks_from_groups
#foundry
#   foundry_attacks
#scoring
#   literal_rule_roll20, slider_hit, summarize
#load
#   write_load_sql, main
#--------------------------------------------------------------------------------------------------------------
import argparse #command line flags
import json #staging dice column, foundry export
import os #output paths
import re #formula / name cleanup
import sys #parser import path

import pandas as pd #attack tables, crosstabs

for _p in ("/mnt/project-files/parsers", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "Ingest Parsers")):
    sys.path.insert(0, _p) #repo copy wins (inserted last)
import roll20_parser as r20 #reuse msgdata decode + template field helpers

#--------------------------------------------------------------------------------------------------------------
#setup
#--------------------------------------------------------------------------------------------------------------
SOURCES = {
    "Lazlo": {"kind": "roll20", "html": "/mnt/project-files/samples/roll20/outoftheabyss_rolllog.html",
              "staging": "/mnt/project-files/imports/outoftheabyss_staging.csv"},
    "Vasha": {"kind": "roll20", "html": "/mnt/project-files/samples/roll20/curseofstrahd_rolllog.html",
              "staging": "/mnt/project-files/imports/curseofstrahd_vasha_staging.csv"},
    "Ivan Maddock": {"kind": "foundry", "json": "/mnt/project-files/samples/foundry/fananggar_rolllog.json",
                     "actors": ["bIgeL8EZJvqRDAdW"]},
    "Idris Ildroun": {"kind": "foundry", "json": "/mnt/project-files/samples/foundry/stormkingsthunder_rolllog.json",
                      "actors": ["WjUrxuscC2ikWmoc", "ZWSpOASN3m9kLhvL"]},
}
GAP_MS = 5 * 60 * 1000 #roll more than 5 min after the previous one in a group -> new group
NOT_DAMAGE_DICE = re.compile(r"d(20|100|f)\b") #hand rolls that are never damage (d20, percentile, fate)

#--------------------------------------------------------------------------------------------------------------
#roll20
#--------------------------------------------------------------------------------------------------------------

#one character's rolls in time order, labelled attack / damage / hand / other; other speakers' rolls kept as markers
#params: messages (list[dict]) decoded chat archive; char (str) character name
#output: list[dict] events {gi, own, kind, name, at, id, formula}
def template_events(messages: list, char: str) -> list:
    #player id that rolls this character's sheet -> catches their hand-typed /r rolls too
    pids = pd.Series([m.get("playerid") for m in messages if m.get("rolltemplate")
                      and r20.roller_name(m, r20.template_fields(m.get("content", ""))) == char])
    pid = pids.mode()[0]
    kinds = {"atk": "attack", "atkdmg": "attack+damage", "dmg": "damage", "spell": "card", "spelloutput": "card"}
    events = []
    for gi, m in enumerate(messages):
        tmpl = m.get("rolltemplate")
        fields = r20.template_fields(m.get("content", "")) if tmpl else {}
        plain = not tmpl and m.get("type") in ("rollresult", "gmrollresult") #typed /r roll, no sheet button
        mine = (tmpl and r20.roller_name(m, fields) == char) or (plain and m.get("playerid") == pid)
        if not mine:
            if m.get("inlinerolls") or plain:
                events.append({"gi": gi, "own": False, "kind": "other_speaker"})
            continue
        name = fields.get("rname") if isinstance(fields.get("rname"), str) else ""
        events.append({"gi": gi, "own": True, "at": m.get(".priority", 0), "id": m["_id"],
                       "name": re.sub(r"\[([^\]]*)\]\(.*?\)", r"\1", name).strip(), #"[Sunsword](~...)" -> "Sunsword"
                       "kind": "hand" if plain else kinds.get(tmpl, "other"),
                       "formula": (m.get("origRoll") or "").lower()})
    return events

#attack groups: run of same-name attacks, then the damage / hand dice that follow before any other roll
#multiattack (Extra Attack, Eldritch Blast beams) is rolled as A A D D, so hits are counted per group
#params: events (list[dict]) template_events output
#output: tuple(list[dict] groups, int orphan damage rolls)
def attack_groups(events: list) -> tuple:
    own = [e for e in events if e["own"] and e["kind"] != "card"]
    groups, used, i = [], set(), 0
    while i < len(own):
        first = own[i]
        if first["kind"] not in ("attack", "attack+damage"):
            i += 1
            continue
        #collect the attack run
        atts, j = [first], i + 1
        while (j < len(own) and own[j]["kind"] == "attack" and own[j]["name"] == first["name"]
               and own[j]["at"] - own[j - 1]["at"] < GAP_MS):
            atts.append(own[j]); j += 1
        #collect damage evidence after it
        dmgs, hand, last = [], [], atts[-1]["at"]
        while j < len(own) and own[j]["at"] - last < GAP_MS:
            e = own[j]
            if e["kind"] == "damage" and e["name"] == first["name"]:
                dmgs.append(e); used.add(e["id"])
            elif e["kind"] == "hand" and not NOT_DAMAGE_DICE.search(e["formula"]):
                hand.append(e) #crit dice, smite d8s, hex d6 typed by hand
            elif e["kind"] != "damage": #other-name damage (smite spell) stays in the group, anything else ends it
                break
            last = e["at"]; j += 1
        between = sum(1 for e in events if not e["own"] and dmgs and atts[0]["gi"] < e["gi"] < dmgs[-1]["gi"])
        groups.append({"name": first["name"], "atts": atts, "n_dmg": len(dmgs), "n_hand": len(hand),
                       "auto_damage": first["kind"] == "attack+damage", "others_between": between,
                       "dmg_gap_s": (dmgs[-1]["at"] - atts[-1]["at"]) / 1000 if dmgs else None})
        i = j
    orphans = sum(1 for e in own if e["kind"] == "damage" and e["id"] not in used)
    return groups, orphans

#group -> one row per attack; hits = damage rolls (or hand rolls when more), capped at attacks; best rolls get the hits
#params: groups (list[dict]); d20 (dict) message id -> (kept d20 face, total); char (str)
#output: pd.DataFrame one row per attack
def attacks_from_groups(groups: list, d20: dict, char: str) -> pd.DataFrame:
    rows = []
    for g in groups:
        faces = [d20.get(a["id"], (None, None)) for a in g["atts"]]
        n_hit = min(len(faces), max(g["n_dmg"], g["n_hand"]))
        n_hit_sheet_only = min(len(faces), g["n_dmg"])
        #rank: nat 20 first, nat 1 last, then by total
        order = sorted(range(len(faces)), key=lambda k: (faces[k][0] == 20, faces[k][0] != 1, faces[k][1]), reverse=True)
        for rank, k in enumerate(order):
            rows.append({"char": char, "source": "roll20", "dedupe_key": g["atts"][k]["id"] + ":r1", #= rolls.dedupe_key
                         "name": g["name"], "face": faces[k][0], "total": faces[k][1], "damage_rolls": g["n_dmg"], "hand_rolls": g["n_hand"],
                         "ac": None, "group_size": len(faces), "hit": rank < n_hit,
                         "hit_sheet_only": rank < n_hit_sheet_only})
    return pd.DataFrame(rows)

#Izzie's rule read literally: hit only if this character's very next roll is damage for the same weapon / spell
#params: events (list[dict]) template_events output; d20 (dict)
#output: pd.DataFrame face, literal_hit
def literal_rule_roll20(events: list, d20: dict) -> pd.DataFrame:
    own = [e for e in events if e["own"] and e["kind"] != "card"]
    rows = []
    for i, a in enumerate(own):
        if a["kind"] != "attack":
            continue
        nxt = own[i + 1] if i + 1 < len(own) else None
        rows.append({"face": d20.get(a["id"], (None,))[0],
                     "literal_hit": bool(nxt and nxt["kind"] == "damage" and nxt["name"] == a["name"])})
    return pd.DataFrame(rows)

#--------------------------------------------------------------------------------------------------------------
#foundry
#--------------------------------------------------------------------------------------------------------------

#attacks from a foundry export; hit = damage roll from the same usage card (originatingMessage), logged AC kept for checking
#params: path (str) export json; actors (list[str]) actor ids for this character; char (str)
#output: pd.DataFrame one row per attack
def foundry_attacks(path: str, actors: list, char: str) -> pd.DataFrame:
    msgs = [m for m in json.load(open(path))["messages"] if m.get("actor_id") in actors]
    msgs.sort(key=lambda m: m["timestamp"])
    rtype = lambda m: ((m.get("system_flags") or {}).get("roll") or {}).get("type")
    card = lambda m: (m.get("system_flags") or {}).get("originatingMessage") #usage card the roll came from
    item = lambda m: ((m.get("system_flags") or {}).get("item") or {}).get("id") or ((m.get("system_flags") or {}).get("roll") or {}).get("itemId")
    dmg_per_card = pd.Series([card(m) for m in msgs if rtype(m) == "damage"]).value_counts()
    rows = []
    for i, a in enumerate(msgs):
        if rtype(a) != "attack":
            continue
        die = next(d for d in a["rolls"][0]["dice"] if d["faces"] == 20)
        face = [x["result"] for x in die["results"] if x.get("active", True)][0] #kept die after adv / dis
        acs = [t["ac"] for t in a["system_flags"].get("targets") or [] if t.get("ac") is not None]
        nxt = msgs[i + 1] if i + 1 < len(msgs) else None
        rows.append({"char": char, "source": "foundry", "dedupe_key": a["id"], #= rolls.dedupe_key
                     "name": (a.get("flavor") or "").split(" - ")[0],
                     "face": face, "total": a["rolls"][0]["total"], "ac": acs[0] if acs else None, "card": card(a),
                     "card_dmg": int(dmg_per_card.get(card(a), 0)),
                     "literal_hit": bool(nxt and rtype(nxt) == "damage" and item(nxt) == item(a))})
    df = pd.DataFrame(rows)
    #same group logic as roll20, but the card says exactly which damage belongs to which attack use
    df["hit"] = False
    for _, g in df.groupby("card"):
        ranked = g.assign(k=(g.face == 20) * 100 - (g.face == 1) * 100 + g.total).sort_values("k", ascending=False)
        df.loc[ranked.index[:min(len(g), g.card_dmg.iloc[0])], "hit"] = True
    df["group_size"] = df.groupby("card").card.transform("size")
    df["damage_rolls"], df["hand_rolls"] = df.card_dmg, 0
    return df

#--------------------------------------------------------------------------------------------------------------
#scoring
#--------------------------------------------------------------------------------------------------------------

#dashboard rule: nat 20 hits, nat 1 misses, else total >= AC (logged AC if any, else slider)
#params: df (pd.DataFrame) attacks; slider (int) assumed AC
#output: pd.Series bool
def slider_hit(df: pd.DataFrame, slider: int) -> pd.Series:
    ac = df.ac.fillna(slider)
    return (df.face == 20) | ((df.face != 1) & (df.total >= ac))

#one summary row per character
#params: df (pd.DataFrame) attacks; literal (pd.DataFrame) literal rule rows; slider (int)
#output: dict
def summarize(df: pd.DataFrame, literal: pd.DataFrame, slider: int) -> dict:
    dash = slider_hit(df, slider)
    known = df[df.ac.notna()]
    ac_truth = slider_hit(known, slider)
    best_ac = min(range(8, 25), key=lambda ac: (slider_hit(df.assign(ac=None), ac) != df.hit).sum())
    return {"character": df.char.iloc[0], "source": df.source.iloc[0], "attacks": len(df),
            "in_multiattack_groups": int((df.group_size > 1).sum()),
            "literal_rule_hit_pct": round(100 * literal.literal_hit.mean(), 1),
            "literal_rule_nat20_hit_pct": round(100 * literal[literal.face == 20].literal_hit.mean(), 1),
            "grouped_rule_hit_pct": round(100 * df.hit.mean(), 1),
            "grouped_nat20_hit_pct": round(100 * df[df.face == 20].hit.mean(), 1),
            "grouped_nat1_hit_pct": round(100 * df[df.face == 1].hit.mean(), 1),
            "dashboard_hit_pct": round(100 * dash.mean(), 1),
            "agree_with_dashboard_pct": round(100 * (dash == df.hit).mean(), 1),
            "attacks_with_logged_ac": len(known),
            "agree_with_logged_ac_pct": round(100 * (ac_truth == known.hit).mean(), 1) if len(known) else None,
            "hits_by_ac_without_damage": int((ac_truth & ~known.hit).sum()),
            "damage_after_ac_miss": int((~ac_truth & known.hit).sum()),
            "best_fit_single_ac": best_ac}

#--------------------------------------------------------------------------------------------------------------
#load
#--------------------------------------------------------------------------------------------------------------

#attack table -> insert for public.attack_outcomes, matched on rolls.dedupe_key; re-runnable (on conflict update)
#params: df (pd.DataFrame) all attacks; path (str) output .sql
#output: none; writes file
def write_load_sql(df: pd.DataFrame, path: str):
    vals = ",".join(f"('{r.dedupe_key}',{int(r.hit)},{int(r.group_size)},{int(r.damage_rolls)},{int(r.hand_rolls)})"
                    for r in df.itertuples()) #hit as 1/0 -> compared to 1 in sql
    sql = f"""-- load attack_outcomes from attacks_all.csv (hit_inference_test.py output); match on rolls.dedupe_key
-- method: roll20 keys end in ":r1" -> roll20_group, else foundry_card. re-runnable: on conflict -> overwrite
insert into public.attack_outcomes (roll_id, inferred_hit, method, group_size, damage_rolls, hand_rolls)
select r.id, v.hit = 1, case when v.k like '%:r1' then 'roll20_group' else 'foundry_card' end, v.gs, v.dr, v.hr
from (values {vals}) v(k, hit, gs, dr, hr)
join public.rolls r on r.dedupe_key = v.k and r.category = 'attack'
on conflict (roll_id) do update set inferred_hit = excluded.inferred_hit, method = excluded.method,
  group_size = excluded.group_size, damage_rolls = excluded.damage_rolls, hand_rolls = excluded.hand_rolls,
  rule_version = excluded.rule_version, created_at = now();
"""
    os.makedirs(os.path.dirname(path), exist_ok=True) #sql/ subfolder
    with open(path, "w") as f:
        f.write(sql)

#CLI entry: build attack tables for all four characters, write csvs + summary
#params: none (reads --slider-ac, --out-dir)
#output: none; writes attacks_all.csv, summary.csv, prints summary
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slider-ac", type=int, default=14)
    ap.add_argument("--out-dir", default=os.path.dirname(os.path.abspath(__file__)))
    args = ap.parse_args()
    tables, summary, edge = [], [], []
    for char, src in SOURCES.items():
        if src["kind"] == "roll20":
            #load chat archive + kept d20 per attack message from staging
            msgs = r20.load_messages(src["html"])
            stg = pd.read_csv(src["staging"], low_memory=False)
            stg = stg[(stg.category == "attack") & (stg.roller_name == char)]
            d20 = {row.source_message_id.split(":")[0]:
                   ([d["face"] for d in json.loads(row.dice) if d["sides"] == 20 and d["kept"]][0], row.total)
                   for row in stg.itertuples()}
            events = template_events(msgs, char)
            groups, orphans = attack_groups(events)
            df = attacks_from_groups(groups, d20, char)
            literal = literal_rule_roll20(events, d20)
            edge.append({"character": char, "groups": len(groups),
                         "attack_plus_damage_template": sum(g["auto_damage"] for g in groups),
                         "groups_with_other_players_between": sum(g["others_between"] > 0 for g in groups),
                         "groups_damage_over_60s": sum((g["dmg_gap_s"] or 0) > 60 for g in groups),
                         "groups_hand_dice_only_evidence": sum(g["n_hand"] > g["n_dmg"] and g["n_dmg"] < len(g["atts"]) for g in groups),
                         "groups_more_damage_than_attacks": sum(g["n_dmg"] > len(g["atts"]) for g in groups),
                         "unmatched_damage_rolls": orphans,
                         "nat20_hit_pct_sheet_damage_only": round(100 * df[df.face == 20].hit_sheet_only.mean(), 1)})
        else:
            df = foundry_attacks(src["json"], src["actors"], char)
            literal = df[["face", "literal_hit"]]
        tables.append(df)
        summary.append(summarize(df, literal, args.slider_ac))
    pd.concat(tables).to_csv(os.path.join(args.out_dir, "attacks_all.csv"), index=False)
    write_load_sql(pd.concat(tables), os.path.join(args.out_dir, "sql", "02_load_attack_outcomes.sql"))
    pd.DataFrame(summary).to_csv(os.path.join(args.out_dir, "summary.csv"), index=False)
    pd.DataFrame(edge).to_csv(os.path.join(args.out_dir, "roll20_edge_cases.csv"), index=False)
    print(pd.DataFrame(summary).T.to_string())
    print(pd.DataFrame(edge).T.to_string())

if __name__ == "__main__":
    main()
