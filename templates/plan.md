# Plan

`code-kit status` reads this file. Keep each story's heading and its four `**…:**` lines in this form. Use `**Lane:** lead` for the lead's own stories (contracts, foundations, spikes), `**Lane:** qa` for a journey's end-to-end test story (it depends on the screen and service stories the journey goes through), `**Lane:** design` for a design story (an area's screens, designed with the person before any of them is built; the stories building them depend on it), and `**Requirements:** none` for a story that delivers no requirement. A story that fixes a bug adds a fifth line, `**Fixes:** <what was broken, and where it was seen>`: `code-kit verify` then requires a test that fails without the fix and passes with it. A story that belongs to a slice (a feature that can be shown working, built across lanes) adds `**Slice:** <name>`: a lane takes the open slice's stories first.

## Lanes

| Lane     | Agent     | Owns      | Proves its work with |
| -------- | --------- | --------- | -------------------- |
| {{lane}} | {{agent}} | {{globs}} | `{{command}}`        |

## Milestone 1: {{name}}

{{The usable increment this milestone delivers, in a sentence.}}

### ST-1 {{Story title}}

**Lane:** {{lane}}
**Requirements:** {{AREA-1, AREA-2}}
**Depends on:** {{ST-n, or none}}
**Slice:** {{the feature it's part of, or leave the line out}}
**Status:** todo

{{What gets built, in two or three sentences. The acceptance criteria are the cited requirements'.}}

### ST-2 {{Story title}}

…

## Milestone 2: {{name}}

…
