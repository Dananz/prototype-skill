---
name: prototype
description: Build several live, clickable UI variants in one app for review. Use for UI prototyping, screen or interaction alternatives, and follow-up exploration. Not for a single straightforward UI edit or comparing libraries.
allowed-tools:
  - Bash(node "${CLAUDE_SKILL_DIR}/scripts/proto.mjs" *)
---

# Prototype

Each agent conversation gets **one live prototype app**. The user gets its link once, at
the start, and watches every prototype appear and fill in as you write the files: the page
updates through hot module replacement, never a reload. Everything the user asks for in the
session lives in that one app: **session › prototype › variant**.

The app already has its navigation (a switcher in the bar that opens the session as columns,
a sidebar with one line per level and the current level as two columns, a stepper through the
variants (on a phone, one solid bar at the foot: the comments island over a pill you drag along,
with a menu for the page's tools, and the columns as a sheet you drill into), a comments island
floating over the stage, edge arrows, a focus mode with a dock, light and dark, phone frames, "editing" dots, a
strip naming the variant your requests change). You only write variant files.

A variant's context menu (right-click its row or open its ⋯) offers Share screenshots for
that variant or all variants. Share is also in the pill menu on a phone. Edit each caption,
select individual shots, and choose No name, With name or Canvas, at As shown, Phone, Tablet or Desktop sizes. The board previews the actual PNGs
and downloads them one by one with progress and Stop. On supported phones, Share files opens
the system share sheet. Captions affect exports only.

Settings (the bar's ⋯ menu, or the session name at the top of the sidebar) opens browser
preferences: System, Light or Dark appearance, instant comment sending (off by default, so
drafts can be sent together), where the comments island rests and which news grows it, Grid or
List overviews, and whether the sidebar and review panel stay open on wide screens. It also resets sidebar/column widths and lists keyboard shortcuts.
Its Session category is the session's one home: its folder and start time, the public URL to
copy, whether it is live and when it was last edited, when it stops when idle and when it is
deleted, keeping it forever, stopping its server, and a listener restart message to paste in
the agent thread. The sidebar's mark carries the live dot (the bar's ⋯ does while the sidebar
is hidden). On a phone, Settings is a swipeable bottom drawer.
Preferences save automatically;
use the page's layout, zoom and motion controls for the design currently on screen.

The bar's layout button, before Comment, opens the three sizes, phone, tablet and desktop, with
their dimensions, and the zoom under them (on a phone, the Layout row of the pill's menu). On a wide screen the page is a dotted desk (the sidebar, the bar and the side panel float on it as cards) and a web variant sits on it as an artboard as big as the stage, less a margin of the desk, laid out for
the stage's width (its breakpoints see the stage, not the window; in a desktop window it is never
laid out narrower than 1024, so side panels scale the desktop layout down rather than turning it into
the tablet one); the stage's own layout is selected. Choosing another shows the page at that size, zoomed to fit (a 1440 × 900 desktop on a
phone, a phone on a desktop); the zoom there goes either from 10% to 400%, and the user can
pinch, Space-drag or middle-button drag (from anywhere, at any zoom; the page stays where it is
left, and Fit, the frame button at the end of the layout button, or Mod+0 (Cmd+0 on Mac, Ctrl+0 elsewhere) resets the zoom and centres it again), comment, try things, pick copy and scrub motion there. Nothing to build for it
beyond a web variant that lays out well at each width.

Comments live in the **comments island**, a small bar floating over the stage and collapsed most of
the time: Select (or C) to pick an element, a box for a comment on the whole variant, Send when
drafts wait, and the count, which opens the list above the same bar. When the agent takes a
comment, finishes it or replies, the island grows for a moment to say so and its edge takes the
news's colour (amber working, green done, blue reply). On a wide stage it always rests on an
edge: flat on the foot or the top, or, dragged to a side, upright and flush with it as a small tab
(the count as a badge) that widens into a rail under the pointer and opens as the full-height
comments panel. On a
phone it and the pill are one bar at the screen's foot, in the page's light or dark, which folds to
the comment bar while the design scrolls down; its count opens the list in the bar, the composer
opens as a drawer (a swipe down puts it away), the pill's end is Tweaks, else the layouts, else the
star, and two fingers zoom the design only (Fit resets it).

Compare uses the same island, numbered pins, screenshots, drafts, sending and agent
replies as a single variant. Click Select (or press C), then choose something in either pane.
While writing on one variant, click an element or existing comment in the other pane to reference
it. The variants do not need matching elements. Type `@` in the composer to find a variant by
letter or name, then select it with a click or the arrow keys and Enter/Tab. “Pick an element
instead” keeps precise visual tagging available. References retain the source variant and route
in the agent inbox. Keep this flow in the shell; generated designs do not need their own comment
store, sidebar or agent-reply simulation.

## Agent setup (Claude Code, Codex and other harnesses)

Resolve **the directory containing this loaded `SKILL.md`** to an absolute path before
running anything. `proto` below is shorthand for `node "<skill-dir>/scripts/proto.mjs"`,
not an installed command. Replace `<skill-dir>` with that actual path in commands and worker
prompts. References such as `references/craft.md` are relative to this skill directory,
not the product's working directory. Claude Code may substitute `${CLAUDE_SKILL_DIR}`;
other agents must use the path supplied by their skill loader. Do not assume that token is
an environment variable, or that the skill lives under `~/.claude`.

Keep the **project root and session ID** for the whole conversation, including after
compaction. Run from the product's folder, or pass `--project "<project-root>"` on every call.
The CLI resolves identity in this order: `--session`, `PROTO_SESSION_ID`, `CODEX_THREAD_ID`,
`CLAUDE_CODE_SESSION_ID`, `CLAUDE_SESSION_ID`. If the harness supplies a conversation ID,
use it. If none is available, generate a unique ID once (`node -e
"console.log(require('node:crypto').randomUUID())"`) and pass `--session "<id>"` on every call.
Never generate a new ID per command or use one shared default for different conversations.
To resume an earlier app, use its original project and ID (`proto ls` lists sessions).

For example (replace all placeholders with actual values):

```sh
node "<skill-dir>/scripts/proto.mjs" up --project "<project-root>" --session "<id>" --name "Checkout alternatives"
node "<skill-dir>/scripts/proto.mjs" add checkout --variants "A:Current,B:Compact" --project "<project-root>" --session "<id>"
```

Use the harness's shell, file-editing, image-viewing and browser tools. The `allowed-tools`
frontmatter is Claude Code permission metadata, not a list of tools other agents must have.
Use subagents only when available and allowed; otherwise build sequentially and perform the
critic pass yourself. Never invent tool names, unavailable model IDs or background wakeups.
For image generation, use the available tool's supported execution and file-export mechanism;
background work is optional. Save its outputs in the app's `src/assets/` before final QA.
If the harness cannot inspect images, report that visual QA is blocked rather than claiming
that screenshots match. Connect the session's comment listener immediately after `proto up`,
before building or ending the first turn. Follow the startup step below for every provider.

## 1. Start the session app, then send the link

Before reading the codebase or designing anything:

```
proto up --name "<short session title, e.g. Refuel redesign>" --lang <en|he>
```

**`--lang` is the language you and the user are talking in**, not the product's: a conversation
in Hebrew gets `--lang he`, and the whole page around the designs (sidebar, menus, comments,
settings, placeholders) reads Hebrew, right to left. Pass it on every `proto up`; if the user
switches language mid-session, the next `proto up` with the new one switches the open page too.
Name the session in that language. The designs are separate: they follow the product (see Right
to left below). The user can override the page's language in Settings.

