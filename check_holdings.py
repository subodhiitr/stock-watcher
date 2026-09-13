import sqlite3
conn = sqlite3.connect("data/portfolio-management.db")
print(f"=== holdings ===")
try:
    for row in conn.execute("PRAGMA table_info(holdings)").fetchall():
        print(row)
except Exception as e:
    print(f"Error: {e}")

# Check all text columns that might store timestamps in a sortable format
print("\n=== All TEXT columns across tables ===")
cursor = conn.execute("""
SELECT name, sql FROM sqlite_master 
WHERE type='table'
""")
for table, sql in cursor.fetchall():
    cursor2 = conn.execute(f"PRAGMA table_info({table})")
    for row in cursor2.fetchall():
        col_name, col_type = row[1], row[2]
        if 'TEXT' in col_type and len(col_name) <= 20:  # Common short name columns
            print(f"{table}.{col_name}")
