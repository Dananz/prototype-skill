# Copy options (useCopy)

Part of the prototype skill: SKILL.md links here, and `proto` is the command SKILL.md defines.

**Offer other copy when asked.** When the user asks for other words ("better headlines", "try other
button text") or sends `action: copy-options` from the page, don't write a variant per wording: give the lines they asked about options with
`useCopy` from `src/copy.ts`, in the variant being worked on. The page then shows a T button beside
Comment (on a phone, Copy options in the pill's menu); in copy mode each of those lines is marked, a click lists its options and points one into
place, and the user sends the choices back (`action: copy`, below). A variant without `useCopy` shows
none of it.

```
import { useCopy } from '../../copy'

const copy = useCopy([
  { id: 'headline', label: 'Headline', options: ['עוד אימון מאחוריך', 'עשית את זה', 'עוד צעד אל היעד'] },
  { id: 'cta', label: 'Button', options: ['לסיכום האימון', 'סיימתי'] },
])
<h1 data-copy="headline">{copy.headline}</h1>
<button data-copy="cta">{copy.cta}</button>
```

- The first option is the line as it reads today; then 2 to 4 others. Only the lines they asked
  about, never every string on the screen. A page request without a note means the headline and
  primary supporting text/CTA. Preserve the design and its current words until they choose.
- Real copy in the product's language and rules (its locale files, gender, register, length), the
  same as any copy in a variant.
- `useCopy` returns the words to show per line (the user's pick, or the first option). Put
  `data-copy="<id>"` on the element that holds those words, so the page can mark it.
- Call it in the component that shows the lines: each component may declare its own (the variant
  its headline, a part in `parts.tsx` its button), and the page counts them all as the design's.
  A part used more than once with different words (a card per plan) needs an id per use
  (`plan-${id}-title`): one id is one line, with one set of options.
- Vue: `const copy = useCopy([...])` in `<script setup>`, then `{{ copy.headline }}`.
