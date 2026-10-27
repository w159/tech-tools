import sqlite3
import socket as sock


def read(path):
    fh = open(path)  # expect: RES001
    return fh.read()


def query():
    conn = sqlite3.connect("db.sqlite")  # expect: RES001
    return conn.execute("select 1").fetchall()


def ping(host):
    s = sock.socket()  # expect: RES001
    s.connect((host, 80))
