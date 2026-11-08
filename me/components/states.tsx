// The pages with nothing to manage: signed out (the link card's deep-night glow, the one way in, what
// GitHub shares), and the quiet ones (no links yet, pending, blocked, sign-in not set up, not here).
// Server Components: no script needed beyond the header's menu.
import { GithubLogoIcon, LockIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { Logo } from './logo'

export function SignedOut({ failed }: { failed: boolean }) {
  return (
    <div className="night relative isolate flex min-h-dvh flex-col overflow-x-hidden bg-[#121019] bg-[radial-gradient(120%_80%_at_50%_120%,#4a42d4_0%,#1c1830_45%,#121019_75%)] text-white">
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 -z-10 h-[60%] bg-[radial-gradient(50%_60%_at_50%_100%,rgba(109,104,240,.35),transparent_70%)]" />
      <main className="flex flex-1 flex-col items-center px-4 pt-[clamp(56px,14vh,140px)] text-center">
        <h1 className="text-[32px] leading-[1.1] font-semibold text-balance sm:text-[44px]">Every link you shared,<br />in one place</h1>
        <p className="mt-4 max-w-[40ch] text-[15px] leading-relaxed text-balance text-white/70">From every project and Mac. See who opened them, read the comments, turn them off, from any browser.</p>
        <div className="mt-8 flex flex-col items-center">
          {failed && <p role="alert" className="mb-3 flex items-center gap-1.5 text-[13.5px] text-[#ffb4b4]"><WarningCircleIcon size={16} weight="fill" aria-hidden="true" />Sign-in didn’t finish. Try again.</p>}
          {/* The host's own sign-in, outside /me: a plain link. */}
          <a href="/auth/github?me=1" className="inline-flex h-12 items-center justify-center gap-2.5 rounded-full bg-white px-6 text-[15px] font-semibold text-ink shadow-[0_0_0_1px_rgba(255,255,255,.2),0_10px_40px_-8px_rgba(109,104,240,.75)] transition-[transform,background-color] duration-150 hover:bg-tint focus-visible:outline-[#b9b5ff] active:scale-[.98] motion-reduce:transition-none">
            <GithubLogoIcon size={20} weight="fill" aria-hidden="true" />{failed ? 'Try again with GitHub' : 'Sign in with GitHub'}
          </a>
          <p className="mt-4 max-w-[34ch] text-[12.5px] leading-normal text-balance text-white/45 sm:max-w-none">
            <LockIcon size={13} aria-hidden="true" className="me-1 inline -translate-y-px align-middle" />GitHub shares only your name, login and picture. Nothing is posted.
          </p>
        </div>
        <div aria-hidden="true" className="relative mt-auto flex w-full justify-center pt-10">
          <div className="absolute bottom-[8%] left-1/2 h-[70%] w-[min(520px,90%)] -translate-x-1/2 rounded-full bg-[rgba(109,104,240,.4)] blur-[60px]" />
          <Logo className="relative mb-[clamp(24px,5vh,56px)] aspect-square h-[clamp(140px,26vh,260px)] w-auto drop-shadow-[0_20px_50px_rgba(90,83,227,.55)]" />
        </div>
      </main>
    </div>
  )
}

export function Quiet({ head, text }: { head: string; text: string }) {
  return (
    <main className="grid flex-1 place-items-center px-4 py-6">
      <div className="flex max-w-md flex-col items-center text-center">
        <Logo tile className="mb-5 size-12" />
        <h1 className="text-[20px] leading-tight font-semibold">{head}</h1>
        <p className="mt-2 text-[14px] text-ink2">{text}</p>
      </div>
    </main>
  )
}
