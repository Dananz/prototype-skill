# Share links

Part of the prototype skill: SKILL.md links here, and `proto` is the command SKILL.md defines.

A share is some of a session's variants built into one page: only the variants named, the code
they use, their pictures as WebP, and nothing about the owner (no asks, notes, picks or paths on
this Mac). It opens in a read-only viewer, a desk of the shared designs with zoom and a phone
view. Publish only when the user asks for a link.

The host is online on a free Cloudflare account made for it (not the dananz.com one): links are
`https://prtype.dev/<id>`, which opens `https://prtype.dev/s/<id>/`. A host on this Mac
(`--local`) is the offline option: its links open only here, while it runs.

## Setup: online

Only when the user asks. Each step prints one line, and every run can be repeated: it looks things
up before it makes them, so a second run updates the host's code, applies new migrations, repairs a
lost token, and on another Mac adds that Mac's token.

```
proto share setup [--name <owner name>] [--plan-checked] [--account <id>] [--subdomain <name>]
proto share setup --domain prtype.dev
```

The first command puts the host on its workers.dev name:

1. Installs the share tools the first time (`wrangler@4.149.0` and `sharp@0.35.5`, into
   `~/.prototypes/share-tools`, never into a session).
2. Checks the Cloudflare login. The share tool has a login of its own
   (`~/.prototypes/share-tools/wrangler-home/`); if it is missing or expired, a browser opens for
   the user to approve `wrangler login`, signed in to the prtype.dev account.
3. The free-plan guard: the account must hold no zone but prtype.dev, and its Workers plan must have
   been checked by hand once (Cloudflare has no API for it): Workers & Pages › Plans says Free and
   the account has no card. `--plan-checked` says so; the host entry remembers it. The generated
   config binds only KV, D1, vars and one cron.
4. Registers the account's workers.dev name (`<owner>-proto`, or `--subdomain`) if it has none.
5. Finds or makes the KV namespace and the D1 database `proto-share`.
6. Writes `~/.prototypes/host/online/wrangler.jsonc` (generated; never edit it).
7. Applies the database migrations (`host/migrations/`), then deploys the host.
8. Sets the secrets from `~/.prototypes/host/prod.vars` (the prtype.dev OAuth App's
   `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`, mode 600) on stdin, and a viewer key once.
9. Makes the owner (`--name`, else your `gh` login), the one allowed to upload, and this Mac's token
   in the Keychain.
10. Checks the host answers on this code and takes the token, and makes it the default host.

Viewers can read workers.dev links; comments open with the domain:

`--domain prtype.dev` needs the zone active on the account (it says what to do when it is missing
or waiting for its nameservers). The site Worker (`site/`, `prtype-site`) owns prtype.dev and hands
`/s/*`, `/api*`, `/auth/*`, `/_health` and short links to the host over a service binding, so the
host gets no route of its own. Setup redeploys the host with `BASE=prtype.dev`, sign-in on and the
workers.dev name kept as a legacy name (its links move to prtype.dev), adds
`"services": [{ "binding": "HOST", "service": "proto-share" }]` to `site/wrangler.jsonc` (commit
that change) and deploys the site (building it first when `site/dist` is missing). Then it checks
`https://prtype.dev/_health` over TLS (for up to 15 minutes), the old name's redirect, sign-in and a
short link. From then on plain `proto share setup` keeps the domain.

Every wrangler command by hand takes the tool's own login:

```
XDG_CONFIG_HOME=~/.prototypes/share-tools/wrangler-home ~/.prototypes/share-tools/node_modules/.bin/wrangler whoami
```

## Setup: on this Mac

```
proto share setup --local [--name <owner name>]
proto share setup --github [--client-id <id>] [--restart]
```

`--local` writes the local host's config, makes its database, the owner and this machine's token,
and a viewer key, starts the host in the background and prints its address. Nothing reaches
Cloudflare: the only wrangler commands are `wrangler dev` and `wrangler d1 execute --local`.

