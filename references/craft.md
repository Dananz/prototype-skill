# Craft: designs that look made, not generated

Read before the first variant of a prototype. Variant subagents and the critic read it too, by
its path (don't paste it into a brief). Sections 1 to 4 are Anthropic's `frontend-design` skill
(Apache 2.0), kept close to its own words; the rest is how this skill builds on it.

**Where it applies.** Everywhere a look is being chosen: a new product with nothing shipping
yet, a direction that is about the look, a "go wild" request. With a Current, Current's look
wins: a direction keeps its palette, type and chrome unless the direction is about them, and
this file still governs how well the new parts are made (hierarchy, type, layout, motion, words).

Approach this as the design lead at a small studio known for giving every client a visual
identity that could not be mistaken for anyone else's. This client has already rejected
proposals that felt templated, and is paying for a distinctive point of view: make deliberate,
opinionated choices about palette, typography and layout that are specific to this brief, and
take one real aesthetic risk you can justify.

**The risk is in the look; the experience stays simple.** Put the boldness into type, color,
composition and imagery, and keep the way it works obvious: a first-time visitor sees what this
is and does the main thing (find, choose, order, book) in a glance and a couple of taps, with
controls they already know. A new interaction model (a countdown that leads, ordering by chat, a
receipt that prints, a box to fill) is a direction only when the brief is about the interaction;
otherwise it is complexity the user has to learn, and it reads as cleverness, not design. The
strongest directions are usually the subject's own artifact as the page (its price board, its
label, its window), used plainly.

## 1. Ground it in the subject

When the subject already has a brand somewhere (a repo, a site, a store page the request points
to), treat it as an anchor, not a template: the logo file as it is, the name, the voice and one
clear moment of its key color are given; the surface, palette, type, composition and risk are
still yours, as freely as without a brand. A brand kills distinctiveness only when it becomes the
whole look: five directions in the brand's lavender with its screenshot as the hero is one
direction five times.

If the brief does not pin down what the product or subject is, pin it yourself before designing:
name one concrete subject, its audience, and the page's single job, and state your choice. What
you know of the user's preferences, what they are building and designs made for them before are
hints. The subject's own world, its materials, instruments, artifacts and vernacular, is where
distinctive choices come from. Build with the brief's real content and subject matter throughout.

## 2. Design principles

**The hero is a thesis.** Open with the most characteristic thing in the subject's world, in
whatever form makes sense for it: a headline, an image, an animation, a live demo, an interactive
moment. Be deliberate with the choice: a big number with a small label, supporting stats and a
gradient accent is the template answer; use it only if it is truly the best option.

**Typography carries the personality.** Pair the display and body faces deliberately, not the
same families you would reach for on any other project, and set a clear type scale with
intentional weights, widths and spacing. Make the type treatment itself a memorable part of the
design, not a neutral delivery vehicle for the content. Character lives in the display face, used
large and sparingly; the body face is plain and easy to read. Two faces is usually right.

**Structure is information.** Numbering, eyebrows, dividers and labels should encode something
true about the content, not decorate it. Numbered markers (01 / 02 / 03) belong only on a real
sequence, where order carries information the reader needs.

**Motion, deliberately.** Think about where and if animation serves the subject: a page-load
sequence, a scroll-triggered reveal, hover micro-interactions, ambient atmosphere. An
orchestrated moment usually lands harder than scattered effects. Sometimes less is more: extra
animation adds to the feeling that a design is AI-generated.

**Match complexity to the vision.** Maximalist directions need elaborate execution; minimal
directions need precision in spacing, type and detail. Elegance is executing the chosen vision
well.

**Words are design material** (section 8): copy can make a design feel as templated as the
design itself.

## 3. Process: brainstorm, plan, critique, build, critique again

For calibration: AI-generated design right now clusters around a few looks that appear
regardless of subject. Where the brief pins down a visual direction, follow it exactly, the
brief's own words always win, including when it asks for one of these. Where it leaves an axis
free, don't spend that freedom on a default:

- **Type:** Inter, Roboto, Arial, Open Sans or the system font as the display face; Space
  Grotesk, Fraunces and Instrument Serif as the "interesting" picks; one family at one weight for
  everything; the same few faces in every direction and every session.
- **Color:** a warm cream background (near `#F4F1EA`) with a high-contrast serif and a terracotta
  accent; a near-black background with a single bright acid-green or vermilion accent; a purple
  or blue-violet gradient on white; every color used evenly so nothing leads.
- **Layout:** a broadsheet with hairline rules, zero radius and dense newspaper columns; the SaaS
  card kit (three icon cards in a row, a big number with a small label); a centred hero with two
  buttons over a gradient blob; cards with a colored left border; the same sticky bottom bar in
  every direction.
