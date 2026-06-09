# PostgreSQL-Specific Reference

Sourced from the postgresql-optimization skill. Load for PostgreSQL-exclusive features:
JSONB, arrays, window functions, full-text search, custom types, range/geometric types,
extensions, connection pooling, and advanced monitoring.

## JSONB Operations

```sql
CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- GIN index for JSONB performance
CREATE INDEX idx_events_data_gin ON events USING gin(data);

-- Containment and path queries
SELECT * FROM events
WHERE data @> '{"type": "login"}'
  AND data #>> '{user,role}' = 'admin';

-- JSONB aggregation
SELECT jsonb_agg(data) FROM events WHERE data ? 'user_id';

-- Bad: defeats the GIN index
SELECT * FROM users WHERE data::text LIKE '%admin%';

-- Good: JSONB operator
SELECT * FROM users WHERE data @> '{"role": "admin"}';
```

## Array Operations

```sql
CREATE TABLE posts (
    id SERIAL PRIMARY KEY,
    tags TEXT[],
    categories INTEGER[]
);

SELECT * FROM posts WHERE 'postgresql' = ANY(tags);
SELECT * FROM posts WHERE tags && ARRAY['database', 'sql'];
SELECT * FROM posts WHERE array_length(tags, 1) > 3;
SELECT array_agg(DISTINCT category) FROM posts, unnest(categories) as category;
```

## Window Functions and Analytics

```sql
SELECT
    product_id,
    sale_date,
    amount,
    SUM(amount)  OVER (PARTITION BY product_id ORDER BY sale_date)                                      as running_total,
    AVG(amount)  OVER (PARTITION BY product_id ORDER BY sale_date ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) as moving_avg,
    DENSE_RANK() OVER (PARTITION BY EXTRACT(month FROM sale_date) ORDER BY amount DESC)                 as monthly_rank,
    LAG(amount, 1) OVER (PARTITION BY product_id ORDER BY sale_date)                                    as prev_amount
FROM sales;
```

## Full-Text Search

```sql
CREATE TABLE documents (
    id SERIAL PRIMARY KEY,
    title TEXT,
    content TEXT,
    search_vector tsvector
);

UPDATE documents
SET search_vector = to_tsvector('english', title || ' ' || content);

CREATE INDEX idx_documents_search ON documents USING gin(search_vector);

-- Search with ranking
SELECT *, ts_rank(search_vector, plainto_tsquery('postgresql')) as rank
FROM documents
WHERE search_vector @@ plainto_tsquery('english', 'postgresql database')
ORDER BY rank DESC;
```

## Custom Types and Domains

```sql
CREATE TYPE address_type AS (
    street TEXT, city TEXT, postal_code TEXT, country TEXT
);

CREATE TYPE order_status AS ENUM ('pending', 'processing', 'shipped', 'delivered', 'cancelled');

CREATE DOMAIN email_address AS TEXT
CHECK (VALUE ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    email email_address NOT NULL,
    address address_type,
    status order_status DEFAULT 'pending'
);
```

## Range Types

```sql
CREATE TABLE reservations (
    id SERIAL PRIMARY KEY,
    room_id INTEGER,
    reservation_period tstzrange,
    price_range numrange
);

-- Overlap query
SELECT * FROM reservations
WHERE reservation_period && tstzrange('2024-07-20', '2024-07-25');

-- Exclusion constraint to prevent overlapping reservations
ALTER TABLE reservations
ADD CONSTRAINT no_overlap
EXCLUDE USING gist (room_id WITH =, reservation_period WITH &&);
```

## Geometric Types

```sql
CREATE TABLE locations (
    id SERIAL PRIMARY KEY,
    name TEXT,
    coordinates POINT,
    coverage CIRCLE,
    service_area POLYGON
);

-- Distance query
SELECT name FROM locations
WHERE coordinates <-> point(40.7128, -74.0060) < 10;

CREATE INDEX idx_locations_coords ON locations USING gist(coordinates);
```

## Index Strategies (PostgreSQL-specific)

```sql
-- Composite index
CREATE INDEX idx_orders_user_date ON orders(user_id, order_date);

-- Partial index
CREATE INDEX idx_active_users ON users(created_at) WHERE status = 'active';

-- Expression index
CREATE INDEX idx_users_lower_email ON users(lower(email));

-- Covering index (INCLUDE)
CREATE INDEX idx_orders_covering ON orders(user_id, status) INCLUDE (total, created_at);
```

## Query Analysis

```sql
-- Full execution plan with buffer stats
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT u.name, COUNT(o.id) as order_count
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE u.created_at > '2024-01-01'::date
GROUP BY u.id, u.name;

-- Identify slowest queries
SELECT query, calls, total_time, mean_time, rows,
       100.0 * shared_blks_hit / nullif(shared_blks_hit + shared_blks_read, 0) AS hit_percent
FROM pg_stat_statements
ORDER BY total_time DESC LIMIT 10;
```

## Connection and Memory Monitoring

```sql
-- Connection usage by state
SELECT count(*) as connections, state
FROM pg_stat_activity
GROUP BY state;

-- Key memory settings
SELECT name, setting, unit
FROM pg_settings
WHERE name IN ('shared_buffers', 'work_mem', 'maintenance_work_mem');
```

## Index Usage Statistics

```sql
-- Table and index sizes
SELECT schemaname, tablename,
       pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Unused indexes
SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
WHERE idx_scan = 0;
```

## Extensions

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";   -- UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- Cryptographic functions
CREATE EXTENSION IF NOT EXISTS "unaccent";    -- Remove accents
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- Trigram / fuzzy matching
CREATE EXTENSION IF NOT EXISTS "btree_gin";  -- GIN indexes for btree types

SELECT uuid_generate_v4();
SELECT crypt('password', gen_salt('bf'));
SELECT similarity('postgresql', 'postgersql');
```

## Recursive CTEs

```sql
WITH RECURSIVE category_tree AS (
    SELECT id, name, parent_id, 1 as level
    FROM categories WHERE parent_id IS NULL
    UNION ALL
    SELECT c.id, c.name, c.parent_id, ct.level + 1
    FROM categories c
    JOIN category_tree ct ON c.parent_id = ct.id
)
SELECT * FROM category_tree ORDER BY level, name;
```

## PostgreSQL-Specific Optimization Tips

- Use `EXPLAIN (ANALYZE, BUFFERS)` for detailed query analysis.
- Configure `postgresql.conf` for your workload type (OLTP vs. OLAP).
- Use connection pooling (pgbouncer) for high-concurrency applications.
- Run `VACUUM` and `ANALYZE` regularly for optimal planner statistics.
- Use declarative table partitioning (PostgreSQL 10+) for large tables.
- Monitor with `pg_stat_statements`; enable it in `shared_preload_libraries`.

## PostgreSQL Optimization Checklist

- [ ] `EXPLAIN (ANALYZE, BUFFERS)` run for expensive queries
- [ ] Sequential scans on large tables investigated
- [ ] Appropriate join algorithms verified
- [ ] WHERE clause selectivity reviewed
- [ ] Sort and aggregation operations analyzed
- [ ] Composite indexes created for multi-column searches
- [ ] Partial indexes for frequently filtered subsets
- [ ] Unused indexes identified and removed
- [ ] Index bloat monitored
- [ ] Parameterized queries used exclusively (no string interpolation)
- [ ] Row-level security enabled where needed
- [ ] Connection pool usage monitored
- [ ] Database growth and maintenance tracked
