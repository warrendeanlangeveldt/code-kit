# 11. Panes v2

**Status:** draft
**Outcome:** The Lanes pane reads at a glance and works from the keyboard: who's doing what, how long, what needs the person, and the detail of any story a key away.
**Actors:** the person
**Depends on:** 01-lanes-pane (replaced in look, kept in behaviour), 05 to 10

## In scope

- A counts header, a timeline per lane, a character per lane agent, liveness, a "needs you" strip, a keyboard model, and a story drill-down.
- Tabs for Lanes, Queue (09), Map (10) and Usage (08).
- Docked (110 columns or more) and inline layouts; terminal, VS Code's terminal and Desktop.

## Requirements

### VIEW-1 Counts header

A fixed first line counts the stories by state ("● 3 building · 1 in review · 2 ready · ✓ 9 merged"), with the loop's state and the plan's 5-hour use. Selecting a count filters the lanes to it; selecting it again clears the filter.

### VIEW-2 A timeline per lane

Each lane is a row with its story's bar along a shared time axis: dispatched, building, in review, merged, with sends-back and approvals marked on the bar. Drawn as cell graphics in the terminal and as SVG on Desktop; in a no-colour terminal, glyphs carry the states.

**Acceptance**

- Given web dispatched 40 minutes ago and in review for 5, then its bar shows 35 minutes building and 5 in review, ending at now.

### VIEW-3 A character per lane agent

Each lane agent is drawn as a small pixel character (cell graphics in half-blocks in the terminal, SVG on Desktop) whose pose shows its state: working (animated), waiting on the person, quiet, stalled, done. The lead has its own. Characters animate only while their agent is working, and are fixed per lane so the person learns them.

**Acceptance**

- Given web building and api waiting on a held call, then web's character animates and api's shows the waiting pose.

### VIEW-4 Liveness

Each lane shows its agent's current or last tool call and the time since ("Bash npm test · 12s"), turning amber when quiet (05) and red when stalled.

### VIEW-5 Needs you

Anything waiting on the person (held calls, approvals, reviews, merges, stalls, outliers) is pinned at the top as loud buttons with digit keys, mirroring the band.

### VIEW-6 Keyboard

j/k move between lanes; Enter opens the selected story; a approves, r reviews, m merges, s sends back, n nudges, x stops the agent, p pauses the loop, 1–4 switch tabs, / filters, Esc goes back or closes. Every action also has a button.

### VIEW-7 Story drill-down

A story's view shows its requirements with the spec-check table, its diff against the base (coloured, by file), verify's problems, the reviewer's findings by severity (07), its usage, and its loop steps, with the actions for its state.

**Acceptance**

- Given a story in review, when the person opens it, then the diff, verify's result and the review's findings are shown, with Merge and Send back.

### VIEW-8 Layouts

Docked, all of the above; inline (under 110 columns), the header, the needs-you strip and one line per lane, with Enter opening the docked view when there's room.

## Quality targets

- Animation repaints in place, without redrawing the pane, and stops when nothing is working.
- Colours come from theme keys; every state has a glyph as well as a colour.

## Open questions

| Question                                                                                             | Owner  | Blocks         |
| ---------------------------------------------------------------------------------------------------- | ------ | -------------- |
| What cell graphics and live regions look like in the person's VS Code terminal (the probe, spike E). | Warren | VIEW-2, VIEW-3 |
| The characters' look: one style for all lanes, or chosen per lane in the settings.                   | Warren | VIEW-3         |
