# Build it

Read when the user asks to implement the picked variant.

When the request says to implement the winner (the picked variant), start with

```
proto handoff <slug>/<letter>
```

It lists everything the variant has, each with its file and line: its files, states, marked
elements, motion, materials, interactions, assets, copy, copy options (the build ships each line's
first option as plain copy, without the options or the picker) and where its Try it list and
`useMotion` call are. A build loses what nobody listed (a drag's tilt, the shade behind a sheet, a
glass material), so put every line on your task list and tick it as the build gets it, or say why
it doesn't apply. `useMotion` is the page's own and the build drops it; the motion it reviewed, its
durations, delays and easings, is what ships.

Build it in the real codebase with the project's own components and patterns; the variant file is
a starting point, not a paste. Then screenshot the built screen the way Current's references were
taken (SKILL.md step 2), at the variant's size, into the app's `.proto/ref/<slug>/built-<letter>.png` (each
state as `built-<letter>-<state>.png`), and run

```
proto shoot <slug>/<letter> --ref .proto/ref/<slug>/built-<letter>.png --as built
```

It writes `<slug>-<letter>-vs-built.png`: the variant, the build and the two laid over each other.
Read it and fix the build until the overlay shows no double edges. Reply with that sheet,
screenshots of the real feature, and any line of the handoff left unticked.
