# Roll20 Chat Archive parser -> import_staging rows (see schema/README.md "Staging row format")
# Usage Syntax: python roll20_parser.py --input samples/roll20/<file>.html --output out/<file>_staging.json
#   See names first:   python roll20_parser.py --input <file>.html --list
#   Keep some only:    ... --character Lazlo --character Nami --roll stealth --roll attack
#   Upload-ready CSV:  ... --output <file>_staging.csv --import-id 1   (matches imports.id row)
#   Check spell links: ... --review <file>_spell_links.csv   (each /roll tied to a spell card or smite)
#   Paladin smites:    ... --smite Vasha   (bare d8 /rolls after her weapon hits -> Divine Smite, Radiant)
# Output ext .json -> JSON list; .csv -> flat table (dice as JSON text). Stdlib only, no installs.

#--------------------------------------------------------------------------------------------------------------
# Outline
#   Load data
#     load_messages
#   Main / mother parse function
#     main
#     parse_messages
#     link_spell_roll
#     tag_smites
#   Per-message parsers (one per Roll20 message shape)
#     parse_template_message
#     parse_d20_pair
#     parse_damage_fields
#     field_rows
#     parse_loose_inline_rolls
#     parse_plain_roll
#   Helpers
#     template_fields
#     inline_roll
#     roller_name
#     classify_rname
#     roll_label
#     spell_info
#     spell_card
#     extract_dice
#     make_row
#     write_review
#   Lookup dicts
#     D20_TEMPLATES / FIELD_TEMPLATES / DAMAGE_FIELDS
#     (ABILITY_CODES / SKILL_ABILITY / SPELL_EFFECTS + filter_rows / list_names / write_output -> staging_common.py)
#     SPELL_LINK_WINDOW_MS / SMITE_WINDOW_MS
#--------------------------------------------------------------------------------------------------------------

import argparse #parse command line arguments to call script
import base64 #msgdata line is base64 text
import csv
import datetime
import json
import logging #adds extra reporting for debugging (timestamps, etc)
import os
import re

from staging_common import (ABILITY_CODES, SKILL_ABILITY, SPELL_EFFECTS,  #shared across parsers
                            filter_rows, list_names, match_character, write_output)

#init logging for user viewing
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
log = logging.getLogger(__name__)

#--------------------------------------------------------------------------------------------------------------
#lookup dicts
#--------------------------------------------------------------------------------------------------------------

#templates holding a d20 pair in r1/r2; value = default category when rname gives none
D20_TEMPLATES = {"simple": "custom", "npc": "custom", "atk": "attack", "npcatk": "attack"}

#templates parsed field by field; any other template -> every inline roll as 'custom'
FIELD_TEMPLATES = {"simple", "npc", "atk", "npcatk", "dmg", "npcdmg", "dmgaction", "mancerhproll"}

#template field holding a damage roll -> field holding its damage type (5e OGL sheet). crit = extra crit dice, own row
DAMAGE_FIELDS = {
    "dmg1": "dmg1type", "dmg2": "dmg2type", "crit1": "dmg1type", "crit2": "dmg2type",
    "hldmg": "dmg1type", "globaldamage": "globaldamagetype", "globaldamagecrit": "globaldamagetype",
}

#max gap between spell card and its /roll (ms)
SPELL_LINK_WINDOW_MS = 120000

#max gap between paladin weapon hit (or previous smite roll) and a bare d8 /roll counted as Divine Smite (ms)
SMITE_WINDOW_MS = 60000

#--------------------------------------------------------------------------------------------------------------
#load data operation/s
#--------------------------------------------------------------------------------------------------------------

#read saved Chat Archive page, decode msgdata line -> message list, oldest first
#params:  path (str) saved .html from "Show on One Page" + Ctrl+S
#output:  list[dict] Roll20 messages; each has "_id" (message id) added
def load_messages(path: str) -> list:
    with open(path, encoding="utf-8") as f:
        html = f.read()
    match = re.search(r'var msgdata = "([^"]*)";', html)
    if not match:
        raise ValueError("No 'var msgdata' line found; not a saved Roll20 Chat Archive page")
    chunks = json.loads(base64.b64decode(match.group(1)))   #list of {message_id: message}
    messages = []
    for chunk in chunks:
        for msg_id, msg in chunk.items():
            msg["_id"] = msg_id
            messages.append(msg)
    messages.sort(key=lambda m: m.get(".priority", 0))     #.priority = epoch ms
    log.info("Loaded %s messages from %s", len(messages), os.path.basename(path))
    return messages

