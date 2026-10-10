#!/usr/bin/env node
// PreToolUse (Bash): blocks destructive and hook-skipping commands, work on protected branches, new
// dependencies a person hasn't approved, approval forgery, kit edits through the shell by anyone but
// the lead, the project's own blocked and lane-restricted commands; records protected files in the
// approval log on commit and scans commits for secrets. Shell writes are also checked afterwards by
// lane-audit.mjs. With `approvals.lead` on, the lead may act for the person on what they say in chat:
// record their approvals (`code-kit approve`) and run blocked commands marked `person`.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { addedPackages, dependencyApproval, isDependencyFile } from './lib/dependencies.mjs';
import { CODE_KIT, GIT, codeOf, commandsOf, runs } from './lib/shell.mjs';
import { block, start } from './lib/hook.mjs';
import {
  APPROVAL_LOG,
  actorFor,
  arrivesWithMerge,
  approval,
  approvalHowTo,
  currentBranch,
  dependencyChange,
  dependencyGrants,
  useApproval,
  owns,
  protectedEntry,
  recordRequest,
  sessionRoot,
} from './lib/rules.mjs';

const { input, project, config, error } = start();
const cmd = String(input.tool_input?.command || '');

// Commands are recognised where they run (lib/shell.mjs), so a commit message, a heredoc, a quoted
// --text or a grep pattern that mentions one doesn't trip its rule.
const RUNS = [
  [
    new RegExp(String.raw`^${GIT}push\b.*(--force\b|\s-f\b|--force-with-lease\b)`),
    'Force-push is not allowed.',
  ],
  [new RegExp(String.raw`^${GIT}\S+\b.*\s--no-verify\b`), 'Skipping git hooks is not allowed.'],
  [
    /^rm\s+-rf?\s+(\/|~|\$HOME|\.\.?)(\s|$)/,
    'Refusing a destructive delete of a root, home or parent directory.',
  ],
];
for (const [re, why] of RUNS) {
  if (runs(cmd, re, { quoted: false })) block(`Blocked: ${why}\nCommand: ${cmd}`);
}
// These read the command whole: a pipe spans commands, and an approval or the log can be written
// through a quoted path.
const ALWAYS = [
  [
    /\b(curl|wget)\b[^|]*\|\s*(sh|bash|zsh)\b/,
    'Piping downloads into a shell is not allowed.',
    codeOf(cmd),
  ],
  [
    /\.claude\/approvals/,
    "Approvals are created only by a person, with a `!` shell command. A shell command may not name them, even to read them; read them with the Read tool (or Glob to list them), which can't write.",
    cmd,
  ],
  [
    /approval-log\.jsonl/,
    "The approval audit log is appended only by the commit hook; nobody edits it. A shell command may not name it, even to read it; read it with the Read tool, which can't write.",
    cmd,
  ],
];
for (const [re, why, text] of ALWAYS) {
  if (re.test(text)) block(`Blocked: ${why}\nCommand: ${cmd}`);
}
const packages = addedPackages(cmd);
const approves = runs(cmd, new RegExp(String.raw`^${CODE_KIT}\s+approve\b`));
const delegatedMerge = runs(cmd, new RegExp(String.raw`^${CODE_KIT}\s+(?:queue\s+)?merge\b`));
const queues = runs(cmd, new RegExp(String.raw`^${CODE_KIT}\s+queue\s+(?:add|drop)\b`));
const commits = runs(cmd, new RegExp(String.raw`^${GIT}commit\b`));
if (error) {
  if (commits) block(`Blocked: ${error}\nFix the config before committing.`);
  if (approves) block(`Blocked: ${error}\nApprovals wait until the config is valid.`);
  if (delegatedMerge) block(`Blocked: ${error}\nMerges wait until the config is valid.`);
  if (packages.length)
    block(`Blocked: ${error}\nNew dependencies wait until the config is valid.\nCommand: ${cmd}`);
  process.exit(0);
}

const branches = config.branches.protected
  .map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
