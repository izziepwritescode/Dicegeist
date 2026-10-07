-- Dicegeist: character_sheet(), one character's full stat sheet as JSON for the website's character page
-- Usage Syntax: select public.character_sheet(4);   -- website: supabase.rpc('character_sheet', { p_character_id: 4 })
--------------------------------------------------------------------------------------------------------------
-- Outline
--   character_sheet (function) -> jsonb
--     kpis        rolls, d20s, nat 20/1, avg vs expected d20, attacks + hits, damage, spells cast, healing
--     abilities   per ability: score, checks/skills/initiative count, avg + highest total and d20
--     attacks     hit basis counts + hit/miss per attack source
--     damage      by type (spell / weapon), spell vs weapon split, avg per roll, biggest roll, dice luck
--     spells      casts per level + per-spell casts / damage / healing
--     nights      per play night: d20 count, avg vs expected, nat 20s / 1s
--   Grants
--------------------------------------------------------------------------------------------------------------

--reads reporting.* (not exposed to the API), so security definer; visibility gate below copies characters RLS
--returns null when the character is missing or not public (and not the caller's own)
create or replace function public.character_sheet(p_character_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with visible as (
  --same rule as the characters read policy: public, or the logged-in owner
  select c.*
  from public.characters c
  where c.id = p_character_id
    and (c.is_public or c.owner_id = auth.uid())
), f as (
  select r.* from reporting.rolls_fact r join visible v on v.id = r.character_id
), roll20 as (
  --roll20 healing logs are incomplete -> healing left out (same as the dashboards)
  select coalesce(bool_and(platform = 'roll20'), false) as is_roll20 from f
), kpis as (
  select jsonb_build_object(
    'rolls',       count(*),
    'd20s',        count(natural_d20),
    'nat20s',      count(*) filter (where is_nat20),
    'nat1s',       count(*) filter (where is_nat1),
    'avgD20',      round(avg(natural_d20), 2),
    'expectedD20', round(avg(expected_natural_d20) filter (where natural_d20 is not null), 3), --after advantage / disadvantage
    'attacks',     count(*) filter (where category = 'attack'),
    'hits',        count(*) filter (where category = 'attack' and attack_hit),
    'damage',      coalesce(sum(total) filter (where category = 'damage'), 0),
    'spellDamage', coalesce(sum(total) filter (where category = 'damage' and damage_source = 'Spell'), 0),
    'spellsCast',  count(*) filter (where is_spell_cast),
    'healHP',      case when (select is_roll20 from roll20) then null
                        else coalesce(sum(heal_hp) filter (where category = 'healing' and counts_for_healing and not is_temp_hp), 0) end,
    'heals',       case when (select is_roll20 from roll20) then null
                        else count(*) filter (where category = 'healing' and counts_for_healing and not is_temp_hp) end,
    'tempHP',      case when (select is_roll20 from roll20) then null
                        else coalesce(sum(heal_hp) filter (where is_temp_hp), 0) end,
    'nights',      count(distinct play_session_no),
    'platform',    max(platform)
  ) as j
  from f
), abilities as (
  --ability checks + skills + initiative (initiative = DEX); saving throws left out
  select jsonb_agg(jsonb_build_object(
    'code',     a.code,
    'score',    a.score,
    'rolls',    coalesce(s.n, 0),
    'avgD20',   s.d20_avg,
    'avgTotal', s.total_avg,
    'maxTotal', s.total_max,
    'maxD20',   s.d20_max
  ) order by a.ord) as j
  from visible v
  cross join lateral (values
    (1, 'STR', v.str_score), (2, 'DEX', v.dex_score), (3, 'CON', v.con_score),
    (4, 'INT', v.int_score), (5, 'WIS', v.wis_score), (6, 'CHA', v.cha_score)
  ) as a(ord, code, score) --unpivot the six score columns, like UNPIVOT / M Table.Unpivot
  left join (
    select ability_code, count(*) as n,
           round(avg(natural_d20), 1) as d20_avg, round(avg(total), 1) as total_avg,
           max(total) as total_max, max(natural_d20) as d20_max
    from f
    where category in ('ability_check', 'skill_check', 'initiative')
    group by ability_code
  ) s on s.ability_code = a.code
), attack_sources as (
  select jsonb_agg(jsonb_build_object('source', attack_source, 'attacks', n, 'hits', h) order by n desc) as j
  from (
    select attack_source, count(*) as n, count(*) filter (where attack_hit) as h
    from f where category = 'attack' group by attack_source
  ) x
), attack_basis as (
  select jsonb_build_object(
    'loggedAC',       count(*) filter (where hit_basis = 'logged AC'),
    'damageEvidence', count(*) filter (where hit_basis = 'damage evidence'),
    'slider',         count(*) filter (where hit_basis = 'slider')
  ) as j
  from f where category = 'attack'
), damage_types as (
  select jsonb_agg(jsonb_build_object('type', t, 'source', s, 'rolls', n, 'damage', d) order by d desc) as j
  from (
    select coalesce(damage_type, 'Untyped') as t,
           case when damage_source = 'Spell' then 'Spell' else 'Weapon' end as s,
           count(*) as n, sum(total) as d
    from f where category = 'damage' group by 1, 2
  ) x
), damage_avgs as (
  select jsonb_build_object(
    'rolls',    count(*),
    'avg',      round(avg(total), 1),
    'spellAvg', round(avg(total) filter (where damage_source = 'Spell'), 1),
    'weaponAvg', round(avg(total) filter (where damage_source is distinct from 'Spell'), 1),
    'biggest',  max(total),
    'diceLuck', round(sum(kept_dice_sum) / nullif(sum(kept_dice_expected), 0), 3) --1.000 = dice rolled exactly average
  ) as j
  from f where category = 'damage'
), spell_levels as (
  select jsonb_agg(jsonb_build_object('level', spell_level_filled, 'casts', n) order by spell_level_filled nulls last) as j
  from (select spell_level_filled, count(*) as n from f where is_spell_cast group by 1) x
), spells as (
  select jsonb_agg(jsonb_build_object('name', spell_name, 'minLevel', lo, 'maxLevel', hi, 'casts', n, 'damage', d, 'healing', h)
                   order by n desc, d desc) as j
  from (
    select spell_name,
           min(spell_level_filled) filter (where is_spell_cast) as lo,
           max(spell_level_filled) filter (where is_spell_cast) as hi,
           count(*) filter (where is_spell_cast) as n,
           coalesce(sum(total) filter (where category = 'damage'), 0) as d,
           coalesce(sum(heal_hp) filter (where category = 'healing' and counts_for_healing and not is_temp_hp), 0) as h
    from f where spell_name is not null
    group by spell_name
    having count(*) filter (where is_spell_cast) > 0
  ) x
), nights as (
  select jsonb_agg(jsonb_build_object(
    'date', p.play_date, 'd20s', p.d20_count, 'avgD20', p.avg_natural_d20,
    'expectedD20', p.expected_natural_d20, 'nat20s', p.nat_20s, 'nat1s', p.nat_1s
  ) order by p.play_session_no) as j
  from reporting.play_sessions p join visible v on v.id = p.character_id
)
select case when exists (select 1 from visible) then jsonb_build_object(
  'kpis',        (select j from kpis),
  'abilities',   (select j from abilities),
  'attacks',     jsonb_build_object('basis', (select j from attack_basis), 'sources', coalesce((select j from attack_sources), '[]')),
  'damageTypes', coalesce((select j from damage_types), '[]'),
  'damage',      (select j from damage_avgs),
  'spellLevels', coalesce((select j from spell_levels), '[]'),
  'spells',      coalesce((select j from spells), '[]'),
  'nights',      coalesce((select j from nights), '[]')
) end;
$$;

--------------------------------------------------------------------------------------------------------------
-- Grants: website (anon) + logged-in users may call it; the gate inside decides what they see
--------------------------------------------------------------------------------------------------------------
revoke all on function public.character_sheet(bigint) from public;
grant execute on function public.character_sheet(bigint) to anon, authenticated;
