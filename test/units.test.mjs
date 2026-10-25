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
import {
  NOT_CODE_KIT,
  agentsAtWork,
  bandLines,
  lanesPane,
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
};
const texts = (node) =>
  node.type === 'Text' ? node.children : node.children.flatMap((c) => texts(c));

test("the mod: CARD-4 and PANE-5, what the Lanes pane shows for the project's state", () => {
  assert.equal(parseJson('not json'), null);
  assert.deepEqual(projectState(null, null), { kind: 'none' });
  assert.deepEqual(projectState({ exists: false, valid: false, problems: [] }, null), {
    kind: 'none',
  });
  assert.deepEqual(texts(lanesPane(projectState(null, null), el)), [NOT_CODE_KIT]);
  const invalid = projectState({ exists: true, valid: false, problems: ['x'] }, null);
  assert.deepEqual(texts(lanesPane(invalid, el)), ['The config is invalid: run code-kit check.']);
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
  const shown = texts(lanesPane(ok, el));
  assert.ok(shown.includes('web-engineer') && shown.includes('the main session'));
  assert.ok(!shown.some((s) => s.includes('gap')));
  const gaps = texts(lanesPane(projectState(check, { problems: ['ST-1 has no **Lane:**'] }), el));
  assert.equal(gaps[0], 'The plan has 1 gap(s): run code-kit status.');
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
  const shown = texts(lanesPane(finished, el));
  assert.ok(shown.some((s) => s.includes('ST-4 Story ST-4 · web/st-4')));
  assert.ok(shown.some((s) => s.includes('waits on ST-4')));
  assert.equal(shown.filter((s) => s === "the lead's own").length, 2);
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
  assert.match(compactInstructions(), /^The lead's context is compacted between turns/);
  assert.equal(
    continuePrompt({ type: 'api-engineer', story: 'ST-9', branch: 'api/st-9', cli: '/k.mjs' }),
    'api-engineer handed ST-9 back at its context limit, with its work committed on api/st-9. Carry the story on with a fresh agent: run node "/k.mjs" worktrees release api/st-9 (it keeps the commits and moves the report to the main checkout), then dispatch ST-9 again with the same brief, adding "Read your earlier report first: .claude/state/reports/api_st-9.md in the main checkout": /code-kit:dispatch ST-9',
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
    report: { on: false },
  });
  assert.match(
    harnessProblems({ compact: { milestone: 'sometimes' } }).join(' '),
    /ask, auto, off/,
  );
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

test("VIEW-1, VIEW-4, VIEW-6 panes v2: counts, liveness and the selected lane's acts", async () => {
  const { countsOf, laneActions, toolLine, liveLevel } = await import('../hooks/mod/panes.mjs');
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
  assert.deepEqual(
    countsOf(state, queue).map((c) => `${c.glyph} ${c.n} ${c.state}`),
    ['● 1 building', '◐ 1 in review', '◆ 1 queued', '○ 1 ready', '✓ 1 merged', '· 1 idle'],
  );
  assert.deepEqual(countsOf({ kind: 'none' }), []);
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
  const { fileDiffs, closeGoesBack } = await import('../hooks/mod/panes.mjs');
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
  const person = { id: 'lanes', origin: { kind: 'person' } };
  assert.equal(closeGoesBack(person, 'lanes', { story: 'ST-4' }), true);
  assert.equal(closeGoesBack(person, 'lanes', { story: null }), false);
  assert.equal(
    closeGoesBack({ ...person, origin: { kind: 'plugin' } }, 'lanes', { story: 'ST-4' }),
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

test('VIEW-2 and VIEW-3 the pictures: raster cells, poses, bars and their runs', async () => {
  const { rasterCells, sprite, poseOf, barCells, runs, axisStart, spriteSvg, tintOf } =
    await import('../hooks/mod/art.mjs');
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
  assert.equal(sprite('working', 0, 0x4aa3ff).length, 6);
  assert.notDeepEqual(sprite('working', 0, 1), sprite('working', 1, 1));
  assert.deepEqual(sprite('working', 0, 1, { lead: true })[0].filter(Boolean).length, 4);
  assert.match(spriteSvg('working', 0x4aa3ff), /<animate attributeName="visibility"/);
  assert.doesNotMatch(spriteSvg('quiet', 0x4aa3ff), /<animate/);
  assert.equal(tintOf('web', ['lead', 'web', 'api']), tintOf('web', ['lead', 'web', 'api']));
  assert.notEqual(tintOf('web', ['lead', 'web', 'api']), tintOf('api', ['lead', 'web', 'api']));
  const lane = { name: 'web', state: 'building', active: true };
  assert.equal(poseOf(lane), 'working');
  assert.equal(poseOf(lane, { waiting: true }), 'waiting');
  assert.equal(poseOf(lane, { live: { level: 'quiet' } }), 'quiet');
  assert.equal(poseOf(lane, { flagged: true }), 'stalled');
  assert.equal(poseOf({ ...lane, active: false }, { shown: 'queued' }), 'done');
  assert.equal(poseOf({ ...lane, active: false, state: 'idle' }), 'idle');
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

test("VIEW-6 an idle lane: its stories in plan order, the one Enter opens, and the plan's progress", async () => {
  const { laneStories, storyToOpen, planProgress } = await import('../hooks/mod/panes.mjs');
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
  assert.equal(planProgress(state), '2 of 4 stories done');
  assert.equal(planProgress({ stories: [] }), null);
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

test('MISSION-1 to MISSION-3 the goal, the next step in words, and other tools only when not zero', async () => {
  const { goalOf, nextText, missionLines } = await import('../hooks/mod/mission.mjs');
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
  const state = {
    kind: 'ok',
    stories: [],
    lanes: [
      { name: 'lead', active: true },
      { name: 'web', active: false },
    ],
  };
  const quiet = missionLines({ state, leadBusy: true, combined: { web: { without: 0, owed: 0 } } });
  assert.equal(
    quiet.some((r) => r.kind === 'facts'),
    false,
  );
  const loud = missionLines({ state, leadBusy: true, combined: { web: { without: 2, owed: 0 } } });
  assert.equal(
    loud.find((r) => r.kind === 'facts')?.text,
    'web edited 2 files without understanding them',
  );
  assert.deepEqual(missionLines({ state: { ...state, lanes: [] } }), []);
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
  const { snapshotProblems, snapshotHash, EVENT_PARTS } = await import('../hooks/lib/snapshot.mjs');
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
    'a1|ST-4': {
      key: 'a1',
      lane: 'web',
      story: 'ST-4',
      background: false,
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
  assert.deepEqual(usage['a1|ST-4'], {
    story: 'ST-4',
    kind: 'lane',
    input: 100,
    output: 20,
    cache: 5,
  });
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
