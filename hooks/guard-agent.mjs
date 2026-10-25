#!/usr/bin/env node
// PreToolUse on Agent (docs/specs/23-the-team.md, SCHED-1): a lane runs one story at a time, across every
// session in the project. Starting a lane's agent claims the lane; a second agent for a claimed lane is
// refused, naming the story and the session that has it. Any other agent starts as before. A lane agent
// that starts is logged with the model it runs on, and why (SCHED-3).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { recordDispatch, storyModels } from './lib/dispatches.mjs';
import { block, start } from './lib/hook.mjs';
import { CLI } from './lib/rules.mjs';
import { claimLane, shortSession } from './lib/laneclaims.mjs';
import { readStories, storyBranch } from './lib/plan.mjs';
import { agentFileModel } from './lib/schedule.mjs';
import { memberOf, readSession } from './lib/sessions.mjs';

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
  // SESS-1: the session by its member and, where it has one, its task.
  const holder = readSession(project, c.session);
  const where =
    c.session && c.session === session
      ? 'in this session'
      : c.session
        ? `in another session (${holder ? memberOf(holder) : shortSession(c.session)}${holder?.task ? `, working on "${holder.task.title}"` : ''})`
        : 'here';
  block(
    `Blocked: the ${lane} lane is already running ${c.story ?? 'a story'} ${where}, since ${c.since.slice(11, 16)} UTC. A lane runs one story at a time across the project: two agents in one lane build on the same files in their worktrees and conflict at merge.\n` +
      `Start ${story ?? 'this story'} when ${c.story ?? 'that story'} is finished, or dispatch a ready story in another lane meanwhile. If that agent has stopped and the lane is free, release it first:\n  node "${CLI}" lanes release ${lane}`,
  );
}

// SCHED-3: what it runs on. The lead's call wins, then the lane's agent file, then the setting: `story` is
// the model the story's size gives, which the mod sets where the call names none (SET-4).
try {
  const setting = config.harness.agents.lanes.model;
  const planned =
    story && config.docs?.plan
      ? (storyModels(
          project,
          config,
          readStories(project, config.docs.plan).filter((s) => s.id === story),
        )[story] ?? null)
      : null;
  let own = null;
  try {
    own = agentFileModel(
      readFileSync(join(project, '.claude/agents', `${call.subagent_type}.md`), 'utf8'),
    );
  } catch {
    // no agent file in the project: a plugin's agent
  }
  const ran = call.model
    ? { model: call.model, why: planned?.model === call.model ? planned.why : 'the lead chose it' }
    : own && own !== 'inherit'
      ? { model: own, why: `its lane's agent file names ${own}` }
      : setting === 'story'
        ? (planned ?? { model: null, why: "the session's model" })
        : setting
          ? { model: setting, why: 'the lane model set' }
          : { model: null, why: "the session's model" };
  if (story)
    recordDispatch(project, { story, lane, branch: storyBranch({ lane, id: story }), ...ran });
} catch {
  // a read-only checkout: the dispatch goes unlogged, and the agent still starts
}
