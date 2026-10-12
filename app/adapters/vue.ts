// Mounts a Vue variant into a host element. A render error shows in place of the variant
// instead of taking down the shell, and clears on the next hot update. While the variant is
// building (the shell marks its host data-building), its last good frame shows instead, frozen.
import { createApp, h, shallowRef, type Component } from 'vue'
import { BUILDING_CLASS, ERROR_CLASS } from '../shell/building'
import { HintHost } from './hints'

const errors = new Set<{ value: unknown }>()
if (import.meta.hot) import.meta.hot.on('vite:afterUpdate', () => errors.forEach(e => { e.value = null }))

export function mount(el: HTMLElement, Variant: Component) {
  const error = shallowRef<unknown>(null)
  const kept = shallowRef('')
  const built = shallowRef(!el.hasAttribute('data-building'))
  errors.add(error)
  // Only the host's own Building mark: when it goes, a kept frame gives way to the error itself.
  const watch = new MutationObserver(() => { built.value = !el.hasAttribute('data-building') })
  watch.observe(el, { attributes: true, attributeFilter: ['data-building'] })
  const app = createApp({
    render: () => !error.value ? h(Variant)
      : built.value ? h('pre', { class: ERROR_CLASS }, String((error.value as Error).stack || error.value))
      : kept.value ? h('div', { inert: '', style: 'display:contents;pointer-events:none', innerHTML: kept.value })
      : h('div', { class: BUILDING_CLASS }, 'Building…'),
  })
  // Called before the failed render reaches the page, so the host still shows the last frame that worked.
  app.config.errorHandler = err => { if (!error.value) kept.value = el.innerHTML; error.value = err }
  app.provide(HintHost, el)
  app.mount(el)
  return () => { watch.disconnect(); errors.delete(error); app.unmount() }
}
