# 27. The mod, redesigned

**Status:** draft
**Outcome:** At a glance, the person can tell whether the build is moving, what needs them, where each story is, whether it's what they asked for and whether it's built right, from one pane with no tabs, a band that only speaks when they're needed, and keys shown wherever they work.
**Actors:** the person
**Depends on:** 01-lanes-pane, 02-waiting-band, 10-traceability, 11-panes, 14-mission-and-maps, 15-decisions-and-journal

The mod grew a feature at a time, and each one found a place: a row in the band, a strip in the pane, a tab. It now shows too much in two places and hides the rest behind seven tabs:

- **The band and the pane both try to show everything.** The band holds the mission's four rows, decisions of eight kinds, team items, warnings and notes; the pane repeats the decisions as a pinned strip above its tabs.
- **Seven tabs**, four of them (Journal, Code map, Trail, Usage) places the person has to remember to visit.
- **Keys that change meaning.** A digit presses a button in the band and switches a tab in the pane; fifteen letters act on the selected lane, and which work depends on the tab.
- **Sentences where a picture reads faster**: decision cards, journal lines and lane rows written out in full.

What code-kit shows that no agent dashboard can is whether the work is what was asked for (the trail: requirement, story, code, tests) and whether it's built where the architecture says (the code map: layers, ownership, imports, understanding). Today both are tabs. This spec puts them on every story, in miniature, and makes everything else answer one of five questions:

1. **Is the build moving?** The Build panel.
2. **What needs me?** The Needs you panel, and the band.
3. **Where is each story?** The Lanes panel.
4. **Is it what I asked for?** Each story's trail, and the build's progress counted in requirements.
5. **Is it built right?** Each story's map.

