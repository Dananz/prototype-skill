# Comments from the page

Read when `proto inbox` prints a batch, before handling it.

The user can leave comments on the design in the page (the Comment button, or C): click an
element (or, on a phone, hold a finger on a spot), write, tag other elements with `@`, attach a
screenshot and mark it up (or paste an image with Ctrl/⌘ V, or drop one on the comment), then send
every draft at once. Commenting never reaches the design, so a menu or popover open in it stays
open and what is in it can be commented on. The side panel's Comments tab lists
them and shows what became of each. `@` opens the existing visual picker to tag another
element. Do not author special comment-element names or a catalog of elements. The outline
and numbered references identify selected targets; source locations are stamped automatically.
The design's native accessibility labels and semantics must remain intact. Keep `data-shoot` only where a QA/state selector
needs it; Comments does not use it as a display name. Existing comments keep their targets. Each send is a batch waiting for you in the app's inbox. You hear
about it only while you listen, so **at the end of every turn in a prototype session,
listen**: run, in the background, with the Bash tool's longest timeout (2 hours),

```
proto inbox --wait
```

It exits when a batch arrives (printing it), which wakes you; after 115 minutes with nothing
it exits saying so, and you listen again. If one is already listening it says so and exits;
leave it. `proto inbox` without `--wait` takes whatever is waiting now and tells you whether
something is listening.

Each comment prints its route (`<slug>/<letter>[/<state>]`), the user's words, the element
it is on (tag, text, `data-shoot` or selector, its box in CSS px from the variant's top left,
and where it is written: its file from the app's folder, line and component, as
`src/protos/today/parts.tsx:30 (PriceCard)`; open it there) and any elements it tags (numbered `with @1`, `with @2`, matching the comment), and the absolute path of each image attached to it:
`(marked up)` is a screenshot of the design, `(pasted by the user)` an image they pasted or
dropped (a reference, another app, anything). A comment
pinned to a spot with a long press (on a phone, where no element fit) prints `at:` the spot, in
the same px, and `in:` the element under it: the change is about that spot, not the whole
element. The user can delete a comment after sending it: one deleted before you took its batch
never reaches you, and one deleted after is withdrawn: `proto inbox` leaves it out (the batch
line counts it, `(1 withdrawn in the page)`) and `proto reply` to it says so. Leave a withdrawn
comment alone. Read every image. Then, per comment:

1. The same as a request typed in chat: `proto ask` (or `proto work … --ask`) in the user's
   words, then edit the variant.
2. For optional extras, recheck the batch's `batch.json` for `withdrawn` before editing and
   before replying. A withdrawn request is canceled: stop optional work, and do not claim delivery.
   If no useful extra applies, reply with that reason and `--done`, so it can be requested again.
   `proto reply <batch>/<n> "<what you changed, one line>" --done` (Codex adds `--as codex`, which
   puts its mark beside the reply instead of Claude's). The page shows it on the
   comment. A comment you can't act on gets a reply without `--done` saying why.
3. When the batch is handled, listen again.

**A comment on the motion** (written in the motion dock, under a variant with `useMotion`) is on a
moment or a range of its take rather than an element: its `at:` is a time, `at: 0.35 s` or
`at: 0.30–0.62 s`, with the take's length and the shoot that shows it. Run that shoot (`--at 350`,
or `--frames 8 --at 300-620` for a range) and read it, change the motion, shoot it again to see the
change landed, and reply with the new timing in numbers ("damping 0.75 now: the sheet overshoots
4 px instead of 14 and settles by 0.50 s"). The page records the take again after your edit, and
the reply shows on the comment's point on the slider.

**A comment in a view** (written while the page showed another size, see the top) has a `view:`
line, `view: desktop 1440x900`, and is about that layout, not the one the batch's page size says.
Run the shoot the line names (`proto shoot <route> --size 1440x900`) and read it, change that
layout (its breakpoints, so the other sizes stay as they were), shoot it again, and name the size
in the reply ("On desktop the heading is 28 px now; phone and tablet as before").

**Decisions from the page** arrive in the same batches, as comments with an `action:` line and
no element (a `copy` choice is on its line's element); the user's optional note follows a colon in
the text.

| `action:` | Already done | You |
|---|---|---|
| `pick` | marked, the working variant, and the comment done, unless its line says otherwise | do what the note asks, if anything; a reply is only a note. When the line says it wasn't marked or the working variant didn't move, run the `proto pick` it names |
| `unpick` | the pick is off, and the comment done | nothing. When the line says nothing changed (that variant wasn't the pick), say so in a reply with `--done`; when it says it wasn't taken off, run the `proto pick … --off` it names |
| `more` | nothing | new letters in the same prototype, named after it (`proto add <slug> --variants "D:…"`); reply with what you added |
| `build` | nothing | `proto pick` it if it isn't the pick, then references/build.md; reply when it is in |
| `try-it` | queued only; no content generated yet | check that the request is not withdrawn; add useful `useHints` to this variant only (references/try-it.md), preserve its working flow, verify it, then reply `--done`; if it already has useful hints, reuse them |
| `copy-options` | queued only; no alternatives generated yet | check that the request is not withdrawn; add `useCopy` (references/copy.md) to the requested lines in this variant only (headline and primary text/CTA without a note), current words first, verify fit, then reply `--done`; reuse existing options |
| `copy` | nothing (one comment per line changed since the last send, on that line's element; the text says option k of n, their own words, or back to today's words) | put the chosen words first in that line's `useCopy` options and keep the rest; then one `proto reply <batch> "…" --done` for the batch, in one line. The page drops its own choice once the words are first |
