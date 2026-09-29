---
name: init
description: Set up code-kit in a project, or bring an existing setup up to date. Works from the project's docs (new builds) or from its code (brownfield), drafts .claude/code-kit.json, the lane agents and the CLAUDE.md section, and shows the person exactly what changes before anything is enforced. Use when the person says to apply the kit to a project, to re-run or refresh it, or runs /code-kit:init [docs path].
---

# Set up or update code-kit

The argument, if given, is the path to the project's docs (a folder or one file).

Always the same shape: **read, draft, show, and switch on only once the person approves.** The hooks read only `.claude/code-kit.json`. Every draft goes to `.claude/code-kit.draft.json`, which enforces nothing.

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/bin/code-kit.mjs"`, run from the project root. Its commands are `check`, `unowned`, `who`, `diff`, `baseline` and `graph`, each taking `--config <file>` to read the draft.

## Which situation

- **`.claude/code-kit.json` exists** → **Update** (section 4). The lanes stay in step with the build.
- **No config, and the docs describe the architecture** → **New from docs** (sections 1–3).
- **No config, and the docs are thin or missing** → **Brownfield** (sections 1–3, with the brownfield steps). The code is the main source, and the docs fill in what they can.

Say which one applies and why before you start.

## 1. Read everything first

1. **The docs, in full.** Every file under the docs path, not excerpts. Note where each of these is described:
   - **Layers:** names, which folders each covers, which way dependencies point, what each may not use.
   - **Work split:** lanes, teams, packages, apps or services, and who owns which paths. An implementation plan or a sub-agent table is the best source.
   - **Principles:** engineering rules, definitions of done, what counts as a contract.
   - **Protected things:** registers, contracts and schemas that need a person's sign-off.
   - **Design-first rules:** screens designed before they are built, and where approvals are listed.
   - **Commands:** test, lint, typecheck, database and deploy commands, and which must never run locally.