- **Details:** a tracked all-caps eyebrow over every heading; `→` appended to every link and
  button; emoji as icons; glass on every surface; a shadow and a hover lift on every card.
- **Motion:** a fade-and-slide-up on every section and a hover transition on every card.

Work in two passes. The direction's one-line plan (with the shared facts, in
`.proto/briefs/<slug>.json`) is enough for its hero, so the hero goes on screen first. Then
brainstorm in your thinking and write the full plan to `.proto/briefs/<slug>-<letter>.md`:

```
## B · Tide table
Concept:   one line, what it is and why it fits this subject
Palette:   4-6 named hex values by role: surface, ink, muted, accent (+ one support)
Type:      display (characterful, used with restraint), body (complementary), utility for
           numbers if needed, as font('…') specs (section 5); the scale and weights
Layout:    one sentence, plus an ASCII wireframe of the screen at rest
Pattern:   how the main action works (a sticky bar, a form in the hero, a picker, a drawer)
Signature: the single element this direction will be remembered by
Imagery:   what fills the visual space (photo, generated image, drawn shapes, data, none)
Motion:    the one moment that moves, or none
```

Then review each plan against the brief before building. If any part reads like the generic
default you would produce for any similar page (work through a similar prompt and see whether
you arrive somewhere similar), revise that part and say what you changed and why. Check the
plans against each other too: no two directions share a font family, a dominant surface color, a
signature or a pattern for the main action, unless the feature itself requires it (shared facts
like the business name, address and prices are fine). Only then write the code, following the
revised plan exactly and deriving every color and type decision from it.

Do most of this planning and iteration in your thinking; show the user ideas you are confident
will delight them.

## 4. Restraint and self-critique

Spend your boldness in one place. Let the signature be the one memorable thing, keep everything
around it quiet and disciplined, and cut any decoration that does not serve the brief. **Not
taking a risk can be a risk itself.** Build to a quality floor without announcing it: responsive
down to mobile, visible keyboard focus, reduced motion respected. Critique your own work as you
build, from screenshots (section 9). Consider Chanel's advice: before leaving the house, look in
the mirror and remove one accessory.

**House taste, as a tiebreaker, not a cap.** Premium, calm execution: busy, cute decoration reads
childish, and dark is welcome where it fits (layered near-blacks with real separation, a rare
accent). That is about execution, not about avoiding risk: a bold idea carried out with precision
is what gets picked. And the house rules of the tooling:

- **Concentric corners:** an inner radius is at most the outer radius minus the padding between.
- **Quiet utility chrome:** share, clear, settings and locale are 32-36 px icon buttons or text
  links, never pill buttons that compete with the primary action.
- **Plain words on things you can touch** over raw numbers; exact values behind a toggle.
- **Icons** from Phosphor (installed), one weight per design. Never an emoji or a text glyph.
- **Drawers, dialogs, popovers** from Base UI (installed), with a `container` in the variant.
- **Tailwind classes** for styling; inline styles only for computed values.

## 5. Type: the font kit

1. **Every Google Font, with no install.** `font()` from `src/fonts.ts` adds a family to the page
   from Google Fonts (an install would reload the page). Call it at the top of the variant's
   module with the css2 spec of each family, then set the families with Tailwind, spaces as
   underscores (`font-['Karantina']`, `font-['Frank_Ruhl_Libre']`), on the variant's root and
   its headings, never in `@theme`, which restyles the shell:

   ```
   import { font } from '../../fonts'
   font('Karantina:wght@300;400;700', 'Assistant:wght@200..800')
   ```

2. **A catalog**, `references/fonts.json`: about 50 display, body and utility pairings by mood,
   each spec checked against Google Fonts, 20 of them Hebrew. `proto fonts` lists them (`--hebrew`
   for the Hebrew ones and every Google family that has Hebrew).
3. **Title faces come from the catalog only** (or the brand's own display face, when the brief
   has a brand). Choose by the direction's concept, never at random, and say in the plan why the
   type fits. Body and utility faces may go past the catalog to any Google Font that reads well.
4. **Never for a title:** the catalog's `neverTitle` list (`proto fonts` prints it): hairline or
   single-thin-weight faces, the defaults every generated page reaches for, novelty and costume
   faces, scripts and handwriting. A title is set at weight 400 or heavier; light and thin
   weights are for body text at most. `proto plan` refuses a plan that breaks this.

**Hebrew is a must** in a Hebrew product, and for Arabic the same with its script:

- Every face that sets text in the product's script supports it; a Latin-only face falls back
  silently to a system font and changes every width.
