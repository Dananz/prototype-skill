// Mounts a React variant into a host element. The error boundary keeps one broken
// variant from taking down the shell; Fast Refresh retries it after the next edit.
import { Component, StrictMode, type ComponentType, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BUILDING_CLASS, ERROR_CLASS, keepFrame } from '../shell/building'
import { HintHost } from './hints'

// While the variant is building (the shell marks its host data-building), an edit that throws
// shows the last complete frame, frozen, instead of a stack trace. Once it is built, errors show as
// they are.
class Boundary extends Component<{ host: HTMLElement; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  keep: ReturnType<typeof keepFrame> | null = null
  static getDerivedStateFromError(error: Error) { return { error } }
  // Built while it was showing the kept frame: show the error itself now.
  componentDidMount() { this.keep = keepFrame(this.props.host, () => !!this.state.error, () => { if (this.state.error) this.forceUpdate() }) }
  componentWillUnmount() { this.keep?.stop() }
  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (!this.props.host.hasAttribute('data-building')) return <pre className={ERROR_CLASS}>{String(error.stack || error)}</pre>
    const frame = this.keep?.frame()
    return frame
      ? <div inert style={{ display: 'contents', pointerEvents: 'none' }} dangerouslySetInnerHTML={{ __html: frame }} />
      : <div className={BUILDING_CLASS}>Building…</div>
  }
}

export function mount(el: HTMLElement, Variant: ComponentType) {
  const root = createRoot(el)
  root.render(<StrictMode><HintHost.Provider value={el}><Boundary host={el}><Variant /></Boundary></HintHost.Provider></StrictMode>)
  return () => root.unmount()
}
