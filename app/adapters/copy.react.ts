// Copy options for the page's copy picker, from a React variant: call useCopy in the component
// that shows the lines (the variant, or a part of it; each component may declare its own), with
// each line's options (today's words first). It returns the words to show per line, today's or
// what the user picked in the page, and the component puts data-copy="<id>" on each line's element
// so the page can find it. See shell/copy.ts.
import { useContext, useEffect, useId, useSyncExternalStore } from 'react'
import { copy, type CopyLine } from '../shell/copy'
import { HintHost } from './hints'

export type { CopyLine }

export function useCopy(lines: CopyLine[]): Record<string, string> {
  const host = useContext(HintHost)
  const me = useId()
  useSyncExternalStore(copy.subscribe, copy.version)
  useEffect(() => { if (host) copy.set(host, me, lines) })
  useEffect(() => () => { if (host) copy.drop(host, me) }, [host, me])
  return copy.texts(host, lines)
}
