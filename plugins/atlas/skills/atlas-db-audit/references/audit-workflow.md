# Audit Workflow

The read-only database audit runs four investigations in parallel, each in a
fresh context, then synthesizes in the main context. This reference documents
the workflow and the three agent roles the skill dispatches.

## Hard constraint: read-only

Nothing in this audit may change the database or the code. The only outputs are
a findings report and a remediation plan the user reviews before anything
changes. The bundled guard at `hooks/validate-readonly-query.sh` is installed
as a PreToolUse(Bash) hook on every audit subagent so any SQL write, DDL,
GRANT/REVOKE, or other privilege statement is blocked before it runs.

## Inputs

Read from `$ARGUMENTS`:
1. **Repo path** - the backend code that talks to the database.
2. **DB connection** - how to reach the live database read-only (psql args, a
   connection string, or the env var that holds it).
3. **Glossary path** (optional) - a file mapping business terms to canonical
   code/db names.
4. **Naming-convention notes** (optional) - any naming transition to check.

If the DB connection or repo path is missing or ambiguous, ask once, then
proceed.

## The four parallel investigations

| # | Investigation | Dispatched agent | Writes to |
|---|---|---|---|
| 1 | Schema inventory | atlas:schema-inventory | `.audit/schema.json` |
| 2 | Code-usage map | atlas:explorer | `.audit/code-usage.json` |
| 3 | Privileges (RLS + grants) | atlas:rls-privilege-audit | `.audit/privileges.json` |
| 4 | Naming (glossary + conventions) | atlas:naming-glossary-audit | `.audit/naming.json` |

Each subagent writes detailed findings to its own file under `.audit/` and
returns only a short structured summary plus that file path, so the main
context stays lean.

## Agent roles

### atlas:schema-inventory (role 1)

Read-only PostgreSQL catalog inventory. Enumerates tables, columns, types,
constraints, indexes, sequences, functions, and RLS flags from the live
database via `information_schema` and catalog tables. Returns a full catalog
snapshot with evidence (catalog query results). Never writes to the DB.

### atlas:rls-privilege-audit (role 3)

Read-only PostgreSQL security audit of row-level security, table grants, and
roles against least privilege. Measures who can read/write what, and where the
runtime role has more than it needs. Returns findings with evidence (catalog
query results). Never writes, never grants, never revokes.

### atlas:naming-glossary-audit (role 4)

Read-only audit of table and column names against the project glossary and the
user-supplied naming-convention notes. Flags drift and mismatches (e.g. an old
prefix that should become a new prefix). Returns findings with evidence. Never
writes.

### atlas:explorer (role 2)

Read-only codebase explorer. Maps every database object the backend code
references and exactly where, with file:line for each reference. Returns a
compact map, not dumps.

## Grounding

Each subagent reports only what a tool result confirms - a catalog query
result, or a file and line. Anything it cannot verify it labels UNVERIFIED. No
finding may rest on a name alone or on training-data assumptions.

## Synthesis (main context, after all four return)

1. Reconcile inventory against code usage. Objects no code references are dead
   CANDIDATES only - a migration, scheduled job, or external consumer may still
   use them - so mark them for confirmation, never for automatic deletion.
2. Objects the code references but absent from the database are drift or bugs;
   rank these high.
3. Fold in the privilege and naming findings.
4. Produce one report ranked by severity: privilege and isolation gaps first,
   then missing or expected-but-absent objects, then nomenclature, then dead
   candidates. Each item carries its evidence and a specific recommendation.
5. Build a remediation plan (rename map, grant changes, drop candidates) but DO
   NOT execute it. Renames, grants, and drops are destructive and
   irreversible. STOP and hand the plan to the user for approval.

## Verify

- Run a fresh-context atlas:verifier pass that re-checks the consolidated
  findings against the live catalog and the code, and flags any claim it cannot
  reproduce.
- Confirm with a real catalog query result that the read-only guard blocked at
  least one write attempt, or that no write was ever attempted.

## Query templates

`scripts/read-only-catalog-queries.sql` carries the read-only catalog query
templates the prober agents use. All queries are SELECT-only against
information_schema and catalog tables; none mutate.