- A Hebrew display face with character carries the personality (Karantina, Suez One, Secular One,
  Frank Ruhl Libre, Bellefair, Rubik at 800 and up, Gveret Levin for a hand-lettered sign); a
  Hebrew body face carries the reading (Assistant, Heebo, IBM Plex Sans Hebrew, Rubik, Miriam
  Libre). Novelty and handwriting faces only where the concept is about them.
- The RTL rules in references/rtl.md (no letter-spacing, no italics, no uppercase) still hold.

Then the mechanics: display at least 2.5 to 3 times the body size, or a clear weight jump; a
scale of four or five steps, used consistently; `tabular-nums` for prices, tables and timers;
each color with a role, the accent rare; text on any surface at WCAG AA.

## 6. Imagery and depth

An empty gray box where an image goes makes everything around it look unfinished. In order of
preference:

1. The project's own images.
2. **A generated image, whenever an image tool is available** in this session (the `codex-image`
   skill, or an image-generation MCP) and the subject is photo-led (food, places, products,
   people, interiors). Then it is not optional: a drawn pastry where a photo belongs is the
   weakest part of the page. One hero image and a few product shots per direction, in the
   direction's own light and styling, saved into the app's `src/assets/` as
   `<slug>-<letter>-<what>`. The main agent generates them for all directions at once, as one
   background command right after its own hero, and doesn't wait on it. Variants read them with
   `image()` from `src/images.ts` (undefined until the file lands): a drawn shape holds the place
   and the page swaps the image in by itself. No tool available: skip this, don't ask.
3. Drawing from the subject in code: SVG shapes, a chart, a map, a gradient with grain.

Depth comes from layering and light, not from a shadow on everything.

## 7. Motion in this tooling

`motion` (React: `motion/react`; Vue: `motion-v`) is installed for gestures and layout changes.
When the design calls `useMotion` (references/motion.md), write the motion in CSS or
`element.animate()` so it can be recorded. Respect `prefers-reduced-motion`.

## 8. Words

Words appear in a design for one reason: to make it easier to understand, and therefore easier
to use. Bring the same intentionality to copy as to spacing and color. Write from the end user's
side of the screen: name things by what people control and recognize, never by how the system is
built. Being specific is always better than being clever. A control says exactly what happens
("Save changes", not "Submit"), and an action keeps its name through the whole flow (Publish,
then "Published"). Failure and emptiness are moments for direction: say what went wrong and how
to fix it, in the interface's voice, without apologising; an empty screen is an invitation to
act. Plain verbs, sentence case, no filler; each element does exactly one job.

## 9. The craft check

On a direction's single shots at full size (`proto shoot <slug>/<letter>`, then read
`-desktop.png` and `-mobile.png`); the contact sheet is too small for it. Answer each in a word,
and fix every no:

1. Is the signature visible at first glance, on desktop and phone?
2. Is the hero a thesis: the most characteristic thing in the subject's world, not a template?
   And is the main action obvious in a glance, done in a couple of taps with familiar controls?
3. Is the type itself part of the look, display and body clearly apart?
4. Is the accent rare, and does each color have a role?
5. Which default in section 3 is it closest to? If a similar brief would get the same screen, it
   isn't done. Where is its one real risk?
6. What is the one accessory to remove?
7. The floor: works from 360 px, focus visible, reduced motion respected, contrast AA, and in a
   Hebrew product no Latin fallback font in Hebrew text.

The main agent runs all seven on the first direction. A variant subagent runs 1, 5 and 7 on its
own variant; the critic covers the rest.

## 10. The critic

Once every direction is built, one subagent with fresh eyes reviews them all, so the work isn't
only graded by whoever made it. Start it with:

- the paths of this file, `.proto/briefs/<slug>.json`, the contact sheet and each variant's
  `-desktop.png` and `-mobile.png` (it reads images; it edits nothing and runs no `proto`
  command other than `proto shoot` with `--session`);
- the job: for each direction, the three changes that would most raise it, most important first,
  each naming the element and the change (not "improve hierarchy" but "the price is the focal
  point; the headline at 64 px competes with it, take it to 40"); which direction plays it too
  safe in the look and what its risk could be; which one asks the user to learn something new to
  do the main thing, and how to make it plain; any two directions that are too close; which defaults from
  section 3 it sees;
- a score per direction from 1 to 10 on two things: **distinctive** (would a design lead
  remember it tomorrow, or could it be any product's page) and **right for the subject** (with a
  brand: unmistakably that brand, from the logo, name, voice and key color alone);
- a reply of at most four lines per direction.

A direction under 7 on distinctive gets a bolder risk, rebuilt from its plan, not polish.
Apply what it found, skipping only what contradicts the plan or the user's request (say which),
then go on with the defect rounds. Without subagents, do the same review yourself from the sheet
and the single shots, as a separate pass.
