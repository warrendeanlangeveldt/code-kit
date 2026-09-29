#!/usr/bin/env node
// PreToolUse (Bash): blocks destructive and hook-skipping commands, work on protected branches, new
// dependencies, approval forgery, kit edits through the shell by anyone but the lead, the project's
// own blocked and lane-restricted commands; records protected files in the approval log on commit
// and scans commits for secrets. Shell writes are also checked afterwards by lane-audit.mjs.
import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { block, start } from './lib/hook.mjs';
import {
  APPROVAL_LOG,
  actorFor,
  approval,
  approvalHowTo,
  currentBranch,
  protectedEntry,
  sessionRoot,
} from './lib/rules.mjs';

const { input, project, config, error } = start();
const cmd = String(input.tool_input?.command || '');

const ALWAYS = [
  [/\bgit\s+push\b.*(--force\b|\s-f\b|--force-with-lease\b)/, 'Force-push is not allowed.'],
  [/--no-verify\b/, 'Skipping git hooks is not allowed.'],
  [
    /\brm\s+-rf?\s+(\/|~|\$HOME|\.\.?)(\s|$)/,
    'Refusing a destructive delete of a root, home or parent directory.',
  ],
  [/\b(curl|wget)\b[^|]*\|\s*(sh|bash|zsh)\b/, 'Piping downloads into a shell is not allowed.'],
  // a package name starts with a letter or @; flags, `&&` and redirects after a bare install are fine
  [
    /\b(pnpm|npm|yarn|bun)\b[^;&|]*?\s(add|i|install)\s+[a-z@]/i,
    'New dependencies need lead approval.',
  ],
  [/\b(uv|poetry|cargo|bundle)\s+add\s+[a-z@]/i, 'New dependencies need lead approval.'],
  [/\bpip3?\s+install\s+[a-z]/i, 'New dependencies need lead approval.'],
  [/\bgo\s+get\s+[a-z]/i, 'New dependencies need lead approval.'],
  [/\.claude\/approvals/, 'Approvals are created only by a person, with a `!` shell command.'],
  [
    /approval-log\.jsonl/,
    'The approval audit log is appended only by the commit hook; nobody edits it.',
  ],
];
// Downloading Playwright's browser build is not adding a dependency.
const browserDownload = /\bplaywright\s+install\b/.test(cmd);
for (const [re, why] of ALWAYS) {
  if (browserDownload && why.startsWith('New dependencies')) continue;
  if (re.test(cmd)) block(`Blocked: ${why}\nCommand: ${cmd}`);
}
if (error) {
  if (/\bgit\s+commit\b/.test(cmd)) block(`Blocked: ${error}\nFix the config before committing.`);
  process.exit(0);
}

const branches = config.branches.protected
  .map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
if (new RegExp(`\\bgit\\s+push\\b.*\\b(${branches})\\b`).test(cmd)) {
  block(
    `Blocked: push to your own branch; a person merges to ${config.branches.protected[0]} after review.\nCommand: ${cmd}`,
  );
}
for (const { pattern, why } of config.shell.block) {
  if (new RegExp(pattern).test(cmd)) block(`Blocked: ${why}\nCommand: ${cmd}`);
}

const sessionIn = sessionRoot(input, project);
const actor = actorFor(input, sessionIn ?? project, config);
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
if (
  /\bgit\s+(commit|merge|cherry-pick|rebase|revert)\b/.test(cmd) &&
  config.branches.protected.includes(branch)
) {
  block(
    `Blocked: never commit or merge on ${branch}. Work on a branch; a person merges after review.`,
  );
}

// Kit files edited through the shell follow the same rule as edits through Write/Edit.
const touchesKit =
  /\.claude\/(hooks|agents|skills|settings[^/]*\.json|README\.md|code-kit\.json)/.test(cmd);
// a real redirect into a file; `2>&1` and `>/dev/null` are not writes
const writes =
  /((?<![0-9&])>>?\s*(?!&|\/dev\/null)\S|\btee\b|\bsed\s+-i|\bperl\s+-i|\bmv\b|\bcp\b|\brm\b|\bpython3?\b|\bnode\s+-e|\btruncate\b|\bchmod\b|\bln\b)/.test(
    cmd,
  );
if (touchesKit && writes && actor.kind !== 'lead' && !approval(root, 'kit')) {
  block(
    `Blocked: the .claude kit is changed only by the lead or with a person's approval. Ask the lead to run\n${approvalHowTo('kit')}`,
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
  const addAll = /\bgit\s+add\s+[^;&|]*(\s|^)(-A|--all|\.)(\s|$)/.test(cmd);
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
// approval is in force. The log is staged into the same commit, so record and change land together.
function recordApprovals() {
  const { files, git } = committedFiles();
  const lines = [];
  for (const file of files.filter((f) => protectedEntry(f, config))) {
    const entry = protectedEntry(file, config);
    const granted = approval(root, entry.approval);
    if (!granted && actor.kind !== 'lead') {
      block(
        `Blocked: ${file} is ${entry.why}; committing it needs a person's approval in force. Ask the lead to run\n${approvalHowTo(entry.approval)}`,
      );
    }
    lines.push(
      JSON.stringify({
        at: new Date().toISOString(),
        approval: granted ? entry.approval : 'lead',
        reason: granted ? granted.reason : 'Lead change; reviewed in the pull request',
        grantedAt: granted ? granted.grantedAt : null,
        file,
        branch,
        actor: actor.label,
        session: input.session_id ?? null,
      }),
    );
  }
  if (lines.length === 0) return;
  appendFileSync(join(root, APPROVAL_LOG), `${lines.join('\n')}\n`);
  git('add', APPROVAL_LOG);
}

if (/\bgit\s+commit\b/.test(cmd)) {
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
