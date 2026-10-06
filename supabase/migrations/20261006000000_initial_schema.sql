-- DnD Stats Tracker schema (Supabase / Postgres 15+), draft v2
-- Usage Syntax: run whole file once in Supabase SQL editor, or as a migration
--   load an import:  select public.load_import(<import_id>);
--   merge a stray:   select public.merge_character(<from_id>, <into_id>);

--------------------------------------------------------------------------------------------------------------
-- Outline
--   Enum types
--     source_platform / roll_category / roll_mode / import_status
--   Lookup tables (fixed 5e lists)
--     abilities
--     skills
--   Users
--     profiles
--     handle_new_user (trigger fn) / on_auth_user_created (trigger)
--   Optional grouping labels
--     campaigns
--   Characters (top of hierarchy)
--     characters
--     character_aliases
--   Optional session labels
--     game_sessions
--   Imports
--     imports
--   Roll data (one shared table, tagged by character)
--     rolls
--     roll_dice
--   Import staging (parser output, awaiting load)
--     import_staging
--   Functions
--     load_import
--     merge_character
--   Per-character analysis views
--     character_roll_summary
--     skill_roll_stats
--     die_face_distribution
--     character_session_stats
--   Row-level security
--     can_read_character (helper fn)
--     policies, per table
--
-- Hierarchy
--   profiles
--     characters --< character_aliases
--       rolls --< roll_dice
--     campaigns / game_sessions (optional labels)
--     imports --< import_staging
--
-- Sources: Roll20 Chat Archive .html (msgdata JSON, has message ids), Foundry .txt (no ids).
-- Forge hosts Foundry; same export format, no separate parser.
--------------------------------------------------------------------------------------------------------------


--------------------------------------------------------------------------------------------------------------
-- Enum types
-- named once, reused as column types (MySQL: inline ENUM per column)
--------------------------------------------------------------------------------------------------------------

--log source; drives which parser filled the row
create type public.source_platform as enum (
  'roll20',     --Chat Archive page, saved as .html
  'foundry',    --chat export .txt, incl. Forge-hosted games
  'manual',     --entered by hand
  'other'
);

--roll purpose; unknown -> 'custom'
create type public.roll_category as enum (
  'ability_check',  --plain STR/DEX/...
  'skill_check',    --Perception, Stealth, ...
  'saving_throw',
  'attack',
  'damage',
  'initiative',
  'death_save',
  'hit_dice',
  'custom'
);

--d20 mode
create type public.roll_mode as enum ('normal', 'advantage', 'disadvantage');

--import lifecycle
create type public.import_status as enum ('pending', 'processed', 'failed');


--------------------------------------------------------------------------------------------------------------
-- Lookup tables (fixed 5e lists)
-- table not enum: skills need an ability link
--------------------------------------------------------------------------------------------------------------

--six abilities
create table public.abilities (
  code text primary key,          --'STR'
  name text not null              --'Strength'
);

--18 skills, each mapped to its ability
create table public.skills (
  code         text primary key,  --'stealth'
  name         text not null,     --'Stealth'
  ability_code text not null references public.abilities (code)
);

insert into public.abilities (code, name) values
  ('STR', 'Strength'), ('DEX', 'Dexterity'), ('CON', 'Constitution'),
  ('INT', 'Intelligence'), ('WIS', 'Wisdom'), ('CHA', 'Charisma');

insert into public.skills (code, name, ability_code) values
  ('acrobatics',      'Acrobatics',      'DEX'),
  ('animal_handling', 'Animal Handling', 'WIS'),
  ('arcana',          'Arcana',          'INT'),
  ('athletics',       'Athletics',       'STR'),
  ('deception',       'Deception',       'CHA'),
  ('history',         'History',         'INT'),
  ('insight',         'Insight',         'WIS'),
  ('intimidation',    'Intimidation',    'CHA'),
  ('investigation',   'Investigation',   'INT'),
  ('medicine',        'Medicine',        'WIS'),
  ('nature',          'Nature',          'INT'),
  ('perception',      'Perception',      'WIS'),
  ('performance',     'Performance',     'CHA'),
  ('persuasion',      'Persuasion',      'CHA'),
  ('religion',        'Religion',        'INT'),
  ('sleight_of_hand', 'Sleight of Hand', 'DEX'),
  ('stealth',         'Stealth',         'DEX'),
  ('survival',        'Survival',        'WIS');


