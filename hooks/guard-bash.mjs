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
import {
  addedPackages,
  dependencyApproval,
  ecosystemOf,
  isDependencyFile,
} from './lib/dependencies.mjs';
import { CODE_KIT, GIT, codeOf, commandsOf, runs } from './lib/shell.mjs';
import { block, start } from './lib/hook.mjs';
import { CONFIG_FILE, committedConfig } from './lib/config.mjs';
import { laneOfBranch, storyOfBranch, teamOf, teamProvider, whoami } from './lib/team.mjs';
import { globToRegExp, matchesAny } from './lib/glob.mjs';
import { noteBefore } from './lane-audit.mjs';
import { TESTS_APPROVAL, commitWeakenings } from './lib/regression.mjs';
import {
  STANDARDS_APPROVAL,
  noteFor,
  standardsFile,
  standardsWeakenings,
} from './lib/standards.mjs';
import {
  APPROVAL_LOG,
  actorFor,
  arrivesWithMerge,
  approval,
  approvalHowTo,
  askHowTo,
  currentBranch,
  decidedBy,
  delegatedMark,
  dependencyChange,
  dependencyGrants,
  leadDecides,
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
/**
 * Whether `cmd` only reads git's history, with what it prints piped into read-only filters: `git diff
 * main...HEAD -- .claude/approval-log.jsonl`, `git log -p -- … | head`. No redirect, no tee, nothing else.
 */
function gitReadsOnly(cmd) {
  const code = codeOf(cmd);
  if (/>|\btee\b|`|\$\(/.test(code)) return false;
  const parts = commandsOf(cmd);
  return (
    parts.length > 0 &&
    new RegExp(String.raw`^${GIT}(?:diff|log|show|blame)\b`).test(parts[0].code) &&
    parts.slice(1).every((c) => /^(?:grep|head|tail|wc|cat|sort|uniq|less)\b/.test(c.code))
  );
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
    "The approval audit log is appended only by the commit hook; nobody edits it. A shell command may not name it except to read its history with git (git diff, log or show, piped only into grep, head, tail or wc); read the file itself with the Read tool, which can't write.",
    gitReadsOnly(cmd) ? '' : cmd,
  ],
];
for (const [re, why, text] of ALWAYS) {
  if (re.test(text)) block(`Blocked: ${why}\nCommand: ${cmd}`);
}
const packages = addedPackages(cmd);
const approves = runs(cmd, new RegExp(String.raw`^${CODE_KIT}\s+approve\b`));
const delegatedMerge = runs(cmd, new RegExp(String.raw`^${CODE_KIT}\s+(?:queue\s+)?merge\b`));
const queues = runs(cmd, new RegExp(String.raw`^${CODE_KIT}\s+queue\s+(?:add|drop)\b`));
const rulesOntoBase = runs(cmd, new RegExp(String.raw`^${CODE_KIT}\s+queue\s+rules\b`));
const asks = runs(cmd, new RegExp(String.raw`^${CODE_KIT}\s+ask\b\s+(?!--json\b)\S`));
const dropsRequests = runs(cmd, new RegExp(String.raw`^${CODE_KIT}\s+requests\s+drop\b`));
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
/** Whether `file` is committed at HEAD in the repository at `root`. */
function committedOnHead(root, file) {
  return (
    spawnSync('git', ['-C', root, 'cat-file', '-e', `HEAD:${file}`], { stdio: 'ignore' }).status ===
    0
  );
}

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
const sessionIn = sessionRoot(input, project);
const actor = actorFor(input, sessionIn ?? project, config);
// #63: the lead may push a protected branch where the person delegated it (`approvals.delegate.push`,
// read from the config committed on that branch, so a branch can't grant it), and never by force.
if (runs(cmd, new RegExp(String.raw`^${GIT}push\b.*\b(${branches})\b`))) {
  const forced = runs(
    cmd,
    new RegExp(
      String.raw`^${GIT}push\b.*(\s--force\S*|\s-[a-zA-Z]*f|\s\+\S|\s--delete\b|\s-d\b|\s--mirror\b|\s:(${branches})\b)`,
    ),
  );
  const pushTo = config.branches.protected.find((b) =>
    runs(
      cmd,
      new RegExp(String.raw`^${GIT}push\b.*\b${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\b`),
    ),
  );
  const delegated =
    actor.kind === 'lead' &&
    Boolean(
      committedConfig(project, pushTo ?? config.branches.protected[0]).config?.approvals.delegate
        ?.push,
    );
  if (!delegated || forced)
    block(
      forced && delegated
        ? `Blocked: never force-push, delete or overwrite ${pushTo}; push it as it is, fast-forward only.\nCommand: ${cmd}`
        : `Blocked: push to your own branch; a person merges to ${config.branches.protected[0]} after review${actor.kind === 'lead' ? `, and pushes it, unless they delegate pushing it to you ("approvals.delegate.push": true, committed on ${config.branches.protected[0]})` : ''}.\nCommand: ${cmd}`,
    );
}
// A read-only agent's command is judged afterwards by what it changed (lane-audit).
if (actor.kind === 'readonly') noteBefore(input);
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
  block(
    `Blocked: ${why}${noteFor(project, config, { kind: 'shell', name: why })}${hint}\nCommand: ${cmd}`,
  );
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
// ASK-2, CARD-7: answering as the person, or dismissing their request, is theirs, from the pane.
if ((asks || dropsRequests) && /\s--via\b/.test(cmd))
  block(
    `Blocked: answering a question or dismissing a request in the person's name is their own act, from the code-kit pane or their terminal. Ask them, and stop.\nCommand: ${cmd}`,
  );
// ASK-1: questions for the person, and taking back requests, go through the lead.
if ((asks || dropsRequests) && actor.kind !== 'lead')
  block(
    `Blocked: only the lead asks the person a question or drops an approval request. Write the question for the lead (what you need decided, the options and what each does), and stop.\nCommand: ${cmd}`,
  );
// REPORT-3: sending a report to code-kit's GitHub, under the person's account, or discarding it, is theirs.
if (runs(cmd, new RegExp(String.raw`^${CODE_KIT}\s+report\s+(send|discard)\b`)))
  block(
    `Blocked: sending a bug report to code-kit's GitHub, or discarding it, is the person's own act, from the code-kit pane or their terminal. Tell them it's drafted, and carry on.\nCommand: ${cmd}`,
  );
// Pausing and resuming the lead loop is the person's, from the band or their terminal.
if (runs(cmd, new RegExp(String.raw`^${CODE_KIT}\s+loop\s+(pause|resume)\b`)))
  block(
    `Blocked: pausing or resuming the lead loop is the person's own act, from the code-kit band or their terminal. Ask them, and stop.\nCommand: ${cmd}`,
  );
// LOOP-10, SESS-2: which session leads is recorded by code-kit's hooks and band, and choosing it is
// the person's own act.
if (
  runs(cmd, new RegExp(String.raw`^${CODE_KIT}\s+loop\s+(lead|release)\b`)) ||
  runs(cmd, new RegExp(String.raw`^${CODE_KIT}\s+sessions\s+(lead|beat)\b`))
)
  block(
    `Blocked: which session leads the project is recorded by code-kit, and choosing it is the person's own act (Lead from here, in the code-kit band, or \`code-kit sessions lead\` in their terminal). Carry on with your work.\nCommand: ${cmd}`,
  );
// TEAM-9: handing someone's claim to someone else is the tech lead's own decision too.
if (runs(cmd, new RegExp(String.raw`^${CODE_KIT}\s+team\s+reassign\b`)))
  block(
    `Blocked: reassigning a claim is the tech lead's own decision, from their terminal or the code-kit pane. Tell them who holds it, since when, and who you'd suggest, and stop.\nCommand: ${cmd}`,
  );
// TEAM-5: agreeing or dropping an intent is the tech lead's own decision, from their terminal or the pane.
if (runs(cmd, new RegExp(String.raw`^${CODE_KIT}\s+intend\s+(agree|drop|duplicate)\b`)))
  block(
    `Blocked: agreeing or dropping an intent is the tech lead's own decision, from their terminal or the code-kit pane. Tell them what you'd recommend and why, and stop.\nCommand: ${cmd}`,
  );
// TEAM-13: setting the team up, or taking it out, rewrites the config: the lead's, once the person agrees.
if (
  runs(cmd, new RegExp(String.raw`^${CODE_KIT}\s+team\s+init\b.*\s--write\b`)) &&
  actor.kind !== 'lead'
)
  block(
    `Blocked: the team's setup is the lead's to write, once the person agrees (/code-kit:team-init). Tell the lead what you'd change, and stop.\nCommand: ${cmd}`,
  );
// The harness settings are the person's to change, from the pane or their terminal.
if (runs(cmd, new RegExp(String.raw`^${CODE_KIT}\s+settings\s+set\b`)))
  block(
    `Blocked: changing the harness settings is the person's own act, from the code-kit pane (/harness) or their terminal. Tell them what you'd change and why, and stop.\nCommand: ${cmd}`,
  );
// LEAN-6: releasing or pruning worktrees is the lead's, which knows which stories are still at work.
if (
  runs(cmd, new RegExp(String.raw`^${CODE_KIT}\s+worktrees\s+(?:release|prune)\b`)) &&
  actor.kind !== 'lead'
)
  block(
    `Blocked: releasing worktrees is the lead's, which knows which stories are still at work. Finish your story and hand back.\nCommand: ${cmd}`,
  );
// LEAN-8: discarding a worktree's uncommitted changes is the person's, from the band, whoever asks.
if (runs(cmd, new RegExp(String.raw`^${CODE_KIT}\s+worktrees\s+discard\b`)))
  block(
    `Blocked: discarding a worktree that still holds uncommitted changes is the person's own act, from the code-kit band. Tell them which worktree and what it holds, and carry on.\nCommand: ${cmd}`,
  );
// ONB-8: code-kit's instructions are the lead's to bring up to date, like the rest of the kit.
if (
  runs(cmd, new RegExp(String.raw`^${CODE_KIT}\s+instructions\b.*\s--write\b`)) &&
  actor.kind !== 'lead'
)
  block(
    `Blocked: code-kit's instructions in CLAUDE.md and the agent files are the lead's to update. Tell the lead they're behind, and carry on.\nCommand: ${cmd}`,
  );
if (queues && actor.kind !== 'lead')
  block(
    `Blocked: only the lead puts branches in the merge queue, after its review passes them. Finish your story and commit it on your branch; the lead reviews it.\nCommand: ${cmd}`,
  );
if (rulesOntoBase && actor.kind !== 'lead')
  block(
    `Blocked: only the lead puts code-kit's rules onto the protected branch. Finish your story and commit it on your branch; the lead takes it from there.\nCommand: ${cmd}`,
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
    `Blocked: this project keeps every approval for the person ("approvals.delegate" is false). Ask the person to approve it with the \`!\` command from the refusal.\nCommand: ${cmd}`,
  );
if (approves && !delegating && !forPerson)
  block(
    `Blocked: this project doesn't let the lead record approvals ("approvals.lead" is off).${config.approvals.delegate ? ' Within the delegated rules, approve it yourself with --delegated;' : ''} Ask the person to run the \`!\` command from the refusal, or to turn "approvals": { "lead": true } on in the config.\nCommand: ${cmd}`,
  );

// Each new package needs an approval for this actor (the lead's where dependencies are delegated, HELM-3,
// otherwise a person's); it also covers the manifest and lockfile changes the install makes (lib/rules.mjs › dependencyChange).
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
      'A new dependency needs an approval.',
      Date.now(),
      // HELM-3: where each package comes from, for the registry rules (npm's only).
      { registries: Object.fromEntries(unapproved.map((p) => [p, ecosystemOf(cmd, p)])) },
    );
    // HELM-2, HELM-3: a lane asks the lead, which judges the package on its merits where it decides.
    const names = unapproved.map(dependencyApproval);
    const whose =
      decidedBy(names, config, actor) === 'lead'
        ? "is the lead's decision"
        : "needs a person's approval";
    block(
      `Blocked: a new dependency (${unapproved.join(', ')}) ${whose}. ${askHowTo(names, actor, sessionIn ?? project, config, { allows: 'installing it, and the manifest and lockfile changes that makes,' })}\nCommand: ${cmd}`,
    );
  }
}
for (const { pattern, lanes, why } of config.shell.restricted) {
  const allowed = actor.kind === 'lead' || (actor.kind === 'lane' && lanes.includes(actor.lane));
  if (!allowed && new RegExp(pattern).test(cmd))
    block(`Blocked: the ${actor.label} may not run this. ${why}\nCommand: ${cmd}`);
}

