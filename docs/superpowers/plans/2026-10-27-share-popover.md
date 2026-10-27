# Share popover (build of prototype share-sheet #2)

Tomer picked #2 "Share popover" of the "Sharing a link" prototype (session
`f64ced15-a520-4f47-9572-f624b9fc8c21`, files in
`.prototypes/f64ced15-a520-4f47-9572-f624b9fc8c21/src/protos/share-sheet/B.tsx` and `parts.tsx` of the
main checkout). His asks:

1. Sharing requires the owner to sign in with GitHub first.
2. A message ("prompt") for viewers, written right before publishing a link.
3. Watching existing links: who is in them now, views, comments.
4. An easy Share button in the navbar (desktop).
5. Suggest updating existing links after changes.

Everything stays on the Cloudflare free plan. Writes go through the host's budget meter.

## Decisions

- **Owner identity lives on the host's `owners` row** (`gh_id`, `gh_login`, `gh_name`, `gh_avatar`), not
  on the Mac. Any Mac holding the owner token is signed in once the owner is.
- **The gate is on the host:** uploading a *new* share without an owner GitHub identity answers
  `403 { code: 'sign_in' }`. Updates and removes of existing shares keep working on the token alone,
  so live links never break. The page and the CLI both lead to the same sign-in.
- **Sign-in flow:** the session server asks the host `POST /api/owner/claim` (owner token) for a
  short-lived signed claim URL (`<apex>/auth/github?claim=<signed>`; 10 min). The person opens it in
  a new tab. It runs the same GitHub OAuth app and callback as viewer sign-in (the state carries the
  claim), writes the GitHub fields to the owner row, and ends on a plain "Signed in as <login>. You can
  close this tab." page. The page polls the session server's `owner` route until signed in.
- **The viewer message is a new column `shares.message`** (at most 280 characters), set on publish
  and changeable on update. `shares.note` stays what it is in the spec: an update's "What's new".
- **Presence:** a new table `presence(share_id, gh_id, route, at, PRIMARY KEY (share_id, gh_id))`.
  Only signed-in viewers ping, `POST <share>/api/here { route }`, at most once a minute while the page
  is visible (and on focus). Upsert, metered like every other D1 write; refused quietly (204) when the
  budget guard is on. Anonymous viewers are only in `views`. "Now" means `at` within 2 minutes.
- **Which variants changed** is worked out on this Mac: the kept sources in
  `.proto/shares/<id>/v<N>/<proto>/` against `src/protos/<proto>/`, file by file. A changed `<LETTER>.tsx`
  (or `.vue`) is that variant; any other changed file (parts, meta, assets) counts as "shared parts".

## Contract

### Host (Worker)

- Migration `host/migrations/0004_owner_presence.sql` and `host/lib/upgrade.mjs` (ADD COLUMN pattern)
  and `host/schema.sql`, all ending in the same schema: `owners.gh_id INTEGER`, `owners.gh_login TEXT`,
  `owners.gh_name TEXT`, `owners.gh_avatar TEXT`; `shares.message TEXT`; table `presence`.
- `GET /api/owner` (owner token) → `{ login, name, avatar }`, each null when not signed in.
- `POST /api/owner/claim` (owner token) → `{ url }`. Refused with `{ code: 'signin_off' }` when
  `signinReady(env)` is false.
- Upload of a new share: refused `403 { code: 'sign_in', error }` until the owner has `gh_id`. Takes
  `message`. Update takes `message` too (null clears it, absent keeps it).
- Owner list (`GET /api/shares`): each row adds `message`, `views` (total of `views.n`), and
  `viewers`: up to 8 `{ login, name, avatar, route, at }`, latest first, from `presence` joined to
  `viewers`, last 30 days.
- Share `GET /api/state`: adds `message`, `note`, `owner: { login, name, avatar } | null`.
- Share `POST /api/here { route }`: signed-in viewers only (401 otherwise), at most one write per
  viewer per share per 50 s (check `at` before writing), metered.
