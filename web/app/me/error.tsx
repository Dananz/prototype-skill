'use client'
// The host didn't answer as it should (down, or mid-deploy): say so, and offer the one way forward.
export default function PageError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-6">
      <div className="flex max-w-md flex-col items-center text-center">
        <h1 className="text-[20px] leading-tight font-semibold">Your links didn’t load</h1>
        <p className="mt-2 text-[14px] text-ink2">The share host didn’t answer. Try again in a moment.</p>
        <button type="button" onClick={reset} className="mt-6 h-10 rounded-[10px] bg-brand px-4 text-[14px] font-medium text-white hover:bg-brand-deep">Try again</button>
      </div>
    </main>
  )
}
