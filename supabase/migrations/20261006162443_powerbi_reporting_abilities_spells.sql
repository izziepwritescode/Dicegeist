-- Power BI reporting v2: rolls_fact gains ability_code / ability_order (initiative -> DEX), spell_level_filled, spell_level_source, is_spell_cast
-- Usage Syntax: migration; applied live 2026-10-06. Columns appended at end -> create or replace works without dropping dependents

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
),
spell_attacks as (
  --spells this character rolls attacks for; their damage rows aren't separate casts
  select distinct r.character_id, r.spell_name
  from public.rolls r
  where r.is_spell and r.category = 'attack'
),
spell_base as (
  --base (lowest) level per spell; fills logs with no level (all Foundry, Divine Smite). upcasts not visible
  select * from (values
    ('Eldritch Blast', 0), ('Fire Bolt', 0), ('Thorn Whip', 0), ('Shocking Grasp', 0), ('Chill Touch', 0),
    ('Chromatic Orb', 1), ('Guiding Bolt', 1), ('Witch Bolt', 1), ('Cure Wounds', 1), ('Healing Word', 1),
    ('Hunter''s Mark', 1), ('Thunderous Smite', 1), ('Divine Smite', 1),
    ('Scorching Ray', 2), ('Shatter', 2), ('Fireball', 3), ('Hunger of Hadar', 3), ('Blight', 4)
  ) as v(spell_name, base_level)
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
  s.is_hidden,
  ab.code                                                       as ability_code, --STR..CHA
  case ab.code when 'STR' then 1 when 'DEX' then 2 when 'CON' then 3
               when 'INT' then 4 when 'WIS' then 5 when 'CHA' then 6 end as ability_order, --sort key
  coalesce(s.spell_level, sb.base_level)                        as spell_level_filled,
  case when s.spell_level is not null then 'log'
       when sb.base_level is not null then 'base level lookup' end as spell_level_source,
  coalesce(s.is_spell and (s.category = 'attack' or sa.spell_name is null), false) as is_spell_cast
    --1 cast = 1 spell attack roll (per beam / ray), else 1 damage / healing roll
from sess s
join public.characters c            on c.id = s.character_id
left join public.skills_abilities sk on sk.code = s.skill_code
left join public.skills_abilities ab on ab.code = coalesce(s.ability_code, sk.ability_code,
                                     case when s.category = 'initiative' then 'DEX' end) --initiative = DEX check
left join dice dc                   on dc.roll_id = s.id
left join spell_attacks sa          on sa.character_id = s.character_id and sa.spell_name = s.spell_name
left join spell_base sb             on sb.spell_name = s.spell_name;