// Git commands run against the repository they name (`git -C dir`), the one the command moves into
// first (`cd dir && git commit`, #55), or the one the shell is in. Another repository (not this project
// or one of its worktrees) follows its own rules.
const unquote = (v) => v?.replace(/^["']|["']$/g, '');
const gitDir =
  unquote(cmd.match(/\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/)?.[1]) ??
  unquote(cmd.match(/^\s*cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)\s*(?:&&|;)/)?.[1]);
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
// SETUP-1: the one exception is setting up. Until the protected branch has the rules committed, the
// lead commits the setup the person approved straight onto it, so no first merge needs anyone; from
// that commit on, the branch is protected by the rules it now holds.
const settingUp =
  actor.kind === 'lead' &&
  runs(cmd, new RegExp(String.raw`^${GIT}commit\b`)) &&
  !runs(cmd, new RegExp(String.raw`^${GIT}(merge|cherry-pick|rebase|revert|am)\b`)) &&
  !committedOnHead(root, CONFIG_FILE);
if (writesHistory && config.branches.protected.includes(branch) && !settingUp) {
  block(
    `Blocked: never commit or merge on ${branch}. Work on a branch; the lead merges it after review (or the person, where merges aren't delegated).`,
  );
}

// TEAM-1, TEAM-4: in a team, making a story's branch claims the story (the dispatch), refused when the
// lane is someone else's or the story is already claimed; a commit on it grows the claim's lease with
// what the branch changes. When the shared repository can't be reached, nothing here is checked.
const team = teamOf(config);
if (team) {
  const me = whoami(project);
  const made = commandsOf(cmd)
    .map((c) =>
      c.text.match(
        new RegExp(
          String.raw`^${GIT}(?:switch\s+(?:-c|--create)|checkout\s+-b|worktree\s+add\b.*?\s-b)\s+(\S+)`,
        ),
      ),
    )
    .find(Boolean)?.[1];
  const story = storyOfBranch(made);
  if (story && me) {
    const lane = laneOfBranch(made);
    const owners = team.owners[lane];
    if (owners && !owners.includes(me))
      block(
        `Blocked: the ${lane} lane is ${owners.join(' and ')}'s, so ${story} is theirs to dispatch. Leave it for them, or ask the tech lead (${team.techLead}) to change the lane's owners.\nCommand: ${cmd}`,
      );
    const claimed = teamProvider(project, team).claim(story);
    if (claimed.holder)
      block(
        `Blocked: ${story} is already claimed by ${claimed.holder.by}, so someone is building it. Pick another story, or ask ${claimed.holder.by} or the tech lead (${team.techLead}) to release it.\nCommand: ${cmd}`,
      );
  }
  // The branch by name, which also works before its first commit.
  const named = spawnSync('git', ['-C', root, 'symbolic-ref', '--short', '-q', 'HEAD'], {
    encoding: 'utf8',
  }).stdout?.trim();
  const mine = storyOfBranch(named || branch);
  if (commits && mine && me) {
    const provider = teamProvider(project, team);
    const claim = provider.state().claims?.find((c) => c.story === mine && c.by === me);
    const base = config.branches.protected[0];
    const since = spawnSync('git', ['-C', root, 'merge-base', 'HEAD', base], { encoding: 'utf8' });
    const changed = (args) =>
      spawnSync('git', ['-C', root, 'diff', '--name-only', ...args], { encoding: 'utf8' })
        .stdout.split('\n')
        .filter(Boolean);
    const files = [
      ...(since.status === 0 ? changed([since.stdout.trim()]) : []),
      ...changed(['--cached']),
    ];
    const grown = files.filter((f) => !matchesAny(f, claim?.lease ?? []));
    if (claim && grown.length) provider.claim(mine, grown);
  }
}

// Kit files edited through the shell follow the same rule as edits through Write/Edit: a command that
// names a kit file and writes, judged one simple command at a time, so a redirect elsewhere in the line
// (`npm install > /tmp/log; ls .claude/skills`) isn't taken for a write to the kit. A write the shell
// hides (a script, a variable) is still caught after the call, as a change outside the actor's paths.
const KIT_PATH = /\.claude\/(hooks|agents|skills|settings[^/]*\.json|README\.md|code-kit\.json)/;
// a real redirect into a file; `2>&1` and `>/dev/null` are not writes
const WRITES =
  /((?<![0-9&])>>?\s*(?!&|\/dev\/null)\S|\btee\b|\bsed\s+-i|\bperl\s+-i|\bmv\b|\bcp\b|\brm\b|\btruncate\b|\bchmod\b|\bln\b)/;
// An inline script (`python3 -c`, `node -e`) is judged by its code: lanes read the config this way,
// and a read isn't a change to the kit. A Python script run from a file can't be read here, so it counts.
const SCRIPT = /\bpython3?\b/;
const INLINE =
  /(?:^|\s)(?:python3?\s+(?:-\w+\s+)*-c|node\s+(?:-\w+\s+)*(?:-e|--eval|-p|--print))\s/;
const SCRIPT_WRITES =
  /\bopen(?:Sync)?\s*\([^)]*['"][rwax]*[wax+][rwax+b]*['"]|\.write_(?:text|bytes)\b|\.(?:unlink|rename|touch|rmdir|chmod|symlink_to)\s*\(|\bos\.(?:remove|unlink|rename|replace|rmdir|chmod|symlink|system|popen)\b|\bshutil\.|\bsubprocess\.|\b(?:writeFile|appendFile|rm|rmdir|unlink|rename|copyFile|cp|chmod|truncate|symlink|createWriteStream)(?:Sync)?\s*\(|\bexecSync\b|\bspawnSync\b|\bchild_process\b/;
const writesKit = ({ text, code }) => {
  if (!KIT_PATH.test(text)) return false;
  // the script's own text is quoted, so a `>` in it isn't a redirect; one outside it still is
  if (INLINE.test(text)) return WRITES.test(code) || SCRIPT_WRITES.test(text);
  return WRITES.test(text) || SCRIPT.test(text);
};
const kitWrite = commandsOf(cmd).some(writesKit);
if (kitWrite && actor.kind !== 'lead' && !approval(root, 'kit', actor)) {
  recordRequest(
    root,
    actor,
    'kit',
    cmd,
    "The .claude kit is changed only by the lead or with a person's approval.",
  );
  block(
    `Blocked: the .claude kit is changed only by the lead or with a person's approval. ${askHowTo('kit', actor, root, config, { need: 'the change to the kit, and what the story needs it for' })}`,
  );
}

/** Files this commit will include: staged now, plus what the same command stages first. */
function committedFiles() {
  const git = (...args) =>
    spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' }).stdout ?? '';
  const names = (out) => out.split('\n').filter(Boolean);
  // Both paths of a staged rename: the old one's deletion is a change to it too (#74).
  const staged = names(git('diff', '--cached', '--name-only', '--no-renames'));
  // This hook runs before the command, so `git add … && git commit` and `git commit -a` have not staged yet.
  const changed = names(git('status', '--porcelain', '-uall', '--no-renames')).map((l) =>
    l.slice(3),
  );
  const commitAll = /\bgit\s+commit\b[^;&|]*\s(-a|--all|-[b-zB-Z]*a[a-zA-Z]*)(\s|$)/.test(cmd);
  const addAll = /\bgit\s+add\b[^;&|]*\s(-A|--all|\.)(\s|$)/.test(cmd);
  const addArgs = [...cmd.matchAll(/\bgit\s+add\s+([^;&|]+)/g)]
    .flatMap((m) => m[1].trim().split(/\s+/))
    .filter((a) => a && !a.startsWith('-'))
    .map((a) => a.replace(/^(['"])(.*)\1$/, '$2'));
  // What the shell expands before git sees it (#76): an argument it can't be read from, such as a
  // variable or a command's output, could be any file, so every changed file counts.
  const unknowable = addArgs.some((a) => /[$`]/.test(a));
  const matches = (f, a) => {
    const arg = a.replace(/^\.\//, '').replace(/\/$/, '');
    if (f === arg || f.startsWith(`${arg}/`)) return true;
    if (!/[*?{[]/.test(arg)) return false;
    const re = globToRegExp(arg);
    return f.split('/').some((_, i, parts) => re.test(parts.slice(0, i + 1).join('/')));
  };
  const added = changed.filter(
    (f) => commitAll || addAll || unknowable || addArgs.some((a) => matches(f, a)),
  );
  // `git reset --soft <ref> && git commit` commits everything since <ref>, staged by the reset (#76).
  const resetTo = [...cmd.matchAll(/\bgit\s+reset\s+--soft\s+([^\s;&|]+)/g)].map((m) => m[1]);
  const reset = resetTo.flatMap((ref) =>
    names(git('diff', '--name-only', '--no-renames', ref, 'HEAD')),
  );
  return { files: [...new Set([...staged, ...added, ...reset])], git };
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
  // STD-5: removing a standard, or weakening a required one, is the person's own call, never the lead's,
  // delegated or not. The commit waits for their `standards` approval, which records what it weakened.
  const stdFile = standardsFile(config);
  const stdWeak =
    files.includes(stdFile) && !arrivesWithMerge(root, stdFile, { staged: true })
      ? standardsWeakenings(
          git('show', `HEAD:${stdFile}`),
          existsSync(join(root, stdFile)) ? readFileSync(join(root, stdFile), 'utf8') : '',
        )
      : [];
  if (stdWeak.length) {
    const granted = approval(root, STANDARDS_APPROVAL, actor);
    if (!granted || granted.reason.includes(delegatedMark('').slice(0, -1))) {
      recordRequest(
        root,
        actor,
        STANDARDS_APPROVAL,
        stdFile,
        `Standards weakened: ${stdWeak.join('; ')}.`,
      );
      const personOnly = { ...config, approvals: { ...config.approvals, delegate: null } };
      block(
        `Blocked: this commit weakens the project's standards in ${stdFile}: ${stdWeak.join('; ')}. Removing a standard, or weakening a required one, is the person's call, never the lead's. Ask them, with what the standard costs the project and your recommendation; they approve it with\n${approvalHowTo(STANDARDS_APPROVAL, actor, root, 'weakening the standards in one commit', personOnly)}`,
      );
    }
  }
  for (const file of files) {
    // Concluding a merge: what arrives as the other branch has it was logged there, with its approvals.
    if (arrivesWithMerge(root, file, { staged: true })) continue;
    // A weakened standards file is the person's even where the config doesn't protect it.
    const entry =
      protectedEntry(file, config) ??
      (file === stdFile && stdWeak.length
        ? { approval: STANDARDS_APPROVAL, why: "the project's standards" }
        : null);
    const granted = entry && approval(root, entry.approval, actor);
    const byDependency = actor.kind === 'lane' && dependencyChange(actor, file, root, config);
    if (entry && !granted && actor.kind !== 'lead' && !byDependency) {
      recordRequest(root, actor, entry.approval, file, entry.why);
      block(
        `Blocked: ${file} is ${entry.why}; committing it needs ${decidedBy(entry.approval, config, actor) === 'lead' ? "the lead's" : "a person's"} approval in force.${noteFor(root, config, { kind: 'protected', name: entry.approval, glob: entry.glob })} ${askHowTo(entry.approval, actor, root, config)}`,
      );
    }
    if (granted)
      record(file, {
        approval: entry.approval,
        reason: granted.reason,
        grantedAt: granted.grantedAt,
        ...(file === stdFile && stdWeak.length ? { weakened: stdWeak } : {}),
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
  // REG-2: a commit that weakens a test waits for a `tests` approval: WHO-2, the lead's on a lane's
  // branch where tests are delegated, otherwise the person's (always on the lead's own). It's recorded in
  // the log, so verify accepts the branch, and used up by this commit.
  const weakened = commitWeakenings(
    root,
    files.filter((f) => !arrivesWithMerge(root, f, { staged: true })),
    config,
  );
  if (weakened.length) {
    const granted = approval(root, TESTS_APPROVAL, actor);
    const said = (w) => `it ${w.reasons.join(', and ')}`;
    if (!granted) {
      const [w, ...more] = weakened;
      recordRequest(root, actor, TESTS_APPROVAL, w.file, `A weakened test: ${said(w)}.`);
      const leads = leadDecides(TESTS_APPROVAL, config, actor);
      const personOnly = { ...config, approvals: { ...config.approvals, delegate: null } };
      block(
        `Blocked: ${w.file} is a weakened test (${said(w)}); committing it needs ${leads ? "the lead's" : "a person's"} approval in force.
` +
          (more.length
            ? `Also weakened: ${more.map((x) => `${x.file} (${said(x)})`).join('; ')}.
`
            : '') +
          `A weakened test can hide a regression. Fix the code so the test passes as it was. ` +
          (leads
            ? `If the test itself is wrong, the lead decides after reviewing it: ${askHowTo(TESTS_APPROVAL, actor, root, config, { allows: 'weakening tests in one commit', need: 'the test, what you weakened and why the test was wrong, and the story' })}`
            : `If the test itself is wrong, ask the person: ${actor.kind === 'lead' ? "on your own branch nobody else reviews it, so you can't approve it." : "the lead can't approve it here."} They run
${approvalHowTo(TESTS_APPROVAL, actor, root, 'weakening tests in one commit', personOnly)}`),
      );
    }
    for (const w of weakened)
      record(w.file, {
        approval: TESTS_APPROVAL,
        reason: granted.reason,
        grantedAt: granted.grantedAt,
        weakened: w.reasons,
      });
    useApproval(root, TESTS_APPROVAL, actor);
  }
  if (stdWeak.length) useApproval(root, STANDARDS_APPROVAL, actor);
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
