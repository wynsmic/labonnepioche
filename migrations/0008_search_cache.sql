-- National searches read for "Vérifier", reused for 3 days (key = the Leboncoin search URL).
CREATE TABLE search_cache (
  key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  ads TEXT NOT NULL
);
