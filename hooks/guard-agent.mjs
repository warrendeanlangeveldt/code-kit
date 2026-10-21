#!/usr/bin/env node
// PreToolUse on Agent (docs/specs/23-the-team.md, SCHED-1): a lane runs one story at a time, across every
// session in the project. Starting a lane's agent claims the lane; a second agent for a claimed lane is
// refused, naming the story and the session that has it. Any other agent starts as before.
import { block, start } from './lib/hook.mjs';
import { CLI } from './lib/rules.mjs';
import { claimLane, shortSession } from './lib/laneclaims.mjs';

const { input, project, config, error } = start();
// A broken config is reported by the other hooks; it doesn't stop agents starting.
if (error) process.exit(0);
const call = input.tool_input ?? {};
const lane = Object.entries(config.lanes).find(([, l]) => l.agent === call.subagent_type)?.[0];
if (!lane) process.exit(0);
const story =
  String(call.description ?? '')
    .match(/\bST-\d+\b/i)?.[0]
    ?.toUpperCase() ?? null;
const session = input.session_id ?? null;
const claimed = claimLane(project, { lane, story, session });
if (!claimed.ok) {
  const c = claimed.claim;
  const where =
    c.session && c.session === session
      ? 'in this session'
      : c.session
        ? `in another session (${shortSession(c.session)})`
        : 'here';
  block(
    `Blocked: the ${lane} lane is already running ${c.story ?? 'a story'} ${where}, since ${c.since.slice(11, 16)} UTC. A lane runs one story at a time across the project: two agents in one lane build on the same files in their worktrees and conflict at merge.\n` +
      `Start ${story ?? 'this story'} when ${c.story ?? 'that story'} is finished, or dispatch a ready story in another lane meanwhile. If that agent has stopped and the lane is free, release it first:\n  node "${CLI}" lanes release ${lane}`,
  );
}
