import contextlib
import sqlite3


def read(path):
    with open(path) as fh:
        return fh.read()


def query():
    conn = sqlite3.connect("db.sqlite")
    try:
        return conn.execute("select 1").fetchall()
    finally:
        conn.close()


def opener(path):
    return open(path)


class Store:
    def __init__(self, path):
        self.conn = sqlite3.connect(path)

    def close(self):
        self.conn.close()


def closing_read(path):
    with contextlib.closing(open(path)) as fh:
        return fh.read()


def touch(path):
    open(path, "w").close()
