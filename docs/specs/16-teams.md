# 16. Teams

**Status:** draft
**Outcome:** Several people, each with their own Claude Code session and agents, build in one repository without their agents colliding or drifting from what the team agreed, and without someone reviewing every branch by hand to find out.
**Actors:** each developer (owns lanes or claims stories, approves what they own); their lead and lane agents; teammates who don't use code-kit (seen through git and GitHub); a team provider (GitHub-only here, or code-kit hub)
**Depends on:** 09-merge-queue, 15-decisions-and-journal

code-kit was built for one person with many agents. In a team, the same repository has several people, each with a lead and lanes. What's missing is shared: who owns what, who's working on what right now, what was agreed, and what changed while you weren't looking. This spec adds that to the free core, behind one interface, with a provider that needs nothing but GitHub. A hosted provider (code-kit hub) plugs into the same interface and adds live updates.

## In scope

- Owners for lanes (a split by layer) and claims on stories (a split by feature), in the committed config.
- Leases: a claimed story also holds the files and modules it changes, for as long as it's open.
- Open intents: "I'm changing the auth contract", visible to everyone before any code.
- The team provider interface, and its GitHub-only implementation: claims and leases as refs in the shared repository, intents as discussions, state read by polling.
- The hooks refusing a dispatch or an edit that collides with someone else's claim or lease.
- A Team pane (`/team`), and team lines in the band that only name what needs you.
- Setting a project up as a team's, or as one developer's again (`/code-kit:team-init`, `code-kit team init`).
- "Since you last looked": a briefing of what everyone pushed, opened, merged and decided.

## Out of scope

- Live presence and push updates: code-kit hub's.
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
| Intent | id      | number    | yes      | The discussion's number with the GitHub provider                          |
| Intent | by      | string    | yes      |                                                                           |
| Intent | about   | string    | yes      | One sentence: what's changing and why                                     |
| Intent | touches | glob[]    | no       | Paths or modules it will change                                           |
| Intent | state   | enum      | yes      | `open`, `agreed`, `dropped`, `superseded`                                 |
| Seen   | at      | timestamp | yes      | Per person, local: when they last read the briefing                       |

With the GitHub provider: a claim is the ref `refs/code-kit/claims/<story>`, pointing at a commit whose message holds the claim and lease as JSON; pushing it is the claim, and a push that fails because the ref exists means someone else has it. An intent is a discussion in the repository's Intents category, its body naming what it touches ("Touches: packages/schemas/**"): it's a proposal to talk over before any code, not a task, so it stays out of the issue tracker and needs no branch. Agreed, it's closed as resolved; dropped or superseded, as outdated; raised twice, as a duplicate.

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