2. **The repository.** Map the real layout: `git ls-files | cut -d/ -f1-3 | sort | uniq -c`, package manifests (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`), workspace files, existing lint, format and test scripts, CI workflows and CODEOWNERS.
3. **Existing kit.** If the project has `.claude/hooks`, agents or skills, read them. The kit replaces local hooks; agents and skills are kept and adapted, not rewritten.

**Brownfield, in addition:**

4. **Find the layers in the code.** Run `graph` (default depth 2, and `--depth 3` for deeper packages). It lists which folders import which, most-used first. Look for:
   - folders nothing depends on (the edges: apps, UI, entry points);
   - folders everything depends on (the core: domain, schemas, shared types);
   - edges in both directions between two folders. These are existing tangles; record them, don't design around them.
5. **Find the work split in the history.** Use `git log --format='%an' -- <folder> | sort | uniq -c | sort -rn | head` per top-level folder, plus CODEOWNERS. Folders that change together and are worked on by the same people make a lane.
6. **Check the checks.** Run each candidate check command once on the current code, before proposing it. If a command already fails, that's a finding, not a check to switch on silently. Offer three options: fix first, leave it out for now, or scope `files` narrower so it guards only new work.

## 2. Draft the config

Write `.claude/code-kit.draft.json`. Follow `${CLAUDE_PLUGIN_ROOT}/README.md` › Config for every field.

- **`docs`:**
  - `specs`, `principles` and `plan` as found. Leave `specs` out if the project has no specs: without it, lanes aren't held to a spec-check report.
  - Brownfield: if there are no specs, say so, and offer the spec-check gate for later, once specs exist.
- **`layers`:** one entry per layer, documented or found in the graph. Each needs:
  - `paths`: globs matching where that layer's code really lives;
  - `mayImport`: the direction the docs set. For brownfield code, the direction most of the code already follows;
  - `denyPackages`: packages forbidden for that layer, for example `node:*` or a vendor SDK outside its adapter.
  - Also add `importAliases` for path aliases in `tsconfig` `paths` that the graph can't see. Workspace package names are found automatically.
  - The import check reads JavaScript and TypeScript. For another language, record the layers anyway (agents and spec-check use them), and say the import check doesn't cover that language yet.
- **`lanes`:** one per documented or discovered ownership area. Each needs:
  - `agent`: a kebab-case agent name, for example `api-engineer`;
  - `paths` and `exclude`: every path must have exactly one owner.
- **`lead.paths`:** contracts, specs, design, root config, and anything the docs reserve for the lead.
- **`anyActor`:** lockfiles, if lanes may update them.
- **`protected`:** registers and contracts that need a person's sign-off, each with an `approval` name and a `why`.
- **`designGate`:** only if the docs require designs before screens.
- **`shell.block`:** deploy, release and production commands reserved for CI or a person.
- **`shell.restricted`:** commands that affect a shared local service, limited to the lanes that own it.
- **`postEdit`:** the project's existing per-file linters and formatters, with `{file}`.
- **`checks`:** the typecheck, test, architecture and database commands, each scoped by `files`. Only include commands that pass on the current code, or ones the person chose to keep.

Prove the draft:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/code-kit.mjs" check --config .claude/code-kit.draft.json
node "${CLAUDE_PLUGIN_ROOT}/bin/code-kit.mjs" unowned --config .claude/code-kit.draft.json
node "${CLAUDE_PLUGIN_ROOT}/bin/code-kit.mjs" baseline --config .claude/code-kit.draft.json
```

- **`check`:** fix every problem it reports.
- **`unowned`:** a file it lists can't be written by anyone. Give each one an owner, or confirm with the person that it should stay frozen.
- **`baseline`:** lists the layer violations already in the code.
  - New from docs: expect none. Any it finds are drift from the documented design; list them.
  - Brownfield: expect some. They'll be recorded as the baseline, so only new violations block.

## 3. Agents, CLAUDE.md, and switching on

Draft, alongside the config:

- **One agent per lane:** write `.claude/agents/<agent>.md` from `${CLAUDE_PLUGIN_ROOT}/templates/agent.md`, filled in from the docs (or the code, for brownfield):
  - owned paths;
  - its layers and what they may depend on;
  - the specs it reads;
  - the command that proves its work;
  - its lane rules.
  - If an agent already exists, keep its content and add only what's missing.
  - Drop the spec-check lines if the config has no `docs.specs`.
- **CLAUDE.md:** add the section from `${CLAUDE_PLUGIN_ROOT}/templates/claude-md.md`.
- **Project skills** (recipes like "new migration" or "new endpoint"): list the recipes the docs describe step by step, and offer to write them. Don't write them unasked, and never write an empty one.

Show the person:

1. the layers and what each may depend on, and for brownfield the existing violations the baseline will record;
2. the lanes, their agents and their paths;
3. protected paths, blocked and restricted commands, and checks (including any left out because they fail today);
4. every **question**: where the docs or the code are silent, ambiguous or contradictory. Don't guess; a wrong owner or layer blocks real work.

Once they approve (with any changes):

1. Rename the draft to `.claude/code-kit.json`. From then on, every hook enforces it.
2. If there are existing violations, run `baseline --write`. This writes `.claude/code-kit.baseline.json`.
3. If the project had local hooks in `.claude/settings.json` that the kit replaces, remove those hook entries and the local hook files. Keep the `permissions` block.
4. Add `.claude/approvals/`, `.claude/state/` and `.claude/code-kit.draft.json` to `.gitignore`.
5. Run `check` and `unowned` again, without `--config`.
6. Commit on a branch. The kit records the protected files in `.claude/approval-log.jsonl`.

Report what was set up, what's enforced from now on, how many existing violations the baseline holds, and the open questions.

## 4. Update an existing setup

Re-run whenever the build has moved on: new apps or packages, folders that moved, a changed plan, or files `unowned` keeps listing.

1. **Re-read** the docs and the repository as in section 1, including the brownfield steps if the code has grown past the docs.
2. **Draft** the whole config again into `.claude/code-kit.draft.json`, starting from the live one. Keep everything that's still right, so the diff shows only real changes.
3. **Show the difference:**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/code-kit.mjs" diff --config .claude/code-kit.draft.json
   node "${CLAUDE_PLUGIN_ROOT}/bin/code-kit.mjs" unowned --config .claude/code-kit.draft.json
   ```

   `diff` lists lanes, layers, checks and rules that were added (`+`), removed (`-`) or changed (`~`), and how many files change owner, route by route. Explain each change in a sentence, with where it came from: the doc section, or the folder in the repository.

4. **Also propose:**
   - agent files for new lanes, and updates to agents whose paths changed;
   - a smaller baseline when `baseline` shows violations were fixed. It only ever shrinks.
5. **On approval:**
   1. Replace `.claude/code-kit.json` with the draft and delete the draft.
   2. Write or update the agents.
   3. Run `baseline --write` if it shrank.
   4. Run `check` and `unowned`.
   5. Commit on a branch.

   Nothing changes until then.
