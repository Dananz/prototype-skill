# Right to left (Hebrew, Arabic, Persian, Urdu)

Part of the prototype skill: SKILL.md links here, and `proto` is the command SKILL.md defines.

When the product reads right to left, every variant (Current and new designs alike) is built
right to left from its first line. Never draw it left to right and flip it, and never copy a
screenshot's pixel positions: RTL layout comes from the flow, not from coordinates.

- **Direction.** `dir="rtl"` and `lang` (`he`, `ar`, …) on each variant's root. Everything
  inside inherits it; set `dir` again only on an LTR island.
- **Logical sides only.** `ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`, `text-start`/`text-end`,
  `rounded-s`/`rounded-e`, `border-s`/`border-e`; rows and grids already begin at the right.
  Never `ml`/`mr`/`pl`/`pr`/`left`/`right`/`text-left`/`text-right`, in classes or styles. Measure
  sizes and gaps off the screenshot and let the flow place them. Center with
  `left-1/2 -translate-x-1/2` (`start-1/2` with a translate goes wrong: translate is physical).
  Anything that really depends on the side (a scrim behind start-aligned text, a slide-in, a
  translate) gets both versions: `ltr:bg-linear-to-r rtl:bg-linear-to-l`.
- **What mirrors.** Reading order: the first tab, step, crumb, chip and carousel page sit at
  the right, and carousels start from their right end. Back points right and forward points
  left; `‹` is drill-in. Progress bars, sliders and rings fill from the right. A pushed page
  enters from the left, swipe back starts at the right edge, and a side drawer opens from the
  side its button is on. Icons that show a direction
  (arrows, chevrons, send, reply, undo/redo, trend charts, text alignment) flip with
  `rtl:-scale-x-100`.
- **What doesn't mirror (LTR islands).** Numbers joined by symbols (`0/10`, `3.1K`, `+2`,
  `4–10`), times, phone numbers, Latin names, code, URLs, emails, media controls (play, seek), clocks,
  checkmarks, logos, and a device's own status bar when the device's language reads LTR
  (follow the reference). Wrap an LTR run inside a sentence in
  `<bdi>` or `<span dir="ltr">` so punctuation and the words around it stay put. A plain number
  (`22.5`, `1,250`) needs no wrapper. Where the project writes ranges, units or dates its own
  way in its locale files (`8 עד 10 חזרות`), that wins over a symbol.
- **Type.** The project's own font for that script (a new product: `proto fonts --draw <n> --hebrew`,
  craft.md section 5); confirm it has the glyphs, because a
  missing one falls back silently and changes every width. No letter-spacing or italics the app
  doesn't ship (Hebrew has no italics, spacing breaks Arabic joining), no `uppercase`. Arabic
  needs more line height than Latin. Truncation puts the ellipsis on the left; check what's cut.
- **Copy.** Real copy in the product's language, from the project's locale files where the
  string exists. New strings follow the project's rules (gender, register, punctuation). Never
  English placeholder text in an RTL screen.
- **Check.** `proto shoot` lists every physical side in an RTL prototype's files (margins,
  padding, insets, text alignment, corners, borders, gradients, translates, transform origins,
  image positions), skipping anything nested under a `dir="ltr"` element, centring, and classes
  chosen per direction (`rtl:…`). Each one it lists is a bug. It can't see an icon that should
  have flipped; check those in the shots. In every shot, check that text is ragged on the
  left, that numbers and Latin words sit right inside Hebrew lines, and that arrows point the
  way they go. A product that also ships LTR: flip the root's `dir` once and check the variant
  mirrors cleanly.
