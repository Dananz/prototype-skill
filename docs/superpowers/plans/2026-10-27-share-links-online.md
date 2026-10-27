# Share Links, Online (phases 2 and 3 merged: workers.dev, then prtype.dev) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** `proto share pricing/2` publishes to the open internet. The first milestone is a
workers.dev path link (`https://proto-share.<sub>.workers.dev/s/<id>/`), which works while
prtype.dev's nameservers propagate. The end state is `https://prtype.dev/s/<id>/`, with the short
`https://prtype.dev/<id>` redirecting there. Viewers sign in with GitHub on the same origin and
comment. The owner's tray and `proto share` poll the online host. Everything runs on a new, separate,
free Cloudflare account with no card and no R2.

**Link shape (Tomer, 2026-10-27):** path mode on the apex. There are no per-share subdomains, no
wildcard route and no `*` DNS record. One Workers custom domain on `prtype.dev` serves the short
links, the shares under `/s/<id>/`, the owner API under `/api/` and GitHub sign-in under
`/auth/github`. This replaces spec stage 2's `<id>.prtype.dev` origins and the "Own domain" row of
the Hosting table. The price is weaker isolation: every share shares one origin, so one share's
scripts can read another's localStorage and fetch its `/s/<id>/api/*`. Cookies are per share
(`v`, `Path=/s/<id>/`), but a path is not a security boundary. The spec allows this only while the
owner is the only publisher (decision 18, Security: "Path mode … acceptable while only the owner
publishes … The host refuses third-party uploads in path mode"). Task 2 enforces that rule on the
host.

**Spec:** `docs/superpowers/specs/2026-10-26-share-links-design.md`. Read decisions 5, 10, 14, 17,
18 and 20; "Hosting" (all); "Limits and what happens at each one"; "Access and identity › Links,
Signing in with GitHub, The owner"; "Security"; the phase 2 and 3 rows of "Phases and plan
outline"; and "What it costs". Also read
`docs/superpowers/plans/2026-10-26-share-links-phase-0-followups.md`. Task 2 takes the Task 6
items that matter on a public host.

## Scope

In:
- D1 migrations for a deployed host.
- Host changes for a public path-mode origin: owner-only uploads, sign-in switched on only on the
  OAuth App's own host, old workers.dev links redirecting to prtype.dev, JSON errors on `/api`, and
  the phase 0 follow-ups that matter online.
- Daily budget counters. They are required: spec Limits says "refuses work at 90% of each daily
  cap", which is how a Free account fails with a clear message instead of a Cloudflare error.
- The KV delete queue, and a daily cron that drains it and prunes the small tables.
- `proto share setup` (workers.dev) and `proto share setup --domain prtype.dev`, with the free-plan
  guard.
- The owner token in the Keychain.
- The owner side, the CLI and the page pointing at the online host.
- `proto share` refreshing the session's shell copy before it builds.
- Docs, a production-like smoke under `wrangler dev`, the go-live run, and Tomer's manual
  checklist.

Deferred, because nothing in the spec makes them a phase 2 or 3 safety must:
- Password gate. Its rate-limit rule and Turnstile go with it.
- Person links.
- Discord and ntfy notify.
- Preview (OG) images.
- The owner view (`proto share open`).
- Votes, expiry and view counts.
- `proto share token --add-device/--rotate`. Re-running `proto share setup` on another Mac does
  the same job (Task 5).
- A second OAuth App for workers.dev sign-in.

## Global Constraints

- **Free only.** A separate, new Cloudflare account (decision 5) with no card. No R2, Durable
  Objects, Queues, Workers Paid or any paid add-on. Bindings are only KV and D1, plus one cron
  trigger (Free allows 5). A unit check rejects any other binding in the generated config.
- **Never echo a secret.** `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are read from
  `~/.prototypes/host/prod.vars` (mode 600, dotenv, `#` comment lines, the keys are exactly those
  two) and piped to `wrangler secret put <KEY>` on stdin. They never go into argv, a log, the
  terminal or a file we write. `VIEWER_KEY` is 32 random bytes made in memory and piped the same
  way. It is set only when `wrangler secret list` doesn't show it, so a re-run never signs viewers
  out. Setup refuses if `prod.vars` is not mode 600.
- **The owner token** goes in the Keychain item `prototype-share-online` (the existing
  `setToken`/`getToken` through `security -i`). The host keeps only its SHA-256.
- **An isolated wrangler login.** Every wrangler process the share tool spawns, local or remote,
  runs with `XDG_CONFIG_HOME=~/.prototypes/share-tools/wrangler-home` (expanded, in the child's
  env):
  - The login lives at `~/.prototypes/share-tools/wrangler-home/.wrangler/config/default.toml`,
    for the new account `contactwtimmy@gmail.com`.
  - The global wrangler config is deliberately logged out, so Tomer's other projects never touch
    this account.
  - One helper, `wranglerEnv()` in `scripts/share-host.mjs`, builds the env. The existing
    `wrangler()` and `spawn(... 'dev' ...)` calls use it, and so does `share-online.mjs`.
  - Tests set `PROTO_SHARE_WRANGLER_HOME` to a temp dir to override it.
  - A unit check asserts that every wrangler spawn in `scripts/` and `.github/share-online-checks.mjs`
    passes this env, by grepping for spawns of `tools.wrangler` without `wranglerEnv`.
  - Docs show manual commands with the prefix, e.g.
    `XDG_CONFIG_HOME=~/.prototypes/share-tools/wrangler-home ~/.prototypes/share-tools/node_modules/.bin/wrangler whoami`.
- **Account calls only when Tomer runs setup.** Every Cloudflare account call goes through the
  pinned `wrangler@4.149.0` in `~/.prototypes/share-tools/`, using its OAuth login (`wrangler
  login`, approved by Tomer in his browser). The few REST calls wrangler has no command for use the
  token from `wrangler auth token --json`, held in memory only. Tests never call Cloudflare.
