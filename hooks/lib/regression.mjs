// Regression (docs/specs/18-regression.md). REG-1: a fix comes with a test that fails without it, as the
// bug, and passes with it. REG-2: a test isn't weakened (deleted, skipped, cut down, its snapshot
// rewritten) without a `tests` approval: the lead's on a lane's branch where tests are delegated (spec 23,
// WHO-2), the person's otherwise and always on the lead's own. The commit hook
// refuses a weakening commit; verify finds what a branch weakened, from git.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { freshCheckout } from './checkout.mjs';
import { runChecks } from './checks.mjs';
import { matchesAny } from './glob.mjs';
import { readStories } from './plan.mjs';

/** The approval that lets a test be weakened: the person's only. */
export const TESTS_APPROVAL = 'tests';

// Test files by the usual conventions, when the config names none (`tests`).
const TEST =
  /(^|\/)(tests?|__tests__|e2e)\/|\.(test|spec)\.[^/]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/;
export const SNAPSHOT = /(^|\/)__snapshots__\/|\.snap$/;

/** Whether `rel` is a test: the config's `tests` globs, or the usual conventions. */
export const isTestFile = (rel, config) =>
  !rel.endsWith('.md') && (config?.tests?.length ? matchesAny(rel, config.tests) : TEST.test(rel));

// A case's name: it('…') / test('…') in JavaScript, def test_… in Python, func Test… in Go, @Test in JVM.
const JS_CASE =
  /\b(?:it|test)(?:\.(?:each\s*\([^)]*\)|concurrent|serial|skip|only|todo|fixme|fails))*\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
