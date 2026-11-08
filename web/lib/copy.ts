'use client'
import { useEffect, useRef, useState } from 'react'

/** Copies, and says which one was copied for a moment (1.6 s), for its icon and words. */
export function useCopied() {
  const [done, setDone] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = (key: string, text: string) => {
    const ok = () => {
      setDone(key)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setDone(d => (d === key ? '' : d)), 1600)
    }
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(ok, ok)
    else ok()
  }
  return { done, copy }
}
