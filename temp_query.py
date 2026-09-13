import sqlite3

db_path = 'data/portfolio-management.db'
conn = sqlite3.connect(db_path)
cur = conn.cursor()

# Get holdings table structure and data
print("=== Holdings Table ===")
cur.execute("PRAGMA table_info(holdings)")
for c in cur.fetchall():
    print(f"  {c[1]} ({c[2]})")

cur.execute("SELECT * FROM holdings LIMIT 5")
for row in cur.fetchall():
    print(f"  Row: {row}")

# Get execution_orders table structure and data
print("\n=== Execution Orders Table ===")
cur.execute("PRAGMA table_info(execution_orders)")
for c in cur.fetchall():
    print(f"  {c[1]} ({c[2]})")

cur.execute("SELECT * FROM execution_orders ORDER BY executed_at DESC LIMIT 5")
for row in cur.fetchall():
    print(f"  Row: {row}")

conn.close()
