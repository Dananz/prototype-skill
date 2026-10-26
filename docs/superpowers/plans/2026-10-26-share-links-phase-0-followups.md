# Share links, phase 0: follow-ups

Deferred findings from the phase 0 task reviews and the final review (2026-10-26), for the phases that need them. Nothing here blocks phase 0.

## Before the phase 0 PR (by hand, Tomer)

- One real `proto share setup --local` (writes the owner token to the login Keychain through `security -i`; the smoke only uses the file store).
- Open a link in Safari in both forms (`<id>.localhost:<port>/` and `127.0.0.1:<port>/s/<id>/`), and type into a design's textarea at Fit zoom (caret under CSS zoom).

## Deferred

- Task 1: scope.mjs:119,130 reuse idOf from app/numbers.mjs (accepts #2, rejects junk).
- Task 1: scope.mjs:128 pointless template literal; start re-parses words[0].
- Task 1: scope.mjs:113 pricing/B/extra silently ignores extra.
- Task 1: scope.mjs:144-148 slot kept only with a shared from; no test pins it.
- Task 2: review.mjs:170-173 abs-path has no boundary (/Users/x matches /Users/xavier), no guard for a short home, Windows path forms.
- Task 2: review.mjs:151-155 where shows 20 chars after a PEM header (key material) in the owner's terminal.
- Task 2: Bearer is case-sensitive; sk- rule hits long CSS classes (.sk-chase-…) with no override; IPv6/userinfo hosts; protocol-relative URLs not flagged; 20 MiB+1 prints 20.0; duplicate import basenames; no false-positive tests for the other patterns.
- Task 2: review.mjs overlap merge orders same-start hits by index only; partial overlap past a match doesn't extend end; startsWith(home) no path boundary; one very long comment line at 85-87; src="/x" absolute paths still one warning per path.
- Task 3: stamps.mjs:16-22 nameOf looks through any call (items.map / useMemo get the const's name; dev says the enclosing component) — only unwrap memo/forwardRef.
- Task 3: stamps.mjs:39 _jsxFileName found by name pattern only.
- Task 3: protosDir must be realpath'd or ids won't match and paths leak; Task 4 smoke must grep the final HTML for the home folder; assetsInlineLimit must be max for null-sharp inlining; CSS url()/index.html images skip the WebP load hook.
- Task 3: images.mjs:22,34 module-level warnings never reset/deduped; jsx-prod and componentName path have no unit coverage (Task 4 smoke covers).
- Task 3: rotate behavior proven only against a fake sharp; add a real orientation-6 fixture once sharp is installed (Task 4/7).
- Task 4: CSS url()/index.html images stay PNG (spec item 8); Google Sans ships every subset (~1 MB/share); Vue sessions untested in share mode; inline.mjs:38 escape <!-- and <script too; build.mjs:478 child build has no timeout; build.mjs:497 lock skipped if temp cleanup throws; stale-lock pid reuse / double takeover; lineage images missed (fixed if import-graph scan is used).
- Task 4: slot with no recorded holder still kept (fallback leak, no smoke case); reached non-code files become Tailwind @source entries; template-literal import()/import.meta.glob/.js->.ts not followed (fail closed); image() in helpers under src/ outside protos not scanned (picture dropped); Audio/Worker/sendBeacon URLs not reviewed.
- Task 5: desk.tsx:71 zoom floor can go below 0.05; index.tsx:39 matchMedia per render; desk fonts.ready late fitAll after a prototype switch; share-link-checks.mjs:187/:324 smoke session left with lang he / many prototype on failure; desk aria-label says Ctrl on Mac.
- Task 5: Space-drag in a mount may also select text; textarea caret offset under CSS zoom at non-100% (claimed Chrome hit-testing, unproven); smoke rewrites share-link/C.tsx in the smoke session.
- Task 6: DELETE removes KV before the D1 tombstone (500 instead of 410 in the gap); concurrent PUTs both take old+1 (use a conditional upsert, 409); owner auth writes last_used_at on every call (D1 write budget); POST reserves ids without an owner; api/state ignores expires_at; top-level catch returns HTML for /api; 413 content-length path untested; 301/405/_health lack nosniff/noindex, no ETag on no-cache documents; same() comment overstates; og:<id> key deleted but never written.
- Task 7: token file written before chmod / config dir 755; shares.json read-modify-write outside the build lock; snapshot and sourceHash taken after upload; references/share.md:21 owner naming order reversed; setup/stop need a session; local path mode puts all shares on one origin (phase 1 concern); smoke Keychain check only tests existence.
- Task 7: host binds 127.0.0.1 only while links say localhost (browsers may try ::1 first); setToken doesn't read back.
- Final review: viewer ignores the URL hash (deep links land on the start design; for phase 1's Copy link); the noscript injection needs a bare `<body>`; a token lost and repaired leaves the old token row unrevoked.
