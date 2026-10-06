# Dicegeist Power BI: character one-pagers

One page per character (Lazlo, Vasha, Ivan Maddock), live from the Dicegeist Supabase DB. Same page layout three times, each filtered to one character.

## Usage

1. `01_reporting_views.sql` (repo: `supabase/migrations/20261006161837_powerbi_reporting.sql` + `20261006162443_powerbi_reporting_abilities_spells.sql`): already applied live (migrations `20261006161837_powerbi_reporting`, `20261006162443_powerbi_reporting_abilities_spells`). Re-run only if views are dropped.
2. `02_powerbi_reader_role.sql`: set a password, run once in Supabase SQL Editor. Creates read-only login `powerbi_reader`.
3. Supabase SSL cert -> Windows trust store (one time, see [SSL certificate](#ssl-certificate)).
4. Supabase Dashboard -> **Connect** -> Session pooler: copy host. Power BI Desktop -> Transform data -> paste each block of `03_power_query.m` as its own Blank Query; set `PgHost` to `<host>:5432`.
5. First refresh asks for credentials -> **Database** tab: user `powerbi_reader.xrwydjehpwaaxeexneid`, password from step 2.
6. Model, sliders, measures, page build: follow `WALKTHROUGH.md` parts C to F.

## Files

| File | Function |
|---|---|
| `01_reporting_views.sql` | `reporting` schema: 5 flat views, all derived columns precomputed |
| `02_powerbi_reader_role.sql` | read-only login, `reporting` only |
| `03_power_query.m` | connection parameter + 5 queries |
| `04_measures.dax` | 59 measures, grouped by outline, with breakdown comments |
| `05_measures_paste_once.dax` | same 59 measures, one paste into DAX query view |
| `WALKTHROUGH.md` | click-by-click build |

## Data model

| Query | Source view | Grain | Rows (2026-10-06) |
|---|---|---|---|
| CharactersDim | `characters_dim` | character | 3 |
| RollsFact | `rolls_fact` | roll | 2,156 |
| DiceFact | `dice_fact` | physical die | 2,793 |
| PlaySessions | `play_sessions` | character x play night | 157 |
| DieFairness | `die_fairness` | character x die size | 19 |

Relationships (Model view, drag `character_id` onto `character_id`): CharactersDim 1 -> * each other table, single direction. Delete any Power BI auto-detects between fact tables.

`play_session_no`: `game_sessions` is empty, so sessions are derived. Rolls > 6 h apart -> new session. `play_date` = session start date, America/New_York.

## Data-quality rules

- Death saves: Roll20 excluded (hand-typed saves unlabelled). Filter `counts_for_death_saves`. Lazlo / Vasha cards show "Roll20 saves excluded (incomplete)".
- Healing: Roll20 excluded. Filter `counts_for_healing`.
- Spell damage: `is_spell` rows -> `damage_source = 'Spell'`; includes Eldritch Blast and Divine Smite.
- Attack hit rate: real AC only on Foundry attacks (72 of Ivan's 98). Others use the `Assumed AC` slider. `[Hit Rate (known AC)]` = real-AC-only version.
- Save pass rate: no log stores a save DC (Roll20 or Foundry) -> pass = total >= `Assumed DC` slider. Proxy, not the DM's call.
- Spell casts: 1 cast = 1 spell attack roll (each Eldritch Blast beam / Scorching Ray ray counts), else 1 damage / healing roll. Spell level: from the log when present, else base level from a lookup in the view (all Foundry spells, Divine Smite = 1). Upcasts not visible.
- Abilities: skill checks count toward their ability (Stealth -> DEX), plus ability checks, saves, initiative (DEX). Attack rolls not tagged with an ability.
- Damage totals are rolled, not confirmed dealt (misses, resistances unknown).

## Page layout

Custom canvas: Format page -> Canvas settings -> Custom, 1280 x 1800 (long one-pager; scrolls vertically). Page filter: `CharactersDim[character_name]` = one name. Build Lazlo's page, duplicate twice, change the filter.

```
+----------------------------------------------------------------------------------------------+
| LAZLO  .  Out of the Abyss  .  Roll20  .  921 rolls over 58 sessions      [AC slider][DC slider]|  header
+---------------+---------------+---------------+---------------+---------------+--------------+
| Net rolls     | Nat 20s (%)   | Nat 1s (%)    | Avg d20 / luck| Spell casts   | Heals cast   |  1 KPI cards
+---------------+---------------+---------------+---------------+---------------+--------------+
| ABILITIES ARRAY   STR | DEX | CON | INT | WIS | CHA   (% of ability rolls, avg d20)          |  2
+----------------------------------------------------------------------------------------------+
| Attacks: # / hits / misses / hit % (cards)  | Attacks by source (table)                      |  3 combat
+---------------------------------------------+------------------------------------------------+
| Net damage + spell vs weapon (donut)        | Damage by type, % (stacked bar)                |  4 damage
| Damage averages: spell vs weapon vs by type (clustered bar)                                  |
+---------------------------------------------+------------------------------------------------+
| Saving throws by ability: pass vs fail %    | Death saves: count, per session, pass/fail     |  5 saves
| (100% stacked bar)                          | (cards + donut; Roll20 note)                   |
+---------------------------------------------+------------------------------------------------+
| Spell casts by level, % (column)            | Top spells (table)                             |  6 spells
+---------------------------------------------+------------------------------------------------+
| Luck over time (line)                       | Kept d20 faces vs 5% (column)                  |  7 luck
+------------------------------+--------------+----------------+-------------------------------+
| Skill checks (bar)           | Advantage check (column)      | Die fairness (table)          |  8 extras
+------------------------------+-------------------------------+-------------------------------+
```

### Requested metrics -> measure / visual

| Metric | Measures | Visual |
|---|---|---|
| Net rolls | `[Rolls]` | card, row 1 |
| Net + % of nat 20s and 1s | `[Nat 20s]`, `[Nat 20 Rate]`, `[Nat 1s]`, `[Nat 1 Rate]` | 2 cards, row 1 (rate as subtitle) |
| # attacks | `[Attack Rolls]` | card, row 3 |
| Attack success vs fail | `[Attack Hits]`, `[Attack Misses]`, `[Attack Hit Rate]`, `[Attack Miss Rate]`, `[Attack AC Note]` | cards + donut (hits / misses), row 3 |
| Net damage | `[Damage Rolled]` | donut centre label / card, row 4 |
| % damage types | `[Damage Type Share]` | 100% stacked bar or donut, legend `damage_type`, row 4 |
| % spell vs weapon | `[Spell Damage Share]`, `[Weapon Damage Share]` | donut, legend `damage_source`, row 4 |
| Damage averages comparison | `[Avg Damage Roll]`, `[Avg Spell Damage Roll]`, `[Avg Weapon Damage Roll]` | clustered bar, Y = `damage_type` (or `attack_source`), X = `[Avg Damage Roll]`; constant line = overall avg |
| Saves by type, pass vs fail | `[Save Pass Rate]`, `[Save Fail Rate]`, `[Saving Throws]` | 100% stacked bar, Y = `ability_name` (sort by `ability_order`), visual filter `category` = saving_throw |
| Death saves: frequency, pass vs fail | `[Death Saves]`, `[Death Saves per Session]`, `[Death Save Success Rate]`, `[Death Save Fail Rate]`, `[Death Save Note]` | cards + donut on `death_save_result`, row 5 |
| Total healing cast | `[Healing Casts]`, `[Healing Rolled]` | card, row 1 (HP rolled as subtitle) |
| Total spells cast, % by level | `[Spell Casts]`, `[Spell Cast Share]` | card row 1; column chart X = `spell_level_filled` (0 = cantrip), row 6 |
| Abilities array, % rolls each | `[Ability Rolls]`, `[Ability Share]`, `[Avg Natural d20]` | matrix, columns = `ability_code` (sort by `ability_order`), values = `[Ability Share]`, `[Avg Natural d20]`; or 6 cards in a row |

### Visual setup notes

- **Sliders**: what-if parameters `Assumed AC` (default 14) and `Assumed DC` (default 13) -> Power BI adds a slicer each; keep both in the header. Sync slicers (View -> Sync slicers) across the 3 pages.
- **Sort by column**: select `RollsFact[ability_name]` -> Column tools -> Sort by column -> `ability_order`; same for `ability_code`. `roll_mode` -> `roll_mode_sort`.
- **Blank cards**: Format -> Callout value -> Blank -> custom text. Hit rate (known AC) -> "n/a: no AC in Roll20 logs"; healing / death saves on Roll20 pages -> "Roll20 excluded".
- **Luck over time**: line, X = `RollsFact[play_date]` (Continuous), Y = `[Avg Natural d20]`, `[Expected d20]` (dashed); constant line 10.5.
- **Kept d20 faces**: column, X = `RollsFact[natural_d20]` (Categorical, not blank), Y = `[Rolls Share]`; constant line 0.05.
- **Skill checks**: bar, Y = `check_name`, filter `category` = skill_check, X = `[Avg Natural d20]`; subtitle `[Luckiest Skill]` / `[Unluckiest Skill]`.
- **Advantage check**: column, X = `roll_mode`, Y = `[Avg Natural d20]`, `[Expected d20]`.
- **Die fairness**: table off DieFairness: `die`, `dice_rolled`, `avg_face`, `chi_square`, `verdict`; `verdict` background: Cursed red, Looks fair green, Not enough rolls grey.
- **Top spells**: table, rows `spell_name`, values `[Spell Casts]`, `[Spell Damage]`, `[Healing Rolled]`, `spell_level_filled` (Don't summarize).

### Per-character notes (2026-10-06; AC 14 / DC 13 defaults)

| Character | Stands out |
|---|---|
| Lazlo | 185 spell casts, 94% cantrips (Eldritch Blast). 56% of damage from spells. Ability rolls: DEX 40%, WIS 27%. Hit rate 77% at AC 14; saves pass 53% at DC 13. |
| Vasha | 73 casts, all level 1 (Divine Smite 70). 32% spell damage; biggest hit 41. DEX 45%, STR 19%. Stealth avg d20 7.4. Saves pass 64%. |
| Ivan Maddock | 136 casts: 57% cantrip, 32% level 1, 11% level 2. 99% spell damage. WIS 35%, DEX 31%. 4 death saves, 2 pass / 2 fail. 54 heals cast. Saves pass 43% at DC 13. |

All 3 characters: every die size with enough rolls -> "Looks fair".

---

## Code breakdown

### 01_reporting_views.sql

- `create schema reporting`: separate namespace (MySQL: separate database). Not in Supabase's API-exposed schemas -> only direct Postgres logins see it.
- Views without `security_invoker`: run with owner (`postgres`) rights -> bypass RLS. Safe because only `powerbi_reader` gets `select`. `public` views keep `security_invoker = true` for the app.
- `lag(rolled_at) over w`: previous row's value within the window (Excel: reference the cell above in a sorted table). `window w as (partition by character_id order by rolled_at, id)` = sort per character; defined once, reused.
- Session numbering: flag 1 where gap > 6 h (or first roll) -> `sum(flag) over (... rows unbounded preceding)` = running total (Excel: `=SUM($A$2:A2)`). Each new flag bumps the number.
- `min(...) over (partition by character_id, play_session_no)`: session-wide min on every row without collapsing rows (Excel: `MINIFS` per row).
- `at time zone 'America/New_York'`: UTC timestamptz -> local wall clock; `::date` drops time. Evening sessions crossing midnight UTC keep one date.
- `sum(...) filter (where is_kept)`: conditional aggregate (MySQL: `SUM(CASE WHEN is_kept THEN face END)`).
- `expected_natural_d20`: fair-die average per mode. Advantage = mean of max of 2d20 = 13.825; disadvantage = 7.175. `* case when natural_d20 is null then null else 1 end` -> null when no d20 so averages skip it.
- `kept_dice_expected = sum((sides + 1) / 2.0)`: average of one die = (sides + 1) / 2. `2.0` forces decimal (integer `/` truncates in Postgres; MySQL `/` doesn't).
- `cross join lateral generate_series(1, sides)`: one row per possible face, so faces never rolled count as 0 (MySQL 8: recursive CTE).
- Chi-square: `sum((observed - expected)^2 / expected)` over faces. Compared to table critical value at 5%, df = sides - 1. Below 5 expected per face -> test unreliable -> "Not enough rolls".
- `(values (4, 7.815), ...) as cv(sides, critical_value_05)`: inline lookup table (Excel: VLOOKUP range typed into the formula).
- `spell_base` CTE: same inline-lookup trick for spell base levels; `coalesce(s.spell_level, sb.base_level)` -> log value wins, lookup fills gaps.
- `spell_attacks` CTE + `left join ... sa.spell_name is null`: "this spell never has an attack roll for this character" (MySQL: `LEFT JOIN ... WHERE x IS NULL` anti-join). Those spells count a cast per damage / healing row; attack spells count per attack row.
- `coalesce(s.ability_code, sk.ability_code, case when category = 'initiative' then 'DEX' end)`: first non-null wins: roll's own ability -> skill's ability -> DEX for initiative.
- New columns appended at the end of `rolls_fact`: `create or replace view` can add columns but not reorder / rename existing ones (else drop + recreate).

### 02_powerbi_reader_role.sql

- `create role ... with login` = MySQL `CREATE USER`.
- `default_transaction_read_only = on`: any write in this login's sessions errors, even if a grant is added by mistake.
- `alter default privileges ... grant select on tables`: views created later in `reporting` auto-granted.
- Pooler username `role.projectref`: Supavisor routes on the suffix; plain `powerbi_reader` fails.

### 03_power_query.m

- `PostgreSQL.Database(host, db, [options])`: built-in Npgsql connector, no driver install. `CreateNavigationProperties = false` -> no auto relationship columns.
- `Source{[Schema = "reporting", Item = "rolls_fact"]}[Data]`: navigation table lookup. `{[...]}` = find the row matching those field values (Excel: XLOOKUP on 2 columns); `[Data]` = take that row's table.
- Query folding: navigation + type changes fold into SQL -> Postgres does the work. `Table.AddColumn` with `if` (roll_mode_sort) may break folding; fine at 2k rows.
- `meta [IsParameterQuery = true]`: turns a plain value into a Manage Parameters entry.

### 04_measures.dax

- Measure vs column: measure = formula evaluated per visual cell under its filters (Excel: PivotTable value field). Never stored.
- `CALCULATE(expr, filter)`: re-evaluate under extra / replaced filters (Excel: add a COUNTIFS criterion).
- `REMOVEFILTERS(col)`: drop the filter on one column -> denominator for shares (Excel: `% of column total`).
- `DIVIDE(a, b)`: blank on zero (Excel: `IFERROR(a/b, "")`).
- `VAR` / `RETURN`: named intermediate (Excel `LET`).
- `TOPN(1, table, measure)` + `CONCATENATEX(..., ", ")`: top row(s) by measure, joined as text (Excel: `TEXTJOIN` over `SORTBY`/`TAKE`). Ties return both.
- `ADDCOLUMNS(VALUES(col), "@n", [Rolls])`: per-skill table with calculated columns, built in memory (Excel: pivot to a helper range). `@` prefix = convention for virtual columns.
- `Luck Z`: (observed avg - expected) / (5.766 / sqrt(n)). |Z| > 2 -> under ~5% chance from a fair die.
- What-if parameter: Power BI builds a one-column table (`GENERATESERIES(5, 30, 1)`) + slicer + measure `[Assumed AC Value] = SELECTEDVALUE(...)`. Measures read the slider through that measure.
- `FILTER(RollsFact, condition)` inside `CALCULATE`: row-by-row test when the condition compares columns to each other or to a variable (Excel: `SUMPRODUCT(--(total >= AC))`). Simple `col = "x"` filters don't need it.
- `||` = OR, `&&` = AND. `COALESCE(target_value, ac)` = real AC if logged, else slider.

## SSL certificate

Power BI's Postgres connector requires a trusted server cert; Supabase's CA isn't in Windows by default -> "remote certificate is invalid".

1. Supabase Dashboard -> Project Settings -> Database -> SSL Configuration -> Download certificate (`prod-ca-2021.crt`).
2. Double-click -> Install Certificate -> Current User -> Place in: Trusted Root Certification Authorities.
3. Restart Power BI Desktop.

## Publishing later

Power BI Service scheduled refresh to a cloud Postgres should work without a gateway since the pooler host is public; if the Service asks for one, a personal gateway on your PC works. Public web embed ("Publish to web") exposes all data in the report, no login. The future Dicegeist site should read the same `reporting` views via its own backend, not via Power BI.
