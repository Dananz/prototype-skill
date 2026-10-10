// The motion dock, from a React variant: call useMotion once, in the variant's own component, when
// its motion is what is being reviewed. The page then shows the dock under the design, records the
// sequence and lets the reviewer scrub it, see its curves and comment on a moment or a range. See
// shell/motion/registry.ts.
import { useContext, useEffect } from 'react'
import { HintHost } from './hints'
import { motion, type Motion, type Moment } from '../shell/motion/registry'

export type { Motion, Moment }

export function useMotion(spec: Motion) {
  const host = useContext(HintHost)
  useEffect(() => { if (host) motion.set(host, spec) })
  useEffect(() => () => { if (host) motion.drop(host) }, [host])
}
