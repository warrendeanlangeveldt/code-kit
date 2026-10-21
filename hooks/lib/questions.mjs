// Questions for the person (docs/specs/15-decisions-and-journal.md, ASK-1 to ASK-4): what the lead can't
// settle itself (a product choice, an account only the person can create, wording only they can sign off),
// asked through code-kit so it waits in the Decisions tab instead of scrolling away in the chat. A question
// may hold its story ("waiting on you") until it's answered. Kept in the main checkout, so every lane's
// worktree sees the same questions.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { projectWorktrees } from './rules.mjs';

export const QUESTIONS_FILE = '.claude/state/questions.jsonl';

const fileOf = (root) => join(projectWorktrees(root)[0] ?? root, QUESTIONS_FILE);

function records(root) {
  try {
    return readFileSync(fileOf(root), 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function append(root, record) {
  const file = fileOf(root);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`);
}

/**
 * Every question, oldest first: { id, at, by, session, count, question, why, story, blocks, options: [{ label, effect }],
 * state: 'open' | 'answered' | 'withdrawn', answer: { text, at, by, via } | null, withdrawn: { at, reason } | null }.
 */
export function readQuestions(root) {
  const byId = new Map();
  for (const r of records(root)) {
    if (r.kind === 'ask')
      byId.set(r.id, {
        ...r,
        kind: undefined,
        session: r.session ?? null,
        count: 1,
        state: 'open',
        answer: null,
        withdrawn: null,
      });
    const q = byId.get(r.id);
    if (!q || q.state !== 'open') continue;
    if (r.kind === 'again') q.count += 1;
    if (r.kind === 'answer') {
      q.state = 'answered';
      q.answer = { text: r.answer, at: r.at, by: r.by, via: r.via };
    }
    if (r.kind === 'withdraw') {
      q.state = 'withdrawn';
      q.withdrawn = { at: r.at, reason: r.reason ?? null };
    }
  }
  return [...byId.values()].map(({ kind, ...q }) => q);
}

export const openQuestions = (root) => readQuestions(root).filter((q) => q.state === 'open');

/** "Label: what it does" as an option; a label alone has no effect said. */
export function parseOption(text) {
  const at = String(text).indexOf(':');
  return at > 0
    ? { label: text.slice(0, at).trim(), effect: text.slice(at + 1).trim() || null }
    : { label: String(text).trim(), effect: null };
}

/**
 * ASK-1: records a question for the person; the same question still open is asked once, and returned.
 * `blocks` holds its story until it's answered (ASK-3).
 */
export function askQuestion(
  root,
  { by, question, why = null, story = null, blocks = false, options = [], session = null },
  now = Date.now(),
) {
  const text = String(question).trim();
  // OWN-3: the same question still open in the same session is one decision, asked again.
  const open = openQuestions(root).find(
    (q) =>
      q.question === text &&
      (q.story ?? null) === (story ?? null) &&
      (q.session ?? null) === (session ?? null),
  );
  if (open) {
    append(root, { kind: 'again', id: open.id, at: new Date(now).toISOString() });
    return { question: readQuestions(root).find((q) => q.id === open.id), existed: true };
  }
  const n = readQuestions(root).length + 1;
  const record = {
    kind: 'ask',
    id: `Q-${n}`,
    at: new Date(now).toISOString(),
    by,
    // OWN-1: the session that asked it: it's asked, answered and heard there only.
    session: session ?? null,
    question: text,
    why: why?.trim() || null,
    story: story ?? null,
    blocks: Boolean(blocks && story),
    options: options
      .map((o) => (typeof o === 'string' ? parseOption(o) : o))
      .filter((o) => o.label),
  };
  append(root, record);
  return { question: readQuestions(root).find((q) => q.id === record.id), existed: false };
}

/** ASK-2: the person's answer, given in the pane (`via: 'pane'`) or in chat and recorded by the lead (`via: 'chat'`). */
export function answerQuestion(root, id, { answer, by, via }, now = Date.now()) {
  const q = readQuestions(root).find((x) => x.id === id);
  if (!q) return { ok: false, why: `There's no question ${id}. code-kit ask lists the open ones.` };
  if (q.state !== 'open') return { ok: false, why: `${id} isn't open: it was ${q.state} already.` };
  if (!String(answer ?? '').trim())
    return { ok: false, why: 'Give the answer: the lead builds on it.' };
  append(root, {
    kind: 'answer',
    id,
    at: new Date(now).toISOString(),
    answer: String(answer).trim(),
    by,
    via,
  });
  return { ok: true, question: readQuestions(root).find((x) => x.id === id) };
}

/** The lead takes a question back once it no longer needs the person (it was settled another way). */
export function withdrawQuestion(root, id, reason, now = Date.now()) {
  const q = readQuestions(root).find((x) => x.id === id);
  if (!q) return { ok: false, why: `There's no question ${id}.` };
  if (q.state !== 'open') return { ok: false, why: `${id} isn't open: it was ${q.state} already.` };
  append(root, {
    kind: 'withdraw',
    id,
    at: new Date(now).toISOString(),
    reason: reason?.trim() || null,
  });
  return { ok: true };
}

/** ASK-3: the stories an open question holds: Map(story id → the question). */
export function waitingStories(root) {
  const out = new Map();
  for (const q of openQuestions(root))
    if (q.blocks && q.story && !out.has(q.story)) out.set(q.story, q);
  return out;
}
