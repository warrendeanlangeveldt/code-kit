// The lead's send-backs: which commit of a branch a review sent back. Until the branch moves past it,
// status reads the story as waiting for its lane's fix, not as finished again (and next proposes the
// fix, not a second review of the same commits). Kept beside the requests, in the main checkout.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { projectWorktrees } from './rules.mjs';

export const REVIEWS_FILE = '.claude/state/reviews.jsonl';
const reviewsFile = (root) => join(projectWorktrees(root)[0] ?? root, REVIEWS_FILE);

/** Records that the review of `branch` at commit `sha` sent it back, and why. */
export function recordSentBack(root, branch, sha, reason, now = Date.now()) {
  const file = reviewsFile(root);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(
    file,
    `${JSON.stringify({ at: new Date(now).toISOString(), branch, sha, verdict: 'sent back', reason: reason ?? null })}\n`,
  );
}

/** The latest send-back of each branch: { branch: { at, sha, reason } }. */
export function sentBack(root) {
  const found = {};
  let lines = [];
  try {
    lines = readFileSync(reviewsFile(root), 'utf8').split('\n').filter(Boolean);
  } catch {
    return found;
  }
  for (const line of lines) {
    try {
      const r = JSON.parse(line);
      if (r.verdict === 'sent back' && r.branch && r.sha) found[r.branch] = r;
    } catch {
      // a line being written, or not one of ours
    }
  }
  return found;
}
