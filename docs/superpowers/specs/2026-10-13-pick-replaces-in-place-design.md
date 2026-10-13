# A pick replaces the thing it was made from

Date: 2026-10-13
Status: approved in conversation, spec for review

## Problem

A user points at one element (say a button) in a variant (`home/B`) and asks for variants of it.
Claude builds a new prototype from it (`proto add button --from home/B`) with A "Current" (the
button as built) and B to E. Today the user can pick one of them, but the pick only marks it:
`home/B` still shows the old button. The user wants the pick itself to put the chosen button into
`home/B`, replacing Current there.

Today `--from` is lineage only. It names the parent variant, not the element, and the child's
variants are standalone files with no way to stand in for the part they were made from.

## Decisions (from the conversation)

1. **Where a pick lands: only the variant it was made from.** Picking `button/D` changes the
   button in `home/B`. The other `home` variants and other uses of the same component are
   untouched.
2. **How: live in the page, instantly.** The swap is a pointer in meta, not an edit of
   `home/B.tsx`. No agent round trip. Pick another variant and it follows; unpick (or pick
   Current) and the original is back.
3. **The other options stay in the button prototype**, as picks work today: the pick outlined,
   the rest faded but present. `home/B` gets no extra control.
4. **React first.** Vue and Svelte stacks get a `Slot` adapter later (each stack has its own
   adapters in `app/adapters/`).
5. **Source is not rewritten.** `home/B.tsx` keeps the original markup as the slot's default. A
   build (`proto handoff`) reads the pointer, so "build home/B" builds with the pick.

## Design

### Data

`home/meta.ts` gains the slots the prototype hosts:

```json
"slots": { "cta": { "variant": "B", "use": "button/D" } }
```

- `variant`: the variant of this prototype that holds the slot.
- `use`: the `<slug>/<letter>` currently plugged in. Absent means the original markup.

`button/meta.ts` gains where it plugs in, next to the `from` it already has:

```json
"from": "home/B", "slot": "cta"
```

### The slot in the parent variant

When the user asks for variants of a pointed element, Claude first lifts that one use out of
`home/B.tsx` into a slot. The original markup stays inside as the default:

```tsx
import { Slot } from '../../slot'

<Slot proto="home" id="cta" label="Continue" onClick={next}>
  <button className="…">Continue</button>
</Slot>
```

`Slot` (`app/adapters/slot.react.ts`, installed as `src/slot.ts`, as hints and copy are):

- Reads the resolved pointers from the dev server (`slots` in `/__proto/status`, which skips an
  archived or missing child) once at load, and again whenever the server announces a `meta.ts`
  edit (`proto:edit`). It loads the child's variant file with a lazy glob over
  `./protos/*/[A-Z].{tsx,jsx}`.
- No `use`, or anything wrong with it (missing file, child archived, failed load): renders its
  children, the original.
- A `use`: lazy-loads that variant and renders it with the props the slot was given, inside an
  error boundary whose fallback is the children, so a variant that throws never breaks `home/B`.
- Is a plain wrapper otherwise: no DOM of its own, so layout is unchanged.

Source stamping (`data-proto-src`) is untouched: comments on the swapped button in `home/B`
point at `button/D.tsx:<line>`, which is where it is written.

### The child prototype

`proto add button --from home/B --slot cta --variants "A:Current,B:…,C:…,D:…,E:…"`:

- `--slot` requires `--from <slug>/<letter>` with a letter, and the parent variant's file must
  contain `<Slot proto="<slug>" id="<id>"`. If it does not, the command stops and says to lift
  the element first.
- Writes `slot` into the child's meta and registers `slots.<id>.variant` in the parent's meta.
- A is the lifted original, written to match it exactly (the existing Current rules). B to E are
  drop-ins: they read the slot's props with defaults, so they also render alone on their own
  artboard.

### The swap

A pick on a prototype that has `slot` does what it does today (`meta.picked`, working variant,
history "Picked D") and also sets the parent's `slots.<id>.use`:

| Event | Slot pointer |
|---|---|
| Pick `button/D` | `use = "button/D"` |
| Pick `button/A` (Current) | cleared, so the original markup renders |
| Unpick `button/D` while D is the pick | cleared |
| Pick `button/E` after D | `use = "button/E"` |
| Archive `button` | ignored by `Slot` (original renders), pointer kept |

The same rule lives in the dev server (`pick()` in `app/server.mjs`, the page's pick) and in
`proto pick` (`scripts/proto.mjs`), which already duplicate the pick write.

The dev server already sends `proto:edit` for every file under `src/protos`, so the mounted
`Slot` hears the pointer change and re-renders without a reload.

### What else reads the pointer

- `proto handoff home/B`: a "Slots" section naming each slot, the variant it currently points
  at and that file, and that file joins the "Files" list. The build uses the pick, not the
  default.
- `proto shoot home/B`: the live page, so it shows the swapped button with no change.
- `proto inbox`: a pick on a slotted prototype says it was swapped into `home/B`, so Claude does
  not edit source for it.
- The page: the switcher dropdown's description panel for a prototype with a slot adds
  "Plugs into Home B" beside "Picked" and "N built from it". Nothing else is added.
- `SKILL.md`: when and how to lift an element (section 4), the props contract, the pick table.

## Out of scope

- Writing the pick into `home/B.tsx` (decided against).
- A flip-in-place control on `home/B` (offered, declined).
- Swapping every use of a shared component (decision 1).
- Vue and Svelte adapters.
- Slots on elements that only exist in a state (a menu item): the slot works there as in any
  place the `Slot` is rendered, but nothing special is built for reaching it.

## Risks and edge cases

- **Why not read `meta.ts` through a glob.** An eager glob would make `slot.ts` a dependent of
  every `meta.ts`, so each pick would walk HMR up through the variants that import it. Fetching
  the pointers keeps `slot.ts` a stable module that nothing re-evaluates.
- **First paint.** `slot.ts` awaits its first read at the top level, so a variant never paints
  the original and then swaps.
- **A slot inside a loop.** One written use is one slot, so a list's every item swaps. Matches
  "one use only", and is noted in SKILL.md.
- **Props contract.** A drop-in only works if it reads the props the slot passes. A variant that
  ignores them renders but loses behaviour (a click does nothing). SKILL.md says drop-ins accept
  the slot's props, with defaults for standalone.
- **Source edited while a pointer is set.** If `home/B.tsx` loses its `<Slot>`, the pointer is
  inert, and `proto add --slot` on the next variant says so.
- **Both pick paths drift.** The server and the CLI each write meta; a smoke check covers both.

## Testing

A new `.github/slot-checks.mjs`, wired into `.github/smoke.mjs` like the other checks:

1. `proto add home` with a `B.tsx` that has a `<Slot>`; `proto add button --from home/B --slot cta`
   with A to C. Assert the parent's `slots.cta` exists and `proto add --slot` refuses a parent
   without a `<Slot>`.
2. In the page, pick `button/C` through the comments endpoint. Assert `home/meta.ts` has
   `use: "button/C"` and `#/home/B` renders C's text. Pick A: the original text. Pick C then
   unpick: the original text.
3. `proto pick button C` and `--off` give the same pointer changes as the page.
4. A variant that throws renders the original, and `home/B` stays up.
5. `proto handoff home/B` lists the slot and C's file.

Quick CI (`node --check` on `*.mjs`, `proto stack`) must still pass.
