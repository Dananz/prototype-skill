# Try it: say what to type and try

Read on an explicit request in chat or an `action: try-it` from the page.

**Only on request: say what to type and try.** After an explicit request in chat or
`action: try-it` from the page, when getting through a variant takes something a reviewer can't
guess (a login, a code, a search that returns results), or it has scenarios, outside events or
limits worth knowing, report them with `useHints` from `src/hints.ts`, once, in the variant's
component. The page shows them in a Try it panel beside the design (on a phone, a sheet from Try it
in the pill's menu), where each value copies with a click and Fill in types them into the design's
fields; `proto shoot` leaves the panel out.

```
import { useHints } from '../../hints'

useHints([
  { kind: 'value', label: 'Email', value: 'mira@arc.audio', fill: 'input[type=email]' },
  { kind: 'value', label: '2FA code', value: () => codeNow(), fill: 'input[inputmode=numeric]', note: 'changes every 30 s' },
  { kind: 'try', text: 'Lock the account: 5 wrong passwords', done: misses >= 5, at: '[data-shoot=sign-in]' },
  { kind: 'try', text: 'Drag a mix onto the queue', done: queued, at: '[data-shoot=mix]', to: '[data-shoot=queue]' },
  { kind: 'switch', label: 'Scenario', options: ['Few', 'Empty', 'Busy', 'Can’t load'], value: scenario, set: setScenario },
  { kind: 'event', label: 'A new mix arrives', run: addMix },
  { kind: 'caveat', text: 'Audio doesn’t play in the prototype.' },
])
```

- Report what applies now, from the variant's own state: the values for the step on screen, and
  `done` once a thing to try has happened. The panel follows along.
- `fill` is a selector inside the variant; a function `value` is read every second.
- **Give each thing to try its spot.** Pointing at it in the panel (or tapping it on a phone)
  dims the design except where it happens, with a label: `at` is where you start, `to` where a
  drag ends. `act` says what you do there, `click` unless `to` makes it a `drag`; also
  `right-click`, `hover` and `type`. `label` replaces the act's word (`Type “rain”`, `Any of
  these`). `key: '⌘ K'` shows the keys to press, with or without a spot. `all: true` lights every
  match of `at`. A thing done in order (open a menu, then pick in it) is `steps: [{ at, label },
  …]`: the light moves to the last step on the page. Selectors are the same `data-shoot`
  attributes as states. A spot scrolled out of view is scrolled to; one that isn't on the page
  says so in the panel.
- Made-up demo data only, never real credentials: the page is served on the tailnet.
- A scenario switch is for the same design with other data (empty, busy, an error, a first
  visit); a different design is a variant.
- Vue: `useHints(() => [...])` in `<script setup>`. A variant with nothing to say makes no call.
