// What a variant shows instead of itself: while it is building and nothing has rendered yet, a
// quiet box; once it is built, its error. Shared by the shell and the framework adapters.
export const BUILDING_CLASS = 'grid min-h-full place-items-center p-10 text-xs text-zinc-400'
export const ERROR_CLASS = 'm-4 whitespace-pre-wrap rounded-lg bg-rose-50 p-4 text-xs text-rose-700 dark:bg-rose-950 dark:text-rose-200'

/** A variant's file (/src/protos/today/C.tsx, also as a full path) as its prototype and letter; null for any other file. */
export const refOfPath = (path: string) => {
  const m = path.match(/\/src\/protos\/([^/]+)\/([A-Z]{1,2})\.\w+(?:[?#]|$)/)
  return m ? { proto: m[1], variant: m[2] } : null
}
