-- Dicegeist reporting schema: flat, dashboard-ready views for Power BI (one page per character)
-- Usage Syntax: run whole file once in Supabase SQL editor, or as migration 20261006161837_powerbi_reporting (applied live 2026-10-06)
--   then run 02_powerbi_reader_role.sql once to create the read-only login Power BI uses

--------------------------------------------------------------------------------------------------------------
-- Outline
--   Schema
--     reporting (not exposed by the Supabase REST API; Power BI reads it over a direct Postgres connection)
--   Fact views
--     rolls_fact       one row per roll; play-session number, flags, dice luck, metric-exclusion flags
--     dice_fact        one row per physical die (kept + dropped)
--   Summary views
--     play_sessions    one row per character x play night
--     die_fairness     one row per character x die size; chi-square test vs a fair die
--   Dimension view
--     characters_dim   one row per character
--   Grants
--     schema locked to postgres; read-only role granted in 02_powerbi_reader_role.sql
--
-- Constants
--   session gap      6 hours between rolls -> new play session (game_sessions table is empty)
--   local timezone   America/New_York, for play dates only; timestamps stay UTC
--   expected d20     normal 10.5 / advantage 13.825 / disadvantage 7.175
--   chi-square 0.05  critical values for d4, d6, d8, d10, d12, d20, d100
--
-- Data-quality rules (project decisions)
--   death saves      Roll20 excluded (hand-typed /r 1d20 saves are unlabelled) -> counts_for_death_saves
--   healing          Roll20 excluded (unreliable)                               -> counts_for_healing
--   spell damage     is_spell rows incl. spell attacks (Eldritch Blast) and Divine Smite -> damage_source 'Spell'
--
-- Security: views run with owner (postgres) rights, so they read past RLS. Fine for a private
-- reporting schema; never add 'reporting' to the API's exposed schemas.
--------------------------------------------------------------------------------------------------------------


--------------------------------------------------------------------------------------------------------------
-- Schema
--------------------------------------------------------------------------------------------------------------

create schema if not exists reporting;
revoke all on schema reporting from public, anon, authenticated; --no API / app access


--------------------------------------------------------------------------------------------------------------
-- Fact views
--------------------------------------------------------------------------------------------------------------

--one row per roll, everything a visual needs without joins
--play_session_no: rolls >6h apart start a new session (per character)
create or replace view reporting.rolls_fact as
with dice as (
  --per-roll dice totals; expected = (sides + 1) / 2 per kept die
  select d.roll_id,
         count(*)                                              as dice_count,
         sum(d.face) filter (where d.is_kept)                  as kept_dice_sum,
         sum((d.sides + 1) / 2.0) filter (where d.is_kept)     as kept_dice_expected
  from public.roll_dice d
  group by d.roll_id
),
gaps as (
  --flag first roll of each play session; lag() = previous row's value (Excel: cell above)
  select r.*,
         case when lag(r.rolled_at) over w is null
                or r.rolled_at - lag(r.rolled_at) over w > interval '6 hours'
              then 1 else 0 end as is_new_session
  from public.rolls r
  window w as (partition by r.character_id order by r.rolled_at, r.id)
),
sess as (
  --running total of the flags -> session number 1..n
  select g.*,
         sum(g.is_new_session) over (partition by g.character_id order by g.rolled_at, g.id
                                     rows unbounded preceding) as play_session_no
  from gaps g
)
select
  s.id                                                          as roll_id,
  s.character_id,
  c.name                                                        as character_name,
  s.platform::text                                              as platform,
  s.play_session_no::int                                        as play_session_no,
  min((s.rolled_at at time zone 'America/New_York')::date)
    over (partition by s.character_id, s.play_session_no)       as play_date, --session start date, local
  s.rolled_at,                                                  --UTC
  s.category::text                                              as category,
  initcap(replace(s.category::text, '_', ' '))                  as category_label, --skill_check -> Skill Check
  case when s.category in ('skill_check') then sk.name
       when s.category in ('ability_check', 'saving_throw') then ab.name
  end                                                           as check_name,
  ab.name                                                       as ability_name, --skills carry their ability too
  s.roll_mode::text                                             as roll_mode,
  s.formula,
  s.natural_d20,
  case s.roll_mode when 'advantage' then 13.825 when 'disadvantage' then 7.175 else 10.5 end
    * case when s.natural_d20 is null then null else 1 end      as expected_natural_d20, --null when no d20
  (s.natural_d20 = 20)                                          as is_nat20,
  (s.natural_d20 = 1)                                           as is_nat1,
  s.modifier,
  s.total,
  s.target_value,
  s.is_success,
  s.is_spell,
  s.spell_name,
  s.spell_level,
  s.damage_type,
  case when s.category = 'damage' then case when s.is_spell then 'Spell' else 'Weapon / other' end
  end                                                           as damage_source,
  coalesce(s.spell_name, case when s.category = 'attack' then 'Weapon attack' end) as attack_source,
  dc.dice_count,
  dc.kept_dice_sum,
  dc.kept_dice_expected,
  case when s.category = 'death_save' then
    case when s.natural_d20 = 20 then 'Nat 20 (back up)'
         when s.natural_d20 = 1  then 'Nat 1 (two fails)'
         when s.total >= 10      then 'Success'
         else 'Fail' end
  end                                                           as death_save_result,
  (s.platform <> 'roll20')                                      as counts_for_death_saves, --Roll20 excluded
  (s.platform <> 'roll20')                                      as counts_for_healing,     --Roll20 excluded
  s.is_hidden