#--------------------------------------------------------------------------------------------------------------
#main operations and mother parse function for
#tiered function calls
#--------------------------------------------------------------------------------------------------------------

#CLI entry: load -> parse -> (list | filter -> write)
#params:  none (reads command line: --input, --output, --list, --character, --roll, --import-id)
#output:  none; prints name lists or writes file, logs counts
def main():
    parser = argparse.ArgumentParser(description="Roll20 Chat Archive -> import_staging rows")
    parser.add_argument("--input", required=True, help="saved Chat Archive .html")
    parser.add_argument("--output", help=".json or .csv; not needed with --list")
    parser.add_argument("--list", action="store_true", help="print character + roll names with counts, write nothing")
    parser.add_argument("--character", action="append", default=[], help="keep this character; repeat for more")
    parser.add_argument("--roll", action="append", default=[], help="keep rolls whose name or category contains this; repeat for more")
    parser.add_argument("--import-id", type=int, help="add import_id column (imports.id) so CSV uploads straight to import_staging")
    parser.add_argument("--review", help="write .csv listing each /roll linked to a spell card or smite, for checking")
    parser.add_argument("--smite", action="append", default=[], help="paladin name: bare d8 /rolls after their weapon hits -> Divine Smite; repeat for more")
    args = parser.parse_args()

    messages = load_messages(args.input)
    rows = filter_rows(tag_smites(parse_messages(messages), args.smite), args.character, args.roll)
    if args.list:
        list_names(rows)
        return
    if not args.output:
        parser.error("--output is required unless --list is used")
    write_output(rows, args.output, args.import_id)
    if args.review:
        write_review(rows, args.review)

#route each message to its parser; collect staging rows; link /roll damage to spell cards; number rows
#params:  messages (list[dict]) output of load_messages
#output:  list[dict] staging rows, keys = import_staging columns
def parse_messages(messages: list) -> list:
    rows = []
    last_npc = {}    #playerid -> last NPC name; npcdmg messages carry no name
    last_card = {}   #playerid -> last spell card (spell_card output); cleared by any other sheet roll
    for msg in messages:
        player = msg.get("playerid")
        try:
            if msg.get("type") in ("rollresult", "gmrollresult"):
                new_rows = parse_plain_roll(msg)
                link_spell_roll(msg, new_rows, last_card.get(player))
            elif msg.get("rolltemplate") in ("spell", "spelloutput"):   #spell card: no dice, remembered for next /roll
                last_card[player] = spell_card(msg)
                new_rows = []
            elif msg.get("rolltemplate"):
                new_rows = parse_template_message(msg, last_npc)
                if new_rows:
                    last_card.pop(player, None)
            else:
                new_rows = parse_loose_inline_rolls(msg)
                if new_rows:
                    last_card.pop(player, None)
        except Exception as err:   #keep going; bad message -> parse_error row
            new_rows = [make_row(msg, "parse_error", None, None, [], None, None,
                                 parse_error=f"{type(err).__name__}: {err}")]
        rows.extend(new_rows)

    for i, row in enumerate(rows, start=1):
        row["line_number"] = i
    errors = sum(1 for r in rows if r["parse_error"])
    linked = sum(1 for r in rows if r.get("_linked_card"))
    log.info("Parsed %s roll rows (%s with parse_error, %s /roll linked to spell cards)", len(rows), errors, linked)
    return rows

