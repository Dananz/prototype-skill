# Motion (useMotion)

Part of the prototype skill: SKILL.md links here, and `proto` is the command SKILL.md defines.

**Let the motion be reviewed.** When the request is about motion (how a sheet opens, a list
enters, a toast lands, the feel of a spring), call `useMotion` from `src/motion.ts` once, in the
variant's own component. The page then offers Motion (a curves button beside Comment, or Motion in
the pill's menu on a phone), which docks a slim bar under the design: play, the time, a slider to
scrub forward and back, the curves of every animation, speed and loop, and comments on a moment or
a range, which reach you like any comment (below). The design makes room for it; it is never
covered. Until the user turns it on the design runs live and nothing is recorded, so when you add
`useMotion`, tell them where to find it.

```
import { useMotion } from '../../motion'

useMotion({
  start: () => setOpen(true),      // runs the sequence from rest (a tap on Checkout)
  reset: () => setOpen(false),     // puts the design back at rest; optional
  moments: [{ label: 'Overshoot', at: 350 }, { label: 'Toast', at: 1250 }],  // ms into the take, for Go to; optional
})
```

- Without `start`, the sequence is the design's entrance; without `reset`, the page mounts the
  design again before each run. Vue: the same call in `<script setup>`.
- The dock records a take through the browser's own animation API, so **write the motion in CSS
  transitions, CSS keyframes or `element.animate()`**: a spring as a `linear()` easing sampled from
  its curve, a stagger as delays. Motion run from script (a `requestAnimationFrame` loop,
  react-spring, GSAP's core, Framer Motion's JS springs) can't be recorded; the dock says the take
  caught no motion. DOM changes that aren't animated (an element added, a class swapped without a
  transition) show their final state at every moment of the take. An animation whose speed changes
  while it runs (`updatePlaybackRate()`, `playbackRate` set midway) is drawn at its last speed for
  the whole take: write a change of pace into its easing or keyframes instead.
- **Waits go in delays, not `setTimeout`.** A take's 0 is when its first part starts, and it ends
  once nothing has moved for 0.5 s. A step that a `setTimeout` starts later than that is missed and
  runs live over the held take (the dock and `proto shoot` say so). Write each wait as a
  `transition-delay`, an `animation-delay` or `element.animate`'s `delay`, or start the next step
  within 0.5 s of the last one ending. A take is at most 20 s.
- `start()` (and `reset()`) must not throw: the dock and `proto shoot` print the error, and the
  take is empty.
- Name the moving parts with `data-shoot`: the curves are labelled by it.
- Motion the design renders on `<body>` through a portal (a sheet, a toast) is recorded too, but
  it covers the dock there: give the portal a `container` in the variant (above).
- Pressing anything in the design lets it run live; the dock's next move takes it back. An edit
  to the variant records the take again.

You can't watch motion, so read it in frames. A plain shot of a variant with `useMotion` shows it
before `start`. `--at` and `--frames` record its take from rest, the way the dock does, then shoot
those moments: `--at 350` writes `<slug>-<letter>-desktop-at-350.png` (and `-mobile-`), `--frames 12`
writes `<slug>-<letter>-frames.png`, the moments in order with their times, cut to where the motion
happens, and every animation's curve under them on the same clock. Read the frames sheet whenever
you write or change motion: an overshoot, a stagger's rhythm, something landing early all show
there.

**A comment on the motion** (written in the motion dock, under a variant with `useMotion`) is on a
moment or a range of its take rather than an element: its `at:` is a time, `at: 0.35 s` or
`at: 0.30–0.62 s`, with the take's length and the shoot that shows it. Run that shoot (`--at 350`,
or `--frames 8 --at 300-620` for a range) and read it, change the motion, shoot it again to see the
change landed, and reply with the new timing in numbers ("damping 0.75 now: the sheet overshoots
4 px instead of 14 and settles by 0.50 s"). The page records the take again after your edit, and
the reply shows on the comment's point on the slider.
