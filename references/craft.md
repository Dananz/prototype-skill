# Craft: designs that look made, not generated

Read before the first variant of a prototype. Variant subagents and the critic read it too, by
its path (don't paste it into a brief). Adapted from Anthropic's `frontend-design` skill
(Apache 2.0) and the house rules below.

**Where it applies.** Everywhere a look is being chosen: a new product with nothing shipping
yet, a direction that is about the look, a "go wild" request. With a Current, Current's look
wins: a direction keeps its palette, type and chrome unless the direction is about them, and
this file still governs how well the new parts are made (hierarchy, spacing, type, motion).

Without direction, a model samples from the middle of everything it has seen, and the middle is
what reads as generated. Every rule below is a way out of the middle.

## 1. Ground it in the subject

Before any design, name the product's subject, who uses it, and the screen's single job. When
the request doesn't pin these down, pin them yourself and say so in the plan. The subject's own
world (its materials, instruments, artifacts, places, vernacular) is where distinctive choices
come from: a sailing app can take its palette from a chart and its numbers from a logbook; a
bakery from its trays, paper bags and price board. Use real content from that world everywhere,
never filler.

## 2. A plan per direction, before code

Start the type from a draw: `proto fonts --draw <number of directions>` (add `--hebrew` for a
Hebrew product) prints that many pairings at random, no family twice. Take one per direction,
or replace one with another Google Font the subject calls for (section 5). Then write the plans
to `.proto/briefs/<slug>.md` in the app's folder, one section per direction:

```
## B · Tide table
Concept:   one line, what it is and why it fits this subject
Palette:   4-6 named hex values by role: surface, ink, muted, accent (+ one support)
Type:      display, body, utility for numbers if needed, as font('…') specs; the scale
           (e.g. 64 / 20 / 15 / 12) and weights
Layout:    one sentence, plus an ASCII wireframe of the screen at rest
Pattern:   how the main action works (a sticky bar, a form in the hero, a picker, a drawer)
Signature: the one thing this direction will be remembered by
Imagery:   what fills the visual space (photo, generated image, drawn shapes, data, none)
Motion:    the one moment that moves (an entrance, a state change), or none
Volume:    quiet or loud (section 4)
```

Then review the plans before writing a line:

- **Against the defaults** (section 3): any part that reads like what you would make for any
  similar brief gets revised, and the plan says what changed.
- **Against each other.** No two directions share a font family, a dominant surface color, a
  signature or a pattern for the main action, unless the feature itself requires it (shared
  facts like the business name, address and prices are fine; a shared bottom order bar in every
  direction is not). With a Current, directions differ in structure, and in look only when the
  direction is about the look.
- **Volume:** at most one loud direction per prototype (section 4).

## 3. The defaults to steer away from

These appear regardless of subject, so they read as generated. Each is fine when the brief asks
for it; none is a choice when the brief leaves that axis free.

- **Type:** Inter, Roboto, Arial, Open Sans or the system font as the display face; Space
  Grotesk, Fraunces and Instrument Serif as the "interesting" picks; one family at one weight for
  everything; the same few faces in every direction and every session (a house style is a
  default too, which is what the random draw is for).
- **Color:** a purple or blue-violet gradient on white; a warm cream background (near `#F4F1EA`)
  with a high-contrast serif and a terracotta accent; near-black with one acid green or vermilion
  accent; every color used evenly so nothing leads.
- **Layout:** the SaaS card kit (three icon cards in a row, a big number with a small label and a
  gradient accent); a broadsheet with hairline rules and zero radius; a centred hero with two
  buttons over a gradient blob; cards with a colored left border; the same sticky bottom bar in
  every direction.
- **Details:** a tracked all-caps eyebrow over every heading; `→` appended to every link and
  button; 01 / 02 / 03 markers on content that isn't a sequence; emoji as icons; glass on every
  surface; a shadow and a hover lift on every card.
- **Motion:** a fade-and-slide-up on every section and a hover transition on every card.

## 4. House taste

- **Restrained over playful.** One subject, calm motion. Busy, cute visuals read childish. Spend
  boldness in one place (the signature) and keep everything around it quiet. Before finishing,
  remove one accessory.
- **One loud direction at most.** In a prototype, at most one direction is loud (saturated
  color everywhere, a costume of the subject like a drawn shopfront, novelty type). The rest are
  quiet and premium: distinct through type, composition and one signature, not through volume.
- **Dark done properly** where it fits the subject: layered near-blacks with real separation, not
  one flat `#000`, and an accent that is rare.
- **Concentric corners:** an inner radius is at most the outer radius minus the padding between.
- **Quiet utility chrome:** share, clear, settings and locale are 32-36 px icon buttons or text
  links, never pill buttons that compete with the primary action.
- **Plain words on things you can touch** over raw numbers; exact values behind a toggle.
- **Icons** from Phosphor (installed), one weight per design. Never an emoji or a text glyph.
- **Drawers, dialogs, popovers** from Base UI (installed), with a `container` in the variant.
- **Tailwind classes** for styling; inline styles only for computed values.

## 5. Type: the font kit

The font kit is three things:

1. **Every Google Font, with no install.** `font()` from `src/fonts.ts` adds a family to the page
   from Google Fonts (an install would reload the page). Call it at the top of the variant's
   module with the css2 spec of each family, then set the families with Tailwind, spaces as
   underscores (`font-['Karantina']`, `font-['Frank_Ruhl_Libre']`), on the variant's root and
   its headings, never in `@theme`, which restyles the shell:

   ```
   import { font } from '../../fonts'
   font('Karantina:wght@300;400;700', 'Assistant:wght@200..800')
   ```

2. **A catalog of pairings**, `references/fonts.json`: about 50 display, body and utility
   pairings by mood, each spec checked against Google Fonts, 20 of them Hebrew. `proto fonts`
   lists them (`--hebrew` for the Hebrew ones and every Google family that has Hebrew).
3. **A random draw**, `proto fonts --draw <n> [--hebrew] [--avoid <family,…>]`: n pairings, no
   family twice, so each direction starts from a different voice and two sessions with the same
   brief don't land on the same faces.

A family outside the catalog is fine when the subject calls for it: its spec is on its page at
fonts.google.com (a wrong weight in the spec fails the whole request; a family name alone gets
weight 400). Say why in the plan.

**Hebrew is a must** in a Hebrew product, and for Arabic the same with its script:

- Every face that sets text in the product's script supports it. Pick from `proto fonts --hebrew`;
  a Latin-only face falls back silently to a system font and changes every width.
- A Hebrew display face with character (Karantina, Suez One, Secular One, Gveret Levin, Frank
  Ruhl Libre, Bellefair, Rubik at 800 and up) carries the personality; a Hebrew body face
  (Assistant, Heebo, IBM Plex Sans Hebrew, Rubik, Miriam Libre) carries the reading.
- Latin brand names and numbers inside Hebrew use the same faces when they have Latin glyphs;
  the RTL rules in references/rtl.md (no letter-spacing, no italics, no uppercase) still hold.

Then the mechanics:

- **Contrast you can see:** display at least 2.5 to 3 times the body size, or a clear weight
  jump (300 against 700). A scale of four or five steps, used consistently.
- **Numbers** in tables, prices and timers use `tabular-nums`.
- **Palette by role:** one dominant surface, ink, a muted tone, one accent used rarely. Text on
  any surface passes WCAG AA.

## 6. Imagery and depth

An empty gray box where an image goes makes everything around it look unfinished. In order of
preference:

1. The project's own images.
2. **A generated image, only when an image tool is available** in this session (an image skill
   such as `codex-image`, or an image-generation MCP). Use it for photo-led subjects (food,
   places, products, people, interiors): one hero image and at most a few product shots per
   direction, saved into the app's `src/assets/`. Start the generation while you write the code,
   not before it, and never wait on it to deliver the first direction: drawn shapes first, the
   image swapped in when it lands. No tool available: skip this, don't ask.
3. Drawing from the subject in code: SVG shapes, a chart, a map, a gradient with grain.

Depth comes from layering and light, not from a shadow on everything.

## 7. Motion

One orchestrated moment lands harder than effects everywhere: a page-load sequence, the state
change at the heart of the feature, or ambient movement for an atmospheric subject. Less is often
more; extra animation is what makes a design feel generated. Respect `prefers-reduced-motion`.
`motion` (React: `motion/react`; Vue: `motion-v`) is installed for gestures and layout changes;
when the design calls `useMotion` (references/motion.md), write the motion in CSS or
`element.animate()` so it can be recorded.

## 8. Words

Words are material, not filler. Write from the user's side of the screen: name things by what
people control, not how the system is built. A control says what happens ("Save changes", not
"Submit"), and an action keeps its name through the flow (Publish, then "Published"). Errors say
what happened and how to fix it, without apologising; an empty state invites the next action.
Sentence case, plain verbs, no filler.

## 9. The craft check

On a direction's single shots at full size (`proto shoot <slug>/<letter>`, then read
`-desktop.png` and `-mobile.png`); the contact sheet is too small for it. Answer each in a word,
and fix every no:

