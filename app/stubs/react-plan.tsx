// Placeholder while __ID__ · __NAME__ is being built: its one-line plan. Replace this whole file.
import { font } from '../../fonts'

const plan = __PLAN__
const dir = /[\u0590-\u06FF]/.test(`${plan.name} ${plan.concept}`) ? 'rtl' : 'ltr'
const family = (spec?: string) => spec ? `'${spec.split(':')[0]}'` : undefined

export default function Variant() {
  font(plan.display, plan.body)
  return (
    <div dir={dir} className="@container flex min-h-full flex-col p-[6cqi]" style={{ background: plan.surface, color: plan.ink }}>
      <div className="flex items-center gap-2 text-[clamp(.75rem,1.4cqi,1rem)] opacity-60" style={{ fontFamily: family(plan.body) }}>
        <span className="size-2 animate-pulse rounded-full" style={{ background: plan.accent }} />
        <span>Building __ID__ · __NAME__</span>
      </div>
      <h1 className="mt-[8cqi] text-[15cqi] leading-[0.95]" style={{ fontFamily: family(plan.display) }}>{plan.name}</h1>
      {plan.concept && <p className="mt-6 max-w-[40ch] text-[clamp(1rem,2.6cqi,2rem)] opacity-80" style={{ fontFamily: family(plan.body) }}>{plan.concept}</p>}
      {plan.signature && <p className="mt-3 max-w-[40ch] text-[clamp(.875rem,1.8cqi,1.25rem)] opacity-60" style={{ fontFamily: family(plan.body) }}>{plan.signature}</p>}
      <div className="mt-auto flex gap-2 pt-[6cqi]">
        {[plan.surface, plan.ink, plan.accent].filter(Boolean).map(c => <span key={c} className="size-6 rounded-full ring-1 ring-current/20" style={{ background: c }} />)}
      </div>
    </div>
  )
}
