-- The places as the user typed them ("Rennes 30 km, Saint-Malo"); `locations` is derived from it.
ALTER TABLE briefs ADD COLUMN zone TEXT;