It creates the app on the first call in a session, restarts it if it stopped, and prints
`url …`. Send that URL to the user right away in one short message ("Live link: … it fills
in as I build"). Then continue. On later requests in the same session run `proto up` again
(same app, same link) and don't resend the link unless the user lost it.

**Connect comments now, including in Codex.** `proto up` prints the listener's status.
**Read `references/listener.md` now**, before building or ending this turn. The listener
setup lives in that short file so a truncated read of this skill cannot hide it.
If startup says `not listening`, complete that setup in this same turn.
In T3 Code, both Codex and Claude use the same `schedule_task` webhook, bound to this
conversation. Discover the host tools before deciding wakeups are unavailable; a short
initial tool list is not proof that T3's scheduler is missing. Use the host's documented
tool discovery or MCP transport when necessary.

Run `proto inbox --status` after registration. It checks the listener without taking
comments. Reuse an existing subscription and preserve its task ID and owning thread across
compaction. Do not finish with a promise to listen, an unconnected `--wait`, or a recurring
polling task. If the host has no supported wakeup mechanism or registration fails, state
the specific blocker and read `proto inbox` at the start and end of active turns.

**Codex shell sessions are not a listener connection.** A process/session ID returned by
`exec_command` or `write_stdin` only means the command is running. It does not establish
delivery into an idle conversation. Use the T3 webhook when available. Use `--wait` only
when the host explicitly supports completion wakeups into this same conversation, then
rearm it on every completion as described under Comments.

What `proto up` does: the app lives in `<project>/.prototypes/<session>/` (git-ignored, the
project's own files are untouched), its stack follows the project (React for React, Next or
Expo projects, Vue for Vue or Nuxt, React for anything else), it runs a Vite dev server and
publishes it on the tailnet with `tailscale serve` when available, so that link opens on
the user's phone too. Without Tailscale, use the printed local URL.

## 1b. A new thing from scratch: ask first

When the request builds something that doesn't exist yet and says little about it ("a website for my
mom, she's a dentist", "an app for tracking my runs"), or you lack the context that would change
what you design, ask before you plan. The answers are the difference between five directions near
the mark and five guesses.

Ask when there is **no Current, no kit and no brand source**, and the request leaves open who it is
for, what its main job is, how it should feel, or what assets exist. Don't ask when the request
already says those (a long brief, a repo or site to follow), when the user said to just build, or on
a follow-up in a session that already has answers. A redesign of something that ships is answered by
its screenshots (step 2), not by questions.

```
proto intake set <questions.json>      # then connect the session's single comment listener and stop
```

The page shows the questions as a screen of their own over the whole app, on one page, with a small
demonstration on each visual choice, and the answers come back as an `intake` batch in `proto inbox`.
**Don't build, plan or write a variant before they arrive.** Say in one line that the questions are in
the page. Read `references/intake.md` first: what to ask (three to six questions, each one a decision
you would otherwise guess), how to write the demonstrations, and how to use the answers.

When the batch arrives: its printed answers are the brief's facts (a question the user left to you
is yours to decide, and you say what you picked). Files they dropped are saved next to the batch:
copy logos and photos into the app's `src/assets/`, and treat them as real assets (step 2.2). Reply
`proto reply <batch>/1 "…" --done` with what you will build from, then go on to step 3.

## 2. Ground it in the real product: Current first

When the request changes something that already exists (a screen, a tab, a component), variant
**A is "Current"**: a rebuild of what ships today, close enough that the user can't tell it from
a screenshot of the real app at a glance. Every other variant starts as a copy of Current and
changes only what its direction is about. Variants drawn on an invented look get rejected
however good the idea is, so this step comes before any idea.

**First, the project's design kit.** Run `proto kit` (`proto up` also prints a line per kit). A
kit is what an earlier session already built and matched for this project: `src/theme.css`,
the chrome in `parts`, the extra packages, the phone screen, and Currents already matched to
their screenshots, with `design-system.md` on what they are and what took rounds to get right.
When there is one, read its `design-system.md`, then add the prototype on it:

```
proto add <slug> --title "…" --variants "A:Current,B:…" --kit [--current <screen>]
```

`--current <screen>` puts a saved Current in as A, with its references in `.proto/ref/<slug>/`;
without it, write A on the kit's parts. Then what `proto add` prints decides what is left:

- **Up to date**: steps 2 to 5 below are done. With a saved Current, shoot it once against its
  reference (the command is printed) and go on to the other variants; no matching rounds. A new
  screen still needs its screenshot (step 1) and its Current matched (step 6), but on the kit's
  theme and parts, so only what is particular to that screen is new.
- **Out of date** (it names the changed files): bring `theme.css` and the parts in line with
  those files only, take a fresh screenshot, match Current again (step 6), then save the kit
  again (below). Still much less than starting over.
- **Commits since the save, tracked files unchanged**: the kit holds; a quick look at a fresh
  screenshot beside the saved reference shows whether the screen itself moved.

With no kit, or `--kit=<name>` for a second product in the same repository (a back office beside
the app), do the steps below and save one at the end.

1. **Screenshots of the real thing.** Capture the screen and its states the user will judge
   against, into the app's `.proto/ref/<slug>/`, and read every one:
   - Web: run the project's app and screenshot the page in a browser, at 1440 wide (desktop)
     or 390 wide at 3x (phone).
   - iOS simulator: `xcrun simctl io <udid> screenshot <file>` on a booted simulator that
     already shows the screen. Don't drive someone else's simulator to get there; ask.
   - Mac app: `screencapture -l <window id> <file>`.
   - Nothing running: ask the user for screenshots. Existing ones in the repo (design folders,
     store assets, docs) count.
2. **The real assets.** Import the project's images, illustrations and fonts straight from
   the repo (`import hero from '@project/apps/app/assets/images/hero.webp'`, `@font-face` with
   a relative `url()`). Icons: the web package of the same icon set (`phosphor-react-native` →
   `@phosphor-icons/react`), added with `pnpm add --ignore-workspace` (or `npm i`) in the app's
   folder before you write variants (adding one reloads the page once). When the device draws
   icons no web package has (SF Symbols), use the project's own web fallback set if it has
   one, else the closest set, and say so in Current's `about`. Never an emoji or text glyph.
3. **The real tokens.** For a web project, the import above. For a native project (React
   Native, SwiftUI, Android), read its theme source (Tailwind or NativeWind config and
   `global.css`, a `theme.ts`, asset catalog colors, `colors.xml`) and copy the exact values
   into `src/theme.css`, with a comment naming the file each came from, converted where the
   format differs (an RGB triplet becomes `rgb()`, a line-height ratio becomes px). Same for
   the font family and type scale. The shell imports this file too, so new names go in
   `@theme {}` (`--color-brand-ink`), but values that replace Tailwind's own (`--font-sans`,
   `--text-xs`, `--radius-2xl`) go on a class (`.app { --font-sans: … }`) set on each variant's
   root; otherwise they restyle the shell. Right-to-left products: see "Right to left" below.
4. **The real chrome, once.** Rebuild the app's recurring pieces (tab bar, header, cards,
   buttons, sheets, status bar and home indicator on a phone) in `src/protos/<slug>/parts.tsx`,
   measured from the component source (radii, padding, sizes, blur), not eyeballed. System
   chrome with no numbers in the source (a native tab bar, Liquid Glass) is measured off the
   reference at its scale. When the source and the screenshot disagree, the screenshot wins:
   it is what the user sees. Every variant imports these parts, so the chrome can't drift.
   For an iPhone status bar, use the bundled `src/phone-status/ios.svg` as a `currentColor`
   mask (usage and Apple source in `src/phone-status/README.md`). It supplies 9:41 and
   Apple's cellular, Wi-Fi and full-battery artwork. Keep it in the design's shared parts;
   the shell already draws the Dynamic Island. Never substitute text glyphs for these icons.
5. **The device.** A phone prototype's screen is the reference's size in points:
   `--screen 402x874` for an iPhone 17 shot (1206×2622 px at 3x). Without it the frame is
   393×852.
6. **Match before anything else.** Write Current, then
   `proto shoot <slug>/A --ref .proto/ref/<slug>/<file>.png` (a relative path is looked up from
   the current folder, then the app's). It writes only `<slug>-A-screen.png`, the screen alone (a
   phone at 3x, so the same pixels as an iPhone shot of the same `--screen`), and
   `<slug>-A-vs-ref.png`, a sheet with the variant, the reference and the two laid over each
   other. Read the sheet (the `-screen.png` beside the reference for small detail), list every difference (position, size, color, type, copy, missing
   pieces), fix, and shoot again until the overlay shows no double edges on the layout. Only
   then write the other variants. `proto compare <slug>/A --ref <png> [--el <css>]` puts a number
   on it (% of pixels off, per column and per third, and a difference image): keep going while it
   falls, aim under about 2 % on what the user will judge, and stop when two tries in a row don't
   lower it. A number to stop at is faster than judging by eye; measured, it also replaces writing
   pixel-measuring scripts. Once it matches, `proto done <slug>/A`.
