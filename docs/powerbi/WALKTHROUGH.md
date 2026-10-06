# Dicegeist Power BI: build walkthrough

Click-by-click build of the 3 character pages. Order matters: each part needs the one before it.
Files referenced live in this folder. Power BI Desktop (Windows), 2024 or newer (DAX query view required for part C).

## Outline

- A. Supabase: login, host, certificate
- B. Power Query: connect + load 5 tables
- C. Model: relationships, sort, sliders, measures, formats
- D. Lazlo page, row by row
- E. Vasha + Ivan pages
- F. Save, refresh
- Troubleshooting

---

## A. Supabase

### A1. Create the read-only login
1. supabase.com -> Dicegeist project -> **SQL Editor** (left bar) -> **+ New query**.
2. Paste all of `02_powerbi_reader_role.sql`. Replace `<PICK_A_PASSWORD>` (keep the quotes). Save the password somewhere.
3. **Run**. Expect a 5-row result: `reporting` views, privilege `SELECT`.

### A2. Copy the pooler host
1. Project home -> **Connect** (top bar).
2. Method dropdown -> **Session pooler** -> **View parameters**.
3. Copy **host** only (looks like `aws-0-us-east-1.pooler.supabase.com`; may be `aws-1-...`). Port = 5432.

### A3. Trust Supabase's SSL certificate (once per PC)
1. **Project Settings** -> **Database** -> **SSL Configuration** -> **Download certificate** (`prod-ca-2021.crt`).
2. Double-click the file -> **Install Certificate...** -> **Current User** -> Next.
3. **Place all certificates in the following store** -> Browse -> **Trusted Root Certification Authorities** -> OK -> Next -> Finish -> **Yes** on the warning.
4. Close Power BI if open.

---

## B. Power Query

### B1. Open the editor
Power BI Desktop -> **Blank report** -> Home -> **Transform data**. Power Query Editor opens.

### B2. Host parameter
Home -> **Manage Parameters** -> **New Parameter**:

| Field | Value |
|---|---|
| Name | `PgHost` |
| Required | ticked |
| Type | Text |
| Suggested Values | Any value |
| Current Value | `<host from A2>:5432` |

OK. (Same as the `PgHost` block in `03_power_query.m`; this is the UI route.)

### B3. Connection query
1. Home -> **New Source** -> **Blank Query**.
2. Home -> **Advanced Editor** -> select all -> paste the `Dicegeist` block (`let ... in Source`) -> **Done**.
3. Right pane, **Query Settings** -> Name -> `Dicegeist`.
4. Yellow bar "Please specify how to connect" -> **Edit Credentials** -> **Database** tab:
   - User name: `powerbi_reader.xrwydjehpwaaxeexneid`
   - Password: from A1
   - Connect. Navigation table appears (rows of schemas / views).
5. Queries pane (left) -> right-click `Dicegeist` -> untick **Enable load** (helper only, not a table).

### B4. The 5 tables
Repeat B3 steps 1 to 3 for each block in `03_power_query.m`, naming each query exactly:

| Query name | Preview should show |
|---|---|
| `CharactersDim` | 3 rows |
| `RollsFact` | ~2,156 rows, 40 columns |
| `DiceFact` | ~2,793 rows |
| `PlaySessions` | ~157 rows |
| `DieFairness` | 19 rows |

Row counts: bottom-left status bar ("40 COLUMNS, 999+ ROWS" is normal; preview caps at 1,000).

### B5. Load
Home -> **Close & Apply**. Data pane (right) lists 5 tables.

---

## C. Model

### C1. Relationships
1. Left sidebar -> **Model view** (3rd icon).
2. Home -> **Manage relationships**. Delete any auto-detected ones that don't involve `CharactersDim`.
3. **New relationship**, 4 times:

| From table / column | To table / column | Cardinality | Cross-filter |
|---|---|---|---|
| RollsFact / character_id | CharactersDim / character_id | Many to one (*:1) | Single |
| DiceFact / character_id | CharactersDim / character_id | Many to one | Single |
| PlaySessions / character_id | CharactersDim / character_id | Many to one | Single |
| DieFairness / character_id | CharactersDim / character_id | Many to one | Single |

Excel equivalent: 4 XLOOKUPs into the character table; filtering a character filters all 4.

### C2. Sort columns
Left sidebar -> **Table view** -> RollsFact. Click column header, then **Column tools** -> **Sort by column**:

| Column | Sort by |
|---|---|
| `ability_name` | `ability_order` |
| `ability_code` | `ability_order` |
| `roll_mode` | `roll_mode_sort` |

Keeps STR..CHA and Disadvantage -> Normal -> Advantage order on axes instead of A-Z.

### C3. AC / DC sliders (what-if parameters)
Back to **Report view**. Modeling -> **New parameter** -> **Numeric range**:

