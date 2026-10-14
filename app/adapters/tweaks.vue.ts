// Call once in the variant's setup. Reactive state re-publishes its values and setters.
import { inject, onBeforeUnmount, watchEffect } from 'vue'
import { HintHost } from './hints'
import { tweaks, type Tweak } from '../shell/tweaks'

export type { Tweak }

export function useTweaks(list: () => Tweak[]) {
  const host = inject(HintHost, null)
  if (!host) return
  watchEffect(() => tweaks.set(host, list()))
  onBeforeUnmount(() => tweaks.drop(host))
}
