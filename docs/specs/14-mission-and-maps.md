# 14. Mission band and maps

The person can follow a build without opening anything, and see it as a picture when they do. The band above the prompt says what the build is for, what the lead is doing, what comes next and what waits on them. The Lanes pane puts the loop on a card of its own, keeps each lane on fixed columns and shows a lane's stories as cards. Two tabs draw the code: a story's files by layer with the imports between them, glowing where a lane is at work, and each requirement's trail to its stories, code and tests. The design was agreed on a web mock first (the harness view).

## Requirements

### MISSION-1 The mission rows

While anything is happening (a lead turn, an agent at work, the loop started), the band shows, above what needs the person:

- **goal**: the plan's first milestone with a story not done, and how many of its stories are done ("Milestone 5: Your own key · 2 of 6 stories done");
- **now**: whether the lead is at work (with its current tool) and the loop's state, with Pause or Resume;
- **next**: the step `code-kit next` last reported, with what follows it;
- **agents**: one line per lane agent at work: its lane, its current tool and how long since, amber once quiet and red when stalled; five at most, the rest counted.

With nothing happening, the band shows only what needs the person, as before.

**Acceptance**

- Given a story of Milestone 2 done of four, the lead mid-turn, `next` reporting a review then a dispatch, and the web agent running tests, then the band reads the goal, "lead at work · loop on · last: review ST-9", "Review ST-9, then Dispatch ST-10", and the web agent's line, with Pause.
- Given nothing happening, then the band has no goal, now or next rows.

### MISSION-2 What waits on the person

What needs the person keeps its lines and actions beneath the mission rows, its first line labelled "you".

### MISSION-3 Other tools only when they have something to say

A tool with an adapter (Context Graph) adds a line only when a lane edited files without understanding them ("ingest edited 2 files without understanding them"); at zero it adds nothing.

### LANES-1 The loop as a card

The Lanes tab opens on the loop: its mode (acts while the lead is idle, asks before each step, paused, off, milestone done), the last four steps it took, the one running now and the one it takes next. The loop's history is drawn once, here.

### LANES-2 Lanes on fixed columns

Each lane is one row of name, state and story (with what it waits on or its branch), then its agent's current tool and the time since beneath, then its tokens. Nothing wraps; long text is cut with an ellipsis. Another tool's facts appear as chips only when they aren't zero. The lead mid-turn reads "orchestrating" (unless it builds its own story); between turns, a story of its own that waits on another doesn't make the lead "blocked".

### LANES-3 A lane's stories as cards

The selected lane's stories show as cards: id and state, title, requirements, and what it waits on or its branch; merged ones dimmed. Beneath them, the lane's agent and the paths it owns.

**Acceptance**

- Given the api lane selected with ST-1 merged and ST-2 blocked on ST-9, then ST-1's card reads merged, ST-2's reads blocked and waits on ST-9, and the agent and owned paths follow.

### MAP-1 The code map

The Code map tab (2) draws a story's code: its files (from the commits that name it and its open branch) in a column per layer, in the config's layer order, then tests; each import between files of neighbouring layers is a line. The story is the one chosen, else the selected lane's, else one being built; the stories in progress are offered to choose from. `code-kit map <story> --json` gives the files, their layers, lanes and imports, and what the active adapters know of each.

**Acceptance**

- Given ST-4's files in domain, services and tests, with services importing domain, then each file is drawn once in its layer's column, with a line between them.

### MAP-2 Activity glows

A file a lane reads or edits glows in the lane's colour, "web reading" or "web editing" under its name, for 20 seconds after the call. Paths in an agent's worktree count as the repository path.

### MAP-3 The selected file

The selected file (j and k move) shows its path, layer and lane, its card (or that it has none, or that it changed since its card), what it imports and what imports it in the story. Open in Context Graph (o) opens it in the adapter's own view.

### MAP-4 By surface

In the terminal the map is box-drawing text; on Desktop, VS Code and mobile it's an SVG, with every import drawn and glowing files pulsing.

### TRAIL-1 The trail

The Trail tab (3) keeps the requirement map and adds the selected requirement's spec as a trail: each requirement to its stories, the number of files they changed, and the tests that name it, with a missing story, file or test in red. The selected requirement also lists the code its stories changed. `code-kit trail --json` gives it.

**Acceptance**

- Given BOOK-1 delivered by ST-4 with one file and one test, and BOOK-2 with no story, then BOOK-1's trail reads "ST-4 ─ 1 file ─ ✓ 1 test" and BOOK-2's "no story … no test names it" in red.

## Quality targets

- Nothing in the band or the Lanes rows wraps at 80 columns.
- A file glows within 2 seconds of the call that touched it.

## Open questions

| Question | Owner | Blocks |
| -------- | ----- | ------ |
