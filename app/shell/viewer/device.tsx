// The size and zoom of a design open full size (decision 21), and the bar's control for them, which
// looks like the owner's Layout and zoom menu (shell.ts): a button with the device and the zoom,
// joined to a Fit button, opening the three sizes with their dimensions (the tablet turns), then the
// zoom: Fit, 50 %, 75 %, 100 % and a slider from 25 % to 200 %. The zoom scales the device only
// (CSS zoom on its frame), never the page. The choice is this viewer's, kept in this browser.
import { useState, type CSSProperties, type RefObject } from 'react'
import { Popover } from '@base-ui/react/popover'
import { rtl, t } from '../i18n'
import { dims, ORDER, SIZES, sizeIcon, type Size } from '../view/sizes'
import { Icon, SizeIcon, popup } from './ui'

/** zoom: 0 is Fit, else a percentage, 25 to 200. */
export type Device = { size: Size; land: boolean; zoom: number }
export const ZOOM_MIN = 25
export const ZOOM_MAX = 200
const SCALES = [0, 50, 75, 100]
const KEY = 'proto-viewer-device'
const dir = rtl ? 'rtl' : 'ltr'

export function loadDevice(): Device {
  const d: Device = { size: 'desktop', land: false, zoom: 0 }
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (v && (ORDER as string[]).includes(v.size)) d.size = v.size
    if (v?.land === true) d.land = true
    if (typeof v?.zoom === 'number' && (v.zoom === 0 || (v.zoom >= ZOOM_MIN && v.zoom <= ZOOM_MAX))) d.zoom = v.zoom
  } catch { /* private mode, or nothing kept */ }
  return d
}
export function saveDevice(d: Device) {
  try { localStorage.setItem(KEY, JSON.stringify(d)) } catch { /* this load only */ }
}
/** A zoom (percent) kept to 25–200 %; within a point of Fit it is Fit (0). */
export const clampZoom = (pct: number, fitPct: number) => {
  const v = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pct)))
  return Math.abs(v - fitPct) <= 1 ? 0 : v
}

// The owner's segmented row and slider (shell.ts segCls, RANGE), in the viewer's materials.
const SEG = 'h-9 flex-1 rounded-md text-xs font-medium tabular-nums'
const SEG_ON = 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white'
const SEG_OFF = 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
const RANGE = 'h-11 min-w-0 flex-1 cursor-pointer appearance-none bg-transparent px-1 outline-none [--fill:#18181b] [--rest:rgb(24_24_27/.1)] dark:[--fill:#fff] dark:[--rest:rgb(255_255_255/.15)] '
  + '[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,var(--fill)_var(--p),var(--rest)_var(--p))] '
  + '[&::-webkit-slider-thumb]:-mt-[9px] [&::-webkit-slider-thumb]:size-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_1px_4px_rgba(0,0,0,.25),0_0_0_1px_rgba(0,0,0,.08)] focus-visible:[&::-webkit-slider-thumb]:shadow-[0_0_0_2px_#0ea5e9] '
  + '[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-[var(--rest)] [&::-moz-range-progress]:h-1.5 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-[var(--fill)] [&::-moz-range-thumb]:size-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white'
const BTN = 'inline-flex h-7 items-center gap-1 rounded-lg px-1.5 text-[12px] font-medium tabular-nums text-zinc-600 hover:bg-zinc-900/5 hover:text-zinc-900 data-[popup-open]:bg-zinc-900/5 data-[popup-open]:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-zinc-100 dark:data-[popup-open]:bg-white/10 dark:data-[popup-open]:text-zinc-100'
const STEP = 'grid size-10 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-white'

/**
 * The bar's device control. phone: a phone prototype, which is its own screen: the zoom only.
 * shown: the zoom the device is drawn at now (Fit's own when zoom is 0).
 */
