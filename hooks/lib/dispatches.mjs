// Each lane agent's model (docs/specs/23-the-team.md, SCHED-3): with `harness.agents.lanes.model` set to
// `story`, a story runs on the model its size in the plan asks for, raised for a security requirement, a
// fix or a send-back. And the dispatch log: what each lane agent was started on, so the journal can say
// whether the smaller models are sent back more often than they save. Kept in the main checkout, beside
// the reviews, so every session and worktree on the machine writes the same one.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { markdownFiles, storyBranch } from './plan.mjs';
import { sendBacks } from './reviews.mjs';
import { projectWorktrees } from './rules.mjs';
import { agentFileModel, storyModel } from './schedule.mjs';
import { securityRequirementIds } from './security.mjs';

export const DISPATCHES_FILE = '.claude/state/dispatches.jsonl';
const dispatchesFile = (root) => join(projectWorktrees(root)[0] ?? root, DISPATCHES_FILE);

const readText = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

/**
 * SCHED-3: each story's model, { [id]: { model, why } }, for the stories given (each with id, lane,
 * requirements, fixes and size, as the plan reads them). Empty unless the lane model is `story`; a story
 * with no lane agent (the lead's, a design) has none.
 */
export function storyModels(root, config, stories) {
  if (config.harness?.agents?.lanes?.model !== 'story') return {};
  const specs = config.docs?.specs;
  const security = securityRequirementIds(
    specs ? markdownFiles(root, specs).map((f) => readText(join(root, f)) ?? '') : [],
  );
  const backs = sendBacks(root);
  const found = {};
  for (const s of stories) {
    const agent = config.lanes[s.lane]?.agent;
    if (!agent) continue;
    const branch = storyBranch(s);
    found[s.id] = storyModel({
      size: s.size,
      security: s.requirements.some((r) => security.has(r)),
      fix: Boolean(s.fixes),
      sentBack: backs.filter((b) => b.branch === branch).length,
      fileModel: agentFileModel(readText(join(root, '.claude/agents', `${agent}.md`))),
    });
  }
  return found;
}

/** SCHED-3: records that a lane agent started for `story`, on `model` (null: the session's), and why. */
export function recordDispatch(root, { story, lane, branch, model, why }, now = Date.now()) {
  const file = dispatchesFile(root);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(
    file,
    `${JSON.stringify({ at: new Date(now).toISOString(), story, lane, branch, model: model ?? null, why: why ?? null })}\n`,
  );
}

/** Every lane agent started, oldest first: [{ at, story, lane, branch, model, why }]. */
export function dispatches(root) {
  return (readText(dispatchesFile(root)) ?? '')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const d = JSON.parse(line);
        return d.story ? [d] : [];
      } catch {
        return [];
      }
    });
}
