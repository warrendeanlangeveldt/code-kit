#!/usr/bin/env node
// PreToolUse (Edit|MultiEdit|Write|NotebookEdit): who may write where, secret files, approvals,
// spec-check before lane work, and approved designs before screens. The rules live in lib/rules.mjs.
import { CONFIG_FILE } from './lib/config.mjs';
import { block, start } from './lib/hook.mjs';
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
process.exit(0);