#/roll right after a spell card -> that spell's damage / healing. Rule: same player, within window,
#no sheet roll in between (caller clears card), no d20 (d20 = check, not damage)
#params:  msg (dict) plain roll message; new_rows (list[dict]) its rows, edited in place; card (dict | None) spell_card output
#output:  none; rows relabelled: roller = card character, is_spell, spell_name, spell_level, category, damage_type
def link_spell_roll(msg: dict, new_rows: list, card):
    if not card or not new_rows or msg.get(".priority", 0) - card["at"] > SPELL_LINK_WINDOW_MS:
        return
    if any(d["sides"] == 20 for r in new_rows for d in r["dice"]):
        return
    effect = SPELL_EFFECTS.get(card["name"].lower())
    for row in new_rows:
        row.update({
            "roller_name": card["character"],
            "category": "healing" if effect == "healing" else "damage",
            "is_spell": True,
            "spell_name": card["name"],
            "spell_level": card["level"],
            "damage_type": None if effect == "healing" else effect,
            "_linked_card": card,
        })

#Divine Smite rolled as bare /roll with no card -> tag as spell damage, Radiant. Rule per paladin:
#d8-only /roll (custom row) from same player within window of their weapon attack / damage roll,
#or of the previous smite roll (chains: smite + undead bonus d8, several hits). Any other roll breaks the chain
#params:  rows (list[dict]) parse_messages output, time order; paladins (list[str]) --smite names
#output:  list[dict] same rows; matching rows relabelled in place
def tag_smites(rows: list, paladins: list) -> list:
    if not paladins:
        return rows
    anchor = {}   #playerid -> (ms, character) of last weapon hit or smite roll
    tagged = 0
    for row in rows:
        raw = json.loads(row["raw_text"])
        player, at = raw.get("playerid"), raw.get(".priority", 0)
        d8_only = row["category"] == "custom" and row["dice"] and all(d["sides"] == 8 for d in row["dice"])
        if row["category"] in ("attack", "damage") and not row["is_spell"]:
            name = match_character(row["roller_name"], paladins)
            if name:
                anchor[player] = (at, name)
            continue
        if d8_only and player in anchor and at - anchor[player][0] <= SMITE_WINDOW_MS:
            start, name = anchor[player]
            row.update({"roller_name": name, "category": "damage", "is_spell": True,
                        "spell_name": "Divine Smite", "spell_level": None, "damage_type": "Radiant",
                        "_linked_card": {"at": start, "name": "Divine Smite (no card)"}})
            anchor[player] = (at, name)
            tagged += 1
            continue
        anchor.pop(player, None)
    log.info("Tagged %s bare d8 rolls as Divine Smite (%s)", tagged, paladins)
    return rows

#--------------------------------------------------------------------------------------------------------------
#per-message parsers
#--------------------------------------------------------------------------------------------------------------

#character sheet roll template (5e OGL): d20 pair + damage fields; text-only templates -> no rows
#params:  msg (dict) message with rolltemplate; last_npc (dict) playerid -> last NPC name, updated here
#output:  list[dict] staging rows
def parse_template_message(msg: dict, last_npc: dict) -> list:
    template = msg["rolltemplate"]
    fields = template_fields(msg["content"])
    name = roller_name(msg, fields)
    if template in ("npc", "npcatk"):
        last_npc[msg.get("playerid")] = name
    elif template == "npcdmg":
        name = last_npc.get(msg.get("playerid"), name)   #damage link from prior NPC attack
    if template not in FIELD_TEMPLATES:   #default / custom macros: field names unknown
        return parse_loose_inline_rolls(msg, name)

    rows = []
    if template in D20_TEMPLATES and "r1" in fields:
        row = parse_d20_pair(msg, fields, name)
        if row:
            rows.append(row)
    rows.extend(parse_damage_fields(msg, fields, name))
    if template == "mancerhproll" and "r1" in fields:   #level-up HP roll
        rows.extend(field_rows(msg, fields, name, ["r1"], "custom"))
    return rows

