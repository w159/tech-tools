# SQL Optimization -- Generic Reference

Sourced from the sql-optimization skill. Applies to MySQL, PostgreSQL, SQL Server, Oracle,
and any other SQL database. Load for universal query tuning, index design, and
cross-database monitoring patterns.

## Query Performance Analysis

```sql
-- Bad: function prevents index use, IN subquery
SELECT * FROM orders o
WHERE YEAR(o.created_at) = 2024
  AND o.customer_id IN (SELECT c.id FROM customers c WHERE c.status = 'active');

-- Good: range predicate + JOIN
SELECT o.id, o.customer_id, o.total_amount, o.created_at
FROM orders o
INNER JOIN customers c ON o.customer_id = c.id
WHERE o.created_at >= '2024-01-01' AND o.created_at < '2025-01-01'
  AND c.status = 'active';
-- Indexes needed: orders(created_at), customers(status), orders(customer_id)
```

## Index Strategy Optimization

```sql
-- Bad: oversized composite index
CREATE INDEX idx_user_data ON users(email, first_name, last_name, created_at);

-- Good: purpose-built composite indexes
CREATE INDEX idx_users_email_created ON users(email, created_at);  -- filter by email, sort by date
CREATE INDEX idx_users_name ON users(last_name, first_name);        -- name search
CREATE INDEX idx_users_status_created ON users(status, created_at) WHERE status IS NOT NULL;
```

## Subquery Optimization

```sql
-- Bad: correlated subquery (runs once per outer row)
SELECT p.product_name, p.price
FROM products p
WHERE p.price > (SELECT AVG(price) FROM products p2 WHERE p2.category_id = p.category_id);

-- Good: window function
SELECT product_name, price
FROM (
    SELECT product_name, price,
           AVG(price) OVER (PARTITION BY category_id) as avg_category_price
    FROM products
) ranked
WHERE price > avg_category_price;
```

## JOIN Optimization

```sql
-- Bad: LEFT JOINs with late filtering; returns extra rows
SELECT o.*, c.name, p.product_name
FROM orders o
LEFT JOIN customers c ON o.customer_id = c.id
LEFT JOIN order_items oi ON o.id = oi.order_id
LEFT JOIN products p ON oi.product_id = p.id
WHERE o.created_at > '2024-01-01' AND c.status = 'active';

-- Good: INNER JOINs with predicate pushed into the join condition
SELECT o.id, o.total_amount, c.name, p.product_name
FROM orders o
INNER JOIN customers c ON o.customer_id = c.id AND c.status = 'active'
INNER JOIN order_items oi ON o.id = oi.order_id
INNER JOIN products p ON oi.product_id = p.id
WHERE o.created_at > '2024-01-01';
```

## Aggregation Optimization

```sql
-- Bad: three separate queries
SELECT COUNT(*) FROM orders WHERE status = 'pending';
SELECT COUNT(*) FROM orders WHERE status = 'shipped';
SELECT COUNT(*) FROM orders WHERE status = 'delivered';

-- Good: conditional aggregation in one pass
SELECT
    COUNT(CASE WHEN status = 'pending'   THEN 1 END) as pending_count,
    COUNT(CASE WHEN status = 'shipped'   THEN 1 END) as shipped_count,
    COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered_count
FROM orders;
```

## OR vs. UNION

```sql
-- Sometimes better: UNION ALL lets each branch use its own index
SELECT * FROM products WHERE category = 'electronics' AND price < 1000
UNION ALL
SELECT * FROM products WHERE category = 'books' AND price < 50;
```

## Temporary Tables for Complex Operations

```sql
CREATE TEMPORARY TABLE temp_calc AS
SELECT customer_id,
       SUM(total_amount) as total_spent,
       COUNT(*) as order_count
FROM orders WHERE created_at >= '2024-01-01'
GROUP BY customer_id;

SELECT c.name, tc.total_spent, tc.order_count
FROM temp_calc tc
JOIN customers c ON tc.customer_id = c.id
WHERE tc.total_spent > 1000;
```

## Covering Index Design

```sql
-- SQL Server / PostgreSQL (INCLUDE syntax)
CREATE INDEX idx_orders_covering
ON orders(customer_id, created_at)
INCLUDE (total_amount, status);
```

## Performance Monitoring (Cross-DB)

```sql
-- MySQL: slow query log
SELECT query_time, lock_time, rows_sent, rows_examined, sql_text
FROM mysql.slow_log ORDER BY query_time DESC;

-- PostgreSQL: pg_stat_statements
SELECT query, calls, total_time, mean_time
FROM pg_stat_statements ORDER BY total_time DESC LIMIT 10;

-- SQL Server: DMVs
SELECT qs.total_elapsed_time / qs.execution_count as avg_elapsed_time,
       qs.execution_count,
       SUBSTRING(qt.text, (qs.statement_start_offset/2)+1,
           ((CASE qs.statement_end_offset WHEN -1 THEN DATALENGTH(qt.text)
             ELSE qs.statement_end_offset END - qs.statement_start_offset)/2)+1) as query_text
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
ORDER BY avg_elapsed_time DESC;
```

## Universal Optimization Checklist

### Query structure
- [ ] No `SELECT *` in production queries
- [ ] Appropriate JOIN types (INNER vs. LEFT/RIGHT)
- [ ] Filter early in WHERE clauses; push predicates into JOINs where possible
- [ ] Use EXISTS instead of IN for subqueries when appropriate
- [ ] No functions wrapping indexed columns in WHERE clauses

### Index strategy
- [ ] Indexes on frequently queried columns
- [ ] Composite indexes in correct column order
- [ ] Not over-indexed (impacts write performance)
- [ ] Covering indexes where beneficial
- [ ] Partial indexes for specific query patterns

### Data types and schema
- [ ] Appropriate data types for storage efficiency
- [ ] Normalization appropriate to workload (3NF for OLTP, denormalized for OLAP)
- [ ] Constraints present to help the query optimizer
- [ ] Large tables partitioned when appropriate

### Query patterns
- [ ] LIMIT/TOP for result set control
- [ ] Cursor-based pagination for large datasets
- [ ] Batch operations for bulk changes
- [ ] No N+1 query patterns
- [ ] Prepared statements for repeated queries

### Performance testing
- [ ] Tested with realistic data volumes
- [ ] Execution plans analyzed
- [ ] Performance monitored over time
- [ ] Alerts set for slow queries
- [ ] Regular index usage analysis
