-- The host's D1 schema. Safe to run again: every statement is IF NOT EXISTS. A deployed host is made
-- by host/migrations instead, which must end in the same schema (see its README).
-- The shots tables live in their own database and are added with the comments task.
-- A database made by an older schema is brought up to this one by the Worker itself (host/lib/upgrade.mjs:
-- SQLite has no ADD COLUMN IF NOT EXISTS), so nothing here may name a column added since phase 0
-- outside its own CREATE TABLE: on an old database that statement would fail and stop the file.
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
                       deleted_at INTEGER,            -- a tombstone: "This link was removed"
                       html_key TEXT);                -- the live version's KV key; NULL: html:<id>:<version>
CREATE TABLE IF NOT EXISTS links    (id TEXT PRIMARY KEY, share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
                       kind TEXT NOT NULL CHECK (kind IN ('open','person')), name TEXT,
                       revoked_at INTEGER, created_at INTEGER NOT NULL, last_seen_at INTEGER);
CREATE TABLE IF NOT EXISTS comments (id TEXT NOT NULL,               -- the viewer's own UUID (format checked): retries are idempotent
                       share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
                       link_id TEXT NOT NULL,          -- '' for the open link (person links come in phase 2)
                       viewer TEXT NOT NULL,           -- gh:<GitHub id>
                       verified INTEGER NOT NULL,      -- 1: every commenter signs in with GitHub (decision 20)
                       version INTEGER NOT NULL,       -- the share version the viewer saw
                       route TEXT NOT NULL,            -- the same as variant
                       body TEXT NOT NULL,             -- the viewer's words, plain text, at most 4000 characters; '' once deleted
                       gh_id INTEGER,                  -- viewers.gh_id of the author
                       variant TEXT,                   -- slug/LETTER, one of the share's variants
                       target TEXT,                    -- JSON { src?, component?, path?, x, y, view: { size, w, h } }, NULL for the whole design
                       re TEXT,                        -- id of the comment this follows up
                       status TEXT NOT NULL DEFAULT 'new'
                         CHECK (status IN ('new','sent','working','done','dismissed')),
                       taken_by TEXT,                  -- session that sent it to Claude
                       owner_reply TEXT,               -- the owner's own words; Claude's replies never come here
                       owner_reply_at INTEGER,
                       hidden INTEGER NOT NULL DEFAULT 0, -- hidden from viewers by the owner
                       deleted INTEGER NOT NULL DEFAULT 0, -- deleted by its author while new: body and target are emptied
                       withdrawn INTEGER NOT NULL DEFAULT 0, -- taken off the link by its author once sent; the owner's unhide leaves it off
                       done_in INTEGER,
                       created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
                       PRIMARY KEY (share_id, id));
CREATE INDEX IF NOT EXISTS comments_owner_poll ON comments (share_id, updated_at);
CREATE TABLE IF NOT EXISTS viewers  (gh_id INTEGER PRIMARY KEY,   -- GitHub's user id; the access token is never kept
                       login TEXT NOT NULL, name TEXT, avatar TEXT, seen_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS caps     (what TEXT NOT NULL,            -- 'gh:<id>' (per hour) or 'share:<id>' (per day)
                       slot INTEGER NOT NULL,          -- the hour or day number since the epoch
                       n INTEGER NOT NULL, PRIMARY KEY (what, slot));
CREATE TABLE IF NOT EXISTS tickets  (nonce TEXT PRIMARY KEY,         -- a sign-in ticket's nonce, once used: a ticket works once
                       exp INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS votes    (share_id TEXT NOT NULL, link_id TEXT NOT NULL, viewer TEXT NOT NULL,
                       route TEXT NOT NULL, created_at INTEGER NOT NULL,
                       PRIMARY KEY (share_id, link_id, viewer));
CREATE TABLE IF NOT EXISTS views    (share_id TEXT NOT NULL, link_id TEXT NOT NULL, day TEXT NOT NULL,
                       n INTEGER NOT NULL, PRIMARY KEY (share_id, link_id, day));
CREATE TABLE IF NOT EXISTS budget   (day TEXT NOT NULL, what TEXT NOT NULL, n INTEGER NOT NULL,
                       PRIMARY KEY (day, what));      -- the host's own count of KV writes, D1 writes
CREATE TABLE IF NOT EXISTS kv_trash (key TEXT PRIMARY KEY,           -- a KV key whose delete waits for a day with budget left
                       at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS meta     (k TEXT PRIMARY KEY,             -- 'owner_id': the one owner allowed to upload
                       v TEXT NOT NULL);
