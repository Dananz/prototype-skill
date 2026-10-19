// Hebrew, in one dictionary per part of the page so each can grow on its own.
import core from './core'
import shell from './shell'
import comments from './comments'
import panels from './panels'
import misc from './misc'

export const he: Record<string, string> = { ...core, ...shell, ...comments, ...panels, ...misc }
