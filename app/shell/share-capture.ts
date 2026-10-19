// Render the real route at its own viewport, including CSS media queries and inactive variants.
import { domToCanvas } from 'modern-screenshot'
import { designIn, frameUrl } from './view/frame'
import { ORDER, SIZES as VIEW_SIZES } from './view/sizes'
import { t } from './i18n'

export type Look = 'bare' | 'named' | 'canvas'
export type Tone = 'soft' | 'dark' | 'brand'
export type ShotSize = { id: string; label: string; w: number; h: number }
export const LOOKS: { id: Look; label: string }[] = [
  { id: 'bare', label: t('No name') }, { id: 'named', label: t('With name') }, { id: 'canvas', label: t('Canvas') },
]
export const SIZES: ShotSize[] = ORDER.map(id => ({ id, label: VIEW_SIZES[id].name, w: VIEW_SIZES[id].w, h: VIEW_SIZES[id].h }))
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

async function renderRoute(hash: string, size: ShotSize, dark: boolean, signal: AbortSignal, values: Record<string, string | boolean> = {}) {
  const frame = document.createElement('iframe')
  frame.title = t('Screenshot capture')
  frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1
  frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${size.w}px;height:${size.h}px;border:0;pointer-events:none`
  const url = new URL(frameUrl(hash, dark)); url.searchParams.set('shot', '1')
  frame.src = url.href
  document.body.append(frame)
  const remove = () => frame.remove()
  signal.addEventListener('abort', remove, { once: true })
  try {
    const end = performance.now() + 20000
    let mount: HTMLElement | null = null
    while (!mount) {
      signal.throwIfAborted()
      const d = frame.contentDocument
      if (d?.documentElement.dataset.ready === '1') mount = designIn(d)
      if (performance.now() > end) throw new Error(t('The variant did not finish loading. Close Share and try again.'))
      if (!mount) await wait(60)
    }
    const d = mount.ownerDocument
    const registry = (d.defaultView as unknown as { __proto?: { tweaks?: { change: (host: HTMLElement, id: string, value: unknown) => boolean } } }).__proto?.tweaks
    for (const [id, value] of Object.entries(values)) registry?.change(mount, id, value)
    // Let the shell's entry crossfade and the design's state setters finish.
    await wait(300)
    await d.fonts.ready
    await Promise.all([...d.images].map(image => image.decode().catch(() => {})))
    signal.throwIfAborted()
    // The whole viewport is the design in ?dv, so portals (drawers, dialogs) are included too.
    const canvas = await domToCanvas(d.body, { scale: 2, width: size.w, height: size.h, backgroundColor: dark ? '#09090b' : '#ffffff', filter: node => !(node.nodeType === 1 && (node as Element).matches('[data-proto-ui], vite-error-overlay')) })
    signal.throwIfAborted()
    // modern-screenshot creates its canvas in the frame's document. Move the pixels to
    // a live document before removing that frame, so toBlob can finish afterwards.
    const result = document.createElement('canvas')
    result.width = canvas.width; result.height = canvas.height
    result.getContext('2d')!.drawImage(canvas, 0, 0)
    return result
  } finally { signal.removeEventListener('abort', remove); remove() }
}

// One deadline covers page load, fonts, images and rasterization. Closing the board also
// releases an in-flight capture, even when a font or image never finishes loading.
export async function captureRoute(hash: string, size: ShotSize, dark: boolean, signal: AbortSignal, values: Record<string, string | boolean> = {}) {
  signal.throwIfAborted()
  const controller = new AbortController()
  const cancel = () => controller.abort(signal.reason)
  signal.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => controller.abort(new Error(t('Capture took too long. Retry or leave this shot out.'))), 20000)
  let rejectAbort: () => void = () => {}
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(controller.signal.reason)
    controller.signal.addEventListener('abort', rejectAbort, { once: true })
  })
  try { return await Promise.race([renderRoute(hash, size, dark, controller.signal, values), aborted]) }
  finally {
    clearTimeout(timer); signal.removeEventListener('abort', cancel)
    controller.signal.removeEventListener('abort', rejectAbort)
    controller.abort()
  }
}

const FONT = 'system-ui, sans-serif'
function fit(g: CanvasRenderingContext2D, text: string, max: number) {
  if (g.measureText(text).width <= max) return text
  let t = text
  while (t.length && g.measureText(t + '…').width > max) t = t.slice(0, -1)
  return t + '…'
}

// The board and download use the same pixels. Dimensions are 2x CSS pixels.
export function compose(raw: HTMLCanvasElement, look: Look, o: { name: string; title: string; dark: boolean; tone: Tone }) {
  if (look === 'bare') return raw
  const w = raw.width, h = raw.height, c = document.createElement('canvas')
  const pad = look === 'canvas' ? 112 : 0, band = look === 'canvas' ? 184 : 112
  c.width = w + pad * 2; c.height = h + pad + band
  const g = c.getContext('2d')!
  if (look === 'named') {
    g.drawImage(raw, 0, 0)
    g.fillStyle = o.dark ? '#18181b' : '#ffffff'; g.fillRect(0, h, w, band)
    g.fillStyle = o.dark ? '#fafafa' : '#18181b'; g.font = `600 30px ${FONT}`; g.textBaseline = 'middle'
    g.fillText(fit(g, o.name, w * .56 - 40), 40, h + band / 2)
    g.font = `26px ${FONT}`; g.textAlign = 'right'; g.fillStyle = o.dark ? '#a1a1aa' : '#71717a'
    g.fillText(fit(g, o.title, w * .36 - 40), w - 40, h + band / 2)
    return c
  }
  const colors = o.tone === 'soft' ? ['#f4f4f5', '#e4e4e7'] : o.tone === 'dark' ? ['#27272a', '#09090b'] : ['#6366f1', '#4338ca']
  const bg = g.createLinearGradient(0, 0, c.width, c.height)
  bg.addColorStop(0, colors[0]); bg.addColorStop(1, colors[1]); g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height)
  g.save(); g.shadowColor = '#0005'; g.shadowBlur = 80; g.shadowOffsetY = 28
  g.beginPath(); g.roundRect(pad, pad, w, h, 36); g.fillStyle = '#fff'; g.fill(); g.restore()
  g.save(); g.beginPath(); g.roundRect(pad, pad, w, h, 36); g.clip(); g.drawImage(raw, pad, pad); g.restore()
  g.textAlign = 'center'; g.font = `600 44px ${FONT}`; g.fillStyle = o.tone === 'soft' ? '#18181b' : '#fff'
  g.fillText(fit(g, o.name, w), c.width / 2, pad + h + 88)
  g.font = `28px ${FONT}`; g.fillStyle = o.tone === 'soft' ? '#71717a' : '#ffffffad'
  g.fillText(fit(g, o.title, w), c.width / 2, pad + h + 140)
  return c
}

export const filePart = (s: string) => s.normalize('NFKC').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'variant'
export function png(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error(t('Could not create the PNG.'))), 'image/png'))
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement('a')
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
