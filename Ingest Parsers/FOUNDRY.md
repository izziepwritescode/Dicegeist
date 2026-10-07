# foundry_parser.py

## Usage
```
python foundry_parser.py --input ../samples/foundry/fananggar_rolllog.json --list
python foundry_parser.py --input ../samples/foundry/fananggar_rolllog.json --output ../imports/fananggar_ivan_staging.csv --import-id 3
```
| flag | does |
|---|---|
| `--list` | character + roll names with counts, writes nothing |
| `--character "Ivan Maddock"` | keep one character; repeat for more |
| `--roll stealth` | keep rolls whose name or category contains this |
| `--import-id N` | adds `import_id` column -> csv uploads straight to `import_staging` |
| `--exclude-healing` | drop all healing rows (spell healing kept by default; foundry tags heals reliably) |
| `--keep-potion-healing` | keep healing from potions / consumables (dropped by default, Izzie 2026-10-06) |
| `--rules-2014-before 2025-06-01` | rolls before the date read spell dice with 2014 scaling (`SPELL_LEVELS_2014`); for characters rebuilt from a 2014 sheet |

input = file from `foundry/foundry_roll_export.js` (player console export). output = same `import_staging` rows as `roll20_parser.py`.

## Files
- `foundry_parser.py` -> foundry json -> rows
- `staging_common.py` -> shared: `ABILITY_CODES`, `SKILL_ABILITY`, `SPELL_EFFECTS`, `staging_row`, `filter_rows`, `match_character`, `list_names`, `write_output`
- `pending/roll20_shared_module.diff` -> change for `roll20_parser.py` to import the shared module (owned by the Roll20 thread; not applied). verified: identical Roll20 output except 2 rows gaining a damage type from new `SPELL_EFFECTS` entries (Guiding Bolt, Fireball).

## Mapping
| staging column | foundry source |
|---|---|
| `roller_name` | per `actor_id`, short token names fold into the full name they start ("Idris" + "Idris Ildroun" -> "Idris Ildroun"); two actors with the same name -> one character; no actor -> speaker |
| `category` | `system_flags.roll.type` via `ROLL_TYPES`; initiative from flavor "... rolls for Initiative!"; no flags -> `custom` |
| healing | `activity.type == "heal"`, roll damage type healing / temphp, or `SPELL_EFFECTS` says healing -> `healing`; potion (consumable item) healing dropped; spell + feat healing (Spellfire Burst) kept |
| `skill` / `ability` | `roll.skillId` ("ins") via `SKILL_CODES`; `roll.ability` ("wis") via `ABILITY_SHORT`; skill without ability -> `SKILL_ABILITY` default |
| `roll_mode` | d20 term with 2+ dice: `kh` / `adv` -> advantage, `kl` / `dis` -> disadvantage |
| `dice` | each die -> `{sides, face, kept}`; `active: false` -> `kept: false` |
| `modifier` / `total` | total - kept dice; rounded (drops initiative tiebreak 19.16 -> 19) |
| `target_value` | attacks with exactly one target -> its AC |
| `is_spell` / `spell_name` | `item.type == "spell"`, or older dnd5e logs (only `roll.itemId`) with a known spell name; name = flavor before " - " |
| `damage_type` | roll `damage_type` (exports after 2026-10-06) else `SPELL_EFFECTS` for spells |
| `spell_level` | `SPELL_LEVELS` base level (cantrip 0); damage / healing dice count above base -> upcast level (Cure Wounds 4d8 -> 2); crit casts halve dice first; attack rows take their cast's level via `originatingMessage`; unlisted spell -> null |
| `source_message_id` | foundry message id; `id:n` when one message has several rolls |

sample result (Ivan Maddock): 519 messages -> 515 rows, 0 errors, 49 healing kept (38 spell, 11 Spellfire Burst), 5 potion healing dropped. Cure Wounds levels 1 / 2 / 3 / 4 = 11 / 9 / 7 / 1 casts. skill 108, attack 98, custom 96, damage 75, save 42, initiative 27, hit dice 12, ability 4, death 4. advantage 41, disadvantage 6. 72 attacks with target AC.

## Code breakdown
- `actor_names` -> per actor id, count speaker names, keep the most common. Like `GROUP BY actor_id` then pick the top `COUNT(*)` name.
- `classify` -> dict lookups replace the Roll20 regex work: `ROLL_TYPES.get(roll.get("type"), "custom")` = `COALESCE(lookup, 'custom')`.
- `re.split(r"\s+-\s+", flavor)[0]` -> split on " - " (spaces either side), take first piece: "Fire Bolt - Attack Roll" -> "Fire Bolt".
- `re.search(r"\b(kh|adv)", mods)` -> modifier text starts with kh or adv (kh, kh1, adv).
- `extract_dice` -> nested list comprehension = two loops (terms, then dice in each term) flattened into one list.
- `(roll.get("damage_type") or "").title() or None` -> missing -> "" -> None; "fire" -> "Fire".
- `upcast_level` -> count the dice matching the spell's die size, subtract the base count, divide by dice per level. Cure Wounds `(1, 2, 2, 8)`: 6d8 -> (6 - 2) / 2 = 2 extra -> level 3. remainder or negative -> base level. like `base + (n - base_n) DIV per` in MySQL.
- `set_spell_levels` -> first pass builds a set of crit casts (attack kept a nat 20), second sets levels on damage / healing rows, third copies each cast's level onto its attack row (attack d20 shows no slot).

## Not handled
- GM "Export Chat Log" .txt (no ids, no per-die detail) -> not supported; ask if needed.
- blind rolls -> exported without values, skipped (count logged).
- Aid (`NOT_HEALING`) -> raises max HP, no dice, can be negative -> dropped.
- tool checks (`roll.type == "tool"`) -> `ability_check`, ability from flavor "(Dexterity)".
- stat generation pools (`{4d6d1,...}`) -> one `custom` row with all 24 dice.
