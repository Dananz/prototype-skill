# Share Links, Phase 0 (local host and share builds) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `proto share pricing/2 pricing/3` builds those two variants into one self-contained file,
publishes it to a share host running on this Mac under `wrangler dev`, and prints a link that opens
a read-only copy of the prototype. Nothing is deployed or connected to Cloudflare.

**Architecture:** A Vite build of the session app in a new `share` mode. A plugin swaps in a
registry holding only the chosen variants, a trimmed `session.json`, images converted to WebP and
source stamps computed at compile time. A small step then inlines everything into one HTML file,
gzipped. A plain-JS Cloudflare Worker (`host/`), run locally by `wrangler dev` with KV and D1
emulated on disk, stores and serves it. The CLI side lives in `scripts/share.mjs` and
`scripts/share-host.mjs`, dispatched from `scripts/proto.mjs`.

**Tech Stack:** Node 22+ (`node:test`, `node:sqlite` for host tests), Vite 8 / Rolldown (session
app), React 19 shell, Cloudflare Workers + KV + D1 under `wrangler` 4.149.0 (local only), `sharp`
0.35.5.

**Spec:** `docs/superpowers/specs/2026-10-26-share-links-design.md` (read "The share artifact",
"Hosting", "Limits", "Security" and "Integration" before starting).

## Global Constraints

- Phase 0 is local only. No `wrangler login`, `wrangler deploy`, DNS, or any Cloudflare account
  call. The only Cloudflare tool used is `wrangler dev` and `wrangler d1 execute --local`.