// The branch is read before the command runs, so a command that switches to a protected branch and then
// commits or merges in the same breath is judged by what it does, not by where it starts. Moving a
// protected branch directly (branch -f, update-ref) is a commit on it by another name.
const writesHistory = runs(
  cmd,
  new RegExp(String.raw`^${GIT}(commit|merge|cherry-pick|rebase|revert|am)\b`),
);
const switchesToProtected = runs(
  cmd,
  new RegExp(
    String.raw`^${GIT}(?:switch|checkout)\s+(?:-[^\s]+\s+)*(${branches})(?![\w./-])(?!\s+--)`,
  ),
);
const movesProtected =
  runs(
    cmd,
    new RegExp(
      String.raw`^${GIT}branch\s+(?:\S+\s+)*(?:-f|--force|-M|-C)\b.*\b(${branches})(?![\w./-])`,
    ),
  ) ||
  runs(
    cmd,
    new RegExp(
      String.raw`^${GIT}update-ref\s+(?:-\S+\s+)*(?:refs/heads/)?(${branches})(?![\w./-])`,
    ),
  );
if ((switchesToProtected && writesHistory) || movesProtected) {
  block(
    `Blocked: never commit to, merge into or move ${config.branches.protected.join(' or ')}, even by switching to it first. Work on a branch; a person merges after review${config.approvals.delegate?.merge ? ', or the lead merges a verified branch with `code-kit merge <branch> --delegated`' : ''}.\nCommand: ${cmd}`,
  );
}
if (runs(cmd, new RegExp(String.raw`^${GIT}push\b.*\b(${branches})\b`))) {
  block(
    `Blocked: push to your own branch; a person merges to ${config.branches.protected[0]} after review.\nCommand: ${cmd}`,
  );
}

const sessionIn = sessionRoot(input, project);
const actor = actorFor(input, sessionIn ?? project, config);
// The lead acts for the person only where the config says the person may approve from chat.
const forPerson = actor.kind === 'lead' && config.approvals.lead;

for (const { pattern, why, person, command } of config.shell.block) {
  // `command: true`: the pattern names a command, matched from the start of each one the line runs, so a
  // heredoc or a quoted message that mentions it isn't refused. Otherwise it reads the whole text.
  const matched = command ? runs(cmd, new RegExp(pattern)) : new RegExp(pattern).test(cmd);
  if (!matched || (person && forPerson)) continue;
  const hint =
    person && actor.kind === 'lead'
      ? '\nTo let the lead run it when the person says so in chat, a person sets "approvals": { "lead": true } in the config.'
      : '';
  block(`Blocked: ${why}${hint}\nCommand: ${cmd}`);
}

if (approves && actor.kind !== 'lead')
  block(
    `Blocked: only the lead records or grants approvals. Write a short change request for the lead (what needs approving, and why), and stop.\nCommand: ${cmd}`,
  );
// The pane's acts are the person's: no agent passes --person or --via, whatever its other permissions.
if ((delegatedMerge && /\s--person\b/.test(cmd)) || (approves && /\s--via\b/.test(cmd)))
  block(
    `Blocked: merging or approving as the person is the person's own act, from the code-kit pane or their terminal. Ask them, and stop.\nCommand: ${cmd}`,
  );
// The harness settings are the person's to change, from the pane or their terminal.
if (runs(cmd, new RegExp(String.raw`^${CODE_KIT}\s+settings\s+set\b`)))
  block(
    `Blocked: changing the harness settings is the person's own act, from the code-kit pane (/harness) or their terminal. Tell them what you'd change and why, and stop.\nCommand: ${cmd}`,
  );
if (queues && actor.kind !== 'lead')
  block(
    `Blocked: only the lead puts branches in the merge queue, after its review passes them. Finish your story and commit it on your branch; the lead reviews it.\nCommand: ${cmd}`,
  );
if (delegatedMerge && actor.kind !== 'lead')
  block(
    `Blocked: only the lead merges into a protected branch. Finish your story and commit it on your branch; the lead reviews and merges it.\nCommand: ${cmd}`,
  );
if (delegatedMerge && !config.approvals.delegate?.merge)
  block(
    `Blocked: this project doesn't delegate merges to the lead ("approvals.delegate.merge" isn't true). A person merges after review.\nCommand: ${cmd}`,
  );
// The lead approves on its own only with --delegated, and only where the config delegates; the
// command itself refuses anything outside the rules.
const delegating = /\s--delegated\b/.test(cmd);
if (approves && delegating && !config.approvals.delegate)
  block(
    `Blocked: this project doesn't delegate approvals to the lead ("approvals.delegate" isn't set). Ask the person to approve it with the \`!\` command from the refusal.\nCommand: ${cmd}`,
  );
