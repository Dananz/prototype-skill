// Mounts a React variant into a host element. The error boundary keeps one broken
// variant from taking down the shell; Fast Refresh retries it after the next edit.
import { Component, StrictMode, type ComponentType, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { HintHost } from './hints'

// While the variant is building (the shell marks its host data-building), the last frame that
// rendered is kept, so an edit that throws halfway through shows that frame, frozen, instead of a
// stack trace. Once it is built, errors show as they are.
class Boundary extends Component<{ host: HTMLElement; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  last = ''
  watch: MutationObserver | null = null
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidMount() {
    const { host } = this.props
    let t = 0
    const keep = () => { clearTimeout(t); t = window.setTimeout(() => { if (!this.state.error && host.hasAttribute('data-building')) this.last = host.innerHTML }, 150) }
    this.watch = new MutationObserver(() => {
      // Built while it was showing the kept frame: show the error itself now.
      if (this.state.error && !host.hasAttribute('data-building')) return this.forceUpdate()
      keep()
    })
    this.watch.observe(host, { childList: true, subtree: true, characterData: true, attributes: true })
    keep()
  }
  componentWillUnmount() { this.watch?.disconnect() }
  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.host.hasAttribute('data-building')) return this.last
      ? <div inert style={{ display: 'contents', pointerEvents: 'none' }} dangerouslySetInnerHTML={{ __html: this.last }} />
      : <div className="grid min-h-full place-items-center p-10 text-xs text-zinc-400">Building…</div>
    return <pre className="m-4 whitespace-pre-wrap rounded-lg bg-rose-50 p-4 text-xs text-rose-700 dark:bg-rose-950 dark:text-rose-200">{String(error.stack || error)}</pre>
  }
}

export function mount(el: HTMLElement, Variant: ComponentType) {
  const root = createRoot(el)
  root.render(<StrictMode><HintHost.Provider value={el}><Boundary host={el}><Variant /></Boundary></HintHost.Provider></StrictMode>)
  return () => root.unmount()
}
