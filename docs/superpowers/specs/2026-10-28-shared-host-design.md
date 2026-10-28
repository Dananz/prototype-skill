# One share host for every user: design

Status: proposal, 2026-10-28. Nothing built, deployed or pushed. Follows
`2026-10-26-share-links-design.md`; the decision numbers below continue its list (22 was path mode).

## The problem

Every user of the skill who clicks Share today must own a share host: `proto share setup` logs in
to *their* Cloudflare account, checks its plan by hand, needs GitHub OAuth secrets in
`~/.prototypes/host/prod.vars`, deploys Worker + KV + D1 + cron, and makes them the host's single
owner. Without that, the page's Share popover shows "No share host on this Mac yet ... proto share
setup" (`app/share/routes.mjs:84`, `NoHost` in `app/shell/share-link-sheet.tsx`). A teammate on a
fresh Mac cannot share at all without a Cloudflare account.

Goal: prtype.dev is one host, run by the maintainer, that any user publishes to after a GitHub
sign-in from the CLI or the page. No per-user infrastructure, no Cloudflare login, no setup.

## The trust model today

| Who | Credential | Where it lives | What the host checks |
|---|---|---|---|
| Owner (one per host) | Random bearer token, one per Mac (`owner_tokens.device`) | Keychain `prototype-share-online` / `-local` | SHA-256 of the token against `owner_tokens` (`host/lib/auth.mjs` `ownerOf`), not revoked. `last_used_at` written at most hourly. |
| The upload gate | `meta.owner_id` | D1 `meta` | `uploader()` (`host/worker.mjs:164`): uploads and cards only from the token whose owner is `meta.owner_id` (else 403 `not_owner`). The host on this Mac skips it. |
| Owner's GitHub identity | `owners.gh_*` | D1 | Set by the *claim*: `POST /api/owner/claim` (needs the owner token) returns a signed 10-minute, single-use URL (`claimUrl`, purpose `claim`, nonce spent in `tickets`). The OAuth callback writes `gh_id/login/name/avatar` on that owner row. A *new* share needs it (`needsSignIn`, 403 `sign_in`); updates and removes don't. |
| Per-row ownership | `shares.owner_id` | D1 | `putShare`, `putCard`, `deleteShare`, `listShares` and every owner comment query (`OWNED` in `comments.mjs`) filter by `owner.id`; a share that isn't yours is a 404. |
| Viewer | Signed cookie `v` / `__Host-v` (HMAC-SHA256 with `VIEWER_KEY`, purpose-bound, 30 days, scoped to one share) | Browser | GitHub web flow on the apex (`/auth/github`), then a 60 s ticket that only works with the nonce cookie set by `/_in/start` (blocks login CSRF). GitHub's access token is used for one `/user` read and dropped; `viewers` keeps id, login, name, avatar. |
| Viewer abuse | `caps` rows `gh:<id>` per hour, `share:<id>` per day | D1 | Comment rate limits. |
| Free plan | `budget` rows per UTC day | D1 | Refuse at 90% of each account cap: 900 KV writes, 900 KV deletes, 90,000 D1 writes, 900 MB stored. |

What makes this single-user by construction: decision 22 put every share on **one origin**
(`prtype.dev/s/<id>/`). One share's scripts can read another share's localStorage and `fetch`
`/s/<other>/api/...`; the browser attaches that share's `Path=/s/<other>/` viewer cookie, so the
call runs *as the viewer*. That is acceptable only because the owner is the only publisher, which is
exactly what `meta.owner_id` enforces. **Removing the upload gate without isolating shares from each
other is a security regression**: any user could publish a page that posts comments, votes and
reads other links as whoever opens it.

Good news: per-row ownership is already enforced everywhere, and the host code still speaks
subdomain mode (`returnTo` builds `<id>.<host>`, `viewerCookie` uses `__Host-v` there).

## Design

### 1. Isolation first (decision 23, Tomer's call)

Each share gets its own origin again. Two ways:

