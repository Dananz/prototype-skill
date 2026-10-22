// Words that appear on the page and in its structured data, kept in one place so they always match.
export const SITE = {
  name: 'Prototype',
  title: 'Prototype · Type one line. Pick one of five.',
  description: 'Several live, clickable versions of any UI, built while you watch. Comment on them, compare them, then keep the one you like.',
  repo: 'https://github.com/Dananz/prototype-skill',
}

export const FAQ: { q: string; a: string }[] = [
  { q: 'What is Prototype?', a: 'Prototype is an open-source skill for AI coding agents. Ask for a few versions of a UI and it opens one live app, builds clickable variants while you watch, and checks them against screenshots of your real product. You comment on the designs, compare them side by side, and pick one to build into your codebase.' },
  { q: 'How do I install it in Claude Code?', a: 'Run /plugin marketplace add Dananz/prototype-skill, then /plugin install prototype@prototype-skill. Then ask for a screen, for example /prototype the checkout page.' },
  { q: 'How do I install it in Codex?', a: 'Clone the repository into your skills folder with git clone https://github.com/Dananz/prototype-skill ~/.agents/skills/prototype, then ask for a screen with $prototype the checkout page.' },
  { q: 'Which agents does it work with?', a: 'Claude Code, Codex and OpenCode. Other agents can use it when they can run local commands, edit files and view images: install the repository in their skill folder or have them follow its SKILL.md.' },
  { q: 'What do I need to run it?', a: 'Node 22.12 or newer with pnpm or npm, and Chrome, Chromium or Edge for screenshots. It runs on macOS, Linux and Windows. Tailscale is optional and makes the live link open on your phone.' },
  { q: 'Is it free?', a: 'Yes. Prototype is open source under the MIT license.' },
]
