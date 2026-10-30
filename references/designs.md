# Designs: a pick grown into linked screens

A prototype is an exploration: one question, several options, one pick. A **design** is what the
pick grows into: a set of screens that share one look (theme, fonts, parts) and link to each other.
The page shows designs at the top of its project tree (Settings, Browsing, Project tree), each
with its flows and screens, and the explorations under each screen.

## When to make one

When the user says "make this the design", "grow this into a site", "now the About and Pricing
pages", or a comment on a variant asks for more pages in its look. Not for a second option of the
same screen: that is still an exploration.

```
proto design <slug>/<number> --title "Acme"    # that pick becomes screen 1 of design acme
proto add about --design acme --variants "A:…,B:…"           # a new screen: its options
proto add signup --design acme --flow "Sign up" --variants "…"  # in another flow
proto design acme                               # flows, screens, picks, links, links to nowhere
```

`proto design` picks the variant it is made from. A new screen arrives as an exploration (its
options), and until the user picks, its #1 stands in for it, so the flow can be walked before every
decision is made. A redo of a screen that exists is `proto add home-2 --from home/C --next`: it hangs
under the screen, and its pick is built into it.

## Links

Write links between screens in code as you build them:

```tsx
import { Go } from '../../go'
<Go to="about" className="…">About</Go>
```

`<Go to="<slug>">` renders an `<a>` and walks the page to that screen: its pick, else #1. A link to
a screen not built yet, or to one outside this design, stays put and says so. `proto design <id>`
lists every screen's links and the ones that lead nowhere; build those or remove them. React only
for now.

## Flows

Group the screens into flows by their link chains (Main, Sign up, Checkout) and name them. Move
them when the user asks:

```
proto design acme --flow "Checkout" --screens cart,pay   # move (a new flow is made)
proto design acme --rename "Checkout:Pay"
proto design acme --drop cart                            # out of the design; the prototype stays
```

## Shared parts

A design's chrome (header, footer, nav, buttons) lives once, in `src/designs/<id>/parts.tsx`, and
every screen imports it. When a pick or an ask changes something there, ask the user first whether
it is for every screen or only this one (AskUserQuestion, or a reply in the page). For "every
screen", change the part; for "only this one", copy the part into the screen's own folder and
change the copy.

## Several designs

Grow two picks into two concepts (Home #3 and Home #5) with two `proto design` calls. The second
one pins its first screen (`home/E`), so each design keeps its own version of it. Links never cross
between designs.
