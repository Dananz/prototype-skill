-- Each upload writes its own KV key (html:<id>:<version>:<random>), and the share row names the live
-- one, so an upload that loses a race can never write over the key viewers are served. NULL is a
-- version uploaded before this: its key is html:<id>:<version>.
-- SQLite has no ADD COLUMN IF NOT EXISTS: run again, this fails with "duplicate column" and changes
-- nothing. wrangler applies each migration once (d1_migrations).
ALTER TABLE shares ADD COLUMN html_key TEXT;
