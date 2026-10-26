// Which page this is: the owner's session (the dev server) or a share, built by `vite build --mode
// share` (app/share/build.mjs). The share build defines __PROTO_SHARE__ with the share's own facts
// (app/share/plugin.mjs); the dev server defines nothing, so it is read only behind the mode.
type ShareDefine = { title: string; owner: string; version: number; updatedAt: string; scope: { protos: { id: string; variants: string[] }[]; start: string } }
declare const __PROTO_SHARE__: ShareDefine | undefined

export const SHARE: boolean = import.meta.env.MODE === 'share'

const defined = SHARE && typeof __PROTO_SHARE__ !== 'undefined' ? __PROTO_SHARE__ : null

/** What the viewer says about the share: its title, who shared it, its version and when. */
export const shareInfo: { title: string; owner: string; version: number; updatedAt: string } | null =
  defined ? { title: defined.title, owner: defined.owner, version: defined.version, updatedAt: defined.updatedAt } : null

/** The prototypes and variants of the share, in the order they were named, and the route it opens on. */
export const shareScope: ShareDefine['scope'] | null = defined?.scope ?? null
