# 24. Designs handed over

**Status:** draft
**Outcome:** A lane builds every screen from the approved design itself, every state of it, from files in the repository, whatever tool the design was made in, and the review checks the build against that design, so nobody has to audit the screens against the designs afterwards.
**Actors:** the person (approves each design); the lead (designs with the person, exports what's approved, reviews against it); lane agents (build from the exported files); the hooks (refuse a register entry with no files)
**Depends on:** 07-reviewer, 17-onboarding (the design gate and design stories), 20-lean-lead (dispatch and reports)

The design gate (ONB-2) refuses a screen until the design register lists it, and that's all it checks. On a real project the register's entries named the design tool and an artboard (`"design": "paper:<file id> — Booking list"`), and the lane agents, which have no connection to the design tool, built each screen from the spec's words. They built a fraction of what the designs showed: the states the spec described in a line, the layouts it didn't describe at all, and copy of their own. Every build passed the gate, and the gaps came out only in an audit the person ran by hand, screen by screen, against the design tool.

The design tool's connection is the lead's, in the lead's session, so the approved design has to leave the tool as files before anyone else can use it. A design tool that works in code, such as Paper, gives the screen as JSX with its exact layout, spacing, copy and tokens, which is more precise than a picture; Claude Design and artifacts are HTML. A picture of each state still matters for the review, to see at a glance whether the build looks like the design.

## Decisions

| Date       | Decision                                                                                               | Why                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-23 | An approved design is files in the repository: each state's code where the tool gives it, and a PNG    | Lanes can't reach the design tool, and the file is what was approved even after the tool's copy changes                                               |
| 2026-10-23 | No design adapters: the design skill says how to export from each tool, and the gate checks the result | Exporting runs through the tool's own connection in the lead's session, which code-kit's code can't call; the files can be checked whatever made them |
| 2026-10-23 | Lanes don't get the design tool's connection                                                           | It needs the tool running with the file open, and it shows the live design rather than the approved one                                               |
| 2026-10-23 | The export is the target to match, not code to paste                                                   | It's the tool's own markup with inline styles; the screen is built from the project's design system and components                                    |

## In scope

- Exporting each approved screen's states into `design/`, from any design tool, when the person approves them.
- A register entry that names those files, with a hash of each.
- The gate and `verify` refusing an entry whose files aren't there or have changed.
- Dispatch giving the lane its screens' design files, every state.
- The review comparing each built state with its design.
- Handing over designs approved before this spec, once.

## Out of scope

- Pixel comparison with a threshold. The review compares the build with the design by eye, from the screenshots side by side, and names each difference.
- Designing itself, which `/code-kit:design` already does with the person.

## Data

| Entity         | Field    | Type   | Required | Rules                                                                                              |
| -------------- | -------- | ------ | -------- | -------------------------------------------------------------------------------------------------- |
| Register entry | file     | path   | yes      | The code file the lane writes, as today                                                            |
| Register entry | story    | id     | yes      | The design story that approved it                                                                  |
| Register entry | approved | date   | yes      | When the person approved it                                                                        |
| Register entry | screen   | text   | yes      | The screen's name, as the spec's `## Screens` section names it                                     |
| Register entry | states   | list   | yes      | One per state the spec lists (default, empty, loading, error, and any others), each a State        |
| Register entry | tokens   | path   | no       | The design tokens the export uses, as JSON (`design/tokens.json`)                                  |
| Register entry | source   | object | yes      | `{ tool, ref }`: the tool it was made in and where (a file id and artboard, a URL), for the record |
| State          | name     | text   | yes      | `default`, `empty`, `loading`, `error`, or the spec's own name for it                              |
| State          | code     | path   | no       | The state as the tool's code (`.jsx`, `.html`); left out only when the tool gives none, with `why` |
| State          | image    | path   | yes      | A PNG of the state at the size the product targets, at 1x or 2x                                    |
| State          | viewport | text   | yes      | The size it was drawn at, such as `390x844` or `1440x900`                                          |
| State          | sha256   | object | yes      | `{ code, image }`: the hash of each file as approved                                               |
| State          | why      | text   | no       | Why there's no code, when there isn't                                                              |

Files live at `design/<area>/<screen>/<state>.<ext>`, such as `design/bookings/list/empty.png` and `design/bookings/list/empty.jsx`. One design can serve several code files, such as the web and the mobile screen: each code file has its own entry, naming the same states.

## Requirements

### HAND-1 An approved design is exported as it's approved

When the person approves a screen in `/code-kit:design`, the lead exports every state the person approved into `design/`, before it writes the register entry: the state's code where the tool gives code, a PNG of it, and the tokens once per project. The skill says how for each kind of tool:

- **Paper:** `get_jsx` and `get_computed_styles` for each artboard, `export` for its PNG, `get_tokens` for the tokens.
- **Figma:** its MCP server's code and screenshot tools for each frame, and its variables for the tokens.
- **Claude Design and artifacts:** the page's HTML, read through the artifact; a headless browser's screenshot of each state for the PNG.
- **Pencil, or HTML files under `design/`:** the HTML is already the code; a headless browser's screenshot gives the PNG.
- **Anything else:** whatever code it gives, and the PNG; a tool that gives no code has an image only, and the state says why.

The export is the approved design as it was approved: an artboard changed after approval is a new approval.

**Acceptance**

- Given the bookings list approved with its default, empty and error states in Paper, then `design/bookings/list/` holds `default.jsx`, `default.png`, `empty.jsx`, `empty.png`, `error.jsx` and `error.png`, and the register entry names all six with their hashes.
- Given a screen designed in a tool with no code export, then its states have images only, and each says why there's no code.

### HAND-2 The register holds files, and the gate checks them

A register entry names the exported files (Data, above). Writing the register is refused, and `code-kit verify` reports a problem, when an entry's state names a file that isn't committed, a file whose hash isn't the one recorded, or no image; or when a state the spec's `## Screens` section lists for that screen has no entry. The refusal names the screen, the state and the file, and says to export it from the design tool.

**Acceptance**

- Given a register entry whose `empty` state names `design/bookings/list/empty.png` and no such file, then the write is refused, naming the bookings list's empty state and the missing file.
- Given `design/bookings/list/default.jsx` edited after approval, then `verify` reports its hash differs from the approved one.
- Given the spec lists a loading state for the bookings list and the entry has none, then `verify` reports the loading state as not designed.

### HAND-3 The lane is given the design

Dispatching a story that builds a screen gives its lane the screen's register entries: each state's code and image path, the tokens file, and the viewport. The brief says to read every state's image and code before writing the screen, to match the layout, copy, spacing and states exactly, and to build it from the project's design system and components rather than pasting the export. The lane's report lists each state with what it built for it.

**Acceptance**

- Given ST-12 builds the bookings list with three approved states, then its brief names all three states' files, and its report accounts for all three.

### HAND-4 The review compares the build with the design

The lead's review of a screen story, with the reviewer, takes a screenshot of each built state at the design's viewport, through the project's end-to-end runner or a headless browser, and sets it beside the design's PNG. Each difference in layout, copy, components or a missing state is a finding: a blocker for a missing state or layout, a nit for spacing within the design system's scale. A state the build can't serve yet (the contract has no field for what the design shows) is accounted for in the report with what's missing, and becomes a story, not a gap nobody sees.

**Acceptance**

- Given the bookings list built without its empty state, then the review blocks it, naming the empty state and its design file.
- Given the design shows each booking's deposit and the contract has no deposit field, then the review records it as not buildable yet, naming the field, and the lead adds a contract story for it.

### HAND-5 Designs approved before this, handed over once

`code-kit next` names register entries that point at a design tool rather than files ("6 approved screens are only in Paper: hand them over with /code-kit:design"). `/code-kit:design --hand-over` exports each of them as HAND-1 does. Since the tool's copy may have changed since it was approved, the person confirms each one is still the approved design before its entry is rewritten. Then, for each screen already built, the lead compares the build with the export as HAND-4 does, and each difference becomes a fix story in the plan.

**Acceptance**

- Given 6 entries naming Paper artboards and no files, then `next` names the 6, and `--hand-over` exports each, asks the person to confirm it, and rewrites its entry with files and hashes.
- Given one of those screens already built without its error state, then the hand-over adds a fix story for the error state, citing the screen's requirements.

## Open questions

- Whether the reviewer's screenshots of the build are kept with the review, under `.claude/state/reviews/`, for the person to see in the pull request. Owner: the person. Blocks: nothing in HAND-4's first release.
