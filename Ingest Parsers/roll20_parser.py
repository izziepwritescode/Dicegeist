# Roll20 Chat Archive parser -> import_staging rows (see schema/README.md "Staging row format")
# Usage Syntax: python roll20_parser.py --input samples/roll20/<file>.html --output out/<file>_staging.json
#   See names first:   python roll20_parser.py --input <file>.html --list
#   Keep some only:    ... --character Lazlo --character Nami --roll stealth --roll attack
#   Upload-ready CSV:  ... --output <file>_staging.csv --import-id 1   (matches imports.id row)
# Output ext .json -> JSON list; .csv -> flat table (dice as JSON text). Stdlib only, no installs.

#--------------------------------------------------------------------------------------------------------------
# Outline
#   Load data
#     load_messages
#   Main / mother parse function
#     main
#     parse_messages
#   Filter + preview (--character / --roll / --list)
#     filter_rows
#     match_character
#     list_names
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
#     extract_dice
#     make_row
#     write_output
#   Lookup dicts
#     ABILITY_CODES / SKILL_ABILITY / D20_TEMPLATES / FIELD_TEMPLATES / DAMAGE_FIELDS
#--------------------------------------------------------------------------------------------------------------

import argparse #parse command line arguments to call script
import base64 #msgdata line is base64 text
import collections #Counter -> name counts for --list
import csv
import datetime
import json
import logging #adds extra reporting for debugging (timestamps, etc)
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

#templates holding a d20 pair in r1/r2; value = default category when rname gives none
D20_TEMPLATES = {"simple": "custom", "npc": "custom", "atk": "attack", "npcatk": "attack"}

#templates parsed field by field; any other template -> every inline roll as 'custom'
FIELD_TEMPLATES = {"simple", "npc", "atk", "npcatk", "dmg", "npcdmg", "dmgaction", "mancerhproll"}

#template fields holding a damage roll (5e OGL sheet). crit = extra crit dice, own row
DAMAGE_FIELDS = ["dmg1", "dmg2", "crit1", "crit2", "hldmg", "globaldamage", "globaldamagecrit"]

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
    args = parser.parse_args()

    messages = load_messages(args.input)
    rows = filter_rows(parse_messages(messages), args.character, args.roll)
    if args.list:
        list_names(rows)
        return
    if not args.output:
        parser.error("--output is required unless --list is used")
    write_output(rows, args.output, args.import_id)

#route each message to its parser; collect staging rows; number them
#params:  messages (list[dict]) output of load_messages
#output:  list[dict] staging rows, keys = import_staging columns
def parse_messages(messages: list) -> list:
    rows = []
    last_npc = {}   #playerid -> last NPC name; npcdmg messages carry no name
    for msg in messages:
        try:
            if msg.get("type") in ("rollresult", "gmrollresult"):
                new_rows = parse_plain_roll(msg)
            elif msg.get("rolltemplate"):
                new_rows = parse_template_message(msg, last_npc)
            else:
                new_rows = parse_loose_inline_rolls(msg)
        except Exception as err:   #keep going; bad message -> parse_error row
            new_rows = [make_row(msg, "parse_error", None, None, [], None, None,
                                 parse_error=f"{type(err).__name__}: {err}")]
        rows.extend(new_rows)

    for i, row in enumerate(rows, start=1):
        row["line_number"] = i
    errors = sum(1 for r in rows if r["parse_error"])
    log.info("Parsed %s roll rows (%s with parse_error)", len(rows), errors)
    return rows

#--------------------------------------------------------------------------------------------------------------
#filter + preview operations
#--------------------------------------------------------------------------------------------------------------

#keep rows matching any --character AND any --roll; empty list = no filter on that field; renumbers rows
#params:  rows (list[dict]) parse_messages output; characters (list[str]); rolls (list[str])
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
    parts = [roller] + [p for p in re.split(r"\s*/+\s*", roller) if p]
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
                    skill=skill, ability=ability, roll_mode=mode)

#damage fields (dmg1, dmg2, crit1, ...) -> one row each; zero-dice fields skipped
#params:  msg (dict) message; fields (dict) template_fields output; name (str) roller
#output:  list[dict] staging rows, category 'damage'
def parse_damage_fields(msg: dict, fields: dict, name: str) -> list:
    present = [f for f in DAMAGE_FIELDS if f in fields]
    return field_rows(msg, fields, name, present, "damage")

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
#         skill / ability / roll_mode / parse_error (str | None) optional
#output:  dict staging row (line_number set later by parse_messages)
def make_row(msg, suffix, name, formula, dice, total, category,
             skill=None, ability=None, roll_mode="normal", parse_error=None) -> dict:
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
        "source_message_id": f"{msg['_id']}:{suffix}" if suffix else msg.get("_id"),
        "raw_text": json.dumps(raw, ensure_ascii=False),
        "parse_error": parse_error,
        "_roll_name": roll_label(msg),   #filter / --list only; not a staging column, dropped on write
    }

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


if __name__ == "__main__":
    main()
