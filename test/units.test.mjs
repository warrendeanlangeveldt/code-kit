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
} from '../hooks/mod/view.mjs';

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
  assert.match(problems, /"shell.block" must be a list of \{ pattern, why, person\? \}/);
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
    requests: { open: [request, request] },
    stops: [{ title: 'Check tests failed' }],
  });
  assert.deepEqual(
    lines.map((l) => l.text),
    ['2 approvals waiting', 'ST-4 ready for review', 'Finish check failing: Check tests failed'],
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

test('HOLD-1 a protected file refused at commit is holdable, and results are read in every shape', async () => {
  const { holdable, resultText } = await import('../hooks/mod/hold.mjs');
  const refusal =
    'PreToolUse:Bash hook error: Blocked: design/approved-screens.json is the register of approved designs; committing it needs a person\'s approval in force. Ask the lead to run\n  ! echo "<what you are approving>" > .claude/approvals/web/design\n(a person runs it; …)';
  assert.deepEqual(holdable(refusal), {
    kind: 'approval',
    title: 'Commit refused: design/approved-screens.json',
    names: ['design'],
    lane: 'web',
    what: 'commit design/approved-screens.json',
  });
  assert.equal(resultText({ deny: 'x' }), 'x');
  assert.equal(resultText({ isError: true, text: 'y', result: 'z' }), 'y');
  assert.equal(resultText({ result: 'Error: PreToolUse' }), 'Error: PreToolUse');
  assert.equal(resultText({ result: { stdout: '' } }), '');
  assert.equal(holdable('some other failure'), null);
});

test('SET-1 the harness settings: defaults, validation and typed values', async () => {
  const { harnessSettings, harnessProblems, parseSetting } =
    await import('../hooks/lib/harness.mjs');
  assert.deepEqual(harnessSettings(undefined), {
    autonomy: 'autonomous',
    hold: { minutes: 2 },
    stall: { nudgeMinutes: 5, restartMinutes: 10, maxRestarts: 2 },
    agents: { reviewer: { on: false, model: null } },
    background: { pauseAtPercent: 80 },
  });
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
  const { leadPrompt, stepKey, stepLabel, stallDue } = await import('../hooks/mod/loop.mjs');
  assert.equal(
    leadPrompt({ step: 'dispatch', args: 'ST-7 ST-9' }),
    'Dispatch ST-7, ST-9: run /code-kit:dispatch ST-7 ST-9.',
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
  for (const step of ['spec-design', 'init', 'wait', 'done'])
    assert.equal(leadPrompt({ step }), null);
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
