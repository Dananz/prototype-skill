// Panels most page loads never open are loaded when first opened, then kept. Each one is also fetched while
// the page is idle after it loads, so the first open is as quick as it was when they all loaded up front.

/** A panel's draw function, loaded the first time it is asked to show something. */
export function lazyDraw<P>(load: () => Promise<(props: P) => void>, wanted: (props: P) => boolean) {
  let draw: ((props: P) => void) | null = null, loading = false, last: P
  return (props: P) => {
    last = props
    if (draw) return draw(props)
    if (loading || !wanted(props)) return
    loading = true
    void load().then(d => { draw = d; d(last) }, () => { loading = false })
  }
}

/** Fetches each module in turn, a while after the page settled, one per idle moment. */
export function preloadWhenIdle(loads: (() => Promise<unknown>)[], after = 800) {
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return
  const idle = (fn: () => void) => 'requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 200)
  const next = (i: number) => { if (i < loads.length) idle(() => { void loads[i]().catch(() => {}).then(() => next(i + 1)) }) }
  setTimeout(() => next(0), after)
}
