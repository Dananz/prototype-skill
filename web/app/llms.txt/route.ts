// llms.txt: a plain-text summary for AI agents and answer engines (https://llmstxt.org). The same
// words as the page and its structured data (lib/site.ts). Built once, at build time.
import { FAQ, INSTALL, SITE, faqMarkdown } from '@/lib/site'

export const dynamic = 'force-static'

export function GET() {
  const body = `# ${SITE.name}

> ${SITE.description}

Prototype is an open-source skill (MIT) for AI coding agents: Claude Code, Codex and OpenCode.

## Install

- Claude Code: \`${INSTALL.claude[0]}\`, then \`${INSTALL.claude[1]}\`. Ask with \`${INSTALL.ask.claude}\`.
- Codex: \`${INSTALL.codex[0]}\`. Ask with \`${INSTALL.ask.codex}\`.

## Questions

${FAQ.map(f => `### ${f.q}\n\n${faqMarkdown(f.a)}`).join('\n\n')}

## Links

- [Source and full documentation](${SITE.repo})
- [README](${SITE.repo}#readme)
`
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
}
