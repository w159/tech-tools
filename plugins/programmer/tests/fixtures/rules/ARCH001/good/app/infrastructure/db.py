import sqlite3

from app.domain.order import Order


def save(order: Order):
    with sqlite3.connect(":memory:") as conn:
        conn.execute("select 1")
