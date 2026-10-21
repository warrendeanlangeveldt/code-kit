#!/usr/bin/env node
// PreToolUse (Edit|MultiEdit|Write|NotebookEdit): who may write where, secret files, approvals,
// spec-check before lane work, approved designs before screens (lib/rules.mjs), and the layer rules for
// the file as it would be after the edit, so a layer is never broken on disk even for a moment.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadBaseline, newProblems } from './lib/baseline.mjs';
import { CONFIG_FILE } from './lib/config.mjs';
import { brokenLayerRule, layerProblems } from './lib/layers.mjs';
import { noteFor } from './lib/standards.mjs';
import { block, start } from './lib/hook.mjs';
import { teamOf, teamProvider, teamRefusal, whoami } from './lib/team.mjs';
import { sessionWriteProblem } from './lib/sessions.mjs';
import { spawnSync } from 'node:child_process';
import {
  actorFor,
  projectWorktrees,
  relativeTo,
  worktreeRoot,
  writeProblem,
} from './lib/rules.mjs';

const { input, project, config, error } = start();
const target = input.tool_input?.file_path || input.tool_input?.notebook_path;
if (!target) process.exit(0);

const found = worktreeRoot(target);
const root = found && projectWorktrees(project).includes(found) ? found : project;
const rel = relativeTo(root, target);

if (error) {
  // The rules can't be read, so nothing is allowed except the lead repairing them.
  if (rel === CONFIG_FILE && !input.agent_type) process.exit(0);
  block(
    `Blocked: ${error}\nThe lead fixes ${CONFIG_FILE} first; nothing else can be written until it is valid.`,
  );
}

const problem = writeProblem(actorFor(input, root, config), rel, root, config);
if (problem) block(`Blocked: ${problem}`);

// SESS-4, SESS-5: another session's task leases the path, or a working session writes where it shouldn't.
const shared = sessionWriteProblem({
  project,
  root,
  rel,
  actor: actorFor(input, root, config),
  session: input.session_id ?? null,
});
if (shared) block(`Blocked: ${shared}`);

// TEAM-1, TEAM-4: in a team, the tech lead's paths, other people's lanes, claims and leases.
const team = teamOf(config);
if (team) {
  const branch = spawnSync('git', ['-C', root, 'symbolic-ref', '--short', '-q', 'HEAD'], {
    encoding: 'utf8',
  }).stdout?.trim();
  const refusal = teamRefusal({
    actor: actorFor(input, root, config),
    rel,
    branch,
    config,
    me: whoami(project),
    state: teamProvider(project, team).state(),
  });
  if (refusal) block(`Blocked: ${refusal}`);
}

/** The file's text after this call, when the call carries enough to know it. */
function textAfter(before) {
  const ti = input.tool_input ?? {};
  const apply = (text, edits) =>
    edits.reduce((t, e) => {
      if (!e.old_string) return t;
      return e.replace_all
        ? t.split(e.old_string).join(e.new_string ?? '')
        : t.replace(e.old_string, () => e.new_string ?? '');
    }, text);
  if (input.tool_name === 'Write') return typeof ti.content === 'string' ? ti.content : null;
  if (before === null) return null;
  if (input.tool_name === 'Edit') return apply(before, [ti]);
  if (input.tool_name === 'MultiEdit') return apply(before, ti.edits ?? []);
  return null;
}

// Only what this edit introduces is refused: a file that already breaks a rule (the baseline, or older
// code) can still be edited, as long as the edit adds no new violation.
const file = join(root, rel);
const before = existsSync(file) ? readFileSync(file, 'utf8') : null;
const after = textAfter(before);
if (after !== null) {
  const existing = new Set(before === null ? [] : layerProblems(rel, before, config));
  const added = newProblems(rel, layerProblems(rel, after, config), loadBaseline(project)).filter(
    (p) => !existing.has(p),
  );
  if (added.length)
    block(
      `Blocked: this edit would break the layer rules (.claude/code-kit.json › layers):\n  ${added.join('\n  ')}\nDepend only on the layers listed, or ask the lead to change the rule.${noteFor(root, config, added.map(brokenLayerRule))}`,
    );
}
process.exit(0);
