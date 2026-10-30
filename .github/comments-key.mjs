// The page keeps its comments in localStorage under the app's id (one app per project), not the
// conversation's, so the checks read the key from the app's session.json.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const commentsKey = app => `proto-comments-${JSON.parse(readFileSync(join(app, 'session.json'), 'utf8')).id}`
