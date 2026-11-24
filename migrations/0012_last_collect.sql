-- Start of the latest "Récupérer les annonces" (server time, same format as ads.first_seen):
-- listings first seen since then are flagged as new. collect_run tells the calls of one run apart.
ALTER TABLE briefs ADD COLUMN last_collect_at TEXT;
ALTER TABLE briefs ADD COLUMN collect_run TEXT;
