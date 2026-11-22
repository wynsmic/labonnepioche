-- Raw valuation pages read through the extension (La Centrale…), kept to build and check their parsers.
CREATE TABLE captures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  ad_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  payload TEXT NOT NULL
);
