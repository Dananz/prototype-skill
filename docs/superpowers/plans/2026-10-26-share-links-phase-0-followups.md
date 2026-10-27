# Share links, phase 0: follow-ups

Deferred findings from the phase 0 task reviews and the final review (2026-10-26), for the phases that need them. Nothing here blocks phase 0.

## Before the phase 0 PR (by hand, Tomer)

- One real `proto share setup --local` (writes the owner token to the login Keychain through `security -i`; the smoke only uses the file store).
- Open a link in Safari in both forms (`<id>.localhost:<port>/` and `127.0.0.1:<port>/s/<id>/`), and type into a design's textarea at Fit zoom (caret under CSS zoom).

## Deferred

- Task 1: scope.mjs:119,130 reuse idOf from app/numbers.mjs (accepts #2, rejects junk).
- Task 1: scope.mjs:128 pointless template literal; start re-parses words[0].
- Task 1: scope.mjs:113 pricing/B/extra silently ignores extra.
- Task 1: scope.mjs:144-148 slot kept only with a shared from; no test pins it.
- Task 2: review.mjs:170-173 abs-path has no boundary (/Users/x matches /Users/xavier), no guard for a short home, Windows path forms.
- Task 2: review.mjs:151-155 where shows 20 chars after a PEM header (key material) in the owner's terminal.
- Task 2: Bearer is case-sensitive; sk- rule hits long CSS classes (.sk-chase-…) with no override; IPv6/userinfo hosts; protocol-relative URLs not flagged; 20 MiB+1 prints 20.0; duplicate import basenames; no false-positive tests for the other patterns.
- Task 2: review.mjs overlap merge orders same-start hits by index only; partial overlap past a match doesn't extend end; startsWith(home) no path boundary; one very long comment line at 85-87; src="/x" absolute paths still one warning per path.
- Task 3: stamps.mjs:16-22 nameOf looks through any call (items.map / useMemo get the const's name; dev says the enclosing component) — only unwrap memo/forwardRef.
- Task 3: stamps.mjs:39 _jsxFileName found by name pattern only.
- Task 3: protosDir must be realpath'd or ids won't match and paths leak; Task 4 smoke must grep the final HTML for the home folder; assetsInlineLimit must be max for null-sharp inlining; CSS url()/index.html images skip the WebP load hook.
- Task 3: images.mjs:22,34 module-level warnings never reset/deduped; jsx-prod and componentName path have no unit coverage (Task 4 smoke covers).
- Task 3: rotate behavior proven only against a fake sharp; add a real orientation-6 fixture once sharp is installed (Task 4/7).
- Task 4: CSS url()/index.html images stay PNG (spec item 8); Google Sans ships every subset (~1 MB/share); Vue sessions untested in share mode; inline.mjs:38 escape <!-- and <script too; build.mjs:478 child build has no timeout; build.mjs:497 lock skipped if temp cleanup throws; stale-lock pid reuse / double takeover; lineage images missed (fixed if import-graph scan is used).
- Task 4: slot with no recorded holder still kept (fallback leak, no smoke case); reached non-code files become Tailwind @source entries; template-literal import()/import.meta.glob/.js->.ts not followed (fail closed); image() in helpers under src/ outside protos not scanned (picture dropped); Audio/Worker/sendBeacon URLs not reviewed.
- Task 5: desk.tsx:71 zoom floor can go below 0.05; index.tsx:39 matchMedia per render; desk fonts.ready late fitAll after a prototype switch; share-link-checks.mjs:187/:324 smoke session left with lang he / many prototype on failure; desk aria-label says Ctrl on Mac.
- Task 5: Space-drag in a mount may also select text; textarea caret offset under CSS zoom at non-100% (claimed Chrome hit-testing, unproven); smoke rewrites share-link/C.tsx in the smoke session.
- Task 6: DELETE removes KV before the D1 tombstone (500 instead of 410 in the gap); concurrent PUTs both take old+1 (use a conditional upsert, 409); owner auth writes last_used_at on every call (D1 write budget); POST reserves ids without an owner; api/state ignores expires_at; top-level catch returns HTML for /api; 413 content-length path untested; 301/405/_health lack nosniff/noindex, no ETag on no-cache documents; same() comment overstates; og:<id> key deleted but never written.
- Task 7: token file written before chmod / config dir 755; shares.json read-modify-write outside the build lock; snapshot and sourceHash taken after upload; references/share.md:21 owner naming order reversed; setup/stop need a session; local path mode puts all shares on one origin (phase 1 concern); smoke Keychain check only tests existence.
- Task 7: host binds 127.0.0.1 only while links say localhost (browsers may try ::1 first); setToken doesn't read back.
- Final review: viewer ignores the URL hash (deep links land on the start design; for phase 1's Copy link); the noscript injection needs a bare `<body>`; a token lost and repaired leaves the old token row unrevoked.

## Fixed by the online plan (2026-10-27-share-links-online)

- [x] Task 6: DELETE writes the D1 tombstone before the KV delete (Task 2).
- [x] Task 6: concurrent PUTs: each upload claims its version first and writes its own key; the loser gets 409 `race`, which the CLI asks once more (Tasks 2, 3).
- [x] Task 6: `last_used_at` written at most once an hour (Task 2).
- [x] Task 6: the top-level catch answers JSON on `/api` (Task 2).
- [x] Task 6: nosniff and noindex on every answer, `_health` and redirects included (Task 2).
- [x] Task 6: the never-written `og:<id>` key is no longer deleted (Task 2).
- [x] Task 7: setup and stop need a session: they run from any folder (Task 4).
- [x] Final review: a token lost and repaired leaves the old token row unrevoked: setup revokes this machine's earlier rows when it mints a token (Task 5, `ownerAndToken`).

## Online: verified (Task 0 of 2026-10-27-share-links-online, read 2026-10-27)

No account was changed. Wrangler facts are from 4.149.0 (`--help`, its bundled source, and a
read-only `whoami` with `XDG_CONFIG_HOME=~/.prototypes/share-tools/wrangler-home`); the rest is from
the official docs at the URLs given.

1. **Custom domains** (developers.cloudflare.com/workers/configuration/routing/custom-domains/): an
   apex works, `routes: [{ pattern: "prtype.dev", custom_domain: true }]` is the config, and
   Cloudflare "will create DNS records and issue necessary certificates on your behalf" (an Advanced
   Certificate for the hostname). It needs "an active Cloudflare zone". It refuses a hostname with an
   existing CNAME; the docs don't say what an existing A/AAAA does, so setup keeps refusing any apex
   A/AAAA/CNAME. No Free restriction is stated.
2. **Universal SSL** (developers.cloudflare.com/ssl/edge-certificates/universal-ssl/) covers the apex
   and first-level names on Free, issued "within 15 minutes to 24 hours of domain activation". The
   15-minute TLS wait in Task 6 can time out on a slow issue; re-running is the answer.
3. **workers.dev subdomain:** `GET /accounts/{id}/workers/subdomain` answers code 10007 when there is
   none; `PUT` with `{ subdomain }` registers it (the OAuth scope `workers_scripts:write` covers
   "subdomains"). A non-interactive `wrangler deploy` without one fails (its confirm falls back to no)
   unless wrangler thinks it runs under an agent, when it registers the Worker's name by itself.
   Setup must PUT first. `workers_dev` defaults to false once `routes` exist, so set it explicitly.
4. **Free-plan signal:** the zone's `plan` field is deprecated in favour of
   `/zones/{id}/subscription`; `plan.legacy_id` is `"free"` in the samples. No API says whether an
   account is on Workers Free or Paid (`/accounts/{id}/subscriptions` needs Billing Read, which
   wrangler's OAuth doesn't have; `workers/account-settings` has only the usage model). Fallback
   taken: setup stops with the dashboard path (Workers & Pages › Plans) and continues only with
   `--plan-checked`.
5. **Zone creation:** `wrangler login --scopes-list` offers `zone:read` and no zone or DNS write
   scope at all; `POST /zones` needs Zone Edit. So the zone and any DNS record are dashboard steps
   (M3), and Task 6's "create the zone if the token can" branch is never taken.
6. **Wrangler commands:** `whoami --json` → `{ loggedIn, authType, email, accounts: [{ id, name }],
   tokenPermissions }` (exits non-zero when logged out). `auth token --json` → `{ type: 'oauth',
   token }`. `secret put` reads stdin when it isn't a TTY. `secret list --format json` (the default)
   → `[{ name, type }]`. `deploy --secrets-file` exists. `d1 migrations apply` skips its prompt when
   not interactive (its help says so; checked locally). `migrations_dir` is a key of each
   `d1_databases` entry, not top-level. `d1 list --json` and `kv namespace list` exist for lookups.
   `wrangler dev --test-scheduled` answers both `/__scheduled?cron=` and `/cdn-cgi/local/scheduled`
   (the docs name only the second).
7. **Free limits** (workers, KV, D1 limits and pricing pages): Workers 100,000 requests a day, 10 ms
   CPU per request, 5 cron triggers, 50 subrequests; KV 100,000 reads, 1,000 writes, 1,000 deletes,
   1,000 lists a day, 1 GB, 25 MiB values; D1 5 M rows read, 100,000 rows written a day, 5 GB, 500 MB
   a database, 10 databases, 50 queries an invocation. All reset at 00:00 UTC. Over the daily request
   limit a route either fails open or closed (error 1027); the docs don't say which a custom domain
   or workers.dev does, but neither has an origin to pass through to. Over a KV or D1 cap, the call
   errors.
8. **CPU per request:** `wrangler tail` events aren't documented to carry CPU. Workers Logs do
   (`$workers.cpuTimeMs`, changelog 2025-04-09), on Free: 200,000 events a day, kept 3 days. So the
   generated config sets `observability.enabled`.
9. **Vercel nameservers** (vercel.com/docs/domains/managing-nameservers): Domains › the domain ›
   Nameservers › Edit, up to four; "Restore Original Nameservers" reverts; up to 48 h.
10. **Vercel's records for prtype.dev** (read with the Vercel MCP, team Dananz): seven, all made by
    Vercel: apex and `*` ALIAS `cname.vercel-dns-016.com.`, apex and `*` HTTPS (ech), apex CAA
    `letsencrypt.org`, `sectigo.com`, `pki.goog`. Nothing to copy into Cloudflare. Nameservers today
    `ns1/ns2.vercel-dns.com`. The domain has `renew: false` (bought 2026-10-26, expires 2027-10).
