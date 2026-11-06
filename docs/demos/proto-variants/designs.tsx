import { Bar } from '../../kit'

function Field({ w = 120 }: { w?: number }) {
  return (
    <div className="d-field">
      <Bar w={w} h={6} tone={2} />
    </div>
  )
}

function Item({ w }: { w: number }) {
  return (
    <div className="d-item">
      <span className="d-thumb" />
      <span className="d-lines">
        <Bar w={w} h={6} tone={3} />
        <Bar w={w - 30} h={5} tone={1} />
      </span>
      <Bar w={34} h={6} tone={3} />
    </div>
  )
}

function Pay({ wide, green, target }: { wide?: boolean; green?: boolean; target?: string }) {
  return (
    <div className={`d-pay${wide ? ' d-pay--wide' : ''}`} data-green={green || undefined} data-target={target} data-cursor={target ? 'pointer' : undefined}>
      Pay $128.00
    </div>
  )
}

// #1 Current: today's two-column checkout
export function Design1({ on }: { on: boolean }) {
  return (
    <div className="d-design d-two" data-on={on || undefined}>
      <div className="d-col">
        <Bar w={58} h={7} tone={4} />
        <Field w={130} />
        <Bar w={66} h={7} tone={4} className="d-gap" />
        <Field w={110} />
        <div className="d-pair">
          <Field w={50} />
          <Field w={40} />
        </div>
        <Field w={140} />
      </div>
      <div className="d-col d-summary">
        <Item w={88} />
        <Item w={70} />
        <div className="d-total">
          <Bar w={40} h={7} tone={3} />
          <Bar w={46} h={7} tone={4} />
        </div>
        <Pay />
      </div>
    </div>
  )
}

// #2 One page: express buttons on top, one column
export function Design2({ on }: { on: boolean }) {
  return (
    <div className="d-design d-one" data-on={on || undefined}>
      <div className="d-express">
        <span className="d-xbtn d-xbtn--dark" />
        <span className="d-xbtn" />
      </div>
      <div className="d-or">
        <span />
        <Bar w={30} h={5} tone={2} />
        <span />
      </div>
      <Field w={150} />
      <Field w={120} />
      <div className="d-pair">
        <Field w={70} />
        <Field w={50} />
      </div>
      <div className="d-fold">
        <Bar w={92} h={7} tone={3} />
        <Bar w={46} h={7} tone={4} />
      </div>
      <Pay wide />
    </div>
  )
}

// #3 Express first: the order and one big button, the card form folded below
export function Design3({ on, green, target }: { on: boolean; green?: boolean; target?: string }) {
  return (
    <div className="d-design d-express-first" data-on={on || undefined}>
      <div className="d-hero">
        <Item w={120} />
        <Item w={96} />
        <div className="d-total">
          <Bar w={40} h={7} tone={3} />
          <Bar w={46} h={7} tone={4} />
        </div>
      </div>
      <Pay wide green={green} target={target} />
      <div className="d-or">
        <span />
        <Bar w={70} h={5} tone={2} />
        <span />
      </div>
      <Field w={140} />
    </div>
  )
}