if (approves && !delegating && !forPerson)
  block(
    `Blocked: this project doesn't let the lead record approvals ("approvals.lead" is off).${config.approvals.delegate ? ' Within the delegated rules, approve it yourself with --delegated;' : ''} Ask the person to run the \`!\` command from the refusal, or to turn "approvals": { "lead": true } on in the config.\nCommand: ${cmd}`,
  );

// Each new package needs a person's approval, for this actor; it also covers the manifest and lockfile
// changes the install makes (lib/rules.mjs › dependencyChange).
if (packages.length) {
  if (actor.kind === 'readonly')
    block(`Blocked: ${actor.label} is read-only; it may not add dependencies.\nCommand: ${cmd}`);
  const unapproved = packages.filter(
    (p) => !approval(sessionIn ?? project, dependencyApproval(p), actor),
  );
  if (unapproved.length) {
    recordRequest(
      sessionIn ?? project,
      actor,
      unapproved.map(dependencyApproval),
      cmd,
      "A new dependency needs a person's approval.",
    );
    const ask =
      actor.kind === 'lead'
        ? 'Ask the person to approve it by running'
        : config.approvals.delegate
          ? "Write a short change request for the lead (the package, why, and the lane's story), and stop. The lead approves it within the project's delegated rules, or asks the person to run"
          : "Write a short change request for the lead (the package, why, and the lane's story), and stop. The lead asks the person to run";
    block(
      `Blocked: a new dependency (${unapproved.join(', ')}) needs a person's approval. ${ask}\n${approvalHowTo(
        unapproved.map(dependencyApproval),
        actor,
        sessionIn ?? project,
        'installing it, and the manifest and lockfile changes that makes,',
        config,
      )}\nCommand: ${cmd}`,
    );
  }
}
for (const { pattern, lanes, why } of config.shell.restricted) {
  const allowed = actor.kind === 'lead' || (actor.kind === 'lane' && lanes.includes(actor.lane));
  if (!allowed && new RegExp(pattern).test(cmd))
    block(`Blocked: the ${actor.label} may not run this. ${why}\nCommand: ${cmd}`);
}