--------------------------------------------------------------------------------------------------------------
-- Users
-- auth.users is Supabase-owned; profiles shares its id
--------------------------------------------------------------------------------------------------------------

--one row per login
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at   timestamptz not null default now()
);

--create profile on sign-up; display_name from metadata, else email prefix
--params:  none (trigger fn; reads NEW, the inserted auth.users row)
--output:  trigger, NEW unchanged
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

--fire handle_new_user after each sign-up
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


--------------------------------------------------------------------------------------------------------------
-- Optional grouping labels
-- campaign = label only; no access or analysis depends on it
--------------------------------------------------------------------------------------------------------------

--campaign label, per user
create table public.campaigns (
  id          bigint generated always as identity primary key,  --MySQL: AUTO_INCREMENT
  owner_id    uuid not null default auth.uid()
              references public.profiles (id) on delete cascade,
  name        text not null,
  description text,
  created_at  timestamptz not null default now(),
  unique (owner_id, name)
);


--------------------------------------------------------------------------------------------------------------
-- Characters (top of hierarchy)
-- each character = own section, own stats, own sharing setting
--------------------------------------------------------------------------------------------------------------

--character; owns its rolls
create table public.characters (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid()
              references public.profiles (id) on delete cascade,
  campaign_id bigint references public.campaigns (id) on delete set null,
  name        text not null,
  player_name text,
  class_name  text,
  level       smallint check (level between 1 and 20),
  is_npc      boolean not null default false,
  is_public   boolean not null default false,  --true = anyone can read this character's stats
  notes       text,
  created_at  timestamptz not null default now(),
  unique (owner_id, name)
);

create index characters_campaign_idx on public.characters (campaign_id);

--alternate log spellings -> character; per user (imports are per user)
create table public.character_aliases (
  owner_id     uuid not null default auth.uid()
               references public.profiles (id) on delete cascade,
  alias        text not null,
  character_id bigint not null references public.characters (id) on delete cascade,
  primary key (owner_id, alias)
);

create index character_aliases_character_idx on public.character_aliases (character_id);


--------------------------------------------------------------------------------------------------------------
-- Optional session labels
--------------------------------------------------------------------------------------------------------------

--night of play; per user, optional campaign link
create table public.game_sessions (
  id             bigint generated always as identity primary key,
  owner_id       uuid not null default auth.uid()
                 references public.profiles (id) on delete cascade,
  campaign_id    bigint references public.campaigns (id) on delete set null,
  session_number integer,
  title          text,
  played_on      date,
  created_at     timestamptz not null default now()
);

create index game_sessions_campaign_idx on public.game_sessions (campaign_id);


--------------------------------------------------------------------------------------------------------------
-- Imports
-- per user, not per character: one log holds every character's rolls
-- delete an import -> cascades to every roll it created
--------------------------------------------------------------------------------------------------------------

--one uploaded log file
create table public.imports (
  id              bigint generated always as identity primary key,
  owner_id        uuid not null default auth.uid()
                  references public.profiles (id) on delete cascade,
  game_session_id bigint references public.game_sessions (id) on delete set null,
  platform        public.source_platform not null,
  file_name       text,                     --'chatarchive.html', 'session-12-chat.txt'
  raw_log         text,                     --full uploaded file, kept for re-parse
  status          public.import_status not null default 'pending',
  rows_loaded     integer not null default 0,
  rows_skipped    integer not null default 0,   --duplicates of earlier imports
  rows_unparsed   integer not null default 0,   --left in import_staging with parse_error
  error_message   text,
  imported_at     timestamptz not null default now()
);

create index imports_owner_idx on public.imports (owner_id);


--------------------------------------------------------------------------------------------------------------
-- Roll data
-- one shared table; character_id = section tag (required)
--------------------------------------------------------------------------------------------------------------

