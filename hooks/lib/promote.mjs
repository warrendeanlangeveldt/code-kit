// Promotion: a stream's code that belongs in core (docs/specs/31-streams-and-platform.md, PROM-1 to
// PROM-4). code-kit notices it from five signals: the same code in two streams' modules, a refused
// import of another stream's module, a copy into a module, new module code that repeats core, and a
// requirement another stream already meets. Each is a candidate the platform lead decides; nothing is
// moved by itself. A clone is found by tokens: names and literals masked, comments, strings and imports
// left out, so a copy with renamed variables still matches, and runs of at least `promote.tokens` tokens
// are found by hashing every window of that length.
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { CORE, hasStreams, ownerStreamOf, platformOf, streamsOf } from './streams.mjs';
import { projectWorktrees } from './rules.mjs';
import { EVENTS_DIR } from './events.mjs';
import { commandsOf, wordsOf } from './shell.mjs';

export const PROMOTIONS_FILE = '.claude/state/promotions.jsonl';
const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py)$/;
const PY_KEYWORDS = new Set(
  'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield match case self'.split(
    ' ',
  ),
);
const JS_KEYWORDS = new Set(
  'async await break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while with yield interface type enum implements readonly private public protected as'.split(
    ' ',
  ),
);

const mainOf = (root) => projectWorktrees(root)[0] ?? root;

/**
 * The code's tokens, each { t, line }: keywords and punctuation as written, every other name `I`, every
 * number `N` and string `S`. Comments go, and so do import lines, which every file has.
 */
