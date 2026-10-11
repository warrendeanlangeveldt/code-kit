# 16. Teams

**Status:** draft
**Outcome:** Several people, each with their own Claude Code session and agents, build in one repository without their agents colliding or drifting from what the team agreed, and without someone reviewing every branch by hand to find out.
**Actors:** each developer (owns lanes or claims stories, approves what they own); their lead and lane agents; teammates who don't use code-kit (seen through git and GitHub); a team provider (GitHub-only here, or the code-kit teams hub)
**Depends on:** 09-merge-queue, 15-decisions-and-journal

code-kit was built for one person with many agents. In a team, the same repository has several people, each with a lead and lanes. What's missing is shared: who owns what, who's working on what right now, what was agreed, and what changed while you weren't looking. This spec adds that to the free core, behind one interface, with a provider that needs nothing but GitHub. A hosted provider (the code-kit teams hub) plugs into the same interface and adds live updates.

## In scope

- Owners for lanes (a split by layer) and claims on stories (a split by feature), in the committed config.
- Leases: a claimed story also holds the files and modules it changes, for as long as it's open.
- Open intents: "I'm changing the auth contract", visible to everyone before any code.
- The team provider interface, and its GitHub-only implementation: claims and leases as refs in the shared repository, intents as draft pull requests, state read by polling.
- The hooks refusing a dispatch or an edit that collides with someone else's claim or lease.
- A Team tab, and team lines in the band that only name what needs you.
- "Since you last looked": a briefing of what everyone pushed, opened, merged and decided.

## Out of scope

- Live presence and push updates: the hub's (code-kit-teams).
- The drift check (work built on a spec or decision that has since changed): the hub's, as an agent on every push.
- Any host but GitHub.

## Data

| Entity | Field   | Type      | Required | Rules                                                                     |
| ------ | ------- | --------- | -------- | ------------------------------------------------------------------------- |
| Owner  | lane    | string    | no       | `lanes.<name>.owners`: GitHub handles; no owners means anyone on the team |
| Claim  | story   | string    | yes      | One claim per story, by one person                                        |
| Claim  | by      | string    | yes      | GitHub handle                                                             |
| Claim  | at      | timestamp | yes      |                                                                           |
| Lease  | story   | string    | yes      | The claim it belongs to; released with it                                 |
| Lease  | paths   | glob[]    | yes      | What the story changes, from its code map and its branch's diff           |
| Intent | id      | string    | yes      | The draft pull request's number with the GitHub provider                  |
| Intent | by      | string    | yes      |                                                                           |
| Intent | about   | string    | yes      | One sentence: what's changing and why                                     |
| Intent | touches | glob[]    | no       | Paths or modules it will change                                           |
| Intent | state   | enum      | yes      | `open`, `agreed`, `dropped`, `superseded`                                 |
| Seen   | at      | timestamp | yes      | Per person, local: when they last read the briefing                       |

With the GitHub provider: a claim is the ref `refs/code-kit/claims/<story>`, pointing at a commit whose message holds the claim and lease as JSON; pushing it is the claim, and a push that fails because the ref exists means someone else has it. An intent is a draft pull request labelled `code-kit:intent`.

## Requirements

### TEAM-1 The tech lead, owners and claims in the config

The team has one tech lead (`team.techLead`, a GitHub handle). The tech lead owns what the lead owns today: the plan, the specs, the contracts and the principles. Other developers' sessions treat those paths as read-only and raise an intent to change them (TEAM-5); the tech lead agrees or drops it. Each developer still has a lead agent in their own session, which dispatches and reviews within their lanes and claims.

A lane may name its owners (`lanes.web.owners: ["sam"]`). With owners, only their sessions dispatch that lane's stories; others see the lane read-only. A story in an unowned lane is claimed by whoever dispatches it first. The developer's handle is read from `gh api user`.

A lane's owners may work in it themselves and through their agents at once: a lane can be shared by a person and agents.

**Acceptance**

- Given the tech lead is alex, when sam's agent edits the plan, then it's refused, naming alex and saying to raise an intent.
- Given web owned by sam, when another developer's lead dispatches ST-4 (a web story), then it's refused, naming sam as the owner.
- Given ST-9 in an unowned lane, when two developers' leads dispatch it, then the first claims it and the second is refused, naming who claimed it and when.

### TEAM-2 The provider interface

The core talks to the team through one interface: `whoami`, `claim(story, lease)`, `release(story)`, `state()` (owners, claims, leases, intents, each person's open branches and pull requests), `intend(about, touches)` and `since(at)`. The core never names a provider; the GitHub provider and the hub's are adapters.

### TEAM-3 The GitHub provider

Without the hub, the GitHub provider implements the interface with refs, draft pull requests and the GitHub API. It polls with conditional requests, so an unchanged state costs nothing against the rate limit, at most once a minute per session.

**Acceptance**

- Given two clones of one repository, when one claims ST-9, then the other's `code-kit team --json` shows the claim within its next poll, and its own claim of ST-9 fails.

### TEAM-4 Leases protect what a story changes

When a story is claimed, its lease is the paths its code map and the plan say it changes, and grows as its branch changes more. An edit by another person's agent to a leased path is refused with who holds it and for which story, unless the lane's owner is that person.

**Acceptance**

- Given dev A's ST-7 leasing `packages/schemas/**`, when dev B's agent edits `packages/schemas/report.ts`, then it's refused, naming dev A and ST-7, and saying to raise an intent or ask dev A.

### TEAM-5 Intents before code

`code-kit intend "<what and why>" --touches <globs>` opens a draft pull request labelled as an intent. Open intents are in every teammate's band when they touch what that teammate is working on, and in the Team tab always.

### TEAM-6 Since you last looked

`code-kit team since` (and the Team tab's top) says, by person and in plain sentences, what was pushed, opened, merged, claimed, released and intended since you last read it.

### TEAM-7 Shown

The Team tab lists each person with their claims, branches, pull requests and intents, and what of theirs touches yours. The band names only what needs you: a collision with your work, an intent touching what you own, or a review you own.

### TEAM-9 Stale claims

A claim is stale when its story's branch has had no push for `team.staleDays` (3 working days unless set) and, with the hub, its holder's sessions haven't worked on it in that time. A stale claim isn't released on its own: its holder sees "Still on ST-7? No push since Tuesday" in the band, with Keep and Release, and the tech lead sees it in the Team tab, where they can release or reassign it. Another developer whose work waits on a stale claim is told who holds it and that it's stale. A claim ends when its story merges, when its holder releases it, or when the tech lead releases or reassigns it.

**Acceptance**

- Given ST-7 claimed by sam with no push for 4 working days, then sam's band asks Keep or Release, and the tech lead's Team tab shows it stale; when sam keeps it, the clock starts again.
- Given the tech lead reassigns ST-7 to dev B, then sam's claim ends, dev B holds it with its lease, and both are told.

### TEAM-8 When the provider is unreachable

Coordination fails open: if GitHub (or the hub) can't be reached, claims and leases aren't checked, the band says so once, and every local rule still holds.

## Open questions

| Question                                                     | Owner  | Blocks |
| ------------------------------------------------------------ | ------ | ------ |
| Is 3 working days the right default before a claim is stale? | Warren | TEAM-9 |
