def find(cur, user_id, name):
    cur.execute(f"SELECT * FROM users WHERE id = {user_id}")  # expect: SEC001
    cur.execute("SELECT * FROM users WHERE name = '%s'" % name)  # expect: SEC001
    cur.execute("DELETE FROM users WHERE id = " + str(user_id))  # expect: SEC001
    q = "SELECT * FROM t WHERE n = '{}'".format(name)
    cur.execute(q)  # expect: SEC001
