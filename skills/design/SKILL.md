---
name: design
description: Design a design story's screens with the person before any of them is built, and record each approved design so its screen can be coded. Reads the screens the specs list, designs them in the project's design tool (Paper, Figma, Pencil) or as design files under design/, shows them, iterates on the person's feedback, and adds each approved screen to the design register the design gate reads. Use when code-kit next or the loop gives the design step, when a lane was refused for a screen whose design isn't approved, or runs /code-kit:design [story IDs].
---

# Design before code

A screen is designed and approved before anyone builds it. The design gate refuses a lane writing a screen file until the design register lists it, and the plan's screen stories depend on their design story, so nothing is dispatched early. Designing is the lead's work with the person: you propose, they decide.

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/bin/code-kit.mjs"`.

## 1. What to design

For each story given (`**Lane:** design` in the plan):

- read the requirements it cites and the `## Screens` section of their specs: each screen, what it shows, what the person can do there, and its empty, loading and error states;
- read the architecture for the design tool and the folders screens live in, and the principles for the brand, theme and accessibility targets;
- look at the designs already approved (`design/register.json` and what it links to), so the new screens match them.

If the specs don't list the screens, or leave a state out, ask the person now rather than inventing it.

## 2. Design

Use the project's design tool:

- **A design tool connected to this session** (Paper, Figma, Pencil, whichever the architecture names, or the one the person uses): design each screen there, one artboard per screen and state, with the project's tokens.
- **None:** write each screen as a static HTML and CSS file under `design/<area>/<screen>.html`, at the sizes the product targets (phone, desktop), opened in the browser to check it.

Use the spec's own content: the real labels, fields, messages and limits from its requirements, never lorem ipsum or placeholder screens. Every state the spec lists gets a design. Follow the principles for theme (light and dark, if both), type, spacing and accessibility.

## 3. Show it and iterate

Show the person each screen (a screenshot, or the file to open) with one line on what it does and which requirements it serves. Ask what to change. Make the changes and show them again until they say a screen is approved. A screen they want rethought goes back to step 2; one that needs the spec changed goes to `/code-kit:spec-design` first.

## 4. Record the approved designs

For each approved screen, add an entry to the register, naming the code file the lane will write (from the architecture's folders and the project's routing):

```json
{
  "screens": [
    {
      "file": "apps/web/app/bookings/page.tsx",
      "design": "design/bookings/list.html",
      "story": "ST-2",
      "approved": "2026-10-11"
    }
  ]
}
```

The register is protected by the `design` approval, which is the person's: writing it is refused until they approve, and in a session with the code-kit mod the write waits in the band for their Approve. Give the approval a reason in their words ("bookings list and detail, as shown"). Then commit the designs and the register on `design/st-<n>`, and review and merge it like the lead's own story. Once it's merged, `code-kit next` dispatches the screen stories that waited on it.

## 5. Report

Say which screens were approved, which are still open and why, and what's dispatched next.