- **Fetch the docs first** (Tomer's standing rule). Task 0 lists the pages to read before any code
  that depends on them.
- **Don't stop running servers.** Never stop or restart a session dev server or the local share
  host on 8787. The smoke uses its own port, its own temporary HOME and its own state folder.
- Phase 0 and 1 rules stand: plain `.mjs` for scripts and the Worker, comment voice of the repo,
  every new shell string through `t()` with a Hebrew entry (`node scripts/i18n-check.mjs`), and
  Phosphor only.
- Commit per task on `worktree-spec-share-links`. Never push without Tomer's word.
- **Checks:**
  - `node --test .github/share-unit-checks.mjs`
  - `node --test .github/agent-checks.mjs`
  - `node scripts/i18n-check.mjs`
  - `node .github/smoke.mjs --share-link-only`
  - the new `node .github/share-online-checks.mjs` (Task 7)

## File Structure

| Path | Change |
|---|---|
| `host/migrations/0001_initial.sql` (new) | Today's `host/schema.sql`, verbatim: the first migration of a deployed database |
| `host/migrations/0002_online.sql` (new) | `kv_trash`, `meta` (Task 2) |
| `host/schema.sql` | Gains what 0002 adds, so a fresh local database matches the migrations |
| `host/lib/upgrade.mjs` | Gains 0002's tables (the local host still upgrades itself) |
| `host/lib/budget.mjs` (new) | Daily counters, the 90% refusal, today's usage |
| `host/lib/cron.mjs` (new) | `scheduled()`: drain `kv_trash`, prune `caps`, `tickets`, old `budget` rows |
| `host/worker.mjs`, `host/lib/{auth,github,routes,comments,http}.mjs` | Public path mode, owner-only uploads, the `SIGNIN` switch, legacy redirect, budget, hardening |
| `host/wrangler.template.jsonc` | Becomes the local template only. The online config is generated (Task 5) |
| `scripts/share-online.mjs` (new) | Setup for the online host: guard, resources, migrations, deploy, secrets, token, domain |
| `scripts/share.mjs`, `scripts/share-host.mjs` | `setup` dispatch, `liveHost` for online hosts, usage in `ls` |
| `scripts/app-sync.mjs` (new) | The file and package sync out of `update()` in `proto.mjs`, used by `up` and by `share` |
| `scripts/proto.mjs` | `update()` calls `app-sync.mjs`. `up` passes `PROTO_SKILL` to the dev server. Help lines |
| `app/share/owner.mjs` | `linkOf`/`apiOrigin` by stage. Stage-neutral messages |
| `app/share/routes.mjs` | Stage-neutral messages. Sync the shell copy before a page publish when `PROTO_SKILL` is known |
| `app/shell/share-link-sheet.tsx`, `app/shell/i18n/he/share-link.ts` | Setup hint and link copy by stage |
| `.github/share-unit-checks.mjs` | Migrations, budget, host path-mode and owner-only checks, config guard, prod.vars parser |
| `.github/share-online-checks.mjs` (new) | The production-like smoke (Task 7) |
| `references/share.md`, `SKILL.md`, `docs/superpowers/specs/2026-10-26-share-links-design.md` | Docs (Task 8). The spec gets decision 22 (path mode on prtype.dev) |

---

### Task 0: Verify the assumptions (no account calls)

**Files:** none. Record the findings in the commit message of Task 1 and in
`docs/superpowers/plans/2026-10-26-share-links-phase-0-followups.md` under a new
"Online: verified" heading.

Read the official docs and answer each item. If an answer differs from what this plan assumes, use
the fallback written beside it.

1. **Custom domains** (developers.cloudflare.com/workers/configuration/routing/custom-domains/):
   - Expected: an apex custom domain on a Free zone is set by wrangler config
     `routes: [{ pattern: "prtype.dev", custom_domain: true }]`.
   - Expected: Cloudflare makes the DNS record and the certificate itself.
   - Expected: it refuses when the apex already has a record.
2. **Universal SSL** covers the apex of a Free zone. Note how long the first certificate takes after
   the zone goes active.
3. **The workers.dev subdomain:** how an account without one gets one non-interactively.
   Expected: `GET/PUT /accounts/{id}/workers/subdomain`, or a wrangler prompt. Fallback: setup
   prints the dashboard step.
4. **The Free-plan signal:** which API tells whether an account is on Workers Free and a zone is
   on Free.
   - Zone: `GET /zones?name=` → `plan`.
   - Account: the subscriptions or `workers/account-settings` endpoint.
   - Fallback: setup stops with the dashboard path to check (Workers & Pages › Plans) and continues
     only with `--plan-checked`.
5. **Zone creation:** whether wrangler's OAuth scopes include zone creation (`POST /zones`) and DNS
   record reads and writes. Fallback: Tomer adds the domain in the dashboard (manual step M3).
6. **Wrangler commands:**
   - `wrangler auth token --json` output shape.
   - `wrangler secret put` reads a piped stdin with no TTY. Fallback: `wrangler deploy
     --secrets-file <file>` exists in 4.149.0 (it was in `deploy --help`; .env or JSON, additive).
     Write the values to a mode-600 file in a fresh `mkdtemp` folder, deploy, then delete the
     folder in a `finally`.
   - `wrangler d1 migrations apply` runs without its confirmation prompt when stdin is not a TTY.
     Fallback: answer `y` on stdin.
   - `wrangler secret list --format json`.
   - `wrangler kv namespace create` and `wrangler d1 create` output, and how to look ids up
     (`kv namespace list`, `d1 list --json`) so a re-run reuses them.
7. **Free limits again** (Workers, KV, D1, cron triggers), checked against the spec's Limits table.
   Also: whether a request over the Free daily limit on a custom domain errors (fail closed) rather
   than passes through. A custom domain has no origin, so it should.
8. **CPU per request:** whether `wrangler tail --format json` events carry `cpuTime`. Fallback:
   Workers Logs (`observability.enabled`, Free tier) and its CPU field.
9. **Vercel nameservers:** Vercel's docs on custom nameservers for a domain bought there.
10. **Vercel DNS records** for prtype.dev today: list them with the Vercel MCP (`get_records` /
    `get_domain_config`) to know what to copy into Cloudflare. This is read only.

**Acceptance:** each item has an answer with its source URL. No code yet.

### Task 1: D1 migrations

**Files:**
- `host/migrations/0001_initial.sql`, `host/migrations/0002_online.sql`
- `host/schema.sql`, `host/lib/upgrade.mjs`
- `.github/share-unit-checks.mjs`

**Behavior:**
- `0001_initial.sql` is today's `host/schema.sql` as is (`IF NOT EXISTS` everywhere). A new remote
  database gets the full phase 0 and 1 schema in one step.
- `0002_online.sql` adds:
  - `kv_trash (key TEXT PRIMARY KEY, at INTEGER NOT NULL)`: KV keys whose delete waits for a day
    with budget left.
  - `meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`: holds `owner_id`, the one owner allowed to
    upload (Task 2).
- `schema.sql` and `upgrade.mjs` gain the same two tables, so the local host stays equal to a
  migrated one.
- Rule, written at the top of `host/migrations/`: every later schema change is a new numbered
  migration, plus the same change in `schema.sql` and `upgrade.mjs`.
- `wrangler.jsonc` (generated) sets `migrations_dir` to the skill's `host/migrations`.

**Tests (unit, `node:sqlite`):**
- Apply 0001..N in order to an empty database. Its `sqlite_master` (tables, columns, indexes)
  equals a database made from `schema.sql`.
- A phase 0 database plus `upgrade()` equals the same.
- Every migration runs twice without error.
- No migration contains `DROP` or `ALTER … DROP`.

**Acceptance:** the three checks pass. `wrangler d1 migrations apply DB --local --persist-to <tmp>`
on a fresh temp state applies 0001 and 0002 (run in Task 7's smoke).

### Task 2: The host on a public origin

**Files:**
- `host/worker.mjs`
- `host/lib/{auth,github,routes,comments,http,budget,cron}.mjs`
- `host/wrangler.template.jsonc`
- `.github/share-unit-checks.mjs`

**Behavior:**

1. **Public path mode.** With `PATH_MODE=1` and a non-local `BASE` (`proto-share.<sub>.workers.dev`
   or `prtype.dev`):
   - `/s/<id>/…` serves the share.
   - `/<id>` answers the existing OG page, which redirects to `https://<BASE>/s/<id>/` with the
     hash kept. This is the cheap short link: it already exists and needs only the stage-aware
     `shareOrigin`.
   - `/api/*` is the owner API.
   - `/auth/github*` is sign-in.
   - Cookies are `v` / `vn` with `Path=/s/<id>/`, `Secure` over https, HttpOnly and SameSite=Lax.
     They are already made by `viewerCookie(url, id, pathForm=true)`. A unit check pins `Secure`
     on https.
   - `upgraded()` stays a no-op off loopback, so a deployed database changes only through
     migrations.
2. **Owner-only uploads** (the condition for path mode):
   - `POST /api/shares` and `PUT /api/shares/:id` answer 403
     `{ code: 'not_owner', error: 'This host takes uploads from its owner only.' }` unless the
     token's owner is `meta.owner_id`.
   - Setup writes `owner_id` once (Task 5). With no `meta.owner_id`, uploads are refused.
   - The owner rows can't gain a second owner through the API: nothing in the API inserts owners.
3. **The sign-in switch.**
   - New var `SIGNIN`: `'1'` only when `BASE` is the OAuth App's callback host (`prtype.dev`).
   - `signinReady(env)` also requires `env.SIGNIN === '1'`, or a local `BASE` (phase 1
     behaviour kept).
   - On workers.dev, viewers read comments and the sign-in button shows the existing "not set up"
     state. GitHub would refuse a `redirect_uri` on another host.
4. **Old workers.dev links.**
   - New var `LEGACY`: comma-separated hosts the Worker used to be on.
   - A request whose host is in `LEGACY` gets a 301 to the same path on `https://<BASE>`, for
     `/s/<id>/…` and `/<id>`. `/api` and `/auth` on a legacy host get 410 JSON.
   - `/_health` is exempt and still answers 200 there.
   - `workers_dev` stays on, so links sent during the first milestone keep working after the
     domain moves.
5. **Daily budget** (`host/lib/budget.mjs`, the spec's `budget` table, `day` = UTC `YYYY-MM-DD`):
   - **Counted:**
     - `kv_write`: each `KV.put`.
     - `kv_delete`: each `KV.delete`.
     - `d1_write`: the `meta.rows_written` D1 returns, summed per request and added once at the
       end of a request that wrote.
   - Requests are not counted, since a counter write per request would spend the D1 write cap.
     The request cap fails closed by itself (Task 0 item 7).
   - **Caps at 90% of Free:**
     - `kv_write` 900
     - `kv_delete` 900
     - `d1_write` 90,000
     - KV bytes 900 MB, from `SUM(bytes)` of live shares
   - **At a cap:**
     - Publish/update over `kv_write` or the KV bytes cap: 507 JSON
       `{ code: 'budget', error: "The host's daily upload budget is used up. It resets at 00:00 UTC (<local time in Israel>)." }`.
       The bytes cap's message lists the three biggest shares. Nothing is written, and the D1
       pointer flips only after the KV write.
     - Old-version and delete keys over `kv_delete` go into `kv_trash` instead of being deleted.
     - A comment over `d1_write`: 429 `{ code: 'budget' }`, the viewer's existing "Couldn't send"
       path.
   - `GET /api/owner/usage` (owner token) → `{ day, kv_write, kv_delete, d1_write, kv_bytes, caps, resetsAt }`.
6. **Cron** (`scheduled`, one trigger `"17 0 * * *"`, after the UTC reset):
   - Delete up to 800 `kv_trash` keys (counted).
   - Prune `caps` (`pruneCaps`), expired `tickets`, and `budget` rows older than 7 days.
7. **Hardening for a public host** (from the phase 0 Task 6 follow-ups):
   - The top-level `catch` answers JSON for `/api/*` and `/s/<id>/api/*`, HTML elsewhere.
   - `PUT` flips the version with a conditional upsert (`WHERE version = old`). A lost race is
     409 `{ code: 'race' }` and its new KV key goes to `kv_trash`.
   - `DELETE` writes the tombstone before deleting KV keys.
   - `ownerOf` writes `last_used_at` only when it is older than an hour. A 30 s owner poll would
     otherwise be 2,880 D1 writes a day per session.
   - `/_health` answers `x-proto-host: <HOST_VERSION>`. `HOST_VERSION` is a var setup sets to a
     hash of `host/**`, so the CLI can tell when the deployed host is older than the skill.
   - `nosniff` and `noindex` on every response, `_health` and redirects included.

**Tests (unit, the in-memory Worker of phase 0/1):**
- `BASE=prtype.dev PATH_MODE=1`:
  - `/k3x9p2m4q7` → OG page whose target is `https://prtype.dev/s/k3x9p2m4q7/`.
  - `/s/<id>/` serves the share.
  - `<id>.prtype.dev` → not found.
  - Cookie `v; Path=/s/<id>/; Secure`.
- A second owner's token → 403 `not_owner`. With no `meta.owner_id` → 403.
- `SIGNIN=0` → `api/config` says comments off and `/_in/start` shows the signin page.
  `SIGNIN=1` with secrets → sign-in works with the fake GitHub.
- A `LEGACY` host → 301 whose `Location` is the same path on `https://prtype.dev`. A `Location`
  header can't carry a fragment, so re-applying it is the browser's job. `/api` gets 410, and
  `/_health` still answers 200.
- Budget:
  - At `kv_write` 900 → 507 and no KV write, no D1 change.
  - At `kv_delete` 900 → an update queues the old key in `kv_trash`.
  - `d1_write` at the cap → comment 429.
  - Usage endpoint numbers.
- `scheduled()` drains `kv_trash` and prunes.
- The PUT race → one 409. DELETE order. `last_used_at` throttled. `/api` errors are JSON.
- No response carries `access-control-allow-origin`.

**Acceptance:** all unit checks pass, and phase 0/1 checks stay green.

### Task 3: The owner side and the CLI on an online host

**Files:**
- `app/share/owner.mjs`, `app/share/routes.mjs`, `app/share/publish.mjs`
- `scripts/share.mjs`, `scripts/share-host.mjs`
- `app/shell/share-link-sheet.tsx`, `app/shell/i18n/he/share-link.ts`
- `.github/share-unit-checks.mjs`, `.github/share-sheet-checks.mjs`

**Behavior:**

- **Host entry** in `~/.config/prototype/hosts.json`, no secrets:

  ```json
  { "name": "online", "url": "https://prtype.dev", "stage": "domain", "base": "prtype.dev",
    "pathMode": true, "default": true, "owner": "Dananz", "accountId": "…", "worker": "proto-share",
    "kvId": "…", "dbId": "…", "hostVersion": "…" }
  ```

  The first milestone is the same entry with `stage: 'workers'` and `base` the workers.dev name.
  `local` stays and stops being the default.
- **`linkOf(host, id)`:**
  - `local`: as today.
  - `workers` / `domain`: `https://<base>/s/<id>/`.
- `shortLinkOf(host, id)`: `https://prtype.dev/<id>` for `domain`. `linkOf` is used elsewhere.
- `apiOrigin`: `https://<base>` for online stages.
- The CLI prints both lines on `domain`: `link https://prtype.dev/<id>` (the one to send) and
  `opens https://prtype.dev/s/<id>/`.
- **`liveHost` in `share.mjs`:**
  - An online host is never started.
  - `/_health` within 5 s, else: "The online share host isn't answering (https://…/_health). Check
    the network; `proto share setup` repairs a broken deploy."
  - It compares `x-proto-host` with the skill's `host/**` hash and prints once per command: "The
    online host runs older code: proto share setup updates it."
  - `--host local|online` picks a host for one command.
- **Messages:** every "run proto share setup --local" becomes "run proto share setup" (online) or
  stays `--local` when the default host is local. One helper, `setupHint(host)`, in `owner.mjs`. It
  is used in `routes.mjs` (lines 55, 57, 60), `owner.mjs` (294, 324), `share.mjs` (21, 24, 55, 156)
  and the sheet (`share-link-sheet.tsx:144`), with the sheet's string through `t()` and a Hebrew
  entry.
- "This link opens only on this Mac" prints only for `local`.
- The page's "isn't running" copy says "can't be reached" for online hosts.
- **Publish errors:**
  - `budget` (507): the host's message.
  - `not_owner` (403): "This Mac's token isn't the host's owner: proto share setup".
  - `race` (409): retried once.
- **`proto share ls`** ends with today's usage from `/api/owner/usage`:
  `today: 3/900 uploads, 0/900 deletes, 412/90,000 writes, 18 MB/900 MB stored (resets 03:00)`.
- The tray poll (30 s while a page is fresh) is unchanged in cadence and runs against
  `apiOrigin`. An online host that fails keeps the outbox, as today.

**Tests:**
- Unit:
  - `linkOf`/`shortLinkOf`/`apiOrigin` for all three stages.
  - `setupHint`.
  - `client()` against an in-memory online-mode Worker (`BASE=prtype.dev`) for create/put/list/
    comments/patch/usage.
  - 507 and 403 surfaced as messages.
- Sheet smoke: with an online host entry pointing at the production-like host of Task 7, the sheet
  shows the `https://…/s/<id>/` link and no "only on this Mac" line.

**Acceptance:** `proto share`, `ls`, `update`, `comments`, `take`, `rm` and the page's sheet and tray
all work against an online-stage host entry, proven in Task 7's smoke.

### Task 4: `proto share` refreshes the session's shell copy before it builds

**Files:**
- `scripts/app-sync.mjs` (new)
- `scripts/proto.mjs`, `scripts/share.mjs`
- `app/share/routes.mjs`, `app/server.mjs` (the env read only)
- `.github/agent-checks.mjs`

**Bug:** `buildShare` runs the session's own copy of the app (`<session>/shell`, `src/main.ts`,
`share/`, `vite.config.mjs`). The copy is brought up to date only by `proto up`. A session not
re-upped publishes an old viewer.

**Behavior:**

- Move the file and package sync out of `update(dir)` in `proto.mjs` into
  `syncApp(dir, { skill })`. It returns `{ changed: string[], deps: boolean, restartWorthy: boolean }`
  and does no stopping or installing. `update()` keeps its current behaviour by calling it, then
  stopping or installing as before.
- **`proto share` (publish, `update`, `file`)** calls `syncApp(sessionDir)` first. Then:
  - If `deps`, it installs (the build needs the packages). This does not stop the dev server: an
    install beside a running Vite is what `up` already does after its stop. Here we skip the stop,
    so print the note below.
  - It syncs every app file, the restart-worthy set (`vite.config.mjs`, `server.mjs`,
    `source.mjs`, `assignment.mjs`, `listener.mjs`) included, because the share build reads them
    from disk.
  - Vite watches its own config and restarts itself when `vite.config.mjs` changes (same port,
    HMR clients reconnect, the server's poll state resets). That is the one restart this command
    can cause, and it is Vite's own.
  - `proto share` itself never stops, kills or restarts the dev server.
  - If `restartWorthy || deps`, it prints: "The session's app was updated for this share. If
    its page acts oddly, `proto up` restarts it on the new code." Node may keep old copies of
    `server.mjs` and its imports cached across Vite's own restart.
- **The page's Share sheet** runs `publishShare` inside the session server, which can't import the
  skill:
  - `proto up` starts Vite with `PROTO_SKILL=<skill dir>` in its env.
  - When it is set, the `publish` and `update` routes spawn
    `node $PROTO_SKILL/scripts/proto.mjs share --sync-only` (a new hidden subcommand that runs
    `syncApp` for the session) before building.
  - When it isn't set (a server started by an older `proto`), they publish as is and add a review
    note: "This session's viewer may be older than the skill: run proto up before sharing."

**Tests (agent-checks):**
- A temp session whose `shell/viewer/index.tsx` differs from the template: `proto share file …`
  rewrites it to the template's before building, and the built HTML contains a marker string
  from the template's version.
- A running fake dev server pid is left alive, and `proto share` sends it no signal.
- `vite.config.mjs` is synced too: the restart-worthy set is not skipped.
- The route path with and without `PROTO_SKILL`.

**Acceptance:** a share from a session made before a shell change carries the current viewer.

### Task 5: `proto share setup` (online, workers.dev): the first milestone

**Files:**
- `scripts/share-online.mjs` (new)
- `scripts/share.mjs` (dispatch), `scripts/share-host.mjs` (exports reused)
- `.github/share-unit-checks.mjs`

**Command:** `proto share setup [--name <owner>] [--account <id>] [--plan-checked]`. It runs from
any folder (it needs no session: fix the follow-up "setup/stop need a session" by dispatching
`setup` and `stop` before `need(sessionDir())`). It is idempotent. Re-running it updates the code,
applies new migrations, repairs a lost token, and on another Mac adds that Mac's token.

**Steps, in order.** Each one prints one line saying what it did.

1. **Tools.** `ensureTools()` (pinned wrangler).
2. **Login check** (with `wranglerEnv()`):
   - `wrangler whoami --json` (verify the flag in Task 0, else parse text).
   - Logged in, which is the case today (`contactwtimmy@gmail.com`): print "Cloudflare: logged in
     as <email>, account <name>" and skip the login.
   - Only if not logged in: print "A browser window opens: sign in to the Cloudflare account made
     for prtype.dev (not the dananz.com one) and click Allow." Then run `wrangler login` with the
     same env, attached to the terminal, and wait.
   - Read the account list. If there are several accounts, `--account` is required, and the error
     lists their names.
3. **Free-plan guard** (`guard()`, also run before every later deploy):
   - **Separate account (decision 5):** the account's zones (`GET /zones?account.id=`) must not
     include `dananz.com` or any zone other than `prtype.dev`. Otherwise: "This is not the
     separate prtype.dev account. Run XDG_CONFIG_HOME=~/.prototypes/share-tools/wrangler-home
     wrangler logout, then proto share setup again and approve the login in a private browser
     window signed in to the prtype.dev account only."
   - **Workers plan is Free:** per Task 0 item 4. If it can't be read, stop unless `--plan-checked`.
   - The generated config has only `kv_namespaces`, `d1_databases`, `vars`, `triggers`,
     `routes` (custom domain only), `workers_dev`, `migrations_dir`, `observability` and
     `compatibility_date`. No `r2_buckets`, `durable_objects`, `queues`, `services`, `limits` or
     `usage_model`. `assertFreeConfig(config)` throws otherwise.
   - Setup never runs an `r2` command (grep check in the unit tests).
4. **workers.dev subdomain.** Read it, and register `<login>-proto` (or ask) if missing (Task 0
   item 3).
5. **Resources.**
   - KV namespace `proto-share` and D1 database `proto-share`: looked up by name first, created
     only if missing.
   - Their ids are stored in the host entry.
   - The shots database is not created: shots are not online in this plan.
6. **Config.** Write `~/.prototypes/host/online/wrangler.jsonc`:
   - `name: proto-share`, `account_id`
   - `main` = the skill's `host/worker.mjs`
   - `migrations_dir` = the skill's `host/migrations`
   - `workers_dev: true`, `preview_urls: false`
   - `vars`: `BASE` (workers.dev name), `PATH_MODE: "1"`, `SIGNIN: "0"`, `LEGACY: ""`,
     `HOST_VERSION`
   - `triggers.crons: ["17 0 * * *"]`
   - `observability` per Task 0 item 8
   - It is a generated file, never committed.
7. **Migrations.** `wrangler d1 migrations apply DB --remote -c <config>`.
8. **Deploy.** `wrangler deploy -c <config>`.
9. **Secrets.**
   - Parse `prod.vars`: a small dotenv parser, unit tested, that skips `#` lines and refuses other
     keys or a mode other than 600.
   - `wrangler secret list --format json`.
   - Pipe `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` to `wrangler secret put`, always (they may
     have changed).
   - Pipe `VIEWER_KEY` only if it is missing.
   - `stdio: ['pipe', 'pipe', 'pipe']`. Output goes to a tail kept for errors only, with the values
     redacted from it.
   - They stay dormant until `SIGNIN=1` (Task 6).
10. **Owner and token.**
    - `wrangler d1 execute DB --remote --json --command` (the same `d1()` helper as local,
      parametrized `--local|--remote`).
    - Make the owner if none. Its name is `--name`, else `gh api user --jq .login` (decision 15).
    - Write `meta.owner_id` if unset.
    - If this Mac's Keychain token `prototype-share-online` is missing or not known to the host,
      mint 32 random bytes, insert its SHA-256 into `owner_tokens` with `device = hostname()`, and
      `setToken('online', …)`.
    - A token that was replaced on this Mac has its old row revoked (follow-up "a token lost and
      repaired leaves the old token row unrevoked").
11. **Host entry.** `saveHost({ name: 'online', stage: 'workers', default: true, … })`.
12. **Check.**
    - `GET https://<base>/_health` is 200 with the right `x-proto-host`.
    - `GET /api/shares` with the token is 200.
    - Print: "Online share host at https://<base>/ (owner Dananz). Links: https://<base>/s/<id>/.
      Viewers can read; comments open once prtype.dev is set up: proto share setup --domain
      prtype.dev."

**Tests (unit, wrangler and fetch faked by injection):**
- The step order.
- A re-run makes nothing new (lookup before create).
- The guard refuses on: a dananz.com zone, a paid plan, an unreadable plan without
  `--plan-checked`, and a config with `r2_buckets`.
- The prod.vars parser (comments, quotes, mode 600 refusal, unknown key).
- Secrets go to stdin and never to argv (assert on the spawn args), and are never printed (capture
  stdout and stderr, grep for the fake secret).
- `VIEWER_KEY` is not re-put when listed.
- A missing Keychain token is minted, and the old row is revoked.
- The host entry is written.

**Acceptance (go-live, Task 9):** a share opens on Tomer's phone from a workers.dev link.

### Task 6: `proto share setup --domain prtype.dev`

**Files:**
- `scripts/share-online.mjs`
- `.github/share-unit-checks.mjs`

**Behavior.** It runs after Task 5's steps 1 to 3 (login and guard), then:

1. **Zone check** (`GET /zones?name=prtype.dev` on the account):
   - **Missing:**
     - If Task 0 item 5 says the token can create zones, ask "Add prtype.dev to this Cloudflare
       account (Free plan)? [y/N]" and `POST /zones { name, account, type: 'full' }`.
     - Else print the dashboard step (M3) and exit 0 with "Run this again when it's added."
   - **Plan not Free:** refuse.
2. **DNS copy before the switch.**
   - Print the zone's records and the list of Vercel records the agent read in Task 0 item 10,
     passed with `--vercel-records <file.json>` or printed for the agent to add.
   - Copy any Vercel record that isn't the apex or a `*` wildcard into the zone (`POST
     /zones/{id}/dns_records`, unproxied, same values), if the token allows it. Else list them for
     the dashboard.
   - Refuse to continue while the zone has an apex A/AAAA/CNAME record: the custom domain must
     create it. Say which record to delete.
3. **Nameservers.**
   - If the zone is `pending`: print the two nameservers from the zone
     (`name_servers`) and the exact Vercel step (M4). Ask nothing and change nothing at Vercel.
   - Poll `GET /zones/{id}` status for at most 60 s, then exit 0 with "Waiting for the
     nameserver change (up to 48 h, often under an hour). Run `proto share setup --domain
     prtype.dev` again once Cloudflare emails that the site is active."
   - Exits non-zero only on errors.
4. **Active zone.**
   - Rewrite the config: `routes: [{ pattern: 'prtype.dev', custom_domain: true }]`, `vars.BASE =
     'prtype.dev'`, `SIGNIN = '1'`, `LEGACY = <the workers.dev name>`. `workers_dev` stays true for
     the redirect. No wildcard route, no `*` record.
   - Run the guard, deploy, and apply migrations (a no-op unless new).
5. **TLS health check.**
   - `https://prtype.dev/_health` over TLS (Node's default trust store), retried every 15 s for
     up to 15 minutes while the certificate is issued.
   - Then `https://<workers.dev>/s/<any id>/` returns 301 to `https://prtype.dev/s/<id>/`.
   - Then `GET https://prtype.dev/auth/github?...` with a dummy share returns the not-found page,
     proving the route is live without starting an OAuth flow.
6. **Host entry** becomes `stage: 'domain'`, `url: https://prtype.dev`, `base: prtype.dev`.
   Existing `.proto/shares.json` entries keep host `online`, so their links print as prtype.dev
   from now on.
7. Print: "prtype.dev is live: links are https://prtype.dev/<id>; viewers sign in with GitHub to
   comment."

**Tests (unit, fakes):**
- Missing zone with and without the create scope.
- A pending zone prints the nameservers and exits 0.
- An apex record refuses.
- The config after an active zone has exactly one custom-domain route and `SIGNIN: "1"`.
- The TLS wait times out with a clear message.
- A re-run on a live domain only deploys.

### Task 7: Production-like smoke under `wrangler dev`

**Files:**
- `.github/share-online-checks.mjs` (new)
- `.github/smoke.mjs` (a `--share-online-only` switch that runs it)
- `.github/fake-github.mjs` (reused)

**Setup:**
- Temp HOME.
- `PROTO_SHARE_TOKEN_STORE=file`.
- A free port in 8800 to 8810, never 8787 to 8799.
- State in the temp dir.
- A config made by the same `writeOnlineConfig()` as Task 5 with:
  - `BASE=prtype.localhost:<port>` (not a loopback name, so `upgraded()` stays off and only the
    migrations make the schema)
  - `PATH_MODE=1`, `SIGNIN=1`
  - `LEGACY=legacy.localhost:<port>`
  - `.dev.vars` with the fake GitHub's id and secret, `VIEWER_KEY`, `GITHUB_OAUTH`, `GITHUB_API`
- `wrangler d1 migrations apply DB --local --persist-to <state>`.
- The owner, `meta.owner_id` and token through the same `ownerAndToken({ target: 'local' })` as
  Task 5 step 10.
- `wrangler dev --local-protocol https --persist-to <state> --test-scheduled`.
- A host entry `online` with `stage: 'domain'`, `base: prtype.localhost:<port>`.
- Node requests use an undici `Agent` whose `connect.lookup` sends every `*.localhost` to
  127.0.0.1 and accepts the self-signed certificate. Chrome uses `--ignore-certificate-errors`
  (it resolves `*.localhost` itself).

**Steps and checks:**
1. `proto share <two variants> --yes` in a smoke session prints `link https://prtype.localhost:<port>/<id>`.
2. Chrome opens the short link and lands on `/s/<id>/` with the viewer showing the two designs.
3. Sign in through the fake GitHub:
   - The cookie is `v` with `Path=/s/<id>/`, `Secure` and HttpOnly.
   - The avatar shows.
   - Post a whole-design comment and a pinned one.
4. `proto share comments` shows both, fenced. `take` one → `proto inbox` shows it framed. `reply
   --done` → the viewer sees Done within one poll.
5. The page's sheet and tray show the online link and the comment (screenshots desktop and phone,
   for the PR).
6. A second owner token inserted by hand → `PUT` answers 403 `not_owner`.
7. Budget:
   - Set `budget(kv_write)` to 900 with `d1 execute --local` → `proto share update` prints the
     budget message and the version stays.
   - Set it back, update → works.
   - With `kv_delete` at 900 → the old key lands in `kv_trash`.
   - `GET /__scheduled?cron=17+0+*+*+*` drains it.
8. `proto share ls` prints today's usage.
9. `https://legacy.localhost:<port>/s/<id>/` → 301 to the `prtype.localhost` path.
10. Isolation, path mode as decided:
    - Share A's cookie is not sent to `/s/<B>/` (path).
    - The API refuses cross-origin calls (no CORS, `X-Proto` needed).
    - Record, as a known and accepted limit, that share A's script can read share B's
      localStorage. The check asserts that it can, so a later move to subdomains notices.
11. Shell refresh: the smoke session's `shell/viewer` file is made stale first, and the published
    HTML has the template's marker.
12. `rm` → the link says removed. The tombstone comes before the KV delete.
13. **Teardown:** stop only the wrangler this smoke started (by its own pid file and config path,
    the `runsConfig` rule), and remove the temp HOME.

**Acceptance:** `node .github/share-online-checks.mjs` passes twice in a row, and the local host on
8787 and any session server are untouched (their pids are the same before and after).

### Task 8: Docs

**Files:**
- `references/share.md`
- `SKILL.md`
- `scripts/proto.mjs` (help comment lines 55 to 65)
- `docs/superpowers/specs/2026-10-26-share-links-design.md`
- `docs/superpowers/plans/2026-10-26-share-links-phase-0-followups.md`

**Changes:**
- **`share.md`:**
  - "Setup" gets Online first (`proto share setup`, then `--domain prtype.dev`), with Local as the
    offline option.
  - What each step does.
  - Where things are: the isolated wrangler login
    `~/.prototypes/share-tools/wrangler-home/` (every manual wrangler command uses
    `XDG_CONFIG_HOME=~/.prototypes/share-tools/wrangler-home`), `~/.prototypes/host/online/wrangler.jsonc`, the Keychain item
    `prototype-share-online`, `prod.vars`.
  - Links: `https://prtype.dev/<id>` → `/s/<id>/`.
  - Limits with today's usage.
  - Path mode's one-origin limit, and the owner-only rule.
  - Troubleshooting:
    - not logged in / wrong account
    - plan check
    - zone pending
    - apex record conflict
    - TLS not yet issued
    - budget used up
    - `not_owner`
    - "host runs older code"
    - a new Mac (re-run setup)
    - a token lost (re-run setup)
- **`SKILL.md`:** sharing goes online by default once set up. Never run setup or publish without
  the user asking. Read the review aloud. Setup opens a browser for Tomer's approval.
- **Spec:**
  - Add decision 22 (path mode on prtype.dev, Tomer 2026-10-27; why; the isolation trade; the
    owner-only rule; subdomains stay possible later with a wildcard route).
  - Update the Hosting table row 2, the `--domain` bullet, Links (cookies on prtype.dev are `v`
    per path), the Security path-mode row, and phases 2 and 3 → "Online (this plan)".
- **Follow-ups:** tick the Task 6 and Task 7 items this plan fixed. Add "Online: verified" from
  Task 0.

**Acceptance:** `node --test .github/agent-checks.mjs` passes (it checks the help lines). The docs
name no command that doesn't exist.

### Task 9: Go-live run (agent with Tomer) and the PR

This is done in order, and stops at each manual step until Tomer says it's done.

1. The separate account exists (`contactwtimmy@gmail.com`) and the isolated wrangler home is
   logged in, so M1 and M2 are done.
   - Confirm with the prefixed `wrangler whoami`.
2. Run `proto share setup --name Dananz`. Its login check finds the session and skips the
   browser.
   - Only if the login has expired does it open `wrangler login` (M2 again). That call blocks
     until Tomer clicks Allow, so run it in the background and poll, or give it a long timeout.
3. Run the Task 5 check, then
   `proto share <a real prototype> --yes --host online` → the workers.dev link. Tomer opens it on
   his phone (M5a). This is the **first milestone**.
4. **Measure CPU on Cloudflare** (spec phase 2 "done when"):
   - Tail (or Workers Logs) while a script loads the document, `api/comments`, a comment POST (as
     a fake signed-in viewer is not possible online, so use the owner's own sign-in after step 7)
     and the owner poll.
   - Record p50 and max CPU per path in the PR. They must stay under 5 ms. Over 5 ms on one path is
     a finding to fix before step 8.
5. **Ask Tomer before anything touches DNS.**
   - Read Vercel's records for prtype.dev (Vercel MCP, read only).
   - `proto share setup --domain prtype.dev` adds the zone, or Tomer does (M3), and copies the
     records.
   - It prints the two nameservers.
6. Tomer sets them at Vercel (M4). Wait for "active". The agent re-runs the command, which a
   background check can watch (`Monitor` on `dig NS prtype.dev +short`).
7. `proto share setup --domain prtype.dev` again → deploy, TLS check. Tomer opens
   `https://prtype.dev/<id>` on his phone, signs in with GitHub and comments (M5b). The comment
   reaches the tray.
8. **PR** per AGENTS.md:
   - Screenshots of the viewer on prtype.dev (desktop and phone), the sheet with the online link,
     the tray with an online comment.
   - The CPU numbers.
   - The Task 0 answers.

---

## Manual checklist (only Tomer can do these)

Each step is asked for first. Nothing at Vercel or in DNS changes without his yes.

| # | Step | Where | Time |
|---|---|---|---|
| M1 | **Done** (account `contactwtimmy@gmail.com`). Kept for the record: make a **new, separate free Cloudflare account**: sign up with an email alias (e.g. `danantomer+prtype@gmail.com`), verify the email, add **no card**, skip the plan offers | dash.cloudflare.com/sign-up | 5 min |
| M2 | **Done** (the isolated wrangler home is logged in). Needed again only if that login expires. **Approve `wrangler login`**: a browser tab opens from `proto share setup`. `wrangler login` authorizes whichever Cloudflare user the browser is signed in as, so first sign out of the dananz.com account, or copy the consent URL into a private window. Sign in to the M1 account there and click Allow | browser | 1 min |
| M3 | Only if setup can't add the zone itself: **Add a domain** `prtype.dev` on the M1 account, pick **Free**, skip the DNS scan's suggestions (the agent copies Vercel's records), and continue until it shows two nameservers | Cloudflare dashboard | 3 min |
| M4 | **Switch nameservers at Vercel**: Domains › prtype.dev › Nameservers › Edit, replace Vercel's with the two Cloudflare nameservers setup printed, save. Then wait for Cloudflare's "site is active" email (often under 1 h, up to 48 h) | vercel.com/dashboard/domains | 2 min, then the wait |
| M5 | **Test on the phone**: (a) open the workers.dev link from step 3 of Task 9; (b) after the domain is live, open `https://prtype.dev/<id>`, sign in with GitHub (approve the OAuth App once), leave a comment | phone | 3 min |
| (if asked) | Only if Task 0 item 4 finds no API for the plan: confirm Workers & Pages › Plans says **Free** | Cloudflare dashboard | 1 min |

## Change (2026-10-27, after the plan): the site owns prtype.dev

Tomer moved the landing site to prtype.dev (commit c359c03). The site is the Worker `prtype-site`
(`site/wrangler.jsonc`, `site/worker.mjs`) on the same free account, with the custom domain on the apex
`prtype.dev`. Cloudflare serves its static files directly. The Worker runs only for
`/s/*`, `/api`, `/api/*`, `/auth/*`, `/_health` and a short link `/<id>`, and hands those to the share host
through a service binding `HOST`. Until that binding exists, those paths answer 503.

What this changes in Task 6 (`--domain prtype.dev`):
- The share host gets NO custom domain or route of its own on prtype.dev.
- Setup adds `"services": [{ "binding": "HOST", "service": "<host worker name>" }]` to `site/wrangler.jsonc`
  (or the equivalent), and redeploys the site with the isolated wrangler. The site reads `env.HOST`.
- The host still sees the original request URL (prtype.dev), so its BASE is `prtype.dev` and sign-in
  (callback https://prtype.dev/auth/github/callback) works through the site Worker.
- The zone is already active (nameservers switched; status "active"). The TLS check is `https://prtype.dev/_health`.
- The workers.dev host link still works on its own for the first milestone.
