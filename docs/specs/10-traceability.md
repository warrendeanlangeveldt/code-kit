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

## Open questions

| Question | Owner | Blocks |
| -------- | ----- | ------ |
