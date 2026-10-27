"""SQLite implementation of CustomerRepository."""

import sqlite3

ZIP_QUERY = "SELECT zip FROM customers WHERE id = ?"


class SqliteCustomers:
    def __init__(self, path: str):
        self._path = path

    def shipping_zip(self, customer_id: str) -> str:
        with sqlite3.connect(self._path) as conn:
            row = conn.execute(ZIP_QUERY, (customer_id,)).fetchone()
        if row is None:
            raise LookupError(customer_id)
        return row[0]
