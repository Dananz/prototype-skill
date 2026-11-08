# prtype.dev router

prtype.dev is two Workers behind this one. `worker.mjs` (the Worker `prtype-site`, which owns the
custom domain) has no files of its own: it hands the share host's paths (`/s/…`, `/api`, `/auth/…`,
`/_health`, `/me/api/…`, and a share's short link `/<id>`) to the share Worker (`proto-share`, bound as
`HOST`), and everything else to the Next.js app in `../web` (`prtype-web`, bound as `WEB`): the landing
page, its files (`og.png`, `og-share.jpg`, `favicon.svg`, `robots.txt`, `llms.txt`, `sitemap.xml`), `/me`
and `/_next`. See `../web` for the pages and `references/share.md` for the share host.

`src/components/logo.tsx` stays here for prototypes that import the mark through
`@project/site/src/components/logo`; the app has its own copy (`../web/components/landing/mark.tsx`).

## Deploy

`proto share setup --domain prtype.dev` deploys all three, in order. By hand, each with the share
tools' wrangler login, in this order (a binding to a Worker that does not exist fails the deploy):

1. the share host (`proto share setup`);
2. the Next.js app: `cd ../web && pnpm install && XDG_CONFIG_HOME=~/.prototypes/share-tools/wrangler-home pnpm run deploy`;
3. this router: `XDG_CONFIG_HOME=~/.prototypes/share-tools/wrangler-home ~/.prototypes/share-tools/node_modules/.bin/wrangler deploy`.
