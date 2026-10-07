-- Dicegeist: attack_outcomes, per-attack hit inferred from the damage rolled after it
-- Usage Syntax: applied as migration 20261007142236_attack_outcomes; rows loaded by analysis/hit_inference/sql/02_load_attack_outcomes.sql

--------------------------------------------------------------------------------------------------------------
-- Outline
--   attack_outcomes       one row per attack with damage evidence (no row -> dashboards use the AC slider)
--   RLS policies          read = whoever can read the attack row; write = its owner
--------------------------------------------------------------------------------------------------------------

--------------------------------------------------------------------------------------------------------------
-- table
--------------------------------------------------------------------------------------------------------------
create table if not exists public.attack_outcomes (
  roll_id       bigint primary key references public.rolls(id) on delete cascade, --the attack row
  inferred_hit  boolean  not null,                                                 --damage evidence says hit
  method        text     not null check (method in ('roll20_group', 'foundry_card')),
  group_size    smallint not null,             --attacks in the same group / usage card (multiattack)
  damage_rolls  smallint not null,             --sheet damage rolls matched to the group
  hand_rolls    smallint not null default 0,   --hand-typed damage dice after the group (crit dice, smite)
  rule_version  text     not null default 'v1 2026-10-07',
  created_at    timestamptz not null default now()
);

--------------------------------------------------------------------------------------------------------------
-- RLS
--------------------------------------------------------------------------------------------------------------
alter table public.attack_outcomes enable row level security;

--read: inherits the rolls select policy through the subquery
create policy "read outcomes of readable rolls" on public.attack_outcomes
  for select using (exists (select 1 from public.rolls r where r.id = roll_id));

--write: owner of the attack row
create policy "owner manages outcomes" on public.attack_outcomes
  for all to authenticated
  using (exists (select 1 from public.rolls r where r.id = roll_id and r.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.rolls r where r.id = roll_id and r.owner_id = (select auth.uid())));
