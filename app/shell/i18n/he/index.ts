// Hebrew, in one dictionary per part of the page so each can grow on its own.
import core from './core'
import shell from './shell'
import comments from './comments'
import comments2 from './comments2'
import panels from './panels'
import misc from './misc'
import viewer from './viewer'

export const he: Record<string, string> = { ...core, ...shell, ...comments, ...comments2, ...panels, ...misc, ...viewer }
