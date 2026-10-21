# Images

Read this before the first image of a session. The main agent makes every image; subagents name
what they need in their reply and never generate one.

## 1. The tool

`proto up` prints an `images:` line per case below. Follow what it says.

- **`codex-image` installed:** it is the image tool, for every generated image. When images would
  help but SKILL.md doesn't require them (the subject isn't photo-led, the project has some images),
  suggest it to the user in one line. Another image tool only when it is missing or fails; say
  which one you used.
- **Only the Codex CLI installed:** suggest installing `codex-image` once per session, with the
  command the line prints (`git clone https://github.com/Dananz/codex-image <skills folder>/codex-image`).
  Suggest only; never install it yourself.
- **Running inside Codex:** suggest making the prototype's assets (heroes, product shots,
  illustrations, textures) with the latest image model the host offers, named by its version, once
  per session, before plan step 5. Generate when the user agrees, or straight away when SKILL.md
  already requires images. Everything below holds for it too.

Follow the tool's own instructions for running it (`codex-image` takes one `--input` per reference
image, each one's role named in the prompt). Save outputs into the app's `src/assets/` as
`<slug>-<letter>-<what>` and use them through `image()` from `src/images.ts`.

## 2. Style comes from what exists

Before each generation request, search for the assets the new images will sit beside, in this order:

1. The kit's image style (`proto add --kit` prints `image style:` and copies it to `src/assets/style/`).
2. The project's own images, illustrations, icons and logos: asset folders, `public/`, `assets/`,
   store and design folders, docs.
3. The brand's assets (`src/assets/brand/`) and the kit's references (`.prototypes/_kits/`, `.proto/ref/`).
4. Images already generated in this session, and their style guides (`src/assets/style/`).

Read the ones you pick. Pass the best few as references, each with its role (style, palette,
lighting, subject), and write the prompt in their style: their light, palette, grain, framing and
illustration manner. A direction keeps the existing style unless its plan is about changing it.
A different style is the user's call: when they ask for one, follow it. Name the references you
used in the reply.

## 3. From scratch: a style guide per direction

When nothing above exists (a new product, no brand), the first images would set the style by
accident. Set it on purpose, before the first generation, one guide per direction:

`src/assets/style/<slug>-<letter>.md`

```md
# <Direction name>: image style
Medium: <photo, 3D render, flat illustration, collage …>
Light: <time of day, key and fill, hard or soft>
Palette: <4-6 hex values, which one dominates>
Lens and framing: <focal length, eye level, crop habits, negative space>
Texture: <grain, paper, gloss, noise>
Materials and props: <…>
People and objects: <how they are shown, or never>
Never: <what never appears: stock smiles, lens flares, text in the image …>
Prompt block: <the paragraph every request for this direction starts with>
```

Generate the direction's **anchor** first and save it beside the guide
(`src/assets/style/<slug>-<letter>-anchor.png`): one image that is the style at its clearest. Every
later image of that direction starts from the guide's prompt block and passes the anchor as its
first reference, so heroes, product shots, spot illustrations and textures read as one set. When a
new image breaks the style, fix the guide (and regenerate), not the one image.

When the user picks the direction, `proto kit save <slug>` keeps that direction's guide and anchor
in the kit's `style/` (it says so, or that nothing is picked yet). Name them in the kit's
`design-system.md` under Image style. The next session gets them back with `proto add --kit`.

## 4. Parallax from one image

With a strong image tool, a hero can become a layered scene: generate the scene once, then separate
it into three to five depth layers (sky, far, middle, subject, foreground), each its own transparent
PNG (`<slug>-<letter>-hero-l0.png` farthest … `-l3.png` nearest), moved at different rates on scroll
or pointer. A layer cut exactly along its visible outline shows its seams as soon as it moves, so
every layer carries overflow:

- **Behind what covers it.** Each back layer is painted whole behind the layers in front of it
  (generate or inpaint the hidden part in the same style, with the scene as its reference), reaching
  past their outlines by at least the most it shifts against them. No hole opens where the subject
  used to sit.
- **Past the frame.** Each layer is larger than its frame by its own travel on every side.
  `parallax()` does this part for you.
- **Soft cut edges.** Feather each cutout a few pixels, and keep its contact shadow on the layer
  behind, so it reads as an object, not a sticker.

Draw it with `parallax()` from `src/parallax.ts`: each layer a child of the root with `data-depth`
(0 still, 1 the nearest, moving the whole travel). It sizes every layer past the frame by its travel,
moves it against the pointer or the scroll, and stays still under `prefers-reduced-motion`.

```tsx
import { useEffect, useRef } from 'react'
import { image } from '../../images'
import { parallax } from '../../parallax'

const ref = useRef<HTMLDivElement>(null)
useEffect(() => parallax(ref.current, { travel: 24, on: 'pointer' }), [])
<div ref={ref} className="h-[70vh]">
  {['l0', 'l1', 'l2', 'l3'].map((l, i) => {
    const src = image(`kiosk-B-hero-${l}`)
    return src ? <img key={l} src={src} alt="" data-depth={i / 3} /> : null
  })}
</div>
```

Vue: `onMounted(() => { stop = parallax(root.value, { travel: 24 }) })` and `onBeforeUnmount(() => stop?.())`.

Keep the travel small (a few percent of the frame). Then check both ends of it, where the holes and
edges show: `proto shoot <slug>/<letter> --parallax 1,1` and `--parallax -1,-1`. Read both shots for a
hole behind a cutout, a hard edge, or a layer edge in the frame; fix the image, not the travel.