| Field | Assumed AC | Assumed DC |
|---|---|---|
| Name | `Assumed AC` | `Assumed DC` |
| Data type | Whole number | Whole number |
| Minimum / Maximum | 5 / 30 | 5 / 30 |
| Increment | 1 | 1 |
| Default | 14 | 13 |
| Add slicer to this page | ticked | ticked |

Creates tables `Assumed AC` / `Assumed DC` and measures `[Assumed AC Value]` / `[Assumed DC Value]`. Measures in C5 need them.

### C4. Measure table
Home -> **Enter data** -> Name: `_Measures` -> **Load**. (Holds measures only; its `Column1` gets deleted in C5.)

### C5. All 59 measures in one paste
1. Left sidebar -> **DAX query view** (4th icon).
2. Paste all of `05_measures_paste_once.dax` -> **Run**. Result grid: one number (Lazlo + Vasha + Ivan rolls, ~2156).
3. Above `DEFINE`, click **Update model: Add 59 new measures**.
4. Data pane -> `_Measures` -> right-click `Column1` -> **Delete from model**. Table icon changes to a calculator = measure table.

Error on Run -> message names the line. Usual cause: C3 not done (`[Assumed AC Value]` not found).

### C6. Number formats
DAX query view can't set formats. **Model view** -> Data pane -> expand `_Measures` -> Ctrl+click a group below -> **Properties** pane -> Formatting -> Format:

| Format | Measures |
|---|---|
| Whole number, thousands separator on | Rolls, Damage Rolled, Spell Damage, Weapon Damage |
| Whole number | Play Sessions, d20 Rolls, Nat 20s, Nat 1s, Biggest Hit, Attack Rolls, Attack Hits, Attack Misses, Healing Rolled, Healing Casts, Death Saves, Death Save Fails, Saving Throws, Save Passes, Save Fails, Spell Casts, Ability Rolls, Cursed Dice |
| Decimal, 1 place | Rolls per Session, Avg Damage Roll, Avg Spell Damage Roll, Avg Weapon Damage Roll, Avg Save Total |
| Decimal, 2 places | Avg Natural d20, Expected d20, Crit Ratio, Death Saves per Session |
| Custom `+0.00;-0.00;0.00` | d20 Luck |
| Custom `+0.0;-0.0;0.0` | Luck Z |
| Percentage, 1 place | Nat 20 Rate, Nat 1 Rate, Rolls Share, Damage Dice Luck, Face Share, Expected Face Share, Damage Type Share, Spell Cast Share, Ability Share |
| Percentage, 0 places | Spell Damage Share, Weapon Damage Share, Attack Hit Rate, Attack Miss Rate, Hit Rate (known AC), Save Pass Rate, Save Fail Rate, Death Save Success Rate, Death Save Fail Rate |
| (text, leave) | Death Save Note, Attack AC Note, Most Rolled Skill, Luckiest Skill, Unluckiest Skill, Signature Spell, Best Night, Worst Night |

---

## D. Lazlo page

### D1. Page setup
1. **Report view**. Click empty canvas -> **Format** pane (paintbrush) -> **Canvas settings** -> Type **Custom** -> 1280 x 1800.
2. Rename page tab (double-click) -> `Lazlo`.
3. **Filters** pane -> **Filters on this page** -> drag `CharactersDim[character_name]` in -> tick **Lazlo**.
4. Move the 2 slicers from C3 to the top-right corner.

Visual adding pattern for every step below: click empty canvas -> click visual icon in **Visualizations** pane -> drag fields from **Data** pane into the wells (X-axis, Y-axis, Values, Legend...). "Visual filter" = drag field into **Filters on this visual**.

### D2. Header (top, full width)
- **Multi-row card**: `CharactersDim[character_name]`, `campaign`, `platforms`, `roll_count`, `play_sessions`.

### D3. Row 1: KPI cards
**Card (new)** visual -> Data well: `Rolls`, `Nat 20s`, `Nat 1s`, `Avg Natural d20`, `Spell Casts`, `Healing Casts`. One visual, 6 tiles.
- Format -> **Reference labels** -> add: Nat 20s -> `Nat 20 Rate`; Nat 1s -> `Nat 1 Rate`; Avg Natural d20 -> `Expected d20`; Healing Casts -> `Healing Rolled`.
- Format -> Callout value -> **Blank** -> show as `Roll20 excluded` (Healing Casts is blank on Roll20 pages).
- Older Power BI without Card (new): one **Card** per measure.

### D4. Row 2: abilities array
**Matrix**: Columns = `RollsFact[ability_code]`; Values = `Ability Share`, `Ability Rolls`, `Avg Natural d20`.
- Format -> **Values** -> Options -> **Switch values to rows**: On. Result: STR..CHA across, 3 stat rows down, like a character sheet.
- Optional: Format -> Cell elements -> Ability Share -> **Data bars** on.

