# Foundry VTT roll export (.json from foundry/foundry_roll_export.js) parser -> import_staging rows
# Usage Syntax: python foundry_parser.py --input samples/foundry/<file>.json --output out/<file>_staging.json
#   See names first:   python foundry_parser.py --input <file>.json --list
#   Keep some only:    ... --character "Ivan Maddock" --roll stealth --roll attack
#   Upload-ready CSV:  ... --output <file>_staging.csv --import-id 3   (matches imports.id row)
#   Drop healing:      ... --exclude-healing   (spell healing kept by default; foundry tags it reliably)
#   Keep potions:      ... --keep-potion-healing (consumable heals; dropped by default, spell + feat healing kept)
#   Old 2014 sheet:    ... --rules-2014-before 2025-06-01   (rolls before date -> 2014 spell dice scaling)
# Output ext .json -> JSON list; .csv -> flat table (dice as JSON text). Stdlib only, no installs.
# Shared dicts, filters and writer live in staging_common.py (same folder).

#--------------------------------------------------------------------------------------------------------------
# Outline
#   Load data
#     load_export
#   Main / mother parse function
#     main
#     parse_messages
#     parse_roll
#     set_spell_levels
#   Helpers
#     actor_names
#     classify
#     heal_check
#     spell_info
#     spell_table
#     upcast_level
#     roll_mode
#     extract_dice
#     roll_label
#     target_ac
#     iso_seconds
#   Lookup dicts
#     ROLL_TYPES / SKILL_CODES / ABILITY_SHORT / INITIATIVE_FLAVOR / SPELL_LEVELS / SPELL_LEVELS_2014 / NOT_HEALING
#--------------------------------------------------------------------------------------------------------------

import argparse #parse command line arguments to call script
import collections #Counter -> most common speaker per actor
import datetime
import json
import logging #adds extra reporting for debugging (timestamps, etc)
import os
import re

from staging_common import (ABILITY_CODES, SKILL_ABILITY, SPELL_EFFECTS, filter_rows, list_names,  #shared across parsers
                            staging_row, write_output)

log = logging.getLogger(__name__)

#--------------------------------------------------------------------------------------------------------------
#lookup dicts
#--------------------------------------------------------------------------------------------------------------

#dnd5e roll type (system_flags.roll.type) -> staging category
ROLL_TYPES = {
    "skill": "skill_check", "ability": "ability_check", "check": "ability_check", "save": "saving_throw",
    "attack": "attack", "damage": "damage", "healing": "healing", "hitDie": "hit_dice",
    "death": "death_save", "initiative": "initiative",
}

#dnd5e 3-letter skill id -> skills_abilities.code
SKILL_CODES = {
    "acr": "acrobatics", "ani": "animal_handling", "arc": "arcana", "ath": "athletics",
    "dec": "deception", "his": "history", "ins": "insight", "itm": "intimidation",
    "inv": "investigation", "med": "medicine", "nat": "nature", "prc": "perception",
    "prf": "performance", "per": "persuasion", "rel": "religion", "slt": "sleight_of_hand",
    "ste": "stealth", "sur": "survival",
}

#dnd5e ability id -> skills_abilities.code
ABILITY_SHORT = {"str": "STR", "dex": "DEX", "con": "CON", "int": "INT", "wis": "WIS", "cha": "CHA"}

#core initiative message flavor ("Ivan rolls for Initiative!"); core sets no system flags on it
INITIATIVE_FLAVOR = re.compile(r"rolls for initiative!?\s*$", re.IGNORECASE)

#spell name -> (base level, base dice count, extra dice per slot level above base, die faces); 2024 rules
#dice None -> no slot scaling (cantrips scale by character level; Scorching Ray adds rays, not dice)
#unlisted spell -> spell_level null. Add spells as characters use them
SPELL_LEVELS = {
    "chill touch": (0, None, None, None), "fire bolt": (0, None, None, None),
    "shocking grasp": (0, None, None, None), "thorn whip": (0, None, None, None),
    "eldritch blast": (0, None, None, None), "sacred flame": (0, None, None, None),
    "toll the dead": (0, None, None, None),
    "cure wounds": (1, 2, 2, 8), "healing word": (1, 2, 2, 4),
    "guiding bolt": (1, 4, 1, 6), "chromatic orb": (1, 3, 1, 8), "witch bolt": (1, 2, 1, 12),
    "shatter": (2, 3, 1, 8), "scorching ray": (2, None, None, None), "moonbeam": (2, 2, 1, 10),
    "spiritual weapon": (2, 1, 1, 8), "aid": (2, None, None, None), "inflict wounds": (1, 2, 1, 10),
    "fireball": (3, 8, 1, 6), "spirit guardians": (3, 3, 1, 8), "mass healing word": (3, 2, 1, 4),
    "glyph of warding": (3, 5, 1, 8),
}

