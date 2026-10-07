# hit inference test: did damage follow the attack?

## Usage
```
python3 hit_inference_test.py                 # slider AC 14, writes csvs next to the script
python3 hit_inference_test.py --slider-ac 15
```
Reads raw logs in `samples/` + Roll20 staging csvs in `imports/`. Also writes `sql/02_load_attack_outcomes.sql` (load file for the live table).

## Live (applied 2026-10-07, Izzie chose "Build it")
- `public.attack_outcomes` - one row per attack with damage evidence: `inferred_hit`, `method` (`roll20_group` / `foundry_card`), `group_size`, `damage_rolls`, `hand_rolls`, `rule_version`. RLS: read = whoever can read the attack row; write = its owner. 657 rows loaded (all attacks of Lazlo, Vasha, Ivan, Idris).
- `reporting.rolls_fact` - 3 columns appended: `inferred_hit`, `hit_basis` (`logged AC` / `damage evidence` / `slider`), `attack_hit` (logged AC result, else inferred_hit, else null -> slider).
- Power BI edits: `powerbi_attack_hit_changes.md` (Attack Hits + Attack AC Note, Power Query types).

| character | basis | hit % (slider AC 14 before) |
|---|---|---|
| Lazlo | damage 288 | 69.8 (77.1) |
| Vasha | damage 221 | 71.9 (79.6) |
| Ivan Maddock | logged AC 72, damage 26 | 76.5 (86.7) |
| Idris Ildroun | logged AC 19, damage 31 | 62.0 (66.0) |

New import -> re-run the script (add the character to `SOURCES`), then run `sql/02_load_attack_outcomes.sql` in the SQL Editor. Attacks with no row stay on the slider.

sql: table + RLS = `supabase/migrations/20261007142236_attack_outcomes.sql`, view = `supabase/migrations/20261007142654_reporting_attack_hit.sql`, rows = `sql/02_load_attack_outcomes.sql`.

Paths: `SOURCES` points at the project file share (`/mnt/project-files/samples`, `imports`); raw logs are not in the repo. Parser import looks in `Ingest Parsers/` (repo) first, then `/mnt/project-files/parsers`.

Outputs:
- `summary.csv` - one row per character, all rates below
- `attacks_all.csv` - one row per attack: d20 face, total, logged AC (Foundry), inferred hit
- `roll20_edge_cases.csv` - Roll20 group counts per edge case

## Result
| | Lazlo (R20) | Vasha (R20) | Ivan (Foundry) | Idris (Foundry) |
|---|---|---|---|---|
| attacks | 288 | 221 | 98 | 50 |
| literal rule hit % (next roll = same damage) | 43.8 | 47.1 | 67.3 | 62.0 |
| literal rule: nat 20 counted as hit % | 45.5 | 22.2 | 71.4 | 100 |
| grouped rule hit % | 69.8 | 71.9 | 70.4 | 62.0 |
| grouped rule: nat 20 hit % / nat 1 hit % | 100 / 6.2 | 100 / 0 | 85.7 / 0 | 100 / 0 |
| current dashboard hit % (logged AC, else slider 14) | 77.1 | 79.6 | 86.7 | 66.0 |
| agreement with dashboard % | 81.6 | 87.8 | 83.7 | 96.0 |
| agreement with logged AC % | n/a | n/a | 91.7 (66/72) | 100 (19/19) |
| single AC that best fits inferred hits | 15 | 14 | 15 | 14 |

Verdict:
- Roll20 (Lazlo, Vasha): viable with the grouped rule, not the literal one.
- Foundry: viable; use the usage-card link (`originatingMessage`) instead of "next roll". Logged AC still wins where present.
- Roll20 characters on the attack+damage template (Jaxi, Master H, Neven Sterling): not viable, damage rolls every time.

## Rules tested
- literal: attack -> this character's very next roll is damage for the same weapon / spell -> hit, else miss.
- grouped: same-name attacks rolled back to back form a group (multiattack, Eldritch Blast beams). Damage rolls for that name after the group, before any other roll from the character, within 5 min, = hits in the group. Hand-typed damage dice (crit dice, smite d8s) count as evidence when there are more of them than sheet damage rolls. Hits go to the best rolls in the group (nat 20 first, nat 1 last, then total).
- Foundry: same, but a damage roll belongs to an attack when both carry the same usage card id (`originatingMessage`), so ordering does not matter.
- dashboard: nat 20 hit, nat 1 miss, else total >= AC (logged AC, else slider). Same as `[Attack Hits]` in `powerbi/04_measures.dax`.

