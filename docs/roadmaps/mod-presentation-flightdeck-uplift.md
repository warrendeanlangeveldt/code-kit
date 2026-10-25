# CodeKit Mod — Live Presentation Uplift

**Status:** Incremental UI implementation, draft for review  
**Prepared:** 2026-10-25  
**Inspiration:** Flightdeck's scan-friendly agent presentation, without copying its source code or replacing CodeKit's architecture/engineering workflow.

## Design constraints

- **Preserve every existing top-level tab**: Lanes, Decisions, Journal, Code map, Trail, Queue, Usage.
- Preserve hotkeys, approvals, review, merge, lane actions, focus, inline fallback and existing terminal/Desktop/VS Code surfaces.
- Keep the original CodeKit pixel-agent identity. Make motion subtle, informative and grounded in actual runtime status, not an invented "agent is working" signal.
- Never turn "a test exists" into "tests passed"; never turn "queued" into "merged"; never infer release CI passed from a local review or a release branch.
- Don't change orchestration or governance semantics as part of a purely visual uplift.
- Avoid broad copyright / styling imitation: adopt information architecture ideas, not Flightdeck's code.

## Implemented in this branch (v1)

### Lanes

For panes with at least 92 body columns:
- agent card per lane, with preserved pixel sprite, lane and agent name, actual story/branch, status and token usage;
- live tool/activity line using the existing observed `live` telemetry;
- workflow-position rail: **Plan → Build → Review → Queue → Merge**, derived strictly from existing CodeKit story / merge-queue state;
- original recorded timeline and its event markings; if a worker is **actually active**, an SVG cursor gently pulses at the last observed timeline cell;
- existing Context Graph facts and lane drill-downs are preserved, with selection highlighting.

For narrower panes and inline views, the original dense rows remain. The seven navigation tabs and existing hotkeys are unchanged.

**Known limits:** The stage rail conveys workflow position only. It does **not** certify stage quality. A blocked/sent-back story is never a completed verification result. Context pressure per agent is a potential next iteration once the runtime exposes trustworthy current context measurements.

### Pixel agents / animation

- Working retains quick two-frame motion.
- Waiting displays a periodic hand raise (on terminal while the pane is open and in animated SVG).
- Idle blinks occasionally on SVG surfaces; terminal idle does not cause continuous blits.
- "In review" and "queued" use **distinct static poses**; no imaginary reviewer is animated.
- Actual active story timeline gains a subtle SVG pulse; historical timelines remain static.
- The original non-colour glyph fallback is preserved.

### Queue

- Existing merge queue is now drawn as status-coloured receipts; each item clearly names the **reviewed commit SHA** when available.
- No suggestion of release CI pass absent independent evidence.

### Usage

- Per-story token usage shows a 12-cell comparative bar alongside actual token counts.
- Bars are labelled **relative to the busiest story in the current session**, not misrepresented as quota or context percentages.

## Truthfulness / event rules

| Display | Source | Guarantee |
|---|---|---|
| Agent working pose | Current lane active state | Only when an agent is actually active |
| Waiting gesture | Held or waiting-on-person state | Waiting is not represented as executing |
| Reviewing / queued pose | Story state / merge queue | Distinct; neither means tests or release CI passed |
| Timeline segments | Existing recorded story timeline | Time between observed Git/review events, not a precise tool transcript |
| Active timeline pulse | Lane active state | Never show on inactive timeline |
| Stage rail | Existing `shownState` + queue | Progress through orchestration, not semantic acceptance |
| Queue receipt | Review queue commit SHA | Not a claim of independent CI execution |
| Usage bar | Measured token count | Relative to maximum measured story, not budget percentage |

## Next visual iterations (not included in this PR)

1. **Decisions:** clearer permission/request history with separate *Claude permission* vs *CodeKit engineering policy* lanes; accountable approval decision cards.
2. **Journal:** expandable chronological execution rail using durable event source once implemented; distinguish observed from reconstructed or agent-declared events.
3. **Code map / Trail:** link architecture boundaries, file movement and requirement-to-test evidence; animate **only actual observed transitions**.
4. **Queue:** show independently attested check outcomes, freshness, release-CI status and review SHA linkage when the backend exposes it.
5. **Usage:** per-agent context pressure, cache/token profiles, compaction and model handoffs when trustworthy data exists.
6. **Motion preference:** add Off / Subtle / Expressive once Claude Mods exposes a reliable shared preference and reduced-motion handling; no requirement to use animated SVG on accessibility-sensitive surfaces.
7. **Density:** user-selectable Compact / Studio layout without hiding features; viewport-specific regression snapshots at widths 24, 60, 80, 100 and 140.
8. **Cross-agent handoff:** eventually animate recorded `StoryHandedOver` / `ReviewCompleted` events from a durable event ledger, not timer-based fictional moving packets.

## Validation

- Source syntax checked on the four changed JS modules with an ECMAScript parser smoke-check in this review session.
- Pure render smoke-tests checked wide cards + rail and narrow fallback, queue reviewed SHA and usage token bars.
- Added Node unit assertions for workflow stage mapping, SVG idle/waiting motion, active timeline pulse, and review/queue poses.
- Added Claude mod integration tests verifying new wide-surface cards and all seven preserved tabs, plus the 80-column fallback.
- **Not run:** `claude plugin test` / full `npm test`. This execution environment has no Claude Code CLI; do not merge without these passing on an installed Claude Code environment.

Suggested local commands:

```bash
node --check hooks/mod/art.mjs
node --check hooks/mod/view.mjs
node --check hooks/mod/panes.mjs
node --check hooks/mod/register.mjs
npm test
claude plugin test .
```

This UI-focused work deliberately does not modify existing hooks, approval policy, CI triggers, event sourcing, or Hub integration.

## Review checklist

- [ ] Check narrow terminal 60/80 columns and wide terminal 112+ columns.
- [ ] Check desktop SVG timeline and sprite animations, including terminal Raster blits.
- [ ] Check SVG reduced-motion behaviour and rendering fallbacks in each supported surface.
- [ ] Check stories in progress, held for approval, in review, queued, sent back, idle and stalled.
- [ ] Verify actual tool calls and timestamps match what's represented visually.
- [ ] Verify no regression in navigation, shortkeys, action buttons and UI focus.
- [ ] Run `npm test` and `claude plugin test .` with supported Claude Code.
