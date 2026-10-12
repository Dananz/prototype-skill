// Mounts a Vue variant into a host element. A render error shows in place of the variant
// instead of taking down the shell, and clears on the next hot update. While the variant is
// building (the shell marks its host data-building), its last good frame shows instead, frozen.
import { createApp, h, shallowRef, type Component } from 'vue'
import { HintHost } from './hints'

const errors = new Set<{ value: unknown }>()
if (import.meta.hot) import.meta.hot.on('vite:afterUpdate', () => errors.forEach(e => { e.value = null }))

export function mount(el: HTMLElement, Variant: Component) {
  const error = shallowRef<unknown>(null)
  const kept = shallowRef('')
  const built = shallowRef(!el.hasAttribute('data-building'))
  errors.add(error)
  let t = 0
  const keep = () => { clearTimeout(t); t = window.setTimeout(() => { if (!error.value && !built.value) kept.value = el.innerHTML }, 150) }
  const watch = new MutationObserver(() => { built.value = !el.hasAttribute('data-building'); keep() })
  watch.observe(el, { childList: true, subtree: true, characterData: true, attributes: true })
  const app = createApp({
    render: () => error.value
      ? !built.value
        ? kept.value
          ? h('div', { inert: '', style: 'display:contents;pointer-events:none', innerHTML: kept.value })
          : h('div', { class: 'grid min-h-full place-items-center p-10 text-xs text-zinc-400' }, 'Building…')
        : h('pre', { class: 'm-4 whitespace-pre-wrap rounded-lg bg-rose-50 p-4 text-xs text-rose-700 dark:bg-rose-950 dark:text-rose-200' }, String((error.value as Error).stack || error.value))
      : h(Variant),
  })
  app.config.errorHandler = err => { error.value = err }
  app.provide(HintHost, el)
  app.mount(el)
  keep()
  return () => { watch.disconnect(); errors.delete(error); app.unmount() }
}
