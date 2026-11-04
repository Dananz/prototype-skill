-- A fork offered back to the link it came from: the forker's own link, named on the original's row
-- for its owner. Nothing about the fork is shown to anyone else.
CREATE TABLE IF NOT EXISTS offers (origin_id TEXT NOT NULL, share_id TEXT NOT NULL, owner_id TEXT NOT NULL, base_version INTEGER, changed TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, dismissed_at INTEGER, PRIMARY KEY (origin_id, share_id));
