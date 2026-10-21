---
name: team-init
description: Set up a code-kit project for a team of developers, change its team setup, or make it one developer's again. Asks who the tech lead is, who owns which lanes, when a claim goes stale and where intents go, shows the team section before writing it, checks GitHub is ready (gh signed in, the shared repository, the intents' discussion category), offers CODEOWNERS and the Project board, and connects a hosted team provider only when the config already names one. Use when the person says they work in a team, wants teammates to share the project, wants to change the tech lead or lane owners, wants to stop working as a team, or runs /code-kit:team-init. Not every developer works in a team: never set one up unasked.
---

# Set up the team

A team is several people in one repository, each with their own lead and agents (spec 16). code-kit then claims a story before anyone builds it, leases the files it changes, has intents raised before shared things change, and shows it all in `/team`. One developer needs none of this, and the project works the same without it.

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/bin/code-kit.mjs"`, run from the project root. Its `team init` shows the team section it would write; with `--write` it writes it, once the person agrees. Only the lead writes it: the hooks refuse it from a lane agent.

## 1. Where things stand

1. `.claude/code-kit.json` must exist and be valid (`check`). If it doesn't, stop: the person runs `/code-kit:init` first.
2. Run `check --json` and read `team` (null when the project isn't a team's), `me` (who's signed in to gh here) and `lanes`.
3. The shared repository: `git remote get-url origin` must be on GitHub, and `gh auth status` signed in. Without either, say what's missing; code-kit's own team provider works through both.

Say which applies: **new team**, **change the team**, or **back to one developer** (the person asked to stop working as a team).

## 2. Ask, one question at a time

Ask only what the config can't answer, with the current value as the default on a change.

- **Is this a team?** On a new setup, unless the person already said so: "Do other developers work in this repository with their own Claude Code sessions?" No → stop, and say nothing changed.
- **Tech lead:** whose GitHub handle owns the plan, specs, contracts and principles, agrees or drops intents, and may release or reassign anyone's claim. Default: `me`.
- **Lane owners:** for each lane, whose sessions build its stories (GitHub handles), or nobody, in which case whoever claims a story first builds it. `git log --format='%an' -- <lane paths> | sort | uniq -c` and CODEOWNERS suggest people, but ask for handles: names in commits aren't handles.
- **Stale after:** how many working days without a push before a claim is stale (default 3).
- **Intents category:** the GitHub Discussions category intents go in (default `Intents`). Skip it when the config's `team.provider` names a hosted provider (`{ "<name>": "<https address>" }`) and `team.intents` isn't set: that provider keeps the intents.
- **Back to one developer:** confirm that claims, owners and intents stop applying, and that teammates' sessions lose them too once it's merged.

## 3. Show, then write

Run it without `--write` and show the person exactly what it prints:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/code-kit.mjs" team init --tech-lead <handle> --owner <lane>=<handle>,<handle> [--stale-days <n>] [--intents <category>]
node "${CLAUDE_PLUGIN_ROOT}/bin/code-kit.mjs" team init --off
```

Give `--owner <lane>=` (nothing after `=`) to take a lane's owners out. Once they agree, run the same command with `--write`. It prints what GitHub still needs; tell the person each, in their words:

- **gh isn't signed in:** they run `! gh auth login`.
- **Discussions are off, or there's no intents category:** GitHub doesn't let a tool create a category. They turn Discussions on (Settings › Features) and add an "Open-ended discussion" category with the intents' name (Settings › Discussions), once.

## 4. Also offer

Each is optional; ask, and do only what they want:

- **CODEOWNERS** (TEAM-11): `team codeowners --write` writes `.github/CODEOWNERS` from the config, so GitHub asks the tech lead and lane owners to review. Then they require code owners' review in a ruleset on the protected branch.
- **A Project board** (TEAM-12): with a GitHub Project's owner and number, add `"board": { "owner": "<user or organisation>", "number": <n> }` to `team` in the config; the mod then mirrors the plan onto it.
- **A hosted team provider, only when the config already names one:** hosted providers are in preview, so never offer or suggest one. When `team.provider` is `{ "<name>": "<https address>" }` (set by hand), connect this machine: run `team provider status`; if it isn't signed in, run `team provider signin` in the background, give the person the code and the GitHub address it prints, and wait (they enter the code in their browser; never ask for a password or token); then `team provider connect`, which checks the provider can see the repository and adds its MCP server to `.mcp.json`. Commit `.mcp.json` with the config.

## 5. Finish

1. Run `check` and `team` to confirm.
2. Commit `.claude/code-kit.json` (and CODEOWNERS, if written) on a branch, open a pull request, and merge it as any change to the kit's rules.
3. Tell the person what each teammate does once: install code-kit, `gh auth login`, pull the change. Their sessions then share the claims, and `/team` shows the team.

Report in three lines: the tech lead and owners as written (or that the project is one developer's again), what GitHub still needs, and what each teammate does.
