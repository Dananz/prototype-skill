import { CaretDown, CaretLeft, CaretRight, Check } from '@phosphor-icons/react'
import { Bar, Caret, Popover, Prompt, Spinner, Stage, States, Swap, Window, type Act } from '../../kit'
import { Design1, Design2, Design3 } from './designs'
import './variants.css'

// Prototype's README hero: you ask your agent for three checkout layouts,
// the variants fill in while you watch, you click through them and pick one.
//
// Beats: #2 finishes building, the cursor opens it; #3 finishes, the
// cursor opens it; Decide, Pick; the button says Picked #3 and the agent
// starts building it into the code. The reset is a dip to the ground.
//
// Real strings: the session title, the three variant names, the header,
// Decide and its menu, the prompt and its status line, Pay $128.00.

type V = 1 | 2 | 3
type S = {
  ready: V // variants built so far
  open: V // variant on screen
  menu: boolean
  picked: boolean
  status: number
  dip: boolean
}

const NAMES: Record<V, string> = { 1: 'Current', 2: 'One page', 3: 'Express first' }
const STATUS = ['Building #2 One page', 'Building #3 Express first', '3 variants ready', 'Building #3 into src/checkout']

const THEME = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light'

const initial: S = { ready: 1, open: 1, menu: false, picked: false, status: 0, dip: false }
const POSTER: S = { ready: 3, open: 3, menu: false, picked: true, status: 3, dip: false }

async function script(a: Act<S>) {
  a.mark('start')
  await a.wait(1400)
  await a.set({ ready: 2, status: 1 })
  await a.wait(500)
  await a.move('row-2')
  await a.wait(150)
  await a.click()
  await a.set({ open: 2 })
  await a.wait(1600)
  await a.set({ ready: 3, status: 2 })
  await a.wait(500)
  await a.move('row-3')
  await a.wait(150)
  await a.click()
  await a.set({ open: 3 })
  await a.wait(1500)
  await a.move({ at: 'decide', x: 0.88, y: 0.62 })
  await a.wait(150)
  await a.click()
  await a.set({ menu: true })
  await a.wait(450)
  await a.move({ at: 'pick', x: 0.7, y: 0.55 })
  await a.wait(200)
  await a.click()
  await a.set({ picked: true })
  await a.set({ menu: false, status: 3 })
  a.mark('payoff')
  await a.move({ x: 790, y: 300 }, { duration: 900 })
  a.mark('poster')
  await a.wait(2000)
  await a.set({ dip: true })
  await a.wait(450)
  a.snap({ ...initial, dip: true })
  await a.wait(80)
  await a.set({ dip: false })
  await a.wait(300)
  a.mark('end')
}

export default function ProtoVariants() {
  return (
    <Stage<S> theme={THEME} width={960} height={540} initial={initial} poster={POSTER} script={script} cursor={{ at: { x: 790, y: 300 } }} className="pv">
      {(s, rect) => (
        <div className="pv-scene" data-dip={s.dip || undefined}>
          <Window url={`#${s.open} · ${NAMES[s.open]} – Checkout`} urlShape="pill" className="pv-win">
            <div className="pv-shell">
              <aside className="pv-side">
                <div className="pv-session">
                  <span className="pv-live" />
                  <span>Checkout</span>
                </div>
                <div className="pv-label">
                  <span>Variants</span>
                  <span className="pv-count">3</span>
                </div>
                <div className="pv-rows">
                  <div className="pv-hl" style={{ transform: `translateY(${(s.open - 1) * 34}px)` }} />
                  {([1, 2, 3] as V[]).map((n) => {
                    const built = s.ready >= n
                    return (
                      <div key={n} className="pv-row" data-target={`row-${n}`} data-cursor="pointer" data-on={s.open === n || undefined}>
                        <span className="pv-num">
                          <States value={built ? 'n' : 'busy'} states={{ n: <span>{n}</span>, busy: <Spinner size={12} /> }} />
                        </span>
                        <States
                          align="start"
                          value={built ? 'name' : 'busy'}
                          states={{ name: <span className="pv-name">{NAMES[n]}</span>, busy: <span className="pv-name pv-name--busy">Building…</span> }}
                        />
                        {n === 3 && s.picked && <Check className="pv-pickmark" size={12} weight="bold" />}
                      </div>
                    )
                  })}
                </div>
                <div className="pv-rule" />
                <div className="pv-label">
                  <Bar w={64} h={6} tone={2} />
                  <Bar w={36} h={6} tone={1} />
                </div>
                {[92, 70, 104, 58].map((w, i) => (
                  <div key={i} className="pv-state">
                    <span className="pv-dot" />
                    <Bar w={w} h={6} tone={i === 0 ? 3 : 2} />
                  </div>
                ))}
              </aside>

              <main className="pv-main">
                <header className="pv-head">
                  <div className="pv-title">
                    <span className="pv-crumb">Checkout</span>
                    <span className="pv-sep">·</span>
                    <span className="pv-strong">
                      <Swap id={s.open}>{`#${s.open} ${NAMES[s.open]}`}</Swap>
                    </span>
                    <CaretDown size={12} weight="bold" className="pv-faint" />
                  </div>
                  <div className="pv-tools">
                    <CaretLeft size={13} weight="bold" className="pv-faint" />
                    <span className="pv-pager">
                      <Swap id={s.open}>{`${s.open}/3`}</Swap>
                    </span>
                    <CaretRight size={13} weight="bold" className="pv-faint" />
                    <span className="pv-div" />
                    <span className="pv-decide" data-target="decide" data-cursor="pointer" data-open={s.menu || undefined} data-picked={s.picked || undefined}>
                      <States
                        value={s.picked ? 'picked' : 'decide'}
                        states={{
                          decide: (
                            <span className="pv-decide-in">
                              <span className="pv-decide-dot" />
                              Decide
                              <CaretDown size={12} weight="bold" />
                            </span>
                          ),
                          picked: (
                            <span className="pv-decide-in">
                              <Check size={12} weight="bold" />
                              Picked #3
                            </span>
                          ),
                        }}
                      />
                    </span>
                  </div>
                </header>

                <div className="pv-canvas">
                  <div className="pv-card">
                    <Design1 on={s.open === 1} />
                    <Design2 on={s.open === 2} />
                    <Design3 on={s.open === 3} />
                  </div>
                </div>
              </main>
            </div>
          </Window>

          <Popover show={s.menu} origin="top right" className="pv-menu" style={{ left: rect('decide').x + rect('decide').width - 172, top: rect('decide').y + rect('decide').height + 6 }}>
            <div className="pv-item" data-target="pick" data-cursor="pointer">
              <Check size={13} weight="bold" />
              Pick
            </div>
            <div className="pv-item">Pick with a note…</div>
            <div className="pv-item">More like this</div>
          </Popover>

          <Window chrome="terminal" title="shop — claude" className="pv-term">
            <Prompt path="~/shop">/prototype 3 checkouts</Prompt>
            <div className="pv-status">
              <span className="pv-tick">
                <States value={s.status === 2 ? 'ok' : 'busy'} states={{ ok: <span className="ok">✓</span>, busy: <span className="dim">⏺</span> }} />
              </span>
              <Swap id={s.status}>{STATUS[s.status]}</Swap>
            </div>
            <Prompt path="~/shop">
              <Caret />
            </Prompt>
          </Window>
        </div>
      )}
    </Stage>
  )
}