export function DeviceMenu({ device, set, shown, phone, open, setOpen, root }: {
  device: Device; set: (d: Partial<Device>) => void; shown: number; phone: boolean
  open: boolean; setOpen: (o: boolean) => void; root: RefObject<HTMLDivElement | null>
}) {
  const pct = Math.round(shown * 100)
  const icon = phone ? 'phone' : sizeIcon(device.size, device.land)
  const z = device.zoom
  const [slide, setSlide] = useState<number | null>(null)
  const at = slide ?? (z || pct)
  const p = ((Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, at)) - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100
  const step = (d: number) => set({ zoom: clampZoom((z || pct) + d, -1) })
  return (
    <div className="ms-1 flex shrink-0 items-center rounded-lg ring-1 ring-inset ring-black/[.08] dark:ring-white/10">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger data-device aria-label={t('Layout and zoom')} title={t('Layout and zoom')} className={`${BTN} rounded-e-none ps-2`}>
          <SizeIcon name={icon} className="size-4" />
          <span data-full-zoom dir="ltr" className="w-9 text-center">{z ? `${pct}%` : t('Fit')}</span>
          <Icon name="caret-down" className="size-3 opacity-60" />
        </Popover.Trigger>
        <Popover.Portal container={root}>
          <Popover.Positioner side="top" align="end" sideOffset={14} collisionPadding={8} className="z-50">
            <Popover.Popup data-device-menu dir={dir} className={`${popup} w-72 p-0 text-[13px]`}>
              {!phone && (
                <div role="radiogroup" aria-label={t('Layout')} className="p-1.5">
                  <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-zinc-400">{t('Layout')}</div>
                  {ORDER.map(s => {
                    const sel = device.size === s, land = s === 'tablet' && device.land, d = dims(s, land)
                    return (
                      <button key={s} type="button" role="radio" aria-checked={sel} data-size={s} title={`${SIZES[s].name} · ${d.w} × ${d.h}`}
                        onClick={() => { set({ size: s, zoom: 0 }); setOpen(false) }}
                        className={`flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-start hover:bg-zinc-900/[.04] dark:hover:bg-white/5 ${sel ? 'font-medium text-zinc-900 dark:text-white' : 'text-zinc-700 dark:text-zinc-300'}`}>
                        <SizeIcon name={sizeIcon(s, land)} className="size-4 text-zinc-500 dark:text-zinc-400" />
                        <span className="flex-1">{SIZES[s].name}</span>
                        <span dir="ltr" className="text-xs text-zinc-400 tabular-nums">{d.w} × {d.h}</span>
                        {sel ? <Icon name="check" className="size-4" /> : <span className="size-4" />}
                      </button>
                    )
                  })}
                  {device.size === 'tablet' && (
                    <button type="button" data-turn onClick={() => set({ land: !device.land, zoom: 0 })}
                      className="flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-start text-zinc-700 hover:bg-zinc-900/[.04] dark:text-zinc-300 dark:hover:bg-white/5">
                      <SizeIcon name="rotate" className="size-4 text-zinc-500 dark:text-zinc-400" />
                      <span className="flex-1">{device.land ? t('Turn upright') : t('Turn on its side')}</span>
                    </button>
                  )}
                </div>
              )}
              {!phone && <div className="mx-4 border-t border-black/[.06] dark:border-white/10" />}
              <div className="px-3.5 pt-2.5 text-[11px] font-medium text-zinc-400">{t('Zoom')}</div>
              <div className="space-y-1.5 p-2">
                <div className="flex gap-0.5 rounded-lg bg-zinc-900/[.04] p-0.5 dark:bg-white/[.06]">
                  {SCALES.map(s => (
                    <button key={s} type="button" data-scale={s} aria-pressed={z === s} onClick={() => set({ zoom: s })} className={`${SEG} ${z === s ? SEG_ON : SEG_OFF}`}>
                      {s ? <span dir="ltr">{s}%</span> : t('Fit')}
                    </button>
                  ))}
                </div>
                <div className="flex items-center">
                  <button type="button" onClick={() => step(-5)} aria-label={t('Smaller')} title={t('Smaller')} className={STEP}><Icon name="minus" className="size-4" /></button>
                  <input type="range" dir="ltr" min={ZOOM_MIN} max={ZOOM_MAX} step={1} value={at} aria-label={t('Zoom')}
                    onChange={e => { const v = Number(e.target.value), snap = SCALES.find(s => s && Math.abs(s - v) <= 2) ?? v; setSlide(snap); set({ zoom: snap }) }}
                    onPointerUp={() => setSlide(null)} onBlur={() => setSlide(null)}
                    className={`${RANGE} ${z ? '' : 'opacity-40'}`} style={{ '--p': `${p}%` } as CSSProperties} />
                  <button type="button" onClick={() => step(5)} aria-label={t('Bigger')} title={t('Bigger')} className={STEP}><Icon name="plus" className="size-4" /></button>
                </div>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <span className="h-4 w-px shrink-0 bg-black/[.08] dark:bg-white/10" />
      <button type="button" data-full-fit onClick={() => set({ zoom: 0 })} aria-pressed={z === 0} aria-label={t('Center the design')} title={`${t('Center the design')} · 0`}
        className={`${BTN} rounded-s-none px-1.5 ${z === 0 ? 'text-sky-600 dark:text-sky-400' : ''}`}>
        <Icon name="center" className="size-4" />
      </button>
    </div>
  )
}