### D5. Row 3: attacks
- **Card (new)**: `Attack Rolls`, `Attack Hits`, `Attack Misses`, `Attack Hit Rate`. Subtitle (Format -> General -> Title -> Subtitle -> fx -> Field value) = `Attack AC Note`.
- **Donut**: Values = `Attack Hits`, `Attack Misses` (no legend needed). Detail labels -> Label contents: Data value, percent of total.
- **Table**: `RollsFact[attack_source]`, `Attack Rolls`, `Attack Hit Rate`, `Avg Natural d20`, `Nat 20s`. Visual filter `category` = attack.

### D6. Row 4: damage
- **Card (new)**: `Damage Rolled`, `Biggest Hit`, `Damage Dice Luck`.
- **Donut** (spell vs weapon): Legend = `damage_source`, Values = `Damage Rolled`. Detail labels: Category, percent of total.
- **Clustered bar** (% damage types): Y = `damage_type`, X = `Damage Type Share`. Sort descending by Damage Type Share.
- **Clustered bar** (damage averages): Y = `damage_type`, X = `Avg Damage Roll`, Legend = `damage_source`. Analytics pane -> **Average line** on. Card next to it: `Avg Spell Damage Roll`, `Avg Weapon Damage Roll`.

### D7. Row 5: saves + death saves
- **100% stacked bar** (saves by type): Y = `ability_name`, X = `Save Passes`, `Save Fails`. Tooltips = `Save Pass Rate`, `Avg Save Total`. Title: "Saves vs DC slider".
- **Card (new)**: `Death Saves`, `Death Saves per Session`, `Death Save Success Rate`, `Death Save Fail Rate`. Blank -> `Roll20 excluded`.
- **Donut**: Legend = `death_save_result`, Values = `Death Saves` (empty on Roll20 pages).

### D8. Row 6: spells
- **Clustered column** (% by level): X = `spell_level_filled` (X-axis -> Type: **Categorical**), Y = `Spell Cast Share`. Data labels on. Rename axis title "Spell level (0 = cantrip)".
- **Table** (top spells): `spell_name`, `Spell Casts`, `Spell Damage`, `Healing Rolled`. Sort by Spell Casts desc. Card above: `Signature Spell`.

### D9. Row 7: luck
- **Line chart**: X = `RollsFact[play_date]`, Y = `Avg Natural d20`, `Expected d20`. Analytics -> **Constant line** 10.5. Format -> Lines -> Expected d20 -> dashed.
- **Clustered column** (kept d20 faces): X = `RollsFact[natural_d20]` (Categorical), Y = `Rolls Share`. Visual filter `natural_d20` is not blank. Constant line 0.05 = fair-die 5%.
- **Card (new)**: `d20 Luck`, `Luck Z`, `Best Night`, `Worst Night`.

### D10. Row 8: extras
- **Clustered bar** (skills): Y = `check_name`, X = `Avg Natural d20`, Tooltips = `Rolls`. Visual filter `category` = skill_check. Constant line 10.5. Subtitle field value `Luckiest Skill`.
- **Clustered column** (advantage): X = `roll_mode`, Y = `Avg Natural d20`, `Expected d20`.
- **Table** (die fairness): DieFairness `die`, `dice_rolled`, `avg_face`, `chi_square`, `verdict`. Cell elements -> verdict -> Background color -> **Rules**: contains "Cursed" red, "Looks fair" green, "Not enough" grey.

---

## E. Vasha + Ivan pages

1. Right-click `Lazlo` tab -> **Duplicate page** -> rename `Vasha` -> Filters on this page -> untick Lazlo, tick **Vasha**.
2. Repeat for `Ivan Maddock`.
3. View -> **Sync slicers** -> select the Assumed AC slicer -> tick Sync + Visible on all 3 pages. Same for Assumed DC.

Blank cards on Vasha / Lazlo (healing, death saves, hit rate vs real AC) are expected: Roll20 excluded.

---

## F. Save, refresh

- File -> **Save as** -> `Dicegeist.pbix` (save anywhere; the password stays in Power BI's credential store, not the file).
- New imports in Supabase -> Home -> **Refresh**. Views recompute on every refresh.

---

## Troubleshooting

| Message | Cause -> fix |
|---|---|
| "The remote certificate is invalid" / SSL error | A3 not done, or Power BI open during install -> redo A3, restart |
| "password authentication failed" | user must be `powerbi_reader.xrwydjehpwaaxeexneid`, not `powerbi_reader` -> File -> Options and settings -> Data source settings -> Edit Permissions -> Edit credentials |
| "Tenant or user not found" | wrong pooler host (`aws-0` vs `aws-1`) -> recopy A2, update PgHost |
| "No such host is known" | used the `db.xrwydjehpwaaxeexneid.supabase.co` host (IPv6-only) -> use pooler host |
| "permission denied for schema reporting" | A1 not run, or ran as a different project |
| DAX run: "Cannot find name '[Assumed AC Value]'" | C3 not done |
| Visual shows one bar per row / wrong totals | numeric field summarized -> field dropdown in the well -> **Don't summarize** |
| Abilities in A-Z order | C2 not done |
