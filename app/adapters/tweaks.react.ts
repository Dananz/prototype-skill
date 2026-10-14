// Call once in the variant's component with the controls that apply to its current state.
import { useContext, useEffect } from 'react'
import { HintHost } from './hints'
import { tweaks, type Tweak } from '../shell/tweaks'

export type { Tweak }

export function useTweaks(list: Tweak[]) {
  const host = useContext(HintHost)
  useEffect(() => { if (host) tweaks.set(host, list) })
  useEffect(() => () => { if (host) tweaks.drop(host) }, [host])
}
