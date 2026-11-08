'use client'
import { useSyncExternalStore } from 'react'

function useMedia(query: string, serverValue: boolean) {
  return useSyncExternalStore(
    fn => { const m = window.matchMedia(query); m.addEventListener('change', fn); return () => m.removeEventListener('change', fn) },
    () => window.matchMedia(query).matches,
    () => serverValue,
  )
}

/** md and up: two panes, Base UI popups. Below: one pane, Vaul drawers. The server assumes desktop. */
export const useDesktop = () => useMedia('(min-width: 768px)', true)

/** False on the server and in the first render: what may only run in the browser waits for it. */
export const useMounted = () => useSyncExternalStore(() => () => {}, () => true, () => false)

/** prefers-reduced-motion, false on the server and while hydrating, then the browser's answer. */
export const useReducedPref = () => useMedia('(prefers-reduced-motion: reduce)', false)
