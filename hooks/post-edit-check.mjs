#!/usr/bin/env node
// PostToolUse (Edit|MultiEdit|Write): the layer rules for the edited file, then the project's own
// per-file checks (lint, format); failures are fed back to Claude.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { matchesAny } from './lib/glob.mjs';
import { loadBaseline, newProblems } from './lib/baseline.mjs';
import { block, start } from './lib/hook.mjs';
import { brokenLayerRule, layerProblems } from './lib/layers.mjs';
import { noteFor } from './lib/standards.mjs';
import { projectWorktrees, relativeTo, worktreeRoot } from './lib/rules.mjs';
import { noteWrite } from './lib/sessions.mjs';

const { input, project, config, error } = start();
const target = input.tool_input?.file_path;
if (error || !target) process.exit(0);

const found = worktreeRoot(target);
const root = found && projectWorktrees(project).includes(found) ? found : null;
if (!root) process.exit(0); // another repository, or Claude's memory: not this project's code
const rel = relativeTo(root, target);
if (!existsSync(join(root, rel))) process.exit(0);
// SESS-5: in the checkout every session shares, which session wrote the file, for a blocked git to name.
if (root === projectWorktrees(project)[0]) noteWrite(project, input.session_id, rel);

// Violations recorded in the baseline (brownfield code as it was adopted) don't block; new ones do.
const layers = layerProblems(rel, readFileSync(join(root, rel), 'utf8'), config);
const problems = newProblems(rel, layers, loadBaseline(project));
// STD-4: a layer rule a project standard names says which standard it is.
const note = problems.length ? noteFor(root, config, problems.map(brokenLayerRule)) : '';
if (note) problems.push(note.trim());
const quoted = `'${rel.replace(/'/g, `'\\''`)}'`;
for (const check of config.postEdit) {
  if (!matchesAny(rel, check.files) || matchesAny(rel, check.exclude)) continue;
  const res = spawnSync(check.run.replaceAll('{file}', quoted), {
    cwd: root,
    shell: true,
    encoding: 'utf8',
    timeout: 80_000,
  });
  if (res.status === 127) continue; // the tool isn't installed yet (fresh clone)
  if (res.status !== 0)
    problems.push(`${check.run.replaceAll('{file}', rel)}:\n${res.stdout}${res.stderr}`.trim());
}
if (problems.length) block(`Fix these before continuing:\n\n${problems.join('\n\n')}`);
process.exit(0);