- **A. `<id>.prtype.dev`.** A proxied `*` DNS record on the prtype.dev zone and a Worker *route*
  `*.prtype.dev/*` to `proto-share` (custom domains don't take wildcards; routes do, on Free).
  Universal SSL already covers one level of wildcard. The apex stays on `prtype-site`. Residual
  risk: a share page can set a `Domain=prtype.dev` cookie that the apex sees (cookie tossing). The
  apex's OAuth state cookie is already `__Host-gh` over https, which a subdomain cannot set or
  overwrite, so this is low; it stays a rule that every apex cookie is `__Host-`. Cost: nothing.
- **B. A separate content domain**, e.g. `<id>.prtype.page` (the apex, sign-in and the API stay on
  prtype.dev). Strongest: share pages can't touch prtype.dev cookies at all, and if someone hosts
  phishing on it, Safe Browsing flags the content domain, not prtype.dev and the landing site.
  Cost: one domain (~$10 a year), a second zone on the account (setup's "no zone but prtype.dev"
  guard becomes "no zone but these two"), and a `CONTENT_BASE` var since `returnTo` assumes the
  share and the apex share a hostname.

Rejected: a CSP `sandbox` (opaque origin). The share is one self-contained HTML with the viewer
chrome inside; prototypes that use localStorage would throw, and the viewer's own API calls lose
their cookie.

Prior art: every product that hosts untrusted user HTML serves it from a separate registrable
domain, usually on the Public Suffix List so each site is its own cookie scope: github.io,
vercel.app, netlify.app, pages.dev, glitch.me, observableusercontent.com, usercontent.goog,
cdpn.io (CodePen).

**Decided (Tomer, 2026-10-28): A, `<id>.prtype.dev`.** No second domain. Keeping path mode is not an
option once anyone can publish, so links move to subdomains of the zone that exists. Mitigations
that A requires: every cookie on the apex is `__Host-` (no `Domain=`), the apex never trusts a
cookie a subdomain could set, and abuse handling (invite-only, takedown, reports) carries the
reputation risk that B would have isolated. B stays the upgrade path if abuse ever shows up. Short
links stay `https://prtype.dev/<id>`, so what users send doesn't change.

### 2. Users instead of one owner

- `owners` becomes the user table: one row per GitHub account (`UNIQUE(gh_id)`), plus
  `role` (`user` | `admin`), `status` (`active` | `pending` | `banned`), `created_at`.
- A row is made only by a GitHub sign-in, so every user has `gh_*` from birth and `needsSignIn`
  goes away for them.
- `meta.owner_id` stops being the upload gate. `uploader()` becomes "the user is `active`"; the
  maintainer's row gets `role = admin`.
- Tokens stay as they are: random, hashed in `owner_tokens`, one per device, revocable. Add
  `expires_at` (one year, slid forward on use at most daily) so a lost laptop's token dies.

### 3. Signing in from the CLI and the page (decision 24)

New users have no token, so the existing claim (which needs one) can't start. A host-mediated web
flow, like `gh auth login --web` and `wrangler login`:

1. `POST /api/signin/start` (no auth, rate-limited per IP) returns `{ code, poll, url, exp }`:
   `code` is a short id for the URL, `poll` a 32-byte secret only the CLI holds, `url` is
   `https://prtype.dev/auth/github?signin=<code>`. Stored hashed in a `signins` table, 10 minutes.
2. The CLI (or the session server, for the page) opens `url`. The apex runs the same OAuth web flow
   and callback it runs for viewers; the state carries `signin`.
3. The callback upserts the user by `gh_id` (new users start `active` or `pending`, per the launch
   mode below), marks the `signins` row done with the `gh_id`, and shows "Signed in as @login.
   You can close this tab." No token exists yet.
4. The client polls `POST /api/signin/poll { code, poll }` every 2 s. Once the row is done and
   `hash(poll)` matches, the host mints the device token at that moment, writes its hash to
   `owner_tokens`, deletes the row and returns the token **once** (no token ever rests in D1 in
   plaintext). The client stores it in the Keychain under the existing service
   `prototype-share-online`. Same name on purpose: `getToken('online')`, `hostNamed('online')` and
   every session's `.proto/shares.json` (`host: "online"`) keep working unchanged.

Why not GitHub's device flow: it needs "Enable Device Flow" turned on in the OAuth App's settings
(a GitHub change), and the host would then receive and handle the user's GitHub token. The web flow
reuses the OAuth App and callback that already exist, unchanged. Also rejected: sending
`gh auth token` to the host for a silent sign-in, since that token carries the user's full `gh`
scopes.

Commands: `proto share signin` (no token: this flow; a token: unchanged, says who you are, `--again`
switches account), and new `proto share signout` (revokes this device's token on the host, deletes
the Keychain item).

### 4. No setup for users

- **Built-in default host.** When `hosts.json` names no host, `defaultHost()` returns
  `{ name: 'online', base: 'prtype.dev', stage: 'domain', pathMode: false, default: true }`.
  A user's `hosts.json` (a local host, a self-hosted one) still wins when it says `default`.
- **No token** is no longer "run setup": `proto share` and `ls/update/rm` say
  `Sign in with GitHub first: proto share signin`; the session server's `no_host`/`no_token`
  answers become `sign_in` for the default host.
- **Version skew.** Today `liveHost` compares the host's exact code hash and tells everyone
  "The online host runs older code: proto share setup updates it", which is wrong for anyone but
  the maintainer. Replace with an API version: the host sends `x-proto-api: <n>` and the oldest
  client it accepts. Host newer than the skill: "Update the skill to share". Host older: silent for
  users; `proto share setup` (maintainer) still reports the hash.

### 5. The Share button before sign-in

The popover already has the right screen: `Gate` ("Sign in to share", Sign in with GitHub, a
waiting state) is shown when `mustSignIn(owner)`. Change what leads there:

- Default host + no token: the session server answers the list with
  `{ host: { name: 'online', stage: 'domain' }, owner: { signedIn: false, signin: true } }`, so the
  popover shows `Gate`, not `NoHost`.
- `useSignIn().go()` calls a new session-server route `POST /__proto/share/signin`, which runs
  step 3's start, opens the link in a new tab, polls, and writes the Keychain (the session server
  runs on the user's Mac). When it lands, the popover moves to the share form with no reload.
- Copy: "Sign in with GitHub to share. Links go out under your name; only you can update or remove
  them." Pending (invite mode): "Thanks, @login. Sharing opens once the maintainer approves you."
- `NoHost` stays only for a named non-default host that is missing (a `--host local` that was never
  set up).

### 6. Who can do what

| Action | Who |
|---|---|
| Open a link, read comments | Anyone with the link (unguessable id, 30-day expiry). Unchanged. |
| Comment, vote | Signed-in viewers, with the existing per-hour caps. Unchanged. |
| New share | Any `active` user, within their quota. |
| Update, card, rm, read the tray, send, reply, hide | The share's owner only (`shares.owner_id`; already enforced, a 404 for anyone else). |
| `ls --all` | Your own shares only (it already filters by owner). |
| Usage line | Your own quota, plus the host's day as a percentage. Other users' numbers are not shown. |
| Take down any share, ban or approve a user, see totals | `role = admin`, via `proto share admin …` and `/api/admin/*`. A takedown tombstones the share ("This link was removed"); a ban revokes the user's tokens and tombstones their shares. |

### 7. Quotas and abuse on the Free plan (decision 25, numbers are Tomer's call)

Free caps are per Cloudflare account, so every user shares them: 1,000 KV writes and 100,000 D1
writes a day, 1 GB KV stored, 100,000 Worker requests a day (viewer traffic now counts for
everyone). The host keeps its global 90% refusals and adds per-user ones nested inside, using the
`caps` table's `(what, slot)` shape and `SUM(bytes) WHERE owner_id`:

| Per user | Proposed | Why |
|---|---|---|
| Uploads (new + update + card) per day | 30 | 900 a day lasts 30 heavy users. |
| Live shares | 25 | |
| Stored | 75 MB | ~12 users at the cap fill 900 MB; most shares are 0.3 to 2 MB. |
| One share | 20 MiB (unchanged) | |
| Sign-in starts per IP per hour | 20 | `/api/signin/start` is unauthenticated. |

Storage today never frees: expiry "does not erase the hosted page". With many users it must:
**purge after a grace period** (proposal: an expired share's page and card are deleted 30 days
after expiry, by the existing cron within the delete budget; comments and the tombstone stay; an
update before the purge still renews it). That is a behavior change for existing links.

Abuse: any GitHub account can put arbitrary HTML on the maintainer's domain. Proposed:

- **Launch mode (decision 26)**: `invite` (new users start `pending`; `proto share admin approve
  <login>`, or an allowlist of logins / GitHub orgs in a var) or `open` (new users `active` when
  their GitHub account is at least 30 days old, from `/user.created_at`). Recommendation: `invite`
  first.
- A "Report this link" item in the viewer menu (one D1 row, rate-limited), listed by
  `proto share admin reports`.
- The review that blocks secrets and paths stays on the client; it protects the sharer, not the
  host, so the host doesn't rely on it.
- If it grows: Workers Paid ($5 a month, raises every cap above by 10x to 1000x) is the next step.
  Staying Free means a full day fails closed with a clear message and never a bill.

### 8. Migration of what exists

- **Shares**: ids unchanged; rows keep `owner_id` = Tomer's owner row. `https://prtype.dev/<id>`
  keeps working. With isolation A or B, `prtype.dev/s/<id>/...` answers 301 to the share's new
  origin; viewers sign in again once (their path-scoped cookie doesn't move). The 30-day expiry
  and the comments carry over.
- **Tomer's owner row** becomes `role = admin, status = active`. If its `gh_id` is still empty,
  his next `proto share signin` (the existing claim, token in hand) fills it; the migration then
  adds `UNIQUE(gh_id)`. His existing device tokens stay valid.
- **Sessions on Macs**: no rewrite. Entries say `host: "online"`, which the built-in default is
  named. A `hosts.json` entry from a past `proto share setup` keeps working; on a non-maintainer
  Mac it can be deleted.
- **Schema**: migration `0006_users.sql` (role, status, token expiry, `signins`, `reports`,
  unique index), and `upgrade.mjs` taught the same for the local host.

### 9. What stays

- `proto share setup` stays, for the maintainer's deploy and repair (and anyone who wants a
  private host: multi-user code with one user is today's behavior). It gains the wildcard route
  or the content domain, and drops the "make me the only owner" step for an "admin" flag. Docs
  move it out of the user path into a "Running the host" section.
- `proto share setup --local` and `--github`: unchanged, for offline work.
- `proto share file`: unchanged, the no-network fallback (one HTML, comments off).

## Task breakdown (after your go; each step reviewed, nothing deployed until you say)

1. **Decisions**: 23 (isolation A or B, and the domain if B), 25 (quota numbers, purge policy),
   26 (launch mode). Everything below depends on 23 and 26.
2. **Host: users and admin.** `0006_users.sql` + `schema.sql` + `upgrade.mjs`; `ownerOf` returns
   role/status and honors token expiry; `uploader()` checks status; `needsSignIn` only for legacy
   owners without `gh_id`; `/api/admin/*` (approve, ban, takedown, reports, totals). Tests in the
   Worker-in-memory harness.
3. **Host: sign-in for new users.** `/api/signin/start`, `/api/signin/poll`, the `signin` branch in
   `authStart`/`authCallback`, the `signins` table, per-IP caps, the "Signed in" and "Waiting for
   approval" pages. Tests: replay, expiry, wrong poll secret, double poll, pending user.
4. **Host: per-user quotas and purge.** Caps per user in `budget.mjs`; usage answers per user; cron
   purge after grace. Tests at each limit.
5. **Host: per-share origins** (A: wildcard route config in `onlineConfig`/`assertFreeConfig`;
   B: `CONTENT_BASE`, `returnTo`, second zone guard). `/s/<id>/` 301 from the apex; `__Host-` audit
   of every apex cookie. `linkOf`/`shortLinkOf` in `app/share/owner.mjs` hardcode
   `https://<base>/s/<id>/` for any online host and must build the per-share origin.
6. **CLI.** Built-in default host; `signin` without a token; `signout`; `sign_in` errors instead of
   setup hints; API-version check replacing the hash nag; `proto share admin …`.
7. **Page.** Session-server `POST /__proto/share/signin`; `no_host`/`no_token` become the `Gate`
   for the default host; pending copy; Hebrew strings (`app/shell/i18n/he/share-link.ts`).
8. **Viewer.** "Report this link".
9. **Docs.** `references/share.md`: user path = "Share, sign in once"; setup moves to "Running the
   host"; the limits and trust sections rewritten; spec decision list updated; README.
10. **Smoke + local dry run**: the whole flow against a local multi-user host under `wrangler dev`
    with two GitHub accounts (Tomer's and a second one).
11. **Deploy (needs your explicit go, step by step)**: buy the domain if B; DNS record / route on
    Cloudflare; apply the migration; deploy host then site; verify with a fresh Mac (no
    `hosts.json`, no token) end to end. Then the PR.

## Decided (Tomer, 2026-10-28)

23: A, `<id>.prtype.dev`. 25: 30 uploads a day, 25 live shares, 75 MB per user; pages purged 30
days after expiry. 26: invite-only, with an optional list of logins and GitHub orgs let in at once.
Everything stays on the Free plan: no paid binding, no R2, no card; the global 90% refusals stay.

## Contract (what the host and the clients build against)

Host, all JSON, errors `{ error, code }`:

| Call | Auth | Answer |
|---|---|---|
| `POST /api/signin/start` body `{ device? }` | none; 20 per IP (`cf-connecting-ip`) per hour, else 429 `rate` | 200 `{ code, poll, url, exp }`. `url` = `https://<BASE>/auth/github?signin=<code>`. 503 `signin_off` when sign-in isn't set up. |
| `GET <BASE>/auth/github?signin=<code>` | browser | the existing OAuth web flow; the callback upserts the user by `gh_id`, marks the `signins` row done, shows "Signed in as @login" or the waiting-for-approval page. |
| `POST /api/signin/poll` body `{ code, poll }` | the poll secret | 202 `{ state: 'waiting' }`; 200 `{ token, login, name, avatar, status }` once (row deleted, token minted now); 410 `expired`; 404 for an unknown code or a wrong secret. |
| `GET /api/owner` | token | adds `status` (`active`/`pending`/`banned`), `role` (`user`/`admin`) and `quota: { uploads, uploadsCap, shares, sharesCap, bytes, bytesCap }`. |
| `POST /api/owner/signout` | token | revokes this token. 200 `{ ok: true }`. |
| uploads (`POST /api/shares`, `PUT /api/shares/<id>`, `PUT .../card`) | token | 403 `pending` or `banned` by status; 507 `quota` (per user, with words) before the global 507 `budget`. Update and rm of your own share are never blocked by `pending`. |
| `GET /api/admin/users?status=` · `POST /api/admin/users/<login>/approve` · `POST /api/admin/users/<login>/ban` · `DELETE /api/admin/shares/<id>` · `GET /api/admin/reports` | token, `role = admin`; else 403 `admin` | ban: status `banned`, its tokens revoked, its shares tombstoned. |
| `POST <share origin>/api/report` body `{ reason }` | none; 5 per IP per hour | 200 `{ ok: true }`. |
| `/_health` | none | adds headers `x-proto-api: 2`, `x-proto-api-min: 2`. |

Env vars: `SIGNUP` = `invite` (default) or `open`; `ALLOW_LOGINS`, `ALLOW_ORGS` (comma lists; an
org counts when the user's membership is public: `GET /orgs/<org>/members/<login>` = 204 with the
user's own token, no extra OAuth scope). `open` admits accounts 30+ days old (`/user.created_at`).
Per-share origins online: `PATH_MODE` off, shares on `https://<id>.<BASE>/`; `https://<BASE>/s/<id>/<rest>`
answers 301 to `https://<id>.<BASE>/<rest>`. The generated online config adds the route
`*.<BASE>/*` (zone `<BASE>`); `assertFreeConfig` allows exactly that route.

Clients: the built-in host is `{ name: 'online', url: 'https://prtype.dev', stage: 'domain', base:
'prtype.dev', pathMode: false, default: true, builtin: true }`, used when `hosts.json` names no
default (and as `hostNamed('online')` when it has no `online` entry). Its token is the Keychain item
`prototype-share-online`, as today. Links: `https://<id>.<base>/` when `pathMode` is false; short
link `https://<base>/<id>`. Client API version 2: when `x-proto-api-min` > 2 the client says
"Update the skill to share". The old code-hash notice is shown only for a host this Mac deployed
(its `hosts.json` entry has `accountId`).
