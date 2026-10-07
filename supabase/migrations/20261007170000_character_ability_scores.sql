-- Dicegeist: ability scores on characters (no log stores them; entered by Izzie 2026-10-07)
-- Usage Syntax: applied as migration 20261007170000_character_ability_scores

--------------------------------------------------------------------------------------------------------------
-- Outline
--   characters        + str_score .. cha_score (smallint, 1-30, null = not known yet)
--   characters_dim    restated with the six scores appended
--
-- Notes
--   Ivan Maddock (id 3) left null until Izzie sends his scores
--------------------------------------------------------------------------------------------------------------

alter table public.characters
  add column str_score smallint check (str_score between 1 and 30),
  add column dex_score smallint check (dex_score between 1 and 30),
  add column con_score smallint check (con_score between 1 and 30),
  add column int_score smallint check (int_score between 1 and 30),
  add column wis_score smallint check (wis_score between 1 and 30),
  add column cha_score smallint check (cha_score between 1 and 30);

--scores in STR DEX CON INT WIS CHA order
update public.characters c
set str_score = v.s, dex_score = v.d, con_score = v.co, int_score = v.i, wis_score = v.w, cha_score = v.ch
from (values
  (1,  9, 17, 14, 18, 12, 20),   --Lazlo
  (2, 18, 11, 11,  7, 14, 17),   --Vasha
  (4,  8, 14, 16, 10, 20, 14)    --Idris Ildroun
) as v(id, s, d, co, i, w, ch)
where c.id = v.id;

create or replace view reporting.characters_dim as
select c.id                                    as character_id,
       c.name                                  as character_name,
       c.campaign,
       c.class_name,
       c.level,
       string_agg(distinct f.platform, ', ')   as platforms,
       count(f.roll_id)                        as roll_count,
       count(distinct f.play_session_no)       as play_sessions,
       min(f.rolled_at)                        as first_roll_at,
       max(f.rolled_at)                        as last_roll_at,
       c.str_score, c.dex_score, c.con_score, c.int_score, c.wis_score, c.cha_score
from public.characters c
left join reporting.rolls_fact f on f.character_id = c.id
group by c.id, c.name, c.campaign, c.class_name, c.level,
         c.str_score, c.dex_score, c.con_score, c.int_score, c.wis_score, c.cha_score;
