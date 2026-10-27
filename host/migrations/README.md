# D1 migrations

A deployed host's database is made and changed only by these files, applied in order by
`wrangler d1 migrations apply DB` (the generated `wrangler.jsonc` sets `migrations_dir` here).

Every later schema change is a new numbered file (`0003_<what>.sql`), never an edit to an applied
one, plus the same change in `host/schema.sql` (a fresh local database) and `host/lib/upgrade.mjs`
(a running local host's older database). Additive only: `IF NOT EXISTS`, no `DROP`. SQLite has no
`ADD COLUMN IF NOT EXISTS`, so a migration that adds a column fails harmlessly ("duplicate column")
if run again; wrangler runs each one once. The unit checks compare the three.
