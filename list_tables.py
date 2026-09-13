import sqlite3
conn = sqlite3.connect('data/portfolio-management.db')
for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall():
    print(row[0])
