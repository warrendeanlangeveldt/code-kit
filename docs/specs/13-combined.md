# 13. Combined lane view

**Status:** draft
**Outcome:** With Context Graph installed too, each lane shows how well its agent understood what it touched, the cards it owes, and the rules on its files.
**Actors:** the person
**Depends on:** 11-panes; Context Graph's harness specs

## In scope

- Per lane: files edited without understanding, cards owed, and the Context Graph rules on its paths, from Context Graph's command line.
- A link from a lane's file to Context Graph's pane for that file.

## Requirements

### JOIN-1 Only with Context Graph

The combined facts appear only when the project has a Context Graph graph and its command line is available; otherwise the Lanes pane is as in 11, with no empty slots.

### JOIN-2 Understanding per lane

Each lane row shows its agent's edits made without understanding (a count, red when above zero) and cards owed; the drill-down lists them with the files still unread.

**Acceptance**

- Given web edited `src/a.ts` without reading `src/b.ts`, then web's row shows "1 edit without understanding" and the drill-down names `src/b.ts`.

### JOIN-3 Rules on the lane's paths

The drill-down lists the Context Graph rules that apply to the story's files, agreed and proposed.

### JOIN-4 Open in Context Graph

From a file in the drill-down, a key opens Context Graph's pane on that file.

## Open questions

| Question | Owner | Blocks |
| -------- | ----- | ------ |
