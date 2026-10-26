-- The host's D1 schema. Safe to run again: every statement is IF NOT EXISTS.
-- The shots tables live in their own database and are added with the comments task.
CREATE TABLE IF NOT EXISTS owners   (id TEXT PRIMARY KEY, name TEXT NOT NULL, notify_url TEXT,
                       created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS owner_tokens (sha256 TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES owners(id),
                       device TEXT NOT NULL,          -- "Mac Studio", "M4": one token per machine
                       created_at INTEGER NOT NULL, last_used_at INTEGER, revoked_at INTEGER);
CREATE TABLE IF NOT EXISTS ids      (id TEXT PRIMARY KEY,           -- one id space for shares and links, never reused
                       kind TEXT NOT NULL CHECK (kind IN ('share','link')));
CREATE TABLE IF NOT EXISTS shares   (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES owners(id),
                       session TEXT NOT NULL, project_label TEXT NOT NULL, title TEXT NOT NULL,
                       scope TEXT NOT NULL,            -- JSON: [{proto, variants:[…]}], start route
                       version INTEGER NOT NULL, bytes INTEGER NOT NULL, lang TEXT NOT NULL,
                       pw_salt TEXT, pw_check TEXT, pw_epoch INTEGER NOT NULL DEFAULT 0,
                       comments INTEGER NOT NULL DEFAULT 1, others_visible INTEGER NOT NULL DEFAULT 1,
                       votes INTEGER NOT NULL DEFAULT 0, blind INTEGER NOT NULL DEFAULT 0,
                       note TEXT, expires_at INTEGER, created_at INTEGER NOT NULL,
                       updated_at INTEGER NOT NULL,
                       deleted_at INTEGER);           -- a tombstone: "This link was removed"
CREATE TABLE IF NOT EXISTS links    (id TEXT PRIMARY KEY, share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
                       kind TEXT NOT NULL CHECK (kind IN ('open','person')), name TEXT,
                       revoked_at INTEGER, created_at INTEGER NOT NULL, last_seen_at INTEGER);
CREATE TABLE IF NOT EXISTS comments (id TEXT NOT NULL,               -- the viewer's own UUID (format checked): retries are idempotent
                       share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
                       link_id TEXT NOT NULL, viewer TEXT NOT NULL, verified INTEGER NOT NULL,
                       version INTEGER NOT NULL, route TEXT NOT NULL,
                       body TEXT NOT NULL,             -- JSON: the Draft and Target, validated
                       re TEXT,                        -- id of the comment this follows up
                       status TEXT NOT NULL DEFAULT 'new'
                         CHECK (status IN ('new','sent','working','done','dismissed')),
                       taken_by TEXT,                  -- session that sent it to Claude
                       owner_reply TEXT,               -- the owner's own words; Claude's replies never come here
                       hidden INTEGER NOT NULL DEFAULT 0, -- hidden from viewers by the owner
                       done_in INTEGER,
                       created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
                       PRIMARY KEY (share_id, id));
CREATE INDEX IF NOT EXISTS comments_owner_poll ON comments (share_id, updated_at);
CREATE TABLE IF NOT EXISTS votes    (share_id TEXT NOT NULL, link_id TEXT NOT NULL, viewer TEXT NOT NULL,
                       route TEXT NOT NULL, created_at INTEGER NOT NULL,
                       PRIMARY KEY (share_id, link_id, viewer));
CREATE TABLE IF NOT EXISTS views    (share_id TEXT NOT NULL, link_id TEXT NOT NULL, day TEXT NOT NULL,
                       n INTEGER NOT NULL, PRIMARY KEY (share_id, link_id, day));
CREATE TABLE IF NOT EXISTS budget   (day TEXT NOT NULL, what TEXT NOT NULL, n INTEGER NOT NULL,
                       PRIMARY KEY (day, what));      -- the host's own count of KV writes, D1 writes
