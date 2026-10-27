-- The online host (plan 2026-10-27-share-links-online): the KV delete queue and the host's own
-- settings. Additive and IF NOT EXISTS, like every migration here.
CREATE TABLE IF NOT EXISTS kv_trash (key TEXT PRIMARY KEY,           -- a KV key whose delete waits for a day with budget left
                       at INTEGER NOT NULL);           -- when it was queued
CREATE TABLE IF NOT EXISTS meta     (k TEXT PRIMARY KEY,             -- 'owner_id': the one owner allowed to upload
                       v TEXT NOT NULL);
