# Check holdings_lots.acquired_on format
import sqlite3
conn = sqlite3.connect("data/portfolio-management.db")
print("=== Sample acquired_on values ===")
cursor = conn.execute("SELECT DISTINCT STRFTIME('%Y-%m-%d', substr(acquired_on, 1, 10)) as date_col, acquired_on FROM holdings_lots LIMIT 20").fetchall()
for row in cursor:
    print(row)

print("\n=== Distinct dates (YYYY-MM-DD format) ===")
cursor = conn.execute("SELECT DISTINCT substr(acquired_on, 1, 10) as date_only FROM holdings_lots ORDER BY date_only LIMIT 50").fetchall()
for row in cursor:
    print(row[0])

print("\n=== Sample execution_orders by symbol ===")
cursor = conn.execute("""
SELECT symbol, exchange, state_kind, count(*) as cnt
FROM execution_orders
GROUP BY symbol, exchange, state_kind
ORDER BY symbol, exchange, state_kind
LIMIT 50
""").fetchall()
for row in cursor:
    print(row)

conn.close()