- The cron's cleanup drops presence rows older than 30 days, inside its subrequest limit.

### Session server (`app/share/routes.mjs`, POST `/__proto/share/<name>`)

- `owner` → `{ host: <name> | null, signedIn: boolean, login, name, avatar, signin: boolean }`
  (`signin`: whether the host can run the flow). Cached a minute; `refresh: true` asks now.
- `signin` → `{ url }`, the claim URL to open in a new tab.
- `list` → as now, and each share adds `message`, `views`, `viewers` (as the host, plus
  `now: boolean`), and `changedVariants: [{ key: '<proto>/<LETTER>', name }]`, with
  `{ key: '<proto>/*', name: 'Shared parts' }` for other files. `changed` stays.
- `publish` takes `message` (trimmed, at most 280). A host `sign_in` refusal answers
  `409 { code: 'sign_in', error }`.
- `update` takes `message` (string sets, null clears, absent keeps) as well as `note`.

### CLI

- `proto share signin`: prints the claim URL and opens it (`open` on a Mac), then waits up to five
  minutes, polling `GET /api/owner`, and prints "signed in as <login>".
- `proto share …` hitting `sign_in`: one line, "Sign in with GitHub first: proto share signin".
- `proto share <scope> --message "…"` and `proto share update <id> --message "…"`.
- `proto share ls` shows who is in each link now and the changed variants.

### Shell (owner page)

- **Navbar Share button** on a wide screen, before ⋯, an icon-and-text bar button (the bar's `IB`
  class, not a filled pill). An amber dot when a link of this session is behind its edits; a small
  green count when someone is in one of them now.
- **The popover** anchored under it, the shell's anchored-menu pattern (as Decide does), Esc and a
  press outside close it:
  - **Signed out:** GitHub mark, "Sign in to share", one line on why (links go out under your GitHub
    name; only you can update or remove them; once per host), and "Sign in with GitHub", which opens
    the claim URL in a new tab and shows "Waiting for GitHub…" while it polls `owner`.
  - **Signed in, home:** "Share as <login>" with the avatar and New link. Then this prototype's link,
    if there is one: preview, URL with Copy and Open, faces, "<name> is looking at <route>" when
    someone is in it now, views and comments (new ones marked), and, when it is behind, an amber box:
    "You changed N variants since vN", the changed variants listed, an optional "Tell viewers what
    changed" field (the update's `note`), and "Update to vN+1" (same link, comments kept). Then the
    session's other links, each with views, comments, last viewer, Update when behind, and Copy.
  - **New link:** back arrow; What to share (This variant / This prototype / Everything, the sheet's
    `Quick`) with "Opens on …" and "Choose…", which opens the existing full Share link sheet;
    "Message for viewers" (a textarea, 280 characters, three starters: "Which one would you pick?",
    "Is anything confusing?", "Does the copy read well?"); the review box; Create link; then the
    sheet's `Made` (link, Copy, Open, QR) with the message quoted.
- The existing sheet stays (variant menus, the phone's pill menu, "Choose…"). Its New link gains the
  same Message field, and it shows the sign-in step when signed out. On a phone, Share stays in the
  pill menu and opens the sheet (drawer).
- Every string through `t()`, with Hebrew in `app/shell/i18n/he/share-link.ts`; logical sides only.

### Viewer (`app/shell/viewer/`)

- The owner's message first: a quiet card at the top of the comments panel / above the designs on
  the first visit, "<avatar> <login>: <message>", folded once read (remembered per share in this
  browser). "Shared by <login>" with the avatar in the header.
- Presence ping while visible and signed in.

## Checks

The existing smokes stay green (`.github/share-*.mjs`), with the fake GitHub
(`.github/fake-github.mjs`) signing the owner in where a new share is published. New checks for:
the gate (403 before, 201 after sign-in), the claim flow end to end against the fake GitHub, message
on publish/update/state, presence ping and the 50 s throttle, owner list fields, changed variants,
the popover's three views, and the viewer message.
