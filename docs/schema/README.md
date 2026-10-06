# DnD Stats Tracker schema: technical reference

Companion to [20261006000000_initial_schema.sql](../../supabase/migrations/20261006000000_initial_schema.sql). Draft v2; not yet run in a real Supabase project.
Usage: run the .sql once in Supabase SQL editor or as a migration. Section names below match the .sql dividers.

## Outline

- Model
  - Hierarchy
  - Tables
  - Views
- Import pipeline
  - Pipeline stages
  - Staging row format
  - Character resolution
  - De-duplication
- Code breakdown
  - Tables
  - load_import
  - merge_character
  - Views
  - Row-level security
- Test coverage
- MySQL -> Postgres dialect differences

---

## Model

### Hierarchy

Character = top level. One shared `rolls` table, every row tagged `character_id`; per-character analysis = filter on that tag. Campaigns, game sessions = optional labels; no access or analysis depends on them.

```
profiles
  characters --< character_aliases
    rolls --< roll_dice
  campaigns / game_sessions (optional labels)
  imports --< import_staging
```

Sources: Roll20 Chat Archive `.html` (rolls in `var msgdata = "..."` line, encoded JSON: speaker, type, formula, each die, message id). Foundry `.txt` (no ids). Forge hosts Foundry; same format, no separate parser.

### Tables

| Table | Grain | Function |
|---|---|---|
| `abilities`, `skills` | 6 abilities, 18 skills | Fixed 5e lookups; skill -> ability. |
| `profiles` | login | Own row per `auth.users` id. Auto-created on sign-up. |
| `characters` | PC / NPC | Top level. Owns rolls; `is_public` = sharing; optional `campaign_id`. |
| `character_aliases` | name spelling | Log spelling -> character. Per user. |
| `campaigns` | campaign | Optional label. |
| `game_sessions` | night of play | Optional label; enables per-session trends. |
| `imports` | uploaded file | Per user (one log = many characters). `raw_log` = full file. Delete cascades to its rolls. |
| `import_staging` | parsed entry, pre-load | Common parser output. Unparseable rows held with `parse_error`. |
| `rolls` | roll event | Shared fact table, tagged `character_id`. `raw_text` = source entry. |
| `roll_dice` | physical die | Dice-fairness source. Advantage = 2 rows, 1 kept. |

### Views

All group `rolls` by `character_id`.

| View | Grain | Output columns |
|---|---|---|
| `character_roll_summary` | character | roll count, avg natural d20, nat 20s / 1s, success rate, first / last roll |
| `skill_roll_stats` | character x skill | same, per skill (skill + ability checks only) |
| `die_face_distribution` | character x die size x face | observed vs expected (1/sides) share |
| `character_session_stats` | character x session | per-session counts, avg natural d20 |

---

## Import pipeline

### Pipeline stages

1. Upload -> `imports` row: platform, full file in `raw_log`.
2. Platform parser -> one `import_staging` row per roll entry. `raw_text` always set; other columns best-effort. Unreadable -> `parse_error` set.
3. `select public.load_import(<import_id>);` -> tags to character, loads `rolls` + `roll_dice`.

Only step 2 is per platform. Roll20 parser: extract JSON from `msgdata` line. Foundry parser: read text lines.

### Staging row format

JSON representation; key = column.

```json
{
  "line_number": 1,
  "rolled_at": "2026-10-01T19:42:00Z",
  "roller_name": "Thorn",
  "formula": "1d20+5",
  "dice": [{"sides": 20, "face": 17, "kept": true}],
  "modifier": 5,
  "total": 22,
  "category": "skill_check",
  "skill": "stealth",
  "ability": "DEX",
  "roll_mode": "normal",
  "target_value": null,
  "source_message_id": "-M1aBcDeF",
  "raw_text": "Thorn rolling 1d20+5 ( 17 )+5 = 22",
  "parse_error": null
}
```

`source_message_id`: Roll20 fills; Foundry leaves null.

Loader tolerance: unknown category -> `custom`; unknown skill / ability -> null; `parse_error` rows stay in staging, counted in `imports.rows_unparsed`. `raw_log` + `raw_text` retained -> re-parse possible after parser fixes.

### Character resolution

Match order, case-insensitive, scoped to uploader:
1. `characters.name`
2. `character_aliases.alias`
3. no match -> create character. No roll left untagged.

Side effect: unmatched log spellings create stray characters (e.g. "thorn (GM)"). Resolution: `merge_character(from_id, into_id)` -> moves rolls, drops duplicates, saves old name as alias.

### De-duplication

`dedupe_key`, best source first; unique per `(character_id, platform, dedupe_key)`.

| Source condition | Key derivation | Result |
|---|---|---|
| Roll20 | message id | Exact. Re-upload adds 0. Identical rolls with distinct ids both kept. |
| Foundry, timestamped | md5(timestamp \| roller \| raw_text) | Overlapping exports skipped. Limit: identical rolls in the same second collapse to 1. |
| No id, no timestamp | md5(import id + line) | Nothing wrongly dropped. Limit: same file uploaded twice double-counts; app should warn on repeat file name. |

---

## Code breakdown

### Tables

- `generated always as identity` = `AUTO_INCREMENT`. `generated always`: Postgres assigns; manual value rejected.
- `references t (id) on delete cascade`: inline FK. Parent delete -> children deleted. `on delete set null` -> link nulled, row kept (campaign delete keeps characters).
- `owner_id uuid not null default auth.uid()`: `auth.uid()` = logged-in user id. Default -> app omits owner on insert.
- `rolls.owner_id`: denormalized from character. Avoids joins in RLS and per-user queries. Filled by `load_import`.
- `is_success boolean generated always as (...) stored`: computed column (Excel formula column equivalent). `total >= target_value`; null when no target = unknown, not failed.
- `unique (character_id, platform, dedupe_key)`: enables `on conflict do nothing` skip in loader.