#r1/r2 d20 pair -> one row; roll mode from template flags
#params:  msg (dict) message; fields (dict) template_fields output; name (str) roller
#output:  dict staging row, or None if r1 rolled no dice
def parse_d20_pair(msg: dict, fields: dict, name: str):
    rolls = msg.get("inlinerolls", [])
    r1 = inline_roll(rolls, fields.get("r1"))
    r2 = inline_roll(rolls, fields.get("r2"))
    if r1 is None:
        return None
    d1 = extract_dice(r1["results"])
    d2 = extract_dice(r2["results"]) if r2 else []
    if not d1:
        return None

    #flags: advantage / disadvantage = r2 counts; normal / query / always = r1 counts, r2 shown only
    if "advantage" in fields and d2:
        mode, use_r2 = "advantage", r2["results"]["total"] > r1["results"]["total"]
    elif "disadvantage" in fields and d2:
        mode, use_r2 = "disadvantage", r2["results"]["total"] < r1["results"]["total"]
    else:
        mode, use_r2 = "normal", False
    kept, other = (r2, r1) if use_r2 else (r1, r2)
    dice = extract_dice(kept["results"])
    if other:
        dice += [dict(d, kept=False) for d in extract_dice(other["results"])]

    category, skill, ability = classify_rname(fields.get("rname", ""))
    if category is None:
        category = D20_TEMPLATES[msg["rolltemplate"]]
    return make_row(msg, "r1", name, kept["expression"], dice, kept["results"]["total"], category,
                    skill=skill, ability=ability, roll_mode=mode, **spell_info(fields))

#damage fields (dmg1, dmg2, crit1, ...) -> one row each with its damage type; type "Healing" -> category healing
#params:  msg (dict) message; fields (dict) template_fields output; name (str) roller
#output:  list[dict] staging rows, category 'damage' | 'healing'
def parse_damage_fields(msg: dict, fields: dict, name: str) -> list:
    rows = []
    spell = spell_info(fields)
    for key, type_key in DAMAGE_FIELDS.items():
        if key not in fields:
            continue
        dmg_type = fields.get(type_key)
        dmg_type = dmg_type.strip() if isinstance(dmg_type, str) and dmg_type.strip() else None
        healing = dmg_type is not None and dmg_type.lower() == "healing"
        for row in field_rows(msg, fields, name, [key], "healing" if healing else "damage"):
            row.update(spell, damage_type=None if healing else dmg_type)
            rows.append(row)
    return rows

#template fields -> rows, one per field with dice
#params:  msg (dict); fields (dict); name (str); keys (list[str]) field names; category (str)
#output:  list[dict] staging rows
def field_rows(msg: dict, fields: dict, name: str, keys: list, category: str) -> list:
    rows = []
    for key in keys:
        roll = inline_roll(msg.get("inlinerolls", []), fields.get(key))
        if roll is None:
            continue
        dice = extract_dice(roll["results"])
        if dice:
            rows.append(make_row(msg, key, name, roll["expression"], dice, roll["results"]["total"], category))
    return rows

#inline rolls typed into chat ([[1d20+3]]) or unknown template -> one 'custom' row each
#params:  msg (dict) message; name (str | None) roller, default = speaker
#output:  list[dict] staging rows
def parse_loose_inline_rolls(msg: dict, name: str = None) -> list:
    rows = []
    for i, roll in enumerate(msg.get("inlinerolls", [])):
        dice = extract_dice(roll["results"])
        if dice:
            rows.append(make_row(msg, str(i), name or msg.get("who"), roll["expression"], dice,
                                 roll["results"]["total"], "custom"))
    return rows

#/roll or /gmroll message; roll JSON is in content, formula in origRoll
#params:  msg (dict) message, type rollresult | gmrollresult
#output:  list[dict] one staging row (empty if no dice)
def parse_plain_roll(msg: dict) -> list:
    result = json.loads(msg["content"])
    dice = extract_dice(result)
    if not dice:
        return []
    return [make_row(msg, None, msg.get("who"), msg.get("origRoll"), dice, result.get("total"), "custom")]

#--------------------------------------------------------------------------------------------------------------
#helper functions
#--------------------------------------------------------------------------------------------------------------

