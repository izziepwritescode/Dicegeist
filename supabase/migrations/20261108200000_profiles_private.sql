-- Dicegeist: profiles readable only by their owner (display names came from sign-up emails, so keep them off the public API)
-- Usage Syntax: applied by supabase db push / the Supabase MCP; nothing on the website reads profiles
--------------------------------------------------------------------------------------------------------------
-- Outline
--   profiles read policy
--------------------------------------------------------------------------------------------------------------

drop policy if exists "anyone reads profiles" on public.profiles;  --was: select using (true) for anon + authenticated
create policy "user reads own profile" on public.profiles for select
  to authenticated using (id = (select auth.uid()));                --logged-in owner only; anon sees no rows
