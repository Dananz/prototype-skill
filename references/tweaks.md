# Tweaks

A variant declares its useful quick controls. The shell shows them in the desktop review
panel’s Tweaks tab and directly in the mobile dock. The mobile button opens a drawer above
the dock; View preview, Escape and a downward swipe dismiss it. Values stay in the design’s
own state while it is mounted. Changing variants shows only that variant’s controls.

Use one `useTweaks` call per variant, with unique stable IDs. Controls appear in the order
you declare them. `defaultValue` is the explicit starting value, used by Reset. A control
uses its latest setter, including in device views. Do not register controls that the design
cannot apply, or use a theme control to change the shell’s own appearance.

```tsx
import { useState } from 'react'
import { useTweaks } from '../../tweaks'

export default function Variant() {
  const [accent, setAccent] = useState('#4f46e5')
  const [state, setState] = useState('Full')
  const [longText, setLongText] = useState(false)
  useTweaks([
    { id: 'accent', kind: 'color', label: 'Accent color', value: accent,
      defaultValue: '#4f46e5', set: setAccent },
    { id: 'state', kind: 'select', label: 'Content state', value: state,
      defaultValue: 'Full', options: ['Full', 'Empty', 'Loading', 'Error'], set: setState },
    { id: 'long-text', kind: 'toggle', label: 'Long text', value: longText,
      defaultValue: false, note: 'Check wrapping and overflow', set: setLongText },
  ])
  // Use accent, state and longText in the design’s existing rendering and behavior.
  return <div style={{ color: accent }}>{state === 'Empty' ? 'Nothing here yet' : longText ? 'A much longer project name to check wrapping' : 'Your project'}</div>
}
```

A color is a six-digit hex string. It may provide `presets: [{ name: 'Forest',
value: '#047857' }]`; otherwise the shell offers five starting colors and a custom picker.
A select has string `options`; short sets are segmented, longer sets use a list with previous
and next around it, a counter and a track of dots, and the arrow keys step it while Tweaks is
open (the select used last, else the first long one). The Tweaks button shows a dot whenever
the design has tweaks, and the number changed once any are. A
toggle has a boolean value and renders as an on/off switch. Any control may include a short
`note`.

Useful cases: content state, light/dark design appearance, compact/comfortable density,
editor/viewer access, long copy, or a feature being enabled. Implement the meaningful
behavior first, then expose its values. Essential flows still work without opening Tweaks.

Choose controls that answer a review question within the current design. Different layouts
or interaction approaches belong in separate variants. Do not add a control just because
its type is available, or add theme controls when appearance is not being evaluated.

| Prototype | Useful controls, when those behaviors are implemented |
| --- | --- |
| Project list | Full / Empty / Loading / Error, long names, editor / viewer |
| Checkout | Valid / invalid form, discount applied, payment failure |
| Static composition study | Often none |

Before finishing, exercise each control and its reset on desktop and mobile. Confirm it
changes the actual preview, each reset restores its declared default, and the mobile dock
opens the controls in a drawer.

In Vue, use refs and a function so declarations update reactively:

```ts
const accent = ref('#4f46e5')
useTweaks(() => [
  { id: 'accent', kind: 'color', label: 'Accent color', value: accent.value,
    defaultValue: '#4f46e5', set: value => { accent.value = value } },
])
```

Unregistering happens automatically when the variant unmounts. Tweaks does not save design
edits to source files or persist arbitrary values across reloads. A comment written on the
variant carries the tweaks changed from their defaults at that moment: `proto inbox` prints them
as its `tweaks:` line and `proto shoot --pin` sets them before the shot. They describe what the
user saw; a value becomes the variant's default only when a comment asks for that.

## Options on the design

A control that offers options for one element (Small changes stay in place, in SKILL.md) is also
tried on that element: put `data-tweak="<id>"` on it. The page marks it with a small dot at its top
corner; hovering the element outlines and names it, and a click on the dot opens a panel beside it
with a picture of the element for each option (drawn from the design itself), the current one marked
Now. Pointing at a picture shows it on the design, a click keeps it, and the panel stays open to
compare; a click on the element itself does the same when it is no link, button or field of its
own. Shift-click on the dot steps to the next option without opening anything. Hold Original
(or `\`) to see the design as it was. What changed waits in the comments island and goes to the
agent in one Send, one `option` comment per value (`copy` for words), for it to make that the
element's value and take the control out.

A `select` and a `color` with two or more `presets` (today's value counts as one) qualify, and a
`toggle` reads as Shown and Hidden. A line of copy (`useCopy`, `data-copy`) on the same element
becomes a Words tab beside the control: list both ids, space-separated, for two controls on one
element. Several elements carrying the same id are one spot and change together (a label in every
row; each row on its own needs a control per row). Dots never show in a share, a shot (unless
`proto shoot --options`), a tool, or side by side.

Three or more such elements the user has not opened yet make a round of decisions: a row on the
comments island offers to walk them one by one (a step per control, its label as the question:
"Which row icon?"), ending in a summary with Send. `data-round` on any element of the variant
offers it whatever the count, `data-round="off"` never; it never shows in a shot, even with
`--options`.

```tsx
<span data-tweak="row-icon">{icons[icon]}</span>
<h1 data-copy="headline" data-tweak="headline-size" className={SIZES[size]}>{copy.headline}</h1>
```
