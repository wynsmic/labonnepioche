-- What was learnt about a listing, kept 15 days: a new collection, a new plan or a prune does not
-- spend model tokens or Leboncoin reads on it again. The analysis and the check count only for the
-- same price and text (fingerprint) and the same demand (prompt_key).
CREATE TABLE ad_cache (
  brief_id TEXT NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
  ad_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  prompt_key TEXT,
  analysis TEXT,
  analysed_at TEXT,
  verification TEXT,
  comparison TEXT,
  verified_at TEXT,
  seller_id TEXT,
  PRIMARY KEY (brief_id, ad_id)
);
-- A seller's profile check, shared by all hunts for 15 days.
CREATE TABLE seller_cache (
  seller_id TEXT PRIMARY KEY,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL
);
