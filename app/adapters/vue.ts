// Mounts a Vue variant into a host element. A render error shows in place of the variant
// instead of taking down the shell, and clears on the next hot update. While the variant is
// building (the shell marks its host data-building), its last good frame shows instead, frozen.
import { createApp, h, shallowRef, type Component } from 'vue'
import { BUILDING_CLASS, ERROR_CLASS, keepFrame } from '../shell/building'
import { HintHost } from './hints'

const errors = new Set<{ value: unknown }>()
if (import.meta.hot) import.meta.hot.on('vite:afterUpdate', () => errors.forEach(e => { e.value = null }))

export function mount(el: HTMLElement, Variant: Component) {
  const error = shallowRef<unknown>(null)
  const built = shallowRef(true)
  errors.add(error)
  const keep = keepFrame(el, () => !!error.value, building => { built.value = !building })
  const app = createApp({
    render: () => !error.value ? h(Variant)
      : built.value ? h('pre', { class: ERROR_CLASS }, String((error.value as Error).stack || error.value))
      : keep.frame() ? h('div', { inert: '', style: 'display:contents;pointer-events:none', innerHTML: keep.frame() })
      : h('div', { class: BUILDING_CLASS }, 'Building…'),
  })
  app.config.errorHandler = err => { error.value = err }
  app.provide(HintHost, el)
  app.mount(el)
  return () => { keep.stop(); errors.delete(error); app.unmount() }
}