// Git commands run against the repository they name (`git -C dir`) or the one the shell is in. Another
// repository (not this project or one of its worktrees) follows its own rules.
const gitDir = cmd.match(/\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/)?.[1]?.replace(/^["']|["']$/g, '');
const root = gitDir
  ? sessionRoot({ cwd: resolve(input.cwd || project, gitDir) }, project)
  : sessionIn;
if (!root) process.exit(0);

let branch = '';
try {
  branch = currentBranch(root);
} catch {
  // not a git repository yet
}
if (writesHistory && config.branches.protected.includes(branch)) {
  block(
    `Blocked: never commit or merge on ${branch}. Work on a branch; a person merges after review.`,
  );
}

// Kit files edited through the shell follow the same rule as edits through Write/Edit: a command that
// names a kit file and writes, judged one simple command at a time, so a redirect elsewhere in the line
// (`npm install > /tmp/log; ls .claude/skills`) isn't taken for a write to the kit. A write the shell
// hides (a script, a variable) is still caught after the call, as a change outside the actor's paths.
const KIT_PATH = /\.claude\/(hooks|agents|skills|settings[^/]*\.json|README\.md|code-kit\.json)/;
// a real redirect into a file; `2>&1` and `>/dev/null` are not writes
const WRITES =
  /((?<![0-9&])>>?\s*(?!&|\/dev\/null)\S|\btee\b|\bsed\s+-i|\bperl\s+-i|\bmv\b|\bcp\b|\brm\b|\bpython3?\b|\bnode\s+-e|\btruncate\b|\bchmod\b|\bln\b)/;
const kitWrite = commandsOf(cmd).some((c) => KIT_PATH.test(c.text) && WRITES.test(c.text));
if (kitWrite && actor.kind !== 'lead' && !approval(root, 'kit', actor)) {
  recordRequest(
    root,
    actor,
    'kit',
    cmd,
    "The .claude kit is changed only by the lead or with a person's approval.",
  );
  block(
    `Blocked: the .claude kit is changed only by the lead or with a person's approval. Ask the lead to run\n${approvalHowTo('kit', actor, root, undefined, config)}`,
  );
}

/** Files this commit will include: staged now, plus what the same command stages first. */
function committedFiles() {
  const git = (...args) =>
    spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' }).stdout ?? '';
  const names = (out) => out.split('\n').filter(Boolean);
  const staged = names(git('diff', '--cached', '--name-only'));
  // This hook runs before the command, so `git add … && git commit` and `git commit -a` have not staged yet.
  const changed = names(git('status', '--porcelain', '-uall', '--no-renames')).map((l) =>
    l.slice(3),
  );
  const commitAll = /\bgit\s+commit\b[^;&|]*\s(-a|--all|-[b-zB-Z]*a[a-zA-Z]*)(\s|$)/.test(cmd);
  const addAll = /\bgit\s+add\b[^;&|]*\s(-A|--all|\.)(\s|$)/.test(cmd);
  const addArgs = [...cmd.matchAll(/\bgit\s+add\s+([^;&|]+)/g)]
    .flatMap((m) => m[1].trim().split(/\s+/))
    .filter((a) => a && !a.startsWith('-'));
  const added = changed.filter(
    (f) =>
      commitAll ||
      addAll ||
      addArgs.some((a) => f === a || f.startsWith(`${a.replace(/\/$/, '')}/`)),
  );
  return { files: [...new Set([...staged, ...added])], git };
}

// Every committed protected file is recorded in the audit log, with the person's reason when an
// approval is in force. So is a lane's manifest or lockfile change, outside its own paths, made under a
// dependency approval: that entry is how `code-kit verify` accepts it. The log is staged into the same
// commit, so record and change land together.
function recordApprovals() {
  const { files, git } = committedFiles();
  const lines = [];
  const record = (file, fields) =>
    lines.push(
      JSON.stringify({
        at: new Date().toISOString(),
        ...fields,
        file,
        branch,
        actor: actor.label,
        session: input.session_id ?? null,
      }),
    );
  for (const file of files) {
    // Concluding a merge: what arrives as the other branch has it was logged there, with its approvals.
    if (arrivesWithMerge(root, file, { staged: true })) continue;
    const entry = protectedEntry(file, config);
    const granted = entry && approval(root, entry.approval, actor);
    const byDependency = actor.kind === 'lane' && dependencyChange(actor, file, root, config);
    if (entry && !granted && actor.kind !== 'lead' && !byDependency) {
      recordRequest(root, actor, entry.approval, file, entry.why);
      block(
        `Blocked: ${file} is ${entry.why}; committing it needs a person's approval in force. Ask the lead to run\n${approvalHowTo(entry.approval, actor, root, undefined, config)}`,
      );
    }
    if (granted)
      record(file, {
        approval: entry.approval,
        reason: granted.reason,
        grantedAt: granted.grantedAt,
      });
    else if (byDependency && (entry || !owns(actor, file, config))) {
      const grants = dependencyGrants(root, actor);
      record(file, {
        approval: 'dependency',
        packages: grants.map((g) => g.name),
        reason: grants.map((g) => g.reason).join('; '),
        grantedAt: grants[0].grantedAt,
      });
    } else if (entry)
      record(file, {
        approval: 'lead',
        reason: 'Lead change; reviewed in the pull request',
        grantedAt: null,
      });
  }
  // A dependency approval is used up by the commit that adds its package to a manifest or lockfile.
  const manifests = files.filter((f) => isDependencyFile(f));
  if (manifests.length && actor.kind !== 'readonly') {
    // The lines each manifest gains on HEAD, read from the working tree: this hook runs before
    // `git add … && git commit` has staged anything, and a new manifest isn't tracked yet.
    const added = manifests
      .flatMap((f) => {
        const before = new Set(git('show', `HEAD:${f}`).split('\n'));
        const now = existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : '';
        return now.split('\n').filter((l) => !before.has(l));
      })
      .join('\n');
    for (const g of dependencyGrants(root, actor)) {
      const pkg = g.name.slice('dep-'.length).replaceAll('+', '/');
      const quoted = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`["'\\s/]${quoted}["'@=:\\s]`).test(added)) useApproval(root, g.name, actor);
    }
  }
  if (lines.length === 0) return;
  appendFileSync(join(root, APPROVAL_LOG), `${lines.join('\n')}\n`);
  git('add', APPROVAL_LOG);
}

if (commits) {
  recordApprovals();
  const scan = spawnSync('gitleaks', ['protect', '--staged', '--redact', '--no-banner'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (scan.error?.code !== 'ENOENT' && scan.status === 1) {
    block(
      `Blocked: gitleaks found possible secrets in staged changes.\n${scan.stdout}${scan.stderr}`,
    );
  }
}
process.exit(0);