7. **Save the kit** as soon as Current matches, before the other variants, so the next session
   starts here instead of at step 1:

   ```
   proto kit save <slug> --sources <the files the tokens and chrome came from, from the project's root>
   proto kit screen <screen> <slug>/A --sources <the screen's own component files>
   ```

   `--sources` is what lets a later session see that the real app moved on: name the theme
   config and every component the parts were measured from (what `theme.css` and the parts
   import through `@project/…` or a relative path is tracked by itself). Then fill in the
   kit's `design-system.md` (the path is printed): the product, the tokens worth knowing by
   name, which values are invented, what each part is for, and the traps that took rounds. Save
   again whenever the theme or the parts change for the better (a later Current that needed a
   fix), and `proto kit screen` each new Current that matched. The kit lives in
   `.prototypes/_kits/`, git-ignored like the sessions; `proto rm` and `gc` never touch it.

The feature itself: write down in two or three lines what it must do. Every variant does all of it.

**A new product** (nothing ships yet, so there's no Current): import the project's tokens and
components if it has any (`@import` its token CSS in `src/theme.css`; import presentational
components through `@project/…` and add `@source "../../../src/components";` so their classes
are generated). With none, the look is yours to choose, and it is chosen per direction by the
plan in craft.md (next section), not once for the session: name it, give it a palette and a
type pairing (from the `proto fonts` pool), and tell the user it is invented. Once the user picks one, put
its tokens in a `@theme {}` block and save the kit (`proto kit save <slug>`), so the next
prototype keeps that look.

**A brand that lives somewhere else.** When the request names or points to a source outside this
folder (a GitHub repo, a website, an App Store page, "based on what you know from …"), go there
before the plans; never design it from memory. Resolve it (`gh repo view <owner>/<name>`,
`gh search repos`, `gh api repos/<owner>/<name>/contents/<path>` for files, a browser for a
site) and collect its logo files, colors, fonts, screenshots and voice: logos and images into
the app's `src/assets/brand/`, everything else as lines under `"brand"` in the brief, and its own
display faces, if any, under `"brandFonts"`. Then follow craft.md section 1: a brand is an
anchor, not a template (it is not Current: nothing ships yet to match). Tell the user what you
took and from where.

## Right to left (Hebrew, Arabic, Persian, Urdu)

When the product reads right to left, read `references/rtl.md` before writing any variant (Current and
new designs alike) and follow it in every one: built right to left from the first line, logical
sides only, never drawn left to right and flipped.

## 3. One usable direction first, then the exploration

**Plan the look, fast, then let every direction start.** The user expects to see design within
about half a minute, so the order is:

1. `proto add` with the directions' names, so the page shows their placeholders at once.
2. Read `references/craft.md` and take its stance: a studio design lead whose
   client rejected anything templated, one real aesthetic risk per direction, in the look, with
   a simple experience. Read the type catalog (`proto fonts`, with `--hebrew` for a Hebrew
   product): title faces come from it only, never from its never-for-titles list.
3. **One line per direction** into the app's `.proto/briefs/<slug>.json`, then `proto plan <slug>`:
   `{ "facts": "…", "script": "hebrew", "brand": "…", "brandFonts": […], "directions": { "A": {
   "name", "concept", "display", "body", "surface", "ink", "accent", "signature" } } }` (display
   and body are `font()` specs; `script` is the product's writing system, `latin`, `hebrew` or
   `arabic`; `brand` and `brandFonts` only when a brand exists, see above). Check the lines against
   the defaults craft.md lists and against each other (no shared font family, surface, signature
   or main-action pattern). `proto plan` turns each placeholder into its line, in its own face and
   colors, so the page shows every direction's look within seconds. This is the only planning
   before code that waits for you.
4. **Your own direction's hero, right away**, straight from its line (the first pass below).
5. **Then:** start the other directions' subagents when supported (section 4, short prompts)
   and, when the subject is photo-led (below), generate all directions' images in one request.
   Follow the image tool's instructions. If it supports background completion, build the rest
   while it runs; otherwise finish the generation call, save its assets, then continue.
   Write your full plan (craft.md, section 3) and build the rest.

With a Current the plan is short (what changes and why) and Current's look holds; without one it
is the whole look. **Images: when an image tool is available** (an image-generation skill or tool), **the subject is photo-led** (food, places, products, people, interiors)
**and the project has no images of its own, generating them is not optional.** Invoke that skill
yourself, once, for every direction's images (a hero each, a few product shots), into the app's `src/assets/`, named `<slug>-<letter>-<what>` (`kiosk-B-hero.jpg`),
started as plan step 5 says. Variants use them through `image()` from `src/images.ts`, which is
`undefined` until the file exists: a drawn shape holds the place, and the page swaps the image in
by itself when it lands. Subagents don't generate images.

**Read `references/images.md` before the first image of a session**, and follow the `images:` line
`proto up` prints. In short: `codex-image` makes every image when it is installed (with only the
Codex CLI, suggest installing it; inside Codex, suggest the host's latest image model for the
assets). Every request starts from the assets that already exist, passed as references and
matched in style, unless the user asks for another style. From scratch, each direction gets an
asset style guide and an anchor image first, so all its images speak one language. A layered
parallax hero uses `parallax()` from `src/parallax.ts`, with every layer overflowing what covers
it and the frame, checked at both ends with `proto shoot --parallax`.

**First usable output: one complete, high-quality direction.** No special prompt is needed.
Keep the real-product grounding, exact Current/reference match, real tokens/assets/chrome,
working interactions, responsive layout and necessary visual QA below. For an existing
product, retain A:Current and build the first proposed direction as B; for a new product,
build A. It comes first and is finished first, but the others don't wait for it: once its
hero is on screen (and Current matches, for an existing product), the remaining directions
start building alongside it, so the user watches all of them take shape (below). Do
not weaken Current's reconstruction or fidelity checks to get there sooner.

**Build live, in passes.** The user watches every variant fill in (the placeholders from
`proto add` hold their places meanwhile), so a variant is saved as it grows, not written whole at
the end:

1. **The hero, final:** the top of the page at rest, exactly as planned and finished: the real
   type (`font()`), palette, copy and signature, a plain shape where its image will go. Small, so
   it lands within seconds of the plan, and not a sketch to fix later: the rest is built under it.
2. **Sections**, one edit each, top to bottom: the rest of the content, the main interaction,
   images as they land.
3. **Finish:** states, motion, details, the checks (craft check, shots). Then
   `proto done <slug>/<letter>`.

Every save must render: write each pass whole (no half-written JSX), and import only files that
already exist. From `proto add` until `proto done`, the page marks the variant Building, and an
edit that throws keeps its last good frame (frozen) instead of showing an error, so a mistake
mid-build costs nothing on screen; after `done`, errors show again. A variant never marked done
stops being marked a few minutes after its last edit. Shots, the sheet and the critic are for
finished variants: don't spend them on a half-built one.

Deliver that first usable direction before optional review content. Do not author `useHints`,
scenario-control wiring, guided spotlight tours or `useCopy` alternatives on the initial pass
unless the user explicitly requested that capability. These are generated content, unlike the
shell's already-available panels and controls. Do not just hide pre-generated extras. A core
flow must still work without Try it: use visible demo values or sensible prefilled inputs when
needed; keep essential empty, loading and error behavior. State selectors needed for QA stay.
Do not spend the initial pass naming or annotating elements for Comments. Comments uses direct
visual targeting; source file/line attributes are automatic. There is no named-element catalog.
Add `data-shoot` only for selectors needed by interaction/QA checks, and preserve accessibility.

The page's **Decide → Needs explanation / Generate copy options** submits a request for the
current variant with an optional note; no chat prompt is required. A request shows Requested until
it is answered or deleted from Comments. Ready means the variant already exposes the capability;
use the existing Try it panel or T button (the pill's menu on a phone). Highlighting words on the
design floats a toolbar above them with the same two asks on just those words: Generate copy
options (a `copy-options` request with an element and the quoted words) and Comment (a comment
that starts with the words quoted).

**Preserve the design exploration.** The user's number when they give one ("/prototype 3 …").
Otherwise the scope sets it: 5 for a screen or a flow, 3 for a component or a section, 2 for a
choice between two behaviors (follow the system setting or not, a sheet or a page). The first
usable output changes the order of delivery, not this count. Build the remaining
requested/default directions alongside it (above), without waiting for another prompt. More like this in Decide asks for additional directions later (two without
a count). If Try it or copy alternatives were explicitly requested at the outset, add them
after the first usable prototype is in place.

Name each direction in a few words. Vary something structural: where it lives, how it is
triggered, how much it shows, the interaction model. Two directions that differ only in color
or spacing are one direction. With a Current, the directions are B onwards, and each keeps
Current's chrome and visual language unless the direction is about them. Without a Current
(a new product, a "go wild" request), each direction also has its own look: its own palette, type
pairing and signature from its plan, so the user is choosing between finished-looking designs,
not between wireframes in one default style.

**Rearranging adds nothing.** When the user asks to rearrange, restyle, simplify or declutter
what exists, every variant keeps exactly the product's features and content, and the
directions differ in layout and emphasis only. On any request, a variant that adds something
the product can't do yet puts `data-diff` on it and starts its `about` line with "New:", so an
invented feature is never mistaken for one that ships.

## 4. Add the prototype, then build each variant

```
proto add <slug> --title "Hero sections" --ask "<the user's request, in their words>" --variants "A:Current,B:Split media,C:Big price" [--kind phone] [--screen 402x874] [--from <slug>/<letter>[,<slug>/<letter>…] | --from-picks] [--slot <id> | --next | --reference-only]
```

`--from` records where a prototype came from; it does not connect a replacement. For a prototype
built from part of an existing variant ("take the hero from home B further", then "now just that
hero's CTA"), create its slot first and pass `--slot` as described below. Use `--reference-only`
only when the new prototype is intentionally a separate design and should not replace anything
in the parent. The page puts it in a column after that variant, the switcher's
second line shows the chain it came from, and the parent's overview links to it. `--from home`
(no letter) nests it under the prototype as a whole.

**New variants from one variant nest under it.** Whenever new variants start from one existing
variant, they are a new prototype built `--from` it, never new letters beside it. That holds
however the ask arrives: More like this in the page, a comment on a variant ("give me more options
for this", "now how it looks on mobile"), or chat ("B but with a map", "3 more takes on 2"). Use
`proto add <new slug> --from <slug>/<letter> --next --title "…" --variants "A:…,B:…"`:
the slug names what is being explored (`island-mobile`), the switcher's chain carries the rest,
and `--next` because the new designs are the variant's next versions rather than plugged into it:
a pick in them picks the parent too, and is built into it (When the user chooses). Only when the new variants are for one element of it is it
a slot instead (next paragraph). New letters in the same prototype are only for new directions
on the prototype's own ask (More variants on the prototype, "two more heroes"), not tied to one
variant.

When the user wants parts of several variants in one design ("E's layout with B's style", "one
last design from all my picks"), list them all after `--from`, the one whose structure the new
design keeps first: `proto add mix --from layout/E,style/B …`. It nests under the first; the
page names the others after a plus wherever it says where a prototype came from, and each of
their overviews links to it too. `--from-picks` uses every variant the user picked in this
session (oldest prototype first, archived ones left out) and prints the list; it stops if
nothing is picked yet. Compositions from several parents or `--from-picks` are reference-only
by default, so choosing one does not insert the combined screen into its first parent; pass
`--next` when the composition is the first parent's next version ("#4 with #5's behavior", "E's
layout with B's style"), so a pick in it is built into that parent. Say in
`--ask` what the new design takes from each.

**Plug a variant into what it was made from.** When the user points at one element of a variant
and wants variants of it ("five more of this button"), the pick should replace that element
where it came from. Before `proto add`, lift that one use into a slot, its markup left inside as
the default, and pass the props it needs (React only; Vue stops):

```tsx
import { Slot } from '../../slot'
<Slot proto="home" id="cta" label="Continue" onClick={next}><button …>Continue</button></Slot>
```

`id` is a short lowercase word; keep `proto` then `id` first, the tools read them that way. Then
`proto add button --from home/B --slot cta --variants "A:Current,B:…,C:…"`. A is the lifted
markup, matched to the original as Current always is. The rest are drop-ins: they read the props
the slot passes, each with a default so it also renders alone on its artboard. The user's pick
plugs a variant into `home/B` at once; picking Current, or taking the pick back, restores the
original. `home/B.tsx` is not edited, and a pick leaves nothing for you to do: the plug-in is
logged in both variants' history, too. One written use is
one slot (inside a loop it swaps every item); other variants and other uses of a shared component
are untouched. A component pick without `--slot` stays pending until connected or explicitly
recorded as reference-only. `proto handoff home/B` builds the
plugged-in design. Do this setup before presenting the variants. Do not wait for a pick or for
the user to ask you to assign it. Check the registered slot, the parent's original rendering and
the drop-ins' props before presenting the options; verify the replacement in its parent after
the user makes their actual choice.

This writes `src/protos/<slug>/meta.ts` and a "Building…" placeholder per variant, prints a
direct link to the prototype (`…/<slug>`), and the page jumps there by itself. Then replace each placeholder file whole, one at a time,
so the user sees them land:

- One file per variant, named by its letter: `A.tsx` (or `A.vue` in a Vue app). Names live in
  `meta.ts`. Never rename the files; letters run A … Z, then AA.
- **The user sees numbers, not letters.** The page shows each variant by number after a #,
  counted from its letter the way spreadsheet columns are: A is #1, Z #26, AA #27, AC #29. The
  number never changes when other variants are added or removed. Talk to the user in numbers
  with the # ("#3 and #29 are the strongest", never "C and AC" or "3 and 29"), and read theirs
  the same way ("idea 29" is AC). Every
  `proto` command takes a number where it takes a letter: `proto pick hero 29`,
  `proto work hero/29`, `proto shoot hero/29`. Files, routes and `meta.ts` keep the letters.
- Default export is the component. Its root fills the stage: `h-full` for anything that is one
  screen (app screens, drawers, sheets, overlays, a bar pinned to the bottom), `min-h-full`
  for a page that scrolls. `--kind phone` variants go in a phone frame whose screen is
  `--screen` (393×852 when not given).
- `position: fixed` inside a variant is pinned to the stage (or the phone frame), not the
  window, so drawers and sheets can use it. A portal isn't: Base UI's Drawer, Dialog, Popover
  and Toast (and `createPortal(…, document.body)`) render on the page's `<body>`, outside the
  stage, so a drawer's backdrop covers the whole page, the motion dock too. Give each `Portal` a
  `container` in the variant (`<Drawer.Portal container={rootRef}>`, a ref to the variant's
  root; Vue: a `<Teleport>` to it) so it stays on the stage.
- Make it real: realistic content (never lorem ipsum), working hover, focus, open and close,
  typing, empty and loading states where they matter. Local state is fine.
- Esc on a variant page goes back to the prototype's variants. A design that closes its own
  menu or dialog with Esc calls `e.preventDefault()` on that keydown, and the page stays.
- Responsive from 360px up, touch targets 36px (44px for primary actions), nothing hover-only.
- The shell's Light/Dark switch sets `.dark` on `<html>`. When the project has a dark mode,
  give the variants `dark:` classes; when it doesn't, leave them light (the shell around them
  still turns dark, which is expected).
- Small helpers can go in the same folder under lowercase names (`parts.tsx`).

**Show what's behind the clicks.** Whenever a variant has states a reviewer would otherwise
have to find (a menu, a drawer, a step, an empty state, anything one variant adds), list them in
`meta.ts` next to `variants`. The sidebar then lists the open variant's states under its
columns, each with its line, beside Autoplay, All states and Compare:

```
"about": {
  "A": "The baseline. Every action is one menu deep.",
  "B": "Looks the same as A at rest. Adds shortcuts inside."
},
"states": [
  { "id": "row-menu", "name": "Row menu", "click": ["[data-shoot=row-menu]"],
    "about": { "A": "Remind, download, mark paid or delete.", "B": "Adds Duplicate and Record payment." } },
  { "id": "payments", "name": "Payments", "click": ["[data-shoot=row]", "[data-shoot=payments]"], "only": ["B"],
    "about": { "B": "What is still owed, and when it was paid." } }
]
```

- `about` per variant: one line on what it is (the first variant) or how it differs from it.
- `click` is the selectors clicked in order, from rest, inside the variant: the same
  `data-shoot` attributes `proto shoot --click` uses. Every variant that has the state answers
  to the same selectors; a state only some variants have lists them in `only`.
- A state's `about`: the first variant's note says what the state is; the others say only what
  changed, or what it is when only they have it (both shown in amber). No note means unchanged.
- Put `data-diff` on what a variant adds; Compare outlines it.
- Mark what opens what: the root of every part that opens (a menu, a popup, a sheet, a dialog, a
  tab's panel) gets `data-opened-by="<selector of the control that opens it>"`, inside the variant
  (`<div data-shoot="phase-menu" data-opened-by="[data-shoot=phase-button]">`). A comment on
  something inside then keeps the way there: while that part is closed its pin sits on the control,
  and a click on the pin (or on the comment in the list) presses it open. A part inside another
  marks only its own control; the way through both is read from the two.
- `proto add`, `pick` and `archive` keep these fields; edit `meta.ts` after `proto add`.
- `count` is written by the first `proto add` (how many variants the prototype started with, the
  user's number or the one you settled on): the page's More variants, from a right-click on the
  prototype, offers that many again. Leave it as `proto add` wrote it; a prototype without one
  offers 5.

**Quick changes with Tweaks.** While building each variant, identify values a reviewer would
benefit from changing quickly. Proactively expose useful controls with `useTweaks` from
`src/tweaks.ts`, without waiting for a request. Use Tweaks for variations within the same
design: content states, appearance, density, permissions, long text and feature switches.
Use separate variants for different layouts or interaction approaches.

Choose a small, relevant set of controls that change real prototype behavior. Skip controls
that do not help evaluate the design, and do not add theme controls automatically. A static
composition study may need none. Read `references/tweaks.md` before implementing. Keep each
control scoped to its variant and use its real state setter. The shell supplies the desktop
inspector and mobile dock drawer; never add a second Tweaks toolbar inside the design.
Exercise every control and reset on desktop and mobile, confirming the preview changes.
Tweaks changes the design; Try it remains the place for explanations and outside events.

**Only on request: say what to type and try.** After an explicit request in chat or
`action: try-it` from the page, when getting through a variant takes something a reviewer can't
guess (a login, a code, a search that returns results), or it has scenarios, outside events or
limits worth knowing, report them with `useHints` from `src/hints.ts`: read `references/hints.md` first.

**Offer other copy when asked.** When the user asks for other words ("better headlines", "try other
button text") or sends `action: copy-options` from the page, don't write a variant per wording: give
the lines they asked about options with `useCopy` from `src/copy.ts`. Read `references/copy.md` first.

**Let the motion be reviewed.** When the request is about motion (how a sheet opens, a list
enters, a toast lands, the feel of a spring), or a comment arrives on the motion, read
`references/motion.md` first: `useMotion`, motion written in CSS or `element.animate()`, and reading it in
frames with `proto shoot --at` / `--frames`.

**Build remaining requested variants in parallel when you can.** When there are 3 or more
remaining variants to write and the harness has subagents, give each its own subagent, with the
model and effort from the table below, all started in one message. For a new product that is as
soon as your own hero is on screen (plan step 5 above): each direction carries its own look, so
nothing shared is written first except the facts every direction tells the same way (name,
products, prices, hours, address), under the lines in the brief. For an existing product, once
Current matches and the shared chrome (`parts.tsx`, `src/theme.css`, packages) exists.

A subagent's prompt is short: its letter, the app's folder, the brief's path
(`.proto/briefs/<slug>.json`, with the must-dos under the facts), its flags
(`--session <main conversation id>` and `--project <project root>` on every call),
the resolved absolute CLI path, with a Current the reference screenshots and `A.tsx` to start from,
and the line "Read `references/direction.md` first and follow it." That file
holds everything standing (hero first, plan, passes, images, limits, the reply); don't restate it.

**Which model and effort each subagent gets.** The measurements below apply to Claude models.
Use these preferences only when the active harness exposes those models and effort settings,
with its actual model IDs and supported delegation API. On Codex and other providers, keep the
session's own model and effort; these results do not establish equivalent models elsewhere.
When a tool cannot set model or effort, omit those arguments. Delegate into the same live app
with the explicit parent session and project flags, never a separate conversation or app.

| Job | Model, effort | Measured (one plugin UI, 2-3 runs per arm) |
|---|---|---|
| Build or rebuild a region from its written spec | Sonnet, medium | with the spec's one-SVG line: 21-23 s, 2.43-2.50 % of pixels off; Opus high without it: 130 s, 2.46 % |
| Polish a region toward its screenshot | Opus, high | the only arm that kept improving past the first build (2.46 %, 2.68 %) |
| A comment worker (a pin that needs real design work) | Opus, medium | Sonnet never moved menus along with the buttons it moved (0 of 6 runs); Opus high and medium did (4 of 4) |
| A new direction without a spec, a region's spec, the critic | session's model | not measured on another model |
| Claude jobs | avoid Haiku | slower than Sonnet, no more accurate |

A comment batch is not routed: the main session handles it itself. Handing the simple pins to a
primed Sonnet helper was measured slower (56 s against 52 s, median of 3) and no more accurate.

**A region worked on again and again: write its spec once.** When the user keeps refining the same
part (a rebuild of a real product they perfect over many rounds), extract it yourself or with one subagent (session's model)
from the source and the reference into `src/protos/<slug>/spec/<region>.md`: every box, colour,
font, icon path and layer as numbers, with the source line each came from, the screenshot winning
where they disagree. Later builds and changes read the spec, not the source: measured, builds from
a spec took 30-90 s against 150-470 s from source, at slightly lower fidelity on the first try
(the loop above closes most of it). Writing the spec costs 3-9 minutes, so it pays from the second
or third rebuild of that region, and not for a one-off round of directions.

The spec also says how to draw the region: everything that isn't text (icons, pills, dividers,
logos, outlines) in one absolutely positioned SVG in the region's own coordinates, at the spec's
fractional positions; only the text is HTML boxes on top. Measured on a plugin toolbar: without this line every
model's first build scored 3.64 % of pixels off, and only Opus at high effort found the SVG
approach itself (2.46 % in 130 s); with it, Sonnet at medium effort scored 2.43-2.50 % on its first
build in 21-23 s, three runs out of three.

When all are back, run one `proto shoot <slug> --sheet`, read it, fix what the sheet shows and
what the subagents named, write each variant's `about` and `states` into `meta.ts`, then go on
with section 5 (which starts with the critic). Without subagents, write every direction's hero first,
one after another, then build each out in turn and mark it done. The sheet is the same.

## 5. Look at it, then iterate

**Craft first, then defects.** The first direction gets craft.md's full craft check from you,
on its single shots at full size, once it is built (the others are building meanwhile). Once every direction is built,
start **the critic** (craft.md, section 10): one subagent (session's model) with fresh eyes that reads the plans,
the sheet and the single shots and returns the three changes that would most raise each
direction. Apply them (without subagents, run that review yourself as a separate pass). Then the
defect rounds below.

```
proto shoot <slug> --sheet                      # every variant on one contact sheet: what you read each round
proto shoot <slug> --sheet --theme dark         # the same in dark mode
proto shoot <slug> --sheet --state row-menu     # a state from meta.ts, across the variants that have it
proto shoot <slug>/B <slug>/B/row-menu          # single shots of routes (no route: the session lobby)
proto shoot <slug>/B --click "[data-shoot=add]" # a state reached by clicking (repeatable)
proto shoot <slug>/A --ref <screenshot.png>     # beside and over a screenshot of the real screen
proto shoot <slug>/B --copy                     # copy mode on (useCopy): each line's mark, and the bar
proto shoot <slug>/B --copy --click "[data-copy=headline]" --click "[data-copy-option='2']"   # its third option in place
proto shoot <slug>/B --at 350                   # a variant with useMotion, 350 ms into its motion
proto shoot <slug>/B --frames 12 [--at 300-620] # 12 moments of its motion (or of that range) on one sheet
proto shoot <slug>/B --size 834x1194            # one viewport instead of desktop and phone (a tablet here)
proto shoot --pin <batch>/<n>                   # what a comment is on, as its writer saw it (Comments from the page)
```

`--sheet` shoots every variant (a web one at 1440×900 and 390×844, a `--kind phone` one at
phone size only) and prints one contact sheet per prototype, `<slug>-sheet.png`: a column per
variant with its number and name, desktop above phone, the picked one outlined, no more than
2000 px either way. Then one line says where the single shots are (`<slug>-<letter>-desktop.png`,
`-mobile.png`, in the app's `.proto/shots/`). **Read the sheet: one image a round.** It is for
comparing layout, hierarchy and how far apart the directions are; desktop shows at about a third
of its size, the phone row close to full size. Open a single shot only for what the sheet can't
show (small copy, an alignment, a clipped edge), and only that one. Past about 12 variants it
goes on to `-sheet-2.png`; read each.

For a right-to-left prototype, `proto shoot` first lists any physical left or right in its files
(see Right to left). For states behind an interaction, put `data-shoot="…"` on the elements and
list the state in `meta.ts`, or pass one `--click` per step; if a state's clicks match nothing,
`proto shoot` says so. With copy options, shoot each line's longest option once (`--copy` and the
two clicks above) to see that it fits. For each variant, note what breaks: alignment, hierarchy, clipped text,
overflow on the phone row, weak affordance, too many steps, and where it has drifted back toward
a default from craft.md. Fix it and push each variant further in its own direction instead of
letting them converge. Do 2 rounds unless the user asked for
more, and shoot the sheet again after the last round.

**Check that it runs smoothly.** When a variant animates on its own (a canvas, an analyser, a
ticker, a live chart) or is judged under the pointer (a drag, a slider, a knob), run
`proto perf <slug>/<letter>` after the last round, with `--drag "<css>"` on the control the user
will move. "smooth" is the bar; when it drops frames, its verdict names the thread that is full.
Two causes found so far: a canvas path of hundreds of points filled or stroked whole every frame
saturates the GPU (draw it as short pieces, each clipped to its own vertical slab on whole device
pixels, with a couple of points of overlap so joins stay whole); and a canvas that redraws what
never moves (a background, a blurred shadow) every frame (draw that once, on a layer of its own).

## 6. Pick one and say why

Choose the best variant yourself (never Current; if nothing beats it, say so). The reply always
includes:

1. The live link, at the top.
2. With a Current, its `-vs-ref.png` sheet first, so the user sees it matches. Then the last
   round's contact sheet as an image with its absolute path
   (`![Hero sections](/abs/path/hero-sheet.png)`), and `-sheet-dark.png` too when the variants
   have a dark mode. Add a single shot only where the sheet can't carry the point: your pick at
   full size (`![C · Big price](/abs/path/hero-C-desktop.png)`), or a detail you name in the text.
3. One line per variant: its direction and its main weakness.
4. The pick and why it wins for this product and its users, in two to four sentences, and
   what you would take from the runners-up.

That is your recommendation; it marks nothing in the page. The page marks a pick only when the
user makes one (next section).

## When the user chooses

The user chooses in chat ("go with A", "A it is", "build B", "let's move forward with C") or in
the page, where each variant has Pick (the Decide button in the bar, or P, a card of Pick,
More like this and Build it with its note beside them; on a phone, the top of the variant
sheet), and the note says why or what to change in it. A pick
made in the page is already marked when you hear of it, as a comment with `action: pick` (see
Comments from the page), its note as the comment's words: don't run `proto pick` again, and do
what the note asks, then `proto reply <id> --done`. A pick with a note stays pending until then;
a plain pick is already done unless its line says `assignment pending`. In that case, finish the
missing slot connection, run `proto pick` for the chosen variant, verify it in its parent, then
reply `--done`. The user's pick already authorizes this work; do not ask them to create or assign
it again. If it is intentionally only a reference, record `--reference-only` and acknowledge that.
A pick in a prototype built `--from` a variant also picks that variant, and its own `from` up the
chain (choosing a part of B means choosing B); `also` parents are left alone, and undoing a pick
leaves the parents picked.

**A pick among a variant's next versions is built into it.** When the picked prototype is nested
under a variant with `--next` (More like this, "more options for 2", "#4 with #5's behavior"),
the pick is that variant's new design, so the user expects to see it there too, without asking.
The pick's line (and `proto pick`'s output, for a choice in chat) says `build it into <parent>, then
…`, nearest first, and the comment stays open until you do: `proto work <parent> --ask "…"`, make
the parent draw what the pick draws (rewrite it, or re-export the pick when they are now the same),
keep its name and update its `about` line, then the next parent up the same way. Stop before a
parent whose prototype explores a different question than the pick answers (compare their asks:
a prototype of drag behaviors is not rebuilt as the upright panel it inspired), and say where you
stopped. A `--reference-only` design without `--next` is separate: its pick is done at once. Shoot what changed, then `proto reply <id> "…" --done` naming the variants rebuilt.

As soon as the user chooses in chat, run `proto pick <slug> <number>` before anything else,
without asking. If they don't
name the prototype, it's the one you showed them last. The page then marks it (a check in the
sidebar, the variant first and outlined in its overview, the rest faded but still there) and
everything built from the prototype stays nested under it. Choosing again replaces the pick;
"undo that" is `proto pick <slug> --off` (in the page, Picked #2 undoes it). A pick also makes that variant the one being worked
on (next section). Then do what they asked next, if anything.

A pick is not an archive: archive is for directions the user drops, and a picked prototype is
the one they will come back to.

**Favorites.** With many variants the user stars the ones worth a second look: Favorite in a
variant's right-click or ⋯ menu, or S on the variant shown. A star marks it in the sidebar, the
overview and the phone's sheet, and **Favorites only** (beside Grid / Full size, the star by the
sidebar's count, or the phone's sheet) lists just the favorites, so they can be compared side by
side. Favorites are the user's own marks, not decisions: nothing reaches the inbox and nothing is
asked of you. They are kept in `meta.ts` as `favorites` (letters); `proto fav` lists them by
number, and when the user asks in chat ("star 12 and 40", "which ones did I star?") use
`proto fav <slug>/12 <slug>/40` (`--off` to unstar) or `proto fav`. A follow-up round on the
favorites ("more like my favorites", "combine my favorites") starts from that list.

If `proto up` or `proto shoot` failed, say so with the error instead of leaving things out.

## While the user works on one variant

After a pick the user usually asks for changes to one variant, round after round. A strip at
the top of the sidebar names it ("Your requests change this design", then the prototype and
variant), and its row in the columns wears a green pin. Away from it, the strip offers Go to it
(or W). It folds out into the changes they asked for, in order, with ticks and times, and a pick
shows there as "You picked X".

- **Each change the user asks for on it:** run `proto ask "<what they asked, a few words>"`
  before you edit, one line per request, in their terms ("Plus card: make it the obvious
  choice"), not yours.
- **When their request is about a different variant** ("now let's do D", "B's header, same
  idea"): `proto work <slug>/<letter> --ask "<what they asked>"` first. The strip moves there and
  offers Undo; the old one keeps its history.
- **Only on purpose.** Don't move it for an edit in passing (a typo in A, a shared `parts.tsx`):
  those light the editing dot as always. A variant built with `proto add --from` becomes the
  working one only when the user starts asking for changes to it.
- `proto work` alone prints the current one; `proto work --off` clears it. Archiving its
  prototype clears it too.

## Comments from the page

The user can leave comments on the design in the page (the Comment button, or C): click an
element (or drag out a region with the mouse, or, on a phone, hold a finger on a spot), write, tag other elements with `@`, attach a
screenshot and mark it up (or paste an image with Ctrl/⌘ V, or drop one on the comment), then send
every draft at once. Commenting never reaches the design, so a menu or popover open in it stays
open and what is in it can be commented on. Hover-only parts work the same way, with no key: while
commenting, whatever a hover made appear (a dot's readout, a panel that opens under the pointer) stays
up while the pointer moves onto it, parts drawn with `pointer-events: none` can be picked, and the
hover is held while that comment is written. Nothing to build for it: plain hover state in the
variant is enough (a CSS-only `:hover` is the exception in a device view). The comments island's list shows
them and shows what became of each. `@` opens the existing visual picker to tag another
element. Do not author special comment-element names or a catalog of elements. The outline
and numbered references identify selected targets; source locations are stamped automatically.
The design's native accessibility labels and semantics must remain intact. Keep `data-shoot` only where a QA/state selector
needs it; Comments does not use it as a display name. Existing comments keep their targets. Each send is a batch waiting for you in the app's inbox. You hear
about it only when you read the inbox. **At the start and end of every active prototype turn,
run `proto inbox`** and handle pending requests before finishing.

**Keep one listener for the entire session, including while handling comments.** Prefer a
persistent event subscription when the harness supports one. Never add a listener agent,
helper conversation, recurring polling task, or a second subscription for the same app.

Follow **`references/listener.md`** for the persistent T3 webhook (Codex and Claude),
supported background completion wakeups on other hosts, and recovery when neither exists.
Read it at startup, before finishing a turn with page comments enabled.

**When a session ends** (T3 Code restarted, the terminal closed) after taking comments and before
answering them, the page shows them as "Not picked up" and offers the user a restart message to
paste in the thread. That message makes you run `proto inbox` or `proto inbox --wait`, which hands
those comments over again, once and in full, marked `taken earlier by a session that ended`: handle
them first. The page knows the taker ended because each taken batch can record `PROTO_AGENT_PID` (or `CLAUDE_PID`), the long-lived
agent process. Set it only when the harness supplies a reliable PID, never the short-lived
CLI PID. Without one, pending requests remain readable but exit detection is unavailable.
Replies detect Codex or Claude from the harness environment; other agents use a neutral mark.
Session labels detect Codex or Claude from the identity variables above and update when
a different host runs a command. Unknown hosts show Agent. Ordinary terminal commands
keep the last detected host. `PROTO_AGENT` overrides session labels; `reply --as` changes
only the author mark on that reply.

Set `PROTO_AGENT=codex|claude|agent` or pass `proto reply ... --as codex|claude|agent` when the
harness does not expose identity, or when switching agents on an existing session.

Each comment prints its route (`<slug>/<letter>[/<state>]`, with the number the user saw beside
it: `hero/AC (#29)`; say #29 when you reply), the user's words, the element
it is on (tag, text, `data-shoot` or selector, its box in CSS px from the variant's top left,
and where it is written: its file from the app's folder, line and component, as
`src/protos/today/parts.tsx:30 (PriceCard)`; open it there) and any elements it tags (numbered `with @1`, `with @2`, matching the comment), and the absolute path of each image attached to it:
`(marked up)` is a screenshot of the design, `(the region, as dragged out)` the picture of a
dragged-out region, `(pasted by the user)` an image they pasted or dropped (a reference, another
app, anything). A comment
pinned to a spot with a long press (on a phone, where no element fit) prints `at:` the spot, in
the same px, and `in:` the element under it: the change is about that spot, not the whole
element. One dragged out as a region with the mouse prints `region:` its box, in the same px,
and `in:` the smallest element around it: the change is about what is in that box.
The user can delete a comment after sending it: one deleted before you took its batch
never reaches you, and one deleted after is withdrawn: `proto inbox` leaves it out (the batch
line counts it, `(1 withdrawn in the page)`) and `proto reply` to it says so. Leave a withdrawn
comment alone. Under each comment with an element, the source around its line is printed (`>`
marks the line), so most comments can be acted on without opening a file.

**A comment is about the one element it is on.** Its `used:` line says where the components around
it are used, innermost first. When that element belongs to a component used in more than one
place (one dropdown of several, one row of a list), `proto inbox` adds a `shared:` line with the
one use the comment is on and the source around it. Change that use only: pass a prop, an option
or a variant at that line (`<Menu … wide />`), and leave the shared component's look for the
others as it is. When that line is inside a helper that draws several (`const menu = (shoot, …) =>
<Menu shoot={shoot} …/>`), the values the use passed (`passed shoot="phase-menu"`) name the one:
change the call that passes them. Change the component itself, and so every use, only when the words say so ("all
dropdowns", "every row", "each menu"); when it is unclear, change the one and say in the reply
that the others are untouched. The reply names which one changed ("only the Phase menu").

**A comment on the whole variant** (written in the comments island's box, or from a
sidebar row's Comment on this) prints `on: the whole variant (its root <div> at 0,0 WxH)`: it is
about the design as a whole (its density, tone, structure or flow), not one element. Make the change
where the design lives, across the parts it names, rather than on one element; the reply says what
changed overall.

**The user can answer your reply** (Reply under it, in the comments island's list), and the comment becomes a
thread there. The answer reaches you as a comment in a batch of its own, on the same element, spot or
moment as the comment it follows, with the exchange so far printed before its words, oldest first:
`2. plugin/A  (reply to 20261014T005910-51b2/2)` then
`earlier: "<their comment>"  ->  Claude: "<your reply>"`. Read it as the next line of that exchange,
not a fresh request, and answer it with `proto reply <batch>/<n> "…" --done` like any comment; the
reply shows in the thread.

**Handle a batch as one job, not one comment at a time.** The user is waiting from the moment
they press Send until the last change is in, and the time goes into round trips and lookups, not
into the edits. Measured on 12 small comments: one pass took 48 s; a worker per file took 86 s
(each worker loads its context before it starts, and the slowest sets the finish).

1. Read every image. Record the asks once per variant the batch is on (each comment's route says
   which; a batch can hold comments on several): `proto ask --to <slug>/<letter> --each "<comment,
   their words>" "<comment>" …`, one call per variant (`proto work … --ask` first when the user is
   moving on to another variant).
2. What the printed source doesn't show (a class defined elsewhere, a constant), read for all
   comments together, in one call: one `sed -n`/`grep` per file in a single command, not a tool
   call per comment.
3. Make every edit in as few calls as the files allow. Then check what each change pushes into:
   text that grew, a button that moved or widened, a size that changed can now overlap its
   neighbour or overflow its box. Fix that in the same pass, and name it in the reply.
   For optional extras, recheck the batch's `batch.json` for `withdrawn` before editing and
   before replying. A withdrawn request is canceled: stop optional work, and do not claim delivery.
   If no useful extra applies, reply with that reason and `--done`, so it can be requested again.
4. One shot of what changed (`proto shoot <route>`, or `--size` for the view the comments were
   written in), read once. Skip it when every change is invisible in a shot (hover, behaviour).
   For a comment on a detail (a line's weight, an outline, spacing, something inside a menu or
   shown on hover), check it with `proto shoot --pin <batch>/<n>` (`--pin <batch>` for every
   comment of the batch) before replying: it shoots the element at the user's own page size and
   theme (or the view's size) at 2x, opens the way to it (its `opened by` controls, hovering where
   it only shows on hover), and writes `pin-<batch>-<n>.png` (its box plus `--margin`, 24 px),
   `-context.png` (the region around it) and, when the comment has pictures, `-vs-ref.png` (the shot
   beside them at one height). Read `pin-<batch>-<n>.png` for the detail (the sheet scales it to
   the pictures' height) and the vs-ref sheet for the comparison. A detail can look right at the default shoot
   size and wrong on the user's page. The command prints the element's box, how it found it (a
   selector that no longer matches is said so) and what it could not replay. It restores the
   design's saved settings and the user's stage size when the batch has them; a `stand-in:` line
   (an indexed control the user had, like `band-dot-2`, replaced by the nearest one here), a
   `NOTE:` (the element is gone; what it was in is shot) or a `WARNING:` (another shape than the
   comment's box) means the shot is not what the user saw: read it with that in mind. `--state <id>` shoots
   it in a state from meta.ts, `--hover` keeps the pointer on it, `--after <ms>` waits longer
   before the shot.
5. One reply call for the batch: `proto reply <batch> 1 "<what you changed>" 2 "…" … --done`
   (use `--as codex`, `--as claude` or `--as agent` to override the detected reply mark). A comment
   you can't act on is left out of that call and gets its own reply without `--done` saying why.
   A comment whose answer is new variants or a new prototype ("more variants for this", a `more`
   decision; from one variant they nest under it, step 4) is answered as soon as they are added, not when they are built: `proto add` them,
   then `proto reply <batch>/<n> "<where they are, and what they are>" --until <slug>` (or
   `<slug>/<letter>,…`). The page shows that reply under "Agent is on it", and `proto done`
   closes the comment when the last of those variants is built, keeping the reply: write it to
   read right both times ("In «Super set, more ways», under this case: …", not "Building now…"). Without `--done` or `--until`, a
   comment stays "on it" in the page for good; when comments arrive, `proto inbox` lists any still open.
6. Keep the same persistent listener active. With a background wait, rearm it before handling this batch.

Use workers only when comments in one batch each need real design work (a new variant, a section
rewritten) in separate files: then one subagent per file, on Opus at medium effort, all started together.

**Send each comment as you add it.** A switch under the Send button (kept per browser) sends each
comment the moment it is added, so batches of one arrive while the user writes the next. Handle
each the same way, keeping the same listener active; comments that piled up meanwhile arrive together and
are one job. Measured with 12 comments added 15 s apart: everything was in 16 s after the last one,
against 54 s after Send for the same 12 sent at once, because only the last one is left to do. A
comment withdrawn in the page after it was handled is answered by undoing it, if the user asks.

**A comment on the motion** (`at: 0.35 s` or `at: 0.30–0.62 s`): see `references/motion.md`.

**A comment in a view** (written while the page showed another size, see the top) has a `view:`
line, `view: desktop 1440x900`, and is about that layout, not the one the batch's page size says.
Run the shoot the line names (`proto shoot <route> --size 1440x900`) and read it, change that
layout (its breakpoints, so the other sizes stay as they were), shoot it again, and name the size
in the reply ("On desktop the heading is 28 px now; phone and tablet as before").

**Decisions from the page** arrive in the same batches, as comments with an `action:` line and
no element (a `copy` choice is on its line's element); the user's optional note follows a colon in
the text.

| `action:` | Already done | You |
|---|---|---|
| `pick` | marked and the working variant; a note, `assignment pending` or `build it into` keeps the comment open | finish any assignment repair the line names and verify the choice in its parent, or build the pick into the parents it names (When the user chooses), handle the note, then `proto reply <id> --done`. For an intentionally separate design, record `--reference-only`. When the line says it wasn't marked or the working variant didn't move, run the `proto pick` it names |
| `unpick` | the pick is off, and the comment done | nothing. When the line says nothing changed (that variant wasn't the pick), say so in a reply with `--done`; when it says it wasn't taken off, run the `proto pick … --off` it names |
| `more` | nothing | a new prototype nested under that variant (New variants from one variant nest under it, step 4): run the `proto add` the line prints with your slug and variants; reply with what you are adding and `--until <new slug>` (step 5) |
| `more-variants` | nothing | on the prototype (the route is `<slug>`, no letter), with a `count` the user chose: that many new variants, continuing the letters (`proto add <slug> --variants "<next letters>:…"`), each a new direction, different from the existing ones and from each other; their note, if any, is the direction. Reply with what you are adding and `--until <slug>/<first letter>,…` (step 5) |
| `build` | picked and the working variant (the line says `picked in the page`) | step 7; reply when it is in. When the line doesn't say it was picked and it isn't the pick, `proto pick` it first |
| `try-it` | queued only; no content generated yet | check that the request is not withdrawn; add useful `useHints` to this variant only (section 4), preserve its working flow, verify it, then reply `--done`; if it already has useful hints, reuse them |
| `intake` | the answers are saved and the questions are marked answered; nothing is built | read the printed answers and the files beside them, decide what was left to you, reply `--done` with the brief you will build from, then plan the directions (step 3) |
| `copy-options` | queued only; no alternatives generated yet | check that the request is not withdrawn; add `useCopy` to the requested lines in this variant only (headline and primary text/CTA without a note), current words first, verify fit, then reply `--done`; reuse existing options. One with an element and quoted words (highlighted in the page) is for those words only: one `useCopy` line on that element, not the headline and primary text |
| `copy` | nothing (one comment per line changed since the last send, on that line's element; the text says option k of n, their own words, or back to today's words) | put the chosen words first in that line's `useCopy` options and keep the rest; then one `proto reply <batch> "…" --done` for the batch, in one line. The page drops its own choice once the words are first |

## 7. Only if asked: build it

When the request says to implement the winner (the picked variant), read `references/build.md` and
follow it: `proto handoff`, build with the project's own components, then the `--as built` overlay.

## Only if asked: share snapshots

When the user wants the prototypes in a doc or artifact to share: read `references/build.md` (Snapshots).

## Follow-up requests in the same session

| The user asks for | Do |
|---|---|
| More takes on an existing prototype's ask, not on one variant ("two more heroes") | `proto add <same slug> --variants "D:…,E:…"` |
| Something new ("now the pricing page") | `proto add <new slug> …` |
| Variations of one variant ("B but with a map", "more options for 2", "2 on mobile"), in chat or a comment | `proto add <new slug> --from <slug>/B --next …`, nested under B (step 4) |
| A part of one variant, explored as a separate study ("explore B's hero on its own") | `proto add <new slug> --from <slug>/B --reference-only …` |
| Variants of one element that should replace it where it is ("more of this button") | lift it into a `<Slot>`, then `proto add <new slug> --from <slug>/<letter> --slot <id> …` |
| Parts of several variants together ("E's layout with B's style") | `proto add <new slug> --from <slug>/E,<slug>/B --next …`, the one whose layout it keeps first |
| One design from everything they picked ("a final design from all my picks") | `proto add <new slug> --from-picks …` |
| A choice in chat ("go with 3", "build 29") | `proto pick <slug> <number>` first, then what they asked |
| Stars in chat ("star 12 and 40", "show my favorites") | `proto fav <slug>/12 <slug>/40`, or `proto fav` to list them; Favorites only in the page shows just those |
| The winner built into the codebase ("build B", "ship it") | `proto pick` if not yet, then `proto handoff <slug>/<letter>` and step 7 |
| A pick, More like this or Build it from the page (`action:` in a batch) | the table under Comments from the page |
| Other copy for some lines ("better headlines", "other button text") | `proto ask "…"`, then `useCopy` on those lines (Offer other copy when asked) |
| Copy choices sent from the page (`action: copy`) | the table under Comments from the page |
| A change to the variant being worked on ("make the price bigger") | `proto ask "…"`, then edit it |
| It feels slow or stutters ("the fps isn't fast enough", "dragging lags") | `proto perf <slug>/<letter>` (with `--drag` on what lags, `--dpr` of their screen), fix what the verdict names, measure again |
| A change to another variant ("now D, same idea") | `proto work <slug>/<letter> --ask "…"`, then edit it |
| To review an animation ("how should the sheet open?", "the toast lands too hard") | the motion in CSS or `element.animate()`, `useMotion` in each variant, then `proto shoot <slug>/<letter> --frames 12` |
| A comment on the motion (`at: 0.30–0.62 s` in a batch) | the shoot its line names, change the motion, reply with the new timing (Comments from the page) |
| A comment in a view (`view: tablet 834x1194` in a batch) | the shoot its line names, change that layout's breakpoints, reply naming the size (Comments from the page) |
| To drop a direction or prototype | `proto archive <slug>` (still reachable under Archived) |
| The prototypes in a doc to share | Snapshots with an available document tool, or `proto shoot` images (section above) |
| Comments sent from the page (a webhook wakeup or completed `proto inbox --wait`) | the batch as one job: one `proto ask --to <slug>/<letter> --each` per variant in it, edits, one shot, one `proto reply <batch> 1 "…" 2 "…" --done`, keep the same listener active |
| Prototypes for a different project | `proto up --project <dir>`: a separate app for that project |

## Lifecycle

| When | Do |
|---|---|
| The user says they are done, or the winner is built and its `-vs-built.png` shows no double edges | `proto stop` (files kept; `proto up` brings it back on the same link) |
| The user asks to throw the prototypes away | `proto rm` |
| The user wants to keep them | `proto keep` (`--off` undoes) |
| The user wants their links | `proto ls` |

On its own: a server stops after 6 hours with no edits and no open page (90 minutes once every
prototype in the session is picked or archived, unless the session is kept), and every
`proto up` deletes sessions untouched for 14 days unless kept and drops leftover tailnet
rules (`proto gc` does the same on demand). The user can also Keep or Stop from Settings › Session
in the page.

The project's design kits (`.prototypes/_kits/`) outlive every session. When the user wants one
gone (a redesign shipped and it no longer looks like the app), delete its folder; the next
session builds and saves a new one.

## When something is off

- **No tailnet** (Tailscale missing or logged out): the link is local only; say so.
- **The link doesn't answer:** `proto up` prints the error and the local link; the server log
  is the app's `.proto/dev.log`.
- **A variant shows a red error box:** that variant threw. Fix the file; it re-renders.
- **`proto shoot` prints `slow …`:** a shot took over 3 s, and the line says which step took
  the time. Pass the line on to the user.
- **Don't edit** the app's `shell/`, `src/main.ts`, `src/registry.ts`, `src/mount.*`, `src/hints.ts`, `src/copy.ts`, `src/motion.ts`, `src/parallax.ts` or `src/fonts.ts`. If the
  shell itself misbehaves, say so; the template is `app/` in the resolved skill directory (replaced on
  every plugin update, so a fix belongs upstream). `proto up` copies the template over an
  existing session's app files (everything except `src/protos/` and `src/theme.css`) and adds
  the shell's packages, printing `updated the app: …` when it did; an edit to those files is
  lost there.
