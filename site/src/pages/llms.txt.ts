import type { APIRoute } from 'astro'
import { SITE, FAQ } from '../content'

// llms.txt: a plain-text summary for AI agents and answer engines (https://llmstxt.org).
export const GET: APIRoute = () => {
  const body = `# ${SITE.name}

> ${SITE.description}

Prototype is an open-source skill (MIT) for AI coding agents: Claude Code, Codex and OpenCode.

## Install

- Claude Code: \`/plugin marketplace add Dananz/prototype-skill\`, then \`/plugin install prototype@prototype-skill\`. Ask with \`/prototype the checkout page\`.
- Codex: \`git clone https://github.com/Dananz/prototype-skill ~/.agents/skills/prototype\`. Ask with \`$prototype the checkout page\`.

## Questions

${FAQ.map(f => `### ${f.q}\n\n${f.a}`).join('\n\n')}

## Links

- [Source and full documentation](${SITE.repo})
- [README](${SITE.repo}#readme)
`
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
