# Parsers: technical reference

One file per platform. Each turns a saved log into `import_staging` rows (format: [docs/schema/README.md](../docs/schema/README.md) "Staging row format"). Loader `load_import` is shared; only parsers are per platform.

| File | Input | Status |
|---|---|---|
| [roll20_parser.py](roll20_parser.py) | Roll20 Chat Archive `.html` ("Show on One Page" + Ctrl+S) | Done; tested on Out of the Abyss archive |
| [foundry_parser.py](foundry_parser.py) | Foundry `.txt` chat export | Done; reference: [FOUNDRY.md](FOUNDRY.md) |
| [staging_common.py](staging_common.py) | (imported by both) | Shared lookups (`ABILITY_CODES`, `SKILL_ABILITY`, `SPELL_EFFECTS`) + `filter_rows`, `match_character`, `list_names`, `write_output` |

Usage: `python roll20_parser.py --input <archive>.html --output <name>_staging.json` (or `.csv`). Python 3.11+, stdlib only. Keep `staging_common.py` in the same folder.

| Option | Function |
|---|---|
| `--list` | Print character names + roll names with counts; writes nothing. Combine with filters to preview. |
| `--character NAME` | Keep only this character. Repeat for more. Case-insensitive; also matches `/` parts (`Dice / Lazlo` -> Lazlo, renamed). |
| `--roll TEXT` | Keep rolls whose name or category contains TEXT (`stealth`, `eldritch`, `attack`, `saving`). Repeat for more. |
| `--import-id N` | Adds `import_id` column = `imports.id` row -> CSV uploads straight into `import_staging`. |
| `--smite NAME` | Paladin: d8-only `/roll`s (or sheet macro of d8s) within 60 s after NAME's weapon attack / damage, or after the previous smite roll -> damage, `Divine Smite`, Radiant, `is_spell` true. Repeat for more. |
| `--review FILE.csv` | Lists each `/roll` linked to a spell card (time, character, spell, seconds after card, total) for checking before upload. |

Workflow: `--list` -> pick names -> same command with `--character` / `--roll` + `--output`. Character and roll filters combine as AND; repeats of one option combine as OR.

## Outline

- Roll20 source format
- Message -> row mapping
- Filter options
- Code breakdown
- Test result
- Known limits

---

## Roll20 source format

- Saved page has one line `var msgdata = "<base64>";`. Base64 -> JSON list of chunks, each `{message_id: message}`.
- Visible HTML shows only part of the chat (~2,200 of 9,778 in sample); parse the JSON, never the HTML.
- Message keys used: `type`, `who` (player display name), `playerid`, `content`, `inlinerolls`, `rolltemplate`, `origRoll`, `.priority` (epoch ms = time).
- `content` of a sheet roll = template text: `{{rname=^{stealth-u}}} {{r1=$[[0]]}} {{r2=$[[1]]}} {{normal=1}} charname=Svarg`. `$[[n]]` = pointer to `inlinerolls[n]`.
- Each inline roll: `expression` (formula), `results.total`, `results.rolls` -> parts; type `R` part = dice (`sides`, `results[].v` = face, `d: true` = dropped).

## Message -> row mapping

| Message shape | Rows | Category |
|---|---|---|
| `simple` / `npc` template (checks, saves, init) | 1 per r1/r2 pair | from `rname`: skill_check, ability_check, saving_throw, initiative, death_save, hit_dice |
| `atk` / `npcatk` template | 1 per r1/r2 pair | attack |
| `dmg` / `npcdmg` template, damage fields | 1 per dmg1 / dmg2 / crit1 / crit2 / ... with dice | damage |
| `mancerhproll` | 1 | custom (level-up HP) |
| `/roll`, `/gmroll` (`rollresult`, `gmrollresult`) | 1 | custom |
| `[[1d20]]` typed in chat, `default` or other unknown template | 1 per inline roll | custom |
| spell cards, traits, plain chat | 0 | n/a |