#template text "{{key=value}} ..." -> dict; value "$[[n]]" -> int n (inline roll index)
#params:  content (str) message content
#output:  dict[str, str | int]
def template_fields(content: str) -> dict:
    fields = {}
    for key, value in re.findall(r"\{\{(\w+)=(.*?)\}\}(?=\s|$)", content):
        ref = re.fullmatch(r"\$\[\[(\d+)\]\]", value.strip())
        fields[key] = int(ref.group(1)) if ref else value
    tail = re.search(r"(?:^|\s)charname=(.+?)\s*$", content)   #PC sheets: bare charname= at end
    if tail and "charname" not in fields:
        fields["charname"] = tail.group(1)
    return fields

#inline roll by index; None if missing or not an index
#params:  rolls (list[dict]) msg["inlinerolls"]; index (int | None)
#output:  dict inline roll, or None
def inline_roll(rolls: list, index):
    if isinstance(index, int) and 0 <= index < len(rolls):
        return rolls[index]
    return None

#character name: charname (PC + NPC attack), name (NPC sheet), else speaker
#params:  msg (dict); fields (dict) template_fields output
#output:  str roller name
def roller_name(msg: dict, fields: dict) -> str:
    for key in ("charname", "name"):
        value = fields.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return (msg.get("who") or "Unknown").strip()

#rname -> (category, skill code, ability code); unknown -> (None, None, None)
#params:  rname (str) e.g. "^{stealth-u}", "^{wisdom-save-u}", "[Shortsword](~...)"
#output:  tuple(str | None, str | None, str | None)
def classify_rname(rname: str) -> tuple:
    key = re.fullmatch(r"\^\{([\w-]+?)(?:-u)?\}?", rname.strip())
    if not key:
        return None, None, None
    key = key.group(1)
    if key == "init":
        return "initiative", None, "DEX"
    if key == "death-save":
        return "death_save", None, None
    if key == "hit-dice":
        return "hit_dice", None, None
    if key.endswith("-save") and key[:-5] in ABILITY_CODES:
        return "saving_throw", None, ABILITY_CODES[key[:-5]]
    if key in ABILITY_CODES:
        return "ability_check", None, ABILITY_CODES[key]
    if key in SKILL_ABILITY:
        return "skill_check", key, SKILL_ABILITY[key]
    return None, None, None

#readable roll name from template: "^{stealth-u}" -> "Stealth", "[Shortsword](~...)" -> "Shortsword"
#params:  msg (dict) message
#output:  str roll name, "" for plain /roll or unnamed rolls
def roll_label(msg: dict) -> str:
    if not msg.get("rolltemplate"):
        return ""
    fields = template_fields(msg.get("content", ""))
    label = fields.get("rname") or fields.get("name") or fields.get("title") or ""
    if not isinstance(label, str):
        return ""
    label = re.sub(r"\[([^\]]*)\]\(.*?\)", r"\1", label)   #markdown link -> its text
    key = re.fullmatch(r"\^\{([\w-]+?)(?:-u)?\}?", label.strip())
    if key:   #sheet translation key -> words
        label = {"init": "Initiative"}.get(key.group(1), key.group(1).replace("_", " ").replace("-", " ").title())
    return label.strip()

#spell flags from atk / dmg template: spell = spelllevel set or spell description link present
#params:  fields (dict) template_fields output
#output:  dict {is_spell (bool), spell_name (str | None), spell_level (int | None, 0 = cantrip)}
def spell_info(fields: dict) -> dict:
    level = fields.get("spelllevel")
    level = level.strip().lower() if isinstance(level, str) else ""
    if not level and "spelldesc_link" not in fields:
        return {"is_spell": False, "spell_name": None, "spell_level": None}
    name = fields.get("rname") if isinstance(fields.get("rname"), str) else ""
    name = re.sub(r"\[([^\]]*)\]\(.*?\)", r"\1", name).strip() or None
    return {"is_spell": True, "spell_name": name,
            "spell_level": 0 if level == "cantrip" else (int(level) if level.isdigit() else None)}

