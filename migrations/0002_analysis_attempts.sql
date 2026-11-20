-- Failed or skipped analyses: after a few attempts a listing leaves the queue.
ALTER TABLE ads ADD COLUMN analysis_attempts INTEGER NOT NULL DEFAULT 0;
