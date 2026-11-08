'use client'
// Questions: a Base UI accordion, any number open. A closed answer stays in the page as
// hidden="until-found", so find-in-page and search engines still read it (as <details> did). The
// answer's height opens on a soft spring and folds with a quick pull, its words rising out of a blur
// (globals.css, .faq-*).
import { Accordion } from '@base-ui/react/accordion'
import { ArrowUpRightIcon, GithubLogoIcon, PlusIcon } from '@phosphor-icons/react'
import { useMounted } from '@/lib/media'
import { FAQ, SITE } from '@/lib/site'

const ring = 'focus-visible:ring-2 focus-visible:ring-[#6d68f0] focus-visible:outline-none'

function Answer({ text }: { text: string }) {
  return <>{text.split(/(`[^`]+`|\{repo\})/).map((part, i) =>
    part === '{repo}' ? (
      <a key={i} href={SITE.repo} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 rounded align-[-3px] font-medium text-[#121019] underline decoration-[#c9c6f7] decoration-2 underline-offset-4 transition-colors hover:decoration-[#6d68f0] ${ring}`}>
        <GithubLogoIcon size={16} aria-hidden="true" /> GitHub repository <ArrowUpRightIcon size={13} aria-hidden="true" className="text-[#6d68f0]" />
      </a>
    ) : part.startsWith('`') ? (
      <code key={i} className="rounded-md bg-[#f3f2fe] px-1.5 py-0.5 text-[13px] text-[#121019] [box-decoration-break:clone]">{part.slice(1, -1)}</code>
    ) : part)}</>
}

export function Faq() {
  // Base UI puts the panel's size variables in a style attribute: in the server's HTML the CSP would
  // refuse it, so the panel takes them once the page is live (they only matter when it opens).
  const mounted = useMounted()
  return (
    <Accordion.Root multiple hiddenUntilFound className="mt-8 divide-y divide-[#efedfb] border-t border-[#efedfb]">
      {FAQ.map(f => (
        <Accordion.Item key={f.q} className="faq">
          <Accordion.Header className="m-0">
            <Accordion.Trigger className={`flex w-full cursor-pointer items-center justify-between gap-6 rounded-md py-5 text-start text-[17px] font-medium ${ring}`}>
              {f.q}
              <PlusIcon size={18} aria-hidden="true" className="faq-i shrink-0 text-[#6d68f0]" />
            </Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Panel className="faq-body" render={({ style, ...props }) => <div {...props} style={mounted ? style : undefined} />}>
            <p className="faq-a max-w-2xl pb-6 text-[15px] leading-[1.65] text-[#4a4760]"><Answer text={f.a} /></p>
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion.Root>
  )
}
