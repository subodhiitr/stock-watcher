import Database from 'better-sqlite3';

const INITIAL_SCHEMA_VERSION = 1;

export function initDb(path = 'stock-watcher.db') {
  const db = new Database(path);

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL
    );

    INSERT OR IGNORE INTO schema_version (id, version)
    VALUES (1, ${INITIAL_SCHEMA_VERSION});
  `);

  return db;
}

export function getSchemaVersion(db) {
  const row = db.prepare('SELECT version FROM schema_version WHERE id = 1').get();
  return row?.version ?? 0;
}