// The links a variant's code makes to other screens of its design: <Go to="about">. Read from the
// source, so the agent's links are known without running the design (proto design, the map's lines).

/** The <Go to> targets in a source text, each once, in order. */
export function linksIn(text) {
  const out = []
  for (const m of String(text).matchAll(/<Go\b[^>]*?\bto=["']([a-z0-9][a-z0-9-]*)["']/g)) if (!out.includes(m[1])) out.push(m[1])
  return out
}
