-- Every listing read on Leboncoin (collections and national comparisons), whatever the hunt: one
-- bank that serves both the hunt lists and the comparables of any listing. Reused for 15 days.
CREATE TABLE ad_bank (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  brand TEXT,
  model TEXT,
  first_seen TEXT NOT NULL,
  seen_at TEXT NOT NULL
);
CREATE INDEX ad_bank_model ON ad_bank(brand, model, seen_at);

INSERT OR IGNORE INTO ad_bank (id, data, brand, model, first_seen, seen_at)
SELECT id, data,
       lower(coalesce(json_extract(data, '$.attributes.brand'), json_extract(data, '$.attributes.u_car_brand'))),
       lower(coalesce(json_extract(data, '$.attributes.model'), json_extract(data, '$.attributes.u_car_model'))),
       first_seen, coalesce(last_seen, first_seen)
FROM ads;

INSERT OR IGNORE INTO ad_bank (id, data, brand, model, first_seen, seen_at)
SELECT json_extract(j.value, '$.id'), j.value,
       lower(coalesce(json_extract(j.value, '$.attributes.brand'), json_extract(j.value, '$.attributes.u_car_brand'))),
       lower(coalesce(json_extract(j.value, '$.attributes.model'), json_extract(j.value, '$.attributes.u_car_model'))),
       s.created_at, s.created_at
FROM search_cache s, json_each(s.ads) j;

-- Replaced by ad_bank.
DROP TABLE search_cache;
