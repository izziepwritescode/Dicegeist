-- Read-only Postgres login for Power BI; sees the reporting schema only
-- Usage Syntax: replace <PICK_A_PASSWORD>, then run once in the Supabase SQL editor (Dashboard -> SQL Editor)
--   Power BI username: powerbi_reader.xrwydjehpwaaxeexneid  (pooler wants role.projectref)

--------------------------------------------------------------------------------------------------------------
-- Outline
--   Role
--     powerbi_reader (login, read-only by default, 30s statement timeout)
--   Grants
--     usage on schema reporting; select on its views (current + future)
--   Check
--     list what the role can read
--------------------------------------------------------------------------------------------------------------


--------------------------------------------------------------------------------------------------------------
-- Role
--------------------------------------------------------------------------------------------------------------

--MySQL equivalent: CREATE USER 'powerbi_reader'@'%' IDENTIFIED BY '...'
create role powerbi_reader with login password '<PICK_A_PASSWORD>';
alter role powerbi_reader set default_transaction_read_only = on; --every session read-only, even if grants change
alter role powerbi_reader set statement_timeout = '30s';          --runaway refresh query -> cancelled


--------------------------------------------------------------------------------------------------------------
-- Grants
--------------------------------------------------------------------------------------------------------------

--MySQL equivalent: GRANT SELECT ON reporting.* TO 'powerbi_reader'@'%'
grant usage on schema reporting to powerbi_reader;
grant select on all tables in schema reporting to powerbi_reader; --"tables" includes views
alter default privileges in schema reporting grant select on tables to powerbi_reader; --views added later too
--no grants on public: views run as their owner, so the role never touches raw tables


--------------------------------------------------------------------------------------------------------------
-- Check
--------------------------------------------------------------------------------------------------------------

--expect 5 rows, all reporting.*, privilege SELECT
select table_schema, table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'powerbi_reader'
order by table_name;
