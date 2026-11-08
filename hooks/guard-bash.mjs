#!/usr/bin/env node
// PreToolUse (Bash): blocks destructive and hook-skipping commands, work on protected branches, new
// dependencies a person hasn't approved, approval forgery, kit edits through the shell by anyone but
// the lead, the project's own blocked and lane-restricted commands; records protected files in the
// approval log on commit and scans commits for secrets. Shell writes are also checked afterwards by
// lane-audit.mjs. With `approvals.lead` on, the lead may act for the person on what they say in chat:
// record their approvals (`code-kit approve`) and run blocked commands marked `person`.
import { appendFileSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addedPackages,
  dependencyApproval,
  ecosystemOf,
  isDependencyFile,
} from './lib/dependencies.mjs';
import {
  CODE_KIT,
  GIT,
  codeOf,
  commandsOf,
  outputRedirects,
  readsOnly,
  sedInPlaceFiles,
  unreadNames,
  ruleMatches,
  runs,
  withoutHarmlessRedirects,
} from './lib/shell.mjs';
import { block, start } from './lib/hook.mjs';
import { CONFIG_FILE, committedConfig } from './lib/config.mjs';
import { laneOfBranch, storyOfBranch, teamOf, teamProvider, whoami } from './lib/team.mjs';
import { entryProblems, freshEntries, readRegister } from './lib/designs.mjs';
import { globToRegExp, matchesAny } from './lib/glob.mjs';
import { noteBefore } from './lane-audit.mjs';
import { historyWrites, storyMerges } from './lib/queue.mjs';
import { approverOf } from './lib/journal.mjs';
import { loginHere } from './lib/sessions.mjs';
import { TESTS_APPROVAL, commitWeakenings } from './lib/regression.mjs';
import { COST_APPROVAL, overBudget, overWords, registerFile } from './lib/costs.mjs';
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
  leadNeedsApproval,
  beforeSetup,
  approvalEnded,
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
    "The approval audit log is appended only by the commit hook; nobody edits it. A shell command may name it only to read it: git diff, log, show or blame, or cat, head, tail, grep, wc, jq, cut, sort, uniq, awk or sed -n printing lines, piped only into each other, with no redirect but 2>&1 or into /dev/null, no command's output in its arguments ($(…) or backticks) and no variable set before a command; other commands may come before or after it with ; or &&, if none defines a function or alias, exports a variable or sets one a command reads, such as PATH. Run the read in that form, or read the file with the Read tool, which can't write. To put it back as the last commit has it (after a `git revert --no-commit` or `git cherry-pick --no-commit` took entries out), run `git restore --staged --worktree .claude/approval-log.jsonl` in the same form, and commit in a command after it.",
    unreadNames(cmd, /approval-log\.jsonl/).join('\n'),
  ],
];
for (const [re, why, text] of ALWAYS) {
  if (re.test(text)) block(`Blocked: ${why}\nCommand: ${cmd}`);
}
const packages = addedPackages(cmd);
const approves = runs(cmd, new RegExp(String.raw`^${CODE_KIT}\s+approve\b`));
// Merging into a protected branch, and publishing what's merged to the remote's (MQ-6), are alike.
const delegatedMerge = runs(
  cmd,
  new RegExp(String.raw`^${CODE_KIT}\s+(?:(?:queue\s+)?merge|publish)\b`),
);
const queues = runs(cmd, new RegExp(String.raw`^${CODE_KIT}\s+queue\s+(?:add|drop)\b`));
const rulesOntoBase = runs(cmd, new RegExp(String.raw`^${CODE_KIT}\s+queue\s+rules\b`));
const asks = runs(cmd, new RegExp(String.raw`^${CODE_KIT}\s+ask\b\s+(?!--json\b)\S`));
const dropsRequests = runs(cmd, new RegExp(String.raw`^${CODE_KIT}\s+requests\s+drop\b`));
const commits = runs(cmd, new RegExp(String.raw`^${GIT}commit(?![\w-])`));
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
/** Whether `file` is committed at HEAD in the repository at `root`. */
function committedOnHead(root, file) {
  return (
    spawnSync('git', ['-C', root, 'cat-file', '-e', `HEAD:${file}`], { stdio: 'ignore' }).status ===
    0
  );
}

