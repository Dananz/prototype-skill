// The device view's sizes: a phone, a tablet (turned on its side or upright) and a desktop, in CSS
// pixels, the real devices behind them, and the layout this screen already is, which is where the view is off.

import { t } from '../i18n'

export type Size = 'phone' | 'tablet' | 'desktop'
export const ORDER: Size[] = ['phone', 'tablet', 'desktop']
export const SIZES: Record<Size, { name: string; w: number; h: number }> = {
  phone: { name: t('Phone'), w: 390, h: 844 },
  tablet: { name: t('Tablet'), w: 834, h: 1194 },
  desktop: { name: t('Desktop'), w: 1440, h: 900 },
}
/** A comment written in a view is on that layout: its size and the page's px. */
export type ViewSize = { size: Size; w: number; h: number }

export type Cutout = 'island' | 'hole' | 'none'
export type Device = {
  id: string; name: string; group: string; size: Size; w: number; h: number
  /** The screen's corner radius and what is cut out of it. */
  r: number; cutout: Cutout
  /** Worked out from the panel's specs, not measured in a browser: shown with a ≈. */
  est?: boolean
}
export const DEVICES: Device[] = [
  { id: 'iphone-18-pro-max', name: 'iPhone 18 Pro Max', group: 'iPhone', size: 'phone', w: 440, h: 956, r: 55, cutout: 'island' },
  { id: 'iphone-18-pro', name: 'iPhone 18 Pro', group: 'iPhone', size: 'phone', w: 402, h: 874, r: 55, cutout: 'island' },
  { id: 'iphone-air', name: 'iPhone Air', group: 'iPhone', size: 'phone', w: 420, h: 912, r: 55, cutout: 'island' },
  { id: 'iphone-17e', name: 'iPhone 17e', group: 'iPhone', size: 'phone', w: 390, h: 844, r: 47, cutout: 'island' },
  { id: 'galaxy-s26-ultra', name: 'Galaxy S26 Ultra', group: 'Android', size: 'phone', w: 384, h: 832, r: 22, cutout: 'hole', est: true },
  { id: 'pixel-11-pro', name: 'Pixel 11 Pro', group: 'Android', size: 'phone', w: 427, h: 952, r: 44, cutout: 'hole', est: true },
  { id: 'ipad-mini', name: 'iPad mini', group: 'Tablet', size: 'tablet', w: 744, h: 1133, r: 22, cutout: 'none' },
  { id: 'ipad-pro-11', name: 'iPad Pro 11"', group: 'Tablet', size: 'tablet', w: 834, h: 1194, r: 22, cutout: 'none' },
  { id: 'laptop', name: 'Laptop', group: 'Desktop', size: 'desktop', w: 1440, h: 900, r: 0, cutout: 'none' },
]
export const DEVICE_GROUPS = ['iPhone', 'Android', 'Tablet', 'Desktop']
export const deviceById = (id: string | null | undefined) => DEVICES.find(d => d.id === id)
/** The same device worn by a screen of this size, if one is exactly that. */
export const deviceAt = (w: number, h: number) => DEVICES.find(d => d.w === w && d.h === h)

// The device each layout stands for. Nothing chosen (the shared viewer): the generic size, as SIZES says.
const worn: Partial<Record<Size, Device>> = {}
export const wornDevice = (s: Size) => worn[s]
export const wearDevice = (d: Device) => { worn[d.size] = d }

/** The layout's size in CSS px, of the device it stands for, turned on its side when land. */
export const dims = (s: Size, land = false) => { const d = worn[s] ?? SIZES[s]; return s !== 'desktop' && land ? { w: d.h, h: d.w } : { w: d.w, h: d.h } }
/** A size as the page writes it, with a ≈ when it is an estimate. */
export const sizeText = (d: { w: number; h: number }, est?: boolean) => `${est ? '≈ ' : ''}${d.w} × ${d.h}`
/** The layout a window this wide is: the page's own breakpoints (its phone below 640, its docked panel from 1024). */
export const nativeOf = (w: number): Size => (w < 640 ? 'phone' : w < 1024 ? 'tablet' : 'desktop')
/** The narrowest the stage's own artboard is laid out in a desktop window (view/index.tsx): side panels that leave
 *  the stage narrower scale a desktop layout down rather than turning it into a tablet one. */
export const FILL_MIN_W = 1024
export const sizeIcon = (s: Size, land = false) => (s === 'tablet' && land ? 'tablet-land' : s)
/** How a layout reads on a chip or a tooltip: `Desktop · 1440 × 900`. */
export const sizeName = (v: ViewSize) => `${SIZES[v.size].name} · ${v.w} × ${v.h}`
/** Whether two comments' layouts (or a comment's and the view's) are the same one; none matches none. */
export const sameView = (a?: ViewSize | null, b?: ViewSize | null) => !a || !b ? !a && !b : a.size === b.size && a.w === b.w && a.h === b.h

// The icons, in the stroke the page's own icons use (ui.ts, comments/ui.tsx).
export const SIZE_PATHS: Record<string, string> = {
  phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
  tablet: 'M6 3h12a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 18 21H6a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 6 3zM11 18h2',
  'tablet-land': 'M3 6a1.5 1.5 0 0 1 1.5-1.5h15A1.5 1.5 0 0 1 21 6v12a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18zM18 11v2',
  desktop: 'M3.5 4.5h17a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1zM9 20h6M12 16.5V20',
  rotate: 'M20 11.5A8 8 0 0 0 6.3 6.3L4 8.5M4 4v4.5h4.5M4 12.5a8 8 0 0 0 13.7 5.2L20 15.5M20 20v-4.5h-4.5',
}
