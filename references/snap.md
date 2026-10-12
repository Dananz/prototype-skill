# Snapshots in a Claude Doc

Read when the user wants the prototypes in a doc or artifact to share.

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