- Roller: `charname` -> `name` (NPC sheet) -> `who`. `npcdmg` has no name -> last NPC rolled by same player.
- Roll mode: `{{advantage=1}}` -> higher of r1/r2 kept; `{{disadvantage=1}}` -> lower kept; else normal, r1 kept. Unkept d20 still stored, `kept: false` (feeds `die_cursedness_checks` view).
- `source_message_id` = `<message id>:<field>` (e.g. `-NdmOLH6bKoHi2hOMkBK:r1`). One message -> several rows, each id unique, stable across re-parse.
- `raw_text` = full message JSON minus avatar -> re-parse possible.
- Spell fields (new staging columns, pending schema): `is_spell`, `spell_name`, `spell_level` (0 = cantrip), `damage_type`.
  - Sheet attacks / damage: spell when `spelllevel` set or `spelldesc_link` present. Name = `rname`.
  - Damage type per field: dmg1 / crit1 / hldmg -> `dmg1type`; dmg2 / crit2 -> `dmg2type`; global -> `globaldamagetype`. Type `Healing` -> category `healing`, type null.
  - Spell cards (`spell`, `spelloutput`) have no dice -> no row. A plain `/roll` after a card -> that spell's damage / healing when: same player, within 120 s, no sheet roll in between, no d20. Roller = card's character. Damage type from `SPELL_EFFECTS` dict (cards carry none); unlisted spell -> type null.

---

## Code breakdown

### load_messages

Params: `path (str)` saved .html. Output: `list[dict]` messages, oldest first.

1. `re.search(r'var msgdata = "([^"]*)";', html)`: regex; `([^"]*)` captures everything up to next quote = base64 text. Same idea as M `Text.BetweenDelimiters`.
2. `base64.b64decode(...)` -> bytes; `json.loads` -> Python lists/dicts (M: `Json.Document`).
3. Nested `for` flattens chunk dicts into one list; message id copied into `_id`.
4. `sort(key=lambda m: m.get(".priority", 0))`: sort by time. `lambda` = inline one-line function.

### parse_messages

Params: `messages (list[dict])`. Output: `list[dict]` staging rows.

1. `if / elif / else` routes by shape: plain roll, template, loose inline rolls.
2. `try / except`: one bad message -> row with `parse_error` text; rest keep parsing. Loader holds those rows as unparsed.
3. `last_npc` dict: memory across messages, playerid -> NPC name, for `npcdmg`.
4. `enumerate(rows, start=1)` -> `line_number` 1..n.

### filter_rows / match_character / list_names

- `filter_rows(rows, characters, rolls)`: params `rows (list[dict])`, `characters (list[str])`, `rolls (list[str])`; output `list[dict]` kept rows, renumbered. Empty list -> no filter on that field (= SQL `WHERE` clause left out).
- `any(r.lower() in haystack for r in rolls)`: true if any typed text appears in "roll name + category" (= SQL `OR` of `LIKE '%x%'`).
- `match_character`: `re.split(r"\s*/+\s*", roller)` splits on `/` or `//` with spaces -> `["Dice", "Lazlo"]`; exact part match, not substring, so `Troglodyte` doesn't pull in `Troglodyte Champion of Laogzed`. Returns log spelling.
- `list_names`: `collections.Counter` = `GROUP BY name ... COUNT(*)`; `most_common()` = `ORDER BY count DESC`. Tab-separated -> pastes into Excel as 2 columns.
- `roll_label`: `^{stealth-u}` -> `Stealth`, `[Shortsword](~...)` -> `Shortsword`. Stored as `_roll_name`; `_` keys dropped by `write_output` (not a staging column).

### link_spell_roll / spell_card / spell_info

- `last_card` dict in `parse_messages`: playerid -> last spell card. Any other sheet roll from that player removes it (`pop`) -> link only when nothing happened in between.
- `link_spell_roll`: `any(d["sides"] == 20 ...)` = has a d20 -> a check, not damage -> skip. `row.update({...})` overwrites several columns at once (= SQL `UPDATE ... SET a=.., b=..`).
- `spell_card`: `"conjuration 3".split()[-1]` -> last word `"3"`; `"cantrip"` -> 0.
- `SPELL_EFFECTS.get(name.lower())` = lookup (Excel `XLOOKUP` with blank default).
- `write_review`: linked rows only -> CSV; `seconds_after_card` = gap check.

