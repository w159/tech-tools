---
name: database-optimization
description: "SQL and PostgreSQL query optimization: indexing strategies, execution plan analysis, pagination, batch operations, and performance monitoring. Use when asked to optimize slow queries, design indexes, analyze execution plans, improve database performance, or leverage PostgreSQL-specific features (JSONB, arrays, window functions, full-text search, custom types, extensions). Trigger phrases: slow query, EXPLAIN, index, query optimization, database performance, PostgreSQL, JSONB, window function, pg_stat_statements, connection pool, VACUUM."
---

# Database Optimization

This skill covers query optimization and indexing across all SQL databases, plus deep
PostgreSQL-specific capabilities. Shared principles live in the body; format-specific depth
is in the reference files below.

## Decision Matrix

| Task | Load |
|---|---|
| Universal SQL: slow queries, indexes, anti-patterns, pagination, batch ops, cross-DB monitoring | `references/sql-generic.md` |
| PostgreSQL-specific: JSONB, arrays, window functions, full-text search, custom types, extensions, pg_stat_statements, partitioning | `references/postgresql.md` |

When the database is PostgreSQL, load both references -- generic principles apply, and
PostgreSQL-specific capabilities frequently offer a better solution.

## Shared Optimization Principles

### Indexing fundamentals

- Create indexes on columns that appear frequently in WHERE, JOIN ON, and ORDER BY clauses.
- Composite indexes: column order matters -- put the highest-selectivity or equality-predicate
  column first.
- Partial indexes filter rows at index creation time; use them for queries that always include
  a fixed predicate (e.g., `WHERE status = 'active'`).
- Covering indexes (with INCLUDE in PostgreSQL/SQL Server) avoid table lookups by carrying
  payload columns alongside the key.
- Over-indexing degrades INSERT/UPDATE/DELETE performance. Remove unused indexes.
- Never create an index inside a function call in a WHERE clause unless a matching expression
  index exists: `WHERE UPPER(email) = ...` cannot use an index on `email`.

### Execution plan analysis

- Read the plan before guessing at a fix. A sequential scan on a small table is often correct.
- Look for the highest-cost nodes first: hash joins on large inputs, sorts without indexes,
  nested loops with many outer rows.
- Stale statistics cause bad plans. Run ANALYZE (or equivalent) when row counts change
  significantly.
- The estimated row count at each node is the planner's bet; when estimate and actual diverge
  sharply, that node is where the plan goes wrong.

### Anti-patterns to eliminate

- `SELECT *` in production queries -- fetches columns the application discards.
- Functions wrapping indexed columns in WHERE clauses -- defeats index use.
- Correlated subqueries executing once per outer row -- rewrite as JOIN or window function.
- OFFSET-based pagination on large tables -- performance degrades linearly; use cursor-based
  pagination instead.
- Row-by-row INSERT loops -- replace with batch/bulk insert.
- N+1 query patterns -- batch the lookup or JOIN in the parent query.

### Pagination

```sql
-- Bad: OFFSET degrades at large offsets
SELECT * FROM products ORDER BY id OFFSET 10000 LIMIT 20;

-- Good: cursor-based
SELECT * FROM products WHERE id > :last_id ORDER BY id LIMIT 20;
```

### Batch operations

```sql
-- Bad: row-by-row
INSERT INTO t (a, b) VALUES (1, 2);
INSERT INTO t (a, b) VALUES (3, 4);

-- Good: single statement
INSERT INTO t (a, b) VALUES (1, 2), (3, 4);
```

## Optimization Methodology

1. Identify: find slow queries via database-specific slow-query log or stats view.
2. Analyze: examine the execution plan. Locate the expensive node.
3. Hypothesize: index missing? Statistics stale? Query structure prevents index use?
4. Test cheaply: EXPLAIN ANALYZE the rewritten query on a representative dataset.
5. Verify: confirm actual improvement with before/after timing.
6. Monitor: check index usage stats periodically; remove unused indexes.

## Reference Files -- Load Only When Triggered

| Load this | When |
|---|---|
| `references/sql-generic.md` | Universal SQL optimization: query patterns, JOINs, aggregation, subqueries, cross-DB monitoring |
| `references/postgresql.md` | PostgreSQL-specific: JSONB, arrays, window functions, full-text search, types, extensions, pg_stat_statements, partitioning |
