// Placeholder while __ID__ · __NAME__ is being built: its one-line plan. Replace this whole file.
const plan = __PLAN__
const steps = [
  { label: 'Plan and look chosen', state: 'done' },
  { label: 'Writing the first screen', state: 'active' },
  { label: 'Content and interactions', state: 'wait' },
  { label: 'Checks and screenshots', state: 'wait' },
] as const

export default function Variant() {
  return (
    <div dir="ltr" className="grid min-h-full place-items-center bg-zinc-50 p-6 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900" role="status" aria-live="polite">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-zinc-900 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">__ID__</span>
          <div className="min-w-0">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Building</p>
            <h1 className="truncate text-lg leading-tight font-semibold tracking-tight">{plan.name || '__NAME__'}</h1>
          </div>
        </div>
        {plan.concept && <p className="mt-4 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{plan.concept}</p>}
        {plan.signature && <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-500">{plan.signature}</p>}
        <ol className="mt-5 space-y-3 border-t border-zinc-100 pt-5 dark:border-zinc-800">
          {steps.map(s => (
            <li key={s.label} className="flex items-center gap-3 text-sm">
              {s.state === 'done' && <span aria-hidden className="size-4 rounded-full bg-emerald-500" />}
              {s.state === 'active' && <span aria-hidden className="size-4 rounded-full border-2 border-zinc-200 border-t-zinc-900 motion-safe:animate-spin dark:border-zinc-700 dark:border-t-zinc-100" />}
              {s.state === 'wait' && <span aria-hidden className="size-4 rounded-full border-2 border-zinc-200 dark:border-zinc-700" />}
              <span className={s.state === 'wait' ? 'text-zinc-400 dark:text-zinc-500' : s.state === 'active' ? 'font-medium' : 'text-zinc-600 dark:text-zinc-400'}>{s.label}</span>
            </li>
          ))}
        </ol>
        <div aria-hidden className="mt-5 flex gap-1.5">
          {[plan.surface, plan.ink, plan.accent].filter(Boolean).map(c => <span key={c} className="size-3.5 rounded-full ring-1 ring-zinc-900/15 dark:ring-white/20" style={{ background: c }} />)}
        </div>
      </div>
    </div>
  )
}