- Free only: no R2, no paid plan, nothing that needs a card.
- Pinned versions: `wrangler@4.149.0`, `sharp@0.35.5`, installed on demand into
  `~/.prototypes/share-tools/` (never into a session's `package.json`).
- Share and link ids: 10 characters, Crockford base32 lowercase (`0123456789abcdefghjkmnpqrstvwxyz`),
  from 50 random bits (`crypto.getRandomValues`).
- Links people see carry no query string. Internal frame URLs may (`?dv=1&theme=…&v=<n>`).
- Size: block a share over 20 MiB gzipped; warn over 5 MiB.
- Images: WebP, quality 82, at most 2560 px wide, never enlarged.
- `session.json` in the bundle is exactly `{ name, stack, lang }`.
- Scripts and the Worker are plain `.mjs` (CI runs `node --check` on every `.mjs`); shell code is TS.
- Every new shell string goes through `t()` with a Hebrew entry; `node scripts/i18n-check.mjs` passes.
- Comment density and prose voice match the surrounding files (this repo explains *why* in prose).
- Work on branch `worktree-spec-share-links`; commit per task; never push without Tomer's word.

## Review Focus

1. A shared variant imports a helper or an image from a prototype that is not shared (a `--from`
   lineage helper). Expected: the build includes that code (the bundler follows imports), and the
   unshared prototype's meta and variants are not in the registry. Test: Task 4, step 1 (`lineage`).
2. A variant uses an image through CSS `url()` or an absolute `/x.png` path. Expected: CSS images
   are inlined; an absolute path that won't resolve in the share is listed by the review as an
   outside URL. Test: Task 2 (`absolute asset path is reported`) and Task 4 (`css url inlined`).
3. A Hebrew session. Expected: the share keeps `lang: 'he'`, so the shell reads right to left.
   Test: Task 1 (`trimSession keeps lang`) and Task 5, step 1 (`hebrew share is rtl`).
4. Publishing while the session's dev server runs, or two publishes at once. Expected: the dev
   server and the session's own `dist/` are untouched; the second publish waits for the first.
   Test: Task 4 (`build leaves the session alone`, `publishes are serialized`).
5. The local host isn't running, its port is taken, or the tools aren't installed yet. Expected:
   it starts, moves to the next free port, or installs, saying what it does; on failure a clear
   message and no entry in `.proto/shares.json`. Test: Task 7 (`host down`, `port taken`).

---

## File Structure

| Path | Responsibility |
|---|---|
| `app/src/registry-core.ts` (new) | `protosOf(metas, files)`: the registry's logic, out of `registry.ts`, so the share registry reuses it |
| `app/src/registry.ts` | Keeps its two globs, calls `protosOf` |
| `app/share/scope.mjs` (new) | Parse a scope from CLI words; trim meta and session |
| `app/share/review.mjs` (new) | The pre-publish checks over the built HTML |
| `app/share/plugin.mjs` (new) | The `share` mode Vite plugins: virtual registry, session, images module, JSX runtime routing, env cut, build options |
| `app/share/stamps.mjs` (new) | Compile-time `data-proto-src` / `data-proto-component` for `src/protos/**` |
| `app/share/images.mjs` (new) | PNG/JPEG → WebP data URLs with `sharp` |
| `app/share/inline.mjs` (new) | Turn Vite's output folder into one HTML string |
| `app/share/build.mjs` (new) | `buildShare()`: run the build in a child process, inline, gzip, review, lock |
| `app/share/jsx-prod.ts` (new) | `jsxDEV` for production React, mapping to `jsx`/`jsxs` |
| `app/shell/jsx.ts` | Use a compile-time component name; fall back to `jsx-prod` when React has no `jsxDEV` |
| `app/shell/mode.ts` (new) | `SHARE` flag and the build-time share info |
| `app/shell/transport.ts` (new) | The four `/__proto` calls behind one interface, dev and share |
| `app/shell/shell.ts` | Its four `/__proto` fetches go through `transport` |
| `app/shell/viewer/*` (new) | The viewer of decision 19 (header, desk, phone, bar), mounted by `main.ts` in share mode |
| `app/src/main.ts` | `createViewer` in share mode, the state poll |
| `app/vite.config.mjs` | In `share` mode, add `sharePlugins()` |
| `host/schema.sql` (new) | The spec's D1 schema, `IF NOT EXISTS` throughout |
| `host/wrangler.template.jsonc` (new) | Worker config with `KV` and `DB` bindings, filled in by setup |
| `host/worker.mjs`, `host/lib/*.mjs` (new) | The Worker: ids, owner auth, routing, pages, the endpoints |
| `scripts/share-host.mjs` (new) | Tools install, hosts file, owner token store, local host process, HTTP client |
| `scripts/share.mjs` (new) | `proto share` subcommands |
| `scripts/proto.mjs` | `share` in the command table and the help comment |
| `.github/share-unit-checks.mjs` (new) | `node --test`, no installs: scope, review, ids, Worker with fake KV/D1 |
| `.github/share-link-checks.mjs` (new) | Smoke module: real session, real build, `wrangler dev`, Chrome |
| `.github/smoke.mjs`, `.github/workflows/smoke.yml` | Register the two |
| `SKILL.md`, `references/share.md` (new) | When and how the agent shares a link |

---

### Task 1: Scope, trimming and the shared registry core

**Files:**
- Create: `app/share/scope.mjs`, `app/src/registry-core.ts`
- Modify: `app/src/registry.ts`
- Test: `.github/share-unit-checks.mjs`

**Interfaces:**
- Consumes: `letterOf(n)` from `app/numbers.mjs`; `metaOf(text)` from `app/server.mjs` (export it if it isn't).
- Produces:
  - `class ShareError extends Error` (message is user-facing)
  - `parseScope(words: string[], all: boolean, protos: { id: string, variants: string[], archived: boolean }[]) -> { protos: { id: string, variants: string[] }[], start: string }`. Words are `slug`, `slug/<n>` or `slug/<LETTER>`; `all` takes every non-archived prototype; `start` is the first word's route (`pricing/B`), or the first prototype's first variant.
  - `trimMeta(meta: object, keep: string[], shared: Set<string>) -> object`: keeps `title, kind, screen, created, states`, `variants` and `about` limited to `keep`, and `from`/`also`/`slot` only when they point inside `shared`; drops everything else (`ask, picked, favorites, archived, count`, unknown keys).
  - `trimSession(session: object) -> { name: string, stack: string, lang: string }` (`lang` defaults to `'en'`).
  - `protosOf(metas: Record<string, Meta>, files: Record<string, () => Promise<unknown>>) -> Proto[]` in `registry-core.ts`: the current body of `registry.ts`, unchanged in behavior.

- [ ] **Step 1: Write the failing tests** in `.github/share-unit-checks.mjs` (`node:test`, `assert/strict`):
  - `parseScope numbers and letters`: `['pricing/2','pricing/C']` over `pricing` A to E gives `{ protos: [{ id: 'pricing', variants: ['B','C'] }], start: 'pricing/B' }`.
  - `parseScope whole prototype`: `['pricing']` gives all five variants.
  - `parseScope --all skips archived`.
  - `parseScope rejects`: unknown slug, unknown variant (`pricing/9`), and no words without `all` each throw `ShareError` whose message names the bad word.
  - `trimMeta drops owner data`: input with `ask, picked, favorites, archived, count, from:'home/B'` (home not shared) loses all six; `variants` keeps only `keep`.
  - `trimMeta keeps lineage inside the share`: `from:'home/B'` stays when `shared` has `home`.
  - `trimSession keeps lang`: `{ name:'X', stack:'react', lang:'he', project:'/Users/x', url:'https://m.ts.net', port:5173, asks:[1] }` → `{ name:'X', stack:'react', lang:'he' }` exactly.

- [ ] **Step 2: Run** `node --test .github/share-unit-checks.mjs`. Expected: FAIL (`Cannot find module '../app/share/scope.mjs'`).

- [ ] **Step 3: Implement** `app/share/scope.mjs`, move the registry body into `registry-core.ts` as `protosOf`, make `registry.ts` call it with its two globs.

- [ ] **Step 4: Run** the unit file (PASS), then `node .github/smoke.mjs` far enough to load a variant (the registry move must not change the page). Expected: PASS.

- [ ] **Step 5: Commit** `feat(share): scope, trimming and the registry core`.

### Task 2: The pre-publish review

**Files:**
- Create: `app/share/review.mjs`
- Test: `.github/share-unit-checks.mjs`

**Interfaces:**
- Produces: `review({ html: string, gzBytes: number, projectPath: string, home: string, projectImports: string[], currents: string[] }) -> { block: Finding[], warn: Finding[] }` with `Finding = { code: string, message: string, where?: string }`.
  Codes and rules:
  - `too-big` (block): `gzBytes > 20 * 2**20`. `heavy` (warn): `> 5 * 2**20`.
  - `secret` (block), one per match, `where` = 40 characters around it with the match masked. Patterns: `-----BEGIN [A-Z ]*PRIVATE KEY-----`, `\bsk-[A-Za-z0-9_-]{20,}`, `\bgh[pousr]_[A-Za-z0-9]{36,}`, `\bAKIA[0-9A-Z]{16}\b`, `\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}`, `\bBearer [A-Za-z0-9._-]{20,}`, `\bdp\.(st|sa|ct|pt)\.[A-Za-z0-9]{20,}`, `\b(sk|rk)_live_[A-Za-z0-9]{20,}`, `\bsb_secret_[A-Za-z0-9_-]{20,}`.
  - `abs-path` (block): the HTML contains `projectPath` or `home` (as given and with `\\` for Windows).
  - `project-code` (warn): `projectImports` not empty; message lists their basenames.
  - `real-screens` (warn): `currents` not empty (shared variants named `Current`).
  - `outside-url` (warn): every distinct `https?://` origin other than `fonts.googleapis.com` and `fonts.gstatic.com`.
  - `private-url` (warn): URLs on `localhost`, `127.0.0.1`, `*.ts.net`, `10.*`, `192.168.*`, `172.16-31.*`, and `src="/…"` or `url(/…)` absolute paths (they won't load from the share).

- [ ] **Step 1: Write failing tests**: `secret blocks` (one per pattern, a fake value of the right shape), `jwt in a data url is not a secret` (a `data:image/webp;base64,eyJ…` string must not match, so the JWT rule needs a non-base64 boundary; pick one and test it), `abs path blocks`, `size thresholds` (5 MiB + 1 warns, 20 MiB + 1 blocks), `google fonts are not outside`, `absolute asset path is reported`.
- [ ] **Step 2: Run** the unit file. Expected: FAIL.
- [ ] **Step 3: Implement** `review()`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(share): pre-publish review`.

### Task 3: Compile-time stamps, WebP images and the production JSX runtime

**Files:**
- Create: `app/share/stamps.mjs`, `app/share/images.mjs`, `app/share/jsx-prod.ts`
- Modify: `app/shell/jsx.ts`
- Test: `.github/share-unit-checks.mjs` (stamps on a fixture string), Task 4's smoke assertions (end to end)

**Interfaces:**
- Produces:
  - `stampsPlugin({ protosDir: string }) -> VitePlugin`: `enforce: 'post'`, `transform(code, id)` only for ids under `protosDir`. After the JSX transform each tag is a `jsxDEV(type, props, key, isStatic, { fileName, lineNumber, columnNumber }, this)` call. Rewrite every `fileName` value to `"/src/protos/<path under protosDir>"`, and add `componentName: "<Name>"`, the nearest enclosing function whose name is capitalized (function declaration, or a `const Name = (…) =>` / `function` expression), or omit it. Parse with `this.parse(code)`. If the plugin context has no `parse` in this Vite version, use `rolldown/utils`' `parseAst`, and record which one in a comment.
  - `stampSource(code: string, ast: Program, rel: string) -> string`: the pure rewrite, exported for the unit test.
  - `imagesPlugin({ sharp: ((input: string) => Sharp) | null, root: string }) -> VitePlugin`: `enforce: 'pre'`, `load(id)` for `/\.(png|jpe?g)(\?url)?$/` under `root`: returns `export default "data:image/webp;base64,…"` (resize to `min(width, 2560)`, `webp({ quality: 82 })`). With `sharp === null` it returns `null` (Vite inlines the original) and pushes a warning onto `imagesPlugin.warnings`.
  - `app/share/jsx-prod.ts`: `export function jsxDEV(type, props, key, isStatic): ReactElement` calling `jsxs` when `isStatic`, else `jsx`, from `react/jsx-runtime`; also `export { Fragment }`.
  - `app/shell/jsx.ts`: when `source.componentName` is a string, use it and skip `componentOf`; when React's `jsxDEV` is undefined, call `jsx-prod`'s `jsxDEV` (stamping stays the same).

- [ ] **Step 1: Write the failing test** `stamps rewrite`: a fixture of transformed JSX (two components, one tag in a `.map` callback inside `PriceCard`). Node has no JS parser built in, so the test imports the plugin's parser from a session's `node_modules` when one exists and is skipped with a message otherwise (Task 4's smoke covers it end to end). Assert: no absolute path remains, `fileName: "/src/protos/pricing/parts.tsx"`, the `.map` tag gets `componentName: "PriceCard"`.
- [ ] **Step 2: Run.** Expected: FAIL (or SKIP without a session; then go on, Task 4 is the gate).
- [ ] **Step 3: Implement** the three files and the `jsx.ts` change. In dev nothing changes: `componentName` is never present and React has `jsxDEV`.
- [ ] **Step 4: Run** the unit file, then the dev smoke (`node .github/smoke.mjs`), which already checks `data-proto-src` and `uses` through `comment-uses-checks.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(share): compile-time stamps, WebP images, production JSX runtime`.

### Task 4: The share build

**Files:**
- Create: `app/share/plugin.mjs`, `app/share/inline.mjs`, `app/share/build.mjs`
- Modify: `app/vite.config.mjs`
- Test: `.github/share-link-checks.mjs` (smoke module, part 1), registered in `.github/smoke.mjs`

**Interfaces:**
- Consumes: Task 1 (`trimMeta`, `trimSession`, `protosOf` via `/src/registry-core.ts`), Task 2 (`review`), Task 3 (plugins, `jsx-prod.ts`).
- Produces:
  - `sharePlugins({ scope, session, sharp, appDir }) -> VitePlugin[]`. `vite.config.mjs` adds them when `mode === 'share'`, reading the scope from the JSON file named by `PROTO_SHARE_SCOPE`. They:
    - resolve `./registry` imported from `src/main.ts` to a virtual module that imports `protosOf` and, per shared prototype, inlines `trimMeta(...)` as a literal (read with `metaOf`) and lists `{ './protos/<slug>/<L>.<ext>': () => import('/src/protos/<slug>/<L>.<ext>') }` for the kept variants only;
    - resolve every `../session.json` import to a virtual module exporting `trimSession(session)`;
    - resolve `./images` (from `src/`) to a module whose map holds only the asset names the shared protos' files name in a literal `image('…')`; a non-literal call anywhere in them keeps all, and adds a warning;
    - route `react/jsx-dev-runtime`: imports from `src/protos/**` go to `app/shell/jsx.ts`, all others to `app/share/jsx-prod.ts`; make the JSX transform run in development mode for the share build (find the Vite 8 / `@vitejs/plugin-react` 6 option; record it in a comment);
    - set `envDir: false`, `envPrefix: '__PROTO_NONE__'`, `build.sourcemap: false`, `build.assetsInlineLimit: Number.MAX_SAFE_INTEGER`, `build.cssCodeSplit: false`, a single JS chunk (Rolldown's option for inlining dynamic imports; verify the name against Rolldown 1.2 docs), `build.outDir` from `PROTO_SHARE_OUT`;
    - define `__PROTO_SHARE__` as `{ title, owner, version, updatedAt, scope }` JSON for `mode.ts` (Task 5).
  - `inlineHtml(outDir: string) -> string`: reads `index.html`, replaces the one `<script type="module" src>` with an inline module script and the one stylesheet `<link>` with a `<style>`; throws `ShareError` listing any other file left in `outDir`.
  - `buildShare({ sessionDir, scope, info: { title, owner, version } }) -> Promise<{ gz: Buffer, html: string, rawBytes: number, gzBytes: number, review: ReturnType<typeof review>, warnings: string[] }>`: takes `.proto/shares/.lock` (waits up to 5 min, then `ShareError`), writes the scope to a temp file, runs `node <session>/node_modules/vite/bin/vite.js build --mode share` with cwd `sessionDir` and `PROTO_SHARE_SCOPE` / `PROTO_SHARE_OUT` (a fresh `mkdtemp`), inlines, gzips at level 9, reviews (project imports = resolved ids under `session.project` that the build reports through a JSON file the plugin writes; `currents` = kept variants whose meta name is `Current`), removes the temp dir, releases the lock.

- [ ] **Step 1: Write the failing smoke checks** in `.github/share-link-checks.mjs`, `export async function shareLinkChecks({ proto, app, local, openPage, fail })` (same shape as `share-checks.mjs`). Add `share-link` with A to E; each variant renders a unique marker (`MARK-A` …); B imports a 3000×2000 PNG made at test time and a helper from a second prototype `lineage-src` that is not shared; C has a CSS `background: url(./tile.png)`. Then call `buildShare` for `share-link/2 share-link/3` and assert:
  - `single file`: the output folder had only `index.html`, one JS, one CSS before inlining.
  - `only chosen variants`: html contains `MARK-B`, `MARK-C`, not `MARK-A`, `MARK-D`, `MARK-E`.
  - `lineage`: the helper's marker is present, `lineage-src`'s meta title is not.
  - `webp`: html contains `data:image/webp;base64,` and no `data:image/png;base64,` longer than 10 KB.
  - `css url inlined`: C's tile is a `data:` URL.
  - `no session secrets`: html has neither the project path, `ts.net`, nor the session's `asks` text.
  - `build leaves the session alone`: the session's `dist/` mtime and the dev server (`local`) both unchanged; a page fetch still answers 200.
  - `publishes are serialized`: two `buildShare` calls at once both succeed, and their build windows (timestamps the function returns) don't overlap.
- [ ] **Step 2: Run** `node .github/smoke.mjs`. Expected: FAIL in `shareLinkChecks`.
- [ ] **Step 3: Implement** `plugin.mjs`, `inline.mjs`, `build.mjs`, and the `vite.config.mjs` hook. `sharp` comes from `~/.prototypes/share-tools/node_modules/sharp` through `createRequire` (Task 7 installs it; until then the smoke installs it into the tools dir itself).
- [ ] **Step 4: Run** the smoke. Expected: PASS. Then build the two heavy real sessions measured on 2026-10-26 (`4f389d48`, `1dd8affe…`) whole, and record their gzipped sizes in the commit message (expected about 2 to 3 MB).
- [ ] **Step 5: Commit** `feat(share): one-file share build`.

### Task 5: The viewer (decision 19)

**Reference:** session `f64ced15`, `src/protos/viewer-board/C.tsx` (and `../viewer/parts.tsx` for
About). Read it and the spec's Design › Viewer before starting; run
`proto handoff viewer-board/C --session f64ced15-a520-4f47-9572-f624b9fc8c21` and tick its lines
(comment-only lines are phase 1: say so, don't build them).

**Files:**
- Create: `app/shell/mode.ts`, `app/shell/transport.ts`, `app/shell/viewer/index.tsx` (`createViewer`), `app/shell/viewer/desk.tsx` (wide canvas, pan/zoom, mount policy), `app/shell/viewer/phone.tsx`, `app/shell/viewer/header.tsx` (title, prototype list, About), `app/shell/viewer/bar.tsx`
- Modify: `app/shell/shell.ts` (the four `/__proto` fetches through `transport`, lines 390, 3121, 3135, 3156), `app/src/main.ts`, `app/shell/i18n/he/*.ts`
- Test: `.github/share-link-checks.mjs` (part 2)

**Interfaces:**
- Consumes: `__PROTO_SHARE__` (Task 4); the stack's `mount(el, Variant) -> () => void` from `./mount`; `protos` from the share registry.
- Produces:
  - `mode.ts`: `export const SHARE: boolean` (`import.meta.env.MODE === 'share'`), `export const shareInfo: { title: string, owner: string, version: number, updatedAt: string } | null`.
  - `transport.ts`: `status(): Promise<Status | null>`, `post(path, body, signal?)`, `sendBatch(body)`, `fav(body)`. Dev: today's fetches, moved as they are (the shell keeps working unchanged). Share: `status()` fetches `api/state` (relative to the document, so path mode works) with header `X-Proto: 1`, mapping `{ version, updatedAt }`; the other three reject with `new Error('read-only')`. From `file:`, `status()` resolves `null`.
  - `createViewer(el, { mount, protos, session })`: the viewer of the spec (header with the prototype list and About, the desk on wide screens, one design and the switcher on a phone, the bar's first row with name, dots or jump list, and zoom). No comment field, no counts, no pins (phase 1). `main.ts`: `SHARE ? createViewer(…) : createShell(…)`, and in share mode `status()` every 60 s while visible and on `focus`; a higher version shows a quiet banner `t('There is a newer version')` with `t('Reload')` under the header.
  - Mount policy exactly as the spec: live within one viewport of the view or selected, at most 8 live, the rest a light card; a phone mounts one.

- [ ] **Step 1: Write the failing checks** (Chrome, through the smoke's `openPage`, on the Task 4 build served by a throwaway `node:http` server answering `/` with the html and `/api/state` with `{ version: 1 }`):
  - `desk lists only shared`: at 1440x900 the desk has artboards `#2` and `#3` (markers `MARK-B`, `MARK-C`), no `MARK-A`/`D`/`E`, and no shell chrome (`[data-act]` absent).
  - `prototype list`: a share of `share-link/2 share-link/3 lineage-src` shows a caret on the title; opening it lists two prototypes; choosing `lineage-src` swaps the artboards.
  - `zoom`: `+` raises the readout, `0` returns to Fit, `1` reads `100%`; an artboard's computed `zoom` changes and its `transform` stays `none`.
  - `mount policy`: with 20 designs (a fixture prototype of 20 small variants), live mounts never exceed 8 at Fit, and panning to the far end mounts the end ones and unmounts the start.
  - `phone`: at 390x844 one design is mounted, the switcher reads `#2 … · 1/2`, its `›` shows `MARK-C` with one mount, and a horizontal wheel/drag over the design does not change it.
  - `no session calls`: no request path starts with `/__proto` during 5 s of use.
  - `stamps survive`: an element in C has `data-proto-src` starting `share-link/` and a non-empty `data-proto-component`.
  - `newer version banner`: the server then answers `{ version: 2 }`; after a `focus` event the banner shows.
  - `hebrew share is rtl`: with `lang: 'he'` the header and bar have `dir="rtl"` and the artboards keep their order.
  - `file open`: the html opened as `file://` renders `MARK-B` with no console errors.
- [ ] **Step 2: Run** the smoke. Expected: FAIL.
- [ ] **Step 3: Implement** `mode.ts`, `transport.ts` (and the shell's switch to it), the viewer files, `main.ts`, Hebrew strings.
- [ ] **Step 4: Run** the smoke, `node scripts/i18n-check.mjs`, and the dev smoke (the shell must be unchanged). Expected: PASS. Then the overlay check: screenshot the built viewer at 1440x900 and 390x844 into the reference session's `.proto/ref/viewer-board/built-C.png` (and `built-C-phone.png`) with the same three designs, run `proto shoot viewer-board/C --ref … --as built`, and fix until the overlay shows no double edges in the chrome (the designs themselves differ: theirs are stand-ins).
- [ ] **Step 5: Commit** `feat(share): the viewer, a zoom desk of the shared designs`.

### Task 6: The host Worker

**Files:**
- Create: `host/schema.sql`, `host/wrangler.template.jsonc`, `host/worker.mjs`, `host/lib/ids.mjs`, `host/lib/auth.mjs`, `host/lib/routes.mjs`, `host/lib/pages.mjs`
- Test: `.github/share-unit-checks.mjs` (Worker against fakes)

**Interfaces:**
- Produces:
  - `newId() -> string`, `isId(s) -> boolean` (the alphabet and length in Global Constraints).
  - `sha256hex(s: string) -> Promise<string>`, `same(a: string, b: string) -> boolean` (constant time), `ownerOf(req: Request, env) -> Promise<{ id: string, name: string } | null>` (bearer token, hashed, looked up in `owner_tokens` where `revoked_at IS NULL`).
  - `route(url: URL, base: string) -> { at: 'apex' | 'share' | 'api' | 'health' | 'none', shareId?: string, path: string }`. `base` is the host's own name (`localhost:8787`, `p.dananz.com`). Share origin forms: `<id>.<base>` (subdomain mode, `<id>.localhost:8787` locally) and `<base>/s/<id>/…` (path mode). Apex: `<base>/<id>`. Owner API: `<base>/api/…`. `/_health` anywhere.
  - `page(kind: 'removed' | 'notfound' | 'expired' | 'error', { lang: 'en' | 'he', title?: string }) -> Response`: one small template, en and he copy, dark by `prefers-color-scheme`, `noindex`.
  - `ogPage({ title, owner, target }) -> Response`: Open Graph title and `A prototype shared by <owner>`, `<meta http-equiv="refresh" content="0;url=…">` and `location.replace(target + location.hash)`.
  - `worker.mjs` endpoints (env: `KV`, `DB`, `BASE`, `PATH_MODE` `"1"|"0"`):
    - `POST /api/shares` (owner) → `{ id }`, inserting `ids(id,'share')`, retrying on collision.
    - `PUT /api/shares/:id` (owner), body = gzipped HTML, header `x-share-meta` = base64url JSON `{ title, session, projectLabel, scope, lang }`: writes KV `html:<id>:<version>` (version = old + 1, or 1), then upserts `shares`, then deletes the previous version's key. Over 20 MiB → 413.
    - `GET /api/shares` (owner) → `[{ id, title, version, bytes, updatedAt }]` not deleted, newest first.
    - `DELETE /api/shares/:id` (owner) → deletes KV keys, sets `deleted_at`.
    - Share origin `GET /` (path mode `/s/<id>/`; `/s/<id>` redirects to `/s/<id>/`): the stored bytes with `content-type: text/html; charset=utf-8`, `content-encoding: gzip`, `encodeBody: 'manual'`, `x-robots-tag: noindex`, `content-security-policy: frame-ancestors 'self'`, `x-frame-options: SAMEORIGIN`, `cache-control: private, max-age=31536000, immutable` when the request has `v=` equal to the version, else `private, no-cache`. Deleted → `page('removed')` 410; unknown → `page('notfound')` 404.
    - Share origin `GET api/state` with `X-Proto: 1` → `{ version, updatedAt, title }`; without the header → 400.
    - Apex `GET /<id>` → `ogPage` to the share origin.
    - Owner routes without a valid token → 401 JSON `{ error }`; no route sends CORS headers.

- [ ] **Step 1: Write the failing tests** with `makeEnv()` in the test file: KV as a `Map` (`get(key, 'arrayBuffer')`, `put`, `delete`), D1 over `node:sqlite` (`prepare(sql).bind(...).first()/all()/run()`, `batch()`), `schema.sql` applied; an owner row and a token. Tests: `ids shape` (1,000 ids, all valid, distinct), `owner api needs a token`, `publish and serve` (POST, PUT, GET `<id>.localhost:8787/` returns the same bytes with `content-encoding: gzip`), `path mode` (`/s/<id>` → 301 to `/s/<id>/`, then the bytes), `update bumps version and drops the old key`, `state needs X-Proto`, `apex og page keeps the hash` (body contains `location.hash`), `removed is 410`, `unknown is 404`, `too big is 413`, `no cors headers` on every response above.
- [ ] **Step 2: Run** `node --test .github/share-unit-checks.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the schema (the spec's, with `IF NOT EXISTS`), template, libs and Worker.
- [ ] **Step 4: Run.** Expected: PASS. Add `node --test .github/share-unit-checks.mjs` to `.github/workflows/smoke.yml` (it needs no install).
- [ ] **Step 5: Commit** `feat(share): host worker`.

### Task 7: Local host, the `proto share` commands and the docs

**Files:**
- Create: `scripts/share-host.mjs`, `scripts/share.mjs`, `references/share.md`
- Modify: `scripts/proto.mjs` (command table, help comment), `SKILL.md`, `.github/agent-checks.mjs`, `.github/share-link-checks.mjs` (part 3)

**Interfaces:**
- Consumes: Tasks 1, 4, 6.
- Produces:
  - `share-host.mjs`:
    - `ensureTools() -> Promise<{ wrangler: string, sharp: string | null }>`: installs `wrangler@4.149.0 sharp@0.35.5` into `~/.prototypes/share-tools` (pnpm when present, else npm) once, printing `Installing the share tools (once)…`.
    - `readHosts() -> Host[]`, `saveHost(host: Host)` on `~/.config/prototype/hosts.json`, `Host = { name: string, url: string, stage: 'local', base: string, pathMode: boolean, default: boolean }`.
    - `getToken(name) -> string | null`, `setToken(name, token)`: macOS Keychain (`security find-generic-password -s prototype-share-<name> -w`, `security add-generic-password -U -a prototype -s … -w <token>`); elsewhere `~/.config/prototype/token-<name>` with mode 600.
    - `startLocal() -> Promise<Host>`: writes `~/.prototypes/host/wrangler.jsonc` from the template (local KV and D1 ids, `BASE`, `PATH_MODE`), runs `wrangler d1 execute DB --local --persist-to ~/.prototypes/host/state --file host/schema.sql`, makes the owner row and a token the first time (owner name from `gh api user --jq .login`, else `--name`, else `ShareError('Pass --name: gh is not logged in')`), spawns `wrangler dev --ip 127.0.0.1 --port <p> --persist-to …` detached with a pid file and log in `~/.prototypes/host/`, waits up to 30 s for `/_health`. Port 8787 taken by something else → 8788 to 8799. Already running (pid alive and health answers) → returns it.
    - `stopLocal()`.
    - `client(host, token) -> { create(): Promise<string>, put(id, gz: Buffer, meta): Promise<{ version }>, list(): Promise<Row[]>, remove(id): Promise<void> }`, each failing with `ShareError` whose message names the host and the status.
    - `linkOf(host, id) -> string`: `http://<id>.localhost:<port>/` when `pathMode` is false, else `http://127.0.0.1:<port>/s/<id>/`. Setup decides `pathMode` by fetching `http://<random id>.localhost:<port>/_health` from Node; Safari is checked by hand (step 4).
  - `share.mjs`: `export async function main(args: string[], flags: object, ctx: { sessionDir: string, session: object, die: (m: string) => never })`:
    - `setup --local [--name <n>]`: `ensureTools`, `startLocal`, save host, print the base URL.
    - `stop`: `stopLocal`.
    - `<words…> | --all [--yes]`: host (start local if needed; none set up → `die('No share host yet: run proto share setup --local')`), `parseScope`, `buildShare`, print the review (blocks → exit 1 with fixes; warnings without `--yes` → exit 2 with `Run again with --yes to publish`), `create` + `put`, then write `.proto/shares.json` (`{ id, host, title, scope, version, publishedAt, sourceHash }`) and copy the shared `src/protos/<slug>/` into `.proto/shares/<id>/v<version>/`, print the link. Nothing is written locally if the upload fails.
    - `ls [--all]`: this session's entries joined with the host's list (`--all`: the host's list alone).
    - `rm <id>`: `remove`, drop the entry, keep the snapshot folder.
    - `file <words…> [--out <path>]`: `buildShare` with comments off, write the plain (not gzipped) html, default `<session>/.proto/shares/<slug>.html`.
  - `proto.mjs`: `share: () => import('./share.mjs').then(m => m.main(args, flags, { sessionDir: sessionDir(), session: need(sessionDir()), die }))`, and the help lines from the spec's CLI block that phase 0 implements.
  - `SKILL.md`: a short section "Only if asked: share a link": run `proto share <slug>/<n>…` only when the user asks; read the review warnings to the user before `--yes`; give them the printed link; phase 0 links open only on this Mac. Point to `references/share.md`.
  - `references/share.md`: setup, the commands, where things are stored (spec's tables), the limits, troubleshooting (port, tools, Safari and `*.localhost`).

- [ ] **Step 1: Write the failing tests.** In `agent-checks.mjs` (no installs): `share without a host` (fixture session, no hosts file via `HOME` override → exit code 1 and the setup hint), `share help lists share`. In `share-link-checks.mjs` part 3 (smoke): `setup --local` succeeds; `proto share share-link/2 share-link/3 --yes` prints a link; fetching it returns the html with `MARK-B`; `ls` lists it; the apex `/<id>` page redirects there; `rm` makes the link answer 410; `file` writes an html that renders; `host down` (stop the host, then share) restarts it and succeeds; `port taken` (occupy 8787 with a dummy server first) ends on 8788 and the link uses it; a failed upload (host stopped and `PROTO_SHARE_NO_START=1`) writes no `.proto/shares.json` entry.
- [ ] **Step 2: Run** `node --test .github/agent-checks.mjs` and the smoke. Expected: FAIL.
- [ ] **Step 3: Implement** both scripts, the `proto.mjs` wiring, the docs.
- [ ] **Step 4: Run** both. Expected: PASS. By hand: open the printed `<id>.localhost` link in Safari; if it doesn't resolve, note it in `references/share.md` and confirm `pathMode` links work. Record the result in the PR.
- [ ] **Step 5: Commit** `feat(share): proto share on a local host`.

---

## Out of scope for phase 0 (later phases, per the spec)

The Share link sheet in the page, viewer comments and the tray (phase 1); workers.dev and
`p.dananz.com`, passwords, person links, update and changed-since, budget counters, notifications
(phase 2); `prto.fyi` and per-share subdomains in production (phase 3); extras (phase 4).