--one roll event; owner_id denormalized from character for cheap RLS / per-user queries
create table public.rolls (
  id              bigint generated always as identity primary key,
  character_id    bigint not null references public.characters (id) on delete cascade,
  owner_id        uuid not null references public.profiles (id) on delete cascade,
  game_session_id bigint references public.game_sessions (id) on delete set null,
  import_id       bigint references public.imports (id) on delete cascade,
  roller_name     text not null,            --name as written in log
  rolled_at       timestamptz,
  platform        public.source_platform not null,
  formula         text not null,            --'1d20+5', '2d6+3', '4d6kh3'
  category        public.roll_category not null default 'custom',
  skill_code      text references public.skills (code),
  ability_code    text references public.abilities (code),
  roll_mode       public.roll_mode not null default 'normal',
  natural_d20     smallint check (natural_d20 between 1 and 20),  --kept d20 face, null if no d20
  modifier        integer not null default 0,
  total           integer not null,
  target_value    integer,                  --DC or AC, if logged
  --computed: total >= target_value; null when no target
  is_success      boolean generated always as (
                    case when target_value is null then null
                         else total >= target_value end
                  ) stored,
  is_hidden       boolean not null default false,  --GM / blind roll
  raw_text        text not null,            --source log entry
  dedupe_key      text not null,            --message id or fingerprint; set by load_import
  created_at      timestamptz not null default now(),
  unique (character_id, platform, dedupe_key)  --blocks double-count on re-upload
);

--FKs not auto-indexed in Postgres (InnoDB does); index per-character query paths
create index rolls_character_skill_idx    on public.rolls (character_id, skill_code);
create index rolls_character_category_idx on public.rolls (character_id, category);
create index rolls_character_time_idx     on public.rolls (character_id, rolled_at);
create index rolls_session_idx            on public.rolls (game_session_id);
create index rolls_import_idx             on public.rolls (import_id);
create index rolls_owner_idx              on public.rolls (owner_id);

--one physical die in a roll; advantage = 2 rows, 1 kept
create table public.roll_dice (
  id        bigint generated always as identity primary key,
  roll_id   bigint not null references public.rolls (id) on delete cascade,
  die_order smallint not null,               --1..n within roll
  sides     smallint not null check (sides >= 2),
  face      smallint not null,
  is_kept   boolean not null default true,
  check (face between 1 and sides),
  unique (roll_id, die_order)
);


--------------------------------------------------------------------------------------------------------------
-- Import staging
-- per-platform parser writes here; loader is platform-agnostic
-- loose columns so bad rows are kept and inspectable
--------------------------------------------------------------------------------------------------------------

--one parsed roll entry awaiting load_import
create table public.import_staging (
  id             bigint generated always as identity primary key,
  import_id      bigint not null references public.imports (id) on delete cascade,
  line_number    integer,
  rolled_at      timestamptz,
  roller_name    text,
  formula        text,
  dice           jsonb,     --[{"sides":20,"face":17,"kept":true}, ...]
  modifier       integer,
  total          integer,
  category       text,      --roll_category value, else -> 'custom'
  skill          text,      --skills.code, else -> null
  ability        text,      --'STR'..'CHA'
  roll_mode      text,      --'normal' | 'advantage' | 'disadvantage'
  target_value   integer,
  source_message_id text,   --platform message id; Roll20 has one, Foundry .txt does not
  raw_text       text not null,   --source entry, verbatim
  parse_error    text             --null = parsed; else reason; row held for review
);

create index import_staging_import_idx on public.import_staging (import_id);


--------------------------------------------------------------------------------------------------------------
-- Functions
--------------------------------------------------------------------------------------------------------------

--tag staged rows to characters, load into rolls + roll_dice, update import counts
--params:  p_import_id (bigint) import to load
--output:  integer, rolls loaded (skipped/unparsed counts written to imports row)
create function public.load_import(p_import_id bigint)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_import  public.imports;
  v_row     public.import_staging;
  v_char_id bigint;
  v_roll_id bigint;
  v_loaded  integer := 0;
  v_skipped integer := 0;
  v_errors  integer;