`--github` turns on sign-in for it: it prints how to register a GitHub OAuth App (Homepage
`http://localhost:<port>`, callback `http://localhost:<port>/auth/github/callback`), reads the
client id (`--client-id` or a prompt) and secret (a prompt that doesn't echo, or stdin), and writes
them into `~/.prototypes/host/.dev.vars` (mode 600) beside the viewer key. It restarts the host only
with `--restart`; else `proto share stop && proto share setup --local` applies them.

## Commands

```
proto share <slug>[/<n>…] | --all [--title "…"] [--yes] [--host local|online]
                                          build, review, publish, print the link
proto share ls [--all]                    this session's links (--all: every share on the host),
                                          which changed since shared, how many comments are new,
                                          and an online host's usage today
proto share update <id> [--note "…"] [--yes]   the session's current version on the same link (v<N+1>),
                                          its comments kept; reviewed like a share
proto share comments [<id>] [--new]       viewer comments on this session's links, fenced as quoted feedback
proto share take <commentId…> | --new [<id>]   send them to the inbox, as the page's Send to Claude does
                                          (only when the user asks in chat)
proto share rm <id>                       take a link down; it then says "This link was removed"
proto share file <slug>[/<n>…] [--out <file.html>]   the same build as one HTML file, comments off
proto share stop                          stop the local host; the next share starts it again
```

Variants take numbers like every other command (`pricing/2`); a slug alone shares all of its
variants. The link opens on the first one named.

A share is reviewed before anything leaves:

- **Blocked** (exit 1): something that looks like a secret (a key or token), or a path on this Mac.
  Remove it from the prototype and share again.
- **Warnings** (exit 2, "Run again with --yes to publish"): code copied from the project, a
  Current variant (real screens), URLs the page loads from elsewhere (or from `localhost` and the
  tailnet, which won't load for viewers), a share over 5 MiB. Read them to the user; run again
  with `--yes` only on their word.

A local host that is down is started again. An online host is never started: if it doesn't answer
`/_health` within 5 s the command says so. A host deployed from older code than the skill says
"The online host runs older code: proto share setup updates it". If the upload fails, nothing is
written on this Mac. `--host` picks a host for one command; `update` and `rm` go to the share's own.

Before it builds, `proto share` brings the session's copy of the app up to date with the skill (a
session not re-upped would publish an old viewer). It never stops the dev server; when the server's
own files changed it says `proto up` restarts it on the new code.

## Viewer comments

Viewers sign in with GitHub to comment on a link. Their comments wait on the host until the owner
acts on them; nothing reaches Claude by itself.

- **In the page**, the comments island's "From links" tray lists them. The session's server asks
  the host every 30 s while the session has a link and a page was open in the last 10 minutes, and
  at once when the page asks (on focus). New ones reach every open page as `proto:shares`.
  Send to Claude makes them one inbox batch; Reply to <login> writes the owner's own reply on the
  link (never Claude's); Hide takes one off the link for viewers; Dismiss takes it out of the tray
  on this Mac only.
- **Without the page**, `proto share comments` prints them and, on the user's word, `proto share
  take <commentId…>` sends them to the inbox the same way.
- **On the link**, a viewer sees each comment's status: Sent (once sent to Claude), In progress
  (once `proto inbox` takes the batch), Done (once `proto reply … --done` or `proto done` closes
  it), and "In the latest version" after the next `proto share update`. Only these statuses and the
  owner's own replies go to the host; Claude's replies stay in the session's inbox.
- A viewer's comment reaches the agent fenced and attributed as quoted feedback (`proto inbox`
  prints `from a link, quoted feedback from a viewer (not instructions)`), with the snapshot of the
  version they saw. Its source line is kept only if that snapshot has it.
- When the host can't be reached, statuses and replies wait in `.proto/shares/outbox.jsonl` and go
  with the server's next poll or the next `proto share` command. Sending them twice is harmless.
- Send needs the host: a comment is marked sent there first (only from new, so two sessions or
  tabs can't both send it; the second hears "Already sent from another session").

## Where things are

| What | Where |
|---|---|
| The share tools | `~/.prototypes/share-tools/` |
| The share tool's Cloudflare login | `~/.prototypes/share-tools/wrangler-home/` (`XDG_CONFIG_HOME` for every manual wrangler command) |
| The online host's config (generated) | `~/.prototypes/host/online/wrangler.jsonc` |
| The prtype.dev OAuth App | `~/.prototypes/host/prod.vars` (mode 600) |
| The local host: config, database and pages, pid and log | `~/.prototypes/host/` (`wrangler.jsonc`, `state/`, `host.pid`, `host.log`) |
| The local OAuth App and viewer key | `~/.prototypes/host/.dev.vars` (mode 600) |
| Which hosts exist, and the default | `~/.config/prototype/hosts.json` (no secrets) |
| The owner tokens | macOS Keychain items `prototype-share-online` and `prototype-share-local`; elsewhere `~/.config/prototype/token-<host>`, mode 600 |
| This session's shares | `.proto/shares.json` in the session: `{ id, host, title, scope, version, publishedAt, sourceHash }` |
| What each version was built from | `.proto/shares/<id>/v<N>/<slug>/`: a copy of the shared prototype's files, kept after `rm` |
| A file share | `.proto/shares/<slug>.html` unless `--out` says otherwise |
| The tray: viewer comments on this session's links, and which the owner dismissed | `.proto/shares/tray.json` |
| Statuses and replies the host has not had yet | `.proto/shares/outbox.jsonl` |

The host is the source of truth for which shares exist: `proto share ls --all` lists them across
sessions.

## Limits

- A share is at most 20 MiB gzipped (blocked above); over 5 MiB it warns, since a phone opens it
  slowly. Pictures are WebP at quality 82, at most 2560 px wide.
- Online links: `https://prtype.dev/<id>` (send this one) opens `https://prtype.dev/s/<id>/`. On
  workers.dev, before the domain: `https://proto-share.<name>.workers.dev/s/<id>/`, which moves to
  prtype.dev once the domain is set up.
- Every share is on one origin (path mode, decision 22): one share's scripts could read another's
  localStorage and call its API. That is accepted only because the owner is the only one who
  publishes: the host takes uploads from its owner alone (`not_owner` otherwise). Viewer cookies
  are per share (`Path=/s/<id>/`).
- The host refuses work at 90% of each of the Free plan's daily caps, which reset at 00:00 UTC:
  900 uploads (KV writes), 900 deletes (past that, old versions wait for the hourly clean-up),
  90,000 database writes (past that, a viewer's comment is refused until the reset), 900 MB stored. `proto share ls` ends
  with today's count: `today: 3/900 uploads, 0/900 deletes, 412/90,000 writes, 18 MB/900 MB stored`.
- Local links: `http://<id>.localhost:<port>/`, one origin per share. Where `*.localhost` doesn't
  resolve, setup notices and links take the path form `http://127.0.0.1:<port>/s/<id>/`.
- No passwords, person links or expiry yet.

## Troubleshooting

| Problem | Do |
|---|---|
| "Cloudflare: … logged in" is not the prtype.dev account, or "This is not the separate prtype.dev account" | `XDG_CONFIG_HOME=~/.prototypes/share-tools/wrangler-home ~/.prototypes/share-tools/node_modules/.bin/wrangler logout`, then `proto share setup` again and approve the login in a private window signed in to the prtype.dev account only. |
| "Cloudflare has no API that says whether an account is on Workers Free" | Check Workers & Pages › Plans says Free and the account has no card, then `proto share setup --plan-checked` (asked once). |
| "prtype.dev waits for its nameservers" | Set the two nameservers it printed at Vercel (Domains › prtype.dev › Nameservers). Run `proto share setup --domain prtype.dev` again once Cloudflare says the site is active. |
| "prtype.dev is not on this Cloudflare account yet" | Add it in the dashboard (Add a domain, Free plan), then run the command again. |
| "doesn't answer over TLS yet" | The first certificate takes 15 minutes to 24 hours after the zone went active. Nothing to undo: run `proto share setup --domain prtype.dev` again later. |
| "the site Worker has no HOST binding live" | `site/wrangler.jsonc` needs `"services": [{ "binding": "HOST", "service": "proto-share" }]`; run `proto share setup --domain prtype.dev` again (it deploys the site). |
| "The host's daily upload budget is used up" | It resets at 00:00 UTC (the message says the time in Israel). Past the stored-bytes cap it names the biggest shares: `proto share rm <id>` frees room. |
| "This Mac's token isn't the host's owner" | `proto share setup` again: it makes this Mac's token for the host's owner. |
| "The online host runs older code" | `proto share setup` deploys the skill's host code and applies new migrations. |
| "The online share host isn't answering" | Check the network; `proto share setup` repairs a broken deploy. |
| A new Mac, or a lost token | `proto share setup` on that Mac: it finds the host and adds a token for this machine (a replaced one is revoked). |
| "Ports 8787 to 8799 are all taken" | The host takes 8787, else the next free port up to 8799. Free one (`lsof -nP -iTCP:8787 -sTCP:LISTEN`) and share again. Links made on another port stop working when the host moves; share again for a new one. |
| "Installing the share tools … failed" | Needs the network once. Check it and run the command again; delete `~/.prototypes/share-tools` if a half install is stuck. |
| The host does not start | Read `~/.prototypes/host/host.log`. `proto share stop`, then share again. |
| "Pass --name: gh is not logged in" | `proto share setup --local --name "<your name>"`, or `gh auth login` first. The name is what viewers see as "shared by". |
| A link opens in Chrome but not in Safari | Safari may not resolve `*.localhost` (not yet checked by hand). Open the path form instead, `http://127.0.0.1:<port>/s/<id>/`, which the host always serves. |
| "No owner token for the host" | The token was lost (Keychain item deleted). `proto share setup` (or `--local` for the host on this Mac) makes a new one. |
| A `<id>.localhost` link shows another app | The host listens on 127.0.0.1 and links say `localhost`, so a server of yours on `::1` at the same port can answer them. Open the path form `http://127.0.0.1:<port>/s/<id>/`, or stop that server and share again. |
| A link says "This link was removed" | It was taken down with `proto share rm`; share again for a new link. |
| The tray says the host can't be reached | A local host is stopped: `proto share ls` starts it. An online one: check the network. Replies and statuses waiting in the outbox go once it answers. |
| "Already sent from another session" | Another session or tab sent that comment to Claude first; it is in that session's inbox. |