// Moving a protected branch directly (branch -f, update-ref) is a commit on it by another name.
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
if (movesProtected) {
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
  // heredoc, an argument or a quoted message that mentions it isn't refused. Otherwise it reads the whole
  // text, except a read's quoted arguments (lib/shell.mjs ruleMatches).
  const matched = ruleMatches({ pattern, command }, cmd);
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
// DUR-4: what an interrupted act came to is the lead's to record, which found out.
if (
  runs(cmd, new RegExp(String.raw`^${CODE_KIT}\s+reconcile\s+\S+.*\s--act\b`)) &&
  actor.kind !== 'lead'
)
  block(
    `Blocked: recording what an interrupted act came to is the lead's, which checks what happened. Tell the lead what you know, and carry on.\nCommand: ${cmd}`,
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
  if (!allowed && ruleMatches({ pattern }, cmd))
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
  runs(cmd, new RegExp(String.raw`^${GIT}commit(?![\w-])`)) &&
  !runs(cmd, new RegExp(String.raw`^${GIT}(merge|cherry-pick|rebase|revert|am)(?![\w-])`)) &&
  !committedOnHead(root, CONFIG_FILE);
// A merge in another checkout the command moves to lands on that checkout's branch; one in another
// repository, or on a detached HEAD (a throwaway merge to try the branches together), lands on none.
const branchAt = (dir) => {
  if (!existsSync(dir)) return undefined;
  const there = sessionRoot({ cwd: dir }, project);
  if (!there) return null;
  try {
    const b = currentBranch(there);
    return b === 'HEAD' ? null : b;
  } catch {
    return null;
  }
};
const at = { cwd: input.cwd || project, branchAt };
// Each commit or merge is judged on the branch it lands on, following the command's switches, `cd`s and
// `git -C`s in order: switching to a protected branch after committing elsewhere writes nothing to it.
const startsOn = branchAt(input.cwd || project) ?? (gitDir ? null : branch || null);
const onProtected = historyWrites(cmd, startsOn, at).find(
  (w) => config.branches.protected.includes(w.on) && !(settingUp && w.on === branch && !w.moved),
);
if (onProtected?.moved) {
  block(
    `Blocked: never commit to, merge into or move ${onProtected.on}, even by switching to it first. Work on a branch; a person merges after review${config.approvals.delegate?.merge ? ', or the lead merges a verified branch with `code-kit merge <branch> --delegated`' : ''}.\nCommand: ${cmd}`,
  );
}
if (onProtected) {
  block(
    `Blocked: never commit or merge on ${onProtected.on}. Work on a branch; the lead merges it after review (or the person, where merges aren't delegated).`,
  );
}
// MQ-5: a story's branch merges only into the base, through the merge queue. Merged with git into any
// other branch (an integration branch such as lead/next), it looks unmerged to the queue, the trail and
// worktree cleanup, and that branch becomes a second base. A lane merging another story into its own
// story's branch, or its base into it (MQ-3), is still its own work.
const elsewhere = storyMerges(cmd, startsOn, at).find(
  ({ into }) => !storyOfBranch(into) && !config.branches.protected.includes(into),
);
if (elsewhere) {
  const base = config.branches.protected[0];
  block(
    `Blocked: ${elsewhere.story} is a story's branch, and a story merges only into ${base}, through the merge queue: queue it once its review passes (\`code-kit queue add ${elsewhere.story}\`), then ${config.approvals.delegate?.merge ? `merge it with \`code-kit merge ${elsewhere.story} --delegated\`` : 'the person merges it from the code-kit pane'}. Merged into ${elsewhere.into}, it would look unmerged to the queue, the trail and worktree cleanup, and ${elsewhere.into} would become a second ${base}. ${config.branches.publish ? `The merge then reaches the remote's ${base} as "branches.publish" says (${config.branches.publish}).` : `Where the remote's ${base} only moves through pull requests, a person sets "branches.publish": "pull-request" and code-kit opens them.`}\nCommand: ${cmd}`,
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
  // Each git command of the chain, however it's run (`git -C <worktree> add`).
  const pieces = commandsOf(withoutHarmlessRedirects(cmd)).map((c) => c.text);
  const gitRun = (sub) =>
    pieces.map((p) => p.match(new RegExp(String.raw`^${GIT}${sub}`))).filter(Boolean);
  const commitAll = gitRun(String.raw`commit(?![\w-])(.*)`).some((m) =>
    /\s(-a|--all|-[b-zB-Z]*a[a-zA-Z]*)(\s|$)/.test(` ${m[1]}`),
  );
  const argsOf = (m) =>
    m[1]
      .trim()
      .split(/\s+/)
      .filter((a) => a && !a.startsWith('-'))
      .map((a) => a.replace(/^(['"])(.*)\1$/, '$2'));
  const addRuns = gitRun(String.raw`add\b(.*)`);
  // `-A` stages everything only without paths: `git add -A <paths>` stages those paths. A pathspec with
  // magic (`:/`, `:(top)…`) could name any file, so it counts as everything.
  const addAll = addRuns.some(
    (m) =>
      /\s\.(\s|$)/.test(` ${m[1]}`) ||
      argsOf(m).some((a) => a.startsWith(':')) ||
      (/\s(-A|--all)(\s|$)/.test(` ${m[1]}`) && argsOf(m).length === 0),
  );
  // `git rm` and `git mv` stage as they run: their files count though nothing has changed them yet, and
  // what they take away is gone from the commit though it's still on disk now.
  const rmArgs = gitRun(String.raw`rm\b(.*)`).flatMap(argsOf);
  const mvArgs = gitRun(String.raw`mv\b(.*)`).map(argsOf);
  const moved = [...rmArgs, ...mvArgs.flat()];
  const addArgs = [...addRuns.flatMap(argsOf), ...moved];
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
  const tracked = moved.length ? names(git('ls-files')) : [];
  const removed = tracked.filter((f) => moved.some((a) => matches(f, a)));
  const takenAway = [...rmArgs, ...mvArgs.flatMap((args) => args.slice(0, -1))];
  const gone = new Set(tracked.filter((f) => takenAway.some((a) => matches(f, a))));
  // `git reset --soft <ref> && git commit` commits everything since <ref>, staged by the reset (#76).
  const resetTo = gitRun(String.raw`reset\s+--soft\s+(\S+)`).map((m) => m[1]);
  const reset = resetTo.flatMap((ref) =>
    names(git('diff', '--name-only', '--no-renames', ref, 'HEAD')),
  );
  return { files: [...new Set([...staged, ...added, ...removed, ...reset])], gone, git };
}

/** The approval log's last entry for each file, as the checkout has the log. */
function lastEntries(root) {
  const last = new Map();
  let text = '';
  try {
    text = readFileSync(join(root, APPROVAL_LOG), 'utf8');
  } catch {
    return last;
  }
  for (const line of text.split('\n').filter(Boolean)) {
    try {
      const e = JSON.parse(line);
      if (e?.file) last.set(e.file, e);
    } catch {
      // an unreadable line records nothing; verify reports it
    }
  }
  return last;
}

// Every committed protected file is recorded in the audit log, with the person's reason when an
// approval is in force. So is a lane's manifest or lockfile change, outside its own paths, made under a
// dependency approval: that entry is how `code-kit verify` accepts it. The log is staged into the same
// commit, so record and change land together.
function recordApprovals() {
  const { files, gone, git } = committedFiles();
  const lines = [];
  // The person who gave an approval, by their GitHub login: the developer at this machine, where it was
  // given. Only when code-kit has the login cached; the lead's own approvals have no approver.
  const login = loginHere(root);
  const record = (file, fields) =>
    lines.push(
      JSON.stringify({
        at: new Date().toISOString(),
        ...fields,
        ...(login && approverOf(fields) === 'person' ? { approver: login } : {}),
        file,
        branch,
        actor: actor.label,
        session: input.session_id ?? null,
      }),
    );
  // STD-5: removing a standard, or weakening a required one, is the person's own call, never the lead's,
  // delegated or not (VIBE-2: under vibe, the lead's). The commit waits for their `standards` approval,
  // which records what it weakened.
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
    const vibe = config.approvals.delegate?.vibe === true;
    if (!granted || (!vibe && granted.reason.includes(delegatedMark('').slice(0, -1)))) {
      recordRequest(
        root,
        actor,
        STANDARDS_APPROVAL,
        stdFile,
        `Standards weakened: ${stdWeak.join('; ')}.`,
      );
      const personOnly = { ...config, approvals: { ...config.approvals, delegate: null } };
      if (vibe)
        block(
          `Blocked: this commit weakens the project's standards in ${stdFile}: ${stdWeak.join('; ')}. Under vibe the standards are yours to change, as the lead: weaken one only when what it costs the project outweighs what it guards, and record why. ${askHowTo(STANDARDS_APPROVAL, actor, root, config, { allows: 'weakening the standards in one commit', need: 'the standard, what it costs the story, and why weakening it is right' })}`,
        );
      block(
        `Blocked: this commit weakens the project's standards in ${stdFile}: ${stdWeak.join('; ')}. Removing a standard, or weakening a required one, is the person's call, never the lead's. Ask them, with what the standard costs the project and your recommendation; they approve it with\n${approvalHowTo(STANDARDS_APPROVAL, actor, root, 'weakening the standards in one commit', personOnly)}`,
      );
    }
  }
  // COST-5: a commit that takes an environment's estimated running cost past its budget, or further
  // past it, waits for the person's cost approval (never the lead's), which records what it allowed.
  const costRegister = config.cost ? registerFile(config) : null;
  const overCost =
    costRegister &&
    files.includes(costRegister) &&
    !arrivesWithMerge(root, costRegister, { staged: true })
      ? overBudget(
          git('show', `HEAD:${costRegister}`),
          existsSync(join(root, costRegister))
            ? readFileSync(join(root, costRegister), 'utf8')
            : '',
          config.cost,
        )
      : [];
  if (overCost.length) {
    const granted = approval(root, COST_APPROVAL, actor);
    if (!granted || granted.reason.includes(delegatedMark('').slice(0, -1))) {
      const over = overWords(overCost, config.cost.currency);
      recordRequest(root, actor, COST_APPROVAL, costRegister, `Over the running budget: ${over}.`);
      const personOnly = { ...config, approvals: { ...config.approvals, delegate: null } };
      block(
        `Blocked: this commit takes the estimated running cost past the budget the person set: ${over}. Going past the budget is the person's call, never the lead's. First find options that fit it: a smaller size, a cheaper tier or provider, one environment instead of two, a service the product can do without at launch, or less scope, each with what it gives up. ${askHowTo(COST_APPROVAL, actor, root, personOnly, { allows: 'one commit over the running budget', need: 'the change, what it costs a month against the budget, and the options that fit, each with what it gives up' })}`,
      );
    }
    record(costRegister, {
      approval: COST_APPROVAL,
      reason: granted.reason,
      grantedAt: granted.grantedAt,
      over: overCost,
    });
    useApproval(root, COST_APPROVAL, actor);
  }
  // The commit that switches code-kit on: the person approved the setup it holds as init showed it.
  const setup = settingUp && files.includes(CONFIG_FILE) && beforeSetup(root);
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
    const leadFree = actor.kind === 'lead' && !leadNeedsApproval(entry?.approval, config);
    if (entry && !granted && setup) {
      record(file, {
        approval: entry.approval,
        reason: 'The setup that switches code-kit on, as the person approved it in init.',
        setup: true,
      });
      continue;
    }
    if (entry && !granted && !leadFree && !byDependency) {
      recordRequest(root, actor, entry.approval, file, entry.why);
      block(
        `Blocked: ${file} is ${entry.why}; committing it needs ${decidedBy(entry.approval, config, actor) === 'lead' ? "the lead's" : "a person's"} approval in force.${approvalEnded(root, entry.approval, actor)}${noteFor(root, config, { kind: 'protected', name: entry.approval, glob: entry.glob })} ${askHowTo(entry.approval, actor, root, config)}`,
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
  // WHO-1: where the lead merges, its own change to what the person keeps needs the person's approval.
  // Given after the change was committed, it has nothing left to commit: so the lead's next commit, one
  // of its own if need be, records it for each such file as the branch holds it, by its content's hash,
  // and verify accepts that entry while the file is unchanged.
  if (actor.kind === 'lead') {
    const inThisCommit = new Set(files);
    for (const [file, last] of lastEntries(root)) {
      if (last.approval !== 'lead' || last.branch !== branch || inThisCommit.has(file)) continue;
      const entry = protectedEntry(file, config);
      if (!entry || !leadNeedsApproval(entry.approval, config)) continue;
      const granted = approval(root, entry.approval, actor);
      const blob = git('rev-parse', '--verify', '-q', `HEAD:${file}`).trim();
      if (granted && blob)
        record(file, {
          approval: entry.approval,
          reason: granted.reason,
          grantedAt: granted.grantedAt,
          blob,
        });
    }
  }
  // REG-2: a commit that weakens a test waits for a `tests` approval: WHO-2, the lead's on a lane's
  // branch where tests are delegated, otherwise the person's (always on the lead's own). It's recorded in
  // the log, so verify accepts the branch, and used up by this commit.
  const weakened = commitWeakenings(
    root,
    files.filter((f) => !arrivesWithMerge(root, f, { staged: true })),
    config,
    gone,
    config.branches.protected[0],
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
          `A weakened test can hide a regression.${approvalEnded(root, TESTS_APPROVAL, actor)} Fix the code so the test passes as it was. ` +
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

// The commit hook judges what the commit holds before the command runs, so a file a command earlier in
// the chain writes (a formatter, a script, a heredoc) can't be seen, and would go in unjudged and
// unlogged. Before the commit, a chain may only move into the checkout, make a branch where it stands
// (no start point, or one at the commit the checkout is at, so no file changes), stage or unstage, make folders, take away a worktree (keepsFiles)
// and run commands that only read (lib/shell.mjs readsOnly: git's status, diff, log and show among them,
// with no output file), or that write only outside the checkout (writesOutside). Errors sent into the
// output or /dev/null write no file.
const BEFORE_COMMIT = new RegExp(
  String.raw`^(?:cd\s|${GIT}(?:add|rm|mv|restore\s+--staged|reset\s+--soft)(?![\w-])|${GIT}(?:switch\s+(?:-q\s+|--quiet\s+)*(?:-q?c|--create)|checkout\s+(?:-q\s+|--quiet\s+)*-q?b)\s+[^\s-]\S*\s*$)`,
);
// Setting shell variables (`f=docs/x.md`, `export MSG="…"`) writes no file, unless a value runs a
// command. What a later `git add "$f"` stages can't be read, so it counts as every changed file.
const ASSIGNS_ONLY = /^(?:export\s+)?[A-Za-z_]\w*=\S*(?:\s+[A-Za-z_]\w*=\S*)*$/;
// Nor does setting the shell's own options (`set -euo pipefail`, `set +x`), or unsetting variables.
const SHELL_OPTIONS = /^set(?:\s+[-+][a-zA-Z]+(?:\s+[a-z]+)?)+\s*$/;
const UNSETS = /^unset(?:\s+-[vn])?(?:\s+[A-Za-z_]\w*)+\s*$/;
const assignsOnly = (c) =>
  (ASSIGNS_ONLY.test(c.code) || SHELL_OPTIONS.test(c.code) || UNSETS.test(c.code)) &&
  !/`|\$\(|<\(|[<>]/.test(c.text);
// A tool's command that writes only the tool's own records (an adapter's `shell.records`), which any
// actor may write and no check covers, with no redirect of its own.
const recordsOnly = (c) =>
  !/[<>]/.test(c.code) && (config.shell.records ?? []).some((re) => new RegExp(re).test(c.text));
// What changes no file a commit could take: making folders (git keeps no empty folder), taking away a
// worktree, which is a checkout of its own, unstaging (`git reset [HEAD] [--] [<paths>]`, which
// leaves the files as they are) and making a branch at the commit the checkout is at. A reset to another commit with no paths moves HEAD, so it counts.
const KEEPS_FILES = new RegExp(String.raw`^(?:mkdir\s|${GIT}worktree\s+(?:remove|prune)(?![\w-]))`);
// A branch made at a start point that is the commit the checkout is at already: no file changes.
const BRANCHES_AT =
  /^git\s+(?:switch\s+(?:-q\s+|--quiet\s+)*(?:-q?c|--create)|checkout\s+(?:-q\s+|--quiet\s+)*-q?b)\s+[^\s-]\S*\s+([^\s-$`]\S*)\s*$/;
const commitOf = (ref) =>
  spawnSync('git', ['-C', root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
    encoding: 'utf8',
  }).stdout.trim();
const RESETS = new RegExp(String.raw`^${GIT}reset((?:\s+\S+)*)\s*$`);
const isCommit = (w) =>
  spawnSync('git', ['-C', root, 'rev-parse', '--verify', '--quiet', `${w}^{commit}`]).status === 0;
function keepsFiles(c) {
  if (/[<>]/.test(c.code)) return false;
  if (KEEPS_FILES.test(c.text)) return true;
  const start = c.text.match(BRANCHES_AT)?.[1];
  if (start && !/[$`]/.test(start))
    return commitOf(start) !== '' && commitOf(start) === commitOf('HEAD');
  const reset = c.text.match(RESETS);
  if (!reset) return false;
  const words = reset[1].trim().split(/\s+/).filter(Boolean);
  const paths = words.indexOf('--');
  const before = paths >= 0 ? words.slice(0, paths) : words;
  const flags = before.filter((w) => w.startsWith('-'));
  if (flags.some((f) => f !== '-q' && f !== '--quiet')) return false;
  const named = before.filter((w) => !w.startsWith('-'));
  return !(paths < 0 && named.length === 1 && named[0] !== 'HEAD' && isCommit(named[0]));
}
// A path the commit can't take: written out in full, outside this project and the checkout the commit
// is in (a session's scratchpad, the system's temporary folder). The real path of what's there counts,
// so a link back into the project doesn't pass.
function realOf(p) {
  let at = resolve(p);
  const tail = [];
  while (!existsSync(at) && dirname(at) !== at) {
    tail.unshift(basename(at));
    at = dirname(at);
  }
  return join(realpathSync(at), ...tail);
}
const STATE_DIR = '.claude/state';
const within = (p, dir) => p === dir || p.startsWith(dir.endsWith(sep) ? dir : dir + sep);
function outsideCheckout(p) {
  if (!p.startsWith('/') || /[$`*?{}[\]~]/.test(p)) return false;
  const real = realOf(p);
  return ![project, root].some((r) => within(real, realOf(r)));
}
// A path in code-kit's own state folder (a lane's report), which the project's .gitignore keeps out of
// any commit. A relative path is read from where the command runs, so one that moves elsewhere on the
// way, or commits in another repository, doesn't pass.
function inOwnState(p) {
  if (/[$`*?{}[\]~]/.test(p)) return false;
  if (!p.startsWith('/')) {
    const moves = commandsOf(cmd).filter((c) => /^(?:cd|pushd|popd)\b/.test(c.text));
    if (/\bgit\s+-C\b/.test(cmd) || moves.length > (/^\s*cd\s/.test(cmd) ? 1 : 0)) return false;
  }
  const real = realOf(resolve(input.cwd || project, gitDir ?? '.', p));
  if (within(real, join(realOf(project), STATE_DIR)) && realOf(project) !== realOf(root))
    return true;
  if (!within(real, join(realOf(root), STATE_DIR))) return false;
  return spawnSync('git', ['-C', root, 'check-ignore', '-q', real]).status === 0;
}
// What writes only where no commit can take it (a message drafted in a scratchpad for `git commit -F`,
// a lane's report): a read whose output goes only to such paths, or sed's substitutions in place on
// files outside the checkout.
function writesOutside(c) {
  const out = outputRedirects(c.whole);
  if (!out?.targets.every((t) => outsideCheckout(t) || inOwnState(t))) return false;
  if (out.targets.length && readsOnly(out.rest)) return true;
  return sedInPlaceFiles(out.rest.trim())?.every(outsideCheckout) ?? false;
}
// code-kit's own commands that write only its state folder (a question, a hold, a send-back, the merge
// queue's entries), or only read: run by this code-kit's own CLI, by its path or through a variable the
// line sets to it, with no redirect of their own, where the project ignores the state folder.
const KIT_CLI = realOf(join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'code-kit.mjs'));
const KIT_RECORDS =
  /^(?:ask|defer|sent-back|reconcile|requests\s+drop|queue(?:\s+(?:add|drop|pause|resume))?|next|status|who|trace)(?:\s|$)/;
function kitRecordsOnly(c) {
  if (/[<>]/.test(c.code) || /(?:^|\s)--write(?:\s|$)/.test(c.code)) return false;
  const run = c.text.match(/^node\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s+(.*)$/s);
  if (!run || !KIT_RECORDS.test(run[4])) return false;
  let path = run[1] ?? run[2] ?? run[3];
  const variable = path.match(/^\$\{?([A-Za-z_]\w*)\}?$/)?.[1];
  if (variable) {
    const set = [
      ...cmd.matchAll(
        new RegExp(
          String.raw`(?:^|[;&|\n]\s*)(?:export\s+)?${variable}=(?:"([^"$\`]+)"|'([^']+)'|([^\s"'$\`;&|]+))`,
          'g',
        ),
      ),
    ];
    if (set.length !== 1) return false;
    path = set[0][1] ?? set[0][2] ?? set[0][3];
  }
  if (/[$\`]/.test(path) || realOf(resolve(input.cwd || project, path)) !== KIT_CLI) return false;
  return spawnSync('git', ['-C', root, 'check-ignore', '-q', join(root, STATE_DIR)]).status === 0;
}
function writesBeforeCommit() {
  const pieces = commandsOf(withoutHarmlessRedirects(cmd));
  const at = pieces.findIndex((c) => new RegExp(String.raw`^${GIT}commit(?![\w-])`).test(c.text));
  return pieces
    .slice(0, Math.max(at, 0))
    .find(
      (c) =>
        (!BEFORE_COMMIT.test(c.text) || /[<>]/.test(c.code)) &&
        !readsOnly(c.whole) &&
        !assignsOnly(c) &&
        !recordsOnly(c) &&
        !kitRecordsOnly(c) &&
        !keepsFiles(c) &&
        !writesOutside(c),
    );
}

if (commits) {
  const writer = writesBeforeCommit();
  if (writer)
    block(
      `Blocked: this commit runs after \`${writer.text.slice(0, 80)}\` in the same command, which may write files code-kit can't see before the commit, so they would go in without their checks or their entry in the approval log. Run that first, on its own; then commit in a command of its own (\`git add … && git commit …\` is fine).\nCommand: ${cmd}`,
    );
  // HAND-2: a register entry this commit adds or changes names the approved design's files, as approved.
  // HAND-11: one the branch already has, the base has, or a merge being concluded brings in isn't this
  // commit's: a lane merging the base into its branch isn't held to the base's entries.
  const register = config.designGate?.register;
  if (register && committedFiles().files.includes(register)) {
    const at = (ref) => {
      const shown = spawnSync('git', ['-C', root, 'show', `${ref}:${register}`], {
        encoding: 'utf8',
      });
      return shown.status === 0 ? readRegister(root, config, shown.stdout).entries : [];
    };
    const problems = freshEntries(
      readRegister(root, config).entries,
      at('HEAD'),
      at(config.branches.protected[0]),
      at('MERGE_HEAD'),
    ).flatMap((e) => entryProblems(root, e, config.docs?.specs));
    if (problems.length)
      block(
        `Blocked: ${register} names approved designs a lane can't build from as approved:\n  ${problems.join('\n  ')}\nEach screen's design is files in the repository, every state, with its hash (docs/specs/24-designs-handed-over.md).\nCommand: ${cmd}`,
      );
  }
  // Every refusal comes before approvals are spent and logged, so a refused commit spends none.
  const scan = spawnSync('gitleaks', ['protect', '--staged', '--redact', '--no-banner'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (scan.error?.code !== 'ENOENT' && scan.status === 1) {
    block(
      `Blocked: gitleaks found possible secrets in staged changes.\n${scan.stdout}${scan.stderr}`,
    );
  }
  recordApprovals();
}
process.exit(0);
