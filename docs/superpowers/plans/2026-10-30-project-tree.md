# One Project Tree: Implementation Plan (Phase 1 of Designs and the Map)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every conversation in a project works in one live app holding one tree of prototypes, sessions become owners and filters instead of separate apps, and existing session apps are imported into it automatically, with the page's UI unchanged.

**Architecture:** A new project app at `<project>/.prototypes/_project/` replaces the per-session app. It keeps the file name and shape of `session.json` (so its eight readers keep working) with `id` set to a project id and a `sessions` map for each conversation. Every prototype's `meta.ts` records the session that made it (`session`) and the one working on it now (`owner`). Comments route to the owner's listener. Old session folders are copied in by an idempotent importer on `proto up`. Per-session `theme.css` files merge into one, with scoped overrides where tokens disagree.

**Tech Stack:** Node ESM scripts (`scripts/proto.mjs`, `app/server.mjs`, `app/listener.mjs`), Vite 8 + Tailwind 4 dev server, React 19 adapters, `node --test` checks in `.github/`.

**Spec:** `docs/superpowers/specs/2026-10-30-designs-and-map-design.md` (decisions 1, 10 and Phase 1).

## Global Constraints

- Base: `origin/main` at `ad7ef9f` (includes #159 History and Decision brief: `app/history.mjs`, `src/history/<slug>/<letter>/<n>/`, `.proto/decisions/<slug>.md`). The local `main` checkout is behind; branch from `origin/main`.
- Worktree: `~/.claude/skills/prototype/.worktrees/project-tree` (his rule `<project>/.worktrees/<name>`; only a folder directly under `~/.claude/skills/` registers as a skill, a nested one does not). `.worktrees` is excluded locally in `.git/info/exclude`.
- Commits add exact paths, never `git add -A` or a directory (his unstaged `app/shell/shell.css` hunk and Finder ` 2.*` duplicates are not ours).
- Prose and comments: no em dashes, no emojis, the terse why-comments density of the code around.
- Quick CI must pass: `git ls-files -z '*.mjs' | xargs -0 -r -n1 node --check`, `node scripts/proto.mjs stack --project .`, and every `node --test` file in `.github/workflows/smoke.yml`.
- Full smoke baseline on main (2026-10-30) already fails at share screenshots and `--comment-thread-only` ("one pin, it has 0"); `settings` fails only late in a full run. Do not chase those; any other new failure is ours.
- The page's UI does not change in this phase. The session filter in the UI is Phase 3 (Layers). Designs are Phase 2.
- URL routes stay `/<slug>/<letter>[/~tool][/<state>]`.

## Decisions this plan makes (the executor does not reopen them)

| # | Decision |
|---|---|
| D1 | Project app dir: `.prototypes/_project/`. Its `session.json` keeps today's fields; `id` = `p-` + 8 random hex (written once); `name` = the project folder's name; new `sessions: { [sid]: { agent, name, lang, createdAt, seenAt, migratedFrom? } }`. |
| D2 | Project-wide: `stack`, `project`, `path`, `port`, `tailnetPort`, `pid`, `url`, `localUrl`, `idleHours`, `building`, `stoppedAt`, `stopReason`, `lang` (the last `proto up --lang` wins, as today), `asks` (keyed by route, so merging is natural), `work` and `before` (the shell shows one strip: the last any conversation set). `keep` is implied true for the project app. Per session: the `sessions` entry, `.proto/sessions/<sid>/agent.json`, and its listener. |
| D3 | Slug rule (Tomer's call, 2026-10-30): `proto add <slug>` on a slug whose `meta.session` is another session creates `<slug>-2` (then `-3`, …) and prints the slug it used. `--join` adds variants to the existing one instead (becoming its owner). Same session: today's behavior. |
| D4 | Ownership: `meta.session` = creator, never changes. `meta.owner` = the last session that ran `add`, `work`, `ask`, `pick` or `fav` on it from the CLI. `ownerOf(meta) = meta.owner ?? meta.session`. |
| D5 | Inbox routing: a batch's owner = `ownerOf` of its first comment's prototype; a batch with no prototype route (intake, session-level) = the session with the latest `seenAt`. The server wakes the owner's listener; when the owner has no open listener it wakes the session with an open listener and the latest `seenAt`. `proto inbox` for session S takes batches owned by S plus batches whose owner has no open listener. |
| D6 | Locks: `.proto/session.lock` stays one project-wide mutex (critical sections are short). Any session may `proto stop` the server; another session's next `proto up` starts it again. |
| D7 | Themes: `mergeThemes` keeps one global `@theme` with the union of token names (value from the first scope that defines it); each scope whose value differs gets `[data-proto-theme="<scope>"] { --token: value }`. A variant's mount root carries `data-proto-theme={meta.theme}`. `@theme inline` tokens can't be scoped: they stay global and the conflict is reported. Non-`@theme` rules are kept once per distinct text; `@import` lines are deduped and hoisted. |
| D8 | Import runs on `proto up` when `.prototypes/` holds legacy session folders (a `session.json` with no `migratedTo`, and at least one `src/protos/*/meta.ts`). The calling session goes first: its slugs keep their names, and its `port` and `tailnetPort` move to the project app, so the link on Tomer's phone keeps working. The rest follow by `createdAt`. |
| D9 | Import scope, per legacy session: `src/protos/<slug>` (meta gets `session`, `owner`, `theme`), `src/history/<slug>`, `src/assets` (same bytes: shared; different bytes: `src/assets/<sid8>/<file>` with imports rewritten), `.proto/ref/<slug>`, `.proto/briefs/<slug>.json`, `.proto/decisions/<slug>.md`, `asks` (keys renamed), pending inbox batches (`new/` and `taken/` without replies, routes renamed, `owner` = old sid), `.proto/shares.json` records (keep their original `session` field, routes renamed), the listener config (moved to `.proto/listeners/<sid>.json`, so a live conversation keeps its wakeups), `package.json` dependencies (union; a version conflict keeps the higher and is reported). Skipped: `.proto/shots`, `.proto/snaps`, `dev.log`, `tmp`, `node_modules`. A legacy session whose `stack` differs from the project app's is skipped with a message. |
| D10 | Slug collision on import: `<slug>-2`, `-3`, … Every reference inside that session is rewritten (`from`, `also`, `slot`, `slots.*.use`, asks keys, inbox routes, history and decision paths, share routes). |
| D11 | After import: the legacy `session.json` gets `migratedTo: "_project"`, its server is stopped, its tailnet rule removed (unless moved per D8). The folder stays; gc removes it after its `deleteDays` as today. `.proto/imports.json` logs `{ sid, at, renames, assets, conflicts, skipped }`. |
| D12 | gc never deletes `_project`. `proto rm` deletes this session's prototypes (`meta.session == sid`) with their history, refs, briefs and decisions, after its listener's host task is verified disabled (as today); `proto rm --project` deletes the whole project app. `proto ls` prints the project app's line, then one line per session. |
| D13 | Kits: `useKit` merges the kit's `theme.css` through `mergeThemes` with scope `kit:<name>`, setting `meta.theme` only when a token disagrees. `kit save <slug>` resolves the tokens that prototype sees (global, then its scope). |
| D14 | Browser storage keys (`proto-comments-${id}`, `proto-place-${id}`, `proto-favs-only:${id}`, copy options) now use the project id. Unsent drafts in old session pages are lost; say so in the PR. |

## Review Focus

1. **A live conversation is migrated under an open tab.** Its link (same host and tailnet port) and its routes must still open the same variants. Test in Task 4: the calling session's `port`/`tailnetPort` and slugs carry over unchanged.
2. **Two conversations comment on each other's prototypes.** Each batch wakes the prototype's owner, not the last one to start. Test in Task 5.
3. **The same token with different values in two sessions' `theme.css`.** Neither old design changes look. Test in Task 2, and visually in Task 7.
4. **An old session with a different stack** (a Vue session in a project now detected as React). It is skipped with a message and left untouched. Test in Task 4.
5. **`proto share update <id>` on a link made before the merge.** It publishes the renamed routes from the project app to the same link. Test in Task 6.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/project.mjs` (create) | Project app path, project state read/write under the lock, session registry, `ownerOf`, legacy session discovery |
| `scripts/import.mjs` (create) | Import of one legacy session into the project app (D8 to D11) |
| `app/theme-merge.mjs` (create) | `mergeThemes`, pure, no I/O |
| `scripts/proto.mjs` (modify) | `sessionDir` → project app; `up`, `add`, `work`, `ask`, `pick`, `fav`, `archive`, `inbox`, `reply`, `ls`, `gc`, `rm`, `stop`, kit commands use the project state |
| `app/server.mjs` (modify) | Batch `owner` on receive; owner-aware notify; `status()` unchanged shape |
| `app/listener.mjs` (modify) | Listener files per session (`.proto/listeners/<sid>.json`, `-status`, `-notified`) |
| `app/src/registry-core.ts`, mount adapters in `app/adapters/` (modify) | `theme` read from meta; `data-proto-theme` on the variant root |
| `.github/project-checks.mjs`, `.github/import-checks.mjs`, `.github/theme-merge-unit-checks.mjs` (create) | `node --test` checks, added to `smoke.yml` |
| 17 `.github/*.mjs` that join `.prototypes/<id>` (modify) | Read the app at `.prototypes/_project` through one helper |
| `SKILL.md`, `references/listener.md`, `references/build.md` (modify) | The project tree, `--join`, ownership, listeners per session |

---

### Task 1: Project app and session registry

**Files:**
- Create: `scripts/project.mjs`
- Modify: `scripts/proto.mjs:183-265` (`sessionDir`, `remember`, `beat`), `:352-378` (`scaffold`), `:407-461` (`up`)
- Test: `.github/project-checks.mjs`

**Interfaces:**
- Produces (in `scripts/project.mjs`):
  - `projectApp(project: string): string`, which is `join(project, '.prototypes', '_project')`
  - `readProject(app: string): ProjectState`, which is the parsed `session.json`
  - `withProject<T>(app: string, fn: (s: ProjectState) => T): T`, which takes `.proto/session.lock`, runs `fn` on the state and writes it back
  - `registerSession(app: string, sid: string, info: { agent?: string, name?: string, lang?: string }): void`, which upserts `sessions[sid]` and sets `seenAt`
  - `ownerOf(meta: { owner?: string, session?: string }): string | null`
  - `legacySessions(project: string): { dir: string, json: object }[]`, the D8 test, sorted by `createdAt`
- `ProjectState` = today's session.json fields plus `sessions` (D1, D2).

- [ ] **Step 1: Write the failing tests** in `.github/project-checks.mjs`, using the `fixture()` pattern from `.github/agent-checks.mjs:13-25`, with `--session` on every call and `PROTO_NO_UPDATE=1`:
  - `test('up creates one project app and registers the session')`: after `up --session one --no-serve` (Step 3 adds the flag, so the check needs no server or install), `existsSync(<project>/.prototypes/_project/session.json)`; `json.id` matches `/^p-[0-9a-f]{8}$/`; `json.sessions.one.createdAt` is set; no `.prototypes/one` folder exists.
  - `test('a second session joins the same app')`: after `up --session two --no-serve`, `json.sessions` has keys `one` and `two`, and `json.id` is unchanged.
  - `test('url prints the project app url for any session')`: both `url --session one` and `url --session two` print the same URL.
- [ ] **Step 2: Run** `node --test .github/project-checks.mjs`. Expected: 3 failures (the app is still created at `.prototypes/one`).
- [ ] **Step 3: Implement** `scripts/project.mjs`, and point `sessionDir()` at `projectApp(project)`. The session id still resolves exactly as today (`:188-192`). `scaffold()` writes D1's fields once. `up()` calls `registerSession` before the beat. `beat()` writes `.proto/sessions/<sid>/agent.json`. `remember()` indexes the project app once. Add a `--no-serve` flag to `up` (scaffold and register only; skip install, Vite and tailscale) for checks.
- [ ] **Step 4: Run** `node --test .github/project-checks.mjs .github/agent-checks.mjs`. Expected: project-checks pass. agent-checks session-identity tests that read `.prototypes/<id>` fail; update their `session()` helper (`agent-checks.mjs:18-23`) to write a registered session in `_project`, and re-run until both pass.
- [ ] **Step 5: Commit** `scripts/project.mjs`, `scripts/proto.mjs`, `.github/project-checks.mjs`, `.github/agent-checks.mjs`, and add `node --test .github/project-checks.mjs` to `.github/workflows/smoke.yml`.

### Task 2: Theme merge

**Files:**
- Create: `app/theme-merge.mjs`, `.github/theme-merge-unit-checks.mjs`
- Modify: `app/src/registry-core.ts:6-29` (`Meta.theme?: string`, passed through `protosOf`), the variant mount in `app/adapters/` (`mount.react.*`, `mount.vue.*`: root element gets `data-proto-theme` when the variant's prototype has `theme`)

**Interfaces:**
- Produces: `mergeThemes(base: string, scopes: { scope: string, css: string }[]): { css: string, conflicts: { token: string, scopes: string[] }[], inline: string[] }`

- [ ] **Step 1: Write the failing tests** (`node --test`):
  - `same token, same value → one global line, no scoped block`
  - `same token, different values`: scopes `s1` `--color-brand: #111` and `s2` `--color-brand: #222` give `--color-brand: #111` in `@theme`, a `[data-proto-theme="s2"] { --color-brand: #222; }` block, and `conflicts` = `[{ token: '--color-brand', scopes: ['s1', 's2'] }]`
  - `token only in s2 → global`: global value `#222`, no block
  - `@theme inline token conflict → stays global, listed in inline`
  - `@import dedupe`: two scopes importing `"tailwindcss"` give one `@import "tailwindcss";` at the top
  - `non-theme rules kept once`: the same `.app { --font-sans: X }` from two scopes appears once; different texts both appear
  - `real fixtures`: run over the `src/theme.css` files of every folder in this repo's `.prototypes/*/` that exists (skip when none). The output parses (balanced braces), and every token of every input resolves to its original value under its scope. Write the resolver as a test helper that applies global, then the scope block.
- [ ] **Step 2: Run** `node --test .github/theme-merge-unit-checks.mjs`. Expected: fails (module missing).
- [ ] **Step 3: Implement** `mergeThemes` in `app/theme-merge.mjs`: a brace-aware scan of top-level blocks (no CSS parser dependency) and the D7 rules. The first scope wins the global value.
- [ ] **Step 4: Run** the same test plus `node --check app/theme-merge.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** the three files, `app/src/registry-core.ts`, the touched adapters, and the `smoke.yml` line.

### Task 3: Ownership and the slug rule

**Files:**
- Modify: `scripts/proto.mjs:471-590` (`add`), `:745-939` (`setWork`, `ask`, `pick`, `fav`, `archive`), `app/server.mjs:68-83, 153-209` (page `work`, `pick`, `fav` stay ownerless: a page action has no session)
- Test: `.github/project-checks.mjs`

**Interfaces:**
- Consumes: `withProject`, `ownerOf` (Task 1)
- Produces: `meta.session`, `meta.owner` (D4); `proto add … --join`; `proto ls --session <sid>` (prototypes whose `ownerOf` or `session` is sid)

- [ ] **Step 1: Write the failing tests:**
  - `add stamps session and owner`: `add home --session one` gives meta `session: 'one'` and `owner: 'one'`
  - `another session's slug gets a new one`: `add home --session two` exits 0, creates `src/protos/home-2`, leaves `home` untouched, and stdout includes `home-2`
  - `--join adds variants and takes ownership`: `add home --session two --join --variants "D:Extra"` exits 0, meta `owner` is `two`, `session` is still `one`, and `D.tsx` exists
  - `work moves ownership`: `work home/A --session one` sets owner back to `one`
  - `same session adds as today`: `add home --session one --variants "E:More"` exits 0 without `--join`
- [ ] **Step 2: Run.** Expected: those 5 fail.
- [ ] **Step 3: Implement** D3 and D4. The printed line is exact copy: `"<slug>" is <title>, made in another conversation, so this one is "<new slug>" (--join adds to it instead).`
- [ ] **Step 4: Run** `node --test .github/project-checks.mjs .github/agent-checks.mjs`, then `node .github/pick-parents-checks.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `scripts/proto.mjs`, `app/server.mjs`, `.github/project-checks.mjs`.

### Task 4: Import legacy sessions

**Files:**
- Create: `scripts/import.mjs`, `.github/import-checks.mjs`
- Modify: `scripts/proto.mjs` `up()` (calls the importer before the server starts), `scripts/app-sync.mjs:38` (also leaves `src/history` and merged `theme.css` alone)

**Interfaces:**
- Consumes: `projectApp`, `withProject`, `legacySessions` (Task 1), `mergeThemes` (Task 2)
- Produces: `importSession(project: string, app: string, legacy: { dir: string, json: object }, opts: { first: boolean }): ImportResult`
  - `ImportResult = { sid: string, renames: Record<string, string>, assets: Record<string, string>, conflicts: string[], skipped?: string }`
  - The result is appended to `.proto/imports.json`.
- `up()` prints one line per imported session: `imported <name> (<n> prototypes<, renamed a→b, …>)`

- [ ] **Step 1: Write the failing tests** in `.github/import-checks.mjs`. Fixtures are hand-written legacy folders (session.json, `src/protos/<slug>/meta.ts` + `A.tsx`, `src/theme.css`, `package.json`), with no install:
  - `calling session first keeps slugs, port and tailnet port`: legacy `one` (port 5190, tailnetPort 9510, slug `home`) and `two` (slug `home`); `up --session one --no-serve` gives app port 5190, tailnetPort 9510, `src/protos/home` from `one`, `src/protos/home-2` from `two`
  - `references are rewritten`: in `two`, `child` with `from: 'home/B'` and `slots.cta.use: 'home/C'` (the shape at `docs/superpowers/specs/2026-10-13-pick-replaces-in-place-design.md`) becomes `home-2/B` and `home-2/C`; `asks['home/B']` becomes `asks['home-2/B']`
  - `assets`: the same bytes under the same name are shared (one file); different bytes go to `src/assets/<two's first 8 chars>/hero.jpg`, and the import line in `home-2/A.tsx` points at it
  - `history, refs, briefs, decisions follow the rename`: `src/history/home-2/B/1/version.json` and `.proto/decisions/home-2.md` exist
  - `pending inbox moves with owner`: a `new/` batch in `two` with route `home/A` lands in the app with route `home-2/A` and `owner: 'two'`; a `taken/` batch whose comments all have `reply` is not moved
  - `listener config moves`: `two/.proto/listener.json` becomes `_project/.proto/listeners/two.json`
  - `shares keep their session`: a `two` record `{ id: 'x', session: 'two', routes: ['home/A'] }` is appended with `routes: ['home-2/A']` and `session: 'two'`
  - `stack mismatch is skipped`: legacy `vue1` with `stack: 'vue'` while the app is React has `skipped` set, its folder untouched, and no `migratedTo`
  - `idempotent`: a second `up` imports nothing, and `imports.json` length is unchanged
  - `legacy marked`: `one/session.json` has `migratedTo: '_project'`
- [ ] **Step 2: Run** `node --test .github/import-checks.mjs`. Expected: all fail.
- [ ] **Step 3: Implement** `importSession` per D8 to D11. Rewrite references by parsing meta JSON (meta.ts is `export default { … }` JSON, as `proto add` writes it). Rewrite import specifiers in variant and history files with an exact-string replace of the old relative asset path. Stop a running legacy server with its `pid` and remove its tailnet rule (the same calls `proto stop` uses at `:949`), unless its ports moved per D8.
- [ ] **Step 4: Run** `node --test .github/import-checks.mjs .github/project-checks.mjs`. Expected: PASS. Then a dry run on a copy of this repo's real `.prototypes/` (`cp -R` to a temp project, `up --no-serve`) and read `imports.json`: no unexpected `skipped`, and conflicts listed.
- [ ] **Step 5: Commit** `scripts/import.mjs`, `scripts/proto.mjs`, `scripts/app-sync.mjs`, `.github/import-checks.mjs`, and the `smoke.yml` line.

### Task 5: Inbox ownership and listeners per session

**Files:**
- Modify: `app/server.mjs:361-455` (`receive`: set `batch.owner`), its notify path; `app/listener.mjs:37, 110-123, 151` (paths per sid; auto-close counts only the owner's prototypes; wake body carries `session: <owner sid>`); `scripts/proto.mjs:1619-1660` (`take`, `orphans`), `inbox --listen/--status/--reconcile/--close/--unlisten/--reopen` take the calling session
- Test: `.github/listener-lifecycle-checks.mjs` (extend), `.github/project-checks.mjs`

**Interfaces:**
- Consumes: `ownerOf`, `readProject` (Task 1); `meta.owner` (Task 3)
- Produces: `batchOwner(app: string, batch: object): string | null` (D5) in `app/server.mjs`; listener files at `.proto/listeners/<sid>.json`, `<sid>-status.json`, `<sid>-notified.json`

- [ ] **Step 1: Write the failing tests:**
  - `batch owner is the first comment's prototype owner`: with `home` owned by `one` and `cart` by `two`, a batch `[cart/A, home/A]` has `owner: 'two'`
  - `routing wakes the owner`: with fake webhook servers for `one` and `two` (the pattern in `.github/listener-checks.mjs`), a batch on `home/A` hits only `one`'s URL
  - `owner without a listener falls through`: `one` closed, so a batch on `home/A` wakes `two`
  - `inbox takes own and orphaned batches only`: `inbox --session two` prints the `cart` batch and not a `home` batch while `one`'s listener is open
  - `two listeners coexist`: `--listen` for `one` then for `two` leaves both files, and `--status` for each says `listening`
- [ ] **Step 2: Run** `node --test .github/listener-lifecycle-checks.mjs .github/project-checks.mjs`. Expected: the new tests fail.
- [ ] **Step 3: Implement** D5. A legacy single `.proto/listener.json` found in the project app (from a hand copy) is read as the listener of the session with the latest `seenAt`, then moved.
- [ ] **Step 4: Run** the two test files plus `node .github/smoke.mjs --comment-core-only`. Expected: PASS.
- [ ] **Step 5: Commit** `app/server.mjs`, `app/listener.mjs`, `scripts/proto.mjs`, and the two check files.

### Task 6: gc, rm, ls, stop, shares and kits in the project world

**Files:**
- Modify: `scripts/proto.mjs:952-1010` (`gc`, `keep`, `rm`, `ls`, `stop`), `:2198-2459` (kit `save`, `useKit`), `scripts/share.mjs:277-284` (`projectShares` reads `_project` and still-unmigrated folders), the share publish path (`publish.mjs:150-152`: `session` = the record's own field when updating, the project id when new)
- Test: `.github/project-checks.mjs`, `.github/share-unit-checks.mjs`, `.github/design-kit.mjs`

**Interfaces:**
- Consumes: Tasks 1 to 5
- Produces: `proto rm` (this session's prototypes), `proto rm --project`; the `proto ls` lines `project <name> <url> <live|stopped>` then `  session <sid> <name> <n> prototypes <seenAt>`

- [ ] **Step 1: Write the failing tests:**
  - `gc never deletes the project app`: `seenAt` and `createdAt` set 60 days back, then `gc`, and `_project` still exists
  - `rm removes only this session's prototypes`: after `rm --session two` (listener verified disabled), `home` (from `one`) remains, `cart` and its `src/history/cart` are gone
  - `ls shape`: the stdout's first line starts with `project `, then one `  session ` line per registered session
  - `share update on a pre-merge record`: an imported record `{ id: 'x', session: 'two', routes: ['home-2/A'] }` builds from the project app, and the upload payload's `session` is `two` (use `.github/fake-github.mjs` and the memory env in `share-memory-env.mjs`, as `share-unit-checks.mjs` does)
  - `kit on a project with another look`: `add pay --kit` where the project theme's `--color-brand` differs from the kit's gives meta `theme: 'kit:main'` and a scoped block in `src/theme.css`
- [ ] **Step 2: Run.** Expected: fail.
- [ ] **Step 3: Implement** D12 and D13, and the share record rule above.
- [ ] **Step 4: Run** `node --test .github/project-checks.mjs .github/share-unit-checks.mjs`, then `node .github/smoke.mjs --share-link-only` and the design-kit part of smoke. Expected: PASS (apart from the baseline failures in Global Constraints).
- [ ] **Step 5: Commit** the touched files.

### Task 7: Harness, docs and the full run

**Files:**
- Modify: the 17 `.github/*.mjs` that join `'.prototypes', <id>` (list: `grep -l "\.prototypes" .github/*.mjs`, excluding ` 2.*`). Each reads the app through one helper, `appOf(project) = join(project, '.prototypes', '_project')`, exported from `.github/project-checks.mjs`.
- Modify: `SKILL.md` (the opening "session › prototype › variant" becomes "project › prototype › variant, one app per project, each conversation a session in it", plus D3 `--join`, D4 ownership, the import line `proto up` prints, and `proto rm`/`ls`), `references/listener.md` (one listener per conversation, routing by owner), `references/build.md` if it names the session folder.

- [ ] **Step 1: Run** `node .github/smoke.mjs` before the harness edit. Expected: failures where files read `.prototypes/smoke`.
- [ ] **Step 2: Edit** the harness files to use `appOf`. Run `node .github/smoke.mjs`. Expected: only the Global Constraints baseline failures.
- [ ] **Step 3: Visual check of Review Focus 1 and 3:** copy this repo's real `.prototypes/` to a temp project, run `up` with the session of one real folder, and `proto shoot` two imported prototypes from different sessions whose `theme.css` disagree. Compare them with the same shots taken from the legacy apps before import (`proto shoot` there first). Expected: no visible change. Check that the printed URL equals that session's old URL.
- [ ] **Step 4: Edit** SKILL.md and the references, then run quick CI (Global Constraints).
- [ ] **Step 5: Commit** the harness files, `SKILL.md` and `references/*.md`. Open the PR with `.github/PULL_REQUEST_TEMPLATE.md`: the page's UI is unchanged, so Screenshots is `N/A: no visual changes`; the body states D14 (old unsent drafts lost) and the import behavior.
