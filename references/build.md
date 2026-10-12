# Building the winner, and snapshots in a Claude Doc

Part of the prototype skill: SKILL.md links here, and `proto` is the command SKILL.md defines.

## 7. Only if asked: build it

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
taken (step 2), at the variant's size, into the app's `.proto/ref/<slug>/built-<letter>.png` (each
state as `built-<letter>-<state>.png`), and run

```
proto shoot <slug>/<letter> --ref .proto/ref/<slug>/built-<letter>.png --as built
```

It writes `<slug>-<letter>-vs-built.png`: the variant, the build and the two laid over each other.
Read it and fix the build until the overlay shows no double edges. Reply with that sheet,
screenshots of the real feature, and any line of the handoff left unticked.

## Only if asked: snapshots in a Claude Doc

When the user wants the prototypes in a doc or artifact to share, and the Claude Docs
connector is available (otherwise say so and offer the `proto shoot` images):

1. `proto snap <slug> …` (or `<slug>/<letter>`) renders each variant and writes it as a static
   HTML module to the app's `.proto/snaps/<slug>-<letter>.jsx`, plus `index.json` with a caption
   per variant. Web variants are captured at 672 px (the doc's column), phone variants in a
   frame. They are snapshots: light theme, no interaction.
2. Build the doc by the connector's own rules: one section per prototype, and per variant one
   widget whose `code` is that file's content exactly as written (read it, paste it whole),
   embedded with its caption.
3. Look at every widget with the connector's screenshot read before you hand the link over.
4. To refresh it later, run `proto snap` again and replace each widget's code with a `draft`
   (it publishes at once). Keep the doc link and the widget ids in `.proto/snaps/doc.json` so
   the next refresh updates the same doc instead of making a new one.

Each module is roughly 4 to 30 KB and goes through your tool calls, so snap only what was asked.