from sess s
join public.characters c            on c.id = s.character_id
left join public.skills_abilities sk on sk.code = s.skill_code
left join public.skills_abilities ab on ab.code = coalesce(s.ability_code, sk.ability_code)
left join dice dc                   on dc.roll_id = s.id;

--one row per physical die, kept and dropped (advantage = 2 d20 rows, 1 kept)
create or replace view reporting.dice_fact as
select
  d.id                    as die_id,
  d.roll_id,
  r.character_id,
  d.sides,
  'd' || d.sides          as die,      --label for axis / slicer
  d.face,
  d.is_kept,
  r.category::text        as category,
  r.roll_mode::text       as roll_mode
from public.roll_dice d
join public.rolls r on r.id = d.roll_id;


--------------------------------------------------------------------------------------------------------------
-- Summary views
--------------------------------------------------------------------------------------------------------------

--one row per character x play session; feeds the luck-over-time line
create or replace view reporting.play_sessions as
select
  f.character_id,
  f.play_session_no,
  min(f.play_date)                                              as play_date,
  min(f.rolled_at)                                              as started_at,
  max(f.rolled_at)                                              as ended_at,
  count(*)                                                      as roll_count,
  count(f.natural_d20)                                          as d20_count,
  round(avg(f.natural_d20), 2)                                  as avg_natural_d20,
  round(avg(f.expected_natural_d20), 3)                         as expected_natural_d20,
  count(*) filter (where f.is_nat20)                            as nat_20s,
  count(*) filter (where f.is_nat1)                             as nat_1s,
  sum(f.total) filter (where f.category = 'damage')             as damage_rolled
from reporting.rolls_fact f
group by f.character_id, f.play_session_no;

--chi-square goodness-of-fit per character x die size (all physical dice, kept + dropped)
--chi_square > critical_value_05 -> under 5% chance a fair die lands this unevenly
create or replace view reporting.die_fairness as
with counts as (
  select r.character_id, d.sides::int as sides, d.face::int as face, count(*) as times_rolled
  from public.roll_dice d
  join public.rolls r on r.id = d.roll_id
  group by 1, 2, 3
),
sizes as (
  select character_id, sides, sum(times_rolled) as dice_rolled
  from counts
  group by 1, 2
),
grid as (
  --every face 1..sides, zero-filled; a face never rolled still counts in the test
  select s.character_id, s.sides, s.dice_rolled, f.face,
         coalesce(c.times_rolled, 0)            as times_rolled,
         s.dice_rolled::numeric / s.sides       as expected_count
  from sizes s
  cross join lateral generate_series(1, s.sides) as f(face)
  left join counts c on c.character_id = s.character_id and c.sides = s.sides and c.face = f.face
),
stats as (
  select character_id, sides, dice_rolled,
         sum((times_rolled - expected_count) ^ 2 / expected_count)   as chi_square,
         sum(face * times_rolled)::numeric / dice_rolled              as avg_face,
         min(expected_count)                                          as expected_per_face
  from grid
  group by character_id, sides, dice_rolled
)
select
  st.character_id,
  st.sides,
  'd' || st.sides                                               as die,
  st.dice_rolled,
  round(st.avg_face, 2)                                         as avg_face,
  (st.sides + 1) / 2.0                                          as expected_avg_face,
  st.sides - 1                                                  as degrees_of_freedom,
  round(st.chi_square, 2)                                       as chi_square,
  cv.critical_value_05,
  case when st.expected_per_face < 5  then 'Not enough rolls' --test unreliable below 5 per face
       when cv.critical_value_05 is null then 'No test for this die'
       when st.chi_square > cv.critical_value_05 then 'Cursed (p < 0.05)'
       else 'Looks fair' end                                    as verdict
from stats st
left join (values (4, 7.815), (6, 11.070), (8, 14.067), (10, 16.919),
                  (12, 19.675), (20, 30.144), (100, 123.225))
  as cv(sides, critical_value_05) on cv.sides = st.sides;     --chi-square table, alpha 0.05, df = sides - 1


--------------------------------------------------------------------------------------------------------------
-- Dimension view
--------------------------------------------------------------------------------------------------------------

--one row per character; slicer / page filter source
create or replace view reporting.characters_dim as
select
  c.id                                                          as character_id,
  c.name                                                        as character_name,
  c.campaign,
  c.class_name,
  c.level,
  string_agg(distinct f.platform, ', ')                         as platforms,
  count(f.roll_id)                                              as roll_count,
  count(distinct f.play_session_no)                             as play_sessions,
  min(f.rolled_at)                                              as first_roll_at,
  max(f.rolled_at)                                              as last_roll_at
from public.characters c
left join reporting.rolls_fact f on f.character_id = c.id
group by c.id, c.name, c.campaign, c.class_name, c.level;
