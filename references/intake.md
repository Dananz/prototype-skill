# Asking before you build (proto intake)

For something new from scratch, or when you lack context that would change the design. The user
answers in the page, on one screen, and you plan from their answers. This file is how to write the
questions.

## Ask only what you would otherwise guess

Three to six questions, no more than eight. Each one is a decision that changes what you build, and
its `why` line says so in a sentence the user can read ("Decides what sits at the top and what the big
button does"). Drop a question you would answer the same way whatever they said.

Good ones for a site or app from scratch, in this order:

1. **The main job** (one choice, with demonstrations): what the first screen is for.
2. **How it should feel** (one choice, with demonstrations): colors and type to start from.
3. **Who it is for** (many, chips): changes words, photos and what comes first.
4. **Language** (one choice): Hebrew, Arabic, Persian or Urdu are built right to left from the first line.
5. **What they already have** (many, `files: true`): a logo, photos, a price list. Each option is a drop
   target, so a file dropped on "A logo" is the logo.
6. **Anything else** (text): a name, a city, a site they like, something they would hate. Last, optional.

Write titles in the user's language and in their terms, not yours ("What's the site's main job?", not
"Select a primary conversion goal"). Every question is optional: they can leave one to you with "Let
Claude decide", and the page always allows their own answer ("Something else").

## The file

```json
{
  "ask": "Build me a website for my mom, she's a dentist",
  "title": "A few things that change what I build",
  "questions": [
    { "id": "job", "kind": "one", "title": "What's the site's main job?", "why": "Decides what sits at the top and what the big button does.",
      "options": [
        { "id": "book", "label": "Get bookings", "demo": { "html": "<div style='padding:10px;background:#f7faf9;height:100%'>…</div>" } },
        { "id": "calm", "label": "Put nervous patients at ease", "demo": { "image": "src/assets/calm.png" } }
      ] },
    { "id": "who", "kind": "many", "title": "Who are most of her patients?", "why": "Changes the words and which treatments come first.",
      "options": [ { "id": "kids", "label": "Families with kids" }, { "id": "adults", "label": "Working adults" } ] },
    { "id": "have", "kind": "many", "files": true, "title": "What does she already have?", "why": "I use what is real and make stand-ins for the rest.",
      "options": [ { "id": "logo", "label": "A logo" }, { "id": "photos", "label": "Clinic photos" }, { "id": "reviews", "label": "Google reviews", "files": false } ] },
    { "id": "more", "kind": "text", "title": "Anything else I should know?", "why": "Her name, the city, a site she likes.", "placeholder": "Dr. Ruth Levi, Ramat Gan…" }
  ]
}
```

- `ask` is the user's request in their words, shown at the top. `title` is optional.
- `kind`: `one` (pick one), `many` (pick several), `text` (free text, with `placeholder`).
- `options`: 2 to 8, each `{ id, label, sub?, demo?, files? }`. When any option of a question has a
  `demo`, the question shows as picture cards, otherwise as chips. `files: false` on an option makes it
  tick-only in a `files: true` question.
- `files: true` on a question turns its options into drop targets, with an "Anything else" row that
  also takes pasted files.
- ids are short lowercase words, unique within the question.

## Demonstrations

A demonstration is what the choice would look like, drawn small enough to take in at a glance, so the
user chooses by seeing. Two forms:

- `{ "html": "…" }`: markup drawn in a 160 by 120 box, scaled to its card. Use **inline styles or
  SVG** (the page's stylesheet doesn't know the classes you invent here). Draw it the way the real
  thing would look: its type, its colors, a button, a row of prices. No lorem ipsum, no emoji.
- `{ "image": "src/assets/<file>" }`: an image you generated or saved into the app's `src/assets/`.

Make each choice's demonstration differ in what the choice is about (the layout for a job, the
palette and type for a feel), and keep them the same size and density so none looks like the answer.
Not every question needs one: chips are right for "who" and "what do you have".

## After they answer

`proto inbox` prints each question with what was chosen ("their own words" marks a typed answer, and
"left to you" marks a question they handed back), and the path of each file they dropped, with which
option it was dropped on. Use it as the brief's facts:

- The answers go into the brief file's `facts`, and into each direction's plan (craft.md).
- A question they left to you is yours to decide: pick, and say in your reply what you picked.
- Dropped files are real assets: copy a logo or photos into `src/assets/` and use them as they are
  (SKILL.md step 2.2), don't redraw them.
- Keep to what they said. If an answer rules out a look you would have tried, don't try it.

`proto intake status` says whether the questions are still waiting. `proto intake clear` takes them
away. A second `proto intake set` while the first is unanswered needs `--replace`.
