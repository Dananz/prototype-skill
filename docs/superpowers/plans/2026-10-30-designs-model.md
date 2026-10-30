# Designs in the Model: Implementation Plan (Phase 2 of Designs and the Map)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pick can become a Design (a set of linked screens with one look), new screens arrive as Explorations under it, `<Go to>` links walk between screens in the page, and the project tree is shown in the #1 tree sidebar behind a switch.

**Architecture:** A Design is a file, `src/designs/<id>/design.ts` (plain JSON after `export default`, like `meta.ts`), listing its flows and, in each, the slugs of the prototypes that are its screens. A screen is an ordinary prototype (an Exploration); what the screen shows is its pick, else its first variant as a stand-in. The CLI (`proto design`, `proto add --design`) writes these files; the page reads them through the registry's glob, so they hot reload. The tree sidebar is a React root in its own host inside `[data-side]`, fed by a pure model (`treeOf`), shown instead of today's sidebar when the `proto-tree` switch is on.

**Tech Stack:** Node ESM scripts (`scripts/proto.mjs`), Vite 8 + Tailwind 4, React 19 for shell islands, Phosphor icons, `node --test` checks and the Chrome smoke harness in `.github/`.

**Spec:** `docs/superpowers/specs/2026-10-30-designs-and-map-design.md` (decisions 2 to 9, Phase 2). Visual source for the tree: the prototype `day/tree.tsx` and `day/views.tsx` in `~/.claude/skills/prototype/.prototypes/a8993d68-864b-46e6-bc2f-c060e64117a7/src/protos/` (live at `/bar/D`, the user's pick).

## Global Constraints

- Base: branch `feat/map-shell` from `feat/project-tree` (Phase 1, unmerged). Worktree `~/.claude/skills/prototype/.worktrees/map-shell`. The PR is stacked on Phase 1's.
- Commits add exact paths, never `git add -A` or a directory (Tomer's unstaged `app/shell/shell.css` hunk and Finder ` 2.*` duplicates are not ours).
- Prose, comments and UI copy: no em dashes, no emojis; comment density of the code around.
- Every new UI string goes through `t()` with its Hebrew in `app/shell/i18n/he/*`; `node scripts/i18n-check.mjs` passes. Hebrew names: Design = "עיצוב", Exploration = "סבב", Screen = "מסך", Flow = "זרימה", stand-in = "ממלא מקום", not picked = "לא נבחר".
- Icons are Phosphor (`@phosphor-icons/react`), never hand-drawn SVG.
- Shell focus: no `focus-visible:outline-*`/`ring-*` on new shell controls (AGENTS.md, `--proto-focus`).
- The old sidebar, columns and lobbies stay the default and unchanged. The tree shows only with the switch on (D9). Phase 3 removes the switch with the old navigation.
- Routes stay `/<slug>/<letter>[/~tool][/<state>]`.
- Quick CI must pass (`.superpowers/sdd/2026-10-30-project-tree/quick.sh` with the new test files added), and full smoke must not gain failures beyond the known flake (`share viewer: prototype list`, passes alone with `--share-link-only`).

## Decisions this plan makes (the executor does not reopen them)

| # | Decision |
|---|---|
| D1 | A Design is `src/designs/<id>/design.ts`: `export default { title, created, session, owner, from: "<slug>/<letter>", flows: [{ name, screens: ["<slug>", …] }] }`. `id` follows the slug rule (`^[a-z0-9][a-z0-9-]*$`). Written with `writeWhole` like `meta.ts`. The folder also holds the design's shared parts (`parts.tsx`), written by the agent, not the CLI. |
| D2 | A screen is a prototype whose slug is in some design's flows. A prototype is in at most one design. The screen shows `picked`, else its first variant (by the registry's order) with `standIn: true`. |
| D3 | `proto design <slug>/<letter> [--title "…"] [--id <id>]` makes a design: picks that variant (same code path as `proto pick`), writes the design with `from` = that route and one flow `Main` = `[slug]`. `--id` defaults to the slug of the title (or `<slug>` when no title), with `-2`, `-3` on a taken id. Prints the id and the design's folder. |
| D4 | `proto add <slug> --design <id> [--flow "<name>"]` adds the new prototype as a screen: appended to that flow (default: the first flow; a named flow that doesn't exist is created at the end). It refuses a slug that is already a screen of another design. `--design` with `--next` is refused (a redo of a screen is `--from <screen>/<letter> --next`, which hangs under the screen without joining a flow). |
| D5 | `proto design <id>` prints the design: per flow, each screen as `slug  #n picked` or `slug  #1 stands in (not picked)`, then its links (`→ about, pricing`), then `links to screens not built: …` and `links into another design (never followed): …`, and `in no flow: …` for prototypes stamped `design` but missing from flows (none expected). A screen whose prototype is gone or archived prints `slug  (gone)` and is skipped. |
| D6 | Flow edits on an existing design: `proto design <id> --flow "<name>" --screens a,b` moves those screens to the end of that flow (creating it); `--rename "<old>:<new>"`; `--drop <slug>` takes a screen out (the prototype stays as an Exploration). An empty flow is removed. |
| D7 | Links in code: `<Go to="about">…</Go>` from `src/go.ts` (React stack; copied from `app/adapters/go.react.ts` by scaffold and update, as `slot.ts` is). It renders an `<a href="#" data-proto-go={to}>` with the props passed through; a click calls `preventDefault()` and dispatches `new CustomEvent('proto:go', { detail: { to } })` on `window.top`. The Vue stack gets the same as a plain `data-proto-go` anchor in Phase 5; SKILL.md says React only for now. |
| D8 | The shell resolves `proto:go` against the design of the prototype on screen: a screen of the same design opens at its shown variant (`/<to>/<letter>`); a slug in another design or no screen shows the toast `t('{name} is not a screen of this design')`; a slug that doesn't exist shows `t('{name} is not built yet')`. With no design on screen, `to` opens that prototype if it exists. |
| D9 | The switch: `localStorage['proto-tree'] === '1'`, set by Settings › Browsing "Project tree (preview)" and by `?tree=1` / `?tree=0` in the URL. On: `[data-side]` shows the tree host `[data-tree]` and hides today's nav; off: the reverse. ⌘\ hides either. |
| D10 | Exploration states (`stateOf`), first match wins: `building` (any variant in `session.building`), `stale` (`from.variant` set and the parent's `picked` is another letter), `waits` (`from.variant` set and the parent has no pick), `done` (`picked`), `open`. `open` and `stale` count as waiting on the user. |
| D11 | Tree placement: a prototype with `from` nests under its parent (row label `· on #n`, n = `numberOf(from.variant)`); a root prototype that is a screen is that screen's row; other roots go under "Explorations on no screen" (newest first), then "Archive · n" (collapsed). A `from` that points at a missing prototype or loops makes the prototype a root. |
| D12 | Filters: All; Open · n (keeps a node when anything in its subtree is `open`, `stale` or `building`; n = count of `open` + `stale`); This conversation (keeps prototypes whose `session` equals `status.conversation`). |
| D13 | Meta and Proto gain `session?: string`, `owner?: string`, `next?: boolean`. Registry gains `designs: Design[]` from `import.meta.glob('./designs/*/design.ts', { eager: true, import: 'default' })`; `createShell` takes `designs` and the returned API gains `setDesigns(designs)` (HMR). A share build passes `[]` (Phase 5 shares designs). |
| D14 | Shared parts (spec decision 8) are agent behavior, in SKILL.md: a design's chrome lives in `src/designs/<id>/parts.tsx`; when a pick or an ask changes something there, the agent asks "every screen or only this one?" (AskUserQuestion, or a page reply) before writing it, and makes a screen-local copy for "only this one". |

## Review Focus

1. **A screen's prototype archived or deleted while it is still in a flow.** `proto design <id>` prints it as gone and the tree leaves it out, without throwing. Test in Task 2 (`status skips a gone screen`) and Task 4 (`a flow with a missing slug`).
2. **`<Go>` clicked inside the device view's iframe** (a phone or tablet size). It navigates the top page the same way. Test in Task 3 (`go from the phone frame`).
3. **A `from` chain that loops or names a missing parent** (hand-edited meta, or an import rename). The tree model terminates and shows it as a root. Test in Task 4.
4. **Switch off: nothing of today's sidebar changes.** The keyboard, columns, favorites and split checks stay green. Covered by the full smoke run in Task 5.
5. **A new screen added in another conversation while the page is open.** The design file changes on disk and the tree shows the screen without a reload. Test in Task 5 (`tree updates on design.ts change`).

---

## File Structure

| File | Responsibility |
|---|---|
| `app/links.mjs` (create) | `linksIn(text)`: the `<Go to>` targets in a variant's source |
| `scripts/design.mjs` (create) | `proto design` (make, status, flow edits) and the `--design` part of `add`; reads and writes `design.ts` |
| `scripts/proto.mjs` (modify) | `design` command, `add --design/--flow`, help lines, scaffold/update copy `go.ts` |
| `app/adapters/go.react.ts` (create) | The `Go` component |
| `app/src/registry-core.ts`, `app/src/registry.ts`, `app/src/main.ts` (modify) | `Design` type, `designsOf`, designs glob and HMR into the shell |
| `app/shell/shell.ts` (modify) | `Proto`/`Design` types, `designs` state, `proto:go` handler, tree host and switch |
| `app/shell/tree/model.ts` (create) | `stateOf`, `treeOf`: pure, no DOM |
| `app/shell/tree/index.tsx` (create) | `mountTree(host, api)`: the sidebar (head, working strip, filters, rows, footer) |
| `app/shell/tree/row.tsx` (create) | `Row` and `Mark` |
| `app/shell/settings.ts` (modify) | The "Project tree (preview)" toggle |
| `app/shell/i18n/he/tree.ts` (create), `app/shell/i18n/he/index.ts` (modify) | Hebrew strings |
| `.github/designs-unit-checks.mjs`, `.github/design-checks.mjs`, `.github/tree-unit-checks.mjs` (create) | `node --test` checks |
| `.github/go-checks.mjs`, `.github/tree-checks.mjs` (create), `.github/smoke.mjs` (modify) | Browser checks, with `--go-only` and `--tree-only` |
| `.github/workflows/smoke.yml` (modify) | Run the new `node --test` files |
| `SKILL.md`, `references/designs.md` (create) | Designs for the agent |

---

### Task 1: Designs and owners reach the shell

**Files:**
- Modify: `app/src/registry-core.ts`, `app/src/registry.ts`, `app/src/main.ts`, `app/shell/shell.ts:49-107` (types) and its returned API
- Test: `.github/designs-unit-checks.mjs`

**Interfaces:**
- Produces: `type Design = { id: string; title: string; created: string; session?: string; owner?: string; from?: { proto: string; variant: string }; flows: { name: string; screens: string[] }[] }` exported from `app/shell/shell.ts`; `designsOf(metas: Record<string, DesignMeta>): Design[]` in `registry-core.ts` (id from the path's folder, sorted by `created`, flows filtered to `{name: string, screens: string[]}` with string slugs only); `Proto` gains `session?`, `owner?`, `next?`; `createShell(root, { mount, protos, session, designs })`; API `setDesigns(designs: Design[])`.

- [ ] **Step 1: Write the failing test** `.github/designs-unit-checks.mjs` (load `registry-core.ts` with `stripTypeScriptTypes`, as `comment-images-unit-checks.mjs` does):
  - `designsOf({ './designs/acme/design.ts': { title: 'Acme', created: '2026-10-30T10:00:00Z', from: 'home/C', flows: [{ name: 'Main', screens: ['home', 'about', 7] }] } })` deep-equals `[{ id: 'acme', title: 'Acme', created: '2026-10-30T10:00:00Z', from: { proto: 'home', variant: 'C' }, flows: [{ name: 'Main', screens: ['home', 'about'] }] }]`.
  - A design without `flows` gets `flows: []`; two designs come back ordered by `created`.
  - `protosOf` on a meta with `session: 'one', owner: 'two', next: true` returns a proto with those three fields.
- [ ] **Step 2: Run it.** `node .github/designs-unit-checks.mjs` → fails (`designsOf` is not exported).
- [ ] **Step 3: Implement** `designsOf` and the `Meta` fields in `registry-core.ts`; the eager glob in `registry.ts` exporting `designs`; `main.ts` passes them and calls `setDesigns` on HMR the way it does for protos; the shell keeps `st.designs`.
- [ ] **Step 4: Run** the unit check → passes; `quick.sh` → all pass.
- [ ] **Step 5: Commit** `feat: designs and prototype owners reach the page`.

### Task 2: `proto design` and screens

**Files:**
- Create: `app/links.mjs`, `scripts/design.mjs`
- Modify: `scripts/proto.mjs` (commands table, `add`, help header)
- Test: `.github/design-checks.mjs` (`node --test`, using `projectFixture` from `project-checks.mjs`)

**Interfaces:**
- Consumes: `projectFixture`, `pick()`'s marking path in `proto.mjs` (extract it to `markPick(dir, slug, letter)` if `pick()` can't be called directly).
- Produces: `linksIn(text: string): string[]` (unique, in order, from `/<Go\b[^>]*?\bto=["']([a-z0-9][a-z0-9-]*)["']/g`); `readDesign(dir, id)`, `writeDesign(dir, id, design)`, `designOf(dir, slug): string | null` in `scripts/design.mjs`.

- [ ] **Step 1: Write the failing tests** in `.github/design-checks.mjs`:
  - `design makes a design from a variant`: `add home --variants A:One,B:Two,C:Three`, then `design home/C --title "Acme"` → `src/designs/acme/design.ts` has `from: 'home/C'`, `flows: [{ name: 'Main', screens: ['home'] }]`, `session` set; `home`'s meta has `picked: 'C'`.
  - `a taken id gets -2`: a second `design home/B --title Acme` writes `acme-2`.
  - `add --design appends a screen`: `add about --design acme --variants A:One` → Main is `['home', 'about']`; `--flow "Sign up"` on `signup` creates a second flow.
  - `a screen of one design can't join another`: `add about --design acme-2` exits non-zero with `already a screen of acme`.
  - `--design with --next is refused`.
  - `status lists picks, stand-ins and links`: write `home/C.tsx` containing `<Go to="about">` and `<Go to="pricing">`; `design acme` prints `home  #3 picked`, `→ about, pricing`, `about  #1 stands in (not picked)`, `links to screens not built: pricing`.
  - `status skips a gone screen`: `archive about` (or delete its folder), `design acme` prints `about  (gone)` and exits 0.
  - `flow edits`: `--flow "Checkout" --screens about` moves it; `--rename "Checkout:Pay"`; `--drop about` leaves no empty flow.
  - `linksIn` unit cases: `<Go to="a" className="x">`, `<Go className="x" to='b'>`, duplicates collapse, `<Goal to="x">` does not match.
- [ ] **Step 2: Run** `node --test .github/design-checks.mjs` → fails (`design` is not a command).
- [ ] **Step 3: Implement** per D3 to D6 in `scripts/design.mjs`, wired into `proto.mjs`'s commands and `add`; help lines under `proto add` (`[--design <id>] [--flow "<name>"]`) and a `proto design` block.
- [ ] **Step 4: Run** the checks → pass; `quick.sh .github/design-checks` → pass.
- [ ] **Step 5: Commit** `feat: proto design makes a design from a pick; screens join it with add --design`.

### Task 3: `<Go to>` walks the design in the page

**Files:**
- Create: `app/adapters/go.react.ts`, `.github/go-checks.mjs`
- Modify: `scripts/proto.mjs` (scaffold and update copy `go.ts` for React, beside `slot.ts`), `app/shell/shell.ts` (listener), `app/shell/i18n/he/*`, `.github/smoke.mjs` (`--go-only`, and in the full run)

**Interfaces:**
- Consumes: `Design` and `st.designs` (Task 1); `proto design`, `add --design` (Task 2).
- Produces: `Go({ to, children, ...props })`; the shell's `proto:go` handler per D8.

- [ ] **Step 1: Write the failing browser check** `goChecks({ proto, app, local, openPage, fail })`: make `acme` with screens `home` (picked C) and `about` (A, B); `home/C.tsx` renders `<Go to="about" data-shoot="to-about">About</Go>`, `<Go to="nowhere" data-shoot="to-none">x</Go>`; a second design `other` with screen `elsewhere`, linked from `home/C` as `data-shoot="to-other"`. Assertions:
  - on `/home/C`, clicking `to-about` lands on `/about/A` (stand-in);
  - after `proto pick about B`, the same click lands on `/about/B`;
  - `to-none` keeps the route and shows a toast containing `nowhere is not built yet`;
  - `to-other` keeps the route and shows `elsewhere is not a screen of this design`;
  - **go from the phone frame:** with the device view at `size:phone`, clicking `to-about` inside the iframe lands on `/about/B`.
- [ ] **Step 2: Run** `node .github/smoke.mjs --go-only` → fails (no `src/go.ts`).
- [ ] **Step 3: Implement** the adapter (D7), its copy in scaffold and update, and the shell handler (D8) on `window` with `go()`. The message shows in the shell's existing short-message surface if it has one; otherwise a `[data-go-note]` line (role `status`) over the stage's foot that clears after 4s. The check reads it by that selector.
- [ ] **Step 4: Run** `--go-only` → `OK: focused Go checks`; `node scripts/i18n-check.mjs` → passes.
- [ ] **Step 5: Commit** `feat: Go links walk a design's screens in the page`.

### Task 4: The tree model

**Files:**
- Create: `app/shell/tree/model.ts`, `.github/tree-unit-checks.mjs`

**Interfaces:**
- Consumes: `Proto`, `Design` (Task 1); `numberOf` (the shell's copy in `app/shell/variants.ts`).
- Produces:
  - `type ExpState = 'open' | 'waits' | 'stale' | 'done' | 'building'`
  - `stateOf(p: Proto, byId: Map<string, Proto>, building: Set<string>): ExpState` per D10 (`building` holds `slug/letter` keys)
  - `type TreeNode = { kind: 'design' | 'flow' | 'screen' | 'exploration' | 'option' | 'section'; key: string; label: string; route?: string; state?: ExpState; on?: number; standIn?: boolean; picked?: boolean; became?: string; count?: number; children: TreeNode[] }` (`on`: the parent option's number for a nested exploration; `became`: on an option, the title of the design made from it (spec decision 3); `section` for "Explorations on no screen" and "Archive")
  - `treeOf(protos: Proto[], designs: Design[], o: { filter: 'all' | 'open' | 'mine'; me: string | null; building: Set<string> }): { nodes: TreeNode[]; waiting: number }` per D11 and D12. A screen's `route` is its shown variant; an option's is `slug/letter`; an exploration's is its pick, else its first variant.

- [ ] **Step 1: Write the failing tests** (`node --test`, loading `model.ts` with `stripTypeScriptTypes`) with a fixture of designs `acme` (Main: home, about; Sign up: signup) and prototypes `home` (picked C), `about` (no pick), `signup`, `hero-cta` (from `home/C`), `cta-copy` (from `hero-cta/B`, `hero-cta` picked A, so stale), `logo` (no from, not a screen), `old` (archived):
  - `stateOf`: home `done`, about `open`, cta-copy `stale`, a child of an unpicked parent `waits`, a variant in `building` makes `building`.
  - `treeOf` all: `design acme › flow Main › screen home › [option #1 #2 #3 (#3 picked, `became: 'Acme'`), exploration hero-cta (on 3) › exploration cta-copy (on 2)]`; `screen about` has `standIn: true` and route `about/A`; section "Explorations on no screen" holds `logo`; "Archive" holds `old` with `count: 1`.
  - `filter: 'open'` keeps `about`, the `hero-cta › cta-copy` thread under home, drops `signup` if done; `waiting` equals 2.
  - `filter: 'mine'` with `me: 'one'` keeps only prototypes whose `session` is `one`, and the designs that hold them.
  - **a flow with a missing slug:** a flow listing `ghost` yields no node for it and no error.
  - **loops and missing parents:** `a` from `b/A`, `b` from `a/A`; `c` from `missing/A`. `treeOf` returns, with `a`, `b` and `c` as roots.
- [ ] **Step 2: Run** `node --test .github/tree-unit-checks.mjs` → fails (module missing).
- [ ] **Step 3: Implement** `model.ts`.
- [ ] **Step 4: Run** → pass.
- [ ] **Step 5: Commit** `feat: the project tree's model: designs, flows, screens and explorations with their states`.

### Task 5: The tree sidebar behind the switch

**Files:**
- Create: `app/shell/tree/index.tsx`, `app/shell/tree/row.tsx`, `app/shell/i18n/he/tree.ts`, `.github/tree-checks.mjs`
- Modify: `app/shell/shell.ts` (skeleton host `[data-tree]` inside `[data-side]`, outside any `innerHTML` rewrite; switch; mount), `app/shell/settings.ts`, `app/shell/i18n/he/index.ts`, `.github/smoke.mjs` (`--tree-only`, and in the full run)

**Interfaces:**
- Consumes: `treeOf`, `stateOf` (Task 4); `st.designs` (Task 1); the shell's `go`, current place, `session.work` text, `st.status` (`conversation`, `lastEdit`, `building`), `comments.counts()`.
- Produces: `mountTree(host: HTMLElement, api: { get(): TreeInput; subscribe(fn: () => void): () => void; go(route: string): void; hide(): void }): void`, where `TreeInput = { protos: Proto[]; designs: Design[]; place: string; me: string | null; building: Set<string>; work: string; live: string; counts: Record<string, { n: number; tone: 'reply' | 'working' | 'plain' }> }`.

Look and behavior follow the prototype's `TreeSide`/`TreeBody`/`Row`/`Mark` (paths in the header): 300px card; head with the project mark, name and hide button; the working strip in one line; the filter segment (D12); rows `h-8`, indent `2 + depth * 8`, caret, icon, label, end mark; a stale exploration opened shows "built on #x, and you picked #y"; an option a design was made from says "became {title}"; the current place's row is lit and scrolled into view, its ancestors opened; footer with the live dot and "edited N min ago". Picking options inline and the island's modes are Phase 3.

- [ ] **Step 1: Write the failing browser check** `treeChecks(…)`: fixture as in Task 4 built with the CLI. Assertions:
  - with `?tree=0` the old `[data-side]` nav is visible and `[data-tree]` is hidden;
  - `?tree=1` shows `[data-tree]`, hides the old nav, and `localStorage['proto-tree'] === '1'` survives a reload;
  - rows: `[data-tree-row="design:acme"]`, `[data-tree-row="screen:home"]` with a done mark, `[data-tree-row="screen:about"]` with the not-picked tag, `[data-tree-row="exp:cta-copy"]` with the stale mark;
  - clicking `screen:about` goes to `/about/A`; arriving at `/hero-cta/B` lights `exp:hero-cta` and opens its ancestors;
  - the Open filter's label reads `Open · 2`, and This conversation leaves only the fixture session's rows;
  - **tree updates on design.ts change:** `proto add pricing --design acme` while the page is open adds `screen:pricing` within 5s, without a reload (`performance.navigation`-free: a `window.__mark` set before survives).
  - Settings › Browsing has the toggle, and it flips the switch.
- [ ] **Step 2: Run** `node .github/smoke.mjs --tree-only` → fails.
- [ ] **Step 3: Implement** the sidebar, the host and switch (D9), the Settings toggle, and the Hebrew strings.
- [ ] **Step 4: Run** `--tree-only` → `OK`; `node scripts/i18n-check.mjs`; then the full smoke → no new failures (Review Focus 4).
- [ ] **Step 5: Visual check.** `proto shoot` is for designs, so capture the shell with the smoke harness's screenshot (desktop 1440×900 light and dark, Hebrew and English) into `docs/pr/designs-model/`, and compare by eye with `/bar/D`'s sidebar (`proto shoot bar/D` in session a8993d68). Fix spacing, type and marks until they match.
- [ ] **Step 6: Commit** `feat: the project tree sidebar, behind the Project tree switch` (code and `docs/pr/designs-model/*.png` by exact path).

### Task 6: Designs for the agent

**Files:**
- Create: `references/designs.md`
- Modify: `SKILL.md`, `.github/workflows/smoke.yml`, `.superpowers/sdd/2026-10-30-project-tree/quick.sh` copy for this plan

**Interfaces:**
- Consumes: every command and file from Tasks 2 and 3.

- [ ] **Step 1: Write the failing check.** Add to `.github/design-checks.mjs`: `SKILL.md mentions proto design and references/designs.md`; `references/designs.md` contains `proto design`, `--design`, `<Go to=`, `src/designs/<id>/parts.tsx` and `every screen or only this one`.
- [ ] **Step 2: Run** → fails.
- [ ] **Step 3: Write** `references/designs.md`: when to make a design (the user says "make this the design", "grow this into a site", a comment on a variant asks for more pages), the commands, Go links, flows (group screens by link chains; name them; move them on request), the stand-in rule, shared parts and the question of D14, several designs and that links never cross. A short "Designs" section in `SKILL.md` points to it. Add the three new `node --test` files to `smoke.yml`.
- [ ] **Step 4: Run** → pass; `quick.sh` with the new files → all pass.
- [ ] **Step 5: Commit** `docs: designs, screens and Go links for the agent`.

## After the tasks

Final whole-branch review (fresh reviewer, most capable model), then a draft PR on `feat/project-tree` with `.github/PULL_REQUEST_TEMPLATE.md` and the Task 5 screenshots published per AGENTS.md (After only: `N/A: new screen/state` in Before, since the switch is off by default).
