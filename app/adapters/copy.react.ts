// Copy options for the page's copy picker, from a React variant: call useCopy once, in the
// variant's own component, with each line's options (today's words first). It returns the words
// to show per line, today's or what the user picked in the page, and the variant puts
// data-copy="<id>" on each line's element so the page can find it. See shell/copy.ts.
import { useContext, useEffect, useSyncExternalStore } from 'react'
import { copy, type CopyLine } from '../shell/copy'
import { HintHost } from './hints'

export type { CopyLine }

export function useCopy(lines: CopyLine[]): Record<string, string> {
  const host = useContext(HintHost)
  useSyncExternalStore(copy.subscribe, copy.version)
  useEffect(() => { if (host) copy.set(host, lines) })
  useEffect(() => () => { if (host) copy.drop(host) }, [host])
  return copy.texts(host, lines)
}
