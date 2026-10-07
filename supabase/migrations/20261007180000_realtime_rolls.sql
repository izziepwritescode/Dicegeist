-- turn on Supabase Realtime for the tables the website listens to
-- Usage Syntax: paste into Supabase dashboard -> Dicegeist -> SQL Editor -> Run (or apply as a migration)
--------------------------------------------------------------------------------------------------------------
-- Outline
--   Realtime publication
--     supabase_realtime += rolls, characters
--------------------------------------------------------------------------------------------------------------

--------------------------------------------------------------------------------------------------------------
--Realtime publication
--change events stream to browsers only for tables in this publication; RLS still filters what anon receives
--without this the site falls back to a 60s auto-refresh
--------------------------------------------------------------------------------------------------------------

alter publication supabase_realtime add table public.rolls, public.characters;
