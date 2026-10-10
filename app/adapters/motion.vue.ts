// The motion dock, from a Vue variant: call useMotion once in the variant's setup, when its motion
// is what is being reviewed. The page then shows the dock under the design, records the sequence
// and lets the reviewer scrub it, see its curves and comment on a moment or a range. See
// shell/motion/registry.ts.
import { inject, onBeforeUnmount, onMounted } from 'vue'
import { HintHost } from './hints'
import { motion, type Motion, type Moment } from '../shell/motion/registry'

export type { Motion, Moment }

export function useMotion(spec: Motion) {
  const host = inject(HintHost, null)
  if (!host) return
  // Once its elements are on the page: the first take may start the sequence right away.
  onMounted(() => motion.set(host, spec))
  onBeforeUnmount(() => motion.drop(host))
}