1. Is the signature visible at first glance, on desktop and phone?
2. Is there one focal point per screen, and does the eye land there first?
3. Do display and body type differ clearly, and is the type itself part of the look?
4. Is the accent rare, and does each color have a role?
5. Which default in section 3 is it closest to? If a similar brief would get the same screen, it
   isn't done.
6. What is the one accessory to remove?
7. The floor: works from 360 px, focus visible, reduced motion respected, contrast AA, and in a
   Hebrew product no Latin fallback font in Hebrew text.

The main agent runs all seven on the first direction. A variant subagent runs 1, 5 and 7 on its
own variant; the critic covers the rest.

## 10. The critic

Once every direction is built, one subagent with fresh eyes reviews them all, so the work isn't
only graded by whoever made it. Start it with:

- the paths of this file, `.proto/briefs/<slug>.md`, the contact sheet and each variant's
  `-desktop.png` and `-mobile.png` (it reads images; it edits nothing and runs no `proto`
  command other than `proto shoot` with `--session`);
- the job: for each direction, the three changes that would most raise it, most important first,
  each naming the element and the change (not "improve hierarchy" but "the price is the focal
  point; the headline at 64 px competes with it, take it to 40"); then any two directions that
  are too close, and which defaults from section 3 it sees;
- a reply of at most four lines per direction.

Apply what it found, skipping only what contradicts the plan or the user's request (say which),
then go on with the defect rounds. Without subagents, do the same review yourself from the sheet
and the single shots, as a separate pass.
