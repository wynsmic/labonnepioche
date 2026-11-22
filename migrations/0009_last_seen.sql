-- When a listing was last read on Leboncoin: a collection drops those it did not see again.
ALTER TABLE ads ADD COLUMN last_seen TEXT;
UPDATE ads SET last_seen = first_seen;
