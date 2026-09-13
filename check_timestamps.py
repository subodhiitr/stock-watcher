import sqlite3
conn = sqlite3.connect("data/portfolio-management.db")
for table in ["execution_orders", "execution_fills", "execution_cancellation_outcomes", "reconciliation_snapshots"]:
    print(f"\n=== {table} ===")
    try:
        for row in conn.execute(f"PRAGMA table_info({table})").fetchall():
            print(row)
    except Exception as e:
        print(f"Error: {e}")
