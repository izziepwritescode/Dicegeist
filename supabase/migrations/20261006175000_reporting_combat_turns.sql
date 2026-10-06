-- Dicegeist reporting: combat turns (damage efficiency, crit damage, character face-off)
-- Usage Syntax: applied as migration 20261006175000_reporting_combat_turns; powerbi_reader picks it up via default privileges

--------------------------------------------------------------------------------------------------------------
-- Outline
--   combat_turns     one row per character x combat turn
--
-- Constants
--   turn gap         90 seconds between attack / damage rolls -> new turn (no log stores rounds)
--
-- Notes
--   only labelled attack and damage rows count; hand-typed /r rolls (category custom) are left out,
--   same as total damage everywhere else
--   Roll20 crits: the sheet's normal damage button was used, so logged crit damage is the base roll;
--   extra crit dice typed by hand are not counted
--------------------------------------------------------------------------------------------------------------

create or replace view reporting.combat_turns as
with base as (
  --attack and damage rows only; flag a new turn after a 90s gap (lag = cell above)
  select r.id, r.character_id, r.rolled_at, r.category, r.natural_d20, r.total, r.is_spell,
         case when lag(r.rolled_at) over w is null
                or r.rolled_at - lag(r.rolled_at) over w > interval '90 seconds'
              then 1 else 0 end as is_new_turn
  from public.rolls r
  where r.category in ('attack', 'damage')
  window w as (partition by r.character_id order by r.rolled_at, r.id)
),
numbered as (
  --running total of the flags -> turn number 1..n per character
  select b.*,
         sum(b.is_new_turn) over (partition by b.character_id order by b.rolled_at, b.id
                                  rows unbounded preceding) as turn_no
  from base b
)
select
  n.character_id,
  n.turn_no::int                                                as turn_no,
  min(n.rolled_at)                                              as started_at,
  count(*) filter (where n.category = 'attack')                 as attack_rolls,
  count(*) filter (where n.category = 'attack' and n.natural_d20 = 20) as crit_attacks,
  count(*) filter (where n.category = 'damage')                 as damage_rolls,
  coalesce(sum(n.total) filter (where n.category = 'damage'), 0) as damage,
  coalesce(sum(n.total) filter (where n.category = 'damage' and n.is_spell), 0) as spell_damage,
  bool_or(n.category = 'attack' and n.natural_d20 = 20)         as is_crit_turn
from numbered n
group by n.character_id, n.turn_no;
