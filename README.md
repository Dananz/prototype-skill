<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/icon-light.png">
  <img src="docs/images/icon-dark.png" alt="Prototype" width="144" height="144">
</picture>

# Prototype

**Several live, clickable versions of any UI, built while you watch.**

[![Agents](https://img.shields.io/badge/Claude%20Code%20%C2%B7%20Codex%20%C2%B7%20OpenCode-skill-4f46e5)](#install)
[![License](https://img.shields.io/github/license/DananzMolt/prototype-skill?color=4f46e5)](LICENSE)
[![Platforms](https://img.shields.io/badge/macOS%20%C2%B7%20Linux%20%C2%B7%20Windows-1a1a1a)](#install)

[Install](#install) &middot; [Use](#use) &middot; [Features](#features)

</div>

Prototype is an Agent Skill for Claude Code, Codex, OpenCode and other coding agents that can read `SKILL.md` and run local commands. Ask for a few versions of a screen and your agent opens one live app for your session, sends you its link, and builds one usable direction first, then fills in the remaining requested or default design exploration while you watch. Each one starts from a faithful rebuild of your real screen, so they all look like your product. Then your agent checks its own screenshots and tells you what it recommends, and why. Ask for more directions from Actions → More like this, or right-click a prototype and choose More variants (it offers as many as the prototype started with). Right-click works on variants, prototypes, comments and the design itself; Shift + right-click is always the browser's own menu. Actions → Needs explanation or Generate copy options requests guided demo content or alternative headlines and text later, through the comments inbox; highlighting words on the page offers the same copy request, and a comment, on just those words. On a phone these actions live in the variant sheet. Requests wait in Comments, where you can delete one to cancel it; completed extras use the existing Try it panel and copy picker.

<p align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/variant-dark.png">
  <img src="docs/images/variant-light.png" alt="A variant of a revenue dashboard, with the session's prototypes and variants in columns in the sidebar">
</picture>
<br><sub>A variant, with every prototype and variant of the session in the sidebar.</sub>
</p>

<p align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/comments-dark.png">
  <img src="docs/images/comments-light.png" alt="A comment being written on the date range, and another ready to send in the Comments panel">
</picture>
<br><sub>Comments on the design go to your agent, who makes the change and replies.</sub>
</p>

## Install

Needs Node **22.12+** (or a newer supported LTS), pnpm or npm, and Chrome, Chromium or Edge
for screenshots. Runs on macOS, Linux and Windows. [Tailscale](https://tailscale.com) is
optional, it makes the link reachable on your phone; without it, use the local URL.
The agent needs terminal and file-editing access and image viewing for visual QA.
Subagents and image generation improve the workflow when available, but are not required
to run the app. The runtime writes app files under `<project>/.prototypes/` and its session
registry under `~/.prototypes/`. Cloud or sandboxed agents need write access to both, package
installation and access to the preview server; a laptop's `localhost` is not reachable from a remote container.

### Codex and OpenCode

Install the complete repository in the shared user skill directory:

```sh
git clone https://github.com/DananzMolt/prototype-skill ~/.agents/skills/prototype
```

In PowerShell:

```powershell
git clone https://github.com/DananzMolt/prototype-skill "$HOME\.agents\skills\prototype"
```

[Codex](https://learn.chatgpt.com/docs/build-skills) and
[OpenCode](https://opencode.ai/docs/skills/) both discover `~/.agents/skills`.
For a project-only installation, use `<project>/.agents/skills/prototype` instead.
Clone the whole repository, `SKILL.md` alone cannot run the app. Update with
`git -C ~/.agents/skills/prototype pull --ff-only`. Restart the agent if it does not
show the new skill.

If you already have this checkout installed for Claude, Codex also supports a symlink:

```sh
mkdir -p ~/.agents/skills
ln -s ~/.claude/skills/prototype ~/.agents/skills/prototype
```

Use either a clone or a symlink at that destination, not both. Other agents can use their
own documented skill directory, or read this repository's `SKILL.md` explicitly and follow
it. Slash commands and automatic discovery depend on the host, not this CLI.

### Claude Code

From the plugin marketplace:

```
/plugin marketplace add DananzMolt/prototype-skill
/plugin install prototype@prototype-skill
```

Turn on auto-update for `prototype-skill` under `/plugin` → Marketplaces. Without the
plugin system, clone into `~/.claude/skills/prototype` (PowerShell:
`"$HOME\.claude\skills\prototype"`) and update with `git pull --ff-only`.

## Use

In Codex, invoke `$prototype` (or select it in the skill picker):

```text
$prototype 3 alternatives for the checkout page
```

In Claude Code:

```
/prototype the checkout page
/prototype 3 empty states for the inbox
```

In OpenCode or another skill-aware agent, ask it to use `prototype` for "a few versions of the settings drawer". Natural-language requests also work when the host supports automatic skill selection. Keep talking in the same session and everything lands in the same app:

| You say | You get |
|---|---|
| "two more" | D and E next to A, B and C |
| "B, but with a map" | new variants built from B |
| "try other headlines" | options for those lines, picked on the design |
| "go with A" | A marked as the pick |
| "build it" | the real feature in your codebase |

## Features

### Live
- One app and one link per session, which opens on your phone too.
- Each variant appears as a placeholder and fills in the moment your agent writes it. No reloads.

### Built from your product
- Variant A, "Current", rebuilds today's screen from your real assets, colors and sizes, checked against a screenshot until they match. Every other variant starts from it.
- Follows your stack (React or Vue), and lays out Hebrew and Arabic right to left from the first line.

### Made for reviewing
- Step through the variants, see them side by side or full size, or hide everything but the design.
- Open menus, drawers and steps from a list, autoplay them, or compare two variants in the same state.
- A Try it panel tells you what to type and where to click.
- The first session on a project saves its look (tokens, rebuilt tab bars and headers, matched screens) as a design kit. Later sessions start from it instead of rebuilding it, and your agent checks whether your app has changed since.
- Comment directly on any part of a design, and visually select other elements to reference. No custom element names or named-element dropdown. Your agent makes the change and replies.
- See the page at a phone's, a tablet's or a desktop's size from any screen, and comment on that layout.
- Ask for other copy, then try your agent's options on the design itself and send back the ones you pick.
- Scrub an animation forward and back, see each part's curve, and comment on one moment of it or a stretch of it. Your agent reads the frames, changes the timing and replies.
- Tools stay out of the way until you ask for them: on a phone the pill holds the variants and Comment, and one menu holds the rest.

### A pick, not a pile
- Your agent screenshots every variant on desktop and phone, fixes what it sees over two rounds, then recommends one and says why.

## How it works

Each conversation's app lives in `<project>/.prototypes/<session>/`, git-ignored, so your project's files are never touched. It stops after 6 hours with nothing open and comes back on the same link when you ask again. Sessions untouched for 14 days are deleted unless you keep them.

### Session identity and comments

The CLI uses `--session`, then `PROTO_SESSION_ID`, `CODEX_THREAD_ID`,
`CLAUDE_CODE_SESSION_ID`, or `CLAUDE_SESSION_ID`, in that order. When a host does not expose
an ID, the agent generates a unique ID once and reuses `--session <id>` on every call.
Separate conversations must use different IDs. New UUID sessions keep the full ID, so
time-based Codex IDs cannot share an app. Existing shortened UUID sessions resume only when
the stored full ID matches. Workers always pass the parent's ID and
`--project <root>` explicitly. `proto ls` lists prior sessions for resuming work.

`proto` in the skill means `node "<installed-skill-dir>/scripts/proto.mjs"`. For example,
run this from your product folder, reusing the same session name for later commands:

```sh
node ~/.agents/skills/prototype/scripts/proto.mjs up --session checkout-demo --name "Checkout"
node ~/.agents/skills/prototype/scripts/proto.mjs inbox --session checkout-demo
```

Replies detect Codex and Claude when their identity variables exist. Other hosts use a
neutral agent mark. `PROTO_AGENT=codex|claude|agent` or `reply --as codex|claude|agent`
overrides the mark. `PROTO_AGENT_PID` optionally identifies a long-lived agent process
for interrupted-comment recovery; never set it to a short-lived command's PID.

Comments persist in the app's inbox. Automatic response while idle requires a host that
wakes the agent when a background `inbox --wait` completes. Without that capability, the
agent checks the inbox on active turns; send it a chat message to pick up new comments.

## Contributing

Issues and pull requests are welcome. `SKILL.md` is what agents follow, `references/`
contains conditional guidance, `scripts/proto.mjs` runs sessions, and `app/` is the template.
`AGENTS.md` holds repository development instructions; `CLAUDE.md` imports it.

Fast local checks (also run in CI):

```sh
node --test .github/agent-checks.mjs
node scripts/proto.mjs stack --project .
```

The complete browser regression suite creates temporary apps and cleans up its servers:

```sh
node .github/smoke.mjs
```

It needs the runtime and screenshot dependencies listed above. Syntax/CLI checks alone
cannot verify browser behavior.

## License

[MIT](LICENSE) © Tomer Danan
