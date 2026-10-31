// The pure parts: globs, config validation and defaults, import parsing, layer rules, config diffs,
// the baseline and the packages a command adds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globToRegExp, matchesAny } from '../hooks/lib/glob.mjs';
import { loadConfig, validate, withDefaults } from '../hooks/lib/config.mjs';
import { importsOf, layerProblems } from '../hooks/lib/layers.mjs';
import { diffConfigs, ownershipMoves } from '../hooks/lib/diff.mjs';
import { newProblems } from '../hooks/lib/baseline.mjs';
import { addedPackages, dependencyApproval, isDependencyFile } from '../hooks/lib/dependencies.mjs';
import { commandsOf, runs, withoutHeredocs } from '../hooks/lib/shell.mjs';
import { storyMerges } from '../hooks/lib/queue.mjs';
import { publishTitle } from '../hooks/lib/publish.mjs';
import {
  NOT_CODE_KIT,
  agentsAtWork,
  bandLines,
  parseJson,
  commandItself,
  prefilledReason,
  projectState,
  settingsView,
  attribution,
  withUsage,
  usageSummary,
  finishedStories,
  planOf,
  tokens,
  planBar,
  approvalAsks,
  askWords,
} from '../hooks/mod/view.mjs';
import {
  agentFileModel,
  answeredPrompt,
  designHandedOver,
  laneModel,
  leadPrompt,
  outcomePrompt,
  compactInstructions,
  continuePrompt,
  milestonesDone,
  requestContext,
  wrapUpText,
  parkWatch,
  readOutcome,
  stepStories,
  storiesInFlight,
  storiesSignature,
  withoutInFlight,
  limitHold,
  unfinished,
} from '../hooks/mod/loop.mjs';

const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixture.json'), 'utf8'),
);
const clone = () => structuredClone(fixture);

test('globs', () => {
  const cases = [
    ['src/**', 'src/a/b.ts', true],
    ['src/**', 'src', false],
    ['src/*', 'src/a/b.ts', false],
    ['**/domain/**', 'packages/domain/x.ts', true],
    ['**/domain/**', 'domain/x.ts', true],
    ['**/domain/**', 'xdomain/x.ts', false],
    ['**/*.{ts,tsx}', 'a/b.tsx', true],
    ['**/*.{ts,tsx}', 'a/b.js', false],
    ['a?.md', 'ab.md', true],
    ['node:*', 'node:fs', true],
    ['@supabase/*', '@supabase/ssr', true],
    ['file.json', 'fileXjson', false],
  ];
  for (const [glob, path, want] of cases)
    assert.equal(globToRegExp(glob).test(path), want, `${glob} ~ ${path}`);
  assert.equal(matchesAny('x', undefined), false);
});

test('the fixture is valid', () => assert.deepEqual(validate(fixture), []));

test('validation names each problem', () => {
  const c = clone();
  c.version = 2;
  c.docs = { specs: 3 };
  c.lanes.web.agent = 'db-engineer';
  c.layers[1].mayImport = ['nope'];
  c.shell.restricted[0].lanes = ['ghost'];
  c.checks[0].ifMissing = 'maybe';
  c.designGate.screens[0].not = '(';
  const problems = validate(c).join('\n');
  for (const text of [
    '"version"',
    '"docs.specs"',
    'used by another lane',
    'unknown layer "nope"',
    'unknown lane "ghost"',
    'ifMissing',
    'designGate.screens',
  ]) {
    assert.ok(problems.includes(text), `expected a problem mentioning ${text}\n${problems}`);
  }
  assert.deepEqual(validate([]), ['the config must be a JSON object']);
});

test("a layer's or lane's label is a short name for what it delivers", () => {
  const c = clone();
  c.layers[0].label = 'API contract';
  c.lanes.web.label = 'Screens';
  assert.deepEqual(validate(c), []);
  c.layers[0].label = 'x'.repeat(61);
  c.lanes.web.label = 'two\nlines';
  const problems = validate(c).join('\n');
  assert.match(problems, /layers\[0\]\.label must be a short name/);
  assert.match(problems, /lanes\.web\.label must be a short name/);
});

