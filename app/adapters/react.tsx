// Mounts a React variant into a host element. The error boundary keeps one broken
// variant from taking down the shell; Fast Refresh retries it after the next edit.
import { Component, StrictMode, type ComponentType, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BUILDING_CLASS, ERROR_CLASS } from '../shell/building'
import { HintHost } from './hints'

// While the variant is building (the shell marks its host data-building), an edit that throws
// shows the last frame that rendered, frozen, instead of a stack trace. Once it is built, errors
// show as they are.
class Boundary extends Component<{ host: HTMLElement; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  kept: string | null = null
  watch: MutationObserver | null = null
  static getDerivedStateFromError(error: Error) { return { error } }
  // Only the host's own Building mark: when it goes, a kept frame gives way to the error itself.
  componentDidMount() {
    this.watch = new MutationObserver(() => { if (this.state.error) this.forceUpdate() })
    this.watch.observe(this.props.host, { attributes: true, attributeFilter: ['data-building'] })
  }
  componentWillUnmount() { this.watch?.disconnect() }
  render() {
    const { error } = this.state
    const { host } = this.props
    if (!error) { this.kept = null; return this.props.children }
    if (!host.hasAttribute('data-building')) return <pre className={ERROR_CLASS}>{String(error.stack || error)}</pre>
    // Render comes before React commits, so the host still shows the last frame that worked.
    this.kept ??= host.innerHTML
    return this.kept
      ? <div inert style={{ display: 'contents', pointerEvents: 'none' }} dangerouslySetInnerHTML={{ __html: this.kept }} />
      : <div className={BUILDING_CLASS}>Building…</div>
  }
}

export function mount(el: HTMLElement, Variant: ComponentType) {
  const root = createRoot(el)
  root.render(<StrictMode><HintHost.Provider value={el}><Boundary host={el}><Variant /></Boundary></HintHost.Provider></StrictMode>)
  return () => root.unmount()
}