begin
  --fetch import; RLS hides other users' imports -> not found
  select * into v_import from public.imports where id = p_import_id;
  if not found then
    raise exception 'Import % not found', p_import_id;
  end if;

  --loop parseable rows only; parse_error rows stay for review
  for v_row in
    select * from public.import_staging
     where import_id = p_import_id
       and parse_error is null
       and total is not null
     order by line_number
  loop
    --resolve character: name match, case-insensitive
    select c.id into v_char_id
      from public.characters c
     where c.owner_id = v_import.owner_id
       and lower(c.name) = lower(coalesce(v_row.roller_name, 'Unknown'))
     limit 1;

    --fallback: alias match
    if v_char_id is null then
      select a.character_id into v_char_id
        from public.character_aliases a
       where a.owner_id = v_import.owner_id
         and lower(a.alias) = lower(coalesce(v_row.roller_name, 'Unknown'))
       limit 1;
    end if;

    --fallback: create character; no roll left untagged
    if v_char_id is null then
      insert into public.characters (owner_id, name)
      values (v_import.owner_id, coalesce(v_row.roller_name, 'Unknown'))
      returning id into v_char_id;
    end if;

    insert into public.rolls (
      character_id, owner_id, game_session_id, import_id,
      roller_name, rolled_at, platform, formula,
      category, skill_code, ability_code, roll_mode,
      natural_d20, modifier, total, target_value, raw_text, dedupe_key
    )
    values (
      v_char_id,
      v_import.owner_id,
      v_import.game_session_id,
      v_import.id,
      coalesce(v_row.roller_name, 'Unknown'),
      v_row.rolled_at,
      v_import.platform,
      coalesce(v_row.formula, '?'),
      --category: valid enum value, else 'custom'
      case when lower(v_row.category) in (select unnest(enum_range(null::public.roll_category))::text)
           then lower(v_row.category)::public.roll_category
           else 'custom' end,
      --skill / ability: keep only known codes
      (select s.code from public.skills s where s.code = lower(v_row.skill)),
      (select ab.code from public.abilities ab where ab.code = upper(v_row.ability)),
      case when lower(v_row.roll_mode) in ('advantage', 'disadvantage')
           then lower(v_row.roll_mode)::public.roll_mode
           else 'normal' end,
      --natural d20: first kept d20 in dice array
      (select (d ->> 'face')::smallint
         from jsonb_array_elements(v_row.dice) d
        where (d ->> 'sides')::int = 20 and coalesce((d ->> 'kept')::boolean, true)
        limit 1),
      coalesce(v_row.modifier, 0),
      v_row.total,
      v_row.target_value,
      v_row.raw_text,
      --dedupe key, best source first:
      --  1. platform message id (Roll20)
      --  2. md5(timestamp | roller | raw_text): catches overlapping exports
      --  3. md5(import id + line): no timestamp, identical rolls indistinguishable
      coalesce(
        nullif(v_row.source_message_id, ''),
        md5(case when v_row.rolled_at is not null
                 then v_row.rolled_at::text || '|' || coalesce(v_row.roller_name, '') || '|' || v_row.raw_text
                 else 'import ' || v_import.id || ' line ' || coalesce(v_row.line_number, v_row.id) end)
      )
    )
    on conflict (character_id, platform, dedupe_key) do nothing   --MySQL: INSERT IGNORE
    returning id into v_roll_id;

    --null id = conflict = duplicate
    if v_roll_id is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    --explode dice array into roll_dice rows; ordinality -> die_order
    insert into public.roll_dice (roll_id, die_order, sides, face, is_kept)
    select v_roll_id,
           d.ord,
           (d.val ->> 'sides')::smallint,
           (d.val ->> 'face')::smallint,
           coalesce((d.val ->> 'kept')::boolean, true)
      from jsonb_array_elements(coalesce(v_row.dice, '[]'::jsonb)) with ordinality as d (val, ord);

    v_loaded := v_loaded + 1;
  end loop;

  --clear handled rows; parse_error rows remain
  delete from public.import_staging
   where import_id = p_import_id and parse_error is null and total is not null;

  select count(*) into v_errors from public.import_staging where import_id = p_import_id;

  update public.imports
     set status = 'processed', rows_loaded = v_loaded, rows_skipped = v_skipped, rows_unparsed = v_errors
   where id = p_import_id;

  return v_loaded;
end;
$$;

--fold a stray character into the real one; move rolls, keep old name as alias
--params:  p_from_id (bigint) stray character, deleted after merge
--         p_into_id (bigint) character that receives the rolls
--output:  integer, rolls moved (duplicates already on target are dropped, not counted)
create function public.merge_character(p_from_id bigint, p_into_id bigint)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_from  public.characters;
  v_into  public.characters;
  v_moved integer;
