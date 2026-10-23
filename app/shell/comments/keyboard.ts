// How far a phone's on-screen keyboard reaches over the bottom of the page, in this page's px, while
// `on`: the visual viewport ends above the layout one when the keyboard is up, and a page that pans to
// show the field moves it too. 0 with no keyboard, or where there is no visual viewport.
import { useEffect, useState } from 'react'

export function useKeyboard(on: boolean) {
  const [kb, setKb] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!on || !vv) { setKb(0); return }
    const f = () => setKb(Math.max(0, Math.round(window.innerHeight - (vv.offsetTop + vv.height))))
    f()
    vv.addEventListener('resize', f)
    vv.addEventListener('scroll', f)
    return () => { vv.removeEventListener('resize', f); vv.removeEventListener('scroll', f) }
  }, [on])
  return kb
}
