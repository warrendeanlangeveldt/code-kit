# 10. Traceability map

**Status:** draft
**Outcome:** The person sees at a glance which requirements are built, tested, in progress or missing, and can drill into any of them.
**Actors:** the person
**Depends on:** 11-panes

## In scope

- A map of every requirement in the specs, grouped by spec, one cell each, coloured by state, live.
- Drill-down from a cell to the requirement, its stories and branches, and the tests that name it.

## Data

Read from `code-kit status --json`: each requirement's state (`done`, `in progress`, `todo`, `no story`, `removed`), its stories, and the tests that name it.

## Requirements

### TRACE-1 The map

A grid with one cell per requirement, a row per spec, coloured: done and tested; done but untested; in progress; todo; no story (a gap); removed (dimmed). A legend gives the counts.

**Acceptance**

- Given 40 requirements of which 3 have no story, then three cells show the gap colour and the legend reads "3 without a story".

### TRACE-2 Drill-down

Selecting a cell (keys or pointer) shows the requirement's id and title, its spec, its stories with their states and branches, and the tests that name it.

### TRACE-3 Live

The map updates within 2 seconds of a commit or a plan or spec change.

### TRACE-4 Readable without colour

Each state also has a distinct glyph, so the map reads in a no-colour terminal.

### TRACE-5 The specs' own ids

Specs written before code-kit keep the ids they have. A requirement's id is read where it's shaped like `BOOK-4`, and a story cites an id of any other shape in backticks: `` **Requirements:** `A105`, `OP.Guide.open` ``. A backticked id starts with a capital letter or a digit, so a word of code quoted on the same line isn't taken for one. Such an id is a requirement where a spec names it, standing on its own (`A105` isn't named by `A1050`, nor `OP.Guide` by `OP.Guide.open`). Its spec is the first with a line the id opens, such as its row in a table, and its title is what that line says next; failing that, its spec is the first that mentions it and it has no title. Tests prove it by naming it, as they do any requirement.

Only the ids stories cite become requirements. A project that arrives with a thousand ids of its own, most of them built before it had stories, isn't told that each is in no story.

**Acceptance**

- Given a story citing `` `A105` `` and the specs' acceptance table with a row `| A105 | the opening of a journey |`, then `status` lists A105 with that title, its spec and the story, and the story is ready to dispatch.
- Given a story citing `` `A999` ``, which no spec names, then `status` reports that the story cites A999, which no spec names, and the story isn't dispatched.
- Given a test naming A1050 and none naming A105, then A105 has no tests.

Found on 22 November 2026, in the first project taken to a cloud machine: its 989 ids come from its own spec tooling (`A105`, `T48`, `OP.Guide.open`), none shaped like `BOOK-4`, so no story written for it could be dispatched without `**Requirements:** none`.

## Open questions

| Question | Owner | Blocks |
| -------- | ----- | ------ |
