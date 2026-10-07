# shared pieces for every platform parser -> import_staging rows (see schema/README.md "Staging row format")
# Usage Syntax: imported only -> from staging_common import write_output, filter_rows, ...   (no CLI)
#--------------------------------------------------------------------------------------------------------------
# Outline
#   Lookup dicts
#     ABILITY_CODES / SKILL_ABILITY / SPELL_EFFECTS
#   Row builder
#     staging_row
#   Filter + preview (--character / --roll / --list)
#     filter_rows
#     match_character
#     list_names
#   Output
#     write_output
#--------------------------------------------------------------------------------------------------------------

import collections #Counter -> name counts for --list
import csv
import json
import logging #shared log format across parsers
import os
import re

#init logging for user viewing
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
log = logging.getLogger(__name__)

#--------------------------------------------------------------------------------------------------------------
#lookup dicts
#--------------------------------------------------------------------------------------------------------------

#sheet ability name -> skills_abilities.code (kind ability)
ABILITY_CODES = {
    "strength": "STR", "dexterity": "DEX", "constitution": "CON",
    "intelligence": "INT", "wisdom": "WIS", "charisma": "CHA",
}

#skill code -> its ability code (matches schema skills_abilities rows)
SKILL_ABILITY = {
    "acrobatics": "DEX", "animal_handling": "WIS", "arcana": "INT", "athletics": "STR",
    "deception": "CHA", "history": "INT", "insight": "WIS", "intimidation": "CHA",
    "investigation": "INT", "medicine": "WIS", "nature": "INT", "perception": "WIS",
    "performance": "CHA", "persuasion": "CHA", "religion": "INT", "sleight_of_hand": "DEX",
    "stealth": "DEX", "survival": "WIS",
}

#spell name -> damage type, or "healing"; fallback when the log carries no damage type
#unlisted spell -> damage, type null. Add spells as characters use them
SPELL_EFFECTS = {
    "arms of hadar": "Necrotic", "blight": "Necrotic", "eldritch blast": "Force",
    "hunger of hadar": "Cold", "phantasmal killer": "Psychic", "shatter": "Thunder",
    "thunderous smite": "Thunder", "wrathful smite": "Psychic", "divine smite": "Radiant",
    "cure wounds": "healing", "healing word": "healing", "aura of vitality": "healing",
    "false life": "healing",   #temp HP, counted as healing
    "chill touch": "Necrotic", "fire bolt": "Fire", "fireball": "Fire", "guiding bolt": "Radiant",
    "scorching ray": "Fire", "shocking grasp": "Lightning", "thorn whip": "Piercing", "witch bolt": "Lightning",
    "sacred flame": "Radiant", "toll the dead": "Necrotic", "moonbeam": "Radiant", "spiritual weapon": "Force",
    "spirit guardians": "Radiant",   #radiant for good / neutral casters, necrotic for evil
    "mass healing word": "healing", "inflict wounds": "Necrotic",
}

#--------------------------------------------------------------------------------------------------------------
#row builder
#--------------------------------------------------------------------------------------------------------------

#one staging row in column order; modifier = total - kept dice sum; totals rounded (init tiebreak decimals)
#params:  rolled_at (str | None) iso utc; name (str | None) roller; formula (str | None);
#         dice (list[dict]) [{"sides", "face", "kept"}]; total (float | None); category (str | None);
#         source_message_id (str | None); raw (dict) original message, stored as raw_text;
#         roll_name (str) label for --roll / --list; rest optional staging columns
#output:  dict staging row (line_number set later by the parser)
def staging_row(rolled_at, name, formula, dice, total, category, source_message_id, raw, roll_name="",
                skill=None, ability=None, roll_mode="normal", target_value=None, parse_error=None,
                is_spell=False, spell_name=None, spell_level=None, damage_type=None) -> dict:
    kept_sum = sum(d["face"] for d in dice if d["kept"])
    return {
        "line_number": None,
        "rolled_at": rolled_at,
        "roller_name": name,
        "formula": formula,
        "dice": dice,
        "modifier": round(total - kept_sum) if total is not None else None,
        "total": round(total) if total is not None else None,
        "category": category,
        "skill": skill,
        "ability": ability,
        "roll_mode": roll_mode,
        "target_value": target_value,
        "is_spell": is_spell,
        "spell_name": spell_name,
        "spell_level": spell_level,
        "damage_type": damage_type,
        "source_message_id": source_message_id,
        "raw_text": json.dumps(raw, ensure_ascii=False),
        "parse_error": parse_error,
        "_roll_name": roll_name,   #filter / --list only; not a staging column, dropped on write
    }

#--------------------------------------------------------------------------------------------------------------
#filter + preview operations
#--------------------------------------------------------------------------------------------------------------

#keep rows matching any --character AND any --roll; empty list = no filter on that field; renumbers rows
#params:  rows (list[dict]) parsed rows; characters (list[str]); rolls (list[str])
#output:  list[dict] kept rows; matched character renamed to the matched name (e.g. "Dice / Lazlo" -> "Lazlo")
def filter_rows(rows: list, characters: list, rolls: list) -> list:
    if not characters and not rolls:
        return rows
    kept = []
    for row in rows:
        if characters:
            name = match_character(row["roller_name"], characters)
            if name is None:
                continue
            row["roller_name"] = name
        if rolls:
            haystack = f"{row['_roll_name']} {row['category']}".lower()
            if not any(r.lower() in haystack for r in rolls):
                continue
        kept.append(row)
    for i, row in enumerate(kept, start=1):
        row["line_number"] = i
    log.info("Filter kept %s of %s rows (character=%s, roll=%s)", len(kept), len(rows), characters, rolls)
    return kept

#roller name vs wanted names; case-insensitive; "/"-separated parts checked too ("Dice / Lazlo" has part "Lazlo")
#params:  roller (str | None) row roller_name; wanted (list[str]) --character values
#output:  str matching name as spelled in the log (any typed casing works), or None
def match_character(roller, wanted: list):
    if not roller:
        return None
    parts = [roller] + [p for p in re.split(r"\s*/+\s*", roller) if p]   #split on "/" with any spaces around it
    for name in wanted:
        for part in parts:
            if part.strip().lower() == name.strip().lower():
                return part.strip()
    return None

#print character names and roll names with counts, most common first; tab-separated (pastes into Excel)
#params:  rows (list[dict]) parsed (optionally filtered) rows
#output:  none; prints two tables
def list_names(rows: list):
    characters = collections.Counter(r["roller_name"] for r in rows)
    roll_names = collections.Counter(r["_roll_name"] or f"({r['category']}, no name)" for r in rows)
    print("\ncharacter\trolls")
    for name, n in characters.most_common():
        print(f"{name}\t{n}")
    print("\nroll name\trolls")
    for name, n in roll_names.most_common():
        print(f"{name}\t{n}")

#--------------------------------------------------------------------------------------------------------------
#output
#--------------------------------------------------------------------------------------------------------------

#write rows to .json (list) or .csv (dice as JSON text); internal "_" keys dropped
#params:  rows (list[dict]) staging rows; path (str) output file; import_id (int | None) adds import_id column
#output:  none; writes file
def write_output(rows: list, path: str, import_id: int = None):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    if not rows:
        log.warning("No rows to write")
        return
    rows = [{**({"import_id": import_id} if import_id else {}),
             **{k: v for k, v in r.items() if not k.startswith("_")}} for r in rows]
    if path.lower().endswith(".csv"):
        with open(path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            for row in rows:
                writer.writerow(dict(row, dice=json.dumps(row["dice"])))
    else:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, indent=1)
    log.info("Wrote %s rows to %s", len(rows), path)