### tag_smites

- Runs after `parse_messages`, before filters. `anchor` dict: playerid -> (time, paladin) of last weapon hit or smite roll.
- `all(d["sides"] == 8 for d in row["dice"])` = every die is a d8 (Excel: `COUNTIF(sides, "<>8") = 0`).
- Chain: each tagged smite resets the clock -> smite + undead bonus d8, or several hits in a row, all caught. Any other roll -> `anchor.pop` ends it.
- Window 60 s (Izzie, 2026-10-06; tested 30 s = 62 rolls / 556, 120 s = 73 / 734). Vasha (Curse of Strahd): 70 of 77 d8-only rolls tagged, 673 radiant.

### parse_template_message / parse_d20_pair

1. `template_fields` -> dict of `{{key=value}}`; `$[[n]]` values -> int index.
2. `inline_roll(rolls, fields.get("r1"))` -> roll dict or `None`. `None` = missing (SQL NULL).
3. Mode flags -> which of r1 / r2 is kept. Tuple swap `kept, other = (r2, r1) if use_r2 else (r1, r2)` = SQL `CASE` on two columns at once.
4. `classify_rname`: `^{wisdom-save-u}` -> saving_throw / WIS; `^{stealth-u}` -> skill_check / stealth / DEX.

### parse_damage_fields / field_rows

- `[f for f in DAMAGE_FIELDS if f in fields]`: list comprehension = filter; keeps damage fields present in this message.
- Fields with zero dice (`"0"` placeholders the sheet always sends) skipped.

### template_fields

- `\{\{(\w+)=(.*?)\}\}(?=\s|$)`: `\w+` key; `.*?` lazy value (shortest match); `(?=\s|$)` lookahead, `}}` must be followed by space or end. Needed because values themselves end in `}` (`^{stealth-u}}}`).
- `charname=X` at end without braces (PC sheets) caught by second regex.

### extract_dice

Params: `result (dict)`. Output: `list[dict]` `{"sides", "face", "kept"}`.

- Walks `rolls` parts; type `R` = dice. Groups (`{1d20, 1d20}kh1`) nest parts -> function calls itself (recursion).
- `kept = not die.get("d")`: `d: true` = dropped by `kh` / `kl`.
- Fate dice (`dF`, faces -1..1) skipped; schema requires face 1..sides.

### make_row

- `modifier = total - sum(kept faces)`. Initiative tiebreak decimals (`+4.18`) rounded; `total` column is integer.
- `datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat()` -> `2023-09-08T01:26:02+00:00`.
- f-string `f"{msg['_id']}:{suffix}"` = `CONCAT(id, ':', field)`.

### write_output

- `.csv`: `csv.DictWriter`, `dice` written as JSON text (Excel / Power Query: `Json.Document` on that column). `.json`: full list.

---

## Test result

Local Postgres 16 + stub auth, schema 001 after table merge (9 tables, `skills_abilities`). Sample: `samples/roll20/outoftheabyss_rolllog.html`.

- 9,778 messages -> 9,281 rows, 0 parse errors.
- `load_import`: 9,281 loaded, 0 skipped, 0 unparsed; re-run -> 0 loaded (dedupe on message id works). 15,033 dice. 730 rolls with skill code, 2,529 with ability code.
- Rows: attack 2,884; damage 2,775; custom 983; ability_check 789; skill_check 730; initiative 684; saving_throw 326; hit_dice 71; death_save 39.
- Advantage 117, disadvantage 34.

## Known limits

- "Always roll advantage" sheets show r1 + r2 with no flag -> treated as normal, r1 kept. Matches sheet behavior (player picks at table); true choice not recorded.
- GM's own plain `/roll`s file under "Syrta (GM)" -> stray character; fix with `merge_character` or aliases.
- `target_value` always null; Roll20 sheets don't record DC / AC.
- Non-5e-OGL templates -> `custom` only; skill / attack not detected. Add field mapping per sheet if needed.
