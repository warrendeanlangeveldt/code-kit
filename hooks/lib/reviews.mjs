// The lead's send-backs: which commit of a branch a review sent back. Until the branch moves past it,
// status reads the story as waiting for its lane's fix, not as finished again (and next proposes the
// fix, not a second review of the same commits). And the screenshots a review compared with each
// screen's approved design (HAND-7). Kept beside the requests, in the main checkout.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
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

/** Every send-back recorded, oldest first: [{ at, branch, sha, reason }]. */
export function sendBacks(root) {
  let lines = [];
  try {
    lines = readFileSync(reviewsFile(root), 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
  return lines.flatMap((line) => {
    try {
      const r = JSON.parse(line);
      return r.verdict === 'sent back' && r.branch ? [r] : [];
    } catch {
      return [];
    }
  });
}

/** HAND-7: where the review keeps the screenshots it compared, in the main checkout. */
export const EVIDENCE_DIR = '.claude/state/reviews';
export const evidenceDir = (root) => join(projectWorktrees(root)[0] ?? root, EVIDENCE_DIR);

/**
 * HAND-7: records that the review of `branch` at commit `sha` took a screenshot of a screen's approved
 * state and set it beside the design: `{ story, file, screen, state, image, sha256, viewport, size }`.
 */
export function recordEvidence(root, record, now = Date.now()) {
  const file = reviewsFile(root);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(
    file,
    `${JSON.stringify({ at: new Date(now).toISOString(), verdict: 'evidence', ...record })}\n`,
  );
}

/**
 * HAND-7: the screenshots the reviews recorded for `branch`, oldest first; null where the project's
 * state isn't kept (CI, a fresh clone), so nothing can be said about them.
 */
export function evidenceRecords(root, branch) {
  const file = reviewsFile(root);
  if (!existsSync(dirname(file))) return null;
  let lines = [];
  try {
    lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
  return lines.flatMap((line) => {
    try {
      const r = JSON.parse(line);
      return r.verdict === 'evidence' && r.branch === branch ? [r] : [];
    } catch {
      return [];
    }
  });
}
