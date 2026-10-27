TABLE_SQL = "CREATE TABLE IF NOT EXISTS t (id INTEGER)"


def find(cur, user_id, name):
    cur.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    cur.execute("SELECT * FROM users WHERE name = %s", (name,))
    cur.execute(TABLE_SQL)
    q = "SELECT * FROM t WHERE n = ?"
    cur.execute(q, (name,))
    cur.execute("SELECT 1 " "FROM dual")