[Flightdeck](https://github.com/scasella/claude-flightdeck) (a Claude Code mod that shows a session's agents) is the reference for how, not what: a panel per question, a status line first, panels that take no room when empty, pictures over prose, motion only while work flows, few keys, a layout per space, and its drawing as pure functions tested at every width.

## Decisions

| Date       | Decision                                                                             | Why                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-26 | One pane of panels, no tabs                                                          | A tab is a place to remember to go; a panel with something to say is seen                                                                             |
| 2026-10-26 | The trail and the code map go on every story card, in miniature                      | They're what code-kit proves that nothing else does, and a story is where the person looks                                                            |
| 2026-10-26 | Progress is counted in requirements tested, not stories merged                       | A milestone with every story merged and half its requirements untested isn't done                                                                     |
| 2026-10-26 | A digit always presses the button showing it, in the band and the pane               | One meaning per key; tabs no longer need digits                                                                                                       |
| 2026-10-26 | Characters are redrawn bigger, each lane its own shape, animated by the kind of work | They're how the person tells lanes apart and sees work happen; tint alone fails colour-blind people and the 6×6 set can't show what an agent is doing |
| 2026-10-26 | Motion means work, as VIEW-3 says, plus a short one-off at each event                | Constant motion is noise; a story arriving, handed back, sent back or merged is news                                                                  |
| 2026-10-26 | Animation runs on the surface's own frame clock, in surface modules                  | Only the character or the line moving redraws, without a round trip through the hooks module every frame                                              |
| 2026-10-26 | Pull requests #89 and #90 close                                                      | They added a second way of drawing the same lanes, decorated the tabs this spec removes, and animated waiting and idle characters against VIEW-3      |

## In scope

- The pane's panels, their order and what each holds; the views opened from them; the band; the keys; three layouts; the characters and their animation; how the drawing is built and tested.

## Out of scope

- What the mod can do: every action, decision kind, view and setting it has stays, reached differently.
- Enforcement, the CLI's JSON and the hooks: the pane reads what it reads today.

## Replaces and keeps

- **Replaced:** VIEW-1 (counts header) by the Build panel; VIEW-5 (the pinned strip) by the Needs you panel; VIEW-6 (keyboard) by UI-8; VIEW-8 (layouts) by UI-10; LANES-1 (the loop as a card) by the Build panel; LANES-2 (lanes on fixed columns) by the story cards; MISSION-1 (the band's mission rows) by the Build panel and UI-9; DECIDE-3 (the Decisions tab) by the Needs you panel; the tabs of specs 11 and 14.
- **Changed:** VIEW-3 by UI-11 and UI-12 (the characters).
- **Kept as they are, reached from a story or a command:** VIEW-2 (timelines), VIEW-4 (liveness), VIEW-7 (the story's view), WATCH-1, LANES-3 (a lane's stories), MAP-1 to MAP-5, TRAIL-1, TRACE-1 to TRACE-4, JOURNAL-1, BAND-1 to BAND-3, MISSION-2, MISSION-3, DECIDE-2, DECIDE-4, NOTIFY-1.

## Requirements

### UI-1 One pane of panels

`/lanes` opens one page of panels, in this order: **Build**, **Needs you**, **Lanes**, **Queue**, **Log**. Each starts with one status line: its name, its state in a word or two, and a count at the right ("Lanes · 3 at work · 7"). A panel with nothing to show takes no room: Needs you with nothing waiting, Queue with nothing queued. There are no tabs.

**Acceptance**

- Given nothing waiting and an empty queue, then the pane shows Build, Lanes and Log, and no empty panel.
- Given the pane at any width, then each panel's first line holds its name, its state and its count.

### UI-2 Build: is the build moving?

The Build panel shows the milestone being built and a bar of its requirements by state, from the trail: tested, built but untested, in progress, todo, each its own colour and glyph, with the counts beside it ("Milestone 3: Booking · 9 of 14 tested · 3 untested"). Beneath it, the loop's state with Pause or Resume, and the step `next` reports, with what follows it. When a requirement turns tested, its segment of the bar fills once.

**Acceptance**

- Given milestone 3 with 14 requirements, 9 tested, 3 built but untested and 2 todo, then the bar has those three segments with those counts, and the line names milestone 3.
- Given every story of a milestone merged and 3 of its requirements untested, then the panel says 3 untested, not done.

### UI-3 Needs you: what needs me?

Everything waiting on the person is listed here, and only here in the pane, most urgent first: a held call, then the lead's questions, approvals, merges and reviews that are the person's, stalls, the brief's open questions, notes. The first is open, with its story, what it's for and its buttons; the rest are one line each. Choosing one opens it in its place. Its full card (DECIDE-2's lineage) is Enter away.

**Acceptance**

- Given a held call and two approvals, then the held call is open with Approve and Refuse, and the approvals are a line each beneath it.

### UI-4 Lanes: where is each story?

Each lane at work is a card, the lead's first: its character, the lane, the story's ID and title, its state at the right, the agent's current tool and how long since (VIEW-4, the clock ticking on its own), and two small pictures:

- **Its trail:** a cell per requirement the story cites, coloured as in the Trail (tested, built but untested, in progress, todo), so the person sees coverage grow as the story moves.
- **Its map:** the layers its changed files are in, each a chip. A chip is red while the story has a layer problem or a refusal unresolved, and amber where a changed file's card (an adapter's, such as Context Graph) isn't written or is out of date.

Lanes with nothing at work fold into one line ("resting: api, data, qa"). When the cards no longer fit side by side and stacked within the panel's height, the lanes become swimlanes on the shared time axis (VIEW-2), one line each, with the same state, trail cells and character.

**Acceptance**

- Given web building ST-4, which cites BOOK-1 tested and BOOK-2 todo, and has changed files in `ui` and `domain`, then web's card shows two trail cells (tested, todo) and chips for ui and domain.
- Given ST-4 refused for a layer rule and not yet fixed, then its domain chip is red.
- Given three lanes resting, then they show as one line.

### UI-5 Queue and Log

The Queue panel shows the merge queue while it isn't empty: each branch, its story, the commit its review passed and its state. The Log is the build's latest events from the journal and the loop, one line each: the time, a glyph for the kind, and what happened ("14:02 ✓ ST-4 merged · web"), the person's own in yellow; the Journal view holds the rest.

### UI-6 Views, from the story or a command

The full views open over the pane, and Escape brings it back:

- **Story** (VIEW-7), from a story card or line, with Enter.
- **Trail** (TRAIL-1, TRACE-1 to TRACE-4), with **t** on a story (its requirements selected) or `/lanes trail`.
- **Code map** (MAP-1 to MAP-5), with **c** on a story (its files) or `/lanes map` (the whole project).
- **Journal** (JOURNAL-1), with **l** on the Log or `/lanes journal`.
- **Usage** (spec 08), with `/lanes usage`.
- **Decision** (DECIDE-2), with Enter on a line in Needs you.

**Acceptance**

- Given ST-4 selected, when the person presses t, then the Trail opens with ST-4's requirements selected; Escape returns to the pane with ST-4 still selected.

### UI-7 Words, colours and glyphs

One table gives each state its word, colour and glyph, and every panel and view uses it. Status reads as a word or two at the right of its line. Labels are in sentence case, never in capitals, and the pane carries no explanatory disclaimers: what a picture means is said once, in its legend or its view.

**Acceptance**

- Given `in review` in a story card, the Queue and the Log, then all three use the same colour and glyph.

### UI-8 Keys, shown where they work

- **j** and **k** move the selection through Needs you and the lanes; **Enter** opens what's selected; **Escape** goes back or closes.
- **A digit presses the button showing it**, in the pane and in the band (BAND-4), and nothing else.
- A selected story's acts are buttons on its card, each with its key on it: approve, review, send back, merge, watch, nudge, stop. **t** and **c** open its trail and map.
- **p** pauses or resumes the loop; **f** filters the lanes.
- The pane's last line lists the keys that work for what's selected, and only those.

**Acceptance**

- Given a story in review selected, then its card shows Review (r), Merge (m) and Send back (s), and the last line lists j/k, Enter, t, c, r, m, s, p and Escape.
- Given the band showing Approve as 1 and the pane open, then 1 presses Approve in both, and never switches a view.

### UI-9 The band only speaks when it's needed

Above the prompt, the band shows what needs the person, at most three lines: the most urgent item with its buttons, and "2 more waiting · /lanes" when there are more. While the build moves and nothing needs the person, it's one line: the Build panel's milestone and bar, the loop's state and how many agents are at work. With nothing happening and nothing waiting, it's gone. The team's items (spec 16) are among what needs the person, in the same order of urgency.

**Acceptance**

- Given a held call and two approvals, then the band shows the held call with Approve and Refuse, and "2 more waiting".
- Given two agents at work and nothing waiting, then the band is one line.

### UI-10 A layout for each space

- **Inline**, above the prompt when the terminal can't dock the pane: at most four lines, the Build bar, a cell per lane coloured by its state, and the first thing waiting with its count.
- **Docked**, beside the transcript: the panels in one column.
- **Wide**, docked at 110 columns or more: Build across the top, Lanes on the left, Needs you, Queue and Log on the right.

Desktop draws the same panels, with the characters, the bars and the time axis as SVG.

**Acceptance**

- Given the pane inline at 80 columns, then it's at most four lines.
- Given it docked at 120 columns, then Lanes is beside Needs you.

### UI-11 Characters

Each lane has its own character, whatever lanes the project's config names, with its own shape as well as its tint so lanes read apart without colour; the lead's wears a crown. A lane's look comes from its name and is kept apart from the lanes before it in the config, so adding a lane never changes another's: the first six lanes get six shapes, and past six each also wears a mark (glasses, a scarf, a belt), up to 24 apart. They're drawn at 12 by 12 pixels (six rows of half-blocks in the terminal, SVG on Desktop), with poses for:

- **work, by its kind**, from the agent's current tool: writing (Edit, Write), running (Bash, a check or a test), reading (Read, Grep, Glob), thinking (a model turn with no tool), each its own loop of four frames;
- **waiting on the person**, a raised hand, still;
- **quiet** and **stalled**, still, the stalled one slumped with crossed eyes;
- **resting**, still, eyes closed;

and short one-off moves at each event: a story **arriving** at the lane, **handed back**, **sent back** (a stumble) and **merged** (a cheer), a second or so each, then the pose for its state.

The set is drawn as a sheet, every lane in every pose and move, in the terminal and on Desktop, and the person approves it before the pane uses it.

**Acceptance**

- Given the web agent running `npm test`, then web's character plays the running loop; when its next tool is Edit, it plays the writing loop.
- Given ST-4 merged, then web's character cheers once and then rests.
- Given a no-colour terminal, then web's and api's characters differ by shape.
- Given a project with nine lanes, then no two have the same shape and mark; given a tenth lane added to the config, then the first nine keep their looks.

### UI-12 Motion

Characters move while their agent works and during their one-off moves; everything else is still (VIEW-3). Beside them, two things move, both only while work flows: the elapsed clock of each agent at work, and the rail from the lead to the lanes it has dispatched, a dot travelling along it while the lead's turn runs. Each runs in a surface module on the surface's own frame clock, so only it redraws. A surface that can't animate (VS Code, mobile) draws the same frames still. `harness.motion` is `while-active` (the default) or `off`, which keeps everything still. A surface module that fails is drawn still from then on, on that surface only.

**Acceptance**

- Given no agent at work, then nothing in the pane redraws on a timer.
- Given `harness.motion` `off`, then the web agent at work is drawn in its first running frame, still.
- Given the character's module failing on the terminal, then the terminal draws the characters still, and Desktop keeps animating.

### UI-13 Built as pure drawing, tested at every width

Each panel, view and layout is a pure function from the pane's view model (the CLI's JSON, read as today) to elements, kept apart from the hooks module, which only reads state and handles acts. Tests mount every panel on the terminal and Desktop surfaces at every width from 24 to 120 columns, and fail when anything spills past its box; the three layouts are tested at the widths where they change.

**Acceptance**

- Given the Lanes panel with five cards at 24 columns, then nothing spills past its box.

## Open questions

| Question | Owner | Blocks |
| -------- | ----- | ------ |
