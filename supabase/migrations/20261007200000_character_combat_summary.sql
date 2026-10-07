-- Dicegeist: character_combat_summary, per-character combat totals for the website hover panel
-- Usage Syntax: select * from public.character_combat_summary where character_id = 1;
--------------------------------------------------------------------------------------------------------------
-- Outline
--   character_combat_summary (view)
--     attacks       attack rolls (weapon + spell attacks)
--     spells_cast   same rule as reporting.rolls_fact.is_spell_cast
--     total_damage  sum of damage roll totals
--------------------------------------------------------------------------------------------------------------

--security_invoker = true: obeys caller's RLS, anon only sees public characters (reporting.rolls_fact does not)
create or replace view public.character_combat_summary
with (security_invoker = true) as
with spell_attacks as (
  --spells that roll to hit; their damage rolls are not separate casts
  select distinct character_id, spell_name
  from public.rolls
  where is_spell and category = 'attack'
)
select
  c.id                                                  as character_id,
  count(r.id) filter (where r.category = 'attack')      as attacks,
  count(r.id) filter (where coalesce(
      r.is_spell
      and (r.category = 'attack' or sa.spell_name is null)                    --attack roll, or a save/auto spell
      and not (r.platform = 'foundry' and r.category = 'damage'
               and coalesce(substring(r.raw_text, '"flavor": "([^"]*)"'), '') = ''), --foundry follow-up dice, no card
      false))                                           as spells_cast,
  coalesce(sum(r.total) filter (where r.category = 'damage'), 0) as total_damage
from public.characters c
left join public.rolls r on r.character_id = c.id
left join spell_attacks sa on sa.character_id = r.character_id and sa.spell_name = r.spell_name
group by c.id;

grant select on public.character_combat_summary to anon, authenticated;
