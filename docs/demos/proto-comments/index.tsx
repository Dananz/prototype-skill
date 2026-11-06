import { CaretDown, CaretLeft, CaretRight, Check, X } from '@phosphor-icons/react'
import { Bar, Collapse, Popover, Spinner, Stage, States, Swap, Window, box, inset, type Act } from '../../kit'
import { Design3 } from '../proto-variants/designs'
import '../proto-variants/variants.css'
import './comments.css'

// Prototype's comment loop, for the README: click an element in the
// design, write what to change, Add. Claude picks it up, the design
// changes under the pin, and the comment moves to Done with a reply.
//
// Real strings: the header, the composer's target and typed text, the
// panel's title and status, the comment, the reply, Pay $128.00.

type S = {
  hover: boolean
  composer: boolean
  typed: string
  pinned: boolean
  ready: boolean
  working: boolean
  green: boolean
  done: boolean
  dip: boolean
}

const TEXT = 'Use the brand green for this button.'
const THEME = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light'
const REST = { x: 520, y: 470 }

const initial: S = { hover: false, composer: false, typed: '', pinned: false, ready: false, working: false, green: false, done: false, dip: false }
const POSTER: S = { ...initial, pinned: true, green: true, done: true }

async function script(a: Act<S>) {
  a.mark('start')
  await a.wait(900)
  await a.move({ at: 'pay', x: 0.62, y: 0.55 })
  await a.set({ hover: true })
  await a.wait(500)
  await a.click()
  await a.set({ hover: false, composer: true })
  await a.wait(350)
  await a.type('typed', TEXT)
  await a.wait(350)
  await a.move('add')
  await a.wait(120)
  await a.click()
  await a.set({ composer: false, pinned: true, ready: true })
  await a.move(REST, { duration: 900 })
  await a.wait(900)
  await a.set({ working: true })
  await a.wait(1500)
  await a.set({ green: true })
  await a.wait(700)
  await a.set({ ready: false, working: false, done: true })
  a.mark('payoff')
  await a.wait(700)
  a.mark('poster')
  await a.wait(1700)
  await a.set({ dip: true })
  await a.wait(450)
  a.snap({ ...initial, dip: true })
  await a.wait(80)
  await a.set({ dip: false })
  await a.wait(300)
  a.mark('end')
}

export default function ProtoComments() {
  return (
    <Stage<S> theme={THEME} width={960} height={540} initial={initial} poster={POSTER} script={script} cursor={{ at: REST }} className="pv pc">
      {(s, rect) => {
        const pay = rect('pay')
        return (
          <div className="pv-scene" data-dip={s.dip || undefined}>
            <Window url="#3 · Express first – Checkout" urlShape="pill" className="pv-win">
              <div className="pc-shell">
                <header className="pv-head">
                  <div className="pv-title">
                    <span className="pv-crumb">Checkout</span>
                    <span className="pv-sep">·</span>
                    <span className="pv-strong">#3 Express first</span>
                    <CaretDown size={12} weight="bold" className="pv-faint" />
                  </div>
                  <div className="pv-tools">
                    <CaretLeft size={13} weight="bold" className="pv-faint" />
                    <span className="pv-pager">3/3</span>
                    <CaretRight size={13} weight="bold" className="pv-faint" />
                    <span className="pv-div" />
                    <span className="pv-decide">
                      <span className="pv-decide-in">
                        <span className="pv-decide-dot" />
                        Decide
                        <CaretDown size={12} weight="bold" />
                      </span>
                    </span>
                  </div>
                </header>
                <div className="pc-body">
                  <div className="pv-canvas">
                    <div className="pv-card">
                      <Design3 on green={s.green} target="pay" />
                    </div>
                  </div>

                  <aside className="pc-panel">
                    <div className="pc-panel-head">
                      <span className="pc-panel-title">Comments</span>
                      <span className="pc-status">
                        <States
                          align="end"
                          value={s.working ? 'working' : 'idle'}
                          states={{
                            idle: (
                              <span className="pc-status-in">
                                <span className="pc-dot" />
                                Claude reads these next turn
                              </span>
                            ),
                            working: (
                              <span className="pc-status-in pc-status-in--on">
                                <Spinner size={12} />
                                Claude is on it
                              </span>
                            ),
                          }}
                        />
                      </span>
                    </div>

                    <Collapse open={s.ready} reveal="drop">
                      <div className="pc-section">
                        <span>Ready to send</span>
                        <span className="pc-n">1</span>
                      </div>
                      <div className="pc-card">
                        <div className="pc-card-top">
                          <span className="pc-badge">1</span>
                          <span className="pc-card-title">Comment 1</span>
                        </div>
                        <div className="pc-card-text">{TEXT}</div>
                        <div className="pc-meta">Button · Checkout.tsx:42</div>
                      </div>
                    </Collapse>

                    <div className="pc-section pc-section--done">
                      <span>Done</span>
                      <span className="pc-n">
                        <Swap id={s.done ? 3 : 2}>{s.done ? '3' : '2'}</Swap>
                      </span>
                    </div>
                    <Collapse open={s.done} reveal="drop">
                      <div className="pc-done pc-done--real">
                        <span className="pc-check">
                          <Check size={10} weight="bold" />
                        </span>
                        <span className="pc-done-lines">
                          <span className="pc-done-text">{TEXT}</span>
                          <span className="pc-reply">Done. The button uses brand green.</span>
                        </span>
                      </div>
                    </Collapse>
                    {[132, 104, 148, 92, 120, 84, 136].map((w, i) => (
                      <div key={i} className="pc-done">
                        <span className="pc-check">
                          <Check size={10} weight="bold" />
                        </span>
                        <Bar w={w} h={6} tone={3} />
                      </div>
                    ))}
                  </aside>
                </div>
              </div>
            </Window>

            {/* The picked element's outline and its tag, over the design */}
            <div className="pc-outline" data-show={s.hover || s.composer || undefined} style={box(inset(pay, -3))}>
              <span className="pc-tag">Button</span>
            </div>
            <div className="pc-pin" data-show={s.pinned || undefined} data-done={s.done || undefined} style={{ left: pay.x + pay.width - 2, top: pay.y - 8 }}>
              <States value={s.done ? 'done' : 'n'} states={{ n: <span>1</span>, done: <Check size={10} weight="bold" /> }} />
            </div>

            <Popover show={s.composer} origin="bottom" className="pc-composer" style={{ left: pay.x + pay.width / 2 - 150, top: pay.y - 146 }}>
              <div className="pc-c-head">
                <span className="pc-badge">1</span>
                <span className="pc-card-title">Comment</span>
                <span className="pc-c-meta">Button · Checkout.tsx:42</span>
                <X size={12} weight="bold" className="pv-faint" />
              </div>
              <div className="pc-c-input" data-cursor="ibeam">
                {s.typed}
                <span className="pc-caret" />
              </div>
              <div className="pc-c-foot">
                <span className="pc-add" data-target="add" data-cursor="pointer">
                  Add
                </span>
              </div>
            </Popover>
          </div>
        )
      }}
    </Stage>
  )
}
