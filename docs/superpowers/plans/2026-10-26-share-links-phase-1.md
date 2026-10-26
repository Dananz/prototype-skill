# Share Links, Phase 1 (comments round trip, GitHub sign-in, the owner's sheet and tray) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** A friend opens a share link, browses the designs, opens one full size in any device size
and zoom, signs in with GitHub and comments (pinned to an element or on the whole design). The
owner sees the comment in a "From links" tray in their own session page, replies, or sends it to
Claude; the status (and the owner's reply, never Claude's) shows back to the friend. The owner makes,
updates and removes links from a Share sheet in the page, not only the CLI. Still local only
(`wrangler dev`), still free.

**Spec:** `docs/superpowers/specs/2026-10-26-share-links-design.md`. Read decisions 13, 19, 20, 21;
"Access and identity" (Signing in with GitHub, The owner, Read-only is enforced on the host);
"Viewer comments, from the viewer to Claude and back" (all four parts); "Updating, changing and
removing a share" (Update link and Delete only); "Design" (Owner: the Share sheet; Viewer);
"Security" (all); "Integration"; "Edge cases".

**Reference designs** (read-only, session `f64ced15` under `/Users/tomer/.claude/skills/prototype/.prototypes/`):
`src/protos/viewer-board/C.tsx` (bar that grows into comments, the comment field, pins, counts,
the grow-in of a new comment, faces) and `src/protos/viewer/parts.tsx` (CommentCard with statuses
and the owner's reply, StatusChip, Avatar, Pin, Composer).

## Global Constraints

- Local only: `wrangler dev` and `wrangler d1 execute --local`; no login, deploy, or account call.
  Free only. GitHub OAuth web flow with a free OAuth App the owner registers (decision 20).
- Phase 0's rules stand: plain `.mjs` for scripts and the Worker; TS for shell code; every new
  string through `t()` with a Hebrew entry (`node scripts/i18n-check.mjs` passes); comment voice
  of the repo; the shell's one focus outline (AGENTS.md); Phosphor icons only; Base UI for popups,
  drawers and menus; CSS `zoom`, never `transform: scale`, for scaling designs.
- Viewer text is untrusted: rendered as text only (no `innerHTML`), fenced and attributed when it
  reaches the agent (spec "How viewer text reaches the agent"), and only on the owner's Send.
- Claude's reply text never leaves the Mac. Only statuses and the owner's own replies reach the host.
- Tests never touch the real Keychain, real `~/.config/prototype`, real `~/.prototypes/host`, any
  existing session, or the running local host on 8787; they use temp HOME and the env overrides
  phase 0 added, plus a fake GitHub (`GITHUB_OAUTH`, `GITHUB_API` pointing at a local test server).
- Never stop or restart a session dev server or the local share host the owner is using.
- Commit per task on `worktree-spec-share-links`; never push.
- Checks: `node --test .github/share-unit-checks.mjs`, `node --test .github/agent-checks.mjs`,
  `node scripts/i18n-check.mjs`, `node .github/smoke.mjs --share-link-only` (extend it; the full
  smoke crashes Chrome at comparefx on this Mac, also on main).

## Tasks

### Task 1: Host: GitHub sign-in, viewer comments API, owner comments API

Files: `host/schema.sql`, `host/worker.mjs`, `host/lib/*.mjs` (new `github.mjs`, `comments.mjs`,
`cookies.mjs` as needed), `.github/share-unit-checks.mjs`.

- Schema (additive, `IF NOT EXISTS`, plus `ALTER TABLE … ADD COLUMN` guarded so an existing local
  database upgrades): `viewers (gh_id INTEGER PRIMARY KEY, login, name, avatar, seen_at)`;
  comments carry `gh_id`, `variant` (route `slug/LETTER`), `body`, `target` (JSON: `{ src?,
  path?, x, y, view: { size, w, h } }` or null for a whole-design comment), `status` (`new`,
  `sent`, `working`, `done`), `owner_reply`, `owner_reply_at`, `hidden`, `deleted`, `created_at`,
  `updated_at`, `version`. Keep the spec's existing columns that still apply; drop nothing.
- Sign-in exactly as spec "Signing in with GitHub": `/auth/github` (apex), `/auth/github/callback`
  (apex), `/_in/auth?t=` (share origin, both subdomain and `/s/<id>/` path forms), `api/me`,
  `api/signout`. Secrets from env: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `VIEWER_KEY`;
  `GITHUB_OAUTH` (default `https://github.com`) and `GITHUB_API` (default `https://api.github.com`)
  overridable. Without a client id: `api/me` still answers, `api/config` says `{ comments: false }`.
  Path mode cookie `Path=/s/<id>/`.
- Viewer API on the share origin (all JSON, all require `X-Proto: 1`, no CORS):
  `GET api/config` → `{ comments, owner }`; `GET api/comments?since=` → every non-hidden,
  non-deleted comment on the share with `{ id, variant, body, target, status, owner_reply,
  author: { login, name, avatar }, mine, created_at }`; `POST api/comments` (signed in) `{ id
  (client UUID), variant, body, target }` → idempotent on id; `DELETE api/comments/:id` (own, only
  while `new`; after that it only hides). Caps: body ≤ 4000 chars, 30 per viewer per hour, 300 per
  share per day (D1 counters), each failing with 429 JSON `{ error }` the viewer can show.
- Owner API (bearer token): `GET /api/owner/comments?since=<ms>` across the owner's shares (with
  share id, title, author, everything), `PATCH /api/owner/comments/:id` `{ status?, reply?,
  hidden? }` (status transitions only forward; `sent` uses `WHERE status = 'new'` and reports a lost
  race as 409).
