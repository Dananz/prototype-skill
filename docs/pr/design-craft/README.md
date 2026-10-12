# Before / after: craft.md

Three new-product prompts (`bench/*.txt`), each run once on `main` (f3a5773) and once on this
branch, headless (`claude -p`, Opus, same prompt, the skill loaded with `--plugin-dir`), all six
at the same time. `bench/bench.mjs` times each run from the session folder, once a second.

| Prompt | Arm | Link ready | First variant on screen | All 4 written | Final reply | Cost |
|---|---|---|---|---|---|---|
| Pricing | before | 10 s | 67 s | 3:37 | 3:58 | $1.52 |
| Pricing | after | 11 s | 101 s | 4:41 | 5:09 | $3.13 |
| Landing | before | 10 s | 99 s | 6:03 | 6:28 | $4.39 |
| Landing | after | 12 s | 103 s | 8:17 | 8:36 | $5.57 |
| Sleep app | before | 10 s | 238 s | 7:14 | 8:04 | $4.26 |
| Sleep app | after | 12 s | 133 s | 5:59 | 6:17 | $3.97 |
| **Mean** | before | 10 s | 135 s | | 6:10 | $3.39 |
| **Mean** | after | 12 s | 112 s | | 6:41 (+8%) | $4.22 (+25%) |

One run per arm: the timings are indicative, and the spread between prompts is larger than the
difference between arms. Two processes stayed alive after their final reply (a late scheduled
self-check, a lingering process); "Final reply" is when the last reply was written.

What changed in the output:

- **Pricing.** Before: all four variants in one look, cream paper, a serif headline, a terracotta
  accent (the first default craft.md names). After: four looks taken from what Loomwork does (a
  review canvas with comment pins, a compare sheet, a receipt, a design-tool inspector).
- **Landing.** Before: three cream and condensed-serif pages and one teal. After: four distinct
  looks (a swim-window chart, a lifeguard board with the flag, a dawn notification, a coastline
  map you tap).
- **Sleep app.** Before is the most cohesive (one dark iOS look with a gold accent, four
  layouts). After varies more (a tide line, a light morning report, a dial, one step at a time);
  closer to a tie here.

The isolation check passed: every after session has the font kit and `.proto/briefs/`, no
before session does.