begin
  --guards: both exist, same owner, not self
  select * into v_from from public.characters where id = p_from_id;
  if not found then raise exception 'Character % not found', p_from_id; end if;
  select * into v_into from public.characters where id = p_into_id;
  if not found then raise exception 'Character % not found', p_into_id; end if;
  if v_from.owner_id is distinct from v_into.owner_id then
    raise exception 'Characters belong to different users';
  end if;
  if p_from_id = p_into_id then
    raise exception 'Cannot merge a character into itself';
  end if;

  --drop rolls the target already has; avoids unique violation on move
  delete from public.rolls r
   where r.character_id = p_from_id
     and exists (select 1 from public.rolls t
                  where t.character_id = p_into_id
                    and t.platform = r.platform
                    and t.dedupe_key = r.dedupe_key);

  update public.rolls set character_id = p_into_id where character_id = p_from_id;
  get diagnostics v_moved = row_count;   --MySQL: ROW_COUNT()

  --old name -> alias, so future imports land on target
  insert into public.character_aliases (owner_id, alias, character_id)
  values (v_from.owner_id, v_from.name, p_into_id)
  on conflict (owner_id, alias) do update set character_id = p_into_id;

  update public.character_aliases set character_id = p_into_id where character_id = p_from_id;

  delete from public.characters where id = p_from_id;

  return v_moved;
end;
$$;


--------------------------------------------------------------------------------------------------------------
-- Per-character analysis views
-- all group shared rolls table by character_id
-- security_invoker = true: view obeys caller's RLS (default would bypass it)
--------------------------------------------------------------------------------------------------------------

--headline stats, one row per character; left join keeps zero-roll characters
--output:  character_id, owner_id, character_name, campaign_id, roll_count, d20_count,
--         avg_natural_d20 (fair = 10.5), nat_20s, nat_1s, with_advantage, with_disadvantage,
--         success_rate (known-DC rolls only), first_roll_at, last_roll_at
create view public.character_roll_summary
with (security_invoker = true) as
select
  c.id                                                 as character_id,
  c.owner_id,
  c.name                                               as character_name,
  c.campaign_id,
  count(r.id)                                          as roll_count,       --count(r.id) not count(*): 0 for no rolls
  count(r.natural_d20)                                 as d20_count,
  round(avg(r.natural_d20), 2)                         as avg_natural_d20,
  count(*) filter (where r.natural_d20 = 20)           as nat_20s,
  count(*) filter (where r.natural_d20 = 1)            as nat_1s,
  count(*) filter (where r.roll_mode = 'advantage')    as with_advantage,
  count(*) filter (where r.roll_mode = 'disadvantage') as with_disadvantage,
  round(avg(case when r.is_success then 1.0 when r.is_success = false then 0.0 end), 3)
                                                       as success_rate,
  min(r.rolled_at)                                     as first_roll_at,
  max(r.rolled_at)                                     as last_roll_at
from public.characters c
left join public.rolls r on r.character_id = c.id
group by c.id, c.owner_id, c.name, c.campaign_id;

--stats per character per skill; skill + ability checks only
--output:  character_id, character_name, skill_code, roll_count, avg_natural_d20, avg_total,
--         nat_20s, nat_1s, with_advantage, with_disadvantage, success_rate
create view public.skill_roll_stats
with (security_invoker = true) as
select
  r.character_id,
  c.name                                               as character_name,
  r.skill_code,
  count(*)                                             as roll_count,
  round(avg(r.natural_d20), 2)                         as avg_natural_d20,
  round(avg(r.total), 2)                               as avg_total,
  count(*) filter (where r.natural_d20 = 20)           as nat_20s,
  count(*) filter (where r.natural_d20 = 1)            as nat_1s,
  count(*) filter (where r.roll_mode = 'advantage')    as with_advantage,
  count(*) filter (where r.roll_mode = 'disadvantage') as with_disadvantage,
  round(avg(case when r.is_success then 1.0 when r.is_success = false then 0.0 end), 3)
                                                       as success_rate
from public.rolls r
join public.characters c on c.id = r.character_id
where r.category in ('skill_check', 'ability_check')
group by r.character_id, c.name, r.skill_code;

--face frequency vs fair die, per character per die size; counts dropped advantage dice too
--output:  character_id, sides, face, times_rolled, total_dice, observed_share, expected_share (1/sides)
create view public.die_face_distribution
with (security_invoker = true) as
select
  r.character_id,
  d.sides,
  d.face,
  count(*)                                                     as times_rolled,
  sum(count(*)) over (partition by r.character_id, d.sides)     as total_dice,   --window: total per die size
  round(count(*)::numeric
        / sum(count(*)) over (partition by r.character_id, d.sides), 4)
                                                               as observed_share,
  round(1.0 / d.sides, 4)                                      as expected_share
