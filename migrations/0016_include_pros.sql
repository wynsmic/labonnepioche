-- Per hunt: also collect professional sellers' listings (off by default: private sellers only).
ALTER TABLE briefs ADD COLUMN include_pros INTEGER NOT NULL DEFAULT 0;
