# Building one direction (for a subagent)

You build one variant of a prototype in a live app the user is watching. Your prompt gave you:
your letter, the app's folder, the brief's path (`.proto/briefs/<slug>.json`: your one-line plan
under `directions.<letter>`, the facts every direction shares, and any must-dos), the flags for
every `proto` call (`--session <id>`, and `--project <root>` when given), and for an existing
product, the reference screenshots and `A.tsx` to start from. `proto` is
`node "<resolved-skill-dir>/scripts/proto.mjs"`, using the absolute path from your prompt. Everything else is here.

When the brief has a `"brand"`, craft.md section 1 says how it binds you: its logo files in
`src/assets/brand/` imported as they are, its name, voice and one moment of its key color; your
surface, palette, type and risk are still your own line's.

## First write: your hero, on screen

Your first write is `src/protos/<slug>/<letter>.tsx` itself: the top of the page at rest, final,
straight from your line. Its display and body faces through `font()` (`src/fonts.ts`), its
colors, its signature, the real copy from the facts, the brand's logo when there is one. Where
an image goes, a drawn shape. No
helper file, no reading of `craft.md` in full and no reading of `node_modules` before it. It
replaces your placeholder the moment you save it.

## Then: plan, build, finish

1. Read `craft.md` (next to this file) and take its stance. Write your full plan to
   `.proto/briefs/<slug>-<letter>.md` (craft.md, section 3, including the check against a
   similar prompt). Build from it exactly, deriving every color and type decision from it.
2. **Sections**, one edit each, top to bottom: the rest of the content, the main interaction.
   Every save must render: write each pass whole (no half-written JSX), and import only files
   that already exist. A helper of your own (lowercase, `c-map.tsx`) only once the variant
   file imports something that exists.
3. **Finish:** states, motion, details. Shoot only your own variant
   (`proto shoot <slug>/<letter>`), read both single shots at full size, run craft.md's short
   craft check (questions 1, 5 and 7) on them, fix, and shoot again. Where you rebuild
   something that has a reference, loop on `proto compare`. Then `proto done <slug>/<letter>`.

## Images

The main agent generates them (in the background when supported) into `src/assets/`, named
`<slug>-<letter>-<what>` (`kiosk-B-hero.jpg`). Use them through `image()` from `src/images.ts`:
`image('kiosk-B-hero')` is the URL once the file exists and `undefined` until then, so draw a
shape in its place meanwhile. The page swaps the image in by itself when it lands; don't wait
for it, poll for it or generate images yourself. When your direction needs an image the main
agent didn't list, name it in your reply (what, and which existing asset or style guide in
`src/assets/style/` it should follow). A layered parallax hero: `references/images.md`, section 4.

```tsx
import { image } from '../../images'
const hero = image('kiosk-B-hero')
{hero ? <img src={hero} alt="…" className="…" /> : <div className="… bg-[#e8c48a]" />}
```

## Limits

- You write only `src/protos/<slug>/<letter>.tsx`, your own lowercase helpers and your full plan
  (`.proto/briefs/<slug>-<letter>.md`). `parts.tsx`,
  `meta.ts`, `theme.css` and the other variants are read-only, and you install nothing; ask for
  those in your reply.
- Every `proto` call carries the flags from your prompt. Never `proto up`, `add`, `pick` or `work`.
- Reply in at most five lines: what you built, its weakest point, and which default from
  craft.md it is closest to.
