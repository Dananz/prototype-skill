# Share links

Part of the prototype skill: SKILL.md links here, and `proto` is the command SKILL.md defines.

A share is some of a session's variants built into one page: only the variants named, the code
they use, their pictures as WebP, and nothing about the owner (no asks, notes, picks or paths on
this Mac). It opens in a read-only viewer, a desk of the shared designs with zoom and a phone
view. Publish only when the user asks for a link.

For now (phase 0) the host runs on this Mac under `wrangler dev`: a link opens only on this Mac,
and only while the host runs. Links others can open come with a hosted stage later.

## Setup, once per Mac

```
proto share setup --local [--name <owner name>]
```

It installs the share tools the first time (`wrangler@4.149.0` and `sharp@0.35.5`, into
`~/.prototypes/share-tools`, never into a session), writes the host's config, makes its database,
creates the owner (named by `gh api user`, else `--name`) and this machine's owner token, starts the
host in the background and prints its address. Nothing logs in to Cloudflare: the only wrangler
commands are `wrangler dev` and `wrangler d1 execute --local`.

## Commands

```
proto share <slug>[/<n>…] | --all [--title "…"] [--yes]   build, review, publish, print the link
proto share ls [--all]                    this session's links (--all: every share on the host)
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

If the host is down, a share starts it again. If the upload fails, nothing is written on this Mac.

## Where things are

| What | Where |
|---|---|
| The share tools | `~/.prototypes/share-tools/` |
| The local host: config, database and pages, pid and log | `~/.prototypes/host/` (`wrangler.jsonc`, `state/`, `host.pid`, `host.log`) |
| Which hosts exist, and the default | `~/.config/prototype/hosts.json` (no secrets) |
| The owner token | macOS Keychain item `prototype-share-local`; elsewhere `~/.config/prototype/token-local`, mode 600 |
| This session's shares | `.proto/shares.json` in the session: `{ id, host, title, scope, version, publishedAt, sourceHash }` |
| What each version was built from | `.proto/shares/<id>/v<N>/<slug>/`: a copy of the shared prototype's files, kept after `rm` |
| A file share | `.proto/shares/<slug>.html` unless `--out` says otherwise |

The host is the source of truth for which shares exist: `proto share ls --all` lists them across
sessions.

## Limits

- A share is at most 20 MiB gzipped (blocked above); over 5 MiB it warns, since a phone opens it
  slowly. Pictures are WebP at quality 82, at most 2560 px wide.
- Links: `http://<id>.localhost:<port>/`, one origin per share. Where `*.localhost` doesn't resolve,
  setup notices and links take the path form `http://127.0.0.1:<port>/s/<id>/`. The host answers
  both forms on both `localhost` and `127.0.0.1` whichever setup chose.
- Phase 0 has no passwords, person links, comments from viewers or updates of a published share;
  sharing again makes a new link.

## Troubleshooting

| Problem | Do |
|---|---|
| "Ports 8787 to 8799 are all taken" | The host takes 8787, else the next free port up to 8799. Free one (`lsof -nP -iTCP:8787 -sTCP:LISTEN`) and share again. Links made on another port stop working when the host moves; share again for a new one. |
| "Installing the share tools … failed" | Needs the network once. Check it and run the command again; delete `~/.prototypes/share-tools` if a half install is stuck. |
| The host does not start | Read `~/.prototypes/host/host.log`. `proto share stop`, then share again. |
| "Pass --name: gh is not logged in" | `proto share setup --local --name "<your name>"`, or `gh auth login` first. The name is what viewers see as "shared by". |
| A link opens in Chrome but not in Safari | Safari may not resolve `*.localhost` (not yet checked by hand). Open the path form instead, `http://127.0.0.1:<port>/s/<id>/`, which the host always serves. |
| "No owner token for the host" | The token was lost (Keychain item deleted). `proto share setup --local` makes a new one. |
| A link says "This link was removed" | It was taken down with `proto share rm`; share again for a new link. |