The core talks to the team through one interface: `whoami`, `claim(story, lease)`, `release(story)`, `state()` (owners, claims, leases, intents, each person's open branches and pull requests), `intend(about, touches)` and `since(at)`. The core never names a provider. The GitHub provider is built in; any other is a command named in the config (`team.provider.command`), called with the operation's name and its input as JSON on stdin, and answering JSON on stdout, so a provider ships in its own plugin.

### TEAM-3 The GitHub provider

Without the hub, the GitHub provider implements the interface with refs, issues and the GitHub API. A claim is pushed only if its ref is as last fetched (`--force-with-lease`), so two people claiming at once can't both win. The state is read at most once a minute per session and kept in `.claude/state/team.json` for the hooks and the mod between reads.

**Acceptance**

- Given two clones of one repository, when one claims ST-9, then the other's `code-kit team --json` shows the claim within its next poll, and its own claim of ST-9 fails.

### TEAM-4 Leases protect what a story changes

When a story is claimed, its lease is the paths the lead says it will change (`team claim <story> --lease <globs>`, at dispatch), and it grows with each commit on the story's branch by what the branch changed. Making the story's branch claims it if it isn't claimed yet; merging it ends the claim. An edit by another person's agent to a leased path is refused with who holds it and for which story, unless the lane's owner is that person.

**Acceptance**

- Given dev A's ST-7 leasing `packages/schemas/**`, when dev B's agent edits `packages/schemas/report.ts`, then it's refused, naming dev A and ST-7, and saying to raise an intent or ask dev A.

### TEAM-5 Intents before code

`code-kit intend "<what and why>" --touches <globs>` opens a discussion in the Intents category (`team.intents`, "Intents" unless set). GitHub doesn't let a tool create a category, so when it's missing the command says how to add it once (the repository's Settings › Discussions), and nothing is raised. The tech lead answers with `code-kit intend agree|drop|duplicate <id> [--reason "…"]`, which comments their words and closes the discussion as resolved, outdated or duplicate; that's their own decision, so the hooks refuse it from any agent, as they do approvals. Open intents are in every teammate's band when they touch what that teammate is working on, and in the Team pane's Intents tab always.

**Acceptance**

- Given sam raises "Split the report format" touching `docs/reports/**`, then it's a discussion in Intents and every teammate's `team` lists it with what it touches.
- Given the repository has no Intents category, then `intend` raises nothing and says to add the category in Settings › Discussions.
- Given alex, the tech lead, agrees it with a reason, then the discussion is commented with "Agreed by @alex, the tech lead: <reason>" and closed as resolved, and it leaves the open intents; sam can't agree it, nor can an agent in alex's session.

### TEAM-10 An agreed intent becomes a decision record

Agreeing an intent isn't enough for agents: they read the repository, not discussions. `code-kit intend record <id>` writes the agreed intent as a decision record in `docs.decisions` (`docs/decisions` unless set), numbered after the last one: its title, who raised and agreed it and when, what changes and why, what it touches, and the tech lead's words, all from the discussion. The lead commits it on a branch and opens a pull request, reviewed like any change to the tech lead's paths. When the tech lead agrees an intent from the pane, the mod asks their lead to do this.

**Acceptance**

- Given intent #12 agreed by alex, then `intend record 12` writes `docs/decisions/0003-split-the-report-format.md` after 0002, with the title, "Raised by @sam · Agreed by @alex", the date, the link, the body without its Touches line, the touches as a list and alex's words; an intent not yet agreed isn't recorded.

### TEAM-11 GitHub enforces who reviews

`code-kit team codeowners [--write]` writes `.github/CODEOWNERS` from the config: the tech lead for the tech lead's paths, and each owned lane's owners for its paths, so GitHub asks the right people to review and a ruleset can require it. It says it's generated, and from what.

**Acceptance**

- Given alex as tech lead over `docs/**` and `packages/schemas/**`, and web owned by sam and kim over `apps/web/**`, then CODEOWNERS has `/docs/** @alex`, `/packages/schemas/** @alex` and `/apps/web/** @sam @kim`, in that order.

### TEAM-12 The plan on a Project board

With `team.board` (`{ owner, number }`, a GitHub Project), `code-kit team board` mirrors each story onto the board as an item with Lane, Claimed by, Stale and State fields, creating the fields and items it needs and changing only what changed since its last sync. People who don't use code-kit see who's building what. The claims stay refs: the board is a view, never the source. The mod syncs it at most every 10 minutes. Writing to a board needs the `project` permission on the developer's `gh` sign-in (`gh auth refresh -s project`); without it, the command says so.

**Acceptance**

- Given ST-4 claimed by sam and stale, and ST-9 unclaimed, then the board has an item "ST-4 Booking form" with Lane web, Claimed by sam, Stale yes, and "ST-9 Pricing" with Claimed by empty; synced again with nothing changed, it edits nothing.

### TEAM-6 Since you last looked

`code-kit team since` (and the Team pane's Since you looked tab) says, by person and in plain sentences, what was pushed, opened, merged, reviewed, claimed, released and intended since you last read it, from GitHub's repository events and the claims as you last saw them. The first time it covers the last day; reading it marks it read (`--peek` doesn't).

**Acceptance**

- Given sam pushed two commits to web/st-4 and opened a draft pull request, and alex asked for changes on it, then dev2's `team since` says so under each of them, and leaves out activity it doesn't speak about (stars) and anything before yesterday; read again, it says nothing new; after sam claims ST-21, it says sam claimed ST-21.

### TEAM-7 Shown

The team has its own pane, `/team` (only in a team's project; elsewhere `/team` says how to set one up). Its header names the tech lead, who you are and the lanes you own, the counts of claims, intents and pull requests, and what coordinates the team, in the provider's own words: GitHub (claims as refs, intents as discussions), or a hosted provider, live or not and who is signed in to it; when the provider is down, or GitHub is standing in for it, it says so in yellow. Its tabs:

1. **People**: each person, the tech lead first, with the lanes they own, where they're at work and what their agents are doing (with a live provider), drift found on their work, their claims (stale ones marked), pull requests and intents.
2. **Since you looked**: TEAM-6's briefing, read when the tab opens (which marks it read).
3. **Claims**: every claim with its holder, since when (stale ones marked) and its lease; Keep and Release on yours, and for the tech lead Release and Reassign (asking the new holder's handle) on anyone's.
4. **Intents**: each open intent with who raised it, what it touches and its discussion; Agree and Drop for the tech lead.
5. **Drift**: only when the provider checks for it (the hub does): each branch's findings, worst first.
6. **Setup**: the team's config as it stands, what GitHub still needs (TEAM-13), and Change the team setup, which asks the lead to run `/code-kit:team-init`.

The band names only what needs you: your stale claim (Keep, Release), a claim of yours changing the same files as someone else's, an intent touching what you own or lease (for the tech lead, every open intent, with Agree and Drop), drift on your work, and a ready pull request in a lane you own. Each is a decision with its card (DECIDE-2), and its Team button opens the pane on the tab it's about. "The shared repository can't be reached" is a note.

**Acceptance**

- Given sam owns web, holds ST-4 stale since Tuesday leasing `apps/web/booking/**`, kim holds ST-9 leasing `apps/web/booking/form.tsx`, kim intends a change touching `apps/web/**`, and kim's #14 on web/st-9 is ready, then sam's band shows each, and Keep runs `team keep ST-4`.
- Given the same seen by alex, the tech lead, then the band shows kim's intent with Agree, which runs `intend agree 12` as alex; in the Claims tab, Reassign on ST-9 with "sam" runs `team reassign ST-9 sam`.
- Given `/team`, then the pane opens on People (alex as tech lead, sam with web and the stale ST-4, kim's pull request and intent); Since you looked reads the briefing once, which marks it read; without a hosted provider there's no Drift tab.
- Given a project without `team`, then `/team` opens nothing and says to run `/code-kit:team-init`.

### TEAM-9 Stale claims

A claim is stale when its story's branch has had no push for `team.staleDays` (3 working days unless set) and, with the hub, its holder's sessions haven't worked on it in that time. A stale claim isn't released on its own: its holder sees "Still on ST-7? No push since Tuesday" in the band, with Keep and Release, and the tech lead sees it in the Team pane's Claims tab, where they can release or reassign it. Another developer whose work waits on a stale claim is told who holds it and that it's stale. A claim ends when its story merges, when its holder releases it, or when the tech lead releases or reassigns it. From the command line: `team keep <story>` and `team release <story>` for the holder, `team reassign <story> <handle>` for the tech lead (refused from any agent: it's the tech lead's own decision).

**Acceptance**

- Given ST-7 claimed by sam with no push for 4 working days, then sam's band asks Keep or Release, and the tech lead's Team pane shows it stale; when sam keeps it, the clock starts again.
- Given the tech lead reassigns ST-7 to dev B, then sam's claim ends, dev B holds it with its lease, and both are told.

### TEAM-8 When the provider is unreachable

Coordination fails open: if GitHub (or the hub) can't be reached, claims and leases aren't checked, the band says so once, and every local rule still holds.

A provider named by a command may give GitHub as its fallback (`team.provider: { command, fallback: "github" }`): each operation it can't reach goes to the GitHub provider instead, so claims and leases are still checked through refs, and the band says the team's provider is down and GitHub is standing in. A live provider (the hub's helper) rewrites `.claude/state/team.json` as events arrive, and the mod refreshes when it changes. When the state carries `sessions` (who is at work where, and what their agents are doing) and `findings` (a drift check's), the Team pane shows them under each person (and the findings in its Drift tab), and a finding on your own work is a line in the band.

**Acceptance**

- Given `provider: { command, fallback: "github" }` and a command that fails, when sam claims ST-40, then the claim is made through GitHub, and the state says it came through GitHub and why.
- Given the state with sessions and a blocker finding on kim's branch, then kim's band names the drift, and the Team pane shows where each person is at work and the finding.

### TEAM-13 Set up as a team, or as one developer

Not every developer works in a team, so code-kit never assumes one. `/code-kit:init` asks once whether other developers work in the repository with their own sessions, and only on yes runs `/code-kit:team-init`, which can also be run on its own at any time: to set the team up, change it, or take it out. It asks for the tech lead, each lane's owners (or none), when a claim goes stale and the intents' discussion category, shows the team section before anything is written, and writes it only once the person agrees.

`code-kit team init --tech-lead <handle> [--owner <lane>=<handles>]… [--stale-days <n>] [--intents <category>]` shows the section it would write; with `--write` it writes the config (validated like any other change) and says what GitHub still needs: gh signed in on this machine, the shared repository reachable, Discussions on with the intents' category (which GitHub doesn't let a tool create). `team init --off --write` takes `team` and every lane's owners out. Writing is the lead's: the hooks refuse `team init --write` from a lane agent. The GitHub provider's state carries the same list (`setup`) and names itself (`provider`), for the Team pane's header and Setup tab.

**Acceptance**

- Given a project without `team`, when the lead runs `team init --tech-lead alex --owner web=sam,@kim`, then it shows the section and writes nothing; with `--write`, the config has alex as tech lead and sam and kim owning web, `check` passes, and it says GitHub is ready.
- Given `--owner nope=sam`, then it's refused, naming the lanes there are; given `--stale-days 0`, nothing changes and it says what the value must be.
- Given `--intents Proposals` and no such category, then init and the team's state both name it as still to set up.
- Given a lane agent running `team init … --write`, then it's refused; without `--write` it may look.
- Given `team init --off --write`, then the config has no team and no owners, and `check` reports none.

## Open questions

| Question                                                     | Owner  | Blocks |
| ------------------------------------------------------------ | ------ | ------ |
| Is 3 working days the right default before a claim is stale? | Warren | TEAM-9 |
