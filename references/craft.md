# Craft: designs that look made, not generated

Read before the first variant of a prototype, and paste it whole into every variant subagent's
brief. Adapted from Anthropic's `frontend-design` skill (Apache 2.0) and the house rules below.

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
music tool from a mixing desk. Use real content from that world everywhere, never filler.

## 2. A plan per direction, before code

Write it to `.proto/briefs/<slug>.md` in the app's folder, one section per direction:

```
## B · Tide table
Concept:   one line, what it is and why it fits this subject
Palette:   4-6 named hex values by role: surface, ink, muted, accent (+ one support)
Type:      display face (used with restraint), body face, utility face for numbers if needed;
           the scale (e.g. 64 / 20 / 15 / 12) and weights
Layout:    one sentence, plus an ASCII wireframe of the screen at rest
Signature: the one thing this direction will be remembered by
Imagery:   what fills the visual space (photo, generated image, drawn shapes, data, none)
Motion:    the one moment that moves (an entrance, a state change), or none
```

Then review the plan against section 3 before writing a line: any part that reads like what you
would make for any similar brief gets revised, and the plan says what changed. Directions in one
prototype never share a palette and a type pairing; with a Current they differ in structure, and
in look only when the direction is about the look.

## 3. The defaults to steer away from

These appear regardless of subject, so they read as generated. Each is fine when the brief asks
for it; none is a choice when the brief leaves that axis free.

- **Type:** Inter, Roboto, Arial, Open Sans or the system font as the display face; Space
  Grotesk and Fraunces as the "interesting" picks; one family at one weight for everything.
- **Color:** a purple or blue-violet gradient on white; a warm cream background (near `#F4F1EA`)
  with a high-contrast serif and a terracotta accent; near-black with one acid green or vermilion
  accent; every color used evenly so nothing leads.
- **Layout:** the SaaS card kit (three icon cards in a row, a big number with a small label and a
  gradient accent); a broadsheet with hairline rules and zero radius; a centred hero with two
  buttons over a gradient blob; cards with a colored left border.
- **Details:** a tracked all-caps eyebrow over every heading; `→` appended to every link and
  button; 01 / 02 / 03 markers on content that isn't a sequence; emoji as icons; glass on every
  surface; a shadow and a hover lift on every card.
- **Motion:** a fade-and-slide-up on every section and a hover transition on every card.

## 4. House taste

- **Restrained over playful.** One subject, calm motion. Busy, cute visuals read childish. Spend
  boldness in one place (the signature) and keep everything around it quiet. Before finishing,
  remove one accessory.
- **Dark done properly** where it fits the subject: layered near-blacks with real separation, not
  one flat `#000`, and an accent that is rare.
- **Concentric corners:** an inner radius is at most the outer radius minus the padding between.
- **Quiet utility chrome:** share, clear, settings and locale are 32-36 px icon buttons or text
  links, never pill buttons that compete with the primary action.
- **Plain words on things you can touch** over raw numbers; exact values behind a toggle.
- **Icons** from Phosphor (installed), one weight per design. Never an emoji or a text glyph.
- **Drawers, dialogs, popovers** from Base UI (installed), with a `container` in the variant.
- **Tailwind classes** for styling; inline styles only for computed values.

## 5. Type and color mechanics

The font kit is installed in new sessions; import the ones you use in the variant (an older
session without them: `pnpm add --ignore-workspace` in the app's folder before writing variants).

| Package (`import '…'`) | Family | Good for |
|---|---|---|
| `@fontsource-variable/bricolage-grotesque` | `'Bricolage Grotesque Variable'` | characterful display, optical sizes |
| `@fontsource-variable/newsreader` | `'Newsreader Variable'` | editorial serif display and long reading |
| `@fontsource-variable/hanken-grotesk` | `'Hanken Grotesk Variable'` | warm, legible body |
| `@fontsource-variable/geist` | `'Geist Variable'` | precise product UI body |
| `@fontsource-variable/geist-mono` | `'Geist Mono Variable'` | numbers, data, captions |
| `@fontsource-variable/rubik` | `'Rubik Variable'` | Hebrew-capable sans, softly rounded |
| `@fontsource-variable/frank-ruhl-libre` | `'Frank Ruhl Libre Variable'` | Hebrew serif display |

Another family is fine when the subject calls for it (`pnpm add @fontsource-variable/<name>`);
say why in the plan. Set the families on the variant's root (`font-[…]` or a class), never in
`@theme`, which restyles the shell.

- **Contrast you can see:** display at least 2.5 to 3 times the body size, or a clear weight
  jump (300 against 700). A scale of four or five steps, used consistently.
- **Numbers** in tables, prices and timers use `tabular-nums`.
- **Palette by role:** one dominant surface, ink, a muted tone, one accent used rarely. Text on
  any surface passes WCAG AA.

## 6. Imagery and depth

An empty gray box where an image goes makes everything around it look unfinished. In order of
preference: the project's own images; a generated image when an image tool is available (a
backdrop, a product shot, a texture), saved into the app's `src/assets/`; then drawing from the
subject in code (SVG shapes, a chart, a map, a gradient with grain). Depth comes from layering
and light, not from a shadow on everything.

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

Run it on each direction's single shots at full size (`proto shoot <slug>/<letter>`, then read
`-desktop.png` and `-mobile.png`), before the defect rounds. The contact sheet is too small for
this. Answer each in a word, and fix every no:

1. Is the signature visible at first glance, on desktop and phone?
2. Is there one focal point per screen, and does the eye land there first?
3. Do display and body type differ clearly, and is the type itself part of the look?
4. Is the accent rare, and does each color have a role?
5. Which default in section 3 is it closest to? If a similar brief would get the same screen, it
   isn't done.
6. What is the one accessory to remove?
7. The floor: works from 360 px, focus visible, reduced motion respected, contrast AA.
