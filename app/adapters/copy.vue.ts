// Copy options for the page's copy picker, from a Vue variant: call useCopy in the setup of the
// component that shows the lines (the variant, or a part of it; each component may declare its
// own), with each line's options (today's words first), as a list or a function that returns it.
// It returns the words to show per line, today's or what the user picked in the page, and the
// template puts data-copy="<id>" on each line's element so the page can find it. See shell/copy.ts.
import { inject, onBeforeUnmount, reactive, shallowRef, toValue, watchEffect, type MaybeRefOrGetter } from 'vue'
import { copy, type CopyLine } from '../shell/copy'
import { HintHost } from './hints'

export type { CopyLine }

export function useCopy(lines: MaybeRefOrGetter<CopyLine[]>): Record<string, string> {
  const host = inject(HintHost, null)
  const me = Symbol('useCopy')
  const tick = shallowRef(0)
  const off = copy.subscribe(() => { tick.value++ })
  const texts = reactive<Record<string, string>>({})
  // The first run is synchronous, so the template has its words on the first render.
  watchEffect(() => {
    void tick.value
    const list = toValue(lines)
    const next = copy.texts(host, list)
    for (const k of Object.keys(texts)) if (!(k in next)) delete texts[k]
    Object.assign(texts, next)
    if (host) copy.set(host, me, list)
  })
  onBeforeUnmount(() => { off(); if (host) copy.drop(host, me) })
  return texts
}
