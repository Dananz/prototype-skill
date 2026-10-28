-- One host for every user (spec 2026-10-28-shared-host-design): owners become the user table, a
-- token dies a year after its last use, sign-in from a Mac without a token, reports, and the purge
-- of long-expired pages. Additive. The ALTERs come first: run again, the first fails with "duplicate
-- column" and nothing after it runs. wrangler applies each migration once (d1_migrations).
ALTER TABLE owners ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE owners ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE owner_tokens ADD COLUMN expires_at INTEGER;
ALTER TABLE shares ADD COLUMN purged_at INTEGER;
-- The owner setup named becomes the admin; every owner already here stays active (the default).
UPDATE owners SET role = 'admin' WHERE id = (SELECT v FROM meta WHERE k = 'owner_id');
CREATE UNIQUE INDEX IF NOT EXISTS owners_gh ON owners (gh_id) WHERE gh_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS signins  (code TEXT PRIMARY KEY,          -- the short id in the sign-in URL
                       poll TEXT NOT NULL,             -- SHA-256 of the poll secret only the client holds
                       device TEXT NOT NULL,           -- the token's device name, once minted
                       words TEXT,                     -- the code the Mac shows and the confirm page repeats, ABCD-EFGH
                       exp INTEGER NOT NULL,           -- 10 minutes after the start
                       gh_id INTEGER, owner_id TEXT,   -- who signed in, once GitHub sent them back
                       done_at INTEGER);
CREATE TABLE IF NOT EXISTS reports  (id TEXT PRIMARY KEY, share_id TEXT NOT NULL,
                       reason TEXT NOT NULL,           -- the viewer's words, at most 500 characters
                       gh_id INTEGER,                  -- the viewer, when signed in on the link
                       created_at INTEGER NOT NULL);