### load_import

Params: `p_import_id (bigint)` import to load. Output: `integer`, rolls loaded; skipped / unparsed counts written to `imports`.

1. `declare`: locals. `public.imports` as type = full row of that table.
2. `select * into v_import ... if not found then raise exception`: fetch import; RLS hides others' imports -> not found.
3. `for v_row in select ... loop`: row-by-row cursor loop (same as MySQL stored-procedure cursor). Filters out `parse_error` and null `total`.
4. Character resolve: name -> alias -> `insert ... returning id into v_char_id`. Each step gated by `if v_char_id is null`.
5. `insert into rolls ... values (...)`: inline sub-selects validate skill / ability codes and extract natural d20 from `dice` JSON (first kept d20).
6. `coalesce(nullif(source_message_id, ''), md5(...))`: dedupe key. `nullif(x, '')` -> empty string becomes null so `coalesce` falls through. `md5()` -> 32-char hash. `||` = `CONCAT()`.
7. `on conflict (...) do nothing` = `INSERT IGNORE`. `returning id into v_roll_id` = `LAST_INSERT_ID()`; stays null on skip -> skip counter.
8. `jsonb_array_elements(...) with ordinality`: JSON array -> rows, one per die; ordinality -> `die_order` 1..n.
9. Post-loop: delete loaded staging rows (error rows kept), write counts, set `status = 'processed'`.

### merge_character

Params: `p_from_id (bigint)` stray, deleted after; `p_into_id (bigint)` target. Output: `integer`, rolls moved.

1. Guards: both exist, same owner, not self -> else `raise exception`.
2. `delete ... where exists (...)`: drop rolls target already has; prevents unique violation on move.
3. `update rolls set character_id = p_into_id`; `get diagnostics v_moved = row_count` = `ROW_COUNT()`.
4. Old name -> alias via `on conflict ... do update` (upsert = `ON DUPLICATE KEY UPDATE`).
5. Repoint stray's aliases; delete stray.

### Views

- `count(*) filter (where r.natural_d20 = 20)`: conditional count. MySQL: `SUM(r.natural_d20 = 20)`.
- `sum(count(*)) over (partition by ...)`: window fn. Total per character + die size without collapsing rows -> per-face share. MySQL 8 supports.
- `character_roll_summary` uses `left join` -> zero-roll characters kept. `count(r.id)` not `count(*)`: `count(*)` returns 1 on the all-null joined row.
- `with (security_invoker = true)`: view runs under caller's RLS. Default = owner's rights -> RLS bypassed.

### Row-level security

- `enable row level security`: table fully locked; each `create policy` opens one path.
- `for select using (...)`: readable rows. `for all ... with check (...)`: writable rows.
- Sharing per character: `is_public` -> rolls readable by anyone incl. logged out. Hidden GM rolls: owner only.
- `can_read_character(p_character_id bigint) -> boolean`: public or owned. `security definer` so it can read `characters` regardless of caller.
- `rolls` / `character_aliases` writes check own row AND own character. Single check let another user file rolls under someone else's character; caught in testing, fixed.
- `roll_dice` has no `character_id`; policy checks parent roll via subquery (subquery obeys `rolls` RLS).

---

## Test coverage

Local Postgres 16, stub `auth` schema. No real Supabase project touched. Code unchanged by the comment restyle (verified: comment-stripped diff identical, same test output).

- Import: 4 Foundry entries -> 3 loaded, stray "thorn (GM)" created, 1 held as unparsed.
- Merge: stray rolls -> Thorn; stray deleted; alias saved. Later import with that spelling -> Thorn; repeat roll skipped.
- Roll20 dedupe: 2 identical rolls, distinct ids -> both kept. Archive re-upload -> 0 loaded, 2 skipped; 1 new roll loaded.
- Foundry dedupe: repeated timestamped entry -> 1 roll.
- Views: correct per-character values; zero-roll character -> 0.
- RLS, second user: sees public character + rolls; not private character, its rolls, or imports. Insert roll / alias onto foreign character refused; rename -> 0 rows.
- RLS, logged out: public character stats only.

---

## MySQL -> Postgres dialect differences

| Topic | MySQL | Postgres |
|---|---|---|
| Auto-increment | `AUTO_INCREMENT` | `generated always as identity` |
| Identifier quoting | `` `backticks` `` | `"double quotes"`; unquoted -> lowercased, use snake_case |
| Enums | inline `ENUM(...)` per column | `create type ... as enum`, reused |
| Strings | `VARCHAR(255)` | `text`; no length penalty |
| Booleans | `TINYINT(1)` | `boolean`, `true` / `false` |
| Timestamps | `DATETIME`, `ON UPDATE CURRENT_TIMESTAMP` | `timestamptz`; on-update needs trigger |
| JSON | `JSON` | `jsonb` (binary, indexable); `->` json, `->>` text |
| Upsert | `INSERT IGNORE` / `ON DUPLICATE KEY UPDATE` | `ON CONFLICT DO NOTHING` / `DO UPDATE` |
| Cast | `CAST(x AS SIGNED)` | `x::integer` |
| Case-insensitive | default collation | `=` / `LIKE` case-sensitive; `ILIKE` or `lower()` |
| FK indexes | auto (InnoDB) | manual |
| Namespaces | database | schema within db; ours `public`, Supabase owns `auth`, `storage` |
| Unsigned | `UNSIGNED` | `check` constraint |
| View security | n/a | needs `security_invoker = true` to obey RLS |
| Blocked write | n/a | RLS-blocked `UPDATE` -> 0 rows, silent; blocked `INSERT` -> error |
