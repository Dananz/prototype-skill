# README demos

Source for the animated GIFs in the top-level README
(`docs/images/demo-variants-*.gif`, `docs/images/demo-comments-*.gif`).
They are faux UI built with the [Stageshow](https://github.com/benjitaylor/skills/tree/main/stageshow)
kit: authored illustrations of the shell, not recordings of the live app.

## Re-film

1. Copy the Stageshow skill folder somewhere writable (a real copy, not a symlink),
   then `npm install` and `npm i @phosphor-icons/react@2.1.7` there.
2. Copy `proto-variants/` and `proto-comments/` into its `examples/`, and copy
   `app/share/card/GoogleSans-Regular.ttf` and `GoogleSans-SemiBold.ttf` into
   `examples/proto-variants/`.
3. Copy `record.mjs` into its `scripts/`, and add a `?record=<name>` route at the top
   of `boot()` in `playground/main.tsx`, so the scene runs on a virtual clock that
   only moves when the recorder steps it:

   ```ts
   if (params.has('record')) {
     installVirtualClock({ fps: Number(params.get('fps') ?? 30), epoch: 0 })
     const { mount } = await import('./preview')
     await mount(params.get('record')!, false)
     ;(window as any).__recordReady = true
     return
   }
   ```
4. Start the preview on a fixed port:
   `node node_modules/vite/bin/vite.js playground --config playground/vite.config.ts --port 5193`
5. Record one steady-state loop per theme, starting and ending on the `poster`
   mark (so the GIF's first frame, which GitHub shows when animation is paused,
   is the finished state), and encode:

   ```sh
   node scripts/record.mjs proto-variants --fps 25 --ms 24000 --warm --from poster --until poster --theme light --out frames/v-light
   ffmpeg -framerate 25 -i frames/v-light/f%04d.png -vf "scale=1600:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle" demo-variants-light.gif
   ```

   Repeat with `--theme dark`, and for `proto-comments`.

## Rehearsal notes

- Started from Stageshow's `hero-demo` (terminal satellite, named targets);
  `proto-comments` reuses the variants shell and the checkout designs.
- `film.mjs --gate` passes on both. Deliberate lines it still prints: the reset is
  a 450ms dip to the ground (near-empty frames), and Swap labels report
  "vanishes with no exit" (they crossfade in the kit).
- Not checked: a compact phone-width design (a README image has one width),
  reduced motion, hover play. The shell is simplified: the sidebar's two-column
  Prototypes list, the states list and the panel's controls are left out.

`?capture=<name>` with Stageshow's `scripts/film.mjs` gives contact sheets and its
framing and motion checks while you edit.
