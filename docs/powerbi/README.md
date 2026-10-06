# Dicegeist Power BI: character one-pagers

One page per character (Lazlo, Vasha, Ivan Maddock), live from the Dicegeist Supabase DB. Same page layout three times, each filtered to one character.

## Usage

1. `01_reporting_views.sql` (repo: `supabase/migrations/20261006161837_powerbi_reporting.sql`): already applied live (migration `20261006161837_powerbi_reporting`). Re-run only if views are dropped.
2. `02_powerbi_reader_role.sql`: set a password, run once in Supabase SQL Editor. Creates read-only login `powerbi_reader`.
3. Supabase SSL cert -> Windows trust store (one time, see [SSL certificate](#ssl-certificate)).
4. Supabase Dashboard -> **Connect** -> Session pooler: copy host. Power BI Desktop -> Transform data -> paste each block of `03_power_query.m` as its own Blank Query; set `PgHost` to `<host>:5432`.
5. First refresh asks for credentials -> **Database** tab: user `powerbi_reader.xrwydjehpwaaxeexneid`, password from step 2.
6. Model view: relationships (below). Paste measures from `04_measures.dax`.
7. Build page 1 per [Page layout](#page-layout), duplicate twice, change page filter.

## Files

| File | Function |
|---|---|
| `01_reporting_views.sql` | `reporting` schema: 5 flat views, all derived columns precomputed |
| `02_powerbi_reader_role.sql` | read-only login, `reporting` only |
| `03_power_query.m` | connection parameter + 5 queries |
| `04_measures.dax` | 35 measures, grouped by outline |

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
- Hit rate: needs a target AC; only Foundry attacks carry one (72 of Ivan's 98). Blank for Roll20.
- Damage totals are rolled, not confirmed dealt (misses, resistances unknown).

## Page layout

Canvas 16:9 (1280 x 720). Page filter: `CharactersDim[character_name]` = one name. Title text box: `character_name` + `campaign` + `platforms` (card / multi-row card off CharactersDim).

```
+----------------------------------------------------------------------------------------------+
| LAZLO  .  Out of the Abyss  .  Roll20  .  921 rolls over 58 sessions                         |  header
+-----------+-----------+-----------+-----------+-----------+-----------------------------------+
| Avg d20   | d20 Luck  | Nat 20s   | Nat 1s    | Damage    | Signature spell / Most rolled    |  row 1: KPI cards
| vs exp    | (Luck Z)  | (rate)    | (rate)    | Dice Luck | skill                            |
+-----------+-----------+-----------+-----------+-----------+-----------------------------------+
| Luck over time (line)                          | Kept d20 faces (column + 5% line)           |  row 2
+------------------------------------------------+---------------------------------------------+
| Skill checks (bar)          | Damage by type (stacked bar)  | Adv vs normal vs dis (column)  |  row 3
+-----------------------------+-------------------------------+--------------------------------+
| Die fairness (table)        | Attacks by source (table)     | Best/worst night, death saves, |  row 4
|                             |                               | healing, hit rate (cards)      |
+-----------------------------+-------------------------------+--------------------------------+
```

### Row 1: KPI cards

| Card | Callout | Subtitle / reference label | Why |
|---|---|---|---|
| Avg natural d20 | `[Avg Natural d20]` | `[Expected d20]` as reference label "fair die" | headline luck |
| d20 luck | `[d20 Luck]` | `[Luck Z]`; conditional colour: > +2 green, < -2 red | is the luck real or noise |
| Nat 20s | `[Nat 20s]` | `[Nat 20 Rate]` | crit count |
| Nat 1s | `[Nat 1s]` | `[Nat 1 Rate]`, `[Crit Ratio]` | fumble count |
| Damage dice luck | `[Damage Dice Luck]` | `[Damage Rolled]`, `[Biggest Hit]` | damage dice hot / cold |
| Identity | `[Signature Spell]` | `[Most Rolled Skill]` | character flavour |

New card visual (2024+) takes several measures in one visual; older card -> one card per measure.

### Row 2

- **Luck over time**: line chart. X = `RollsFact[play_date]` (type Continuous). Y = `[Avg Natural d20]`, `[Expected d20]` (dashed). Analytics pane -> constant line 10.5. Tooltips: `[d20 Rolls]`, `[Nat 20s]`, `[Nat 1s]`.
- **Kept d20 faces**: clustered column. X = `RollsFact[natural_d20]` (Categorical, filter is not blank). Y = `[Rolls Share]`. Analytics -> constant line 0.05. Shows the actual 1..20 spread vs flat 5%.

### Row 3

- **Skill checks**: clustered bar. Y = `RollsFact[check_name]`, visual filter `category` = skill_check. X = `[Avg Natural d20]`; tooltip `[Rolls]`. Constant line 10.5. Sort by `[Rolls]` desc. `[Luckiest Skill]` / `[Unluckiest Skill]` as visual subtitle.
- **Damage by type**: stacked bar. Y = `RollsFact[damage_type]`, legend = `damage_source`, X = `[Damage Rolled]`. Subtitle `[Spell Damage Share]`.
- **Advantage check**: clustered column. X = `RollsFact[roll_mode]` (sort by `roll_mode_sort`). Y = `[Avg Natural d20]`, `[Expected d20]`. Tooltip `[d20 Rolls]`. Advantage should land ~13.8, disadvantage ~7.2.

### Row 4

- **Die fairness**: table off DieFairness: `die`, `dice_rolled`, `avg_face`, `expected_avg_face`, `chi_square`, `verdict`. Conditional format `verdict` background: "Cursed" red, "Looks fair" green, "Not enough rolls" grey. Card above: `[Cursed Dice]`.
- **Attacks by source**: table. Rows `RollsFact[attack_source]`, visual filter `category` = attack. Values `[Attack Rolls]`, `[Avg Natural d20]`, `[Nat 20s]`, `[Hit Rate (known AC)]`.
- **Cards**: `[Best Night]`, `[Worst Night]`, `[Death Save Note]`, `[Healing Rolled]` (blank -> "Roll20 excluded"), `[Hit Rate (known AC)]` (blank -> "n/a: no AC in Roll20 logs"). Card format -> Callout value -> Blank -> custom text.

### Per-character notes

| Character | Stands out |
|---|---|
| Lazlo | Eldritch Blast 279 rolls (attack + damage), 56% of damage from spells. Normal d20 avg 10.36 (slightly cold). Luckiest skill Deception 16.5, worst History 7.7. |
| Vasha | Divine Smite 70 rolls, 32% spell damage; biggest hit 41. Stealth 7.4 avg (cursed sneaking). Advantage avg 13.30 (under 13.83 fair). |
| Ivan Maddock | Only one with hit rate (90%, known AC), death saves (4: 2 pass / 2 fail) and healing. Fire Bolt 94 rolls; 99% spell damage. Damage dice 105.8% of average. Advantage 14.66. |

All 3 characters: every die size with enough rolls -> "Looks fair". No cursed dice yet.

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

## SSL certificate

Power BI's Postgres connector requires a trusted server cert; Supabase's CA isn't in Windows by default -> "remote certificate is invalid".

1. Supabase Dashboard -> Project Settings -> Database -> SSL Configuration -> Download certificate (`prod-ca-2021.crt`).
2. Double-click -> Install Certificate -> Current User -> Place in: Trusted Root Certification Authorities.
3. Restart Power BI Desktop.

## Publishing later

Power BI Service scheduled refresh to a cloud Postgres should work without a gateway since the pooler host is public; if the Service asks for one, a personal gateway on your PC works. Public web embed ("Publish to web") exposes all data in the report, no login. The future Dicegeist site should read the same `reporting` views via its own backend, not via Power BI.
