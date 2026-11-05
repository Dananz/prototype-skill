// The device's name, on top of the device: the switch to the others. Shared by the device view and a
// phone prototype's frame. A list in a popover, or in a bottom sheet on a phone-width page.
import { useState } from 'react'
import { Drawer } from '@base-ui/react/drawer'
import { Popover } from '@base-ui/react/popover'
import { Icon } from '../comments/ui'
import { t } from '../i18n'
import { DEVICE_GROUPS, DEVICES, sizeText, type Device } from './sizes'

const POP = 'max-h-[min(84vh,660px)] w-80 overflow-y-auto rounded-xl bg-white text-zinc-900 shadow-[0_18px_44px_-14px_rgb(0_0_0/.35)] ring-1 ring-black/[.08] dark:bg-zinc-900 dark:text-zinc-100 dark:ring-white/10'
const ROW = 'group flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-start text-[13px] hover:bg-zinc-900/[.04] dark:hover:bg-white/5'
/** Every outline at one scale, so the list says how they compare. */
const OUTLINE = .021

function Outline({ d, on }: { d: Device; on: boolean }) {
  return (
    <span aria-hidden className={`block ${on ? 'bg-zinc-900 dark:bg-white' : 'bg-zinc-900/[.14] group-hover:bg-zinc-900/30 dark:bg-white/[.16] dark:group-hover:bg-white/30'}`}
      style={{ width: d.w * OUTLINE, height: d.h * OUTLINE, borderRadius: Math.max(1.5, d.r * OUTLINE * 1.2) }} />
  )
}

function Row({ d, sel, pick }: { d: Device; sel: boolean; pick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={sel} data-device-row={d.id} onClick={pick}
      className={`${ROW} ${sel ? 'font-medium text-zinc-900 dark:text-white' : 'text-zinc-700 dark:text-zinc-300'}`}>
      <span className="grid w-5 shrink-0 place-items-center">{d.size === 'desktop' ? <Icon name="desktop" className="size-4 text-zinc-500 dark:text-zinc-400" /> : <Outline d={d} on={sel} />}</span>
      <span className="min-w-0 flex-1 truncate">{d.name}</span>
      <span dir="ltr" className="shrink-0 text-xs tabular-nums text-zinc-400">{sizeText(d, d.est)}</span>
      {sel ? <Icon name="check" className="size-4 shrink-0" /> : <span className="size-4 shrink-0" />}
    </button>
  )
}

export function DeviceList({ now, pick, only, designed }: {
  now: string | null; pick: (id: string | null) => void
  /** A phone prototype offers phones only. */
  only?: Device['size']
  /** A phone prototype's own screen, when it is not one of the devices. */
  designed?: { w: number; h: number }
}) {
  const groups = DEVICE_GROUPS.map(g => ({ g, ds: DEVICES.filter(d => d.group === g && (!only || d.size === only)) })).filter(x => x.ds.length)
  return (
    <div role="radiogroup" aria-label={t('Device')} data-device-list className="p-1.5">
      {designed && (
        <button type="button" role="radio" aria-checked={now === null} data-device-row="designed" onClick={() => pick(null)} className={`${ROW} ${now === null ? 'font-medium text-zinc-900 dark:text-white' : 'text-zinc-700 dark:text-zinc-300'}`}>
          <span className="w-5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{t('As designed')}</span>
          <span dir="ltr" className="shrink-0 text-xs tabular-nums text-zinc-400">{sizeText(designed)}</span>
          {now === null ? <Icon name="check" className="size-4 shrink-0" /> : <span className="size-4 shrink-0" />}
        </button>
      )}
      {groups.map(({ g, ds }) => (
        <div key={g}>
          <p className="px-2.5 pb-1 pt-2.5 text-[11px] font-medium text-zinc-400">{g}</p>
          {ds.map(d => <Row key={d.id} d={d} sel={d.id === now} pick={() => pick(d.id)} />)}
        </div>
      ))}
    </div>
  )
}

export function Placard({ label, size, est, now, pick, turn, land, sheet, only, designed }: {
  label: string; size: { w: number; h: number }; est?: boolean
  now: string | null; pick: (id: string | null) => void
  turn?: () => void; land?: boolean
  /** A phone-width page: the list opens as a bottom sheet. */
  sheet: boolean
  only?: Device['size']; designed?: { w: number; h: number }
}) {
  const [open, setOpen] = useState(false)
  const choose = (id: string | null) => { pick(id); setOpen(false) }
  const list = <DeviceList now={now} pick={choose} only={only} designed={designed} />
  const words = (
    <>
      <span className="min-w-0 truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-100">{label}</span>
      <span dir="ltr" className="shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{sizeText(size, est)}</span>
      <Icon name="chev" className="size-3 shrink-0 opacity-60" />
    </>
  )
  const cls = 'inline-flex h-8 min-w-0 items-center gap-1.5 rounded-lg px-2 hover:bg-zinc-900/5 data-[popup-open]:bg-zinc-900/5 dark:hover:bg-white/10 dark:data-[popup-open]:bg-white/10'
  const title = t('Change device · [ and ] step through them')
  return (
    <div data-device-placard className="flex min-w-0 items-center justify-center gap-1 whitespace-nowrap">
      {sheet
        ? (
          <>
            <button type="button" data-device-button onClick={() => setOpen(true)} className={cls}>{words}</button>
            <Drawer.Root open={open} onOpenChange={setOpen}>
              <Drawer.Portal>
                <Drawer.Backdrop className="fixed inset-0 z-[60] bg-black/40" />
                <Drawer.Viewport className="fixed inset-0 z-[60] flex items-end">
                  <Drawer.Popup data-device-sheet className="max-h-[80%] w-full overflow-y-auto rounded-t-2xl bg-white pb-3 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
                    <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-zinc-300 dark:bg-zinc-600" />
                    <Drawer.Title className="px-4 pt-3 text-sm font-semibold">{t('Device')}</Drawer.Title>
                    {list}
                  </Drawer.Popup>
                </Drawer.Viewport>
              </Drawer.Portal>
            </Drawer.Root>
          </>
        )
        : (
          <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger data-device-button className={cls} title={title}>{words}</Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner side="bottom" align="center" sideOffset={6} collisionPadding={12} className="z-[60]">
                <Popover.Popup data-device-menu className={POP}>{list}</Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        )}
      {turn && (
        <button type="button" data-view-turn onClick={turn} aria-label={land ? t('Turn upright') : t('Turn on its side')} title={land ? t('Upright') : t('On its side')}
          className="grid size-7 shrink-0 place-items-center rounded-full text-zinc-600 hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/10"><Icon name="rotate" className="size-4" /></button>
      )}
    </div>
  )
}
