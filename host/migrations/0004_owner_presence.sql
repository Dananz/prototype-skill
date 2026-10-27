-- The share popover (plan 2026-10-27-share-popover): the owner's GitHub identity, which a new share
-- needs once sign-in is set up; the message viewers read first; and who is in a link now. Additive.
-- SQLite has no ADD COLUMN IF NOT EXISTS: run again, these fail with "duplicate column" and change
-- nothing. wrangler applies each migration once (d1_migrations).
ALTER TABLE owners ADD COLUMN gh_id INTEGER;
ALTER TABLE owners ADD COLUMN gh_login TEXT;
ALTER TABLE owners ADD COLUMN gh_name TEXT;
ALTER TABLE owners ADD COLUMN gh_avatar TEXT;
ALTER TABLE shares ADD COLUMN message TEXT;
CREATE TABLE IF NOT EXISTS presence (share_id TEXT NOT NULL, -- a signed-in viewer on a link, upserted at most once a minute
                       gh_id INTEGER NOT NULL,         -- viewers.gh_id
                       route TEXT,                     -- what they were looking at, slug/LETTER
                       at INTEGER NOT NULL,            -- their last ping; "now" is within 2 minutes
                       PRIMARY KEY (share_id, gh_id));
