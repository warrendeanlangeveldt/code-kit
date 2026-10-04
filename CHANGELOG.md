# Changelog

What changed in each release of code-kit, newest first. Versions follow the plugin manifest and the npm package `@warren-dean/code-kit`. Each release is also on [GitHub Releases](https://github.com/warrendeanlangeveldt/code-kit/releases).

## 0.3.10 (2026-10-04)

- **Delegated ratification trailer:** Context Graph's delegated ratification trailer (`Ctx-Ratified-By: <ratifier> (delegated)`) may be written by the lead only, never by a lane. A person's trailer stays blocked for every agent, as before.
- **Adapters:** they can now add lead-only shell rules (`shell.restricted`) as well as blocked ones.

## 0.3.9 (2026-10-04)

- **Delegated approvals:** with `"approvals": { "delegate": { "protected": [...], "dependencies": {...} } }`, the lead can approve on its own authority with `code-kit approve … --delegated`. This is for a lead that runs without a person watching.
  - **Protected approvals:** only the names you list.
  - **Dependencies:** checked against the npm registry for licence, weekly downloads, recent releases and install scripts.
  - **All or nothing:** anything outside the rules approves nothing, and goes to the person.
  - **The record:** every delegated approval is marked with the rule it used.
- **`code-kit approve` takes package names:** `approve @scope/pkg` now means `dep-@scope+pkg`, where it used to refuse the name.

## 0.3.8 (2026-10-03)

- **Lead stories:** plans can give the lead its own stories (`**Lane:** lead`), such as contracts, foundations and spikes. `code-kit next` hands them to the lead instead of dispatching them, and `status` no longer calls `lead` an unknown lane.
- **Stories with no requirements:** `**Requirements:** none` marks a story that delivers no requirement, such as a spike.
- **The CLI** no longer crashes when its output is piped into `head`.

## 0.3.7 (2026-10-03)

- **Approvals from chat:** with `"approvals": { "lead": true }`, the lead can record an approval you give in chat with `code-kit approve`, for when `!` isn't available, as on a phone. The approval is marked as given in chat. The lead may also run `shell.block` commands marked `person: true` when you say so.

## 0.3.6 (2026-10-02)

- **Companion plugin:** the README, `llms.txt` and the init skill now point to Context Graph. Init mentions it once when it isn't installed, and never installs it unasked.

## 0.3.5 (2026-10-02)

- **Logo and diagram:** the npm package now includes them, and the README shows them on npmjs.com too.

## 0.3.4 (2026-10-02)

- **Dependency approvals:** each new package needs a person's approval (`dep-<package>`), for one lane or for everyone. The approval also covers the manifest and lockfile changes the install makes. The commit hook logs those changes, and `code-kit verify` accepts them.
- **A hole closed:** flags before a package name (`npm install -D lodash`) no longer slip past the guard.
- **Worktrees:** approvals are read from the main checkout, so a lane working in its own worktree sees them.
- **Wording:** the README states the hooks' deliberate limits instead of promising hard guarantees.

## 0.3.3 (2026-10-01)

- **Descriptions:** they now open with what code-kit does for AI coding agents.

## 0.3.2 (2026-10-01)

- **npm:** published as `@warren-dean/code-kit`. CI uses `npx @warren-dean/code-kit verify`.
- **For AI tools:** an `llms.txt` and an `AGENTS.md` describe the plugin.

## 0.3.1 (2026-10-01)

- **Ready to install from a public repository:** MIT licence, a security policy, and install instructions.

## 0.3.0 (2026-09-30)

- **Adapters** for tools that share a project, starting with Context Graph.
- **`code-kit trace`:** reports the requirements, lane and layer of a file.
- **Earlier layer checks:** layer rules are now checked before a write, not just after it.

## 0.2.0 (2026-09-29)

- **From idea to merged code:** the spec-design, dispatch, review, status, verify and next skills, built on the rules from 0.1.0.

## 0.1.0

- **Project rules from `.claude/code-kit.json`:** lanes, layers, protected paths with an approval log, spec-check before code, and proof before finishing, all enforced by hooks.
