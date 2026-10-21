// Decisions owned by the session that raised them (docs/specs/23-the-team.md, OWN-1 to OWN-4). What the
// person settles comes from two logs code-kit already keeps, each record now carrying its session: the
// lead's questions (lib/questions.mjs) and the approvals a refusal asked for (lib/rules.mjs). This reads
// both as one list, each decision with its member, subject and context, so a session sees, asks and
// answers only its own, and the others only a count. A decision from before sessions were recorded
// belongs to no session and shows in any.
import { openQuestions } from './questions.mjs';
import { openRequests } from './rules.mjs';
import { memberOf, readSession, sessions, shortSession } from './sessions.mjs';

/** The stories that are done: a decision about one of them has lost its cause (OWN-4). */
const doneIn = (stories) =>
  new Set((stories ?? []).filter((s) => s.state === 'done').map((s) => s.id));

/**
 * Every open decision, oldest first: [{ id, kind, session, member, subject, what, context, options,
 * blocks, count, opened, source }]. `kind` is `answer` (a question for the person) or `approve`.
 */
export function openDecisions(root, { stories = [] } = {}, now = Date.now()) {
  const done = doneIn(stories);
  const byId = new Map(sessions(root, now).map((s) => [s.id, s]));
  const member = (session) =>
    session ? (memberOf(byId.get(session)) ?? shortSession(session)) : null;
  const questions = openQuestions(root)
    .filter((q) => !(q.story && done.has(q.story)))
    .map((q) => ({
      id: q.id,
      kind: 'answer',
      session: q.session ?? null,
      member: member(q.session),
      subject: q.story ?? null,
      what: q.question,
      context: q.why ?? null,
      options: q.options ?? [],
      blocks: Boolean(q.blocks),
      count: q.count ?? 1,
      opened: q.at,
      source: q,
    }));
  const requests = openRequests(root, now).map((r) => ({
    id: `R:${r.at}`,
    kind: 'approve',
    session: r.session ?? null,
    member: member(r.session),
    subject: r.lane ?? null,
    what: r.what,
    context: r.why ?? null,
    options: [],
    blocks: true,
    count: 1,
    opened: r.at,
    source: r,
  }));
  return [...questions, ...requests].sort((a, b) => Date.parse(a.opened) - Date.parse(b.opened));
}

/** The sessions whose decisions `session` answers for: its own, and those whose task it took over. */
function ownedBy(root, session) {
  const me = readSession(root, session);
  return new Set([session, ...(me?.took ?? [])]);
}

/**
 * OWN-1: the decisions `session` sees and answers ({ mine }), and the count waiting in each other live
 * session ({ elsewhere: [{ session, member, count }] }). A decision of a session that has ended stays with
 * it: it isn't handed to another session's lead.
 */
export function decisionsFor(root, session, context = {}, now = Date.now()) {
  const all = openDecisions(root, context, now);
  const own = ownedBy(root, session);
  const live = new Set(
    sessions(root, now)
      .filter((s) => s.live)
      .map((s) => s.id),
  );
  const mine = all.filter((d) => !d.session || own.has(d.session));
  const counts = new Map();
  for (const d of all)
    if (d.session && !own.has(d.session) && live.has(d.session))
      counts.set(d.session, (counts.get(d.session) ?? 0) + 1);
  return {
    mine,
    elsewhere: [...counts].map(([s, count]) => ({
      session: s,
      member: all.find((d) => d.session === s)?.member ?? shortSession(s),
      count,
    })),
  };
}
