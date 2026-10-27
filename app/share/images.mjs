// A share's pictures as WebP, inlined. The owner's screenshots and photos are PNG and JPEG at
// whatever size they were taken; the single HTML file would be mostly pixels. Quality 82, never
// wider than 2560 and never enlarged, which is about what a retina screen can show of a design.
// sharp is handed in (it lives in ~/.prototypes/share-tools, not in the session); without it the
// original bytes are inlined by Vite as they are, and the review gets a warning to say so.
import { readFile } from 'node:fs/promises'
import { relative, isAbsolute } from 'node:path'

const PICTURE = /\.(png|jpe?g)(\?url)?$/i
const MAX_WIDTH = 2560

export function imagesPlugin({ sharp, root }) {
  return {
    name: 'proto-share-images',
    enforce: 'pre',
    async load(id) {
      if (!PICTURE.test(id)) return null
      const file = id.split('?')[0]
      const rel = relative(root, file)
      if (rel.startsWith('..') || isAbsolute(rel)) return null
      if (!sharp) {
        imagesPlugin.warnings.push(`${rel} stays as it is: sharp is not installed, so it was not converted to WebP`)
        return null
      }
      // Browsers turn a photo upright by its EXIF orientation; WebP output carries none, so the turn
      // is made here (rotate() with no angle), and the width that is capped is the upright one:
      // metadata() reports the stored size, whose sides swap for orientations 5 to 8.
      const image = sharp(file).rotate()
      const { width, height, orientation } = await image.metadata()
      const upright = (orientation ?? 1) >= 5 ? height : width
      const webp = await image.resize({ width: Math.min(upright ?? MAX_WIDTH, MAX_WIDTH) }).webp({ quality: 82 }).toBuffer()
      return `export default "data:image/webp;base64,${webp.toString('base64')}"`
    },
  }
}

/** What the last builds could not do, for the pre-publish review to show. */
imagesPlugin.warnings = []