#2014 rules entries that differ from 2024; used for rolls before --rules-2014-before
#spiritual weapon 2014 adds 1d8 per 2 levels -> no per-level read, base only
SPELL_LEVELS_2014 = {
    "cure wounds": (1, 1, 1, 8), "healing word": (1, 1, 1, 4), "mass healing word": (3, 1, 1, 4),
    "spiritual weapon": (2, None, None, None), "inflict wounds": (1, 3, 1, 10),
}

#heal-flagged spells that raise max HP instead of healing -> rows dropped (Aid: flat +5 / slot, no dice)
NOT_HEALING = {"aid"}

#--------------------------------------------------------------------------------------------------------------
#load data operation/s
#--------------------------------------------------------------------------------------------------------------

#read export .json, messages oldest first
#params:  path (str) file saved by foundry_roll_export.js
#output:  dict export header + "messages" list
def load_export(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        export = json.load(f)
    if not isinstance(export, dict) or "messages" not in export:
        raise ValueError("No 'messages' list; not a foundry_roll_export.js file")
    export["messages"].sort(key=lambda m: m.get("timestamp") or "")   #iso strings sort as dates
    log.info("Loaded %s messages from %s (world '%s', %s %s, foundry %s)", len(export["messages"]),
             os.path.basename(path), export.get("world"), export.get("system"),
             export.get("system_version"), export.get("foundry_version"))
    return export

#--------------------------------------------------------------------------------------------------------------
#main operations and mother parse function for
#tiered function calls
#--------------------------------------------------------------------------------------------------------------

#CLI entry: load -> parse -> (list | filter -> write)
#params:  none (reads command line: --input, --output, --list, --character, --roll, --import-id,
#         --exclude-healing, --keep-potion-healing, --rules-2014-before)
#output:  none; prints name lists or writes file, logs counts
def main():
    parser = argparse.ArgumentParser(description="Foundry roll export .json -> import_staging rows")
    parser.add_argument("--input", required=True, help="foundry_rolls_<world>.json")
    parser.add_argument("--output", help=".json or .csv; not needed with --list")
    parser.add_argument("--list", action="store_true", help="print character + roll names with counts, write nothing")
    parser.add_argument("--character", action="append", default=[], help="keep this character; repeat for more")
    parser.add_argument("--roll", action="append", default=[], help="keep rolls whose name or category contains this; repeat for more")
    parser.add_argument("--import-id", type=int, help="add import_id column (imports.id) so CSV uploads straight to import_staging")
    parser.add_argument("--exclude-healing", action="store_true", help="drop all healing rows (spell healing kept by default)")
    parser.add_argument("--keep-potion-healing", action="store_true", help="keep healing from potions / consumables (dropped by default)")
    parser.add_argument("--rules-2014-before", help="YYYY-MM-DD; rolls before this use 2014 spell scaling (old sheet)")
    args = parser.parse_args()

    rows = parse_messages(load_export(args.input)["messages"], not args.exclude_healing, args.keep_potion_healing,
                          args.rules_2014_before)
    rows = filter_rows(rows, args.character, args.roll)
    if args.list:
        list_names(rows)
        return
    if not args.output:
        parser.error("--output is required unless --list is used")
    write_output(rows, args.output, args.import_id)

#each roll on each message -> one staging row; blind rolls (no values) skipped; spell levels set;
#potion (consumable) healing dropped unless kept; all healing dropped if excluded; number rows
#params:  messages (list[dict]) export["messages"]; include_healing (bool) keep healing rows;
#         keep_potion_healing (bool) keep healing from consumables;
#         rules_2014_before (str | None) "YYYY-MM-DD"; earlier rolls use SPELL_LEVELS_2014
#output:  list[dict] staging rows, keys = import_staging columns
def parse_messages(messages: list, include_healing: bool = True, keep_potion_healing: bool = False,
                   rules_2014_before: str = None) -> list:
    names = actor_names(messages)
    rows, blind = [], 0
    for msg in messages:
        if msg.get("rolls") is None:   #result hidden from the exporting player
            blind += 1
            continue
        multi = len(msg["rolls"]) > 1
        for i, roll in enumerate(msg["rolls"]):
            suffix = f"{msg['id']}:{i}" if multi else msg["id"]   #unique id per row
            try:
                rows.append(parse_roll(msg, roll, names, suffix))
            except Exception as err:   #keep going; bad roll -> parse_error row
                rows.append(staging_row(iso_seconds(msg.get("timestamp")), msg.get("speaker"), roll.get("formula"),
                                        [], None, None, suffix, msg, parse_error=f"{type(err).__name__}: {err}"))

    set_spell_levels(rows, rules_2014_before)

    #max-HP spells (Aid) flagged as heals -> dropped, not healing
    not_heal = [r for r in rows if (r["spell_name"] or "").lower() in NOT_HEALING]
    rows = [r for r in rows if (r["spell_name"] or "").lower() not in NOT_HEALING]
    if not_heal:
        log.info("Dropped %s max-HP rolls (%s)", len(not_heal), sorted(NOT_HEALING))

    #healing filter: potion heals dropped unless kept; spell + feat heals (Spellfire Burst) stay
    potion_heals = [r for r in rows if r["category"] == "healing" and r["_item_type"] == "consumable"]
    if not keep_potion_healing:
        rows = [r for r in rows if not (r["category"] == "healing" and r["_item_type"] == "consumable")]
    if not include_healing:
        rows = [r for r in rows if r["category"] != "healing"]
    for i, row in enumerate(rows, start=1):
        row["line_number"] = i
    errors = sum(1 for r in rows if r["parse_error"])
    healing = sum(1 for r in rows if r["category"] == "healing")
    log.info("Parsed %s roll rows (%s with parse_error, %s blind skipped, %s healing kept, %s potion healing %s)",
             len(rows), errors, blind, healing, len(potion_heals), "kept" if keep_potion_healing else "dropped")
    return rows

#one roll -> one staging row
#params:  msg (dict) export message; roll (dict) one entry of msg["rolls"]; names (dict) actor_names output;
#         suffix (str) source_message_id
#output:  dict staging row
def parse_roll(msg: dict, roll: dict, names: dict, suffix: str) -> dict:
    flags = msg.get("system_flags") or {}
    category, skill, ability = classify(msg)
    spell = spell_info(msg)
    damage_type = (roll.get("damage_type") or "").title() or None   #newer exports carry it ("fire" -> "Fire"); older -> spell lookup
    category = heal_check(flags, category, spell["spell_name"], damage_type)
    if category == "damage" and not damage_type and spell["is_spell"]:
        effect = SPELL_EFFECTS.get((spell["spell_name"] or "").lower())
        damage_type = effect if effect != "healing" else None
    if category != "damage":
        damage_type = None
    name = names.get(msg.get("actor_id")) or msg.get("speaker")
    row = staging_row(iso_seconds(msg.get("timestamp")), name, roll.get("formula"), extract_dice(roll),
                      roll.get("total"), category, suffix, msg, roll_label(msg),
                      skill=skill, ability=ability, roll_mode=roll_mode(roll),
                      target_value=target_ac(flags) if category == "attack" else None,
                      damage_type=damage_type, **spell)
    row["_origin"] = flags.get("originatingMessage") or msg.get("id")   #ties attack + damage of one cast
    row["_item_type"] = (flags.get("item") or {}).get("type")   #spell / feat / consumable / weapon; healing filter
    return row

#spell_level per row: base level from SPELL_LEVELS, raised when damage / healing dice show an upcast
#crit damage (attack in same cast kept a nat 20) has doubled dice -> halved before the check
#attack rows take the level found on their cast's damage row
#params:  rows (list[dict]) staging rows from parse_roll, edited in place;
#         rules_2014_before (str | None) "YYYY-MM-DD" cutoff for 2014 scaling
#output:  none; sets spell_level, logs upcast count
def set_spell_levels(rows: list, rules_2014_before: str = None):
    #casts whose attack kept a natural 20 -> damage dice doubled
    crits = {r["_origin"] for r in rows if r["category"] == "attack"
             and any(d["sides"] == 20 and d["kept"] and d["face"] == 20 for d in r["dice"])}
    cast_level, upcast = {}, 0
    for row in rows:
        if not row["is_spell"] or row["category"] not in ("damage", "healing"):
            continue
        table = spell_table(row, rules_2014_before)
        level = upcast_level(row, row["_origin"] in crits, table)
        row["spell_level"] = level
        if level is not None:
            cast_level[row["_origin"]] = max(level, cast_level.get(row["_origin"], 0))
            upcast += level > table[row["spell_name"].lower()][0]
    for row in rows:
        if row["is_spell"] and row["spell_level"] is None:
            base = spell_table(row, rules_2014_before).get((row["spell_name"] or "").lower())
            row["spell_level"] = cast_level.get(row["_origin"], base[0] if base else None)
    log.info("Spell levels set; %s damage / healing rolls upcast", upcast)

#--------------------------------------------------------------------------------------------------------------
#helper functions
#--------------------------------------------------------------------------------------------------------------

#actor id -> character name; short token names fold into the full name they start
#("Ivan" + "Ivan Maddock" -> "Ivan Maddock"), even when the token name is the more common one
#params:  messages (list[dict]) export messages
#output:  dict[str, str] actor_id -> name
def actor_names(messages: list) -> dict:
    counts = collections.defaultdict(collections.Counter)
    for msg in messages:
        if msg.get("actor_id") and msg.get("speaker") != "Dice":   #"Dice" = core dice tray speaker, not a name
            counts[msg["actor_id"]][msg.get("speaker")] += 1
    names = {}
    for actor, c in counts.items():
        #score each name by messages under it or under any shorter name it starts with
        score = {n: sum(k for m, k in c.items() if n.lower().startswith(m.lower())) for n in c}
        names[actor] = max(score, key=lambda n: (score[n], len(n)))   #ties -> longer name
    return names

#message -> (category, skill code, ability code); no flags + no initiative flavor -> custom
#params:  msg (dict) export message
#output:  tuple(str, str | None, str | None)
def classify(msg: dict) -> tuple:
    roll = (msg.get("system_flags") or {}).get("roll") or {}
    if INITIATIVE_FLAVOR.search(msg.get("flavor") or ""):
        return "initiative", None, "DEX"
    category = ROLL_TYPES.get(roll.get("type"), "custom")
    if roll.get("type") == "tool":   #"Thieves' Tools Check (Dexterity)" -> ability check, ability from flavor
        found = re.search(r"\((strength|dexterity|constitution|intelligence|wisdom|charisma)\)", msg.get("flavor") or "", re.I)
        return "ability_check", None, ABILITY_CODES[found.group(1).lower()] if found else None
    skill = SKILL_CODES.get(roll.get("skillId") or roll.get("skill"))
    ability = ABILITY_SHORT.get(roll.get("ability") or roll.get("abilityId"))   #key name varies by dnd5e version
    if skill and not ability:
        ability = SKILL_ABILITY[skill]
    if category == "initiative":
        ability = ability or "DEX"
    return category, skill, ability

#damage-flagged heals -> healing; dnd5e tags many heals roll.type "damage" with activity.type "heal"
#params:  flags (dict) system_flags; category (str) classify output; spell_name (str | None);
#         damage_type (str | None) roll damage type, if exported
#output:  str category
def heal_check(flags: dict, category: str, spell_name, damage_type=None) -> str:
    if category != "damage":
        return category
    if damage_type in ("Healing", "Temphp"):   #dnd5e damage types for heals / temp hp
        return "healing"
    if (flags.get("activity") or {}).get("type") == "heal":
        return "healing"
    if SPELL_EFFECTS.get((spell_name or "").lower()) == "healing":   #Cure Wounds with a "damage" activity
        return "healing"
    return category

#spell flags from item; name = flavor before " - " ("Fire Bolt - Attack Roll" -> "Fire Bolt")
#older dnd5e (pre activities) logs only roll.itemId, no item type -> known spell name from flavor counts too
#params:  msg (dict) export message
#output:  dict {is_spell (bool), spell_name (str | None), spell_level (None; set later by set_spell_levels)}
def spell_info(msg: dict) -> dict:
    flags = msg.get("system_flags") or {}
    item = flags.get("item") or {}
    name = re.split(r"\s+-\s+", msg.get("flavor") or "")[0].strip() or None   #text before first " - "
    known = (name or "").lower() in SPELL_LEVELS or (name or "").lower() in SPELL_EFFECTS
    has_item = item.get("type") or (flags.get("roll") or {}).get("itemId")   #rolled from a sheet item
    if item.get("type") == "spell" or (has_item and known):
        return {"is_spell": True, "spell_name": name, "spell_level": None}
    return {"is_spell": False, "spell_name": None, "spell_level": None}

#spell level table for a row: 2024 table, with 2014 entries swapped in for rolls before the cutoff
#params:  row (dict) staging row; rules_2014_before (str | None) "YYYY-MM-DD"
#output:  dict spell name -> (base level, base dice, dice per level, faces)
def spell_table(row: dict, rules_2014_before: str = None) -> dict:
    if rules_2014_before and (row["rolled_at"] or "") < rules_2014_before:   #iso strings compare as dates
        return {**SPELL_LEVELS, **SPELL_LEVELS_2014}   #2014 entries override
    return SPELL_LEVELS

#slot level from dice count: base + (count - base dice) / dice per level; count off-pattern -> base level
#params:  row (dict) spell damage / healing row; crit (bool) cast was a crit, dice doubled;
#         table (dict) spell_table output
#output:  int | None (None = spell not in table)
def upcast_level(row: dict, crit: bool, table: dict = SPELL_LEVELS):
    entry = table.get((row["spell_name"] or "").lower())
    if entry is None:
        return None
    base, base_dice, per_level, faces = entry
    if base_dice is None:
        return base
    count = sum(1 for d in row["dice"] if d["sides"] == faces)   #dice of the spell's own die size
    if crit:
        count //= 2
    extra = count - base_dice
    if extra < 0 or extra % per_level:   #fewer dice or odd count -> can't read a level, keep base
        return base
    return base + extra // per_level

#d20 term modifiers -> roll mode; kh / adv = advantage, kl / dis = disadvantage (dnd5e 5.x writes adv / dis)
#params:  roll (dict) one export roll
#output:  str 'normal' | 'advantage' | 'disadvantage'
def roll_mode(roll: dict) -> str:
    for term in roll.get("dice", []):
        if term.get("faces") != 20 or term.get("number", 1) < 2:
            continue
        mods = " ".join(term.get("modifiers") or []).lower()
        if re.search(r"\b(kh|adv)", mods):   #kh, kh1, adv
            return "advantage"
        if re.search(r"\b(kl|dis)", mods):
            return "disadvantage"
    return "normal"

#export dice terms -> flat staging dice list; dropped dice (active false) -> kept False
#params:  roll (dict) one export roll
#output:  list[dict] [{"sides": int, "face": int, "kept": bool}, ...]
def extract_dice(roll: dict) -> list:
    return [{"sides": term["faces"], "face": int(r["result"]), "kept": r.get("active", True)}
            for term in roll.get("dice", []) for r in term.get("results", [])]

#readable roll name: flavor with "(Advantage)" etc and html tags stripped
#params:  msg (dict) export message
#output:  str roll name, "" for plain /r rolls
def roll_label(msg: dict) -> str:
    label = re.sub(r"<[^>]+>", "", msg.get("flavor") or "")   #drop html tags
    if INITIATIVE_FLAVOR.search(label):   #"Ivan rolls for Initiative!" -> "Initiative"
        return "Initiative"
    label = re.sub(r"\s*\((advantage|disadvantage|normal)\)\s*$", "", label, flags=re.IGNORECASE)
    return label.strip()

#target AC for an attack; only when exactly one target (multi-target -> no single AC)
#params:  flags (dict) system_flags
#output:  int | None
def target_ac(flags: dict):
    targets = flags.get("targets") or []
    if len(targets) == 1 and isinstance(targets[0].get("ac"), (int, float)):
        return int(targets[0]["ac"])
    return None

#"2026-01-11T22:09:29.892Z" -> "2026-01-11T22:09:29+00:00" (same shape as Roll20 rows)
#params:  stamp (str | None) iso timestamp from export
#output:  str | None
def iso_seconds(stamp):
    if not stamp:
        return None
    parsed = datetime.datetime.fromisoformat(stamp.replace("Z", "+00:00"))   #older pythons reject "Z"
    return parsed.astimezone(datetime.timezone.utc).isoformat(timespec="seconds")


if __name__ == "__main__":
    main()