## Edge cases
| case | finding |
|---|---|
| Roll20 attack+damage template (`atkdmg`) | Lazlo, Vasha: 0 of 509 attacks. Curse of Strahd: Jaxi 376/377, Master H 148/148, Neven Sterling 141/141 use it -> damage shows on every attack, method fails for them. |
| Foundry auto-damage | none. Fastest damage roll 4.8 s after its attack; all clicked by hand. A module like Midi-QOL would break the literal rule; the card link would still work. |
| multiattack | main reason the literal rule fails. Lazlo 237/288 attacks, Vasha 152/221 sit in 2+ attack groups rolled A A D D. Foundry: Scorching Ray (3 rays/card), 14 Ivan + 9 Idris attacks. |
| crits | Roll20: neither player uses the sheet's crit damage. Crit dice are typed by hand (2d8, 2d10) or the damage button is clicked twice (Vasha, 4 groups). Sheet damage only -> nat 20 counted as hit 81.8% (Lazlo), 61.1% (Vasha); with hand dice -> 100%. Foundry: Ivan 6/7 nat 20s rolled damage (Shocking Grasp 2026-01-25 did not). |
| smite | Vasha's Divine Smite d8s follow hits. Counted as hit evidence. 13 Vasha groups / 14 Lazlo groups had hand dice as the only (or extra) evidence. Thunderous Smite and Hunter's Mark damage have no own attack -> unmatched. |
| save spells | no attack roll -> nothing to infer. Damage stays unmatched (Lazlo Arms of Hadar by hand, Ivan 4 and Idris 64 save-activity damage rolls). Save pass rate still needs the DC slider. |
| damage later / interleaved | rare. Roll20: other players' rolls between attack and damage in 4 (Lazlo) and 2 (Vasha) groups, handled since only own rolls are read. Damage >60 s after: 1 and 4 groups. Foundry: damage after a later attack 2 (Ivan), 3 (Idris), caught by card link, missed by the literal rule. |
| hits with no damage rolled | method's blind spot (target dropped, DM narrates, damage applied elsewhere). Ivan: 6 attacks beat the logged AC with no damage. 2026-05-24 session: 9 Fire Bolts (totals up to 26), 1 damage roll. |

## Code breakdown
- `template_events` - walks every Roll20 message once. Finds the player id that rolls the character's sheet (`.mode()` = most common, like MODE in Excel), so hand-typed `/r 2d8` rolls from that player count as the character's. Labels each message: `atk` -> attack, `dmg` -> damage, no template -> hand. Other speakers' rolls kept only as markers to count interleaving.
- `re.sub(r"\[([^\]]*)\]\(.*?\)", r"\1", name)` - attack names come as `[Sunsword](~link)`, damage names as `Sunsword`. Keeps only the text in square brackets so the two match.
- `attack_groups` - two loops. Loop 1 collects back-to-back attacks with the same name (gap < 5 min). Loop 2 keeps reading the character's rolls: same-name damage -> counted, hand dice that aren't d20 / d100 / dF -> counted as hand evidence, other-name damage -> skipped, anything else -> group ends.
- `attacks_from_groups` - `n_hit = min(attacks, max(sheet damage, hand rolls))`. Like `MIN(COUNT(attacks), MAX(dmg, hand))` in Excel. Sorting key `(face == 20, face != 1, total)` puts nat 20s first, nat 1s last, then highest totals; the first `n_hit` rows get hit = True.
- `foundry_attacks` - `originatingMessage` = id of the chat card the attack and damage buttons sit on. `value_counts()` counts damage rolls per card (like COUNTIF on the card id column), then the same ranking hands out hits per card.
- `slider_hit` - `df.ac.fillna(slider)` = `COALESCE(ac, slider)` in SQL. Same logic as the DAX measure.
- `summarize` - `best_fit_single_ac` tries AC 8 to 24 and keeps the one that disagrees least with the inferred hits; shows which slider value the damage evidence points to.
