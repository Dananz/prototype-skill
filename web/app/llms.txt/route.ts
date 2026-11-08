// llms.txt: a plain-text summary for AI agents and answer engines (https://llmstxt.org). The same
// words as the page and its structured data (lib/site.ts). Built once, at build time.
import { FAQ, SITE, faqMarkdown } from '@/lib/site'

export const dynamic = 'force-static'

export function GET() {
  const body = `# ${SITE.name}

> ${SITE.description}

Prototype is an open-source skill (MIT) for AI coding agents: Claude Code, Codex and OpenCode.

## Install

- Claude Code: \`/plugin marketplace add Dananz/prototype-skill\`, then \`/plugin install prototype@prototype-skill\`. Ask with \`/prototype the checkout page\`.
- Codex: \`git clone https://github.com/Dananz/prototype-skill ~/.agents/skills/prototype\`. Ask with \`$prototype the checkout page\`.

## Questions

${FAQ.map(f => `### ${f.q}\n\n${faqMarkdown(f.a)}`).join('\n\n')}

## Links

- [Source and full documentation](${SITE.repo})
- [README](${SITE.repo}#readme)
`
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
}
