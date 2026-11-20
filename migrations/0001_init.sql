-- A hunt: what the user is looking for. The prompt evolves; every saved version is kept.
CREATE TABLE briefs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  -- Raw Leboncoin `locations` parameter (the user's search area), reused in every search.
  locations TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE prompt_versions (
  id TEXT PRIMARY KEY,
  brief_id TEXT NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX prompt_versions_brief ON prompt_versions(brief_id, created_at);

-- Claude's preparation: research summary, criteria and the Leboncoin searches to run.
CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  brief_id TEXT NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  plan TEXT NOT NULL, -- JSON (shared/types PlanSchema)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX plans_brief ON plans(brief_id, created_at);

-- Listings collected for a hunt, deduplicated by Leboncoin id.
CREATE TABLE ads (
  brief_id TEXT NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  data TEXT NOT NULL, -- JSON (shared/types Ad)
  search_label TEXT,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  analysis TEXT, -- JSON (shared/types Analysis), null until analysed
  favorite INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (brief_id, id)
);