export function tokensOf(text, file) {
  const py = file.endsWith('.py');
  const keywords = py ? PY_KEYWORDS : JS_KEYWORDS;
  const out = [];
  const lines = String(text).split('\n');
  let inBlock = false;
  let inTriple = null;
  for (let n = 0; n < lines.length; n++) {
    let line = lines[n];
    if (inTriple) {
      const end = line.indexOf(inTriple);
      if (end < 0) continue;
      line = line.slice(end + 3);
      inTriple = null;
    }
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end < 0) continue;
      line = line.slice(end + 2);
      inBlock = false;
    }
    const trimmed = line.trim();
    if (py ? /^(?:import|from)\s/.test(trimmed) : /^(?:import\b|export\s.*\bfrom\s)/.test(trimmed))
      continue;
    const re = py
      ? /("""|''')|#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d[\w.]*|[A-Za-z_]\w*|==|!=|<=|>=|->|\*\*|\/\/|[^\s\w]/g
      : /\/\*|\/\/.*$|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d[\w.]*|[A-Za-z_$][\w$]*|===|!==|==|!=|<=|>=|=>|&&|\|\||\?\?|\.\.\.|[^\s\w]/g;
    for (const m of line.matchAll(re)) {
      const w = m[0];
      if (py && m[1]) {
        const close = line.indexOf(m[1], m.index + 3);
        if (close < 0) {
          inTriple = m[1];
          break;
        }
        out.push({ t: 'S', line: n + 1 });
        continue;
      }
      if (w === '/*') {
        const close = line.indexOf('*/', m.index + 2);
        if (close < 0) {
          inBlock = true;
          break;
        }
        continue;
      }
      if (w.startsWith('//') || (py && w.startsWith('#'))) break;
      if (/^["'`]/.test(w)) out.push({ t: 'S', line: n + 1 });
      else if (/^\d/.test(w)) out.push({ t: 'N', line: n + 1 });
      else if (/^[A-Za-z_$]/.test(w)) out.push({ t: keywords.has(w) ? w : 'I', line: n + 1 });
      else out.push({ t: w, line: n + 1 });
    }
  }
  return out;
}

// A 32-bit hash of a window of tokens.
function hashOf(tokens, from, size) {
  let h = 2166136261;
  for (let i = from; i < from + size; i++) {
    const t = tokens[i].t;
    for (let j = 0; j < t.length; j++) h = Math.imul(h ^ t.charCodeAt(j), 16777619);
    h = Math.imul(h ^ 0x1f, 16777619);
  }
  return h >>> 0;
}

/** The name a line of code sits in: the nearest function, class or constant above it, or null. */
function symbolAt(lines, line) {
  for (let i = line - 1; i >= 0; i--) {
    const m =
      lines[i]?.match(
        /^\s*(?:export\s+)?(?:async\s+)?(?:function\*?|class|def)\s+([A-Za-z_$][\w$]*)/,
      ) ?? lines[i]?.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
    if (m) return m[1];
  }
  return null;
}

/**
 * PROM-1, signals 1 and 4: the clones between files of different owners (`owner(file)`: a stream's
 * name, `core`, or null to leave a file out). `texts` is { file: text }. Returns [{ a, b }], each side
 * { file, owner, from, to, symbol, tokens }, the longest run first.
 */
export function findClones(texts, owner, { tokens: size = 60 } = {}) {
  const parsed = new Map();
  const seen = new Map();
  for (const [file, text] of Object.entries(texts)) {
    const who = owner(file);
    if (!who || !SOURCE.test(file)) continue;
    const tokens = tokensOf(text, file);
    parsed.set(file, { tokens, lines: String(text).split('\n'), who });
    for (let i = 0; i + size <= tokens.length; i++) {
      const h = hashOf(tokens, i, size);
      const at = seen.get(h);
      if (at) at.push({ file, i });
      else seen.set(h, [{ file, i }]);
    }
  }
  // Runs: the windows two files share, in step, joined into the longest stretch.
  const pairs = new Map();
  for (const at of seen.values()) {
    if (at.length < 2 || at.length > 40) continue;
    for (let x = 0; x < at.length; x++)
      for (let y = x + 1; y < at.length; y++) {
        const [p, q] = at[x].file < at[y].file ? [at[x], at[y]] : [at[y], at[x]];
        if (p.file === q.file || parsed.get(p.file).who === parsed.get(q.file).who) continue;
        const key = `${p.file}\n${q.file}`;
        if (!pairs.has(key)) pairs.set(key, []);
        pairs.get(key).push([p.i, q.i]);
      }
  }
  const clones = [];
  for (const [key, hits] of pairs) {
    const [fa, fb] = key.split('\n');
    const A = parsed.get(fa);
    const B = parsed.get(fb);
    hits.sort((u, v) => u[0] - v[0] || u[1] - v[1]);
    let run = null;
    const flush = () => {
      if (!run) return;
      const side = (P, file, from, to) => ({
        file,
        owner: P.who,
        from: P.tokens[from].line,
        to: P.tokens[Math.min(to, P.tokens.length - 1)].line,
        symbol: symbolAt(P.lines, P.tokens[from].line),
        tokens: to - from + 1,
      });
      clones.push({
        a: side(A, fa, run.a, run.a2 + size - 1),
        b: side(B, fb, run.b, run.b2 + size - 1),
      });
      run = null;
    };
    for (const [i, j] of hits) {
      if (run && i === run.a2 + 1 && j === run.b2 + 1) {
        run.a2 = i;
        run.b2 = j;
        continue;
      }
      flush();
      run = { a: i, a2: i, b: j, b2: j };
    }
    flush();
  }
  return clones.sort((u, v) => v.a.tokens - u.a.tokens);
}

// The record kept for each candidate, and each decision.
function readLog(root) {
  try {
    return readFileSync(join(mainOf(root), PROMOTIONS_FILE), 'utf8')
      .split('\n')
      .flatMap((l) => {
        try {
          return l ? [JSON.parse(l)] : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function append(root, record) {
  const file = join(mainOf(root), PROMOTIONS_FILE);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`);
}

/**
 * Every candidate: [{ id, key, kind, what, where, streams, evidence, raised, state, decided }]. `state`
 * is open, promoted (with the platform story that moves it) or rejected (with why).
 */
export function promotions(root) {
  const byId = new Map();
  for (const r of readLog(root)) {
    if (r.kind === 'raise') byId.set(r.id, { ...r, kind: r.signal, state: 'open', decided: null });
    const had = byId.get(r.id);
    if (!had) continue;
    if (r.kind === 'evidence')
      byId.set(r.id, {
        ...had,
        where: [...new Set([...had.where, ...r.where])],
        streams: [...new Set([...had.streams, ...r.streams])],
        evidence: [...had.evidence, r.evidence],
        ...(had.state === 'rejected' && r.reopens ? { state: 'open', decided: null } : {}),
      });
    if (r.kind === 'decide')
      byId.set(r.id, {
        ...had,
        state: r.how,
        decided: { at: r.at, by: r.by ?? null, story: r.story ?? null, reason: r.reason ?? null },
      });
  }
  return [...byId.values()];
}

/**
 * PROM-1, PROM-3: raises a candidate, or adds to the one with the same key. A rejected one opens again
 * only when its evidence changes: a stream or a file it didn't have. Returns the candidate, or null when
 * nothing changed.
 */
export function raise(root, { key, signal, what, where, streams, evidence }, now = Date.now()) {
  const had = promotions(root).find((p) => p.key === key);
  const at = new Date(now).toISOString();
  if (!had) {
    const id = `P-${readLog(root).filter((r) => r.kind === 'raise').length + 1}`;
    append(root, {
      kind: 'raise',
      id,
      at,
      key,
      signal,
      what,
      where,
      streams,
      evidence: [evidence],
    });
    return promotions(root).find((p) => p.id === id);
  }
  const newWhere = where.filter((w) => !had.where.includes(w));
  const newStreams = streams.filter((s) => !had.streams.includes(s));
  if (!newWhere.length && !newStreams.length) return null;
  if (had.state === 'promoted') return null;
  append(root, {
    kind: 'evidence',
    id: had.id,
    at,
    where: newWhere,
    streams: newStreams,
    evidence,
    reopens: had.state === 'rejected',
  });
  return promotions(root).find((p) => p.id === had.id);
}

/** PROM-3: the platform lead's decision: promoted, with the platform story; or rejected, with why. */
export function decidePromotion(
  root,
  id,
  { how, story = null, reason = null, by = null },
  now = Date.now(),
) {
  const p = promotions(root).find((x) => x.id === id);
  if (!p) return { ok: false, why: `There's no candidate ${id}. code-kit promote lists them.` };
  if (p.state !== 'open') return { ok: false, why: `${id} was ${p.state} already.` };
  if (how === 'promoted' && !/^ST-\d+$/.test(story ?? ''))
    return { ok: false, why: 'Name the platform story that moves it into core: --story ST-n.' };
  if (how === 'rejected' && !reason?.trim())
    return {
      ok: false,
      why: "Say why it stays in its module, with --reason: it isn't proposed again until that changes.",
    };
  append(root, { kind: 'decide', id, at: new Date(now).toISOString(), how, story, reason, by });
  return { ok: true, promotion: promotions(root).find((x) => x.id === id) };
}

const sideWords = (s) => `${s.file}:${s.from}-${s.to}${s.symbol ? ` (${s.symbol})` : ''}`;

/** PROM-1: a clone between two owners as a candidate's fields. */
export function cloneCandidate(clone) {
  const sides = [clone.a, clone.b].sort((x, y) => x.file.localeCompare(y.file));
  const core = sides.find((s) => s.owner === CORE);
  const streams = [...new Set(sides.map((s) => s.owner).filter((o) => o !== CORE))];
  return {
    key: `clone:${sides.map((s) => `${s.file}#${s.symbol ?? s.from}`).join('|')}`,
    signal: core ? 'core-clone' : 'clone',
    what: core
      ? `${sideWords(sides.find((s) => s !== core))} repeats core's ${sideWords(core)}`
      : `${sides.map(sideWords).join(' and ')}: the same code in ${streams.join(' and ')}`,
    where: sides.map((s) => s.file),
    streams,
    evidence: `${clone.a.tokens} tokens alike`,
  };
}

/** The project's source files, as git tracks them, or as `ref` has them. */
function trackedSources(root, ref = null) {
  try {
    const args = ref ? ['ls-tree', '-r', '--name-only', ref] : ['ls-files'];
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 })
      .split('\n')
      .filter((f) => SOURCE.test(f));
  } catch {
    return [];
  }
}

/** The text of each of `files` as `ref` has it, read in one batch: { file: text }. */
function textsAt(root, ref, files) {
  if (!files.length) return {};
  let raw;
  try {
    raw = execFileSync('git', ['-C', root, 'cat-file', '--batch'], {
      input: `${files.map((f) => `${ref}:${f}`).join('\n')}\n`,
      maxBuffer: 1 << 30,
    });
  } catch {
    return {};
  }
  const texts = {};
  let at = 0;
  for (const f of files) {
    const nl = raw.indexOf(10, at);
    if (nl < 0) break;
    const header = raw.subarray(at, nl).toString('utf8');
    at = nl + 1;
    if (header.endsWith(' missing')) continue;
    const size = Number(header.split(' ')[2]);
    if (!Number.isFinite(size)) break;
    texts[f] = raw.subarray(at, at + size).toString('utf8');
    at += size + 1;
  }
  return texts;
}

/** A path a command named, relative to the project, with a worktree's folder taken off; null outside it. */
export function projectPath(root, path) {
  const main = mainOf(root);
  let real = main;
  try {
    real = realpathSync(main);
  } catch {
    // a checkout that's gone: its own path only
  }
  const abs = isAbsolute(path) ? path : join(main, path);
  // macOS shows the temporary folder both as /var and as /private/var.
  const forms = [abs, abs.replace(/^\/private(?=\/)/, ''), `/private${abs}`];
  for (const base of [main, real])
    for (const form of forms) {
      const rel = relative(base, form).split('\\').join('/');
      if (!rel.startsWith('..') && !isAbsolute(rel))
        return rel.replace(/^\.claude\/worktrees\/[^/]+\//, '');
    }
  return null;
}

/**
 * PROM-1, signal 3: copies a lane made into a stream's module, from another stream's module or from
 * outside the project, read from the event log: [{ from, to, stream, outside }].
 */
export function copiesIn(root, config) {
  const dir = join(mainOf(root), EVENTS_DIR);
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }
  const found = [];
  for (const f of files) {
    let lines = [];
    try {
      lines = readFileSync(join(dir, f), 'utf8').split('\n');
    } catch {
      continue;
    }
    for (const l of lines) {
      let e;
      try {
        e = l ? JSON.parse(l) : null;
      } catch {
        continue;
      }
      if (!e || e.phase !== 'end' || e.result?.ok === false || typeof e.target !== 'string')
        continue;
      for (const { text } of commandsOf(e.target)) {
        const words = wordsOf(text);
        if (!['cp', 'rsync', 'ditto'].includes(words[0])) continue;
        const paths = words.slice(1).filter((w) => !w.startsWith('-'));
        if (paths.length < 2 || paths.some((p) => p.includes('$'))) continue;
        const to = projectPath(root, paths.at(-1));
        const toOwner = to ? ownerStreamOf(config, to) : null;
        if (!toOwner || toOwner === CORE) continue;
        for (const src of paths.slice(0, -1)) {
          const from = projectPath(root, src);
          const fromOwner = from ? ownerStreamOf(config, from) : null;
          if (from && fromOwner === toOwner) continue;
          if (from && !fromOwner) continue;
          found.push({
            from: from ?? src,
            to,
            stream: toOwner,
            fromStream: fromOwner,
            outside: !from,
          });
        }
      }
    }
  }
  return found;
}

/**
 * PROM-1: looks for candidates across the project, or, with `files`, in those files against the rest,
 * and raises each one found. Returns { raised: [candidate], clones: [clone] }: what's new or changed, and
 * every clone seen.
 */
export function scanForPromotions(
  root,
  config,
  { files = null, ref = null, tokens = null, record = true, now = Date.now() } = {},
) {
  if (!hasStreams(config)) return { raised: [], clones: [] };
  const size = tokens ?? config.harness?.promote?.tokens ?? 60;
  const owner = (f) => ownerStreamOf(config, f);
  const sources = trackedSources(root, ref).filter((f) => owner(f));
  const texts = ref ? textsAt(root, ref, sources) : {};
  if (!ref)
    for (const f of sources) {
      if (!existsSync(join(root, f))) continue;
      try {
        texts[f] = readFileSync(join(root, f), 'utf8');
      } catch {
        // unreadable: left out
      }
    }
  let clones = findClones(texts, owner, { tokens: size });
  if (files) clones = clones.filter((c) => files.includes(c.a.file) || files.includes(c.b.file));
  const raised = [];
  for (const c of record ? clones : []) {
    const r = raise(root, cloneCandidate(c), now);
    if (r) raised.push(r);
  }
  if (!files && record)
    for (const copy of copiesIn(root, config)) {
      const r = raise(
        root,
        {
          key: `copy:${copy.from}>${copy.to}`,
          signal: 'copy',
          what: `${copy.from} was copied into ${copy.to} (${copy.stream})${copy.outside ? ', from outside the project' : `, from ${copy.fromStream}`}`,
          where: [copy.to, ...(copy.outside ? [] : [copy.from])],
          streams: [
            copy.stream,
            ...(copy.fromStream && copy.fromStream !== CORE ? [copy.fromStream] : []),
          ],
          evidence: 'copied by a lane',
        },
        now,
      );
      if (r) raised.push(r);
    }
  return { raised, clones };
}

/** PROM-1, signal 2: a lane was refused an import of another stream's module: what it wanted. */
export function recordRefusedImport(root, config, { file, target, spec }, now = Date.now()) {
  try {
    const from = ownerStreamOf(config, file);
    const to = ownerStreamOf(config, target);
    if (!from || !to || from === to || to === CORE) return null;
    return raise(
      root,
      {
        key: `import:${target}`,
        signal: 'import',
        what: `${from} wants ${spec} (${target}), ${to}'s`,
        where: [target, file],
        streams: [to, ...(from === CORE ? [] : [from])],
        evidence: `${file} was refused importing it`,
      },
      now,
    );
  } catch {
    return null;
  }
}

const words = (t) =>
  new Set(
    String(t)
      .toLowerCase()
      .match(/[a-z][a-z0-9]+/g)
      ?.filter((w) => w.length > 2 && !['the', 'and', 'for', 'with', 'from', 'its'].includes(w)) ??
      [],
  );

/**
 * PROM-1, signal 5: the requirements of other streams' specs that a story's requirements repeat:
 * [{ requirement, matches, stream, file, score }], by how alike their titles are.
 */
export function repeatedRequirements(config, requirements, story, { at = 0.6 } = {}) {
  const mine = streamsOf(config).find((s) => s.lanes.includes(story.lane));
  const specOf = (file) =>
    streamsOf(config).find((s) =>
      s.specs.some((g) => file === g || file.startsWith(g.replace(/\*.*$/, ''))),
    )?.name ?? null;
  const own = requirements.filter((r) => story.requirements.includes(r.id));
  const out = [];
  for (const r of own) {
    const a = words(r.title);
    if (a.size < 2) continue;
    for (const o of requirements) {
      const stream = specOf(o.file);
      if (!stream || stream === mine?.name || o.id === r.id) continue;
      const b = words(o.title);
      const shared = [...a].filter((w) => b.has(w)).length;
      const score = shared / new Set([...a, ...b]).size;
      if (score >= at)
        out.push({ requirement: r.id, matches: o.id, title: o.title, stream, file: o.file, score });
    }
  }
  return out.sort((x, y) => y.score - x.score);
}

/** PROM-2: whose a candidate is to decide: the platform's lead, or, without one, a stream it touches. */
export function decidedFor(config, candidate) {
  return platformOf(config)?.name ?? candidate.streams[0] ?? null;
}
