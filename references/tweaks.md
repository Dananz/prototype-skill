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
A select has string `options`; short sets are segmented, longer sets use a dropdown. A
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
edits to source files or persist arbitrary values across reloads. For a lasting change,
tell the agent which values to apply to the variant. Live selections are not automatically
included in a comment or source-edit request.