const PY_CASE = /^\s*(?:async\s+)?def\s+(test_\w+)/gm;
const GO_CASE = /^func\s+(Test\w+)\s*\(/gm;
const JVM_CASE = /@Test\b[^{;]*?\b(?:void|fun)\s+(\w+)\s*\(/g;
// Markers that skip or focus a test, so the rest stop running.
const SKIPS = [
  /\b(?:it|test|describe|suite|context)\.(?:skip|only|todo|fixme)\s*\(/,
  /\b(?:xit|xtest|xdescribe|fit|fdescribe)\s*\(/,
  /@pytest\.mark\.(?:skip|skipif|xfail)\b/,
  /\bpytest\.skip\s*\(/,
  /\bunittest\.skip/,
  /\bt\.Skip(?:f|Now)?\s*\(/,
  /@(?:Disabled|Ignore)\b/,
];
const ASSERTION =
  /\bexpect\s*\(|\bassert\w*\s*[.(]|\bt\.(?:Error|Errorf|Fatal|Fatalf|Fail)\b|\bshould\.\w/g;

const skipLines = (text) =>
  String(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => SKIPS.some((r) => r.test(l)));

/** What a test file holds: its cases' names, its skip and focus markers, and how many assertions. */
export function testShape(text) {
  const t = String(text ?? '');
  const cases = [
    ...[...t.matchAll(JS_CASE)].map((m) => m[2]),
    ...[...t.matchAll(PY_CASE)].map((m) => m[1]),
    ...[...t.matchAll(GO_CASE)].map((m) => m[1]),
    ...[...t.matchAll(JVM_CASE)].map((m) => m[1]),
  ];
  return { cases, skips: skipLines(t), assertions: (t.match(ASSERTION) ?? []).length };
}

const clip = (s, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const quoteList = (names) =>
  names
    .slice(0, 3)
    .map((n) => `"${clip(n, 50)}"`)
    .join(', ') + (names.length > 3 ? ` and ${names.length - 3} more` : '');

/** How `after` weakens `before`, in words; empty when it doesn't. */
export function weakenings(before, after) {
  const was = testShape(before);
  const now = testShape(after);
  const reasons = [];
  const old = new Set(was.skips);
  const added = now.skips.filter((l) => !old.has(l));
  if (added.length || now.skips.length > was.skips.length)
    reasons.push(
      `adds a skip or focus marker${
        added.length
          ? ` (${added
              .slice(0, 2)
              .map((l) => `\`${clip(l, 60)}\``)
              .join(', ')})`
          : ''
      }`,
    );
  if (now.cases.length < was.cases.length) {
    const left = new Set(now.cases);
    const gone = was.cases.filter((c) => !left.has(c));
    reasons.push(
      `has ${was.cases.length - now.cases.length} fewer test case${was.cases.length - now.cases.length === 1 ? '' : 's'}${gone.length ? ` (${quoteList(gone)} gone)` : ''}`,
    );
  } else if (now.assertions < was.assertions)
    reasons.push(
      `has ${was.assertions - now.assertions} fewer assertion${was.assertions - now.assertions === 1 ? '' : 's'} (${was.assertions} → ${now.assertions})`,
    );
  return reasons;
}

/**
 * REG-2: the tests a set of changes weakens: [{ file, reasons }]. `changes` is [{ status: 'A'|'M'|'D',
 * file, from? }] (from: a rename's old path); `before(path)` and `after(path)` read the two sides, null
 * when the file isn't there. A deleted test whose cases all reappear in an added one was moved, not cut.
 */
export function weakenedTests(changes, before, after, config) {
  const found = [];
  const added = changes.filter((c) => c.status === 'A' && isTestFile(c.file, config));
  for (const c of changes) {
    const was = c.from ?? c.file;
    if (SNAPSHOT.test(was) && c.status !== 'A') {
      if (c.status === 'D' || before(was) !== after(c.file))
        found.push({
          file: c.file,
          reasons: [c.status === 'D' ? 'deletes a snapshot' : 'rewrites a snapshot'],
        });
      continue;
    }
    if (!isTestFile(was, config) || c.status === 'A') continue;
    const old = before(was);
    if (old === null) continue;
    if (c.status === 'D') {
      const cases = testShape(old).cases;
      const moved =
        cases.length > 0 &&
        added.some((a) => {
          const there = new Set(testShape(after(a.file)).cases);
          return cases.every((n) => there.has(n));
        });
      if (!moved)
        found.push({
          file: c.file,
          reasons: [
            `deletes the test file${cases.length ? ` (${cases.length} case${cases.length === 1 ? '' : 's'})` : ''}`,
          ],
        });
      continue;
    }
    const reasons = weakenings(old, after(c.file));
    if (reasons.length) found.push({ file: c.file, reasons });
  }
  return found;
}

const git = (root, ...args) =>
  execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });

const showAt = (root, ref, rel) => {
  try {
    return git(root, 'show', `${ref}:${rel}`);
  } catch {
    return null;
  }
};

/** REG-2 for a branch: what it weakened since `from` (where it left the base), judged from git. */
export function branchWeakenings(root, from, config) {
  const changes = git(root, 'diff', '--name-status', '-M', from, 'HEAD')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [status, a, b] = l.split('\t');
      return status.startsWith('R')
        ? { status: 'M', from: a, file: b }
        : { status: status[0] === 'D' ? 'D' : status[0] === 'A' ? 'A' : 'M', file: a };
    });
  return weakenedTests(
    changes,
    (rel) => showAt(root, from, rel),
    (rel) => showAt(root, 'HEAD', rel),
    config,
  );
}

/**
 * REG-2 for a commit about to be made: `files` as the commit hook lists them, HEAD against the
 * working tree. `gone`: files the commit's own command takes away first (`git rm`, `git mv`), which
 * are still on disk as the hook runs.
 */
export function commitWeakenings(root, files, config, gone = new Set()) {
  const read = (rel) => {
    if (gone.has(rel)) return null;
    try {
      return readFileSync(join(root, rel), 'utf8');
    } catch {
      return null;
    }
  };
  const changes = files.map((file) => {
    const was = showAt(root, 'HEAD', file) !== null;
    const is = !gone.has(file) && existsSync(join(root, file));
    return { status: !was ? 'A' : is ? 'M' : 'D', file };
  });
  return weakenedTests(changes, (rel) => showAt(root, 'HEAD', rel), read, config);
}

/**
 * REG-1: what a branch fixes, or null when it isn't a fix: its plan story's `**Fixes:**` line (branch
 * `<lane>/st-<n>`), or a branch named `<lane>/fix-…`.
 */
export function fixOf(root, branch, config) {
  if (!branch) return null;
  const story = branch.match(/^[^/]+\/(st-\d+)$/i)?.[1]?.toUpperCase();
  if (story && config.docs?.plan) {
    const s = readStories(root, config.docs.plan).find((x) => x.id === story);
    if (s?.fixes) return { story: s.id, what: s.fixes };
  }
  if (/^[^/]+\/fix-/.test(branch))
    return { story: null, what: branch.split('/').slice(1).join('/').slice(4).replace(/-/g, ' ') };
  return null;
}

// A failure that only says the test can't reach what it calls: the fix added it, so it proves nothing.
const UNREACHABLE =
  /Cannot find module|is not a function|does not provide an export named|is not exported|has no exported member|error TS2305|error TS2339|error TS2724|error TS2614|ImportError|ModuleNotFoundError|cannot import name|undefined: \w|\[build failed\]|ReferenceError: \w+ is not defined/;
// Signs a test ran and an assertion failed.
const ASSERTED =
  /AssertionError|AssertionFailedError|Expected:|Received:|expected .+ to |toBe|toEqual|assert\w* failed|^\s*--- FAIL|Error: expect\(/m;

/** Whether a failure's output only shows the tests couldn't reach what the fix adds. */
export const onlyUnreachable = (output) =>
  UNREACHABLE.test(output) && !ASSERTED.test(output.replace(UNREACHABLE, ''));

/**
 * REG-1: whether a fix's tests prove its bug. In a fresh checkout of the branch (with its own copy of
 * the checkout's installs, after `regression.prepare`), the checks covering the tests it added
 * or changed must pass, and fail, as the bug, once every change outside the tests goes back to `from`.
 * Problems in words; empty when the tests prove it.
 */
export function proveFix({ root, from, base, changed, config, fix }) {
  const what = `This branch fixes ${fix.what}${fix.story ? ` (${fix.story})` : ''}`;
  const tests = changed.filter(
    (f) => isTestFile(f, config) && !SNAPSHOT.test(f) && showAt(root, 'HEAD', f) !== null,
  );
  if (!tests.length)
    return [
      `${what}, but it adds or changes no test. Add a test that fails without the fix: it's what stops the bug coming back.`,
    ];
  const covering = config.checks.filter((c) =>
    tests.some((f) => matchesAny(f, c.files) && !matchesAny(f, c.exclude)),
  );
  if (!covering.length)
    return [
      `${what}, but no check runs its tests (${tests.join(', ')}), so code-kit can't show they fail without it. Add a check whose files match them.`,
    ];
  const strict = { ...config, checks: covering.map((c) => ({ ...c, ifMissing: 'fail' })) };
  const actor = { kind: 'lead', label: 'lead' };
  const { dir, remove } = freshCheckout(root, 'HEAD', { prefix: 'code-kit-fix-' });
  try {
    const prepare = config.regression?.prepare;
    if (prepare) {
      const res = spawnSync(prepare, { cwd: dir, shell: true, encoding: 'utf8', timeout: 900000 });
      if (res.status !== 0)
        return [
          `regression.prepare (\`${prepare}\`) failed in a fresh checkout, so the fix's tests couldn't run:\n${`${res.stdout ?? ''}${res.stderr ?? ''}`.trim().split('\n').slice(-20).join('\n')}`,
        ];
    }
    const { failure: withFix } = runChecks(strict, tests, dir, actor);
    if (withFix)
      return [
        `${what}, but its tests don't pass in a fresh checkout of the branch (${withFix.title.replace(/ Fix it:$/, '')}), so code-kit can't tell whether they fail without it. If they need an install or a build first, set regression.prepare.${withFix.output ? `\n${String(withFix.output).trim().split('\n').slice(-20).join('\n')}` : ''}`,
      ];
    for (const f of changed) {
      if (isTestFile(f, config) || SNAPSHOT.test(f)) continue;
      if (showAt(root, from, f) !== null) git(dir, 'checkout', from, '--', f);
      else rmSync(join(dir, f), { force: true });
    }
    const { failure: without } = runChecks(strict, tests, dir, actor);
    if (!without)
      return [
        `${what}, but its tests (${tests.join(', ')}) also pass without the fix, so they don't prove the bug and it can come back. Write a test that fails on ${base} and passes here.`,
      ];
    const output = `${without.title}\n${without.output ?? ''}`;
    if (onlyUnreachable(output)) {
      const line =
        output
          .split('\n')
          .find((l) => UNREACHABLE.test(l))
          ?.trim() ?? '';
      return [
        `${what}, but its tests fail without the fix only because they call what the fix adds (${clip(line, 120)}). A test that goes through the existing code fails on an assertion when the bug is there: write that one.`,
      ];
    }
    return [];
  } finally {
    remove();
  }
}
