---
name: prototype
description: Use when the user asks to prototype a UI, wants several versions or variations of a screen, component, section or interaction, or says "/prototype", "/prototype 3 <feature>", "show me options for…", "give me a few versions of…". Also use for follow-up requests in the same session ("now 5 variations of the hero", "add two more", "try it on the phone"). NOT for a single straightforward UI change, logic with no visible surface, or comparing libraries or APIs.
allowed-tools:
  - Bash(node "${CLAUDE_SKILL_DIR}/scripts/proto.mjs" *)
---

# Prototype

Each Claude Code session gets **one live prototype app**. The user gets its link once, at
the start, and watches every prototype appear and fill in as you write the files: the page
updates through hot module replacement, never a reload. Everything the user asks for in the
session lives in that one app: **session › prototype › variant**.

The app already has its navigation (a switcher in the bar that opens the session as columns,
a sidebar with one line per level and the current level as two columns, a stepper through the
variants (on a phone, a pill at the bottom you drag along, with a menu for the page's tools and
Comment, and the columns as a sheet you drill into), edge arrows, a focus mode with a dock, light and dark, phone frames, "editing" dots, a
strip naming the variant your requests change). You only write variant files.

Beside Comment the bar has three sizes, phone, tablet and desktop (on a phone, the Layout row of the
pill's menu). On a wide screen a web variant sits on an artboard as big as the stage, laid out for
the stage's width (its breakpoints see the stage, not the window); the stage's own layout is
selected. Choosing another shows the page at that size, zoomed to fit (a 1440 × 900 desktop on a
phone, a phone on a desktop); the scale button zooms either from 10% to 200%, and the user can
pinch, Space-drag, comment, try things, pick copy and scrub motion there. Nothing to build for it
beyond a web variant that lays out well at each width.

`proto` below means `node "${CLAUDE_SKILL_DIR}/scripts/proto.mjs"` (through `node`, the path in
double quotes, not a shell variable: the same command works in Bash, Git Bash and PowerShell). It
finds the session from `$CLAUDE_CODE_SESSION_ID` and the project from the git root of the current
folder. A subagent building into the main session's app passes `--session <the main session id>`
on every call.

## 1. Start the session app, then send the link

Before reading the codebase or designing anything:

```
proto up --name "<short session title, e.g. Refuel redesign>"
```

It creates the app on the first call in a session, restarts it if it stopped, and prints
`url …`. Send that URL to the user right away in one short message ("Live link: … it fills
in as I build"). Then continue. On later requests in the same session run `proto up` again
(same app, same link) and don't resend the link unless the user lost it.

What `proto up` does: the app lives in `<project>/.prototypes/<session>/` (git-ignored, the
project's own files are untouched), its stack follows the project (React for React, Next or
Expo projects, Vue for Vue or Nuxt, React for anything else), it runs a Vite dev server and
publishes it on the tailnet with `tailscale serve`, so the link opens on the user's phone too.

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
   pixel-measuring scripts.
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
type pairing (`proto fonts --draw`), and tell the user it is invented. Once the user picks one, put
its tokens in a `@theme {}` block and save the kit (`proto kit save <slug>`), so the next
prototype keeps that look.

## Right to left (Hebrew, Arabic, Persian, Urdu)

When the product reads right to left, read `${CLAUDE_SKILL_DIR}/references/rtl.md` before writing any variant (Current and
new designs alike) and follow it in every one: built right to left from the first line, logical
sides only, never drawn left to right and flipped.

## 3. One usable direction first, then the exploration

**Plan the look before code.** Read `${CLAUDE_SKILL_DIR}/references/craft.md` before the first variant. Draw the
type (`proto fonts --draw <n>`, with `--hebrew` for a Hebrew product), then write each
direction's plan (concept, palette, type, layout, pattern, signature, imagery, motion, volume)
into the app's `.proto/briefs/<slug>.md`, check the plans against the defaults that file lists
and against each other (no shared font family, surface, signature or main-action pattern; at
most one loud direction), and build from them. With a Current the plan is short (what changes
and why) and Current's look holds; without one it is the whole look. This takes a minute per
direction and is what keeps the result from looking generated. When an image tool is available
and the subject is photo-led, start its images while you write the code (craft.md, Imagery).

**First usable output: one complete, high-quality direction.** No special prompt is needed.
Keep the real-product grounding, exact Current/reference match, real tokens/assets/chrome,
working interactions, responsive layout and necessary visual QA below. For an existing
product, retain A:Current and build the first proposed direction as B; for a new product,
build A. Finish and check that proposed direction before writing the remaining variants,
so the user can use it while the rest of the exploration follows through HMR. Do not weaken
Current's reconstruction or fidelity checks to get there sooner.

Deliver that first usable direction before optional review content. Do not author `useHints`,
scenario-control wiring, guided spotlight tours or `useCopy` alternatives on the initial pass
unless the user explicitly requested that capability. These are generated content, unlike the
shell's already-available panels and controls. Do not just hide pre-generated extras. A core
flow must still work without Try it: use visible demo values or sensible prefilled inputs when
needed; keep essential empty, loading and error behavior. State selectors needed for QA stay.
Do not spend the initial pass naming or annotating elements for Comments. Comments uses direct
visual targeting; source file/line attributes are automatic. There is no named-element catalog.
Add `data-shoot` only for selectors needed by interaction/QA checks, and preserve accessibility.

The page's **Actions → Add Try it / Add Copy options** submits a request for the current
variant with an optional note; no chat prompt is required. A request shows Requested until it
is answered or deleted from Comments. Ready means the variant already exposes the capability;
use the existing Try it panel or T button (the pill's menu on a phone).

**Preserve the design exploration.** The user's number when they give one ("/prototype 3 …").
Otherwise the scope sets it: 5 for a screen or a flow, 3 for a component or a section, 2 for a
choice between two behaviors (follow the system setting or not, a sheet or a page). The first
usable output changes the order of delivery, not this count. After that first direction is
usable and checked, continue the remaining requested/default directions without waiting for
another prompt. More like this in Actions asks for additional directions later (two without
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
proto add <slug> --title "Hero sections" --ask "<the user's request, in their words>" --variants "A:Current,B:Split media,C:Big price" [--kind phone] [--screen 402x874] [--from <slug>/<letter>[,<slug>/<letter>…] | --from-picks]
```

`--from` is for a prototype built from part of an existing variant ("take the hero from
home B further", then "now just that hero's CTA"): `proto add hero --from home/B …`, then
`proto add cta --from hero/C …`. The page puts it in a column after that variant, the switcher's
second line shows the chain it came from, and the parent's overview links to it. `--from home`
(no letter) nests it under the prototype as a whole.

When the user wants parts of several variants in one design ("E's layout with B's style", "one
last design from all my picks"), list them all after `--from`, the one whose structure the new
design keeps first: `proto add mix --from layout/E,style/B …`. It nests under the first; the
page names the others after a plus wherever it says where a prototype came from, and each of
their overviews links to it too. `--from-picks` uses every variant the user picked in this
session (oldest prototype first, archived ones left out) and prints the list; it stops if
nothing is picked yet. Say in `--ask` what the new design takes from each.

This writes `src/protos/<slug>/meta.ts` and a "Building…" placeholder per variant, prints a
direct link to the prototype (`…/#/<slug>`), and the page jumps there by itself. Then replace each placeholder file whole, one at a time,
so the user sees them land:

- One file per variant, named by its letter: `A.tsx` (or `A.vue` in a Vue app). Names live in
  `meta.ts`. Never rename the files; letters run A … Z, then AA.
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
- `proto add`, `pick` and `archive` keep these fields; edit `meta.ts` after `proto add`.

**Only on request: say what to type and try.** After an explicit request in chat or
`action: try-it` from the page, when getting through a variant takes something a reviewer can't
guess (a login, a code, a search that returns results), or it has scenarios, outside events or
limits worth knowing, report them with `useHints` from `src/hints.ts`: read `${CLAUDE_SKILL_DIR}/references/hints.md` first.

**Offer other copy when asked.** When the user asks for other words ("better headlines", "try other
button text") or sends `action: copy-options` from the page, don't write a variant per wording: give
the lines they asked about options with `useCopy` from `src/copy.ts`. Read `${CLAUDE_SKILL_DIR}/references/copy.md` first.

**Let the motion be reviewed.** When the request is about motion (how a sheet opens, a list
enters, a toast lands, the feel of a spring), or a comment arrives on the motion, read
`${CLAUDE_SKILL_DIR}/references/motion.md` first: `useMotion`, motion written in CSS or `element.animate()`, and reading it in
frames with `proto shoot --at` / `--frames`.

**Build remaining requested variants in parallel when you can.** After the first proposed
direction is usable and checked, when there are 3 or more remaining variants to write, the
harness has subagents, and Current matches its reference (for a new product: once the tokens and
`parts.tsx` exist), give each variant its own subagent. First write everything shared yourself
(`parts.tsx`, `src/theme.css`, `meta.ts`, packages), then start every subagent in one message.
Each is told:

- its letter and its direction's whole plan from `.proto/briefs/<slug>.md` (concept, palette
  as hex values, type pairing as `font()` specs, layout and its wireframe, pattern, signature,
  imagery, motion), and the feature's must-do lines;
- to read `${CLAUDE_SKILL_DIR}/references/craft.md` (its absolute path; not pasted into the brief) before writing,
  and to build from the plan exactly, deriving every color and type decision from it;
- the app's folder, the reference screenshots, and `A.tsx` to start from;
- to write only `src/protos/<slug>/<letter>.tsx` and lowercase helpers of its own (`c-map.tsx`).
  `parts.tsx`, `meta.ts`, `theme.css` and the other variants are read-only to it, and it installs
  nothing; it asks for those in its reply;
- `--session <the main session's $CLAUDE_CODE_SESSION_ID>` on every `proto` call, plus
  `--project <project root>` if it works in another folder; never `proto up`, `add`, `pick` or `work`;
- to shoot only its own variant (`proto shoot <slug>/<letter>`), read both single shots at full
  size, run craft.md's short craft check (questions 1, 5 and 7) on them, fix, and shoot again;
  where it rebuilds something that has a reference, to loop on `proto compare` with the stop rule above;
- to reply in at most five lines: what it built, its weakest point, and which default from
  craft.md it is closest to.

Start them at medium effort (the Agent tool's `effort: "medium"`). Measured on two regions of a
plugin UI rebuilt from source: medium matched high on the simpler one in 0.9x the time; on the
harder one high was closer (0.8 % vs 1.2 % of pixels off) in 2.3x the time. Keep high for a last
polish pass on a region the user is judging closely.

**A region worked on again and again: write its spec once.** When the user keeps refining the same
part (a rebuild of a real product they perfect over many rounds), have one subagent extract it
from the source and the reference into `src/protos/<slug>/spec/<region>.md`: every box, colour,
font, icon path and layer as numbers, with the source line each came from, the screenshot winning
where they disagree. Later builds and changes read the spec, not the source: measured, builds from
a spec took 30-90 s against 150-470 s from source, at slightly lower fidelity on the first try
(the loop above closes most of it). Writing the spec costs 3-9 minutes, so it pays from the second
or third rebuild of that region, and not for a one-off round of directions.

When all are back, run one `proto shoot <slug> --sheet`, read it, fix what the sheet shows and
what the subagents named, write each variant's `about` and `states` into `meta.ts`, then go on
with step 5 (which starts with the critic). Without subagents, write the variants one after another; the sheet is the same.

## 5. Look at it, then iterate

**Craft first, then defects.** The first direction gets craft.md's full craft check from you,
on its single shots at full size, before the others are written. Once every direction is built,
start **the critic** (craft.md, section 10): one subagent with fresh eyes that reads the plans,
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
```

`--sheet` shoots every variant (a web one at 1440×900 and 390×844, a `--kind phone` one at
phone size only) and prints one contact sheet per prototype, `<slug>-sheet.png`: a column per
variant with its letter and name, desktop above phone, the picked one outlined, no more than
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
the page, where each variant has Pick (the check button in the bar, or P; on a phone, the top of
the variant sheet). A pick made in the page is already marked when you hear of it, as a comment
with `action: pick` (see Comments from the page): don't run `proto pick` again.

As soon as the user chooses in chat, run `proto pick <slug> <letter>` before anything else,
without asking. If they don't
name the prototype, it's the one you showed them last. The page then marks it (a check in the
sidebar, the variant first and outlined in its overview, the rest faded but still there) and
everything built from the prototype stays nested under it. Choosing again replaces the pick;
"undo that" is `proto pick <slug> --off` (in the page, Picked B undoes it). A pick also makes that variant the one being worked
on (next section). Then do what they asked next, if anything.

A pick is not an archive: archive is for directions the user drops, and a picked prototype is
the one they will come back to.

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
element (or, on a phone, hold a finger on a spot), write, tag other elements with `@`, attach a
screenshot and mark it up (or paste an image with Ctrl/⌘ V, or drop one on the comment), then send
every draft at once. Commenting never reaches the design, so a menu or popover open in it stays
open and what is in it can be commented on. The side panel's Comments tab lists
them and shows what became of each. `@` opens the existing visual picker to tag another
element. Do not author special comment-element names or a catalog of elements. The outline
and numbered references identify selected targets; source locations are stamped automatically.
The design's native accessibility labels and semantics must remain intact. Keep `data-shoot` only where a QA/state selector
needs it; Comments does not use it as a display name. Existing comments keep their targets. Each send is a batch waiting for you in the app's inbox. You hear
about it only while you listen, so **at the end of every turn in a prototype session,
listen**: run, in the background, with the Bash tool's longest timeout (2 hours),

```
proto inbox --wait
```

It exits when a batch arrives (printing it), which wakes you; after 115 minutes with nothing
it exits saying so, and you listen again. If one is already listening it says so and exits;
leave it. `proto inbox` without `--wait` takes whatever is waiting now and tells you whether
something is listening.

Each comment prints its route (`<slug>/<letter>[/<state>]`), the user's words, the element
it is on (tag, text, `data-shoot` or selector, its box in CSS px from the variant's top left,
and where it is written: its file from the app's folder, line and component, as
`src/protos/today/parts.tsx:30 (PriceCard)`; open it there) and any elements it tags (numbered `with @1`, `with @2`, matching the comment), and the absolute path of each image attached to it:
`(marked up)` is a screenshot of the design, `(pasted by the user)` an image they pasted or
dropped (a reference, another app, anything). A comment
pinned to a spot with a long press (on a phone, where no element fit) prints `at:` the spot, in
the same px, and `in:` the element under it: the change is about that spot, not the whole
element. The user can delete a comment after sending it: one deleted before you took its batch
never reaches you, and one deleted after is withdrawn: `proto inbox` leaves it out (the batch
line counts it, `(1 withdrawn in the page)`) and `proto reply` to it says so. Leave a withdrawn
comment alone. Under each comment with an element, the source around its line is printed (`>`
marks the line), so most comments can be acted on without opening a file.

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
5. One reply call for the batch: `proto reply <batch> 1 "<what you changed>" 2 "…" … --done`
   (Codex adds `--as codex`, which puts its mark beside the reply instead of Claude's). A comment
   you can't act on is left out of that call and gets its own reply without `--done` saying why.
6. Listen again.

Use workers only when comments in one batch each need real design work (a new variant, a section
rewritten) in separate files: then one subagent per file, at medium effort, all started together.

**Send each comment as you add it.** A switch under the Send button (kept per browser) sends each
comment the moment it is added, so batches of one arrive while the user writes the next. Handle
each the same way, then listen again at once; comments that piled up meanwhile arrive together and
are one job. Measured with 12 comments added 15 s apart: everything was in 16 s after the last one,
against 54 s after Send for the same 12 sent at once, because only the last one is left to do. A
comment withdrawn in the page after it was handled is answered by undoing it, if the user asks.

**A comment on the motion** (`at: 0.35 s` or `at: 0.30–0.62 s`): see `${CLAUDE_SKILL_DIR}/references/motion.md`.

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
| `pick` | marked, the working variant, and the comment done, unless its line says otherwise | do what the note asks, if anything; a reply is only a note. When the line says it wasn't marked or the working variant didn't move, run the `proto pick` it names |
| `unpick` | the pick is off, and the comment done | nothing. When the line says nothing changed (that variant wasn't the pick), say so in a reply with `--done`; when it says it wasn't taken off, run the `proto pick … --off` it names |
| `more` | nothing | new letters in the same prototype, named after it (`proto add <slug> --variants "D:…"`); reply with what you added |
| `build` | nothing | `proto pick` it if it isn't the pick, then step 7; reply when it is in |
| `try-it` | queued only; no content generated yet | check that the request is not withdrawn; add useful `useHints` to this variant only (section 4), preserve its working flow, verify it, then reply `--done`; if it already has useful hints, reuse them |
| `copy-options` | queued only; no alternatives generated yet | check that the request is not withdrawn; add `useCopy` to the requested lines in this variant only (headline and primary text/CTA without a note), current words first, verify fit, then reply `--done`; reuse existing options |
| `copy` | nothing (one comment per line changed since the last send, on that line's element; the text says option k of n, their own words, or back to today's words) | put the chosen words first in that line's `useCopy` options and keep the rest; then one `proto reply <batch> "…" --done` for the batch, in one line. The page drops its own choice once the words are first |

## 7. Only if asked: build it

When the request says to implement the winner (the picked variant), read `${CLAUDE_SKILL_DIR}/references/build.md` and
follow it: `proto handoff`, build with the project's own components, then the `--as built` overlay.

## Only if asked: snapshots in a Claude Doc

When the user wants the prototypes in a doc or artifact to share: read `${CLAUDE_SKILL_DIR}/references/build.md` (Snapshots).

## Follow-up requests in the same session

| The user asks for | Do |
|---|---|
| More takes on an existing prototype ("two more heroes") | `proto add <same slug> --variants "D:…,E:…"` |
| Something new ("now the pricing page") | `proto add <new slug> …` |
| Variations of one variant ("B but with a map") | new letters in the same prototype, named after B |
| A part of one variant, explored on its own ("B's hero, but better") | `proto add <new slug> --from <slug>/B …` |
| Parts of several variants together ("E's layout with B's style") | `proto add <new slug> --from <slug>/E,<slug>/B …`, the one whose layout it keeps first |
| One design from everything they picked ("a final design from all my picks") | `proto add <new slug> --from-picks …` |
| A choice in chat ("go with A", "build B") | `proto pick <slug> <letter>` first, then what they asked |
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
| The prototypes in a doc to share | `proto snap`, then a Claude Doc (section above) |
| Comments sent from the page (a `proto inbox --wait` exited) | the batch as one job: one `proto ask --to <slug>/<letter> --each` per variant in it, edits, one shot, one `proto reply <batch> 1 "…" 2 "…" --done`, listen again |
| Prototypes for a different project | `proto up --project <dir>`: a separate app for that project |

## Lifecycle

| When | Do |
|---|---|
| The user says they are done, or the winner is built and its `-vs-built.png` shows no double edges | `proto stop` (files kept; `proto up` brings it back on the same link) |
| The user asks to throw the prototypes away | `proto rm` |
| The user wants to keep them | `proto keep` (`--off` undoes) |
| The user wants their links | `proto ls` |

On its own: a server stops after 6 hours with no edits and no open page (30 minutes once every
prototype in the session is picked or archived), and every
`proto up` deletes sessions untouched for 14 days unless kept and drops leftover tailnet
rules (`proto gc` does the same on demand). The user can also Keep or Stop from the session
menu in the page.

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
- **Don't edit** the app's `shell/`, `src/main.ts`, `src/registry.ts`, `src/mount.*`, `src/hints.ts`, `src/copy.ts`, `src/motion.ts` or `src/fonts.ts`. If the
  shell itself misbehaves, say so; the template is `${CLAUDE_SKILL_DIR}/app/` (replaced on
  every plugin update, so a fix belongs upstream). `proto up` copies the template over an
  existing session's app files (everything except `src/protos/` and `src/theme.css`) and adds
  the shell's packages, printing `updated the app: …` when it did; an edit to those files is
  lost there.
