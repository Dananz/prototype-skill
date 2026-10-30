# Designs and the map: a shell that grows without limit

Date: 2026-10-30
Status: approved in conversation (grilling session), spec for review
Prototype: session `a8993d68-864b-46e6-bc2f-c060e64117a7`, prototype `map` (the user picked #3, Full until picked)

## Problem

Today everything is **session › prototype › variant**. That fits exploring: one question, five
answers, pick one. It breaks down at the user's next step. They take the pick (say Home #3) and grow
it into a whole concept: About, Pricing, a sign-up flow, a checkout. Those screens are not variants
of anything. They are pages of one product, they link to each other, and a Home variant can lead to
an About page that exists in only one design. The shell has no place for them, so they end up as
unrelated prototypes, and the session's columns and sidebar grow by one entry per item until the user
can no longer find their way around.

Goal: a shell that stays calm at hundreds of screens and dozens of explorations, keeps variants as
the way a decision gets made, and lets whole flows of linked screens be built, walked and reviewed.

## Decisions (from the conversation)

### Model

1. **One tree per project, not per session.** The tree outlives sessions. A session is a filter
   ("what this conversation added") and an entry in history, not a separate app.
2. **Two kinds of node in that tree:**
   - **Exploration**: today's prototype. One question, N options, you pick one. UI name: *Exploration*.
   - **Design**: a set of screens that share one look (tokens, fonts, parts) and link to each other.
     UI name: *Design*.
   A Design's screens are tagged *screen*. A Design is a group, not a deeper level of nesting.
3. **A Design is born from an explicit act on a variant**: "Make this the design" (Decide menu,
   chat or a comment). That variant becomes screen 1 and sets the look. The source variant shows
   "became design X". An empty start ("design the whole site") is allowed, but its first screen is
   an Exploration that is promoted on pick.
4. **A new screen always arrives as an Exploration** (the screen's options). Until one is picked,
   option #1 stands in for the screen, with a "not picked" tag, so the flow can be walked before
   every decision is made. A pick replaces the screen in the design (today's `--next` mechanics).
5. **Screens of a Design are siblings; links are lines.** About is not a child of Home because Home
   links to it. Links form a graph (back links, a nav bar that reaches every page), so they are
   edges drawn on the map, not tree depth.
6. **Flows**: Claude groups screens into flows (Main, Sign up, Checkout) from the link chains; the
   user renames and moves screens between flows in the Layers panel.
7. **Links point at a screen, not a variant.** A link lands on the screen's picked version (or its
   stand-in #1).
8. **Shared parts**: when a pick changes a part the whole design shares (the header, the colors),
   Claude asks whether to apply it to every screen or only this one.
9. **Several Designs per project** (develop Home #3 and Home #5 into two full concepts and compare).
   Links never cross between Designs. The map shows all of them or one, with a way to choose.
10. **Existing sessions are imported automatically** on the first `proto up` of the new model: each
    old prototype becomes an Exploration under a group named for its session. Nothing is deleted.

### Interface

11. **Three ways to move around**, replacing today's columns switcher and lobbies:
    - **Map**: an infinite canvas (drag, pinch, ⌘/Ctrl + wheel). Screens as thumbnails, link lines
      between them, Explorations beside the screen they belong to.
    - **Focus**: one screen big, today's stage. **Continuous zoom** between Map and Focus (pinch out
      of a screen lands on the map; double click a screen flies into it). A breadcrumb
      `‹ Flow › Screen ›` walks the flow.
    - **Jump**: ⌘K search over every Design, flow, screen, Exploration and option.
12. **Explorations on the map: full until picked** (prototype #3). An Exploration with a pick folds
    into a stack that shows the pick (count badge, green check). An open one stays spread out (amber).
    A click on a stack opens it. Rejected: semantic zoom (#1), always full (#2).
13. **The sidebar becomes a Layers panel**, closed by default: Designs › flows › screens › a screen's
    Exploration › its options, then Explorations on no screen. A row flies the map there.
14. **Links ask first in Focus**: a click on a link in a screen opens a chip ("Go to About", with its
    Exploration's state). A link to a screen that doesn't exist yet offers "Ask Claude to build it",
    so the product grows out of the design itself.
15. **New links**: Claude writes them in code as it builds screens. The user can also drag a line on
    the map, from one element (connected at once) or from a whole screen (sent to Claude, who picks
    or adds the element).
16. **Comments everywhere on the map**: on an element (as today), and also on a link line or a whole
    flow ("this button should lead to Pricing", "the checkout is too long"), at any zoom.
17. **Phone**: the same three. Focus by default, pinch out to the map, Jump in the pill's menu,
    Layers as a sheet.

### Share and build

18. **A share link to a Design opens on the map**; from there the viewer goes into screens.
19. **Build it on a Design builds the screens you choose** (default: all picked screens), with the
    links as real navigation in the app. A screen whose Exploration is still open is marked.

## What the prototype showed (session a8993d68, `map`)

- Constant-size labels (`calc(11px * var(--iz))` with `--iz = 1 / zoom`) keep flow names and stack
  badges readable at every zoom; screen names hide below about 70 px of screen width.
- Camera as a translate on an outer layer and CSS `zoom` on the world (not `transform: scale`), so
  iOS Safari doesn't paint every layer at full size.
- The page's own preview zoom takes ⌘/Ctrl + wheel and Safari gesture events at the frame's document;
  the map takes them first at `window` in capture and stops them. The real shell owns both, so this
  hack goes away, but the map must be the one owner of zoom in Map mode.
- With every link drawn, back links (Welcome → Home, Order placed → Home) already read as spaghetti
  at 12 screens. Lines between rows leave from the bottom or top. "Selected only" (lines of the
  selected screen) is a must-have option, and probably the default past some size.
- Not tried yet: 120 screens on a real iPhone, pinch on a device.

## Open, decided by me unless the user says otherwise

- Hebrew UI names for Exploration and Design (the shell is translated through `t()`).
- Where the Design filter sits (likely the bar, beside Jump).
- When "Selected only" becomes the default line mode.

## Phases

Each phase ships on its own and leaves the skill working. Each gets its own implementation plan.

1. **Project tree and import.** One app per project, the tree on disk, session as a filter, old
   sessions imported, every `proto` command and the inbox working against it. The UI stays today's
   (columns, sidebar), fed from the project tree.
2. **Designs in the model.** `proto design` (make this the design), screens, flows, links in code
   (`<Go to="about">`), the stand-in #1, shared-part question, several Designs. CLI and SKILL.md
   first, minimal UI (screens listed in today's sidebar).
3. **The map.** Map, Focus, continuous zoom, Jump, Layers panel, full-until-picked stacks, link
   lines with "Selected only", the link chip. Replaces columns and lobbies. Phone included.
4. **Map interactions.** Drag a link, comments on lines and flows, "Ask Claude to build it",
   Design filter.
5. **Share and build.** Share a Design opening on the map; Build it for chosen screens with real
   navigation.
