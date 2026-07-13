---
name: atlas-db-audit
disable-model-invocation: true
description: 'Read-only database audit via parallel subagents: inventory a live schema, reconcile it against the code, and check privileges and naming before any change.'
when_to_use: inventory a live database schema, reconcile it against the code, and check privileges and naming before any change
allowed-tools: Read, Glob, Grep, Bash
paths: ["**/*.sql", "migrations/**", "supabase/**"]
argument-hint: '[repo path] [db connection] [glossary path] [naming-convention notes]'
---



Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `references/operating-contract.md` and apply it before proceeding.

Audit this database: $ARGUMENTS

Read the arguments as four inputs:
- Repo path: the backend code that talks to the database.
- DB connection: how to reach the live database read-only (psql args, a connection string, or the env var that holds it).
- Glossary path (optional): a file mapping business terms to canonical code/db names.
- Naming-convention notes (optional): any naming transition to check, described by you (for example an old prefix that should become a new prefix). Do not assume any specific scheme; use only what you supply.

If the DB connection or repo path is missing or ambiguous, ask once for it, then proceed.

This is READ-ONLY. Nothing here may change the database or the code. The only outputs are a findings report and a remediation plan you review before anything changes.

ENFORCE READ-ONLY:
- Install the bundled guard at `hooks/validate-readonly-query.sh` as a PreToolUse(Bash) hook on every audit subagent. The guard is a coarse denylist, NOT a "blocks any non-SELECT" guarantee. It matches a fixed set of SQL write/DDL/privilege structures: `DELETE FROM`, `INSERT INTO`, `REPLACE INTO`, `MERGE INTO`, `UPDATE <table> SET`, `TRUNCATE[ TABLE]`, `DROP|CREATE|ALTER` against `TABLE|DATABASE|SCHEMA|INDEX|VIEW|MATERIALIZED|SEQUENCE|TRIGGER|FUNCTION|ROLE|USER|EXTENSION|POLICY|PUBLICATION`, `GRANT|REVOKE ... ON`, and `COPY ... FROM|TO`. It does NOT catch every mutating statement: `CREATE OR REPLACE FUNCTION`, `CREATE TEMPORARY|UNLOGGED TABLE`, `CREATE AGGREGATE`, and `UPDATE|DELETE|INSERT` whose verb and target are split by SQL comments all pass the guard and can install persistent executable DB code or write rows. Enforce read-only at the database level (a read-only role or a replica) and treat the guard as defense-in-depth, not the boundary.
- Subagents query the catalog and read code. They never mutate.

Dispatch four investigations IN PARALLEL, each in a fresh context, each given only the inputs it needs. Each writes detailed findings to its own file under a `.audit/` directory and returns only a short structured summary plus that file path, so the main context stays lean:
1. Schema inventory (dispatch atlas:db-prober): a full catalog inventory of the live schema from information_schema and the catalog tables - tables, views, columns, types, constraints, indexes, sequences, functions.
2. Code-usage map (dispatch atlas:explorer): every database object the backend code references and exactly where, with file:line for each reference.
3. Privileges (dispatch atlas:db-prober): row-level-security policies, GRANTs, and roles measured against least privilege - who can read/write what, and where the runtime role has more than it needs.
4. Naming (dispatch atlas:explorer or general-purpose): object names checked against the glossary and the naming-convention notes you supplied; flag drift and mismatches.

GROUNDING: each subagent reports only what a tool result confirms - a catalog query result, or a file and line. Anything it cannot verify it labels UNVERIFIED. No finding may rest on a name alone or on training-data assumptions.

SYNTHESIS (main context, after all four return):
- Reconcile inventory against code usage. Objects no code references are dead CANDIDATES only - a migration, scheduled job, or external consumer may still use them - so mark them for confirmation, never for automatic deletion.
- Objects the code references but absent from the database are drift or bugs; rank these high.
- Fold in the privilege and naming findings.
- Produce one report ranked by severity: privilege and isolation gaps first, then missing or expected-but-absent objects, then nomenclature, then dead candidates. Each item carries its evidence and a specific recommendation.
- Build a remediation plan (rename map, grant changes, drop candidates) but DO NOT execute it. Renames, grants, and drops are destructive and irreversible. STOP and hand the plan to the user for approval.

VERIFY:
- Run a fresh-context atlas:verifier pass that re-checks the consolidated findings against the live catalog and the code, and flags any claim it cannot reproduce.
- Confirm with a real catalog query result that the read-only guard blocked at least one write attempt, or that no write was ever attempted.

REPORT:
- Lead with the outcome: the count and severity breakdown of findings, and the one or two decisions you need from the user.
- The ranked findings, each with its evidence (catalog query result or file:line) and recommendation. Write object names out in full.
- The remediation plan, marked NOT EXECUTED, awaiting approval.
- The atlas:verifier verdict and any claims it could not reproduce.
- The `.audit/` file paths holding the full detail.

## Supporting files
- `references/audit-workflow.md` - the four parallel investigations, the three
  agent roles (atlas:schema-inventory, atlas:rls-privilege-audit,
  atlas:naming-glossary-audit) and the explorer, grounding rules, and
  synthesis ranking order.
- `scripts/read-only-catalog-queries.sql` - SELECT-only catalog query
  templates the prober agents use (tables, columns, constraints, indexes, RLS
  policies, grants, roles, sequences, functions). The
  `hooks/validate-readonly-query.sh` guard is a coarse denylist that blocks
  the SQL write/DDL/privilege structures listed under ENFORCE READ-ONLY before
  they run. It is NOT a "blocks any non-SELECT" guarantee: `CREATE OR REPLACE
  FUNCTION`, `CREATE TEMPORARY|UNLOGGED TABLE`, `CREATE AGGREGATE`, and
  comment-split `UPDATE|DELETE|INSERT` pass it, so pair it with a read-only
  DB role or replica.