from public.roll_dice d
join public.rolls r on r.id = d.roll_id
group by r.character_id, d.sides, d.face;

--per character per session; trend over time
--output:  character_id, game_session_id, session_number, played_on, roll_count,
--         avg_natural_d20, nat_20s, nat_1s
create view public.character_session_stats
with (security_invoker = true) as
select
  r.character_id,
  r.game_session_id,
  gs.session_number,
  gs.played_on,
  count(*)                                   as roll_count,
  round(avg(r.natural_d20), 2)               as avg_natural_d20,
  count(*) filter (where r.natural_d20 = 20) as nat_20s,
  count(*) filter (where r.natural_d20 = 1)  as nat_1s
from public.rolls r
left join public.game_sessions gs on gs.id = r.game_session_id
group by r.character_id, r.game_session_id, gs.session_number, gs.played_on;


--------------------------------------------------------------------------------------------------------------
-- Row-level security
-- Supabase exposes tables to browser; these policies are the access control
-- sharing is per character: public character -> its rolls readable by anyone
--------------------------------------------------------------------------------------------------------------

--true if caller may read character (public, or caller owns it)
--params:  p_character_id (bigint) character to check
--output:  boolean
create function public.can_read_character(p_character_id bigint)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.characters c
     where c.id = p_character_id
       and (c.is_public or c.owner_id = (select auth.uid()))
  );
$$;

--lock every table; policies below open specific access
alter table public.abilities         enable row level security;
alter table public.skills            enable row level security;
alter table public.profiles          enable row level security;
alter table public.campaigns         enable row level security;
alter table public.characters        enable row level security;
alter table public.character_aliases enable row level security;
alter table public.game_sessions     enable row level security;
alter table public.imports           enable row level security;
alter table public.import_staging    enable row level security;
alter table public.rolls             enable row level security;
alter table public.roll_dice         enable row level security;

--lookups: read all
create policy "anyone reads abilities" on public.abilities for select using (true);
create policy "anyone reads skills"    on public.skills    for select using (true);

--profiles: read all, edit own
create policy "anyone reads profiles" on public.profiles for select using (true);
create policy "user edits own profile" on public.profiles for update
  to authenticated using (id = (select auth.uid()));

--characters: read public or own, write own
create policy "read public or own characters" on public.characters for select
  using (is_public or owner_id = (select auth.uid()));
create policy "owner manages characters" on public.characters for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

--rolls: read if character readable; hidden rolls owner-only
create policy "read rolls of readable characters" on public.rolls for select
  using (public.can_read_character(character_id)
         and (not is_hidden or owner_id = (select auth.uid())));
--rolls write: own roll AND own character (else others could file rolls under your character)
create policy "owner manages rolls" on public.rolls for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.characters c
                 where c.id = character_id and c.owner_id = (select auth.uid()))
  );

--roll_dice: no character_id; checks via parent roll (subquery obeys rolls RLS)
create policy "read dice of readable rolls" on public.roll_dice for select
  using (exists (select 1 from public.rolls r where r.id = roll_id));
create policy "owner manages dice" on public.roll_dice for all
  to authenticated
  using (exists (select 1 from public.rolls r
                  where r.id = roll_id and r.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.rolls r
                       where r.id = roll_id and r.owner_id = (select auth.uid())));

--aliases: read with character; write own alias AND own character
create policy "read aliases of readable characters" on public.character_aliases for select
  using (public.can_read_character(character_id));
create policy "owner manages aliases" on public.character_aliases for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.characters c
                 where c.id = character_id and c.owner_id = (select auth.uid()))
  );

--campaigns / sessions: labels on shared pages; read all, write own
create policy "anyone reads campaigns" on public.campaigns for select using (true);
create policy "owner manages campaigns" on public.campaigns for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "anyone reads sessions" on public.game_sessions for select using (true);
create policy "owner manages sessions" on public.game_sessions for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

--imports / staging: uploader only
create policy "owner manages imports" on public.imports for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "owner manages staging" on public.import_staging for all
  to authenticated
  using (exists (select 1 from public.imports i
                  where i.id = import_id and i.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.imports i
                       where i.id = import_id and i.owner_id = (select auth.uid())));
