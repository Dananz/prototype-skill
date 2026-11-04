# Forking a shared prototype

Tomer asked for continuity from shared prototypes: someone shares a prototype with me, I fork it to
my machine, keep working on it, and can offer my version back to compare or take. He skipped the
design questions ("go"), so every call below is the builder's and is listed for him to check.

## The flow

1. **Fork.** `proto fork <link>` reads the page behind the link and lands its source as new
   prototypes in this project's app. The viewer has a Fork button that shows that command.
2. **Keep working.** A fork is an ordinary prototype with `forkedFrom` in its meta. Every tool works
   on it. `proto fork ls` says what was forked and whether the original has moved on.
3. **Offer back.** `proto fork offer <slug>` publishes the fork as the forker's own link and tells the
   original link's owner. A plain `proto share` of a fork tells nobody.
4. **Take it or leave it.** The owner sees the offer in `proto share ls` and the Share popover: who,
   what changed, Open, Bring in, Dismiss. Bringing it in is `proto fork <their link>`: it lands nested
   under the original prototype (`from` + `referenceOnly`), so the two sit side by side in the page.

## How the source travels

The host has no source today: a share is one page. The share build now writes the source into that
page, as an inert `<script type="application/json" id="proto-source">`.

Why the page and not a second KV object: no new upload against the 900 a day, no new quota, no question
of who may fetch it (anyone with the link already gets the compiled code), `review()` reads it because
it reads the HTML, a file share is forkable too, and a removed, expired or disabled link refuses a fork
by itself.

What it holds: `{ v, stack, title, owner, version, lang, theme, protos, files, designs, assets, packages,
projectImports }`.

- `protos`: each shared prototype's id and meta, cut by `trimMeta` plus the theme and `forkedFrom`.
- `files`: the code the shared variants reach through relative imports, under `protos/` and `designs/`.
  A borrowed helper from an unshared prototype comes along, without a meta.
- `assets`: pictures are not repeated. The page already holds each as a data URL, so the block holds the
  SHA-256 of that data URL per picture, and a fork finds its picture by hashing the data URLs in the page.
- `packages`: the versions of the bare packages this code imports.

## What a fork does not trust

A fork writes someone else's code into a project, and it runs in the browser on the app's own origin.

- `checkSource` refuses a path outside `protos/` and `designs/`, any `..`, an extension that isn't source,
  a hand-written `meta.ts`, and a package version that isn't a plain version (no git, URL or file specs).
  Pictures are only png, jpeg, webp, avif or gif, so no SVG with a script in it.
- A link must be on a host this Mac knows, or be a local file. Anything else is refused.
- The first run prints what would land and stops (exit 2), like a share's review. `--yes` lands it.
- Packages never install on `--yes`: they are listed, and only `--install` adds them, since install
  scripts run on this Mac.
- The agent reads forked code as quoted material, not instructions (SKILL.md).

## Host

One table, `offers` (`0009_offers.sql`, `schema.sql`, `upgrade.mjs`), and three routes:
`POST /api/shares/<id>/offer`, the `offers` list on each row of `GET /api/shares`, and
`DELETE /api/shares/<origin>/offers/<id>`. Additive, so the owner API stays 2. A host from before this
answers 404 and the CLI says it needs an update.

## The calls Tomer should check

- **Forkable by default, `--no-fork` to opt out.** Anyone with a link can read the raw source, comments
  included. Sign-up on the host is open, so other people's shares carry source too after they update.
  Off by default would leave the feature unused. When a share holds project code or real screens the
  review's existing yes-gate now also says the source is forkable.
- **The opt-out is CLI only for now.** The page's Share sheet and popover always publish forkable.
- **Offering is explicit.** Sharing a fork tells nobody; only `proto fork offer` notifies the owner.
- **Compare is side by side in the owner's page, not a new view.** The offer lands nested under the
  original. A compare view inside the link is deferred.
- **One level of origin.** A fork of a fork points at the link it came from, not the first one.
- **Project imports do not travel.** A fork of a share that imports `@project/…` lands with those imports
  broken and says which. No stub mechanism.
- **Slot picks do not travel.** A plugged-in variant's code comes along but the pick does not, so a slot
  shows its original element in the fork.
- **The host change needs a deploy.** `proto share setup` is the maintainer's call. Until it runs, forking
  works and offering says the host needs an update.

## Left out

Pulling the original's new version into an existing fork (fork again, it lands beside it). A
"Forked from" line in the viewer. Merging. Forking from a phone.
