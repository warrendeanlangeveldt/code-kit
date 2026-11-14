// Streams in the mod (docs/specs/31-streams-and-platform.md, STRM-10): a stream's lead sees its own
// stream's build. The project's state is scoped to the streams this session leads (or works in), and
// the rest of the project is a line per other stream, and one for the core lanes they share.

/**
 * STRM-10: what this session's views are scoped to, from `code-kit streams --json`: the streams it leads
 * or works in, their lanes with the shared core lanes, their stories and their requirements. Null in a
 * project without streams, or for a session in none, which sees the whole project.
 */
export function scopeOf(streams) {
  const mine = (streams?.streams ?? []).filter((s) => (streams.mine ?? []).includes(s.name));
  if (!mine.length) return null;
  return {
    names: mine.map((s) => s.name),
    label: mine.map((s) => s.label ?? s.name).join(', '),
    lanes: new Set([...mine.flatMap((s) => s.lanes), ...(streams.shared ?? []).map((x) => x.lane)]),
    stories: new Set(mine.flatMap((s) => s.stories ?? [])),
    requirements: new Set(mine.flatMap((s) => s.requirements ?? [])),
  };
}

/** STRM-10: `code-kit check --json` with only the scope's lanes, so the Lanes panel draws its own. */
export function scopedCheck(check, scope) {
  if (!scope || !check?.lanes) return check;
  return {
    ...check,
    lanes: Object.fromEntries(
      Object.entries(check.lanes).filter(([name]) => scope.lanes.has(name)),
    ),
  };
}

/**
 * STRM-10: `code-kit status --json` with only the scope's stories and requirements, so the Build bar,
 * the milestone and the Trail count its own stream's.
 */
export function scopedStatus(status, scope) {
  if (!scope || !status) return status;
  return {
    ...status,
    stories: (status.stories ?? []).filter((s) => scope.stories.has(s.id)),
    requirements: (status.requirements ?? []).filter((r) => scope.requirements.has(r.id)),
  };
}

/** STRM-10: the stories ready to start, less other streams': `next` gives a stream's lead its own. */
export function scopedState(state, scope) {
  if (!scope || state?.kind !== 'ok') return state;
  return { ...state, ready: state.ready.filter((r) => scope.stories.has(r.id)) };
}

/**
 * STRM-10: the rest of the project, a line each: every other stream with its lead and what its lanes are
 * on, then the core lanes the streams share with whose turn each is. And, for this session's streams,
 * the stories core holds and what is theirs to decide for core. [{ key, text, tone }], tone 'dim' or
 * 'note'.
 */
export function streamLines(streams, scope) {
  if (!streams?.streams?.length) return [];
  const lines = [];
  for (const s of streams.streams) {
    if (scope?.names.includes(s.name)) {
      for (const h of s.held ?? [])
        lines.push({ key: `held-${h.story}`, text: h.why, tone: 'note' });
      if (s.toDecide?.length)
        lines.push({
          key: `decide-${s.name}`,
          text: `for core: ${s.toDecide.join(', ')} ${s.toDecide.length === 1 ? 'is' : 'are'} the ${s.label ?? s.name} lead's to decide`,
          tone: 'note',
        });
      continue;
    }
    const at = (s.running ?? []).map((r) => `${r.lane} ${r.story ?? 'a story'}`);
    lines.push({
      key: `stream-${s.name}`,
      text: `${s.label ?? s.name}${s.platform ? ' (platform)' : ''} · ${s.lead ? `led by ${s.lead.member}` : 'no lead'} · ${at.length ? at.join(', ') : 'no lane at work'}`,
      tone: 'dim',
    });
  }
  const shared = streams.shared ?? [];
  if (shared.length)
    lines.push({
      key: 'shared',
      text: `core, shared in turns: ${shared.map((x) => `${x.lane}${x.running ? ` on ${x.running}` : ''}${x.turn ? ` (${x.turn}'s turn last)` : ''}`).join(', ')}`,
      tone: 'dim',
    });
  return lines;
}

/** STRM-10: the band's word for the scope: "play" heads the build line, so a lead knows whose it is. */
export const scopeWord = (scope) => (scope ? scope.label : null);

/** STRM-10: the streams with no lead, each offered as a stream to lead from here. */
export const leaderless = (streams) =>
  (streams?.streams ?? []).filter((s) => !s.lead).map((s) => s.name);