- Unit tests for every route above with the fake KV/D1, a fake GitHub (a local `node:http` server or
  an injected `fetch`), cookies signed/tampered/expired, the 60 s ticket, the caps, the 409 race, no
  CORS headers, `X-Proto` required.

### Task 2: Viewer: full view device sizes and zoom, Esc, the signed-in user

Files: `app/shell/viewer/*`, `app/shell/i18n/he/viewer.ts`, `.github/share-link-checks.mjs`.

- Full view (decision 21): a device control in the bar (Phone, Tablet with turn, Desktop, using
  `app/shell/view/sizes.ts` `SIZES`/`dims`/icons, the same look as the owner's layout-and-zoom
  menu), Fit and a zoom stepper/readout (25 % to 200 %) that scale only the design frame with CSS
  `zoom`; ⌘/Ctrl+wheel and pinch over the viewer zoom the frame and never the browser page (prevent
  the browser's page zoom there); `0` Fit, `1` 100 %; the frame centred, scrolling inside itself;
  phone and tablet frames drawn as devices like the owner's device view. The chosen size and zoom
  persist per viewer (localStorage). Esc always returns to the desk of all shared designs (and
  closes a popover first if one is open).
- Top right of the header: when signed out and comments are on, "Sign in with GitHub" (Phosphor
  `GithubLogo`, quiet button); when signed in, the viewer's avatar (28 px) and login, opening a menu
  with their name, "Signed in with GitHub", and "Sign out". About stays. Read `api/config` and
  `api/me` at start.
- Smoke: device switch changes the frame's size; zoom changes the frame's computed zoom and leaves
  `visualViewport.scale` at 1 and the page unzoomed; Esc from full view returns to the desk; the
  sign-in button links to the apex `/auth/github` with the share and back; with a fake signed-in
  cookie the avatar and login show and Sign out clears it.

### Task 3: Viewer: comments

Files: `app/shell/viewer/*` (new `comments.tsx` and friends), i18n, smoke.

- Port the reference's comment UI to real data: the bar's second row is the comment field ("Comment
  on #n…") with the commenters' faces and count; asking for comments grows the bar into the list
  (230 ms), each comment as the reference's CommentCard: avatar, login, time, body, status chip
  (Sent → Seen → In progress → Done → In the latest version), the owner's reply under it; pins on the
  design in full view and on the desk previews, numbered, with count badges on desk labels.
- Commenting needs sign-in: signed out, the field is a "Sign in with GitHub to comment" button;
  comments off (`api/config`), the field is absent and existing comments still show.
- Pinning: in full view a "Comment" toggle (and `C`) turns on pin mode: hovering outlines the element
  under the pointer, a click places a pin there (the design does not get the click) and opens the
  composer at the pin; Esc leaves pin mode. The target records the element's `data-proto-src` and
  `data-proto-component` stamps, a CSS path inside the mount, the point within the element (%), and
  the view size, so the pin re-anchors after reloads and on other device sizes (falls back to the
  stored point when the element is gone). A comment from the bar's field is a whole-design comment.
- New comments grow in (280 ms, reference). Poll `api/comments?since=` every 20 s while visible and
  on focus; optimistic add with the client id; a failed send keeps the draft with "Couldn't send.
  Try again"; drafts in localStorage. The first comment shows once: "Everyone with this link sees
  your name and comments." Delete own comment while `new`.
- Phone: the bar's comment row and the sheet (reference), pin mode via the Comment button.
- Smoke against the real host under `wrangler dev` with the fake GitHub: sign in, add a whole-design
  comment and a pinned one, see them after reload in the right place, status and owner reply appear
  after an owner PATCH, delete own, caps message.

### Task 4: Owner side: server routes, tray logic, statuses, CLI

Files: `app/server.mjs`, `scripts/share.mjs`, `scripts/share-host.mjs`, `scripts/proto.mjs`,
`app/shell/comments/types.ts`, `SKILL.md`, `references/share.md`, `references/listener.md`, tests.

- `/__proto/share/*` POST routes on the session server (same `refused()` origin check): `list`
  (this session's shares plus the host's view counts if any), `publish { scope, title }`, `update
  { id, note? }` (same link, version N+1, keeps comments; `done` comments get `done_in`), `remove
  { id }`, `comments` (the tray: new and recent), `send { ids }`, `reply { id, text }`, `hide { id }`,
  `dismiss { id }` (owner-local only). Publishing and updating reuse `share.mjs` functions (factor
  them out of the CLI so both call the same code).
- Polling exactly as spec "In the owner's page": every 30 s while the session has a live share and a
  page pinged in the last 10 minutes, and on page focus; new comments pushed over the Vite websocket
  as `proto:shares`.
- Send to Claude: the comment becomes an ordinary inbox batch through the same path as
  `/__proto/comments`, with `from` (spec Integration) and the body fenced and attributed per spec
  "How viewer text reaches the agent"; the host row flips to `sent` (409 → already sent elsewhere,
  shown as such). `proto inbox` taking it marks `working`; `proto reply … --done` marks `done`;
  through `.proto/shares/outbox.jsonl` when the host is down, as the spec says.
- CLI: `proto share update <id> [--note]`, `proto share comments`, `proto share take <id…>` (the
  same as Send, for an owner who asks in chat), help lines. SKILL.md: the injection rule and when to
  use `take`; listener.md one line.
- Tests: unit tests of the fencing and the outbox; agent-checks for the new CLI lines; smoke: a
  viewer comment (via the host API with a fake signed-in viewer) reaches `.../share/comments`, Send
  creates an inbox batch whose text is fenced and whose `from` is set, take → `working`, reply
  --done → `done` on the host, update keeps the link and comments.

### Task 5: Owner page: the Share sheet and the "From links" tray

Files: `app/shell/` (new `share-link.ts` + `.tsx` views per the spec's Integration row; the comments
island in `app/shell/comments/`), i18n, smoke.

- The Share sheet exactly as spec "Owner: the Share sheet" (entry rows, choosing prototypes and
  variants, preview, Create link, the link with Copy/Open/QR, Your links with Update link, Changed
  since shared, Remove), using Base UI Drawer on a phone and a popover/dialog on desktop as the shell's
  other sheets do; phase 1 omits passwords, people and expiry rows (later phase) but leaves room.
- The "From links" tray at the top of the comments island exactly as spec (cards with author avatar
  and login, route and version, time, body, pin location; Dismiss, Hide, Reply to <login>, Send to
  Claude; select several → "Send n to Claude"; the count badge on the island's toggle).
- Smoke: open the sheet, create a link for two variants, see it in Your links, update it, remove
  it; a viewer comment appears in the tray within one poll, Reply shows on the viewer, Send makes an
  inbox batch. Desktop and phone screenshots of the sheet and tray for the PR.

### Task 6: Setup for GitHub, docs, the end-to-end pass

Files: `scripts/share.mjs`, `scripts/share-host.mjs`, `references/share.md`, `SKILL.md`, smoke.

- `proto share setup --github`: prints the two-minute OAuth App registration (Homepage
  `http://localhost:<port>`, callback `http://localhost:<port>/auth/github/callback`), reads the
  client id and secret (flags or stdin, never echoed), writes them with a generated `VIEWER_KEY`
  into `~/.prototypes/host/.dev.vars` (mode 600), restarts nothing the owner didn't ask for (prints
  "Restart the host to apply: proto share stop && proto share setup --local" or does it with
  `--restart`). `setup --local` creates `VIEWER_KEY` if missing.
- Docs updated for everything in phase 1.
- End-to-end smoke with the fake GitHub across all of the above; screenshots (desktop and phone) of
  the viewer desk, full view with device sizes, comments open, signed-in user, and the owner's sheet
  and tray, into the scratchpad `phase1/` folder.
