-- Listing pages read through the extension: the seller's text (search results lack it) and the
-- facts the small model read in it. Kept in the shared bank for 15 days.
ALTER TABLE ad_bank ADD COLUMN body TEXT;
ALTER TABLE ad_bank ADD COLUMN detail_at TEXT;
ALTER TABLE ad_bank ADD COLUMN facts TEXT;
ALTER TABLE ad_bank ADD COLUMN facts_at TEXT;
-- Price curve of each model reference (make|model|fuel), fitted on national listings.
CREATE TABLE model_curves (
  key TEXT PRIMARY KEY,
  curve TEXT NOT NULL,
  fitted_at TEXT NOT NULL
);
-- National searches read for a price analysis: not read again for 15 days.
CREATE TABLE search_reads (
  url TEXT PRIMARY KEY,
  read_at TEXT NOT NULL
);