test('defaults: the kit and memory belong to the lead, the kit is protected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'code-kit-unit-'));
  try {
    assert.deepEqual(loadConfig(dir), {});
    mkdirSync(join(dir, '.claude'));
    writeFileSync(join(dir, '.claude/code-kit.json'), '{ not json');
    assert.match(loadConfig(dir).error, /not valid JSON/);
    writeFileSync(join(dir, '.claude/code-kit.json'), JSON.stringify(fixture));
    const { config } = loadConfig(dir);
    assert.ok(config.lead.paths.includes('.claude/**'));
    assert.ok(config.lead.outside.includes('~/.claude/projects/*/memory/**'));
    assert.equal(config.protected[0].approval, 'kit');
    assert.ok(config.anyActor.includes('.claude/state/**'));
    assert.deepEqual(config.branches.protected, ['main', 'master']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('imports are read from every form', () => {
  const src = [
    "import a from './a';",
    'import { b } from "../b";',
    "import type { C } from '@kit/schemas';",
    "export * from './d';",
    "import './e.css';",
    "const f = require('f');",
    "const g = await import('./g');",
  ].join('\n');
  assert.deepEqual(
    importsOf(src).sort(),
    ['../b', './a', './d', './e.css', './g', '@kit/schemas', 'f'].sort(),
  );
});

test('layer rules', () => {
  const config = { ...clone(), importAliases: fixture.importAliases };
  const check = (rel, src) => layerProblems(rel, src, config);
  assert.deepEqual(check('packages/domain/src/x.ts', "import { A } from '@kit/schemas/a';"), []);
  assert.equal(
    check('packages/domain/src/x.ts', "import { S } from '../../../apps/x/services/s';").length,
    1,
  );
  assert.equal(check('packages/domain/src/x.ts', "import fs from 'node:fs';").length, 1);
  assert.deepEqual(check('packages/domain/src/x.ts', "import { z } from 'zod';"), []);
  assert.deepEqual(check('apps/x/services/s.ts', "import { D } from '@kit/domain';"), []);
  assert.equal(check('packages/schemas/src/s.ts', "import { D } from '@kit/domain/d';").length, 1);
  assert.deepEqual(
    check('scripts/x.ts', "import { P } from '../apps/x/providers/p';"),
    [],
    'files outside every layer are not checked',
  );
  assert.deepEqual(
    check('packages/domain/README.md', "from '../services/x'"),
    [],
    'only code is checked',
  );
});

test('a config without docs is valid (brownfield: no spec-check gate)', () => {
  const c = clone();
  delete c.docs;
  assert.deepEqual(validate(c), []);
});

test('diff: lanes, layers, lead paths and checks, in words', () => {
  const before = clone();
  const after = clone();
  after.lanes.api = { agent: 'api-engineer', paths: ['services/api/**'] };
  delete after.lanes.platform;
  after.lanes.web.paths.push('apps/portal/**');
  after.layers[2].mayImport = ['domain'];
  after.lead.paths.push('tools/**');
  after.checks[0].run = ['npm test'];
  const lines = diffConfigs(before, after);
  const has = (text) =>
    assert.ok(
      lines.some((l) => l.includes(text)),
      `expected "${text}" in\n${lines.join('\n')}`,
    );
  has('+ lane api: api-engineer, services/api/**');
  has('- lane platform');
  has('~ lane web: paths + apps/portal/**');
  has('~ layer services: mayImport - schemas');
  has('~ lead paths: + tools/**');
  has('~ check workers: run + npm test; - test -f workers/ok');
  assert.deepEqual(diffConfigs(before, clone()), []);
});

test('diff: files that change owner', () => {
  const before = withDefaults(clone());
  const raw = clone();
  raw.lanes.api = { agent: 'api-engineer', paths: ['workers/api/**'] };
  raw.lanes.backend.exclude = ['workers/ai/**', 'workers/api/**'];
  const moves = ownershipMoves(
    ['workers/api/x.ts', 'workers/jobs/y.ts', 'docs/a.md'],
    before,
    withDefaults(raw),
  );
  assert.deepEqual(moves, [
    {
      file: 'workers/api/x.ts',
      from: 'backend lane / backend-engineer',
      to: 'api lane / api-engineer',
    },
  ]);
});

test('the baseline excuses only what it recorded', () => {
  const baseline = { layers: { 'a.ts': ['old problem'] } };
  assert.deepEqual(newProblems('a.ts', ['old problem', 'new problem'], baseline), ['new problem']);
  assert.deepEqual(newProblems('b.ts', ['old problem'], baseline), ['old problem']);
});

test('adapters switch is validated', () => {
  const c = clone();
  c.adapters = { 'context-graph': false };
  assert.deepEqual(validate(c), []);
  c.adapters = { 'no-such-tool': true };
  assert.match(validate(c).join(' '), /"adapters" must map adapter names/);
  c.adapters = { 'context-graph': 'yes' };
  assert.match(validate(c).join(' '), /"adapters" must map adapter names/);
});

test('the packages a command adds', () => {
  const cases = [
    ['pnpm install && pnpm test', []],
    ['npm ci', []],
    ['pnpm install --frozen-lockfile', []],
    ['npm i', []],
    ['npm install lodash', ['lodash']],
    ['npm install -D lodash@^4 @types/lodash', ['lodash', '@types/lodash']],
    ['npm i --save-dev @scope/pkg@1.2.3', ['@scope/pkg']],
    ['npm -w apps/api install zod', ['zod']],
    ['pnpm --filter office add lodash', ['lodash']],
    ['pnpm add -w zod', ['zod']],
    ['pnpm exec playwright install chromium', []],
    ['npx playwright install', []],
    ['yarn add react', ['react']],
    ['yarn workspace api add zod', ['zod']],
    ['yarn install', []],
    ['bun add hono', ['hono']],
    ['pip install requests', ['requests']],
    ['pip install -U "requests[socks]>=2.31"', ['requests']],
    ['python -m pip install httpx==0.27', ['httpx']],
    ['pip install -r requirements.txt', []],
    ['pip install -e .', []],
    ['pip install .', []],
    ['uv pip install rich', ['rich']],
    ['uv add httpx --group dev', ['httpx']],
    ['uv sync', []],
    ['poetry add pendulum@^2', ['pendulum']],
    ['cargo add serde --features derive', ['serde']],
    ['cargo build', []],
    ['go get github.com/x/y@v1.2.0', ['github.com/x/y']],
    ['go build ./...', []],
    ['bundle add rails --version 7', ['rails']],
    ['git bundle create repo.bundle', []],
    ['npm install lodash > out.log 2>&1', ['lodash']],
    ['cd apps/api; npm install zod', ['zod']],
    ['bash -c "npm install zod"', ['zod']],
    ['echo "write package.json before npm install; then commit" >> notes.md', []],
    ["git commit -m 'Run npm install lodash first'", []],
    ["cat > NOTES.md <<'EOF'\nnpm install lodash\nEOF", []],
    // What a throwaway container installs is the container's.
    ["docker run --rm python:3.12-slim bash -c 'pip install -q uv; uv sync --frozen'", []],
    ['podman run --rm node:22 npm install zod', []],
    ['docker run --rm node:22 true && npm install zod', ['zod']],
  ];
  for (const [cmd, want] of cases) assert.deepEqual(addedPackages(cmd), want, cmd);
});

test('dependency approvals and files', () => {
  assert.equal(dependencyApproval('lodash'), 'dep-lodash');
  assert.equal(dependencyApproval('@scope/pkg'), 'dep-@scope+pkg');
  assert.equal(dependencyApproval('github.com/x/y'), 'dep-github.com+x+y');
  assert.ok(isDependencyFile('apps/api/package.json'));
  assert.ok(isDependencyFile('pnpm-lock.yaml'));
  assert.ok(!isDependencyFile('apps/api/src/package.ts'));
});

test('approvals from chat and person-only commands are switches', () => {
  const c = structuredClone(fixture);
  c.approvals = { lead: 'yes' };
  c.shell.block[0].person = 'yes';
  const problems = validate(c).join(' ');
  assert.match(problems, /"approvals.lead" must be true or false/);
  assert.match(problems, /"shell.block" must be a list of \{ pattern, why, person\?, command\? \}/);
  c.approvals.lead = true;
  c.shell.block[0].person = true;
  assert.deepEqual(validate(c), []);
});

test('delegated dependency rule', async () => {
  const { dependencyRuleProblems, packageOf } = await import('../hooks/lib/registry.mjs');
  const rule = {
    licences: ['MIT', 'ISC'],
    minWeeklyDownloads: 10_000,
    maxMonthsSinceRelease: 18,
    allowInstallScripts: false,
  };
  const now = Date.parse('2026-10-04T00:00:00Z');
  const ok = {
    licence: 'MIT',
    weeklyDownloads: 20_000,
    lastRelease: '2026-09-01T00:00:00Z',
    installScripts: false,
  };
  assert.deepEqual(dependencyRuleProblems(ok, rule, now), []);
  assert.equal(dependencyRuleProblems({ ...ok, licence: 'GPL-3.0' }, rule, now).length, 1);
  assert.equal(dependencyRuleProblems({ ...ok, weeklyDownloads: 5 }, rule, now).length, 1);
  assert.equal(
    dependencyRuleProblems({ ...ok, lastRelease: '2024-01-01T00:00:00Z' }, rule, now).length,
    1,
  );
  assert.equal(dependencyRuleProblems({ ...ok, lastRelease: null }, rule, now).length, 1);
  assert.equal(dependencyRuleProblems({ ...ok, installScripts: true }, rule, now).length, 1);
  assert.deepEqual(
    dependencyRuleProblems(
      { ...ok, installScripts: true },
      { ...rule, allowInstallScripts: true },
      now,
    ),
    [],
  );
  assert.deepEqual(dependencyRuleProblems({ error: 'offline' }, rule, now), ['offline']);
  assert.equal(packageOf('dep-@scope+pkg'), '@scope/pkg');
});

test('approvals.delegate is validated, with defaults for the dependency rule', () => {
  const c = clone();
  c.approvals = { delegate: { protected: ['design'], dependencies: { minWeeklyDownloads: 500 } } };
  assert.deepEqual(validate(c), []);
  const d = withDefaults(c).approvals.delegate;
  assert.deepEqual(d.protected, ['design']);
  assert.equal(d.dependencies.minWeeklyDownloads, 500);
  assert.deepEqual(d.dependencies.licences, [
    'MIT',
    'Apache-2.0',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'ISC',
  ]);
  assert.equal(withDefaults(clone()).approvals.delegate, null);
  c.approvals = { delegate: { merge: true } };
  assert.deepEqual(validate(c), []);
  assert.equal(withDefaults(c).approvals.delegate.merge, true);
  c.approvals = { delegate: { merge: 'yes' } };
  assert.ok(validate(c).some((p) => p.includes('approvals.delegate')));
  c.approvals = { delegate: { protected: 'design' } };
  assert.ok(validate(c).some((p) => p.includes('approvals.delegate')));
  c.approvals = { delegate: { dependencies: { minWeeklyDownloads: -1 } } };
  assert.ok(validate(c).some((p) => p.includes('approvals.delegate')));
});

// The mod's drawing, with stand-ins for the elements $.ui.resolve gives it.
const el = {
  Box: (props) => ({ type: 'Box', props, children: props.children ?? [] }),
  Text: (props) => ({ type: 'Text', props, children: props.children ?? [] }),
  Button: (props) => ({ type: 'Button', props, children: [] }),
  Input: (props) => ({ type: 'Input', props, children: [] }),
};
const { board } = await import('../hooks/mod/board.mjs');
const pane = (state, extra = {}) =>
  board({ state, loop: null, needs: [], journal: [], now: 0, ...extra }, el, {});
const texts = (node) =>
  node.type === 'Text' ? node.children : node.children.flatMap((c) => texts(c));

test("the mod: CARD-4 and PANE-5, what the Lanes pane shows for the project's state", () => {
  assert.equal(parseJson('not json'), null);
  assert.deepEqual(projectState(null, null), { kind: 'none' });
  assert.deepEqual(projectState({ exists: false, valid: false, problems: [] }, null), {
    kind: 'none',
  });
  assert.deepEqual(texts(pane(projectState(null, null))), [NOT_CODE_KIT]);
  const invalid = projectState({ exists: true, valid: false, problems: ['x'] }, null);
  assert.deepEqual(texts(pane(invalid)), ['The config is invalid: run code-kit check.']);
  const check = {
    exists: true,
    valid: true,
    problems: [],
    lanes: { web: { agent: 'web-engineer', paths: ['apps/web/**'] } },
  };
  const ok = projectState(check, { problems: [] });
  assert.deepEqual(
    ok.lanes.map((l) => l.name),
    ['lead', 'web'],
  );
  const shown = texts(pane(ok));
  assert.ok(shown.includes('lead, web'));
  assert.ok(!shown.some((s) => s.includes('gap')));
  const gaps = texts(pane(projectState(check, { problems: ['ST-1 has no **Lane:**'] })));
  assert.ok(gaps.includes('The plan has 1 gap(s): run code-kit status.'));
});

test('the mod: PANE-2 a row per lane, with its story, branch and state, and PANE-3 what is ready', () => {
  const check = {
    exists: true,
    valid: true,
    problems: [],
    lanes: {
      web: { agent: 'web-engineer', paths: [] },
      api: { agent: 'api-engineer', paths: [] },
      core: { agent: 'core-engineer', paths: [] },
    },
  };
  const story = (id, lane, state, extra = {}) => ({
    id,
    title: `Story ${id}`,
    lane,
    state,
    branch: `${lane}/${id.toLowerCase()}`,
    waitingOn: [],
    ...extra,
  });
  const status = {
    problems: [],
    stories: [
      story('ST-4', 'web', 'review'),
      story('ST-5', 'core', 'blocked', { waitingOn: ['ST-4'] }),
      story('ST-6', 'lead', 'ready'),
      story('ST-7', 'lead', 'ready'),
      story('ST-9', 'core', 'ready'),
    ],
  };
  const next = { step: 'dispatch', args: 'ST-9', then: [{ step: 'lead', args: 'ST-6 ST-7' }] };
  const row = (s, name) => s.lanes.find((l) => l.name === name);
  // The web agent is still at work, so its commits are a build, not a finished branch.
  const working = projectState(check, status, next, new Set(['web-engineer']));
  assert.deepEqual(
    (({ agent, branch, state, active }) => ({ agent, branch, state, active }))(row(working, 'web')),
    { agent: 'web-engineer', branch: 'web/st-4', state: 'building', active: true },
  );
  assert.equal(row(working, 'web').story.id, 'ST-4');
  assert.equal(row(working, 'api').state, 'idle');
  assert.equal(row(working, 'core').state, 'blocked');
  // When it finishes, the same branch is waiting for review, and the active mark goes.
  const finished = projectState(check, status, next, new Set());
  assert.equal(row(finished, 'web').state, 'in review');
  assert.equal(row(finished, 'web').active, false);
  assert.deepEqual(
    finished.ready.map((r) => [r.id, r.lane]),
    [
      ['ST-9', 'core'],
      ['ST-6', 'lead'],
      ['ST-7', 'lead'],
    ],
  );
  const shown = texts(pane(finished));
  assert.ok(shown.includes('ST-4 Story ST-4'));
  assert.ok(shown.includes('◐ in review'));
  assert.ok(shown.includes('web/st-4 · web-engineer'));
  assert.ok(shown.includes("ready: ST-9 (core), ST-6 (the lead's own), ST-7 (the lead's own)"));
  // A blocked lane rests; selected, its story says what it waits on.
  const chosen = texts(pane(finished, { ui: { sel: { kind: 'lane', id: 'core' } } }));
  assert.ok(chosen.includes('waits on ST-4'));
  assert.deepEqual(
    [
      ...agentsAtWork([
        { type: 'web-engineer', status: 'running' },
        { type: 'x', status: 'completed' },
      ]),
    ],
    ['web-engineer'],
  );
});

test('CARD-2 open requests are counted as decisions: one per approval and lane, with every file it covers', () => {
  const asks = approvalAsks([
    {
      lane: 'platform',
      actor: 'platform-engineer (platform lane)',
      names: ['contract'],
      what: 'a.ts',
    },
    {
      lane: 'platform',
      actor: 'platform-engineer (platform lane)',
      names: ['contract'],
      what: 'b.ts',
    },
    { lane: 'domain', actor: 'domain-engineer (domain lane)', names: ['contract'], what: 'c.ts' },
    {
      lane: 'platform',
      actor: 'platform-engineer (platform lane)',
      names: ['contract'],
      what: 'a.ts',
    },
  ]);
  assert.equal(asks.length, 2);
  assert.deepEqual(asks[0].files, ['a.ts', 'b.ts']);
  assert.equal(
    askWords(asks[0].request, asks[0].files),
    'contract for the platform lane: a.ts, b.ts (2 files)',
  );
});

test('LOOP-9 the loop leaves out stories an agent is at work on, building or reviewing them', () => {
  const inFlight = storiesInFlight([
    { status: 'running', description: 'ST-10 capture pipeline' },
    { status: 'running', description: 'Review domain/st-78 (ST-78)' },
    { status: 'waiting', description: 'Security review platform/st-80' },
    { status: 'completed', description: 'ST-21 school calendars' },
  ]);
  assert.deepEqual([...inFlight].sort(), ['ST-10', 'ST-78', 'ST-80']);
  assert.deepEqual(
    withoutInFlight(
      { step: 'review', args: 'ST-10 ST-78 ST-21', then: [{ step: 'dispatch', args: 'ST-30' }] },
      inFlight,
    ),
    { step: 'review', args: 'ST-21', then: [{ step: 'dispatch', args: 'ST-30' }] },
  );
  assert.deepEqual(
    withoutInFlight(
      { step: 'review', args: 'ST-10', then: [{ step: 'dispatch', args: 'ST-80 ST-31' }] },
      inFlight,
    ),
    { step: 'dispatch', args: 'ST-31' },
  );
  const waiting = withoutInFlight({ step: 'review', args: 'ST-10 ST-78' }, inFlight);
  assert.equal(waiting.step, 'wait');
  assert.match(waiting.why, /ST-10, ST-78 are still with their agents/);
  assert.equal(leadPrompt(waiting), null);
  // A merge isn't a story's start: it goes ahead.
  assert.deepEqual(withoutInFlight({ step: 'merge', args: 'web/st-4' }, inFlight), {
    step: 'merge',
    args: 'web/st-4',
  });
  assert.deepEqual(withoutInFlight({ step: 'dispatch', args: 'ST-1' }, new Set()), {
    step: 'dispatch',
    args: 'ST-1',
  });
});

test("LOOP-11 the loop reads the lead's reply: what it left the build at, its question and options", () => {
  const prompt = outcomePrompt({
    prompt: 'Dispatch ST-9: run /code-kit:dispatch ST-9.',
    answer: 'Should ST-9 include GST?',
  });
  assert.match(prompt, /prompted you: "Dispatch ST-9/);
  assert.match(prompt, /Should ST-9 include GST\?/);
  assert.match(outcomePrompt({ answer: 'x' }), /The person prompted you/);
  assert.match(outcomePrompt({ answer: 'y'.repeat(5000) }), /\[… cut short\]/);
  assert.deepEqual(
    readOutcome(
      'Here it is:\n```json\n{"outcome":"needs-person","question":"Include GST?","options":[{"label":"Yes","effect":"GST shown"},{"label":"No"}],"reason":"a pricing rule"}\n```',
    ),
    {
      outcome: 'needs-person',
      question: 'Include GST?',
      options: [
        { label: 'Yes', effect: 'GST shown' },
        { label: 'No', effect: null },
      ],
      reason: 'a pricing rule',
      waits: [],
    },
  );
  // One option is no choice: the person answers in their own words.
  assert.deepEqual(
    readOutcome('{"outcome":"needs-person","question":"Q?","options":[{"label":"Only"}]}').options,
    [],
  );
  assert.equal(readOutcome('{"outcome":"maybe"}'), null);
  assert.equal(readOutcome('not a reading'), null);
  assert.equal(readOutcome('{"outcome":"done"}').question, null);
  assert.equal(
    answeredPrompt('Include GST?', 'Yes'),
    'The person answered what you asked ("Include GST?"): Yes. Carry on with it.',
  );
});

test('LOOP-14 the hold after a failed turn: the used-up windows reset, or 5 minutes doubling to an hour', () => {
  const now = Date.parse('2026-10-21T05:13:00Z');
  const limits = [
    { kind: 'five_hour', percentUsed: 100, resetsAt: '2026-10-21T08:00:00Z' },
    { kind: 'seven_day', percentUsed: 100, resetsAt: '2026-10-26T04:00:00Z' },
    { kind: 'spend_limit', percentUsed: 30, resetsAt: '2026-11-01T00:00:00Z' },
  ];
  assert.deepEqual(limitHold({ rateLimits: limits, now }), {
    until: Date.parse('2026-10-26T04:00:00Z'),
    why: 'limit',
  });
  // A reset already past, or a window not used up, doesn't hold it.
  const minute = 60 * 1000;
  assert.deepEqual(
    limitHold({ rateLimits: [{ ...limits[0], resetsAt: '2026-10-21T05:00:00Z' }], now }),
    {
      until: now + 5 * minute,
      why: 'error',
    },
  );
  assert.equal(limitHold({ rateLimits: [], now, failures: 2 }).until, now + 10 * minute);
  assert.equal(limitHold({ rateLimits: [], now, failures: 3 }).until, now + 20 * minute);
  assert.equal(limitHold({ rateLimits: [], now, failures: 9 }).until, now + 60 * minute);
});

test('LOOP-13 stories waiting on other work: read from the reply, watched, and left out of the step', () => {
  assert.match(outcomePrompt({ answer: 'x' }), /- waiting: the step isn't due yet/);
  assert.deepEqual(
    readOutcome(
      '{"outcome":"waiting","waits":[{"story":"st-158","on":["ST-164","nope"],"why":"merges with ST-164"},{"story":"later"}]}',
    ).waits,
    [{ story: 'ST-158', on: ['ST-164'], why: 'merges with ST-164' }],
  );
  const stories = [
    { id: 'ST-158', state: 'in review', branch: 'media/st-158' },
    { id: 'ST-164', state: 'in progress', branch: 'api/st-164', dependsOn: ['ST-158'] },
    { id: 'ST-170', state: 'done', branch: 'api/st-170', dependsOn: ['ST-158'] },
  ];
  // The stories it waits on, and the unfinished ones building on it.
  assert.deepEqual(parkWatch('ST-158', ['ST-175'], stories), ['ST-158', 'ST-175', 'ST-164']);
  const heads = new Map([
    ['media/st-158', 'm1'],
    ['api/st-164', 'a1'],
  ]);
  const before = storiesSignature(['ST-158', 'ST-164'], stories, heads, new Set());
  // The parked story's own commit or agent wakes it; a waited-on story's commits don't, its state does.
  const ownMoved = new Map([...heads, ['media/st-158', 'm2']]);
  assert.notEqual(storiesSignature(['ST-158', 'ST-164'], stories, ownMoved, new Set()), before);
  assert.notEqual(
    storiesSignature(['ST-158', 'ST-164'], stories, heads, new Set(['ST-158'])),
    before,
  );
  const otherMoved = new Map([...heads, ['api/st-164', 'a2']]);
  assert.equal(
    storiesSignature(['ST-158', 'ST-164'], stories, otherMoved, new Set(['ST-164'])),
    before,
  );
  const finished = stories.map((s) => (s.id === 'ST-164' ? { ...s, state: 'in review' } : s));
  assert.notEqual(storiesSignature(['ST-158', 'ST-164'], finished, heads, new Set()), before);
  assert.deepEqual(stepStories({ kind: 'review', target: 'ST-158 st-172' }), ['ST-158', 'ST-172']);
  assert.deepEqual(stepStories({ kind: 'merge', target: 'ST-158' }), []);
  const parked = new Map([['ST-158', { on: ['ST-164'] }]]);
  assert.deepEqual(withoutInFlight({ step: 'review', args: 'ST-158 ST-173' }, new Set(), parked), {
    step: 'review',
    args: 'ST-173',
  });
  const wait = withoutInFlight({ step: 'review', args: 'ST-158' }, new Set(), parked);
  assert.equal(wait.step, 'wait');
  assert.match(wait.why, /ST-158 waits on ST-164; the loop goes on when one moves/);
});

test('NOTIFY-1 only decisions new since the last look are notified, headed by what kind they are', async () => {
  const { newDecisions, decisionKey } = await import('../hooks/mod/decisions.mjs');
  const cards = [
    { kind: 'question', headline: 'Include GST?', story: { id: 'ST-9' } },
    { kind: 'held', headline: 'web wants to install dayjs', story: null },
    { kind: 'notice', headline: 'Merged web/st-4', story: null },
  ];
  assert.deepEqual(newDecisions(cards, new Set([decisionKey(cards[1])])), [
    {
      key: 'question|Include GST?',
      title: 'code-kit: the lead asks you',
      text: 'Include GST? (ST-9)',
    },
  ]);
  assert.deepEqual(newDecisions(cards, new Set(cards.map(decisionKey))), []);
});

test("LEAN-3 a milestone done is one whose every story is done, and the summary keeps what's in flight", () => {
  const stories = [
    { id: 'ST-1', milestone: 'M0', state: 'done' },
    { id: 'ST-2', milestone: 'M0', state: 'done' },
    { id: 'ST-3', milestone: 'M1', state: 'done' },
    { id: 'ST-4', milestone: 'M1', state: 'in review' },
    { id: 'ST-5', state: 'done' },
  ];
  assert.deepEqual(milestonesDone(stories), ['M0']);
  const said = compactInstructions('M0');
  assert.match(said, /^M0 is done/);
  assert.match(said, /every story in flight now/);
  assert.match(said, /Drop: the finished stories' details, lane reports/);
});

test('LEAN-4 to LEAN-5 the context a request carried, the wrap-up, and carrying a story on', () => {
  assert.equal(
    requestContext({
      input_tokens: 10,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 5,
      output_tokens: 99,
    }),
    215,
  );
  assert.equal(requestContext(null), 0);
  assert.match(wrapUpText(250000), /^Your context is past 250k tokens/);
  assert.match(wrapUpText(250000), /start your hand-back with "Not finished:"/);
  // Only a hand-back that says so is carried on; a finished one goes to review.
  assert.equal(unfinished('Not finished: the email is left.'), true);
  assert.equal(unfinished('  **Not finished:** the email is left.'), true);
  assert.equal(unfinished('ST-4 done: committed, checks and verify pass.'), false);
  assert.equal(unfinished('Done. Nothing is not finished.'), false);
  assert.match(compactInstructions(), /^The lead's context is compacted between turns/);
  assert.equal(
    continuePrompt({ type: 'api-engineer', story: 'ST-9', branch: 'api/st-9', cli: '/k.mjs' }),
    'api-engineer handed ST-9 back at its context limit, with its work committed on api/st-9. Carry the story on with a fresh agent: run node "/k.mjs" worktrees release api/st-9 (it keeps the commits and moves the report to the main checkout), then dispatch ST-9 again with the same brief, adding "Read your earlier report first: .claude/state/reports/api_st-9.md in the main checkout" and what node "/k.mjs" replay ST-9 --brief prints: /code-kit:dispatch ST-9',
  );
});

test('SCHED-3 a story runs on the model its size gives, raised for security, a fix and each send-back', async () => {
  const { storyModel } = await import('../hooks/lib/schedule.mjs');
  const m = (o) => {
    const r = storyModel(o);
    return `${r.model}: ${r.why}`;
  };
  assert.equal(m({ size: 'small' }), 'haiku: a small story');
  assert.equal(m({ size: 'medium' }), 'sonnet: a medium story');
  assert.equal(m({ size: 'large' }), 'opus: a large story');
  assert.equal(m({}), 'sonnet: no size in the plan');
  assert.equal(
    m({ size: 'small', security: true }),
    'opus: a small story, it cites a security requirement',
  );
  assert.equal(m({ size: 'large', security: true }), 'opus: a large story');
  assert.equal(
    m({ size: 'small', fix: true }),
    'sonnet: a small story, a fix proves its bug with a test',
  );
  assert.equal(m({ size: 'medium', fix: true }), 'sonnet: a medium story');
  assert.equal(m({ size: 'small', sentBack: 1 }), 'sonnet: a small story, sent back once');
  assert.equal(m({ size: 'small', sentBack: 2 }), 'opus: a small story, sent back twice');
  assert.equal(m({ size: 'small', sentBack: 5 }), 'opus: a small story, sent back 5 times');
  assert.equal(m({ size: 'large', sentBack: 1 }), 'opus: a large story');
  assert.equal(
    m({ size: 'small', fix: true, sentBack: 1 }),
    'opus: a small story, a fix proves its bug with a test, sent back once',
  );
  assert.equal(m({ size: 'small', fileModel: 'opus' }), "opus: its lane's agent file names opus");
  assert.equal(m({ size: 'small', fileModel: 'inherit' }), 'haiku: a small story');
  const lanes = { web: { agent: 'web-engineer' } };
  assert.equal(
    laneModel({ type: 'web-engineer', lanes, setting: 'story', story: 'haiku' }),
    'haiku',
  );
  assert.equal(laneModel({ type: 'web-engineer', lanes, setting: 'story' }), null);
  assert.equal(
    laneModel({ type: 'web-engineer', lanes, setting: 'story', model: 'opus', story: 'haiku' }),
    null,
  );
});

test("SET-4 a lane agent's model: the lead's choice, then its agent file's, then the setting", async () => {
  const { harnessProblems, harnessSettings } = await import('../hooks/lib/harness.mjs');
  const lanes = { web: { agent: 'web-engineer' }, api: { agent: 'api-engineer' } };
  assert.equal(laneModel({ type: 'web-engineer', lanes, setting: 'sonnet' }), 'sonnet');
  assert.equal(laneModel({ type: 'web-engineer', model: 'haiku', lanes, setting: 'sonnet' }), null);
  assert.equal(
    laneModel({ type: 'web-engineer', lanes, setting: 'sonnet', fileModel: 'opus' }),
    null,
  );
  assert.equal(
    laneModel({ type: 'web-engineer', lanes, setting: 'sonnet', fileModel: 'inherit' }),
    'sonnet',
  );
  assert.equal(laneModel({ type: 'security-reviewer', lanes, setting: 'sonnet' }), null);
  assert.equal(laneModel({ type: 'web-engineer', lanes, setting: null }), null);
  assert.equal(
    agentFileModel('---\nname: web\nmodel: "opus"\ntools: Read\n---\nmodel: haiku\n'),
    'opus',
  );
  assert.equal(agentFileModel('---\nname: web\n---\nmodel: haiku\n'), null);
  assert.equal(harnessSettings({}).agents.lanes.model, null);
  assert.equal(
    harnessSettings({ agents: { lanes: { model: 'sonnet' } } }).agents.lanes.model,
    'sonnet',
  );
  assert.match(
    harnessProblems({ agents: { lanes: { model: 3 } } })[0],
    /agents\.lanes\.model" must be a model/,
  );
});

test('LOOP-12 a design step is held once all its stories were handed to the lead', () => {
  const handed = new Set(['ST-21', 'ST-22']);
  assert.equal(designHandedOver({ step: 'design', args: 'ST-21 ST-22' }, handed), true);
  assert.equal(designHandedOver({ step: 'design', args: 'ST-22 ST-30' }, handed), false);
  assert.equal(designHandedOver({ step: 'dispatch', args: 'ST-21' }, handed), false);
});

test("LOOP-8 and WHO-4 a step the lead didn't take is a note in the band, not a decision", async () => {
  const { decisionCards } = await import('../hooks/mod/decisions.mjs');
  const check = { exists: true, valid: true, problems: [], lanes: {} };
  const state = projectState(check, { problems: [], stories: [] }, null, new Set());
  const loop = {
    state: 'running',
    proposal: { label: 'Design ST-21, ST-22', prompt: 'p', repeated: 3 },
  };
  const lines = bandLines({ state, requests: { open: [] }, stops: [], loop });
  const stuck = lines.find((l) => l.kind === 'stuck');
  assert.equal(stuck.text, 'Design ST-21, ST-22: still next after 3 prompts to the lead');
  assert.deepEqual(
    stuck.actions.map((a) => a.label),
    ['Ask again'],
  );
  assert.deepEqual(decisionCards(lines, { state }), []);
  // A lane stalled past its restarts, and a step the lead said it couldn't take, are notes too.
  const notes = bandLines({
    state,
    requests: { open: [] },
    stops: [],
    loop: {
      state: 'running',
      flagged: [{ lane: 'web', story: 'ST-4', count: 3 }],
      waiting: { kind: 'blocked', label: 'Review ST-4', reason: 'CI is down' },
    },
  });
  assert.deepEqual(decisionCards(notes, { state }), []);
  assert.ok(
    notes.some((l) => l.text === 'web stalled 3 times on ST-4: the lead decides how it goes on'),
  );
  const { nativeChoice } = await import('../hooks/mod/decisions.mjs');
  // What the person stopped, or a reply with no question in it, isn't asked over their typing.
  for (const waiting of [{ kind: 'stopped' }, { kind: 'person', reason: 'r' }]) {
    const [c] = decisionCards(
      bandLines({ state, requests: { open: [] }, stops: [], loop: { state: 'running', waiting } }),
      { state },
    );
    assert.equal(nativeChoice(c), null);
  }
  // An approval needs a reason typed in its pane: never the dialog.
  const [approval] = decisionCards(
    bandLines({
      state,
      requests: { open: [{ lane: 'web', names: ['dep-x'], what: 'npm install x' }] },
      stops: [],
    }),
    { state },
  );
  assert.equal(nativeChoice(approval), null);
});

test('the mod: BAND-2 and BAND-4, the band lines and their hotkeys, and ACT-1 the prefilled reason', () => {
  const check = {
    exists: true,
    valid: true,
    problems: [],
    lanes: { web: { agent: 'web-engineer' } },
  };
  const status = {
    problems: [],
    stories: [{ id: 'ST-4', title: 'Form', lane: 'web', state: 'review', branch: 'web/st-4' }],
  };
  const request = { lane: 'web', names: ['dep-@scope+pkg'], what: 'npm install @scope/pkg' };
  assert.equal(
    prefilledReason(request),
    'Approve @scope/pkg for the web lane: npm install @scope/pkg',
  );
  const quiet = projectState(check, { problems: [], stories: [] }, null, new Set());
  assert.deepEqual(bandLines({ state: quiet, requests: { open: [] }, stops: [] }), []);
  const lines = bandLines({
    state: projectState(check, status, null, new Set()),
    // Two files asked for under one approval are one decision; another approval is another.
    requests: {
      open: [
        request,
        { ...request, what: 'npm install @scope/pkg --save' },
        { lane: 'web', names: ['contract'], what: 'packages/contracts/a.ts' },
      ],
    },
    stops: [{ title: 'Check tests failed' }],
    // The person runs the build: a finished story waits in the band for them (DECIDE-1).
    check: { harness: { autonomy: 'off' } },
  });
  assert.deepEqual(
    lines.map((l) => l.text),
    ['2 approvals waiting', 'ST-4 ready for review', 'Finish check failing: Check tests failed'],
  );
  // While the loop runs the build, the review is the lead's and isn't in the band.
  assert.deepEqual(
    bandLines({
      state: projectState(check, status, null, new Set()),
      requests: { open: [] },
      stops: [],
    }).map((l) => l.text),
    [],
  );
  assert.deepEqual(
    lines.flatMap((l) => l.actions.map((a) => `${a.hotkey} ${a.id}`)),
    ['1 approve', '2 review', '3 merge', '4 lanes'],
  );
  assert.equal(bandLines({ state: null, notice: 'Nothing was approved: x' })[0].kind, 'notice');
});

test("the mod: ACT-1 a prefilled reason names the command itself, not the agent's pipes", () => {
  assert.equal(commandItself('npm install dayjs 2>&1 | tail -20'), 'npm install dayjs');
  assert.equal(commandItself('pnpm add zod && pnpm test'), 'pnpm add zod');
  assert.equal(commandItself('pip install requests > /dev/null'), 'pip install requests');
  assert.equal(commandItself('npm install dayjs'), 'npm install dayjs');
  assert.equal(
    prefilledReason({
      lane: null,
      names: ['dep-dayjs'],
      what: 'npm install dayjs 2>&1 | tail -20',
    }),
    'Approve dayjs for any agent: npm install dayjs',
  );
});

test('shell: the simple commands a command runs, apart from the text it carries', () => {
  assert.deepEqual(
    commandsOf('cd a && FOO=1 git commit -m "x; y" | tee log; (npm test)').map((c) => c.text),
    ['cd a', 'git commit -m "x; y"', 'tee log', 'npm test'],
  );
  assert.equal(
    withoutHeredocs("cat > f <<'EOF'\ngit push --force\nEOF\necho done"),
    "cat > f <<'EOF'\necho done",
  );
  assert.equal(withoutHeredocs('cat <<< "a <<EOF"\nnext'), 'cat <<< "a <<EOF"\nnext');
  assert.equal(runs('echo "git commit"', /^git\s+commit\b/), false);
  assert.equal(runs('x=$(git commit -m a)', /^git\s+commit\b/), true);
  assert.equal(runs('git commit -m "--no-verify"', /--no-verify/, { quoted: false }), false);
  assert.equal(runs('git commit --no-verify', /--no-verify/, { quoted: false }), true);
});

test("the mod: a sent-back story's lane reads as sent back, not idle", () => {
  const check = {
    exists: true,
    valid: true,
    problems: [],
    lanes: { web: { agent: 'web-engineer' } },
  };
  const status = {
    problems: [],
    stories: [
      {
        id: 'ST-2',
        title: 'Cancel',
        lane: 'web',
        state: 'sent back',
        branch: 'web/st-2',
        waitingOn: [],
      },
    ],
  };
  const web = projectState(check, status).lanes.find((l) => l.name === 'web');
  assert.equal(web.state, 'sent back');
  assert.equal(web.branch, 'web/st-2');
});

test("install scripts are told apart: a prebuilt binary, a native build, or the package's own code", async () => {
  const { dependencyRuleProblems, installScriptKind } = await import('../hooks/lib/registry.mjs');
  assert.equal(installScriptKind({ scripts: { test: 'x' } }), null);
  const esbuild = {
    scripts: { postinstall: 'node install.js' },
    optionalDependencies: { '@esbuild/darwin-arm64': '1', '@esbuild/linux-x64': '1' },
  };
  assert.equal(installScriptKind(esbuild), 'binary');
  assert.equal(
    installScriptKind({ scripts: { install: 'prebuild-install || node-gyp rebuild' } }),
    'binary',
  );
  assert.equal(installScriptKind({ scripts: { install: 'node-gyp rebuild' } }), 'build');
  assert.equal(installScriptKind({ scripts: { postinstall: 'node ./telemetry.js' } }), 'other');
  const rule = {
    licences: ['MIT'],
    minWeeklyDownloads: 0,
    maxMonthsSinceRelease: 99,
    allowInstallScripts: ['binary'],
  };
  const facts = (kind) => ({
    licence: 'MIT',
    weeklyDownloads: 1,
    lastRelease: new Date().toISOString(),
    installScripts: true,
    installScriptKind: kind,
  });
  assert.deepEqual(dependencyRuleProblems(facts('binary'), rule), []);
  assert.deepEqual(dependencyRuleProblems(facts('other'), rule), [
    'installing it runs a script that runs its own code',
  ]);
  assert.deepEqual(
    dependencyRuleProblems(facts('build'), { ...rule, allowInstallScripts: true }),
    [],
  );
  const c = clone();
  c.approvals = { delegate: { dependencies: { allowInstallScripts: ['binary', 'build'] } } };
  assert.deepEqual(validate(c), []);
  c.approvals.delegate.dependencies.allowInstallScripts = ['everything'];
  assert.match(validate(c).join(' '), /allowInstallScripts/);
});

test('a path under a top-level folder that does not exist keeps its whole name', async () => {
  const { realPath } = await import('../hooks/lib/rules.mjs');
  // /private exists on macOS only: on Linux its first letter was cut off.
  assert.equal(realPath('/no-such-top-folder/claude-1/x.py'), '/no-such-top-folder/claude-1/x.py');
});

test('files any agent may write have a reviewer: the lead, or the lane an entry names', async () => {
  const { reviewerOf } = await import('../hooks/lib/rules.mjs');
  const c = clone();
  c.anyActor = ['pnpm-lock.yaml', { glob: 'supabase/seed.sql', reviewer: 'data' }];
  assert.deepEqual(validate(c), []);
  const config = withDefaults(c);
  assert.ok(config.anyActor.includes('supabase/seed.sql'));
  assert.equal(reviewerOf('pnpm-lock.yaml', config), 'lead');
  assert.equal(reviewerOf('supabase/seed.sql', config), 'data');
  assert.equal(reviewerOf('apps/office/x.ts', config), null);
  c.anyActor = [{ glob: 'x', reviewer: 'nobody-lane' }];
  assert.match(validate(c).join(' '), /"anyActor"/);
});

test('HOLD-1 and HELM-6 a protected file refused at commit is holdable, one the lead decides is not, and results are read in every shape', async () => {
  const { holdable, resultText } = await import('../hooks/mod/hold.mjs');
  const refusal =
    'PreToolUse:Bash hook error: Blocked: design/approved-screens.json is the register of approved designs; committing it needs a person\'s approval in force. Ask the lead to run\n  ! echo "<what you are approving>" > .claude/approvals/web/design\n(a person runs it; …)';
  assert.deepEqual(holdable(refusal), {
    kind: 'approval',
    title: 'Commit refused: design/approved-screens.json',
    names: ['design'],
    lane: 'web',
    what: 'commit design/approved-screens.json',
    by: 'person',
  });
  // HELM-6: what the lead decides is never held for the person.
  const forLead =
    'PreToolUse:Bash hook error: Blocked: a new dependency (dayjs) is the lead\'s decision. The lead decides this, not the person. Hand the lead a change request and stop: the package, …\n  Decided by the lead: node "/x/bin/code-kit.mjs" approve dep-dayjs --lane web --delegated --story <ST-n> --reason "<…>"\nCommand: npm install dayjs';
  assert.equal(holdable(forLead), null);
  const { refusalCard } = await import('../hooks/mod/view.mjs');
  assert.deepEqual(refusalCard(forLead).request, {
    names: ['dep-dayjs'],
    lane: 'web',
    what: 'npm install dayjs',
    by: 'lead',
  });
  assert.match(refusalCard(forLead).todo, /The lead decides it on its merits/);
  assert.equal(resultText({ deny: 'x' }), 'x');
  assert.equal(resultText({ isError: true, text: 'y', result: 'z' }), 'y');
  assert.equal(resultText({ result: 'Error: PreToolUse' }), 'Error: PreToolUse');
  assert.equal(resultText({ result: { stdout: '' } }), '');
  assert.equal(holdable('some other failure'), null);
});

test('SCHED-1 and SCHED-2 one story per free lane, the open slice first, then the next, then ahead', async () => {
  const { pickPerLane, slicesOf } = await import('../hooks/lib/schedule.mjs');
  const st = (id, lane, state, slice) => ({ id, lane, state, slice: slice ?? null });
  const stories = [
    st('ST-1', 'api', 'done', 'Book a class'),
    st('ST-2', 'api', 'ready', 'Book a class'),
    st('ST-3', 'web', 'review', 'Book a class'),
    st('ST-4', 'web', 'ready', 'Pay for a class'),
    st('ST-5', 'web', 'ready', 'Pay for a class'),
    st('ST-6', 'mobile', 'ready', 'Pay for a class'),
    st('ST-7', 'api', 'ready', 'Pay for a class'),
  ];
  assert.deepEqual(
    slicesOf(stories).map((s) => [s.name, s.open, s.done]),
    [
      ['Book a class', true, false],
      ['Pay for a class', false, false],
    ],
  );
  const ready = ['ST-2', 'ST-4', 'ST-5', 'ST-6', 'ST-7'];
  const one = pickPerLane(stories, { ready, open: 1 });
  // The api lane takes the open slice's story before the next slice's; web and mobile have none in it.
  assert.deepEqual(one.pick, ['ST-2', 'ST-4', 'ST-6']);
  assert.deepEqual(one.ahead, [
    { id: 'ST-4', slice: 'Pay for a class' },
    { id: 'ST-6', slice: 'Pay for a class' },
  ]);
  assert.deepEqual(one.waiting, ['ST-5', 'ST-7']);
  // With room for a second slice, the next one opens instead of being ahead.
  const two = pickPerLane(stories, { ready, open: 2 });
  assert.deepEqual(two.ahead, []);
  assert.deepEqual(two.opened, ['Pay for a class']);
  // A busy lane takes nothing; a sent-back story goes first in its lane.
  const busy = pickPerLane(stories, {
    ready,
    fixes: ['ST-3'],
    busy: new Set(['api']),
    open: 1,
  });
  assert.deepEqual(busy.pick, ['ST-3', 'ST-6']);
});

test('SET-1 the harness settings: defaults, validation and typed values', async () => {
  const { harnessSettings, harnessProblems, parseSetting } =
    await import('../hooks/lib/harness.mjs');
  assert.deepEqual(harnessSettings(undefined), {
    autonomy: 'autonomous',
    hold: { minutes: 2 },
    stall: { nudgeMinutes: 5, restartMinutes: 10, maxRestarts: 2 },
    agents: {
      reviewer: { on: false, model: 'sonnet' },
      lanes: { model: null, contextLimit: 250000 },
    },
    slices: { open: 1 },
    background: { pauseAtPercent: 80 },
    compact: { at: 40, milestone: 'ask' },
    notify: { on: true },
    motion: 'while-active',
    report: { on: false },
  });
  assert.match(
    harnessProblems({ compact: { milestone: 'sometimes' } }).join(' '),
    /ask, auto, off/,
  );
  // UI-12: the characters, clocks and rail move while work flows, or stay still.
  assert.equal(harnessSettings({ motion: 'off' }).motion, 'off');
  assert.match(harnessProblems({ motion: 'always' }).join(' '), /while-active, off/);
  assert.equal(
    harnessSettings({ autonomy: 'propose', stall: { nudgeMinutes: 3 } }).stall.nudgeMinutes,
    3,
  );
  const wrong = harnessSettings({ autonomy: 'always', hold: { minutes: 90 } });
  assert.equal(wrong.autonomy, 'autonomous');
  assert.equal(wrong.hold.minutes, 2);
  assert.equal(harnessSettings('yes').autonomy, 'autonomous');
  assert.deepEqual(harnessProblems(undefined), []);
  assert.deepEqual(
    harnessProblems({ autonomy: 'propose', agents: { reviewer: { on: true, model: 'sonnet' } } }),
    [],
  );
  const bad = harnessProblems({
    autonomy: 'yolo',
    hold: { minutes: 90 },
    stall: { nudgeMinutes: 10, restartMinutes: 5 },
    colour: 'red',
  });
  for (const text of [
    'harness.autonomy',
    'harness.hold.minutes',
    'harness.colour',
    'restartMinutes" must be more than',
  ])
    assert.ok(
      bad.some((p) => p.includes(text)),
      `${text} in ${bad.join(' / ')}`,
    );
  const c = clone();
  c.harness = { autonomy: 'nope' };
  assert.match(validate(c).join(' '), /harness\.autonomy/);
  assert.equal(parseSetting('hold.minutes', '5'), 5);
  assert.equal(parseSetting('agents.reviewer.on', 'true'), true);
  assert.equal(parseSetting('agents.reviewer.model', 'null'), null);
  assert.equal(parseSetting('autonomy', 'propose'), 'propose');
  assert.equal(withDefaults(clone()).harness.autonomy, 'autonomous');
});

test('SET-2 the settings view: a control per setting, a model id kept, and the confirmation once one changes', () => {
  const el = (type) => (props) => ({ type, props, children: props.children ?? [] });
  const els = {
    Box: el('Box'),
    Text: el('Text'),
    Select: el('Select'),
    Input: el('Input'),
    Button: el('Button'),
  };
  const all = (n) => [
    n,
    ...(n.children ?? []).flatMap((c) => (c && typeof c === 'object' ? all(c) : [])),
  ];
  const rows = [
    { key: 'autonomy', value: 'off', default: 'autonomous', about: 'a' },
    { key: 'hold.minutes', value: 2, default: 2, about: 'b' },
    { key: 'agents.reviewer.model', value: 'claude-haiku-4-5', default: null, about: 'c' },
  ];
  const h = { onChoose() {}, onReason() {}, onConfirm() {}, onCancel() {} };
  const quiet = all(settingsView(rows, null, els, h));
  assert.equal(quiet.find((n) => n.props.key === 'set-autonomy').type, 'Select');
  assert.equal(quiet.find((n) => n.props.key === 'set-hold.minutes').type, 'Input');
  const model = quiet.find((n) => n.props.key === 'set-agents.reviewer.model');
  assert.ok(model.props.options.some((o) => o.value === 'claude-haiku-4-5'));
  assert.ok(quiet.some((n) => n.type === 'Text' && n.children.includes('default autonomous')));
  assert.ok(!quiet.some((n) => n.props.key === 'settings-confirm'));
  const asking = all(
    settingsView(rows, { key: 'hold.minutes', value: '5', reason: '', error: null }, els, h),
  );
  assert.ok(asking.some((n) => n.type === 'Text' && n.children.includes('Set hold.minutes to 5?')));
  assert.ok(asking.some((n) => n.props.key === 'settings-reason'));
});

test('USE-1 to USE-4 usage: attribution, the roll-up, outliers and the plan', () => {
  const check = { lanes: { web: { agent: 'web-engineer' }, api: { agent: 'api-engineer' } } };
  const state = {
    kind: 'ok',
    lanes: [
      { name: 'lead', state: 'building', story: { id: 'ST-6' } },
      { name: 'web', state: 'building', story: { id: 'ST-4' } },
      { name: 'api', state: 'in review', story: { id: 'ST-3' } },
    ],
    stories: [
      { id: 'ST-1', state: 'done' },
      { id: 'ST-2', state: 'done' },
    ],
  };
  assert.deepEqual(attribution(undefined, null, check, state), {
    key: 'lead',
    lane: 'lead',
    story: 'ST-6',
    background: false,
  });
  const web = { id: 'a1', type: 'web-engineer', description: 'Fix the form' };
  assert.equal(attribution('a1', web, check, state).story, 'ST-4');
  assert.equal(attribution('a1', { ...web, description: 'ST-9 next' }, check, state).story, 'ST-9');
  assert.equal(
    attribution('r1', { id: 'r1', type: 'reviewer', description: 'x' }, check, state).background,
    true,
  );
  assert.equal(attribution('gone', null, check, state).background, true);

  const k = (n) => ({
    input_tokens: n * 400,
    cache_creation_input_tokens: n * 100,
    output_tokens: n * 100,
    cache_read_input_tokens: n * 400,
  });
  let ledger = {};
  const as = (story, lane = 'api') => ({ key: story, lane, story, background: false });
  ledger = withUsage(ledger, as('ST-1'), k(190));
  ledger = withUsage(ledger, as('ST-2'), k(200));
  ledger = withUsage(ledger, as('ST-3'), k(210));
  ledger = withUsage(ledger, as('ST-4', 'web'), k(300));
  ledger = withUsage(ledger, as('ST-4', 'web'), k(400));
  ledger = withUsage(ledger, { key: 'r1', lane: null, story: null, background: true }, k(100));
  assert.deepEqual(ledger['ST-4|ST-4'].output, 70000);
  const finished = finishedStories(state);
  assert.deepEqual([...finished].sort(), ['ST-1', 'ST-2', 'ST-3']);
  const sum = usageSummary(ledger, finished);
  assert.equal(sum.lanes.web, 700000);
  assert.equal(sum.lanes.api, 600000);
  assert.equal(sum.background, 100000);
  assert.equal(sum.total, 1400000);
  assert.deepEqual(sum.outliers, [{ id: 'ST-4', ratio: 3.5 }]);
  assert.deepEqual(usageSummary(ledger, new Set(['ST-1', 'ST-2'])).outliers, []);

  assert.deepEqual(
    planOf([
      { kind: 'seven_day', percentUsed: 90 },
      { kind: 'five_hour', percentUsed: 81 },
    ]),
    { percent: 81, paused: true },
  );
  assert.deepEqual(planOf([{ kind: 'five_hour', percentUsed: 80 }]), {
    percent: 80,
    paused: false,
  });
  assert.deepEqual(planOf([{ kind: 'five_hour', percentUsed: 85 }], 90), {
    percent: 85,
    paused: false,
  });
  assert.deepEqual(planOf([]), { percent: null, paused: false });
  assert.deepEqual([tokens(950), tokens(12400), tokens(1400000)], ['950', '12k', '1.4M']);
  assert.equal(planBar(62), '██████░░░░');
});

test('LOOP-1 to LOOP-3 the loop: prompts for steps, and what a quiet agent is due', async () => {
  const { stepKey, stepLabel, stallDue } = await import('../hooks/mod/loop.mjs');
  assert.equal(
    leadPrompt({ step: 'dispatch', args: 'ST-7 ST-9' }),
    'Dispatch ST-7, ST-9: run /code-kit:dispatch ST-7 ST-9.',
  );
  // HELM-4: a lane waiting on the lead's decision.
  assert.equal(
    leadPrompt({
      step: 'decide',
      args: '2',
      why: 'The api lane asks for pillow: yours to decide.',
    }),
    'The api lane asks for pillow: yours to decide. Run /code-kit:decide 2.',
  );
  assert.equal(stepLabel({ step: 'decide', args: '2 3' }), 'Decide requests 2, 3');
  // ONB-8: code-kit's instructions behind, merged by hand or written.
  assert.match(
    leadPrompt({
      step: 'instructions',
      args: 'merge',
      why: "code-kit's instructions in CLAUDE.md are behind.",
    }),
    /^code-kit's instructions in CLAUDE\.md are behind\. Run node "code-kit" instructions to see which files, then merge each one: .* Commit the change on a branch/,
  );
  assert.match(
    leadPrompt({ step: 'instructions', args: 'write', why: 'Behind.' }),
    /^Behind\. Run node "code-kit" instructions --write\. Commit/,
  );
  assert.equal(
    leadPrompt({ step: 'review', args: 'ST-4' }),
    'Review ST-4: run /code-kit:review ST-4.',
  );
  assert.equal(
    leadPrompt({ step: 'review', args: 'ST-4 ST-5' }),
    'Review ST-4, ST-5: run /code-kit:review.',
  );
  assert.match(leadPrompt({ step: 'lead', args: 'ST-6' }), /^Build ST-6 yourself.*lead\/st-6/);
  // ONB-6: an older setup is brought up to date by init before the next story.
  assert.match(
    leadPrompt({ step: 'update', args: '', why: 'Missing a QA lane.' }),
    /^Before the next story, bring code-kit's setup up to date: run \/code-kit:init\. Missing a QA lane\.$/,
  );
  assert.equal(stepLabel({ step: 'update', args: '' }), 'Update the setup');
  for (const step of ['spec-design', 'init', 'wait', 'done'])
    assert.equal(leadPrompt({ step }), null);
  assert.equal(
    leadPrompt({ step: 'merge', args: 'web/st-4' }, { cli: '/k/bin/code-kit.mjs' }).split(':')[0],
    'Merge web/st-4, next in the merge queue',
  );
  // SETUP-2: the base has no rules yet; the lead puts them there.
  assert.match(
    leadPrompt({ step: 'rules', args: 'main' }, { cli: '/k/bin/code-kit.mjs' }),
    /^Put code-kit's approved rules onto main: run node "\/k\/bin\/code-kit.mjs" queue rules\./,
  );
  assert.equal(stepLabel({ step: 'rules', args: 'main' }), 'Rules onto main');
  // ONB-2, ONB-3: designs before screens, and a companion set up before any coding.
  assert.equal(
    leadPrompt({ step: 'design', args: 'ST-1 ST-5' }),
    'Design ST-1, ST-5 before any of their screens are built: run /code-kit:design ST-1 ST-5.',
  );
  assert.match(
    leadPrompt({ step: 'setup', args: 'context-graph:init', why: 'It has no graph yet.' }),
    /^Before any code is written, set up context-graph: run \/context-graph:init\. It has no graph yet\.$/,
  );
  assert.equal(stepLabel({ step: 'design', args: 'ST-1' }), 'Design ST-1');
  assert.ok(!leadPrompt({ step: 'dispatch', args: 'ST-1' }).startsWith('/'));
  assert.equal(stepKey({ step: 'dispatch', args: 'ST-1' }), 'dispatch:ST-1');
  assert.equal(stepLabel({ step: 'dispatch', args: 'ST-7 ST-9' }), 'Dispatch ST-7, ST-9');
  const stall = { nudgeMinutes: 5, restartMinutes: 10, maxRestarts: 2 };
  const fresh = { nudged: false, stopped: false };
  assert.equal(stallDue(4 * 60000, fresh, 0, stall), null);
  assert.equal(stallDue(5 * 60000, fresh, 0, stall), 'nudge');
  assert.equal(stallDue(6 * 60000, { ...fresh, nudged: true }, 0, stall), null);
  assert.equal(stallDue(10 * 60000, { ...fresh, nudged: true }, 1, stall), 'restart');
  assert.equal(stallDue(10 * 60000, { ...fresh, nudged: true }, 2, stall), 'flag');
  assert.equal(stallDue(30 * 60000, { nudged: true, stopped: true }, 2, stall), null);
});

test("REVW-3 the reviewer's report: graded findings, a failed verify a blocker, and reports that don't read", async () => {
  const { readReport, withVerify, findingsCount, leadReviewPrompt } =
    await import('../hooks/mod/review.mjs');
  const block = (o) => `Done.\n\`\`\`json\n${JSON.stringify(o)}\n\`\`\``;
  const read = readReport(
    block({
      verify: { passed: false, problems: ['lane: apps/api/x.ts'] },
      findings: [
        { severity: 'concern', where: 'a.ts:1', text: 'x', rule: 'REQ-1' },
        { severity: 'urgent', text: 'not a severity' },
      ],
    }),
  );
  assert.deepEqual(read.findings, [
    { severity: 'blocker', text: 'verify: lane: apps/api/x.ts', rule: 'code-kit verify' },
    { severity: 'concern', text: 'x', where: 'a.ts:1', rule: 'REQ-1' },
  ]);
  assert.match(readReport('No block at all.').error, /no findings block/);
  assert.match(readReport('```json\n{nope\n```').error, /isn't valid JSON/);
  const named = [{ severity: 'blocker', text: 'verify fails: lane: apps/api/x.ts' }];
  assert.equal(withVerify(named, { passed: false, problems: ['lane: apps/api/x.ts'] }).length, 1);
  assert.equal(withVerify([], { passed: true, problems: [] }).length, 0);
  assert.equal(findingsCount(read.findings), '1 blocker, 1 concern');
  assert.equal(findingsCount([]), 'no findings');
  assert.match(
    leadReviewPrompt('ST-4', {
      state: 'done',
      branch: 'web/st-4',
      head: 'abcdef1234567890',
      findings: [],
    }),
    /found nothing to fix on web\/st-4 at abcdef123456\.$/,
  );
});

test("VIEW-4, UI-8 liveness and the selected lane's acts", async () => {
  const { laneActions, toolLine, liveLevel } = await import('../hooks/mod/panes.mjs');
  const state = {
    kind: 'ok',
    lanes: [
      { name: 'lead', state: 'idle', story: null, branch: null },
      {
        name: 'web',
        state: 'building',
        story: { id: 'ST-4' },
        branch: 'web/st-4',
        active: true,
        agent: 'web-engineer',
      },
      { name: 'api', state: 'in review', story: { id: 'ST-5' }, branch: 'api/st-5' },
      { name: 'core', state: 'in review', story: { id: 'ST-6' }, branch: 'core/st-6' },
    ],
    ready: [{ id: 'ST-9' }],
    stories: [{ id: 'ST-1', state: 'done' }],
  };
  const queue = [{ branch: 'core/st-6', state: 'waiting' }];
  const ids = (lane, extra) =>
    laneActions(lane, { queue, ...extra }).map((a) => `${a.hotkey}:${a.id}`);
  assert.deepEqual(ids(state.lanes[1]), ['w:watch', 'n:nudge', 'x:stop']);
  assert.deepEqual(ids(state.lanes[2]), ['r:review', 's:sendBack']);
  assert.deepEqual(ids(state.lanes[3]), ['m:merge']);
  assert.deepEqual(ids(state.lanes[1], { held: [{ lane: 'web' }] }), [
    'a:approve',
    'w:watch',
    'n:nudge',
    'x:stop',
  ]);
  assert.equal(
    toolLine({ tool: 'Bash', command: 'npm test -- --watch=false\nmore' }),
    'Bash npm test -- --watch=false',
  );
  assert.equal(toolLine({ tool: 'Edit', file_path: 'apps/web/a.ts' }), 'Edit apps/web/a.ts');
  assert.equal(toolLine({ tool: 'Bash', command: 'x'.repeat(60) }).length, 45);
  assert.equal(toolLine({ tool: 'TodoWrite' }), 'TodoWrite');
  const stall = { nudgeMinutes: 5, restartMinutes: 10 };
  assert.equal(liveLevel(4 * 60000, stall), null);
  assert.equal(liveLevel(5 * 60000, stall), 'quiet');
  assert.equal(liveLevel(10 * 60000, stall), 'stalled');
  assert.equal(liveLevel(20 * 60000, stall, { running: true }), null);
  assert.equal(liveLevel(0, stall, { flagged: true }), 'stalled');
});

test('VIEW-7 the drill-down: a diff per file, the spec-check table, and Escape going back', async () => {
  const { fileDiffs } = await import('../hooks/mod/panes.mjs');
  const { escapeGoesBack } = await import('../hooks/mod/board.mjs');
  const { specCheckRows } = await import('../hooks/lib/plan.mjs');
  const diff = [
    'diff --git a/a.ts b/a.ts',
    'new file mode 100644',
    'index 0000000..1111111',
    '--- /dev/null',
    '+++ b/a.ts',
    '@@ -0,0 +1 @@',
    '+a',
    'diff --git a/logo.png b/logo.png',
    'Binary files a/logo.png and b/logo.png differ',
    'diff --git a/old.ts b/old.ts',
    'deleted file mode 100644',
    '--- a/old.ts',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-gone',
    '',
  ].join('\n');
  assert.deepEqual(fileDiffs(diff), [
    { path: 'a.ts', source: '--- /dev/null\n+++ b/a.ts\n@@ -0,0 +1 @@\n+a\n' },
    { path: 'old.ts', source: '--- a/old.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone\n' },
  ]);
  assert.deepEqual(fileDiffs(''), []);
  assert.deepEqual(
    specCheckRows(
      '# Report\n\n| Requirement | Status (done / partial / missing / conflicts) | Where | Note |\n|---|---|---|---|\n| BOOK-1 Request | Partial | src/a.ts | no test |\n| BOOK-2 | missing | | |\n\nQuestions follow.',
    ),
    [
      { requirement: 'BOOK-1', status: 'partial', where: 'src/a.ts', note: 'no test' },
      { requirement: 'BOOK-2', status: 'missing', where: '', note: '' },
    ],
  );
  assert.deepEqual(specCheckRows('no table'), []);
  // UI-6: Escape on a full view goes back to the panels; on the panels, it closes the pane.
  const person = { id: 'lanes', origin: { kind: 'person' } };
  assert.equal(escapeGoesBack(person, 'lanes', { view: 'story' }), true);
  assert.equal(escapeGoesBack(person, 'lanes', { view: 'trail' }), true);
  assert.equal(escapeGoesBack(person, 'lanes', { view: null }), false);
  assert.equal(
    escapeGoesBack({ ...person, origin: { kind: 'plugin' } }, 'lanes', { view: 'story' }),
    false,
  );
});

test('TRACE-1 and TRACE-4 the map: cell states, rows by spec, the legend, moving, and a glyph per state', async () => {
  const { CELL, cellOf, mapRows, mapLegend, moveCell } = await import('../hooks/mod/panes.mjs');
  const glyphs = Object.values(CELL).map((c) => c.glyph);
  assert.equal(new Set(glyphs).size, glyphs.length);
  const reqs = [
    { id: 'A-1', file: 'a.md', state: 'done', tests: ['t'] },
    { id: 'A-2', file: 'a.md', state: 'done', tests: [] },
    { id: 'B-1', file: 'b.md', state: 'no story', tests: [] },
    { id: 'B-2', file: 'b.md', state: 'removed', tests: [] },
  ];
  assert.deepEqual(reqs.map(cellOf), ['tested', 'done', 'no story', 'removed']);
  assert.deepEqual(
    mapRows(reqs).map((r) => `${r.spec}:${r.requirements.map((x) => x.id).join('+')}`),
    ['a.md:A-1+A-2', 'b.md:B-1+B-2'],
  );
  assert.deepEqual(
    mapLegend(reqs).map((c) => `${c.n} ${c.words}`),
    ['1 done and tested', '1 done, untested', '1 without a story', '1 removed'],
  );
  assert.equal(moveCell(reqs, 'A-2', 1), 'B-1');
  assert.equal(moveCell(reqs, 'A-1', -1), 'B-2');
  assert.equal(moveCell(reqs, 'A-2', 1, { rows: true }), 'B-1');
  assert.equal(moveCell(reqs, 'B-2', 1, { rows: true }), 'A-1');
  assert.equal(moveCell([], 'A-1', 1), null);
});

test('VIEW-2 and UI-11 the pictures: raster cells, poses, bars and their runs', async () => {
  const { rasterCells, barCells, runs, axisStart } = await import('../hooks/mod/art.mjs');
  const { poseFor } = await import('../hooks/mod/board.mjs');
  // Two pixels a cell: a half block coloured top over bottom, the terminal's default where empty.
  const grid = [
    [0xff0000, null],
    [0x00ff00, null],
  ];
  const words = new Uint32Array([0x2580, 0xff0000, 0x00ff00, 0x20, 0x01000000, 0x01000000]);
  assert.equal(rasterCells(grid), Buffer.from(words.buffer).toString('base64'));
  const half = [[null], [0x0000ff]];
  assert.equal(
    rasterCells(half),
    Buffer.from(new Uint32Array([0x2584, 0x0000ff, 0x01000000]).buffer).toString('base64'),
  );
  // UI-11: a lane's pose is the kind of work its agent's tool is, else its state.
  const lane = { name: 'web', state: 'building', active: true };
  assert.equal(poseFor(lane, { live: { tool: 'Bash npm test' } }), 'running');
  assert.equal(poseFor(lane, { live: { tool: 'Edit apps/web/a.ts' } }), 'writing');
  assert.equal(poseFor(lane, { live: { tool: 'Grep booking' } }), 'reading');
  assert.equal(poseFor(lane), 'thinking');
  assert.equal(poseFor(lane, { waiting: true }), 'waiting');
  assert.equal(poseFor(lane, { live: { level: 'quiet', tool: 'Bash x' } }), 'quiet');
  assert.equal(poseFor(lane, { stalled: true }), 'stalled');
  assert.equal(poseFor({ ...lane, active: false, state: 'in review' }), 'resting');
  const now = 100 * 60000;
  const t = {
    state: 'review',
    started: now - 40 * 60000,
    lastCommit: now - 5 * 60000,
    merged: null,
    sentBack: [now - 20 * 60000],
    approvals: [{ at: now - 30 * 60000 }],
  };
  const start = axisStart([t], now);
  assert.equal(start, now - 40 * 60000);
  const cells = barCells(t, { start, now, width: 40 });
  assert.deepEqual(
    runs(cells).map((r) => `${r.kind}:${r.n}`),
    ['building:10', 'approval:1', 'building:9', 'sentBack:1', 'building:14', 'review:5'],
  );
  const merged = barCells(
    { ...t, state: 'done', merged: now - 2 * 60000 },
    { start, now, width: 40 },
  );
  assert.equal(merged[38], 'merged');
  assert.equal(merged[39], 'none');
  assert.equal(axisStart([], now), now - 3600000);
});

test('shell: a newline inside quotes ends no command', async () => {
  const { commandsOf } = await import('../hooks/lib/shell.mjs');
  assert.deepEqual(
    commandsOf('git commit -m "Notes\nctx drop src.small is the person\'s"\nnpm test').map(
      (c) => c.text,
    ),
    ['git commit -m "Notes\nctx drop src.small is the person\'s"', 'npm test'],
  );
});

test('LANES-3 an idle lane: its stories in plan order, and the one Enter opens', async () => {
  const { laneStories, storyToOpen } = await import('../hooks/mod/panes.mjs');
  const state = {
    stories: [
      { id: 'ST-1', lane: 'web', state: 'done' },
      { id: 'ST-2', lane: 'api', state: 'done' },
      { id: 'ST-3', lane: 'web', state: 'blocked', waitingOn: ['ST-2'] },
      { id: 'ST-4', lane: 'web', state: 'ready' },
    ],
  };
  const web = { name: 'web', story: null };
  assert.deepEqual(
    laneStories(web, state).map((s) => s.id),
    ['ST-1', 'ST-3', 'ST-4'],
  );
  assert.equal(storyToOpen(web, state).id, 'ST-3');
  assert.equal(storyToOpen({ name: 'api', story: null }, state).id, 'ST-2');
  assert.equal(storyToOpen({ name: 'web', story: { id: 'ST-9' } }, state).id, 'ST-9');
  assert.equal(storyToOpen({ name: 'qa', story: null }, state), null);
});

test('MAP-2 what a tool call touches, and which files glow', async () => {
  const { touchOf, glowOf } = await import('../hooks/mod/codemap.mjs');
  assert.deepEqual(touchOf({ tool: 'Read', file_path: '/r/src/a.ts' }, '/r'), {
    path: 'src/a.ts',
    verb: 'read',
  });
  assert.deepEqual(
    touchOf({ tool: 'Edit', file_path: '/r/.claude/worktrees/agent-1/src/b.ts' }, '/r'),
    {
      path: 'src/b.ts',
      verb: 'edit',
    },
  );
  assert.equal(touchOf({ tool: 'Bash', command: 'ls' }, '/r'), null);
  assert.equal(touchOf({ tool: 'Read', file_path: '/elsewhere/x.ts' }, '/r'), null);
  const glow = glowOf(
    [
      { path: 'a', verb: 'read', lane: 'web', at: 1000 },
      { path: 'a', verb: 'edit', lane: 'web', at: 5000 },
      { path: 'b', verb: 'read', lane: 'api', at: 0 },
    ],
    24000,
  );
  assert.deepEqual(glow, { a: { lane: 'web', verb: 'edit' } });
});

test('MAP-1 the code map: every file drawn once, in its layer, with lines between neighbouring layers', async () => {
  const { layout, mapRows } = await import('../hooks/mod/codemap.mjs');
  const map = {
    layers: ['domain', 'services', 'tests'],
    files: [
      { path: 'x/domain/a.ts', layer: 'domain', imports: [] },
      { path: 'x/domain/b.ts', layer: 'domain', imports: ['x/domain/a.ts'] },
      { path: 'x/services/s.ts', layer: 'services', imports: ['x/domain/b.ts'] },
      { path: 'x/tests/s.test.ts', layer: 'tests', imports: ['x/services/s.ts'] },
    ],
  };
  const L = layout(map, 90);
  const boxes = Object.values(L.nodes);
  for (const a of boxes)
    for (const b of boxes)
      if (a !== b)
        assert.ok(
          a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y,
          'no two boxes overlap',
        );
  assert.equal(L.nodes['x/services/s.ts'].x > L.nodes['x/domain/a.ts'].x, true);
  const text = mapRows(map, { width: 90 }).map((r) => r.map((x) => x.text).join(''));
  for (const name of ['a.ts', 'b.ts', 's.ts', 's.test.ts'])
    assert.equal(text.join('\n').split(`│ ${name} `).length - 1, 1, `${name} drawn once`);
  // The import from s.ts (services) to b.ts (domain) is a line between the two columns.
  const row = text[L.nodes['x/services/s.ts'].y + 1];
  assert.match(
    row.slice(
      L.nodes['x/domain/b.ts'].x + L.nodes['x/domain/b.ts'].w,
      L.nodes['x/services/s.ts'].x,
    ),
    /[─┐┘└┌│]/,
  );
});

test('MISSION-1 and MISSION-3 the goal, the next step in words, and other tools only when not zero', async () => {
  const { goalOf, nextText } = await import('../hooks/mod/mission.mjs');
  assert.deepEqual(
    goalOf([
      { id: 'ST-1', state: 'done', milestone: 'Milestone 1: A' },
      { id: 'ST-2', state: 'done', milestone: 'Milestone 2: B' },
      { id: 'ST-3', state: 'review', milestone: 'Milestone 2: B' },
    ]),
    { name: 'Milestone 2: B', done: 1, total: 2 },
  );
  assert.equal(goalOf([{ id: 'ST-1', state: 'todo' }]), null);
  assert.equal(nextText({ step: 'merge', args: 'web/st-4' }), 'Merge web/st-4');
  assert.equal(
    nextText({ step: 'wait', why: 'lanes are building' }),
    'waiting: lanes are building',
  );
  // MISSION-3: another tool's facts show on the lane's card only when they aren't zero.
  const state = {
    kind: 'ok',
    stories: [],
    ready: [],
    lanes: [
      { name: 'lead', state: 'idle', active: false },
      { name: 'web', state: 'building', active: true, agent: 'web-engineer' },
    ],
  };
  const quiet = texts(pane(state, { combined: { web: { without: 0, owed: 0 } } }));
  assert.ok(!quiet.some((t) => /understanding|owed/.test(t)));
  const loud = texts(pane(state, { combined: { web: { without: 2, owed: 1 } } }));
  assert.ok(loud.includes('2 edited without understanding'));
  assert.ok(loud.includes('1 card owed'));
});

test('TRAIL-1 the trail drawn: requirements a story shares meet at one node, and gaps are dashed', async () => {
  const { trailRows, trailSvg } = await import('../hooks/mod/trail.mjs');
  const st = [{ id: 'ST-20', state: 'in progress', lane: 'ingest' }];
  const rows = [
    {
      id: 'ORIG-1',
      title: 'Every paragraph knows its source',
      stories: st,
      files: ['a.ts', 'b.ts'],
      tests: ['x.test.ts'],
    },
    {
      id: 'ORIG-2',
      title: 'Each format records where',
      stories: st,
      files: ['c.ts'],
      tests: ['x.test.ts'],
    },
    { id: 'ORIG-3', title: 'Splits keep the location', stories: [], files: [], tests: [] },
  ];
  const text = trailRows(rows, { width: 100 }).map((r) => r.map((x) => x.text).join(''));
  assert.match(text[0], /ORIG-1.*───┬ ● ST-20.*2 files.*✓ x\.test\.ts/);
  assert.match(text[1], /ORIG-2.*───┘\s+─── 1 file/);
  assert.doesNotMatch(text[1], /ST-20/);
  assert.match(text[2], /╌╌╌ no story.*╌╌╌ no code.*╌╌╌ no test names it/);
  const svg = trailSvg(rows, { selected: 'ORIG-2' });
  assert.equal(svg.match(/ST-20<\/text>/g).length, 1, 'the shared story is drawn once');
  assert.match(svg, /stroke-dasharray="3 3"/);
});

test('JOURNAL-1 the brief read for the journal: the request, the decisions, and who approved what', async () => {
  const { briefRequest, briefDecisions, approverOf, approvalWords } =
    await import('../hooks/lib/journal.mjs');
  const brief =
    '# Book editor\n\n## Problem\n\nAn author wants a careful line edit.\nWithout losing their voice.\n\nMore detail.\n\n## Decision log\n\n| Date | Decision | Why | Rejected |\n| --- | --- | --- | --- |\n| 2026-10-10 | One author, no accounts | It is a personal tool | Teams |\n\n## Open questions\n';
  assert.deepEqual(briefRequest(brief), {
    title: 'Book editor',
    problem: 'An author wants a careful line edit. Without losing their voice.',
  });
  assert.deepEqual(briefDecisions(brief), [
    { date: '2026-10-10', decision: 'One author, no accounts', why: 'It is a personal tool' },
  ]);
  assert.equal(
    approverOf({
      approval: 'dependency',
      reason:
        'pdf panel (approved by the lead within the delegated rules: dependencies (pdfjs-dist))',
    }),
    'lead',
  );
  assert.equal(
    approverOf({
      approval: 'editing-rules',
      reason: 'Yes, as they are. (given in chat, recorded by the lead)',
    }),
    'person',
  );
  assert.equal(approvalWords('dep-zod'), 'adding the package zod');
  assert.equal(approvalWords('dependency'), 'adding a new package');
});

test('DECIDE-2 a decision card carries the lineage: the story, its requirements, what was settled, why, and each choice', async () => {
  const { decisionCards, contextOf } = await import('../hooks/mod/decisions.mjs');
  const line = {
    kind: 'held',
    text: 'web wants to install dayjs',
    actions: [
      { id: 'approveHeld', label: 'Approve', hotkey: '1' },
      { id: 'refuseHeld', label: 'Refuse', hotkey: '2' },
    ],
    held: {
      lane: 'web',
      command: 'npm install dayjs',
      refusal:
        "Blocked: a new dependency (dayjs) needs a person's approval. Write a short change request.",
    },
  };
  const usage = { kind: 'usage', text: 'plan at 91%', actions: [] };
  const [card, ...rest] = decisionCards([line, usage], {
    state: {
      stories: [
        { id: 'ST-4', title: 'Booking form', branch: 'web/st-4', requirements: ['BOOK-1'] },
      ],
      lanes: [{ name: 'web', story: { id: 'ST-4' } }],
    },
    status: { requirements: [{ id: 'BOOK-1', title: 'Request a booking' }] },
    request: 'Bookings',
    journal: [
      { kind: 'dispatch', story: 'ST-4', text: 'ST-4 was handed to the web lane.' },
      { kind: 'dispatch', story: 'ST-9', text: 'ST-9 was handed to the core lane.' },
    ],
  });
  assert.equal(rest.length, 0, 'notes are not decisions');
  assert.equal(card.asked, 'Bookings');
  assert.deepEqual(card.story, { id: 'ST-4', title: 'Booking form', branch: 'web/st-4' });
  assert.deepEqual(card.requirements, [{ id: 'BOOK-1', title: 'Request a booking' }]);
  assert.equal(card.doing, 'npm install dayjs');
  assert.deepEqual(card.settled, ['ST-4 was handed to the web lane.']);
  assert.equal(card.why, "Blocked: a new dependency (dayjs) needs a person's approval.");
  assert.match(card.options[0].effect, /held call runs now/);
  assert.equal(contextOf(card), 'for ST-4 Booking form (BOOK-1)');
});

test('TEAM-1 the team in the config: a tech lead, owners on lanes, and the defaults', async () => {
  const { teamProblems, teamOf, isHandle } = await import('../hooks/lib/team.mjs');
  assert.deepEqual(
    teamProblems({ team: { techLead: 'alex' }, lanes: { web: { owners: ['sam'] } } }),
    [],
  );
  assert.deepEqual(teamProblems({ lanes: { web: { owners: ['sam'] } } }), [
    'lanes.web.owners needs "team", with its tech lead',
  ]);
  assert.equal(teamProblems({ team: { techLead: 'alex', staleDays: 2.5 } }).length, 1);
  assert.equal(teamProblems({ team: { techLead: 'alex', provider: 'gitlab' } }).length, 1);
  assert.deepEqual(teamProblems({ team: { techLead: 'alex', provider: { command: 'hub' } } }), []);
  assert.deepEqual(
    teamOf({ team: { techLead: 'alex' }, lanes: { web: { owners: ['sam'] }, api: {} } }),
    {
      techLead: 'alex',
      staleDays: 3,
      intents: 'Intents',
      board: null,
      report: true,
      provider: 'github',
      owners: { web: ['sam'] },
    },
  );
  assert.equal(teamOf({ lanes: {} }), null);
  for (const h of ['sam', 'a-b', 'A1']) assert.ok(isHandle(h), h);
  for (const h of ['-sam', 'sam-', 'a--b', 'x'.repeat(40), '']) assert.ok(!isHandle(h), h);
});

test('HUBR-6 and HUBR-7 a hosted provider in the config: its address, its command, and intents kept by it', async () => {
  const { teamProblems, teamOf } = await import('../hooks/lib/team.mjs');
  const { providerAdapterOf } = await import('../hooks/lib/adapters/index.mjs');
  assert.deepEqual(
    teamProblems({ team: { techLead: 'alex', provider: { hub: 'https://h.example' } } }),
    [],
  );
  for (const bad of [
    { hub: 'not an address' },
    { hub: 'https://h.example', fallback: 'gitlab' },
    { hub: 'https://h.example', command: 'x' },
  ])
    assert.equal(
      teamProblems({ team: { techLead: 'alex', provider: bad } }).length,
      1,
      JSON.stringify(bad),
    );
  assert.equal(teamProblems({ team: { techLead: 'alex', report: 'yes' } }).length, 1);
  assert.equal(providerAdapterOf('github'), null);
  assert.equal(providerAdapterOf({ command: 'x' }), null);
  const team = teamOf({ team: { techLead: 'alex', provider: { hub: 'https://h.example/' } } });
  assert.equal(team.intents, null, 'a hosted provider keeps intents');
  assert.equal(team.provider.fallback, 'github');
  assert.equal(team.provider.url, 'https://h.example');
  assert.match(team.provider.command, /client\.mjs' --url 'https:\/\/h\.example'$/);
  assert.equal(
    teamOf({ team: { techLead: 'alex', intents: 'Ideas', provider: { hub: 'https://h.example' } } })
      .intents,
    'Ideas',
    'mirrored to Discussions when the team says where',
  );
  assert.equal(teamOf({ team: { techLead: 'alex', report: false } }).report, false);
});

test('HUBR-2 a report holds only the fields its allow-list names', async () => {
  const { snapshotProblems, snapshotHash, EVENT_PARTS, reportedSummary } =
    await import('../hooks/lib/snapshot.mjs');
  // A summary longer than 600 characters is cut after the last sentence that fits.
  const sentence = 'The list of bookings for a day. ';
  const long = sentence.repeat(30);
  const cut = reportedSummary(long);
  assert.ok(cut.length <= 600 && cut.endsWith('day.') && long.startsWith(cut));
  assert.equal(reportedSummary('a\n  b'), 'a b');
  assert.equal(reportedSummary(''), null);
  const words = reportedSummary('word '.repeat(200));
  assert.ok(words.length <= 600 && words.endsWith('word…'));
  const good = {
    version: 1,
    project: { repository: 'o/r', base: 'main', codeKit: '0.19.0', at: 1_700_000_000_000 },
    milestones: [{ name: 'Milestone 1: Booking', target: '2026-11-30', stories: ['ST-4'] }],
    stories: [
      {
        id: 'ST-4',
        title: 'Booking list',
        lane: 'web',
        milestone: 'Milestone 1: Booking',
        requirements: ['BOOK-1'],
        dependsOn: [],
        stage: 'review',
        since: {
          building: 1_700_000_000_000,
          review: 1_700_000_100_000,
          sentBack: null,
          queued: null,
          merged: null,
        },
        claimedBy: 'sam',
      },
    ],
    sendBacks: [{ story: 'ST-4', at: 1_700_000_050_000, reason: 'The empty state is missing.' }],
    requirements: [
      {
        id: 'BOOK-1',
        stories: ['ST-4'],
        built: ['apps/web/list.tsx'],
        tested: ['apps/web/list.test.tsx'],
        check: 'done',
      },
    ],
    approvals: [
      {
        what: 'dep-zod',
        path: 'package.json',
        who: 'lead',
        at: 1_700_000_060_000,
        branch: 'web/st-4',
      },
    ],
    usage: [{ story: 'ST-4', kind: 'lane', input: 1200, output: 300, cache: 40 }],
    rules: {
      layers: [{ name: 'web', mayImport: ['core'] }],
      protected: [{ glob: 'docs/specs/**', approval: 'specs' }],
      delegated: { protected: [], dependencies: true, merge: false },
      designGate: false,
    },
  };
  assert.deepEqual(snapshotProblems(good), []);
  // Version 4: a story's summary and a requirement's title; a report without them is still valid.
  const v4 = structuredClone(good);
  v4.stories[0].summary = 'The list of bookings for a day, newest first.';
  v4.requirements[0].title = 'Bookings are listed by day';
  assert.deepEqual(snapshotProblems(v4), []);
  v4.stories[0].summary = 'x'.repeat(601);
  assert.match(snapshotProblems(v4)[0], /summary: not a summary/);
  // Version 5: the specs, deliverable kinds, lanes, approvers, the security rules, each story's
  // spec-check and queue place, the design register and the sessions; a version 4 report is still valid.
  const v5 = structuredClone(good);
  v5.version = 5;
  v5.stories[0] = { ...v5.stories[0], check: 'partial', queuePosition: 1 };
  v5.specs = [
    {
      id: '03',
      file: 'docs/specs/03-booking.md',
      title: 'Booking',
      outcome: 'A customer books without calling us.',
      requirements: ['BOOK-1'],
    },
  ];
  v5.approvals[0] = { ...v5.approvals[0], who: 'person', approver: 'kim', story: 'ST-4' };
  v5.rules.layers[0].label = 'Screens';
  v5.rules.lanes = [
    { name: 'web', label: 'Screens', layers: ['web'], paths: ['apps/web/**'], exclude: [] },
  ];
  v5.rules.security = { reviewer: true, kinds: ['sign-in', 'dependencies'], requirements: [] };
  v5.designs = [
    {
      screen: 'Bookings list',
      file: 'apps/web/app/bookings/page.tsx',
      story: 'ST-1',
      approved: '2026-10-11',
      tool: 'paper',
      state: 'handed-over',
      states: ['default', 'empty'],
    },
  ];
  v5.sessions = [
    {
      id: 'a1b2c3d4-0000',
      role: 'lead',
      person: 'kim',
      codeKit: '0.28.0',
      model: 'claude-sonnet-4',
      started: 1_700_000_000_000,
      editing: 'apps/web/list.tsx',
      editedAt: 1_700_000_100_000,
    },
  ];
  assert.deepEqual(snapshotProblems(v5), []);
  assert.deepEqual(snapshotProblems({ ...v5, sessions: [] }), []);
  const badKind = structuredClone(v5);
  badKind.rules.security.kinds = ['everything'];
  assert.match(snapshotProblems(badKind)[0], /rules\.security\.kinds\[0\]: not one of/);
  const badState = structuredClone(v5);
  badState.designs[0].state = 'approved';
  assert.match(snapshotProblems(badState)[0], /designs\[0\]\.state: not one of/);
  const withBody = structuredClone(v5);
  withBody.specs[0].acceptance = 'Given a booking, then…';
  assert.match(snapshotProblems(withBody)[0], /specs\[0\]\.acceptance: not a field/);
  const longOutcome = structuredClone(v5);
  longOutcome.specs[0].outcome = 'x'.repeat(601);
  assert.match(snapshotProblems(longOutcome)[0], /outcome: not a summary/);
  // A later part's own fields aren't optional once it's there.
  const noLabel = structuredClone(v5);
  delete noLabel.rules.lanes[0].label;
  assert.match(snapshotProblems(noLabel)[0], /rules\.lanes\[0\]\.label: missing/);
  // The design register and the specs changing is news; the sessions alone aren't.
  const edited = structuredClone(v5);
  edited.sessions[0].editing = 'apps/web/detail.tsx';
  assert.equal(snapshotHash(edited, EVENT_PARTS), snapshotHash(v5, EVENT_PARTS));
  const redesigned = structuredClone(v5);
  redesigned.designs[0].state = 'problems';
  assert.notEqual(snapshotHash(redesigned, EVENT_PARTS), snapshotHash(v5, EVENT_PARTS));
  // Version 6: each usage row's model, the security reviews, each intent's pull request and the claims;
  // a version 5 report (above) and one with none of them are still valid.
  const v6 = structuredClone(v5);
  v6.version = 6;
  v6.usage[0].model = 'claude-opus-5-5';
  v6.securityReviews = [
    {
      story: 'ST-4',
      branch: 'web/st-4',
      needed: true,
      reasons: ['sign-in', 'dependencies'],
      ran: true,
      at: 1_700_000_200_000,
      result: 'findings',
      findings: 2,
      blockers: 1,
    },
    {
      story: 'ST-5',
      branch: 'web/st-5',
      needed: true,
      reasons: ['payments'],
      ran: false,
      at: null,
      result: null,
      findings: null,
      blockers: null,
    },
  ];
  v6.intents = [{ id: 12, story: 'ST-4', pull: 31, draft: true }];
  v6.claims = [
    {
      story: 'ST-4',
      by: 'sam',
      at: 1_700_000_000_000,
      active: 1_700_000_150_000,
      stale: false,
      lease: ['apps/web/**'],
    },
  ];
  assert.deepEqual(snapshotProblems(v6), []);
  const badResult = structuredClone(v6);
  badResult.securityReviews[0].result = 'approved';
  assert.match(snapshotProblems(badResult)[0], /securityReviews\[0\]\.result: not one of/);
  const badReason = structuredClone(v6);
  badReason.securityReviews[0].reasons = ['src/auth/login.ts'];
  assert.match(snapshotProblems(badReason)[0], /reasons\[0\]: not one of/);
  // A finding's text has nowhere to go: a review is counts only.
  const withText = structuredClone(v6);
  withText.securityReviews[0].text = 'Attack: … Fix: …';
  assert.match(snapshotProblems(withText)[0], /securityReviews\[0\]\.text: not a field/);
  const badIntent = structuredClone(v6);
  badIntent.intents[0].about = 'Move reports to the data lane';
  assert.match(snapshotProblems(badIntent)[0], /intents\[0\]\.about: not a field/);
  const noStale = structuredClone(v6);
  delete noStale.claims[0].stale;
  assert.match(snapshotProblems(noStale)[0], /claims\[0\]\.stale: missing/);
  // A review that ran, or an intent's pull request opening, is news; a claim renewed alone isn't.
  const reviewed = structuredClone(v6);
  reviewed.securityReviews[1] = { ...reviewed.securityReviews[1], ran: true, result: 'pass' };
  assert.notEqual(snapshotHash(reviewed, EVENT_PARTS), snapshotHash(v6, EVENT_PARTS));
  const opened = structuredClone(v6);
  opened.intents[0].draft = false;
  assert.notEqual(snapshotHash(opened, EVENT_PARTS), snapshotHash(v6, EVENT_PARTS));
  const renewed = structuredClone(v6);
  renewed.claims[0].active += 60_000;
  assert.equal(snapshotHash(renewed, EVENT_PARTS), snapshotHash(v6, EVENT_PARTS));
  // Nowhere for code, a diff or a prompt to go.
  const withDiff = structuredClone(good);
  withDiff.stories[0].diff = '--- a/x\n+++ b/x';
  assert.match(snapshotProblems(withDiff)[0], /stories\[0\]\.diff: not a field a report may hold/);
  const withPrompt = structuredClone(good);
  withPrompt.prompt = 'Build the booking list';
  assert.match(snapshotProblems(withPrompt)[0], /snapshot\.prompt: not a field/);
  const withContents = structuredClone(good);
  withContents.stories[0].title = 'export function list() {\n  return db.query();\n}';
  assert.match(snapshotProblems(withContents)[0], /title: not a title/);
  const longReason = structuredClone(good);
  longReason.sendBacks[0].reason = 'x'.repeat(201);
  assert.match(snapshotProblems(longReason)[0], /reason: not a line/);
  const badStage = structuredClone(good);
  badStage.stories[0].stage = 'shipped';
  assert.match(snapshotProblems(badStage)[0], /stage: not one of/);
  // The same facts at another moment are the same report; a stage change is news, usage alone isn't.
  const later = structuredClone(good);
  later.project.at += 60_000;
  assert.equal(snapshotHash(later), snapshotHash(good));
  const used = structuredClone(good);
  used.usage[0].input += 1;
  assert.equal(snapshotHash(used, EVENT_PARTS), snapshotHash(good, EVENT_PARTS));
  assert.notEqual(snapshotHash(used), snapshotHash(good));
  const moved = structuredClone(good);
  moved.stories[0].stage = 'queued';
  assert.notEqual(snapshotHash(moved, EVENT_PARTS), snapshotHash(good, EVENT_PARTS));
});

test("HUBR-2 a layer's or lane's deliverable kind: its label, or what its name gives", async () => {
  const { deliverableKind } = await import('../hooks/lib/snapshot.mjs');
  assert.equal(deliverableKind('schemas'), 'API contract');
  assert.equal(deliverableKind('web'), 'Screens');
  assert.equal(deliverableKind('data'), 'Data');
  assert.equal(deliverableKind('domain'), 'Service');
  assert.equal(deliverableKind('qa'), 'Tests');
  assert.equal(deliverableKind('design'), 'Design');
  assert.equal(deliverableKind('billing-sync'), 'Billing sync');
  assert.equal(deliverableKind('web', '  Pages '), 'Pages');
});

test("HUBR-2 each spec's id, title, outcome line and requirements, from the specs", async () => {
  const { readSpecs } = await import('../hooks/lib/plan.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'ck-specs-'));
  mkdirSync(join(dir, 'specs'));
  writeFileSync(
    join(dir, 'specs/03-booking.md'),
    '# 03. Booking\n\n**Status:** agreed\n**Outcome:** A customer books without calling us.\n\n## Requirements\n\n### BOOK-1 The list\n\nText.\n\n### BOOK-2 Old (removed)\n',
  );
  writeFileSync(join(dir, 'specs/payments.md'), '# Payments\n\n### PAY-1 Pay\n');
  writeFileSync(join(dir, 'specs/principles.md'), '# Principles\n\nBe kind.\n');
  writeFileSync(join(dir, 'specs/plan.md'), '# Plan\n\n**Outcome:** not a spec\n');
  assert.deepEqual(readSpecs(dir, 'specs', 'specs/plan.md'), [
    {
      id: '03',
      file: 'specs/03-booking.md',
      title: 'Booking',
      outcome: 'A customer books without calling us.',
      requirements: ['BOOK-1'],
    },
    {
      id: 'payments',
      file: 'specs/payments.md',
      title: 'Payments',
      outcome: null,
      requirements: ['PAY-1'],
    },
  ]);
  rmSync(dir, { recursive: true, force: true });
});

test('HUBR-2 the model a session runs on: what SessionStart says, or its last reply', async () => {
  const { modelOf } = await import('../hooks/lib/hook.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'ck-model-'));
  const transcript = join(dir, 't.jsonl');
  writeFileSync(
    transcript,
    [
      { type: 'assistant', message: { model: 'claude-opus-4' } },
      { type: 'assistant', message: { model: 'claude-sonnet-4' } },
      { type: 'assistant', message: { model: '<synthetic>' } },
      { type: 'user', message: { content: 'hi' } },
    ]
      .map((e) => JSON.stringify(e))
      .join('\n'),
  );
  assert.equal(modelOf({ model: 'claude-haiku-4', transcript_path: transcript }), 'claude-haiku-4');
  assert.equal(modelOf({ transcript_path: transcript }), 'claude-sonnet-4');
  assert.equal(modelOf({ transcript_path: join(dir, 'none.jsonl') }), null);
  assert.equal(modelOf({}), null);
  rmSync(dir, { recursive: true, force: true });
});

test('HUBR-5 a milestone target in the plan', async () => {
  const { readMilestones } = await import('../hooks/lib/plan.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'ck-plan-'));
  writeFileSync(
    join(dir, 'plan.md'),
    '# Plan\n\n## Milestone 1: Booking\n\n**Target:** 2026-11-30\n\n### ST-1 List\n\n**Target:** 2027-01-01\n\n## Milestone 2: Payments\n\n### ST-2 Pay\n',
  );
  // A target line under a story belongs to the story, not the milestone.
  assert.deepEqual(readMilestones(dir, 'plan.md'), [
    { name: 'Milestone 1: Booking', target: '2026-11-30' },
    { name: 'Milestone 2: Payments', target: null },
  ]);
  rmSync(dir, { recursive: true, force: true });
});

test('HUBR-2 and HUBR-6 usage by kind of agent, and an agent present by tool and branch', async () => {
  const { usageForReport, presenceOf } = await import('../hooks/mod/view.mjs');
  const ledger = {
    'lead|': {
      key: 'lead',
      lane: 'lead',
      story: null,
      background: false,
      input: 10,
      output: 2,
      cache: 1,
    },
    'a1|ST-4|claude-sonnet-5-5': {
      key: 'a1',
      lane: 'web',
      story: 'ST-4',
      background: false,
      model: 'claude-sonnet-5-5',
      input: 100,
      output: 20,
      cache: 5,
    },
    'a2|ST-4': {
      key: 'a2',
      lane: null,
      story: 'ST-4',
      background: true,
      input: 30,
      output: 3,
      cache: 0,
    },
    'a3|': { key: 'a3', lane: null, story: null, background: true, input: 7, output: 1, cache: 0 },
    'a4|': { key: 'a4', lane: null, story: null, background: true, input: 5, output: 1, cache: 0 },
  };
  const types = { a2: 'code-kit:reviewer', a3: 'security-reviewer', a4: 'ctx-card-writer' };
  const usage = usageForReport(ledger, (k) => types[k] ?? null);
  assert.deepEqual(
    Object.values(usage).map((u) => u.kind),
    ['lead', 'lane', 'reviewer', 'security-reviewer', 'background'],
  );
  // Report version 6: each row names the model its requests ran on; a row from before, none.
  assert.deepEqual(usage['a1|ST-4|claude-sonnet-5-5'], {
    story: 'ST-4',
    kind: 'lane',
    model: 'claude-sonnet-5-5',
    input: 100,
    output: 20,
    cache: 5,
  });
  assert.equal(usage['lead|'].model, null);
  const lanes = [{ name: 'web', branch: 'web/st-4' }];
  assert.deepEqual(
    presenceOf({ agentId: 'a1', type: 'web-engineer', tool: 'Edit', lane: 'web', lanes, at: 5 }),
    {
      type: 'web-engineer',
      tool: 'Edit',
      branch: 'web/st-4',
      at: 5,
    },
  );
  assert.equal(presenceOf({ agentId: null, tool: 'Read', at: 5 }).type, 'lead');
});

test('TEAM-2 story ids a claim ref can carry, and the paths an intent touches', async () => {
  const { isStoryId, touchesOf } = await import('../hooks/lib/team.mjs');
  for (const id of ['ST-9', 'AUTH-12']) assert.ok(isStoryId(id), id);
  for (const id of ['ST9', 'ST-', '../x', 'ST-1/x', '']) assert.ok(!isStoryId(id), id);
  assert.deepEqual(touchesOf('Touches: `packages/schemas/**`, apps/api/**\n\nWhy.'), [
    'packages/schemas/**',
    'apps/api/**',
  ]);
  assert.deepEqual(touchesOf('No paths named.'), []);
});

test('TEAM-6 GitHub activity in plain sentences, and the claims taken and released between reads', async () => {
  const { activityOf, claimChanges } = await import('../hooks/lib/team.mjs');
  const at = (m) => new Date(Date.UTC(2026, 9, 11, 0, m)).toISOString();
  const said = activityOf(
    [
      {
        type: 'PullRequestEvent',
        created_at: at(5),
        actor: { login: 'sam' },
        payload: { action: 'closed', pull_request: { number: 3, title: 'A', merged: true } },
      },
      {
        type: 'IssuesEvent',
        created_at: at(4),
        actor: { login: 'alex' },
        payload: {
          action: 'closed',
          issue: {
            number: 9,
            title: 'B',
            state_reason: 'not_planned',
            labels: [{ name: 'code-kit:intent' }],
          },
        },
      },
      {
        type: 'IssuesEvent',
        created_at: at(3),
        actor: { login: 'kim' },
        payload: { action: 'opened', issue: { number: 8, title: 'a bug', labels: [] } },
      },
      {
        type: 'CreateEvent',
        created_at: at(2),
        actor: { login: 'sam' },
        payload: { ref_type: 'branch', ref: 'web/st-4' },
      },
      {
        type: 'PushEvent',
        created_at: at(0),
        actor: { login: 'sam' },
        payload: { ref: 'refs/heads/main', size: 1 },
      },
    ],
    Date.parse(at(1)),
  );
  assert.deepEqual(
    said.map((e) => `${e.by} ${e.text}`),
    ['sam started web/st-4', 'sam merged #3 A'],
  );
  const changes = claimChanges(
    [{ story: 'ST-1', by: 'sam', at: at(0), lease: [] }],
    [{ story: 'ST-2', by: 'kim', at: at(6), lease: [] }],
  );
  assert.deepEqual(
    changes.map((c) => `${c.by} ${c.kind} ${c.text}`),
    ['kim claimed claimed ST-2', 'sam released ST-1 is no longer claimed by them'],
  );
});

test('TEAM-9 working days, and when a claim goes stale', async () => {
  const { workingDaysBetween, withStaleness } = await import('../hooks/lib/team.mjs');
  const day = (d) => Date.parse(`2026-10-${String(d).padStart(2, '0')}T09:00:00Z`);
  // 2026-10-09 is a Friday, 10-12 a Monday.
  assert.equal(workingDaysBetween(day(9), day(9)), 0);
  assert.equal(workingDaysBetween(day(9), day(12)), 1);
  assert.equal(workingDaysBetween(day(8), day(13)), 3);
  const claim = { story: 'ST-7', by: 'sam', at: new Date(day(8)).toISOString(), lease: [] };
  assert.equal(withStaleness(claim, null, 3, day(13)).stale, true);
  assert.equal(withStaleness(claim, day(12), 3, day(13)).stale, false);
  assert.equal(withStaleness(claim, day(12), 3, day(13)).active, new Date(day(12)).toISOString());
});

test('TEAM-7 two globs overlap when one can name a file the other names', async () => {
  const { globsOverlap } = await import('../hooks/lib/teamfacts.mjs');
  assert.ok(globsOverlap('apps/web/**', 'apps/web/booking/form.tsx'));
  assert.ok(globsOverlap('packages/schemas/report.ts', 'packages/**'));
  assert.ok(!globsOverlap('apps/web/**', 'apps/api/**'));
});

test('TEAM-5 and TEAM-6 an intent from its discussion, and intents raised and settled since', async () => {
  const { intentOf, discussionActivity } = await import('../hooks/lib/teamfacts.mjs');
  const d = (n, extra) => ({
    number: n,
    title: `I${n}`,
    body: 'Touches: a/**',
    url: 'u',
    author: { login: 'sam' },
    createdAt: '2026-10-11T00:05:00Z',
    closed: false,
    closedAt: null,
    stateReason: null,
    ...extra,
  });
  assert.deepEqual(intentOf(d(1)), {
    id: 1,
    by: 'sam',
    about: 'I1',
    touches: ['a/**'],
    at: '2026-10-11T00:05:00Z',
    url: 'u',
    state: 'open',
  });
  assert.equal(intentOf(d(2, { closed: true, stateReason: 'RESOLVED' })).state, 'agreed');
  assert.equal(intentOf(d(3, { closed: true, stateReason: 'OUTDATED' })).state, 'dropped');
  assert.equal(intentOf(d(4, { closed: true, stateReason: 'DUPLICATE' })).state, 'duplicate');
  const said = discussionActivity(
    [
      d(5),
      d(6, {
        createdAt: '2026-10-10T00:00:00Z',
        closed: true,
        closedAt: '2026-10-11T00:06:00Z',
        stateReason: 'RESOLVED',
      }),
    ],
    Date.parse('2026-10-11T00:00:00Z'),
    'alex',
  );
  assert.deepEqual(
    said.map((e) => `${e.by} ${e.text}`),
    ['sam raised intent #5 I5', 'alex agreed intent #6 I6'],
  );
});

test('TEAM-10 a decision record holds only what the discussion says', async () => {
  const { decisionRecord, slugOf } = await import('../hooks/lib/teamfacts.mjs');
  assert.equal(slugOf('Split the report format!'), 'split-the-report-format');
  const text = decisionRecord(
    {
      title: 'Split the report format',
      body: 'Touches: docs/reports/**\n\nReports differ per site.\n\nRaised with code-kit by @sam before any code, so the team sees it first.',
      url: 'u',
      author: { login: 'sam' },
      createdAt: '2026-10-10T01:00:00Z',
      closedAt: '2026-10-11T02:00:00Z',
      comments: [
        { author: { login: 'kim' }, body: 'Agreed by @kim, the tech lead: not really' },
        { author: { login: 'alex' }, body: 'Agreed by @alex, the tech lead: per site now' },
      ],
    },
    'alex',
  );
  assert.equal(
    text,
    '# Split the report format\n\n**Status:** agreed\n**Date:** 2026-10-11\n**Raised by:** @sam · **Agreed by:** @alex\n**Discussion:** u\n\n## What changes, and why\n\nReports differ per site.\n\n## What it touches\n\n- `docs/reports/**`\n\n## Agreed\n\nper site now\n',
  );
  // A hosted provider says who settled it: here kim, who owns the paths it touches, not the tech lead.
  const byOwner = decisionRecord(
    {
      title: 'Version the schema',
      body: 'Touches: packages/schemas/**\n\nTwo clients read it.',
      url: 'h',
      author: { login: 'sam' },
      createdAt: '2026-10-10T01:00:00Z',
      closedAt: '2026-10-11T02:00:00Z',
      settledBy: 'kim',
      why: 'fine, version it',
      comments: [
        { author: { login: 'alex' }, body: 'Agreed by @alex, the tech lead: not this one' },
      ],
    },
    'alex',
  );
  assert.match(byOwner, /\*\*Agreed by:\*\* @kim$/m);
  assert.match(byOwner, /## Agreed\n\nfine, version it\n$/);
  assert.equal(
    decisionRecord(
      {
        ...{ title: 't', body: '', url: 'h', createdAt: '2026-10-10' },
        settled_by: 'kim',
        comments: [
          { author: { login: 'kim' }, body: 'Agreed by @kim, owner of packages/schemas/**: yes' },
        ],
      },
      'alex',
    ).includes('## Agreed\n\nyes\n'),
    true,
  );
});

test('TEAM-11 CODEOWNERS from the config, braces expanded and the kit left out', async () => {
  const { codeowners, ownersPatterns } = await import('../hooks/lib/teamfacts.mjs');
  assert.deepEqual(ownersPatterns('apps/{web,admin}/**'), ['/apps/web/**', '/apps/admin/**']);
  assert.deepEqual(ownersPatterns('**/*.sql'), ['**/*.sql']);
  const text = codeowners({
    techLead: 'alex',
    leadPaths: ['docs/**', '.claude/**'],
    lanes: {
      web: { paths: ['apps/web/**'], owners: ['sam', 'kim'] },
      api: { paths: ['apps/api/**'] },
    },
  });
  assert.match(text, /^\/docs\/\*\* @alex$/m);
  assert.match(text, /^\/apps\/web\/\*\* @sam @kim$/m);
  assert.doesNotMatch(text, /^\/\.claude|apps\/api/m);
});

test('TEAM-12 a story on the board, and only the fields that changed', async () => {
  const { boardValues, boardChanges } = await import('../hooks/lib/teamfacts.mjs');
  const now = boardValues({ lane: 'web', state: 'in progress' }, { by: 'sam', stale: true });
  assert.deepEqual(now, { Lane: 'web', 'Claimed by': 'sam', Stale: 'yes', State: 'in progress' });
  assert.deepEqual(boardChanges(now, now), []);
  assert.deepEqual(
    boardChanges({ ...now, Stale: '' }, boardValues({ lane: 'web', state: 'in progress' }, null)),
    [['Claimed by', '']],
  );
});

test('ONB-7 which changes need the security review, and why', async () => {
  const { addedLines, securityReasons, securityRequirementIds, reasonsInWords } =
    await import('../hooks/lib/security.mjs');
  const added = addedLines(
    [
      'diff --git a/apps/api/orders.ts b/apps/api/orders.ts',
      '--- a/apps/api/orders.ts',
      '+++ b/apps/api/orders.ts',
      '@@ -3,0 +4,2 @@ export',
      '+const rows = await db.$queryRawUnsafe(`select * from orders where id = ${req.query.id}`);',
      '+return rows;',
      'diff --git a/src/cancel.ts b/src/cancel.ts',
      '+++ b/src/cancel.ts',
      '@@ -1 +1 @@',
      '-const x = 1;',
      '+export const cancelOrder = () => canvas;',
    ].join('\n'),
  );
  assert.deepEqual(added[0], {
    file: 'apps/api/orders.ts',
    line: 4,
    text: 'const rows = await db.$queryRawUnsafe(`select * from orders where id = ${req.query.id}`);',
  });
  assert.equal(added[2].line, 1);
  const reasons = securityReasons({ files: ['apps/api/orders.ts', 'src/cancel.ts'], added });
  assert.deepEqual(
    reasons.map((r) => r.kind),
    ['input', 'injection'],
  );
  assert.deepEqual(reasons[0].where, ['apps/api/orders.ts', 'apps/api/orders.ts:4']);
  assert.match(reasonsInWords(reasons), /^input from outside .*; queries, commands/);
  // Words that only look like a permission check (cancel, canvas) don't count.
  assert.deepEqual(securityReasons({ files: ['src/cancel.ts'], added: added.slice(2) }), []);
  // Tests and docs describe a change; they don't ship.
  assert.deepEqual(
    securityReasons({
      files: ['src/auth/login.test.ts', 'docs/auth.md'],
      added: [{ file: 'src/auth/login.test.ts', line: 1, text: 'login(req.body.password)' }],
    }),
    [],
  );
  assert.deepEqual(
    securityReasons({ files: ['apps/web/package.json'] }).map((r) => r.kind),
    ['dependencies'],
  );
  const security = securityRequirementIds([
    '## Requirements\n\n### ORD-1 Place\n\n## Security requirements\n\n### ORD-2 Own orders only\n\n## Quality targets\n\n### ORD-3 Not here\n',
  ]);
  assert.deepEqual([...security], ['ORD-2']);
  assert.deepEqual(
    securityReasons({ files: ['src/list.ts'], cites: ['ORD-1', 'ORD-2'], security }),
    [{ kind: 'requirements', why: 'security requirements it cites', where: ['ORD-2'] }],
  );
});

test('ONB-7 an older setup is missing the security reviewer, with or without screens', async () => {
  const { setupGaps } = await import('../hooks/lib/next.mjs');
  const config = { lanes: { api: { agent: 'api-engineer', paths: ['apps/api/**'] } } };
  assert.deepEqual(setupGaps(config, [], ['apps/api/x.ts']).length, 1);
  assert.match(
    setupGaps(config, [], [])[0],
    /^a security reviewer \(\.claude\/agents\/security-reviewer\.md\)/,
  );
  assert.deepEqual(setupGaps(config, [], ['.claude/agents/security-reviewer.md']), []);
});

test('REG-2 what weakens a test: a skip or focus marker, fewer cases, fewer assertions', async () => {
  const { weakenings, testShape } = await import('../hooks/lib/regression.mjs');
  const base = "it('a', () => { expect(1).toBe(1); expect(2).toBe(2); });\nit('b', () => {});\n";
  assert.deepEqual(testShape(base).cases, ['a', 'b']);
  assert.deepEqual(weakenings(base, base), []);
  assert.match(weakenings(base, base.replace("it('b'", "it.only('b'"))[0], /^adds a skip or focus/);
  assert.deepEqual(
    weakenings(base, "it('a', () => { expect(1).toBe(1); expect(2).toBe(2); });\n"),
    ['has 1 fewer test case ("b" gone)'],
  );
  assert.deepEqual(weakenings(base, base.replace(' expect(2).toBe(2);', '')), [
    'has 1 fewer assertion (2 → 1)',
  ]);
  // Making an assertion retry, or soft, keeps it an assertion.
  assert.deepEqual(
    weakenings(
      base,
      base.replace('expect(2).toBe(2);', 'await expect.poll(() => 2).toBe(2); expect.soft(3);'),
    ),
    [],
  );
  // A renamed case isn't fewer, and Python, Go and pytest markers count too.
  assert.deepEqual(weakenings(base, base.replace("'b'", "'b, renamed'")), []);
  assert.equal(testShape('def test_x():\n    assert 1\n').cases[0], 'test_x');
  assert.equal(testShape('func TestX(t *testing.T) {}\n').cases[0], 'TestX');
  assert.match(
    weakenings(
      'def test_x():\n    assert 1\n',
      '@pytest.mark.skip\ndef test_x():\n    assert 1\n',
    )[0],
    /skip/,
  );
});

test('REG-2 a deleted test is weakened unless its cases moved; a rewritten snapshot needs the approval', async () => {
  const { weakenedTests } = await import('../hooks/lib/regression.mjs');
  const files = { 'a.test.ts': "it('x', () => {});\nit('y', () => {});\n" };
  const now = { 'b/a.test.ts': files['a.test.ts'], 's/__snapshots__/a.snap': 'new' };
  const before = (f) => ({ ...files, 's/__snapshots__/a.snap': 'old' })[f] ?? null;
  const after = (f) => now[f] ?? null;
  assert.deepEqual(
    weakenedTests(
      [
        { status: 'D', file: 'a.test.ts' },
        { status: 'A', file: 'b/a.test.ts' },
      ],
      before,
      after,
      {},
    ),
    [],
  );
  assert.deepEqual(weakenedTests([{ status: 'D', file: 'a.test.ts' }], before, after, {}), [
    { file: 'a.test.ts', reasons: ['deletes the test file (2 cases)'] },
  ]);
  assert.deepEqual(
    weakenedTests([{ status: 'M', file: 's/__snapshots__/a.snap' }], before, after, {}),
    [{ file: 's/__snapshots__/a.snap', reasons: ['rewrites a snapshot'] }],
  );
  // The config's `tests` globs say what a test is.
  assert.deepEqual(
    weakenedTests([{ status: 'D', file: 'a.test.ts' }], before, after, { tests: ['spec/**'] }),
    [],
  );
});

test('REG-1 a failure that only says the test cannot reach what the fix adds proves nothing', async () => {
  const { onlyUnreachable } = await import('../hooks/lib/regression.mjs');
  assert.equal(
    onlyUnreachable(
      "SyntaxError: The requested module './booking.mjs' does not provide an export named 'cancel'",
    ),
    true,
  );
  assert.equal(onlyUnreachable('TypeError: booking.cancelSlot is not a function'), true);
  assert.equal(
    onlyUnreachable('AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal'),
    false,
  );
  // Both kinds: a real assertion failed too, so it counts.
  assert.equal(
    onlyUnreachable('x is not a function\nAssertionError: Expected values to be equal'),
    false,
  );
});

test('REG-1 the plan says what a story fixes', async () => {
  const { readStories } = await import('../hooks/lib/plan.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'code-kit-plan-'));
  try {
    writeFileSync(
      join(dir, 'plan.md'),
      '### ST-1 Stop double booking\n\n**Lane:** web\n**Requirements:** none\n**Depends on:** none\n**Status:** todo\n**Fixes:** two people could book one slot\n\n### ST-2 Other\n\n**Lane:** web\n**Status:** todo\n',
    );
    const [one, two] = readStories(dir, 'plan.md');
    assert.equal(one.fixes, 'two people could book one slot');
    assert.equal(two.fixes, null);
    assert.equal(one.summary, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("HUBR-2 a story's summary is the paragraph under its fields, on one line", async () => {
  const { readStories } = await import('../hooks/lib/plan.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'code-kit-plan-'));
  try {
    writeFileSync(
      join(dir, 'plan.md'),
      "### ST-1 Booking list\n\n**Lane:** web\n**Status:** todo\n\nThe day's bookings,\nnewest first.\n\nA second paragraph.\n\n### ST-2 Other\n\n**Lane:** web\n",
    );
    const [one, two] = readStories(dir, 'plan.md');
    assert.equal(one.summary, "The day's bookings, newest first.");
    assert.equal(two.summary, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('REG-1 and REG-2 config: tests and regression.prepare', () => {
  const base = { ...fixture };
  assert.deepEqual(
    validate({ ...base, tests: ['spec/**'], regression: { prepare: 'npm ci' } }),
    [],
  );
  assert.ok(validate({ ...base, tests: 'spec/**' }).some((p) => p.startsWith('"tests"')));
  assert.ok(
    validate({ ...base, regression: { prepare: 1 } }).some((p) => p.startsWith('"regression"')),
  );
  const d = withDefaults(base);
  assert.deepEqual([d.tests, d.regression], [[], { prepare: null }]);
});

test('REG-2 the pane asks for a weakened test in words', () => {
  assert.equal(
    prefilledReason({ names: ['tests'], lane: 'web', what: 'apps/office/old.test.mjs' }),
    'Approve a weakened test for the web lane: apps/office/old.test.mjs',
  );
});

// --- spec 22: project standards -----------------------------------------------------------------

const STANDARDS_TEXT = `# Standards

### ARC-2 Domain code doesn't import infrastructure

- **Level:** required
- **Applied:** enforced
- **Layers:** domain
- **Enforced by:** \`layers (domain may not import infrastructure)\`
- **Why:** The domain is tested without a database.
- **Source:** docs/architecture.md

### PAT-1 Data access goes through repositories
level: required
applied: checked
layers: application, domain
source: the code: 41 of 43 modules

## Notes

Prose between standards isn't a field.
`;
const STD_CONFIG = {
  layers: [
    { name: 'domain', paths: ['src/domain/**'], mayImport: [], denyPackages: ['pg'] },
    { name: 'application', paths: ['src/app/**'], mayImport: ['domain'] },
    { name: 'infrastructure', paths: ['src/infra/**'], mayImport: ['domain'] },
    { name: 'web', paths: ['src/web/**'], mayImport: ['application'] },
  ],
  protected: [{ glob: 'docs/specs/**', approval: 'specs', why: 'the specs' }],
  checks: [{ name: 'lint', files: ['**'], run: ['eslint .'] }],
  shell: { block: [{ pattern: 'fly deploy', why: 'Deploying is done by CI.' }] },
};

test('STD-1 the standards file: headings, fields in either form, and its problems', async () => {
  const { parseStandards, standardsProblems, sourceOf } =
    await import('../hooks/lib/standards.mjs');
  const { standards } = parseStandards(STANDARDS_TEXT);
  assert.deepEqual(
    standards.map((s) => [s.id, s.level, s.applied, s.layers.join('+')]),
    [
      ['ARC-2', 'required', 'enforced', 'domain'],
      ['PAT-1', 'required', 'checked', 'application+domain'],
    ],
  );
  assert.equal(standards[0].why, 'The domain is tested without a database.');
  assert.deepEqual(sourceOf(standards[1].source), { kind: 'code', count: 41, of: 43 });
  assert.equal(sourceOf('the threat model in docs/specs/03-payments.md').kind, 'threat-model');
  assert.deepEqual(standardsProblems(standards, STD_CONFIG), []);
  const bad = parseStandards(`### PRI-2 One reason to change
level: required
applied: enforced
### XYZ-1 Something
level: sometimes
applied: checked
### ARC-3 Web goes through the application
level: required
applied: enforced
enforced by: layers (web may not import application)
layers: ui
### ARC-3 Again
level: required
applied: advice
### POL-1 Nothing deploys from a laptop
level: required
applied: enforced
enforced by: shell (CI)
### CON-1 Lint passes
level: required
applied: enforced
enforced by: check (prettier)
`).standards;
  const problems = standardsProblems(bad, STD_CONFIG);
  assert.match(
    problems.join('\n'),
    /PRI-2 is a principle, and a principle can't be enforced, only checked or advised/,
  );
  assert.match(problems.join('\n'), /XYZ-1 has an unknown category/);
  assert.match(problems.join('\n'), /XYZ-1 needs a level: required or recommended/);
  assert.match(
    problems.join('\n'),
    /ARC-3 is enforced by "layers \(web may not import application\)", but web may import application in the config/,
  );
  assert.match(problems.join('\n'), /ARC-3 names the layer "ui", which the config doesn't have/);
  assert.match(problems.join('\n'), /ARC-3 appears twice/);
  assert.match(problems.join('\n'), /CON-1 .*no check is named "prettier"/);
  assert.ok(!problems.some((p) => p.startsWith('POL-1')), 'a shell rule matched by its why');
  // Without a config (an organisation's files), only the standards themselves are checked.
  assert.ok(standardsProblems(bad).every((p) => !/config/.test(p)));
});

test('STD-3 a lane gets the standards for its layers only, one line each', async () => {
  const { appliesTo, laneLayers, standardLine, parseStandards } =
    await import('../hooks/lib/standards.mjs');
  const [arc2, pat1] = parseStandards(STANDARDS_TEXT).standards;
  const api = laneLayers({ paths: ['src/app/**'] }, STD_CONFIG);
  assert.deepEqual(api, ['application']);
  assert.equal(appliesTo(arc2, api), false);
  assert.equal(appliesTo(pat1, api), true);
  assert.equal(
    appliesTo({ layers: [] }, api),
    true,
    'a standard for all layers applies everywhere',
  );
  assert.equal(
    standardLine(pat1),
    'PAT-1 Data access goes through repositories (required, checked)',
  );
});

test('STD-4 a refusal from the rule an enforced standard names says which standard it is', async () => {
  const { standardsNote, parseStandards, ruleOf } = await import('../hooks/lib/standards.mjs');
  const { brokenLayerRule } = await import('../hooks/lib/layers.mjs');
  const standards = parseStandards(STANDARDS_TEXT).standards;
  assert.deepEqual(ruleOf('layers (domain may not import the package pg)'), {
    kind: 'layers',
    from: 'domain',
    package: 'pg',
  });
  assert.deepEqual(ruleOf('protected (specs)'), { kind: 'protected', name: 'specs' });
  assert.equal(ruleOf('the reviewer'), null);
  const problems = layerProblems(
    'src/domain/order.ts',
    "import { db } from '../infra/db';\nimport pg from 'pg';\n",
    { ...STD_CONFIG, importAliases: {} },
  );
  assert.deepEqual(problems.map(brokenLayerRule), [
    { kind: 'layers', from: 'domain', to: 'infrastructure' },
    { kind: 'layers', from: 'domain', package: 'pg' },
  ]);
  assert.equal(
    standardsNote(standards, problems.map(brokenLayerRule)),
    " This is the project's standard ARC-2: Domain code doesn't import infrastructure.",
  );
  // A checked standard names no rule, so no refusal claims it.
  assert.equal(standardsNote(standards, { kind: 'check', name: 'lint' }), '');
  const lint = parseStandards(
    '### CON-1 Lint passes\nlevel: required\napplied: enforced\nenforced by: check (lint)\n',
  ).standards;
  assert.match(standardsNote(lint, { kind: 'check', name: 'lint' }), /CON-1: Lint passes/);
  const specs = parseStandards(
    '### POL-2 Specs change by the person\nlevel: required\napplied: enforced\nenforced by: protected (specs)\n',
  ).standards;
  assert.match(
    standardsNote(specs, { kind: 'protected', name: 'specs', glob: 'docs/specs/**' }),
    /POL-2/,
  );
});

test('STD-5 removing a standard, or weakening a required one, is a weakening; adding one is not', async () => {
  const { standardsWeakenings } = await import('../hooks/lib/standards.mjs');
  assert.deepEqual(standardsWeakenings(STANDARDS_TEXT, STANDARDS_TEXT), []);
  const removed = STANDARDS_TEXT.replace(/### PAT-1[\s\S]*?(?=## Notes)/, '');
  assert.deepEqual(standardsWeakenings(STANDARDS_TEXT, removed), [
    'PAT-1 (Data access goes through repositories) is removed',
  ]);
  const softer = STANDARDS_TEXT.replace('applied: checked', 'applied: advice');
  assert.match(
    standardsWeakenings(STANDARDS_TEXT, softer)[0],
    /^PAT-1 goes from required and checked .* to required and advice/,
  );
  const fewer = STANDARDS_TEXT.replace('layers: application, domain', 'layers: domain');
  assert.equal(standardsWeakenings(STANDARDS_TEXT, fewer).length, 1);
  const added = `${STANDARDS_TEXT}\n### CON-3 Tests sit beside their code\nlevel: recommended\napplied: advice\n`;
  assert.deepEqual(standardsWeakenings(STANDARDS_TEXT, added), []);
});

test('STD-6 an organisation’s standards: inherited, extended, tightened, and weakened only by a waiver', async () => {
  const { mergeStandards } = await import('../hooks/lib/standards.mjs');
  const org = (id, level, applied, layers = []) => ({ id, title: id, level, applied, layers });
  const own = (id, level, applied, layers = []) => ({
    id,
    title: `${id} here`,
    level,
    applied,
    layers,
  });
  const { standards, problems } = mergeStandards(
    [
      own('ARC-2', 'recommended', 'checked'),
      own('PAT-1', 'required', 'checked'),
      own('CON-1', 'recommended', 'advice', ['web']),
      own('POL-9', 'required', 'checked'),
    ],
    [
      org('ARC-2', 'required', 'checked'),
      org('PAT-1', 'recommended', 'advice'),
      org('CON-1', 'recommended', 'advice', ['domain']),
      org('POL-3', 'required', 'checked'),
    ],
  );
  const by = Object.fromEntries(standards.map((s) => [s.id, s]));
  assert.match(
    problems[0],
    /^ARC-2 can't be weakened without a waiver: the organisation has it required and checked, and this project marks it recommended and checked/,
  );
  assert.equal(by['ARC-2'].level, 'required');
  assert.equal(by['ARC-2'].origin, 'inherited');
  assert.equal(by['PAT-1'].origin, 'tightened');
  assert.equal(by['PAT-1'].level, 'required');
  assert.equal(by['CON-1'].origin, 'extended');
  assert.deepEqual(by['CON-1'].layers, ['domain', 'web']);
  assert.equal(by['POL-3'].origin, 'inherited');
  assert.equal(by['POL-9'].origin, 'own');

  const waived = mergeStandards(
    [own('ARC-2', 'recommended', 'checked')],
    [org('ARC-2', 'required', 'checked')],
    [{ standard: 'ARC-2', paths: [], expires: '2099-01-01', approvedBy: 'hana' }],
  );
  assert.deepEqual(waived.problems, []);
  assert.equal(waived.standards[0].level, 'recommended');
  assert.equal(waived.standards[0].origin, 'waived');
  // A waiver for some paths leaves the standard in full everywhere else.
  const some = mergeStandards(
    [own('ARC-2', 'recommended', 'checked')],
    [org('ARC-2', 'required', 'checked')],
    [{ standard: 'ARC-2', paths: ['migrations/**'], expires: '2099-01-01' }],
  );
  assert.equal(some.standards[0].level, 'required');
  assert.deepEqual(some.standards[0].waiver.paths, ['migrations/**']);
  // An expired waiver allows nothing.
  const expired = mergeStandards(
    [own('ARC-2', 'recommended', 'checked')],
    [org('ARC-2', 'required', 'checked')],
    [{ standard: 'ARC-2', paths: [], expires: '2020-01-01' }],
  );
  assert.equal(expired.problems.length, 1);
});

test('spec 22 a report carries the standards, its why in one line at most; an older report without them is still valid', async () => {
  const { snapshotProblems, SNAPSHOT_SCHEMA, LATER_PARTS } =
    await import('../hooks/lib/snapshot.mjs');
  assert.ok(LATER_PARTS.includes('standards') && 'standards' in SNAPSHOT_SCHEMA);
  const standard = {
    id: 'PAT-1',
    title: 'Data access goes through repositories',
    category: 'patterns',
    level: 'required',
    applied: 'checked',
    layers: ['domain'],
    source: 'code',
    evidenceCount: 41,
    evidenceOf: 43,
    origin: 'own',
    why: 'One place for queries.',
  };
  const shape = (standards) =>
    snapshotProblems(standards, SNAPSHOT_SCHEMA.standards, 'snapshot.standards');
  assert.deepEqual(shape([standard]), []);
  assert.match(shape([{ ...standard, why: 'line one\nline two' }])[0], /why: not a line/);
  assert.match(
    shape([{ ...standard, evidence: 'the 41 files' }])[0],
    /evidence: not a field a report may hold/,
  );
  assert.match(shape([{ ...standard, category: 'style' }])[0], /category: not one of/);
});

test('CIC-2 the workflows a project already has: their triggers, jobs and steps, as GitHub writes them', async () => {
  const { parseYaml, triggersOf } = await import('../hooks/lib/ci.mjs');
  const doc = parseYaml(
    [
      'name: ci # the main one',
      'on:',
      '  push:',
      '    branches:',
      '      - main',
      "      - 'release/**'",
      '  pull_request:',
      'jobs:',
      '  check:',
      '    runs-on: ubuntu-latest',
      '    timeout-minutes: 20',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '        with:',
      '          fetch-depth: 0',
      '      - name: Test',
      '        run: |',
      '          pnpm test',
      '          pnpm lint',
    ].join('\n'),
  );
  assert.deepEqual(doc.on.push.branches, ['main', 'release/**']);
  assert.equal(doc.jobs.check['timeout-minutes'], 20);
  assert.deepEqual(doc.jobs.check.steps[0], {
    uses: 'actions/checkout@v4',
    with: { 'fetch-depth': 0 },
  });
  assert.equal(doc.jobs.check.steps[1].run, 'pnpm test\npnpm lint');
  assert.deepEqual(Object.keys(triggersOf(parseYaml('on: [push, pull_request]\n'))), [
    'push',
    'pull_request',
  ]);
  assert.deepEqual(Object.keys(triggersOf(parseYaml('on: push\n'))), ['push']);
});

test('CIC-2 what multiplies a workflow’s cost with a story per branch, each with its fix', async () => {
  const { workflowFindings } = await import('../hooks/lib/ci.mjs');
  const kinds = (text, base = 'main') => workflowFindings('ci.yml', text, base).map((f) => f.kind);
  const job = (extra = '') =>
    `jobs:\n  check:\n    runs-on: ubuntu-latest\n${extra}    steps:\n      - run: pnpm test\n`;
  assert.deepEqual(kinds(`on:\n  push:\n    branches: [main]\n${job()}`), [
    'every-merge',
    'no-timeout',
  ]);
  assert.deepEqual(kinds(`on:\n  push:\n${job('    timeout-minutes: 30\n')}`), ['every-merge']);
  assert.deepEqual(
    kinds(`on:\n  push:\n    branches: [main]\n${job('    timeout-minutes: 30\n')}`, 'master'),
    [],
  );
  assert.deepEqual(
    kinds(`on:\n  push:\n    tags: ['v*']\n${job('    timeout-minutes: 30\n')}`),
    [],
  );
  assert.deepEqual(kinds(`on:\n  pull_request:\n${job('    timeout-minutes: 30\n')}`), [
    'every-pr',
    'no-concurrency',
  ]);
  assert.deepEqual(
    kinds(
      `on:\n  pull_request:\n    paths: ['api/**']\nconcurrency:\n  group: x\n  cancel-in-progress: true\n${job('    timeout-minutes: 30\n')}`,
    ),
    [],
  );
  assert.deepEqual(
    kinds(`on:\n  push:\n    branches: ['release/**']\n${job('    timeout-minutes: 30\n')}`),
    [],
  );
  const old = `on:\n  pull_request:\nconcurrency:\n  group: x\n  cancel-in-progress: true\njobs:\n  verify:\n    timeout-minutes: 10\n    steps:\n      - run: >\n          npx --yes @warren-dean/code-kit@0.23.0 verify\n          --base origin/main\n`;
  assert.deepEqual(kinds(old), ['code-kit-checks']);
  assert.deepEqual(kinds(old.replace('verify\n', 'verify --no-checks\n')), []);
  const [f] = workflowFindings(
    'ci.yml',
    `on:\n  push:\n    branches: [main]\n${job('    timeout-minutes: 9\n')}`,
    'main',
  );
  assert.match(f.what, /runs on every push to main, so once per story merged/);
  assert.match(f.fix, /release\/\*\*/);
});

test('CIC-4 the runs summed by workflow and trigger, most minutes first, cancelled and failed counted', async () => {
  const { usageSummary } = await import('../hooks/lib/ci.mjs');
  const run = (name, event, minutes, conclusion = 'success') => ({
    name,
    event,
    conclusion,
    run_started_at: '2026-10-20T00:00:00Z',
    updated_at: new Date(Date.parse('2026-10-20T00:00:00Z') + minutes * 60000).toISOString(),
  });
  const u = usageSummary([
    run('ci', 'push', 26),
    run('ci', 'push', 27, 'failure'),
    run('code-kit', 'pull_request', 1),
    run('ci', 'pull_request', 20, 'cancelled'),
  ]);
  assert.equal(u.runs, 4);
  assert.equal(u.minutes, 74);
  assert.deepEqual(
    u.rows.map((r) => `${r.workflow} ${r.event} ${r.runs} ${r.minutes} ${r.cancelled} ${r.failed}`),
    ['ci push 2 53 0 1', 'ci pull_request 1 20 1 0', 'code-kit pull_request 1 1 0 0'],
  );
});

test('MQ-5 the story branches a command merges, and the branch each lands on', () => {
  assert.deepEqual(
    storyMerges('git merge --no-ff -m "Merge web/st-9 into x" web/st-2', 'lead/next'),
    [{ story: 'web/st-2', into: 'lead/next' }],
  );
  assert.deepEqual(storyMerges('git checkout lead/next && git merge origin/data/st-2', 'main'), [
    { story: 'data/st-2', into: 'lead/next' },
  ]);
  assert.deepEqual(storyMerges('git -C ../x merge api/st-3 web/st-4', 'lead/next'), [
    { story: 'api/st-3', into: 'lead/next' },
    { story: 'web/st-4', into: 'lead/next' },
  ]);
  assert.deepEqual(storyMerges('git merge main', 'web/st-2'), []);
  assert.deepEqual(storyMerges('git merge --abort', 'lead/next'), []);
  assert.deepEqual(storyMerges('git commit -m "git merge web/st-2"', 'lead/next'), []);
});

test("MQ-6 a publishing pull request's title names the stories it holds", () => {
  assert.equal(publishTitle(['web/st-1'], 1), 'ST-1 from the code-kit queue');
  assert.equal(publishTitle(['web/st-1', 'api/st-2'], 2), 'ST-1 and ST-2 from the code-kit queue');
  assert.equal(
    publishTitle(['web/st-1', 'api/st-2', 'x/st-3', 'y/st-4'], 4),
    'ST-1, ST-2 and 2 more from the code-kit queue',
  );
  assert.equal(publishTitle([], 3), '3 commits from code-kit');
});

test('DUR-1 each tool call is classified by what it does, with its target', async () => {
  const { classify } = await import('../hooks/lib/events.mjs');
  const config = {
    shell: { block: [{ pattern: 'supabase db push' }], restricted: [] },
    checks: [{ run: ['make check'] }],
    protected: [{ glob: 'supabase/migrations/**', approval: 'migration' }],
    execution: { unrepeatable: ['^npm run seed'] },
  };
  const kind = (tool, input) => classify(tool, input, config).kind;
  assert.equal(kind('Edit', { file_path: 'a.ts' }), 'edit');
  assert.equal(kind('Grep', { pattern: 'x' }), 'read');
  assert.equal(kind('Bash', { command: 'npm test' }), 'test');
  assert.equal(kind('Bash', { command: 'make check' }), 'test');
  assert.equal(kind('Bash', { command: 'git add -A && git commit -m x' }), 'commit');
  assert.equal(kind('Bash', { command: 'git push origin web/st-4' }), 'push');
  assert.equal(kind('Bash', { command: 'npm install zod' }), 'install');
  assert.equal(kind('Bash', { command: 'node /k/code-kit.mjs queue merge --delegated' }), 'merge');
  assert.equal(kind('Bash', { command: 'node /k/code-kit.mjs queue add web/st-4' }), 'queue');
  assert.equal(kind('Bash', { command: 'psql -f supabase/migrations/1.sql' }), 'unrepeatable');
  assert.equal(kind('Bash', { command: 'npm run seed' }), 'unrepeatable');
  assert.equal(kind('Bash', { command: 'supabase db push' }), 'unrepeatable');
  assert.equal(kind('Bash', { command: 'ls' }), 'run');
  assert.equal(
    kind('Agent', { description: 'ST-4 booking', subagent_type: 'web-engineer' }),
    'dispatch',
  );
  assert.equal(
    classify('Bash', { command: 'git commit -m "echo git merge web/st-2"' }, config).kind,
    'commit',
  );
});

test('DUR-2 a command is recorded with its credentials masked, at most 300 characters', async () => {
  const { maskCommand } = await import('../hooks/lib/events.mjs');
  const masked = maskCommand(
    'curl -H "Authorization: Bearer abc123" https://u:pw@x API_TOKEN=zzz --password hunter2',
  );
  for (const secret of ['abc123', 'pw@', 'zzz', 'hunter2'])
    assert.ok(!masked.includes(secret), masked);
  assert.equal(maskCommand('x'.repeat(400)).length, 300);
});

test('DUR-3 replay rebuilds a story from its events, and lists what was left open', async () => {
  const { replay } = await import('../hooks/lib/events.mjs');
  const e = (act, phase, kind, extra = {}) => ({
    act,
    phase,
    kind,
    actor: extra.actor ?? 'web',
    at: extra.at ?? '2026-10-26T10:00:00.000Z',
    target: extra.target ?? null,
    branch: 'web/st-4',
    result: extra.result,
  });
  const state = replay([
    e('d', 'start', 'dispatch', { actor: 'lead' }),
    e('d', 'end', 'dispatch', { actor: 'lead', result: { ok: true } }),
    e('a', 'start', 'edit', { target: 'apps/w.ts' }),
    e('a', 'end', 'edit', { target: 'apps/w.ts', result: { ok: true } }),
    e('t', 'start', 'test', { target: 'npm test' }),
    e('t', 'end', 'test', { target: 'npm test', result: { ok: true, test: 'passed' } }),
    e('c', 'start', 'commit'),
    e('c', 'end', 'commit', { result: { ok: true, sha: 'abc1234' } }),
    e('b', 'start', 'edit', { target: 'apps/x.ts' }),
    e('b', 'end', 'edit', { target: 'apps/x.ts', result: { ok: true } }),
    e('z', 'start', 'edit', { target: 'apps/y.ts' }),
  ]);
  assert.equal(state.phase, 'building');
  assert.equal(state.branch, 'web/st-4');
  assert.equal(state.lastCommit.sha, 'abc1234');
  assert.equal(state.lastTest.ok, true);
  assert.deepEqual(state.changed, ['apps/x.ts']);
  assert.deepEqual(
    state.open.map((o) => [o.act, o.kind, o.target]),
    [['z', 'edit', 'apps/y.ts']],
  );
  const merged = replay([
    e('m', 'start', 'merge', { actor: 'lead' }),
    e('m', 'end', 'merge', { actor: 'lead', result: { ok: true } }),
  ]);
  assert.equal(merged.phase, 'merged');
});

test('DUR-5 the brief says the last commit, the tests last run, what changed and what is open', async () => {
  const { briefOf } = await import('../hooks/lib/events.mjs');
  const now = Date.parse('2026-10-26T10:30:00Z');
  const brief = briefOf(
    'ST-4',
    {
      lastCommit: { sha: 'abc1234', at: '2026-10-26T10:00:00Z' },
      lastTest: { target: 'npm test', ok: false, at: '2026-10-26T10:20:00Z' },
      changed: ['apps/a.ts', 'apps/b.ts', 'apps/c.ts'],
      reconciled: [{ result: { found: 'not done', how: 'it can safely run again', next: 'x' } }],
      open: [],
      recent: [],
      trimmed: 0,
      lastAt: '2026-10-26T10:25:00Z',
    },
    { now, reportAt: '2026-10-26T10:10:00Z' },
  );
  assert.match(brief, /Last commit: abc1234 \(30 min ago\)/);
  assert.match(brief, /`npm test`, failed/);
  assert.match(brief, /apps\/a\.ts, apps\/b\.ts, apps\/c\.ts/);
  assert.match(brief, /Reconciled: not done/);
  assert.match(brief, /came after the report/);
});

test('DUR-6 a log past its size keeps its first agent event and its last events, saying what went', async () => {
  const { trimLog } = await import('../hooks/lib/events.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'code-kit-trim-'));
  const file = join(dir, 'ST-9.jsonl');
  const lines = [JSON.stringify({ kind: 'dispatch', act: 'first' })];
  for (let i = 0; i < 30; i++) lines.push(JSON.stringify({ kind: 'edit', act: `e${i}` }));
  writeFileSync(file, `${lines.join('\n')}\n`);
  trimLog(file, 10);
  const kept = readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(kept[0].act, 'first');
  assert.equal(kept[1].kind, 'trimmed');
  assert.equal(kept[1].result.dropped, 20);
  assert.deepEqual(
    kept.slice(2).map((k) => k.act),
    Array.from({ length: 10 }, (_, i) => `e${i + 20}`),
  );
});

test('DUR-7 the lane agent template tells it to commit after each step whose tests pass', () => {
  const template = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../templates/agent.md'),
    'utf8',
  );
  assert.match(template, /Commit after each step whose tests pass/);
});

test('UI-11 the characters: a look per lane from its name, every pose and move, motion off', async () => {
  const { charactersOf, characterFrame, characterFrames, characterSvg, workOf, sheet, POSES } =
    await import('../hooks/mod/characters.mjs');
  const nine = [
    'lead',
    'frontend',
    'backend',
    'db',
    'mobile',
    'infra',
    'docs',
    'pay',
    'search',
    'auth',
  ];
  const looks = charactersOf(nine);
  assert.equal(looks.lead.shape, 'crown');
  const lanes = nine.slice(1);
  // Six lanes, six shapes; past six, shape and mark together stay apart.
  assert.equal(new Set(lanes.slice(0, 6).map((l) => looks[l].shape)).size, 6);
  assert.equal(new Set(lanes.map((l) => `${looks[l].shape}/${looks[l].mark}`)).size, 9);
  assert.ok(lanes.slice(0, 6).every((l) => looks[l].mark === null));
  // A lane added later changes no other lane's look.
  const more = charactersOf([...nine, 'reports']);
  for (const l of nine) assert.deepEqual(more[l], looks[l]);
  // The look comes from the name, not the place: the same lane alone looks the same as first.
  assert.deepEqual(charactersOf(['lead', 'frontend']).frontend, looks.frontend);
  // Every pose and move draws 8 by 8; loops have four frames that differ.
  const c = looks.frontend;
  for (const pose of Object.keys(POSES)) {
    const frames = characterFrames(pose, c);
    assert.equal(frames.length, POSES[pose].frames);
    for (const g of frames) assert.ok(g.length === 8 && g.every((r) => r.length === 8));
  }
  // Every frame of a loop is its own, so it never seems to stall or repeat early.
  for (const pose of ['writing', 'running', 'reading', 'thinking']) {
    const frames = characterFrames(pose, c).map((g) => JSON.stringify(g));
    assert.equal(new Set(frames).size, 4, pose);
  }
  // Without colour, shapes differ: the lit pixels of two lanes' resting pose aren't the same.
  const lit = (g) => g.map((r) => r.map((x) => (x === null ? 0 : 1)).join('')).join('/');
  assert.notEqual(
    lit(characterFrame('resting', 0, looks.frontend)),
    lit(characterFrame('resting', 0, looks.backend)),
  );
  // Motion off: a loop holds its first frame, a move its last.
  assert.deepEqual(
    characterFrame('running', 3, c, { motion: 'off' }),
    characterFrame('running', 0, c),
  );
  assert.deepEqual(
    characterFrame('merged', 0, c, { motion: 'off' }),
    characterFrame('merged', 3, c),
  );
  assert.match(characterSvg('writing', c), /repeatCount="indefinite"/);
  assert.match(characterSvg('merged', c), /fill="freeze"/);
  assert.doesNotMatch(characterSvg('writing', c, { motion: 'off' }), /<animate/);
  // The kind of work, from the agent's current tool.
  assert.equal(workOf('Edit'), 'writing');
  assert.equal(workOf('Bash'), 'running');
  assert.equal(workOf('Grep'), 'reading');
  assert.equal(workOf(null), 'thinking');
  // The sheet: the lead first, then the project's own lanes, in every pose.
  const s = sheet(['web', 'api']);
  assert.deepEqual(
    s.rows.map((r) => r.lane),
    ['lead', 'web', 'api'],
  );
  assert.equal(s.poses.length, 12);
});

// --- spec 27: the mod, redesigned ---------------------------------------------------------------------

/** Stand-ins for every element the pane draws. */
const drawing = {
  ...el,
  Client: (props) => ({ type: 'Client', props, children: [] }),
  Raster: (props) => ({ type: 'Raster', props, children: [] }),
  Svg: (props) => ({ type: 'Svg', props, children: [] }),
  Select: (props) => ({ type: 'Select', props, children: [] }),
  Code: (props) => ({ type: 'Code', props, children: [] }),
};

/**
 * UI-13: the fewest columns a tree can be laid out in: text that wraps or is cut takes one, fixed text
 * its length, a row the sum of its children (or the widest, where it wraps), a column the widest, a
 * drawing cut at its edge one, each with its frame.
 */
function minWidth(n) {
  if (!n || typeof n !== 'object') return 0;
  const p = n.props ?? {};
  const frame = (p.borderStyle ? 2 : 0) + 2 * (p.paddingX ?? 0) + (p.marginLeft ?? 0);
  if (n.type === 'Text') return p.wrap ? 1 : [...String(n.children.join(''))].length;
  if (n.type === 'Button') return [...String(p.label)].length + (p.plain ? 0 : 2);
  if (n.type === 'Input' || n.type === 'Select') return 12;
  if (n.type === 'Code') return 1;
  if (n.type === 'Client' || n.type === 'Raster') return p.width ?? p.columns ?? 6;
  if (n.type === 'Svg') return Math.ceil((p.width ?? 48) / 8);
  if (p.overflow === 'hidden') return frame + 1;
  const kids = n.children.filter(Boolean).map(minWidth);
  const row = (p.flexDirection ?? 'row') === 'row' && p.flexWrap !== 'wrap';
  const inner = !kids.length
    ? 0
    : row
      ? kids.reduce((a, b) => a + b, 0) + (p.columnGap ?? 0) * (kids.length - 1)
      : Math.max(...kids);
  const fixed = typeof p.width === 'number' && p.flexShrink !== 1 ? p.width : 0;
  return Math.max(fixed, inner + frame);
}

/** A busy project: five lanes, three at work, long titles, ten requirements each, a queue and a log. */
async function busyProject() {
  const { needsOf } = await import('../hooks/mod/board.mjs');
  const names = ['web', 'api', 'payments', 'notifications', 'core'];
  const lanes = Object.fromEntries(names.map((n) => [n, { agent: `${n}-engineer`, paths: [] }]));
  const stories = names.map((lane, i) => ({
    id: `ST-${i + 4}`,
    title: `A long story title for the ${lane} lane that goes on and on`,
    lane,
    state: i < 3 ? 'in progress' : i === 3 ? 'review' : 'blocked',
    branch: `${lane}/st-${i + 4}`,
    requirements: Array.from({ length: 10 }, (_, r) => `BOOK-${r + 1}`),
    waitingOn: i === 4 ? ['ST-4'] : [],
    milestone: 'Milestone 3: Booking and payments for classes',
  }));
  const status = {
    problems: [],
    stories,
    requirements: Array.from({ length: 10 }, (_, i) => ({
      id: `BOOK-${i + 1}`,
      state: i < 4 ? 'done' : 'in progress',
      tests: i < 2 ? ['b.test.ts'] : [],
      stories: ['ST-4'],
    })),
  };
  const state = projectState(
    { exists: true, valid: true, problems: [], lanes },
    status,
    null,
    new Set(['web-engineer', 'api-engineer', 'payments-engineer']),
  );
  const request = {
    at: 'x',
    actor: 'web-engineer',
    lane: 'web',
    names: ['dep-dayjs'],
    what: 'npm install dayjs --save-exact',
  };
  const needs = needsOf(
    bandLines({
      state,
      requests: { open: [request, { ...request, lane: 'api', names: ['dep-zod'] }] },
      stops: [],
      held: [
        {
          id: 'h',
          who: 'payments',
          kind: 'dependency',
          names: ['dep-stripe'],
          lane: 'payments',
          what: 'npm i stripe',
          since: 0,
          minutes: 2,
        },
      ],
      now: 0,
      loop: { state: 'running' },
    }),
  );
  return {
    state,
    status,
    needs,
    loop: {
      state: 'running',
      started: true,
      nextText: 'Review ST-7, then Dispatch ST-9 ST-10 ST-11',
      laneNotes: { api: 'nudged' },
      reviews: [],
      queue: [
        { branch: 'notifications/st-7', commit: 'abcdef123', state: 'waiting' },
        { branch: 'core/st-2', state: 'sent back', reason: 'conflicts with main after a merge' },
      ],
    },
    live: {
      web: { tool: 'Bash npm test -- --run apps/web/booking', ago: 'now', at: 0 },
      api: { tool: 'Edit apps/api/booking/routes.ts', ago: '12s ago', at: 0, level: 'quiet' },
    },
    leadBusy: true,
    journal: Array.from({ length: 8 }, (_, i) => ({
      at: i * 60000,
      kind: i % 2 ? 'merge' : 'dispatch',
      story: `ST-${4 + (i % 5)}`,
      text: 'x',
    })),
    art: { surface: 'terminal', motion: 'while-active', bars: { web: Array(40).fill('building') } },
    now: 60000,
    combined: { web: { without: 2, owed: 3 } },
    usage: { lanes: { web: 120000 } },
  };
}

test('UI-13 nothing in the pane spills past its box, docked, inline or on Desktop, at every width from 24 to 120', async () => {
  const { board, bandOf } = await import('../hooks/mod/board.mjs');
  const view = await busyProject();
  const spills = [];
  for (let columns = 24; columns <= 120; columns++) {
    for (const [name, extra] of [
      ['docked, web selected', { ui: { sel: { kind: 'lane', id: 'web' } }, rows: 200 }],
      ['docked, a resting lane selected', { ui: { sel: { kind: 'lane', id: 'core' } }, rows: 200 }],
      ['docked, few rows', { rows: 20 }],
      ['inline', { placement: 'inline' }],
      ['desktop', { art: { surface: 'desktop', motion: 'while-active' }, rows: 200 }],
    ]) {
      const tree = board({ ...view, placement: 'dock', columns, ...extra }, drawing, {});
      if (minWidth(tree) > columns) spills.push(`${name} at ${columns}: ${minWidth(tree)}`);
    }
    const band = bandOf({ ...view, columns }, drawing, () => {});
    if (minWidth(band) > columns) spills.push(`band at ${columns}: ${minWidth(band)}`);
  }
  assert.deepEqual(spills, []);
});

test('UI-13 nothing in the full views spills past its box at every width from 24 to 120', async () => {
  const { sheetView, viewFrame } = await import('../hooks/mod/board.mjs');
  const { journalTab, decisionsTab, mapTab, codeTab, storyPane } =
    await import('../hooks/mod/panes.mjs');
  const { decisionCards } = await import('../hooks/mod/decisions.mjs');
  const { state, needs } = await busyProject();
  const cards = decisionCards(needs, { state, status: { requirements: [] }, check: {} });
  const requirements = Array.from({ length: 30 }, (_, i) => ({
    id: `BOOK-${i + 1}`,
    title: `Requirement number ${i + 1} with words`,
    file: 'docs/specs/01-booking.md',
    state: i < 20 ? 'done' : 'todo',
    tests: i < 10 ? ['a.test.ts'] : [],
    stories: ['ST-4'],
  }));
  const trail = {
    requirements: requirements.slice(0, 5).map((r) => ({
      ...r,
      spec: '01-booking.md',
      stories: [{ id: 'ST-4', state: 'in progress', lane: 'web' }],
      files: ['apps/web/a.ts'],
    })),
  };
  const map = {
    story: { id: 'ST-4', title: 'Booking form', lane: 'web', state: 'in progress' },
    layers: ['domain', 'services', 'tests'],
    files: [
      { path: 'apps/web/domain/booking.ts', layer: 'domain', lane: 'web', imports: [] },
      { path: 'apps/web/services/book.ts', layer: 'services', lane: 'web', imports: [] },
      { path: 'apps/web/e2e/book.spec.ts', layer: 'tests', lane: 'web', imports: [] },
    ],
  };
  const story = {
    id: 'ST-4',
    title: 'Booking form for classes with a long title',
    lane: 'web',
    state: 'review',
    branch: 'web/st-4-booking-form',
    requirements: [
      {
        id: 'BOOK-1',
        title: 'Request a booking',
        spec: 'docs/spec/01.md',
        state: 'todo',
        tests: [],
      },
    ],
    specCheck: { rows: [{ requirement: 'BOOK-1', status: 'partial', where: 'a.tsx', note: 'x' }] },
    diff: {
      files: [{ path: 'apps/web/components/booking/very/deep/form.tsx', added: 2, removed: 0 }],
      text: 'diff --git a/a b/a\n--- /dev/null\n+++ b/a\n@@ -0,0 +1 @@\n+a\n',
    },
    verify: { checks: false, where: 'a worktree', problems: { Ownership: ['x'], Checks: [] } },
  };
  const views = {
    characters: () => sheetView(['web', 'api', 'payments'], drawing),
    journal: () =>
      journalTab(
        Array.from({ length: 6 }, (_, i) => ({
          at: i * 3600000,
          kind: 'merge',
          text: 'x '.repeat(40),
        })),
        drawing,
        0,
      ),
    decision: () => decisionsTab(cards, { decision: 0 }, drawing, {}),
    trail: (columns) =>
      mapTab({ requirements }, 'BOOK-3', drawing, {}, trail, { surface: 'terminal', columns }),
    code: (columns) =>
      codeTab(
        {
          state,
          ui: { selected: 'web', mapStory: 'ST-4' },
          codeMap: map,
          art: { tints: {} },
          columns,
        },
        drawing,
        {},
      ),
    story: (columns) =>
      storyPane(
        {
          story: { id: 'ST-4', lane: 'web', data: story },
          steps: [],
          actions: [{ id: 'review', label: 'Review', hotkey: 'r' }],
          now: 0,
          columns,
        },
        drawing,
        {},
      ),
  };
  const spills = [];
  for (const [name, draw] of Object.entries(views))
    for (let columns = 24; columns <= 120; columns++) {
      const tree = viewFrame(name, draw(columns), drawing, {});
      if (minWidth(tree) > columns) spills.push(`${name} at ${columns}: ${minWidth(tree)}`);
    }
  assert.deepEqual(spills, []);
});

test('UI-10 the layout for each space, and when the lanes are cards or swimlanes', async () => {
  const { layoutOf, lanesAs, CARD_ROWS } = await import('../hooks/mod/board.mjs');
  assert.equal(layoutOf('inline', 200), 'inline');
  assert.equal(layoutOf('dock', 109), 'docked');
  assert.equal(layoutOf('dock', 110), 'wide');
  assert.equal(lanesAs(3, { columns: 80, rows: 3 * CARD_ROWS }), 'cards');
  assert.equal(lanesAs(3, { columns: 80, rows: 3 * CARD_ROWS - 1 }), 'swimlanes');
  assert.equal(lanesAs(4, { columns: 100, rows: 2 * CARD_ROWS }), 'cards');
  assert.equal(lanesAs(1, { columns: 30, rows: 100 }), 'swimlanes');
  // Inline, the pane is at most four lines.
  const { board } = await import('../hooks/mod/board.mjs');
  const inline = board({ ...(await busyProject()), placement: 'inline', columns: 80 }, drawing, {});
  assert.ok(inline.children.length <= 4);
});

test('UI-2 the Build bar: requirements by kind, the milestone the plan names, untested not done', async () => {
  const { buildProgress, buildBar, buildWords, buildState } =
    await import('../hooks/mod/board.mjs');
  const state = {
    stories: [
      { id: 'ST-1', state: 'done', milestone: 'M1', requirements: ['A-1'] },
      { id: 'ST-2', state: 'review', milestone: 'M2', requirements: ['B-1', 'B-2', 'B-3'] },
    ],
  };
  const status = {
    requirements: [
      { id: 'A-1', state: 'done', tests: ['a'] },
      { id: 'B-1', state: 'done', tests: ['b'] },
      { id: 'B-2', state: 'done', tests: [] },
      { id: 'B-3', state: 'todo', tests: [] },
      { id: 'X-1', state: 'removed', tests: [] },
    ],
  };
  const p = buildProgress(state, status);
  assert.deepEqual(
    { name: p.name, total: p.total, tested: p.tested, untested: p.untested, todo: p.todo },
    { name: 'M2', total: 3, tested: 1, untested: 1, todo: 1 },
  );
  assert.equal(buildWords(p), 'M2 · 1 of 3 tested · 1 untested');
  const runs = buildBar(p, 12);
  assert.deepEqual(
    runs.map((r) => `${r.kind}:${r.n}:${r.glyph}`),
    ['tested:4:■', 'untested:4:□', 'todo:4:○'],
  );
  assert.equal(
    runs.reduce((n, r) => n + r.n, 0),
    12,
  );
  assert.equal(buildProgress(state, { requirements: [] }), null);
  assert.equal(buildState({ state: 'running' }, { atWork: 2 }), 'moving');
  assert.equal(buildState({ state: 'running' }), 'still');
  assert.equal(buildState({ state: 'paused' }, { atWork: 2 }), 'paused');
});

test('UI-3 and UI-8 what needs the person, most urgent first, each its own line, numbered in that order', async () => {
  const { needsOf } = await import('../hooks/mod/board.mjs');
  const line = (kind, actions = ['x']) => ({
    kind,
    text: kind,
    actions: actions.map((id) => ({ id, label: id })),
  });
  const ordered = needsOf([
    line('usage', ['lanes']),
    line('approvals', ['approve']),
    {
      ...line('held', ['approveHeld', 'refuseHeld']),
      calls: [
        { text: 'a', held: {} },
        { text: 'b', held: {} },
      ],
    },
    line('question', ['openDecision']),
    { kind: 'goal', mission: true, text: 'goal', actions: [] },
  ]);
  assert.deepEqual(
    ordered.map((l) => `${l.kind}:${l.text}`),
    ['held:a', 'held:b', 'question:question', 'approvals:approvals', 'usage:usage'],
  );
  assert.deepEqual(
    ordered.flatMap((l) => l.actions.map((a) => a.hotkey)),
    ['1', '2', '3', '4', '5', '6', '7'],
  );
});

test("UI-4 a story's trail and map in miniature", async () => {
  const { trailCells, mapChips, lanesAtWork } = await import('../hooks/mod/board.mjs');
  const status = {
    requirements: [
      { id: 'A-1', state: 'done', tests: ['a'] },
      { id: 'A-2', state: 'todo', tests: [] },
    ],
  };
  assert.deepEqual(
    trailCells({ requirements: ['A-1', 'A-2', 'A-9'] }, status).map((c) => `${c.cell}${c.glyph}`),
    ['tested■', 'todo○', 'todo○'],
  );
  const map = {
    layers: ['ui', 'domain'],
    files: [
      { path: 'a.tsx', layer: 'ui', adapters: { cg: { card: { state: 'current' } } } },
      { path: 'b.ts', layer: 'domain', adapters: { cg: { card: { state: 'stale' } } } },
    ],
  };
  assert.deepEqual(
    mapChips(map).map((c) => `${c.layer}:${c.tone}`),
    ['ui:null', 'domain:amber'],
  );
  assert.deepEqual(
    mapChips(map, { refused: [{ layer: 'ui', path: 'a.tsx' }] }).map((c) => `${c.layer}:${c.tone}`),
    ['ui:red', 'domain:amber'],
  );
  assert.deepEqual(
    mapChips(map, { refused: [{ layer: null, path: 'x' }] }).map((c) => c.layer),
    ['ui', 'domain', 'refused'],
  );
  assert.deepEqual(
    mapChips({ layers: ['ui'], files: [{ path: 'a.tsx', layer: 'ui' }] }, { owed: ['a.tsx'] }).map(
      (c) => c.tone,
    ),
    ['amber'],
  );
  const state = {
    lanes: [
      { name: 'lead', state: 'idle' },
      { name: 'web', state: 'building', active: true },
      { name: 'api', state: 'idle' },
      { name: 'core', state: 'idle' },
    ],
  };
  const { atWork, resting } = lanesAtWork(state, [], { core: 'nudged' });
  assert.deepEqual(
    atWork.map((l) => l.name),
    ['web', 'core'],
  );
  assert.deepEqual(
    resting.map((l) => l.name),
    ['lead', 'api'],
  );
});

test('UI-5 and UI-7 the log, a line each, and one word, colour and glyph per state everywhere', async () => {
  const { logLines, STATE } = await import('../hooks/mod/board.mjs');
  const lines = logLines(
    [
      {
        at: Date.parse('2026-10-26T14:01:00Z'),
        kind: 'approval',
        who: 'person',
        text: 'You approved dayjs.',
      },
      {
        at: Date.parse('2026-10-26T14:02:00Z'),
        kind: 'merge',
        story: 'ST-4',
        text: 'ST-4 was merged.',
      },
    ],
    [{ id: 'ST-4', lane: 'web' }],
  );
  assert.deepEqual(
    lines.map((l) => `${l.time} ${l.glyph} ${l.text}${l.yours ? ' (yours)' : ''}`),
    ['14:01 ✔ You approved dayjs (yours)', '14:02 ✓ ST-4 merged · web'],
  );
  assert.equal(lines[1].color, STATE.merged.color);
  // Every state has its own glyph or shares it only with its twin, and is said in sentence case.
  for (const s of Object.values(STATE)) assert.equal(s.word, s.word.toLowerCase());
});

test('UI-8 the keys that work for what is selected, and only those', async () => {
  const { keysFor, moveSelection, selectable } = await import('../hooks/mod/board.mjs');
  const keys = (...a) =>
    keysFor(...a)
      .map((k) => k.key)
      .join(' ');
  assert.equal(
    keys(
      { kind: 'lane', id: 'web' },
      {
        story: true,
        loop: { state: 'running' },
        acts: [
          { id: 'review', label: 'Review' },
          { id: 'merge', label: 'Merge' },
          { id: 'sendBack', label: 'Send back' },
        ],
      },
    ),
    'j k ⏎ t c r m s p f l esc',
  );
  assert.equal(keys(null, { loop: { state: 'off' } }), 'j k f l esc');
  assert.equal(keys(null, { view: 'trail' }), '←→ esc');
  const order = selectable([{}, {}], [{ name: 'web' }, { name: 'api' }]);
  assert.deepEqual(moveSelection(order, null, 1), { kind: 'need', id: '0' });
  assert.deepEqual(moveSelection(order, null, -1), { kind: 'lane', id: 'api' });
  assert.deepEqual(moveSelection(order, { kind: 'need', id: '1' }, 1), { kind: 'lane', id: 'web' });
  assert.deepEqual(moveSelection(order, { kind: 'lane', id: 'api' }, 1), { kind: 'need', id: '0' });
});

test('UI-12 the surface modules: a clock that ticks only while its agent works, and the rail', async () => {
  const { elapsed } = await import('../hooks/mod/surface/clock.mjs');
  const { railText } = await import('../hooks/mod/surface/rail.mjs');
  assert.equal(elapsed(12000), '12s');
  assert.equal(elapsed(312000), '5:12');
  assert.equal(elapsed(3 * 3600000 + 5 * 60000), '3h 5m');
  assert.equal(railText(6, null), '─────▸');
  assert.equal(railText(6, 2), '──•──▸');
  assert.equal(railText(6, 7), '──•──▸');
});

test('UI-11 the character as half-blocks in a surface module: two pixels a cell, one Text a run', async () => {
  const { halfBlocks } = await import('../hooks/mod/surface/character.mjs');
  const tree = halfBlocks(
    [
      [0xff0000, 0xff0000, null],
      [0x00ff00, 0x00ff00, null],
    ],
    el,
  );
  const [row] = tree.children;
  assert.deepEqual(
    row.children.map((t) => [
      t.children[0],
      t.props.color ?? null,
      t.props.backgroundColor ?? null,
    ]),
    [
      ['▀▀', '#ff0000', '#00ff00'],
      [' ', null, null],
    ],
  );
});

test("a check's long output never stops it: its exit code decides, and its end is kept", async () => {
  const { runChecks } = await import('../hooks/lib/checks.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'code-kit-checks-'));
  try {
    // About 3 MB of output, past what a buffered run held.
    const loud = `node -e "for (let i = 0; i < 60000; i++) console.log('ok ' + i + ' ' + 'x'.repeat(40))"`;
    const check = (name, run) => ({ name, files: ['**'], run: [run] });
    const actor = { kind: 'lead', label: 'lead' };
    assert.equal(runChecks({ checks: [check('loud', loud)] }, ['a.ts'], dir, actor).failure, null);
    const { failure } = runChecks(
      { checks: [check('loud and failing', `${loud} && echo 'not ok: the last test' && exit 1`)] },
      ['a.ts'],
      dir,
      actor,
    );
    assert.match(failure.title, /fails\. Fix it:$/);
    assert.match(failure.output, /not ok: the last test\s*$/);
    assert.ok(failure.output.length <= 256 * 1024 + 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('HUBR-9 drift findings hold a merge at the provider’s level, and say who decides and how it clears', async () => {
  const { driftHoldsOf, driftHolds, driftHoldWords, driftUnchecked, holdsMerge, findingKind } =
    await import('../hooks/lib/teamfacts.mjs');
  const { nextToMerge } = await import('../hooks/lib/queue.mjs');
  const spec = {
    id: 7,
    branch: 'web/st-4',
    conflictsWith: 'spec docs/specs/03-booking.md',
    severity: 'concern',
    title: 'BOOK-1 changed on main',
    text: 'BOOK-1 has changed on main since web/st-4 started.',
    url: 'https://provider.example/acme/booking/drift/7',
  };
  const branch = {
    ...spec,
    id: 8,
    conflictsWith: 'branch web/st-5',
    title: 'web/st-5 changes the same files',
  };
  const intent = {
    ...spec,
    id: 9,
    branch: 'web/st-6',
    conflictsWith: 'intent #12',
    title: 'Intent #12 touches what this changes',
  };
  assert.deepEqual([spec, branch, intent].map(findingKind), ['spec', 'branch', 'intent']);
  assert.ok(holdsMerge({ conflictsWith: 'decision docs/decisions/0003-x.md' }, 'spec-or-decision'));
  assert.equal(holdsMerge(branch, 'spec-or-decision'), false);
  assert.equal(holdsMerge(branch, 'any'), true);
  assert.equal(holdsMerge(spec, 'nothing'), false);
  const state = (mergeHolds, extra = {}) => ({
    reachable: true,
    mergeHolds,
    findings: [spec, branch, intent],
    ...extra,
  });
  const ids = (found) => found.map((f) => f.id);
  // Against a spec or decision: only the spec finding holds web/st-4; any finding: both of its.
  assert.deepEqual(ids(driftHoldsOf(state('spec-or-decision'), 'web/st-4')), [7]);
  assert.deepEqual(ids(driftHoldsOf(state('any'), 'web/st-4')), [7, 8]);
  assert.deepEqual(driftHoldsOf(state('nothing'), 'web/st-4'), []);
  // A provider that says nothing of what holds a merge (GitHub, an older one) holds nothing.
  assert.deepEqual(driftHoldsOf({ reachable: true, findings: [spec] }, 'web/st-4'), []);
  // One that didn't answer holds nothing, and that is said.
  const down = state('any', { fallback: "The provider can't be reached (timed out)." });
  assert.deepEqual(driftHoldsOf(down, 'web/st-4'), []);
  assert.match(
    driftUnchecked(down),
    /can't be reached \(timed out\), so drift findings weren't checked/,
  );
  assert.equal(driftUnchecked(state('any')), null);
  assert.match(driftUnchecked(null), /can't be reached/);
  const words = driftHoldWords('web/st-4', [spec], { techLead: 'lead', provider: 'the provider' });
  assert.match(
    words,
    /^web\/st-4 is held from merging: the drift check found it against the spec docs\/specs\/03-booking\.md \(a concern\): BOOK-1 changed on main \(https:\/\/provider\.example\/acme\/booking\/drift\/7\)\./,
  );
  assert.match(
    words,
    /The tech lead \(lead\) decides: if the work still stands, resolve the finding on the provider; otherwise push a fix to web\/st-4, and the drift check clears it once a push no longer conflicts\./,
  );

  // The queue goes on with the next branch; a group with a held member waits as one.
  const entry = (b, extra = {}) => ({ branch: b, state: 'waiting', passed: 'x', ...extra });
  const holds = driftHolds(state('spec-or-decision'), ['web/st-4', 'web/st-5', 'web/st-6']);
  assert.deepEqual([...holds.keys()], ['web/st-4']);
  const order = nextToMerge([entry('web/st-4'), entry('web/st-5')], holds);
  assert.equal(order.head.branch, 'web/st-5');
  assert.deepEqual(
    order.drifting.map((d) => [d.branch, d.findings[0].id]),
    [['web/st-4', 7]],
  );
  const grouped = nextToMerge(
    [entry('web/st-5', { with: ['web/st-4'] }), entry('web/st-4'), entry('web/st-6')],
    holds,
  );
  assert.equal(grouped.head.branch, 'web/st-6');
  assert.deepEqual(
    grouped.drifting.map((d) => d.branch),
    ['web/st-5', 'web/st-4'],
  );
  assert.equal(nextToMerge([entry('web/st-4')], holds).head, null);
  // Cleared: nothing holds it, and it merges next.
  assert.equal(nextToMerge([entry('web/st-4')], new Map()).head.branch, 'web/st-4');

  // The band offers no Merge for a held branch; it says why.
  const band = bandLines({
    state: projectState({ valid: true, lanes: {} }, { problems: [], stories: [] }, null, new Set()),
    requests: { open: [] },
    stops: [],
    queue: [entry('web/st-4', { drift: [spec] }), entry('web/st-5')],
    check: { harness: { autonomy: 'off' } },
  });
  assert.deepEqual(
    band.filter((l) => ['queue', 'drift'].includes(l.kind)).map((l) => l.text),
    ['web/st-4 is held by the drift check: BOOK-1 changed on main', 'web/st-5 is next to merge'],
  );
});

test('HUBR-2 the security reviewer’s findings counted, and usage kept by model', async () => {
  const { securityOutcome, isSecurityReviewer } = await import('../hooks/lib/security.mjs');
  const { agentIdOf } = await import('../hooks/lib/events.mjs');
  const report = (findings) =>
    `I attacked the sign-in.\n\n\`\`\`json\n${JSON.stringify({ findings })}\n\`\`\`\n`;
  assert.deepEqual(
    securityOutcome(
      report([
        { severity: 'blocker', where: 'a.ts:1', text: 'Attack: … Fix: …' },
        { severity: 'nit', where: 'b.ts:2', text: '…' },
        { severity: 'bogus', text: 'not graded' },
      ]),
    ),
    { findings: 2, blockers: 1 },
  );
  assert.deepEqual(securityOutcome(report([])), { findings: 0, blockers: 0 });
  assert.equal(securityOutcome('No block at all.'), null);
  assert.equal(securityOutcome('```json\n{ not json\n```'), null);
  assert.ok(isSecurityReviewer('security-reviewer') && isSecurityReviewer('kit:security-reviewer'));
  assert.ok(!isSecurityReviewer('reviewer') && !isSecurityReviewer(null));
  assert.equal(agentIdOf({ status: 'async_launched', agentId: 'ag-1' }), 'ag-1');
  assert.equal(agentIdOf({ content: [{ type: 'text', text: 'done' }] }), null);

  const who = { key: 'lead', lane: 'lead', story: null, background: false };
  const t = { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 1 };
  let ledger = withUsage({}, who, t, 'claude-opus-5-5');
  ledger = withUsage(ledger, who, t, 'claude-haiku-5');
  ledger = withUsage(ledger, who, t, 'claude-opus-5-5');
  ledger = withUsage(ledger, who, t);
  assert.deepEqual(
    Object.values(ledger).map((e) => [e.model, e.input]),
    [
      ['claude-opus-5-5', 20],
      ['claude-haiku-5', 10],
      [null, 10],
    ],
  );
});
