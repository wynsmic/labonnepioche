-- Price as first seen (to show price drops) and the national comparison (JSON, shared/compare.ts).
ALTER TABLE ads ADD COLUMN first_price INTEGER;
ALTER TABLE ads ADD COLUMN comparison TEXT;
UPDATE ads SET first_price = json_extract(data, '$.price');
