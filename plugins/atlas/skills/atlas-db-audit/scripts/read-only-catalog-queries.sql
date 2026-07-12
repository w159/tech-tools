-- Read-only catalog query templates for the database audit.
-- Every query here is SELECT-only against information_schema and pg_catalog.
-- The bundled hooks/validate-readonly-query.sh guard blocks any statement
-- that is not a SELECT before it runs. Do not add INSERT/UPDATE/DELETE/DDL/GRANT
-- here; the guard will block them and the audit is read-only by contract.
--
-- Usage: a prober agent sources these templates, fills <placeholders>, and runs
-- them against the live database read-only. Each result is evidence.

-- 1. Tables and their row-level security state
SELECT
  n.nspname  AS schema,
  c.relname  AS table_name,
  c.relkind,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p')          -- ordinary + partitioned tables
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, c.relname;

-- 2. Columns with types
SELECT
  table_schema,
  table_name,
  column_name,
  ordinal_position,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY table_schema, table_name, ordinal_position;

-- 3. Constraints (primary, foreign, unique, check)
SELECT
  n.nspname AS schema,
  c.conname AS constraint_name,
  c.contype AS constraint_type,   -- p=PK, f=FK, u=unique, c=check
  cl.relname AS table_name,
  cl2.relname AS foreign_table
FROM pg_catalog.pg_constraint c
JOIN pg_catalog.pg_namespace n ON n.oid = c.connamespace
LEFT JOIN pg_catalog.pg_class cl  ON cl.oid  = c.conrelid
LEFT JOIN pg_catalog.pg_class cl2 ON cl2.oid = c.confrelid
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, cl.relname, c.contype;

-- 4. Indexes
SELECT
  schemaname,
  relname AS table_name,
  indexrelname AS index_name,
  indexdef
FROM pg_catalog.pg_indexes
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY schemaname, relname, indexrelname;

-- 5. RLS policies (who can do what under RLS)
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,           -- SELECT | INSERT | UPDATE | DELETE
  qual,           -- USING expression
  with_check      -- WITH CHECK expression
FROM pg_catalog.pg_policies
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY schemaname, tablename, policyname;

-- 6. Grants (who has what on tables)
SELECT
  grantee,
  table_schema,
  table_name,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY grantee, table_schema, table_name, privilege_type;

-- 7. Roles and their membership
SELECT
  r.rolname AS role,
  r.rolsuper,
  r.rolinherit,
  r.rolcreaterole,
  r.rolcreatedb,
  r.rolcanlogin,
  m.roleid::regrole AS member_of
FROM pg_catalog.pg_roles r
LEFT JOIN pg_catalog.pg_auth_members m ON m.member = r.oid
ORDER BY r.rolname;

-- 8. Sequences
SELECT
  sequence_schema,
  sequence_name,
  data_type,
  start_value,
  minimum_value,
  maximum_value,
  increment
FROM information_schema.sequences
WHERE sequence_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY sequence_schema, sequence_name;

-- 9. Functions (names + arg types + security definer flag)
SELECT
  n.nspname AS schema,
  p.proname AS function_name,
  pg_get_function_arguments(p.oid) AS arguments,
  pg_get_function_result(p.oid)  AS result,
  p.prosecdef AS security_definer,
  l.lanname AS language
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
JOIN pg_catalog.pg_language l  ON l.oid = p.prolang
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, p.proname;