#spell card (spell / spelloutput template, no dice) -> what a following /roll needs
#params:  msg (dict) spell card message
#output:  dict {at (ms), character (str), name (str), level (int | None, 0 = cantrip)}
def spell_card(msg: dict) -> dict:
    fields = template_fields(msg.get("content", ""))
    level = fields.get("level") if isinstance(fields.get("level"), str) else ""   #"conjuration 3", "evocation cantrip"
    word = level.split()[-1].lower() if level.split() else ""
    name = fields.get("name") if isinstance(fields.get("name"), str) else ""
    return {"at": msg.get(".priority", 0), "character": roller_name(msg, {"charname": fields.get("charname")}),
            "name": name.strip(), "level": 0 if word == "cantrip" else (int(word) if word.isdigit() else None)}

#roll result tree -> flat dice list; dropped dice (kh/kl) -> kept False; walks nested groups; Fate dice skipped
#params:  result (dict) Roll20 roll result ({"rolls": [...]} or group)
#output:  list[dict] [{"sides": int, "face": int, "kept": bool}, ...]
def extract_dice(result: dict) -> list:
    dice = []
    for part in result.get("rolls", []):
        if isinstance(part, list):   #group "{...}" -> nested list of parts
            dice += extract_dice({"rolls": part})
        elif part.get("type") == "R" and isinstance(part.get("sides"), int) and not part.get("fate"):   #dF faces -1..1, skip
            for die in part.get("results", []):
                if "v" in die:
                    dice.append({"sides": part["sides"], "face": int(die["v"]), "kept": not die.get("d")})
        elif part.get("type") == "G":
            dice += extract_dice(part)
    return dice

#build one staging row; modifier = total - kept dice sum; totals rounded (init tiebreak decimals)
#params:  msg (dict); suffix (str | None) field name, makes id unique per row; name (str | None);
#         formula (str | None); dice (list[dict]); total (float | None); category (str | None);
#         skill / ability / roll_mode / parse_error (str | None) optional;
#         is_spell (bool), spell_name (str | None), spell_level (int | None), damage_type (str | None) optional
#output:  dict staging row (line_number set later by parse_messages)
def make_row(msg, suffix, name, formula, dice, total, category,
             skill=None, ability=None, roll_mode="normal", parse_error=None,
             is_spell=False, spell_name=None, spell_level=None, damage_type=None) -> dict:
    kept_sum = sum(d["face"] for d in dice if d["kept"])
    priority = msg.get(".priority")
    raw = {k: v for k, v in msg.items() if k not in ("avatar", "_id")}
    return {
        "line_number": None,
        "rolled_at": (datetime.datetime.fromtimestamp(priority / 1000, datetime.timezone.utc)
                      .isoformat(timespec="seconds") if priority else None),
        "roller_name": name,
        "formula": formula,
        "dice": dice,
        "modifier": round(total - kept_sum) if total is not None else None,
        "total": round(total) if total is not None else None,
        "category": category,
        "skill": skill,
        "ability": ability,
        "roll_mode": roll_mode,
        "target_value": None,   #Roll20 sheets don't record DC / AC
        "is_spell": is_spell,
        "spell_name": spell_name,
        "spell_level": spell_level,
        "damage_type": damage_type,
        "source_message_id": f"{msg['_id']}:{suffix}" if suffix else msg.get("_id"),
        "raw_text": json.dumps(raw, ensure_ascii=False),
        "parse_error": parse_error,
        "_roll_name": roll_label(msg),   #filter / --list only; not a staging column, dropped on write
    }

#linked spell rolls -> .csv for a quick check before upload (one line per /roll tied to a card)
#params:  rows (list[dict]) parsed rows; path (str) output .csv
#output:  none; writes file
def write_review(rows: list, path: str):
    linked = [r for r in rows if r.get("_linked_card")]
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["rolled_at", "character", "spell", "spell_level", "seconds_after_card",
                         "formula", "total", "category", "damage_type", "source_message_id"])
        for r in linked:
            card = r["_linked_card"]
            rolled_ms = json.loads(r["raw_text"]).get(".priority", 0)
            writer.writerow([r["rolled_at"], r["roller_name"], r["spell_name"], r["spell_level"],
                             round((rolled_ms - card["at"]) / 1000), r["formula"], r["total"],
                             r["category"], r["damage_type"], r["source_message_id"]])
    log.info("Wrote %s linked spell rolls to %s", len(linked), path)


if __name__ == "__main__":
    main()
