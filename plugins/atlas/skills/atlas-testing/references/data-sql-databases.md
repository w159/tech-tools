# Testing SQL, databases, migrations, and data pipelines

Covers SQL linting, database unit tests, schema migrations, RLS and authorization, data quality, data contracts, query performance, and test data. Regulatory note up front: for client data, authorization tests (row level security, per-role grants) and PII handling in test fixtures are compliance obligations under FTC Safeguards and SEC Reg S-P, not optional extras. Priority scoring in this file therefore ranks authz tests and PII masking highest, then migration safety, then lint and quality.

## Contents

- At a glance
- Recommended default stack
- Config snippets
- Gotchas
- Sources

## At a glance

| TYPE ID | Tool (current version) | Install | Run | Notes |
| --- | --- | --- | --- | --- |
| static-lint | sqlfluff (SQL lint + fix); squawk (PostgreSQL migration linter); Atlas lint (ariga/atlas) | sqlfluff: pip; squawk: npm i -g squawk-cli; atlas brew | sqlfluff lint --dialect postgres .; sqlfluff fix .; squawk migrations/*.sql | sqlfluff 4.4.0 current (2026-10); supports dbt templater; per-dialect config in .sqlfluff. squawk rules include ban-drop-table, require-concurrent-index-creation, adding-required-field, prefer-timestamptz |
| type-check | sqlfluff parse errors; Atlas schema lint (desired schema vs policy) | atlas binary | atlas schema lint --env prod | Atlas analyzers cover destructive (DS*), data-dependent (MF*), backward-incompatible (BC*), table locks (MY*), concurrent index policy (PG101-109), naming (NM*) |
| unit | pgTAP (PostgreSQL, TAP assertions); tSQLt (SQL Server); dbt unit tests | pgtap extension + pg_prove; tSQLt CLR from tsqlt.org; dbt built in (pip dbt-core) | pg_prove -d testdb tests/*.sql; runtests() for xUnit style; dbt test --select "test_type:unit" | pgTAP 1.3.4 current; has_table/has_column/results_eq/throws_ok etc. dbt unit tests: native since 1.8, defined in YAML under models/, static dict/csv/sql fixtures with expected rows; run in dev/CI only, never prod |
| integration | testcontainers (ephemeral PostgreSQL/MySQL/etc.); pgTAP inside container; up/down migration replay | pip testcontainers[postgres] or Go/JS variants | pytest with container fixture; apply migrations to container, run pgTAP suite | Apply migrations to a prod-like snapshot, not just empty schema; catches data-dependent migration failures |
| db-migration | squawk + Atlas migrate lint (static); Flyway/Liquibase/Alembic/EF Core migration tests; up/down + idempotency tests | flyway binary; liquibase; alembic pip; dotnet-ef | squawk + atlas migrate lint --env ci; atlas migrate apply on container; alembic upgrade head && alembic downgrade -1 && upgrade head | Atlas migrate lint requires Atlas Pro since v0.38 (atlas login). EF Core: generate idempotent scripts (dotnet ef migrations script --idempotent) and migration bundles (dotnet ef migrations bundle) to test apply; from>to generates rollback scripts |
| data-quality | Great Expectations (GX Core 1.x), Soda Core 3.5 (SodaCL), pandera (dataframes), dbt generic/singular data tests | pip install gx / soda-core / pandera | gx validate; soda scan -d db checks.yml; pandera schema.validate(df) | dbt data_tests: generic (unique, not_null, accepted_values, relationships) in YAML, singular as .sql files returning failing rows; run with dbt test, exclude in prod with --exclude-resource-type |
| contract | dbt model contracts (constraints), Soda contracts, Open Data Contract Standard (ODCS) | built into dbt; soda-contracts | dbt build (contract enforcement fails on schema drift); soda contract test | Contract enforcement in dbt fails the build when model output schema differs from declared columns/types; ODCS is the vendor-neutral YAML contract spec |
| authz | pgTAP RLS/policy tests + privilege assertions; manual SET ROLE visibility scripts | pgTAP (includes policies_are, policy_roles_are, policy_cmd_is, table_privs_are) | run per-role suite in CI nightly against prod-like snapshot | For Reg S-P: assert per-role visibility explicitly, not just "RLS enabled". Pattern: SET ROLE analyst; SELECT count(*) FROM clients; must return only the allowed set. Also assert grants: table_privs_are('clients','app_user',ARRAY['SELECT']) |
| snapshot-approval | golden result sets: pg_regress, stored expected CSVs, dbt unit expect rows | built in | compare query output to committed golden file after changes | Keep goldens small and stable; sanitize timestamps and IDs |
| benchmark | pgbench; EXPLAIN latency baselines | bundled with PostgreSQL | pgbench -c 20 -t 100; psql -c "EXPLAIN ANALYZE ..." > baseline.txt | Compare against committed baseline in nightly job; fail on >N% regression |
| regression | EXPLAIN plan baselines, pg_stat_statements (top queries by total time, IO) | pg_stat_statements extension | nightly: diff plan shapes; pg_stat_statements top-10 report | Plan flips (nested loop -> seq scan) are the early warning; thresholds on mean exec time |
| flakiness | deterministic fixtures: fixed timestamps, seeded IDs, ordered results, frozen clocks | none | apply in test harness | Timezones, CURRENT_TIMESTAMP defaults, and unordered SELECTs are the top flake sources; always ORDER BY in assertions |
| fuzz | sqlsmith (random valid SQL against a schema, crash finding) | build from source or distro package | sqlsmith --target=... | Niche, maintenance low [unverified]; use for hardening parser/optimizer edge cases, not as a gate |
| mutation | n/a; see "Not applicable" | | | |

Not applicable (with reason): mutation testing has no standard implementation for SQL; the replacement is negative tests, which are real and cheap: (1) assert a constraint violation raises (pgTAP throws_ok), (2) assert a data-quality check FAILS when you seed a corrupt row, (3) assert a role is denied a SELECT/UPDATE, (4) assert an RLS policy hides a row that should be invisible. Cover these four and you have most of what mutation testing would tell you. Also n/a: component, e2e, api, contract (in the API sense; "contract" here is data contracts), property-based, metamorphic, combinatorial, model-based, benchmark-load style chaos (chaos/load target the deployed app, not the database layer; see types-nonfunctional.md), accessibility family (types-nonfunctional.md), exploratory and usability (human-led). coverage: no line coverage for SQL; nearest proxy is dbt column test coverage (count of columns with at least one test in schema.yml) and Atlas schema lint as full-schema policy audit.

## Recommended default stack

- PostgreSQL shop: sqlfluff in pre-commit; squawk on every migration diff; testcontainers + pgTAP for unit and migration tests in PR; a nightly authz suite (per-role RLS assertions on a prod-like snapshot) as the regulated-data gate; pg_stat_statements + EXPLAIN baselines nightly.
- SQL Server shop: tSQLt for unit tests, run inside a testcontainers-style throwaway database; sqlfluff with tsql dialect for lint.
- Analytics/warehouse: dbt first, sqlfluff with dbt templater for lint; dbt unit tests on models with complex regex/date/window logic; generic + singular data tests for quality; model contracts on public/contracted models; GX or Soda where checks must run outside dbt or against non-dbt sources.
- Any shop: no production PII in test data without masking; seed data from generators or masked snapshots only.

## Config snippets

.sqlfluff (PostgreSQL, dbt templater):

```ini
[sqlfluff]
dialect = postgres
templater = dbt
exclude_rules = LT12   # pick exclusions deliberately

[sqlfluff:templater:dbt]
project_dir = .

[sqlfluff:rules]
capitalisation.keywords = consistent
```

pgTAP unit test:

```sql
BEGIN;
SELECT plan(6);

SELECT has_table('public', 'clients', 'Table public.clients exists');
SELECT has_column('public', 'clients', 'ssn_masked');
SELECT col_type_is('public','clients','ssn_masked','text');
SELECT results_eq(
  'SELECT count(*) FROM clients WHERE ssn_masked LIKE ''%'' AND ssn_masked NOT LIKE ''***'' ',
  'SELECT 0::bigint', 'no unmasked SSNs stored');

-- authz: analyst role must see only its segment
SET ROLE analyst;
SELECT is(
  (SELECT count(*) FROM clients WHERE segment = 'wealth'),
  (SELECT count(*) FROM clients),
  'analyst sees only wealth segment');
RESET ROLE;

-- grant audit
SELECT table_privs_are('public', 'clients', 'app_user',
  ARRAY['SELECT'], 'app_user gets select only');

SELECT * FROM finish();
ROLLBACK;
```

RLS policy introspection (pgTAP 1.3.4+):

```sql
SELECT policies_are('public', 'clients', ARRAY['clients_analyst_policy']);
SELECT policy_roles_are('public', 'clients', 'clients_analyst_policy', ARRAY['analyst']);
SELECT policy_cmd_is('public', 'clients', 'clients_analyst_policy', 'SELECT');
```

Migration safety gate (PR):

```sh
squawk migrations/           # Postgres downtime risks
atlas migrate lint --env ci  # destructive/data-dependent/backward-incompat; needs Atlas login (Pro)
```

testcontainers migration test (Python):

```python
from testcontainers.postgres import PostgresContainer

def test_migrations_apply_and_replay():
    with PostgresContainer("postgres:17") as pg:
        apply_migrations(pg.get_connection_url())   # e.g. alembic upgrade head
        assert schema_matches_expected(pg)
        downgrade_one(pg)                           # alembic downgrade -1
        upgrade(pg)                                 # then back up: up/down round trip
```

Idempotency test: apply the same migration directory twice; the second run must be a no-op (Flyway: migrate is idempotent by history table; Alembic: upgrade head twice; EF Core: bundle rerun reports "No migrations were applied"). Also test `atlas migrate apply` pre-apply drift check behavior with a hand-modified container schema.

EF Core (from Microsoft docs):

```sh
dotnet ef migrations script --idempotent -o artifacts/migrate.sql   # review-gated SQL
dotnet ef migrations bundle                          # self-contained efbundle binary for CI/CD
dotnet ef migrations script 0 InitialCreate          # rollback script: from newer to older emits Down()
```

dbt unit test (YAML under models/, dbt 1.8+):

```yaml
unit_tests:
  - name: test_is_valid_email_address
    model: dim_customers
    given:
      - input: ref('stg_customers')
        format: dict
        rows:
          - {email: cool@example.com, email_top_level_domain: example.com}
          - {email: badgmail.com, email_top_level_domain: gmail.com}
    expect:
      format: dict
      rows:
        - {email: cool@example.com, is_valid_email_address: true}
        - {email: badgmail.com, is_valid_email_address: false}
```

```sh
dbt test --select "test_type:unit"          # unit only
dbt test --select "test_type:data"          # data tests only
dbt test --store-failures                    # persist failing rows for debugging
```

dbt contract enforcement:

```yaml
models:
  - name: dim_customers
    config:
      contract: {enforced: true}
    columns:
      - name: customer_id
        data_type: integer
        constraints: [{type: not_null}]
        data_tests: [unique, not_null]
```

Soda check:

```yaml
checks for clients:
  - row_count > 0
  - missing count(ssn_masked) = 0
  - invalid count(email) = 0
  - duplicate count(customer_id) = 0
  - freshness(created_at) < 1d
```

Great Expectations (GX Core 1.x) and pandera one-liners:

```python
import gx
ctx = gx.get_context()
batch = ctx.data_sources.psql_default.get_batch(...)
batch.expect_column_values_to_not_be_null("customer_id")
```

```python
import pandera as pa
schema = pa.DataFrameSchema({"customer_id": pa.Column(int, unique=True)})
schema.validate(df)
```

Query performance baseline (nightly):

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT ... ;
-- commit baselines under tests/plans/, diff in CI; fail on plan-shape change or >20% time regression
-- pg_stat_statements: top queries by total_exec_time, compare week over week
```

PII masking for test data (compliance-critical):

- Never restore production data into test databases without masking. Prefer synthetic seeds (faker) or column-level masking on restore.
- Deterministic masking keeps referential integrity: mask emails as sha256(email)||'@masked.test' or map via lookup table, so joins still work.
- PostgreSQL Anonymizer (extension `anon`) provides declarative masking rules and dynamic masking per role; verify masked views with pgTAP: as masked role, assert no raw PII appears.
- In fixtures, generate fake SSNs in a clearly invalid format (999-99-0001) so a regression that leaks raw data is caught by the "no unmasked SSNs" pgTAP assertion above.
- Audit trail: keep a documented mapping of every masked column; examiners (GLBA/Reg S-P) will ask.

## Gotchas

- PR vs nightly: lint (sqlfluff, squawk), Atlas migrate lint, dbt unit tests, dbt data tests in PR on staging data, testcontainers migration tests in PR; authz suite, EXPLAIN baselines, pg_stat_statements diffs, pgbench, big snapshot restores on nightly schedules.
- pgTAP runs inside PostgreSQL; install the extension in the test container image (or use the pgtap Docker image), and run via pg_prove from CI. pgTAP xUnit-style runtests() rolls back between test functions; sequences are not rolled back.
- tSQLt runs in-transactions and rolls back after each test, which is safe for prod clones but conflicts with tools needing committed state; run against throwaway databases.
- Atlas migrate lint needs Atlas Pro (atlas login) since v0.38; drift detection is also Pro. Squawk is free but PostgreSQL-only. If neither is an option, write your own Conftest/OPA or plpgsql checks for the top rules (drop table/column, missing concurrent index, NOT NULL without default on populated tables).
- dbt: run unit tests in dev/CI only; static fixtures mean no reason to spend warehouse cycles in prod. dbt unit tests do not support introspective queries or recursive SQL; fixture inputs must cover every ref/source the model reads.
- sqlfluff with the dbt templater needs a working dbt project (compile) to lint; that is fine in CI, slower locally.
- Migration tests must run against a prod-like snapshot, not an empty schema: NOT NULL without default, unique index creation on populated data, and type changes are exactly the failures an empty-DB test hides. Keep one anonymized snapshot in CI (masked per the PII section).
- Up/down round trips are necessary, not sufficient: a downgrade that loses data (dropped columns) will "pass". Test downgrade only where it is actually part of your deploy strategy; otherwise gate deploys on forward-only plans.
- Golden result files: sanitize timestamps, ordering, and generated IDs or the goldens will flake. Prefer bag/set comparisons (pgTAP set_eq/bag_eq) over row-order equality.
- EXPLAIN baselines are machine-dependent; pin the CI PostgreSQL version and small_scale factor, and compare plan shapes (join algorithm, scan type) rather than raw milliseconds where possible.
- Reg S-P framing: treat the authz suite as a control with an owner, run it on schedule, and keep the output as evidence. A green nightly RLS suite is auditable proof that per-role visibility holds.

## Sources

- sqlfluff: https://github.com/sqlfluff/sqlfluff
- squawk: https://squawkhq.com/
- Atlas linting: https://atlasgo.io/versioned/lint and https://atlasgo.io/skills/atlas/references/lint.md
- Atlas drift detection: https://atlasgo.io/versioned/drift-detection
- pgTAP: https://pgtap.org/ and https://github.com/theory/pgtap
- tSQLt: https://tsqlt.org/
- testcontainers: https://testcontainers.com/
- dbt unit tests: https://docs.getdbt.com/docs/build/unit-tests
- dbt data tests: https://docs.getdbt.com/docs/build/data-tests
- dbt contracts: https://docs.getdbt.com/docs/collaborate/govern/model-contracts
- Great Expectations: https://github.com/great-expectations/great_expectations (GX Core 1.x)
- Soda Core: https://docs.soda.io/
- pandera: https://pandera.readthedocs.io/
- Flyway: https://documentation.red-gate.com/fd/
- Liquibase: https://docs.liquibase.com/
- Alembic: https://alembic.sqlalchemy.org/
- EF Core migrations applying: https://learn.microsoft.com/ef/core/managing-schemas/migrations/applying
- EF Core migrations in teams: https://learn.microsoft.com/ef/core/managing-schemas/migrations/teams
- PostgreSQL Anonymizer: https://postgresql-anonymizer.readthedocs.io/
- pg_stat_statements: https://www.postgresql.org/docs/current/pgstatstatements.html
- pgbench: https://www.postgresql.org/docs/current/pgbench.html
- ODCS (data contracts): https://github.com/bitol-io/open-data-contract-standard
- sqlsmith: https://github.com/lesitrx/sqlsmith [unverified mirror; original by Andreas Seltenreich]

Verified: 2026-10-14. Confirmed via web: sqlfluff 4.4.0 (2026-10-02) and dialect/rule surface; squawk rule catalog (ban-drop-table, require-concurrent-index-creation, adding-required-field, prefer-timestamptz, RLS-related opt-in rules) from squawkhq.com; Atlas migrate lint analyzers, changeset detection, nolint directive, Pro-gating since v0.38, and drift detection behavior from atlasgo.io; pgTAP 1.3.4 with full assertion surface including policies_are/policy_roles_are/policy_cmd_is/table_privs_are and rollback-per-test semantics from PGXN docs and theory/pgtap releases; dbt unit tests (1.8+, YAML under models/, dict/csv/sql fixtures, test_type selectors, --store-failures, compute:local experimental) and data_tests rename plus generic/singular tests and arguments nesting from docs.getdbt.com; Soda Core 3.5.0 release notes including contracts support; GX Core 1.7.0 release and 0.18 sunset from GX blog/releases; EF Core idempotent scripts, migration bundles, rollback script generation (from>to), migration locking (EF Core 9+), and team review gating from Microsoft Learn; Infracost pattern (in infra file). pandera, tSQLt, Flyway/Liquibase/Alembic, PostgreSQL Anonymizer, pg_stat_statements, pgbench, ODCS: from memory, all established tools, no version numbers asserted; sqlsmith maintenance: [unverified].