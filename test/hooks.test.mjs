#!/usr/bin/env node
// The hooks end to end, run against throwaway git repositories in the OS temp folder with
// test/fixture.json as their config. Exit 0 = allowed, 2 = blocked.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refusalCard } from '../hooks/mod/view.mjs';
import { holdable } from '../hooks/mod/hold.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const hooks = join(here, '..', 'hooks');
const fixture = readFileSync(join(here, 'fixture.json'), 'utf8');
// The same rules, with the lead allowed to record approvals the person gives in chat.
const relayFixture = JSON.stringify({ ...JSON.parse(fixture), approvals: { lead: true } });
const delegateFixture = JSON.stringify({
  ...JSON.parse(fixture),
  approvals: { delegate: { protected: ['design'], dependencies: {} } },
});

// A stand-in for the npm registry and its download counts, so delegated approvals are tested
// through the real HTTP path without the network.
const REGISTRY_SERVER = `
const http = require('node:http');
const now = Date.now(), day = 86400000;
const pkg = (license, daysAgo, downloads, scripts = {}) => ({ license, daysAgo, downloads, scripts });
const pkgs = {
  'good-pkg': pkg('MIT', 30, 50000),
  '@scope/fine': pkg('ISC', 10, 20000),
  'gpl-pkg': pkg('GPL-3.0', 30, 50000),
  'old-pkg': pkg('MIT', 900, 50000),
  'tiny-pkg': pkg('MIT', 30, 12),
  'scripted-pkg': pkg('MIT', 30, 50000, { postinstall: 'node fetch-binary.js' }),
};
http.createServer((req, res) => {
  const url = decodeURIComponent(req.url);
  const dl = url.match(/^\\/downloads\\/point\\/last-week\\/(.+)$/);
  const name = dl ? dl[1] : url.slice(1);
  const p = pkgs[name];
  if (!p) { res.writeHead(404); return res.end('{}'); }
  res.setHeader('content-type', 'application/json');
  if (dl) return res.end(JSON.stringify({ downloads: p.downloads }));
  const released = new Date(now - p.daysAgo * day).toISOString();
  res.end(JSON.stringify({ 'dist-tags': { latest: '1.0.0' }, time: { '1.0.0': released }, versions: { '1.0.0': { license: p.license, scripts: p.scripts } } }));
}).listen(0, '127.0.0.1', function () { console.log(this.address().port); });
`;
const kitCli = join(here, '..', 'bin', 'code-kit.mjs');

function newRepo(withConfig = true) {
  const dir = mkdtempSync(join(tmpdir(), 'code-kit-test-'));
  const git = (...args) =>
    execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
      encoding: 'utf8',
    });
  git('init', '-q', '-b', 'main');
  if (withConfig) {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude/code-kit.json'), fixture);
    writeFileSync(join(dir, '.gitignore'), '.claude/approvals/\n.claude/state/\n');
    git('add', '-A');
  }
  git('commit', '-q', '--allow-empty', '-m', 'init');
  return { dir, git };
}

let failed = 0;
const expect = (label, res, want, stderrHas) => {
  const ok = res.status === want && (!stderrHas || res.stderr.includes(stderrHas));
  if (!ok) failed++;
  const why = ok
    ? ''
    : ` (got ${res.status}: ${res.stderr.trim().split('\n').slice(0, 2).join(' / ')})`;
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${label}${why}\n`);
};
const truth = (value, detail = '') => ({ status: value ? 0 : 1, stderr: detail });

const cleanups = [];
try {
  // --- a project without the kit ---------------------------------------------------------------
  const bare = newRepo(false);
  cleanups.push(bare.dir);
  const bareHook = (name, input) =>
    spawnSync('node', [join(hooks, name)], {
      input: JSON.stringify({ cwd: bare.dir, ...input }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: bare.dir },
      encoding: 'utf8',
    });
  expect(
    'a project without code-kit.json is not governed (writes)',
    bareHook('guard-paths.mjs', { tool_input: { file_path: join(bare.dir, 'x.ts') } }),
    0,
  );
  expect(
    'a project without code-kit.json is not governed (shell)',
    bareHook('guard-bash.mjs', { tool_input: { command: 'git push --force' } }),
    0,
  );
  expect(
    'a project without code-kit.json is not governed (stop)',
    bareHook('stop-check.mjs', {}),
    0,
  );

  const { dir: repo, git } = newRepo();
  cleanups.push(repo);
  git('checkout', '-q', '-b', 'lane/work');
  const put = (rel, body = '') => {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    writeFileSync(join(repo, rel), body);
  };
  const hook = (name, input) =>
    spawnSync('node', [join(hooks, name)], {
      input: JSON.stringify({ cwd: repo, ...input }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
      encoding: 'utf8',
    });
  const as = (agent) => (agent ? { agent_type: agent } : {});
  const writeAt = (path, agent) =>
    hook('guard-paths.mjs', { tool_input: { file_path: path }, ...as(agent) });
  const write = (rel, agent) => writeAt(join(repo, rel), agent);
  const edited = (rel, body, agent) => {
    put(rel, body);
    return hook('post-edit-check.mjs', {
      tool_input: { file_path: join(repo, rel) },
      ...as(agent),
    });
  };
  const bash = (command, agent) =>
    hook('guard-bash.mjs', { tool_input: { command }, ...as(agent) });
  const stop = (agent) => hook('stop-check.mjs', as(agent));
  const audit = (agent) => hook('lane-audit.mjs', as(agent));
  const approve = (name, minutesAgo = 0, reason = `test approval for ${name}`) => {
    put(`.claude/approvals/${name}`, reason);
    const t = new Date(Date.now() - minutesAgo * 60_000);
    utimesSync(join(repo, '.claude/approvals', name), t, t);
  };
  const commitAll = (m) => {
    git('add', '-A');
    git('commit', '-q', '-m', m);
  };
  put('design/approved-screens.json', JSON.stringify({ screens: [] }));

  // --- an invalid config fails closed ------------------------------------------------------------
  put('.claude/code-kit.json', '{ "version": 2 }');
  expect('an invalid config blocks writes', write('docs/x.md'), 2, 'is invalid');
  expect('the lead may repair it', write('.claude/code-kit.json'), 0);
  expect('an agent may not', write('.claude/code-kit.json', 'db-engineer'), 2);
  expect('commits wait for a valid config', bash('git commit -m x'), 2);
  expect('other shell commands still run', bash('ls'), 0);
  expect('the always-on shell rules still hold', bash('git push --force'), 2);
  put('.claude/code-kit.json', fixture);

  // --- ownership ---------------------------------------------------------------------------------
  expect('lead writes the specs', write('docs/spec/02-api.md'), 0);
  expect('lead writes the contracts', write('packages/schemas/src/x.ts'), 0);
  expect('lead writes the kit', write('.claude/agents/x.md'), 0);
  expect(
    'lead may not write a lane path',
    write('supabase/migrations/1_x.sql'),
    2,
    'data lane / db-engineer',
  );
  expect('lead may not write an unowned path', write('random/x.ts'), 2);
  expect('an unmapped agent is read-only', write('docs/notes.md', 'Explore'), 2, 'read-only');
  expect(
    "REVW-2 code-kit's reviewer is read-only: it can't write",
    write('apps/web/x.ts', 'code-kit:reviewer'),
    2,
    'read-only',
  );
  expect(
    'lane agent without spec-check is blocked',
    write('supabase/migrations/1_x.sql', 'db-engineer'),
    2,
    'spec-check',
  );
  expect(
    'lane agent may write its spec-check report',
    write('.claude/state/spec-check/lane_work.md', 'db-engineer'),
    0,
  );
  put('.claude/state/spec-check/lane_work.md', '| Requirement | Status |\n');
  expect(
    'lane writes its paths after spec-check',
    write('supabase/migrations/1_x.sql', 'db-engineer'),
    0,
  );
  expect('lane may not write another lane', write('apps/field/lib/x.ts', 'db-engineer'), 2);
  expect('lane excludes hold', write('workers/ai/x.ts', 'backend-engineer'), 2, 'ai lane');
  expect('the excluded path belongs to its owner', write('workers/ai/x.ts', 'ai-engineer'), 0);
  expect('any actor writes the lockfile', write('pnpm-lock.yaml', 'web-engineer'), 0);
  expect(
    'a lane may not change the contracts',
    write('packages/schemas/src/x.ts', 'backend-engineer'),
    2,
  );
  put('.lane', 'web');
  expect('a .lane worktree acts as that lane', write('apps/office/lib/x.ts'), 0);
  expect('a .lane worktree cannot write other lanes', write('supabase/migrations/1_x.sql'), 2);
  expect('nor rewrite its .lane file', write('.lane'), 2);
  const laneStop = stop();
  expect(
    "its .lane file isn't work: the finish check doesn't report it",
    truth(!laneStop.stderr.includes('.lane:'), laneStop.stderr),
    0,
  );
  rmSync(join(repo, '.lane'));

  // --- secrets, approvals, outside the repository ------------------------------------------------
  expect('nobody writes .env files', write('apps/office/.env.local', 'web-engineer'), 2, 'secrets');
  expect('files outside the project are blocked', write(join('..', 'elsewhere.txt')), 2);
  expect("the lead writes the config's outside paths", write(join('..', 'code-kit', 'x.mjs')), 0);
  expect('a lane may not', write(join('..', 'code-kit', 'x.mjs'), 'web-engineer'), 2);
  const memoryFile = join(homedir(), '.claude', 'projects', 'p', 'memory', 'x.md');
  expect("the lead writes Claude's memory", writeAt(memoryFile), 0);
  expect('a lane may not', writeAt(memoryFile, 'web-engineer'), 2);
  expect(
    'the rest of ~/.claude stays blocked',
    writeAt(join(homedir(), '.claude', 'settings.json')),
    2,
  );
  expect('nobody writes approvals', write('.claude/approvals/kit'), 2);
  expect('the lead edits the design register', write('design/approved-screens.json'), 0);
  expect('a lane may not edit the kit', write('.claude/agents/x.md', 'backend-engineer'), 2);
  approve('kit');
  expect(
    'an approval never lets a lane write outside its paths',
    write('.claude/agents/x.md', 'backend-engineer'),
    2,
    'owned by the lead',
  );
  expect(
    'nobody edits the approval log, even with approval',
    write('.claude/approval-log.jsonl'),
    2,
  );
  rmSync(join(repo, '.claude/approvals/kit'));

  // --- designs before screens --------------------------------------------------------------------
  const screen = 'apps/field/app/(app)/index.tsx';
  expect(
    'a screen without an approved design is blocked',
    write(screen, 'mobile-engineer'),
    2,
    'Design it first',
  );
  expect(
    'layouts are not screens',
    write('apps/field/app/(app)/_layout.tsx', 'mobile-engineer'),
    0,
  );
  expect(
    'components are not screens',
    write('apps/field/components/JobCard.tsx', 'mobile-engineer'),
    0,
  );
  put('design/approved-screens.json', JSON.stringify({ screens: [{ file: screen }] }));
  expect('an approved screen can be built', write(screen, 'mobile-engineer'), 0);

  // --- shell -------------------------------------------------------------------------------------
  expect('bare install allowed', bash('pnpm install && pnpm test'), 0);

  // Commands are recognised where they run, not where their text is mentioned.
  expect(
    'switching to a protected branch and committing is refused',
    bash('git switch main && git commit -m "x"'),
    2,
    'never commit to',
  );
  expect(
    'but a grep for that text is not',
    bash('grep -rn "git switch main && git commit" docs/'),
    0,
  );
  expect(
    'nor a heredoc that mentions it',
    bash(
      "cat > docs/notes.md <<'EOF'\nRun git switch main && git commit, then code-kit merge web/st-4 --delegated.\nEOF",
    ),
    0,
  );
  expect(
    "nor a lane's commit message that mentions code-kit merge",
    bash('git commit -m "wire up: code-kit merge runs after verify"', 'web-engineer'),
    0,
  );
  expect(
    'a lane running code-kit merge after cd is still refused',
    bash('cd apps && node "/opt/my tools/code-kit.mjs" merge web/st-4 --delegated', 'web-engineer'),
    2,
    'only the lead merges',
  );
  expect(
    'and --no-verify in a commit message is text, not the flag',
    bash('git commit -m "docs: why we never use --no-verify"'),
    0,
  );
  expect(
    'while the flag itself is refused',
    bash('git commit --no-verify -m x'),
    2,
    'Skipping git hooks',
  );
  expect('new JS dependency blocked', bash('pnpm --filter office add lodash'), 2);
  expect('new Python dependency blocked', bash('pip install requests'), 2);
  expect(
    'installing from a requirements file is not new',
    bash('pip install -r requirements.txt'),
    0,
  );
  expect('uv add blocked', bash('uv add httpx'), 2);
  expect(
    "Playwright's browser download is not a dependency",
    bash('pnpm exec playwright install chromium'),
    0,
  );
  expect('approval forgery blocked', bash('touch .claude/approvals/kit'), 2);
  expect(
    'the approval log is not touched through the shell',
    bash('echo x >> .claude/approval-log.jsonl'),
    2,
  );
  expect(
    'the lead edits the kit through the shell',
    bash("sed -i '' s/a/b/ .claude/code-kit.json"),
    0,
  );
  expect('a lane may not', bash("sed -i '' s/a/b/ .claude/code-kit.json", 'web-engineer'), 2);
  expect("the project's blocked commands", bash('supabase db push'), 2, 'Deploying is done by CI');
  expect('restricted commands: an owning lane', bash('supabase db reset', 'db-engineer'), 0);
  expect('restricted commands: the lead', bash('supabase db reset'), 0);
  expect(
    'restricted commands: another lane',
    bash('supabase db reset', 'backend-engineer'),
    2,
    'shared',
  );
  expect('commit on a lane branch allowed', bash('git commit -m x'), 0);
  expect('push to a protected branch blocked', bash('git push origin main'), 2);
  expect(
    'switching to a protected branch and merging in one command is blocked',
    bash('git switch main && git merge lane/x'),
    2,
    'even by switching to it first',
  );
  expect('so is checkout then commit', bash('git checkout main; git commit -m x'), 2);
  expect('and forcing a protected branch to move', bash('git branch -f main HEAD'), 2);
  expect('or updating its ref', bash('git update-ref refs/heads/main HEAD'), 2);
  expect(
    'restoring a file from main is not switching to it',
    bash('git checkout main -- docs/x.md && git commit -m x'),
    0,
  );
  expect(
    'a branch named after main is not main',
    bash('git switch main-fixes && git commit -m x'),
    0,
  );
  expect(
    'creating a branch from main is fine',
    bash('git checkout -b next main && git commit -m x'),
    0,
  );
  git('checkout', '-q', 'main');
  expect('commit on main blocked', bash('git commit -m x'), 2);
  const other = newRepo(false);
  cleanups.push(other.dir);
  expect(
    "another repository's commits are its own business",
    bash(`git -C ${other.dir} commit -m x`),
    0,
  );
  git('checkout', '-q', 'lane/work');
  writeFileSync(join(other.dir, 'x.mjs'), 'x');
  expect(
    "a shell sitting in another repository isn't audited against these rules",
    hook('lane-audit.mjs', { cwd: other.dir }),
    0,
  );
  expect('nor stopped by its changes', hook('stop-check.mjs', { cwd: other.dir }), 0);

  // --- shell writes are audited afterwards -------------------------------------------------------
  commitAll('fixture');
  put('supabase/migrations/2_y.sql', 'select 1;');
  expect('a lead shell write into a lane path is caught', audit(), 2);
  expect('the same file is fine for its lane', audit('db-engineer'), 0);
  rmSync(join(repo, 'supabase/migrations/2_y.sql'));
  put('supabase/migrations/3_z.sql', 'select 1;');
  git('checkout', '-q', '-b', 'lane/next');
  expect('lane code carried to a branch without spec-check is caught', audit('db-engineer'), 2);
  put('.claude/state/spec-check/lane_next.md', '| Requirement | Status |\n');
  expect('and passes once that branch has its spec-check', audit('db-engineer'), 0);
  rmSync(join(repo, 'supabase/migrations/3_z.sql'));
  git('checkout', '-q', 'lane/work');

  // --- committed protected files are recorded ----------------------------------------------------
  const logFile = join(repo, '.claude/approval-log.jsonl');
  const logLines = () => {
    try {
      return readFileSync(logFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  };
  put('design/approved-screens.json', JSON.stringify({ screens: [{ file: screen }] }, null, 1));
  expect(
    'the lead commits a protected file',
    bash('git add design/approved-screens.json && git commit -m d'),
    0,
  );
  const [lead] = logLines();
  expect(
    'it is recorded as a lead change',
    truth(
      lead?.file === 'design/approved-screens.json' &&
        lead.approval === 'lead' &&
        lead.grantedAt === null,
      JSON.stringify(lead),
    ),
    0,
  );
  rmSync(logFile);
  expect(
    'a lane may not commit it without approval',
    bash('git add design/approved-screens.json && git commit -m d', 'web-engineer'),
    2,
  );
  approve('design', 61);
  expect(
    'approvals expire',
    bash('git add design/approved-screens.json && git commit -m d', 'web-engineer'),
    2,
  );
  approve('design', 0, '   ');
  expect(
    'an approval needs a reason',
    bash('git add design/approved-screens.json && git commit -m d', 'web-engineer'),
    2,
  );
  approve('design', 0, 'Approve the sign-in screens');
  expect(
    'with approval it may',
    bash('git add design/approved-screens.json && git commit -m d', 'web-engineer'),
    0,
  );
  const [entry] = logLines();
  expect(
    'the log holds the file, approval and reason',
    truth(
      entry?.approval === 'design' &&
        entry.reason === 'Approve the sign-in screens' &&
        entry.actor.includes('web'),
      JSON.stringify(entry),
    ),
    0,
  );
  expect(
    'the log is staged into the same commit',
    truth(git('diff', '--cached', '--name-only').includes('.claude/approval-log.jsonl')),
    0,
  );
  expect('an appended, uncommitted log is not an ownership problem', audit(), 0);
  git('reset', '-q');
  git('checkout', '-q', '--', 'design/approved-screens.json');
  rmSync(logFile);
  rmSync(join(repo, '.claude/approvals/design'));
  put('docs/note.md', 'x');
  expect(
    'commits without protected files record nothing',
    bash('git add docs/note.md && git commit -m n'),
    0,
  );
  expect('so the log stays absent', truth(logLines().length === 0), 0);
  rmSync(join(repo, 'docs/note.md'));

  // --- new dependencies: a person approves each package, for one lane or for everyone ------------
  const approveFor = (lane, name, minutesAgo = 0) =>
    approve(`${lane}/${name}`, minutesAgo, `${name} for ST-1`);
  const addLodash = 'pnpm --filter office add lodash';
  expect(
    'a lane is refused a new package, and told the exact approval for its lane',
    bash(addLodash, 'web-engineer'),
    2,
    '! echo "<what you are approving>" > .claude/approvals/web/dep-lodash',
  );
  expect(
    'and to send the lead a change request',
    bash(addLodash, 'web-engineer'),
    2,
    'change request',
  );
  expect('flags before the package no longer slip through', bash('npm install -D lodash'), 2);
  approveFor('web', 'dep-lodash');
  expect('with its approval the lane installs it', bash(addLodash, 'web-engineer'), 0);
  expect('another lane may not use it', bash(addLodash, 'backend-engineer'), 2);
  expect('nor may the lead', bash('pnpm add lodash'), 2);
  expect(
    'it covers that package only',
    bash('pnpm --filter office add zod', 'web-engineer'),
    2,
    'zod',
  );
  expect('a read-only agent never installs', bash(addLodash, 'Explore'), 2, 'read-only');
  expect('nor may the reviewer install', bash(addLodash, 'code-kit:reviewer'), 2, 'read-only');
  put('package.json', '{ "dependencies": { "lodash": "4" } }\n');
  put('apps/office/package.json', '{ "dependencies": { "lodash": "4" } }\n');
  expect(
    "the install's manifest and lockfile changes pass the ownership audit",
    audit('web-engineer'),
    0,
  );
  expect(
    'the lane commits them, and the log records the approval',
    bash('git add package.json apps/office/package.json && git commit -m deps', 'web-engineer'),
    0,
  );
  const depEntries = logLines();
  expect(
    'the commit that adds the package uses its approval up',
    truth(!existsSync(join(repo, '.claude/approvals/web/dep-lodash'))),
    0,
  );
  expect(
    'for the manifest outside its paths only, with the package and reason',
    truth(
      depEntries.length === 1 &&
        depEntries[0].file === 'package.json' &&
        depEntries[0].approval === 'dependency' &&
        depEntries[0].packages.join() === 'dep-lodash' &&
        depEntries[0].reason === 'dep-lodash for ST-1',
      JSON.stringify(depEntries),
    ),
    0,
  );
  git('reset', '-q');
  rmSync(logFile);
  put('apps/field/package.json', '{}\n');
  expect("but never another lane's manifest", audit('web-engineer'), 2, 'apps/field/package.json');
  rmSync(join(repo, 'apps/field/package.json'));
  approveFor('web', 'dep-lodash', 61);
  expect(
    'a dependency approval still stands an hour later, when the story resumes',
    audit('web-engineer'),
    0,
  );
  approveFor('web', 'dep-lodash', 7 * 24 * 60 + 1);
  expect(
    'after a week it lapses, and the manifest change is an ownership problem again',
    audit('web-engineer'),
    2,
  );
  approve('dep-zod', 0, 'zod for validation');
  expect('an approval without a lane serves the lead', bash('pnpm add zod'), 0);
  expect('and every lane', bash('pnpm --filter office add zod', 'web-engineer'), 0);
  rmSync(join(repo, 'package.json'));
  rmSync(join(repo, 'apps/office/package.json'));
  rmSync(join(repo, '.claude/approvals'), { recursive: true });

  // --- approvals from chat: with approvals.lead on, the lead records what the person says --------
  const kit = (...args) => spawnSync('node', [kitCli, ...args], { cwd: repo, encoding: 'utf8' });
  const relayZod = `node "${kitCli}" approve dep-zod --reason "yes, add zod"`;
  expect(
    'by default the lead may not record approvals',
    bash(relayZod),
    2,
    '"approvals.lead" is off',
  );
  expect(
    "and refusals offer only the person's ! command",
    truth(!bash('pnpm add zod').stderr.includes(' approve dep-zod')),
    0,
  );
  put('.claude/code-kit.json', relayFixture);
  expect(
    "with it on, the lead's refusal names the command that records the person's words",
    bash('pnpm add zod'),
    2,
    `approve dep-zod --reason "<the person's words>"`,
  );
  expect(
    "a lane's refusal names its own lane",
    bash(addLodash, 'web-engineer'),
    2,
    'approve dep-lodash --lane web --reason',
  );
  expect('a lane never records approvals', bash(relayZod, 'web-engineer'), 2, 'only the lead');
  expect('nor does a read-only agent', bash(relayZod, 'Explore'), 2, 'only the lead');
  expect('the lead may', bash(relayZod), 0);
  expect('approve needs a reason', kit('approve', 'dep-zod'), 1);
  expect('and a real lane', kit('approve', 'dep-zod', '--lane', 'nope', '--reason', 'x'), 1);
  expect('and an approval name, not a path', kit('approve', '../kit', '--reason', 'x'), 1);
  expect('recording it', kit('approve', 'dep-zod', '--reason', 'yes, add zod'), 0);
  expect('allows the install', bash('pnpm add zod'), 0);
  expect(
    'and says how it was given',
    truth(
      readFileSync(join(repo, '.claude/approvals/dep-zod'), 'utf8').includes(
        'yes, add zod (given in chat, recorded by the lead)',
      ),
    ),
    0,
  );
  expect(
    'a lane approval from chat',
    kit('approve', 'dep-lodash', '--lane', 'web', '--reason', 'lodash for ST-1'),
    0,
  );
  expect('serves that lane', bash(addLodash, 'web-engineer'), 0);
  expect('and no other', bash(addLodash, 'backend-engineer'), 2);
  put('.claude/code-kit.json', '{ "version": 2 }');
  expect('an invalid config records no approvals', bash(relayZod), 2, 'is invalid');
  put('.claude/code-kit.json', fixture);
  rmSync(join(repo, '.claude/approvals'), { recursive: true });

  // --- approval requests, and the pane's acts (the code-kit mod) -----------------------------------
  {
    put('.claude/code-kit.json', fixture);
    const requestsFile = join(repo, '.claude/state/requests.jsonl');
    rmSync(requestsFile, { force: true });
    const reqs = () => JSON.parse(kit('requests', '--json').stdout);
    bash(addLodash, 'web-engineer');
    bash(addLodash, 'web-engineer');
    const after = reqs();
    expect(
      'BAND-1 a refusal an approval would allow records one request, not one per attempt',
      truth(
        after.open.length === 1 &&
          after.open[0].lane === 'web' &&
          after.open[0].names.join() === 'dep-lodash' &&
          after.open[0].what === addLodash,
        JSON.stringify(after),
      ),
      0,
    );
    write('design/approved-screens.json', 'web-engineer');
    expect(
      'a protected write records its approval too',
      truth(
        reqs().open.some(
          (r) => r.names.join() === 'design' && r.what === 'design/approved-screens.json',
        ),
      ),
      0,
    );
    expect(
      'ACT-1 an approval from the pane is marked as given there',
      truth(
        kit(
          'approve',
          'dep-lodash',
          '--lane',
          'web',
          '--reason',
          'yes, lodash for ST-1',
          '--via',
          'pane',
        ).status === 0 &&
          readFileSync(join(repo, '.claude/approvals/web/dep-lodash'), 'utf8').includes(
            'yes, lodash for ST-1 (approved in the code-kit pane)',
          ),
      ),
      0,
    );
    const now = reqs();
    expect(
      'CARD-2 the answered request closes, and the approval shows as in force',
      truth(
        !now.open.some((r) => r.names.join() === 'dep-lodash') &&
          now.inForce.some(
            (a) => a.name === 'dep-lodash' && a.lane === 'web' && a.minutesLeft >= 59,
          ),
        JSON.stringify(now),
      ),
      0,
    );
    expect('--via takes only pane', kit('approve', 'dep-x', '--reason', 'y', '--via', 'chat'), 1);
    put('.claude/code-kit.json', relayFixture);
    expect(
      'ACT-2 no agent approves as the person, even with chat approvals on',
      bash(`node "${kitCli}" approve dep-zod --reason "yes" --via pane`),
      2,
      "the person's own act",
    );
    put('.claude/code-kit.json', fixture);
    rmSync(requestsFile, { force: true });
    rmSync(join(repo, '.claude/approvals'), { recursive: true, force: true });
  }

  // --- approve takes a package's name for its dependency approval ---------------------------------
  put('.claude/code-kit.json', relayFixture);
  expect(
    'a package name stands for its dep- approval',
    truth(
      kit('approve', '@scope/fine', '--lane', 'web', '--reason', 'yes').status === 0 &&
        existsSync(join(repo, '.claude/approvals/web/dep-@scope+fine')),
    ),
    0,
  );
  expect(
    "a protected approval's own name is kept",
    truth(
      kit('approve', 'design', '--reason', 'yes').status === 0 &&
        existsSync(join(repo, '.claude/approvals/design')),
    ),
    0,
  );
  rmSync(join(repo, '.claude/approvals'), { recursive: true });

  // --- delegated approvals: the lead approves on its own, within the project's rules -------------
  const registry = spawn('node', ['-e', REGISTRY_SERVER]);
  const port = await new Promise((r) => registry.stdout.once('data', (d) => r(String(d).trim())));
  const registryEnv = {
    ...process.env,
    CODE_KIT_NPM_REGISTRY: `http://127.0.0.1:${port}`,
    CODE_KIT_NPM_DOWNLOADS: `http://127.0.0.1:${port}`,
  };
  const delegate = (...args) =>
    spawnSync('node', [kitCli, 'approve', ...args, '--delegated'], {
      cwd: repo,
      encoding: 'utf8',
      env: registryEnv,
    });
  const approved = (rel) => existsSync(join(repo, '.claude/approvals', rel));
  try {
    put('.claude/code-kit.json', fixture);
    const delegateGood = `node "${kitCli}" approve dep-good-pkg --lane web --delegated --reason "x"`;
    expect(
      'without approvals.delegate the lead may not approve on its own',
      bash(delegateGood),
      2,
      '"approvals.delegate" isn\'t set',
    );
    expect('nor does the command', delegate('good-pkg', '--lane', 'web', '--reason', 'x'), 1);
    put('.claude/code-kit.json', delegateFixture);
    expect(
      "with it set, a lane's refusal names the lead's delegated command",
      bash(addLodash, 'web-engineer'),
      2,
      'approve dep-lodash --lane web --delegated',
    );
    expect('a lane never approves', bash(delegateGood, 'web-engineer'), 2, 'only the lead');
    expect('the lead may run it', bash(delegateGood), 0);
    expect(
      'AUT-2 a package within the rules is approved, marked with its rule',
      truth(
        delegate('good-pkg', '--lane', 'web', '--reason', 'tables for ST-4').status === 0 &&
          readFileSync(join(repo, '.claude/approvals/web/dep-good-pkg'), 'utf8').includes(
            'tables for ST-4 (approved by the lead within the delegated rules: dependencies (good-pkg))',
          ),
      ),
      0,
    );
    expect(
      'and it allows the install',
      bash('pnpm --filter office add good-pkg', 'web-engineer'),
      0,
    );
    expect('a scoped package too', delegate('@scope/fine', '--lane', 'web', '--reason', 'x'), 0);
    expect(
      'AUT-4 a copyleft licence goes to the person',
      delegate('gpl-pkg', '--lane', 'web', '--reason', 'x'),
      1,
      'licence (GPL-3.0)',
    );
    expect('so does an old package', delegate('old-pkg', '--reason', 'x'), 1, 'last release');
    expect('a little-used one', delegate('tiny-pkg', '--reason', 'x'), 1, 'downloads');
    expect(
      'one whose install runs scripts',
      delegate('scripted-pkg', '--reason', 'x'),
      1,
      'runs a script that runs its own code',
    );
    expect(
      'and one the registry has never heard of',
      delegate('nowhere-pkg', '--reason', 'x'),
      1,
      "isn't on the npm registry",
    );
    expect(
      'it is all or nothing',
      truth(
        delegate('good-pkg', 'gpl-pkg', '--lane', 'qa', '--reason', 'x').status === 1 &&
          !approved('qa/dep-good-pkg'),
      ),
      0,
    );
    expect(
      'a delegated protected approval',
      delegate('design', '--lane', 'web', '--reason', 'register the screen'),
      0,
    );
    expect(
      'one the rules leave out goes to the person',
      delegate('kit', '--reason', 'x'),
      1,
      'not among the delegated approvals',
    );
    put('design/approved-screens.json', JSON.stringify({ screens: [{ file: screen }] }, null, 3));
    expect(
      'a lane commits under the delegated approval',
      bash('git add design/approved-screens.json && git commit -m d', 'web-engineer'),
      0,
    );
    expect(
      'and the log names the lead and the rule',
      truth(
        logLines().some(
          (e) =>
            e.file === 'design/approved-screens.json' &&
            e.reason.includes('approved by the lead within the delegated rules: protected: design'),
        ),
        JSON.stringify(logLines()),
      ),
      0,
    );
  } finally {
    registry.kill();
    git('reset', '-q');
    git('checkout', '-q', '--', 'design/approved-screens.json');
    rmSync(logFile, { force: true });
    rmSync(join(repo, '.claude/approvals'), { recursive: true, force: true });
    put('.claude/code-kit.json', fixture);
  }

  // --- a lane merging its base: what arrives with the base was logged there ---------------------
  {
    const b = newRepo();
    cleanups.push(b.dir);
    const bPut = (rel, body) => {
      mkdirSync(dirname(join(b.dir, rel)), { recursive: true });
      writeFileSync(join(b.dir, rel), body);
    };
    const bHook = (name, command, agent) =>
      spawnSync('node', [join(hooks, name)], {
        input: JSON.stringify({ cwd: b.dir, tool_input: { command }, agent_type: agent }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: b.dir },
        encoding: 'utf8',
      });
    b.git('checkout', '-q', '-b', 'web/st-9');
    bPut('apps/office/lib/w.ts', 'export const w = 1;\n');
    b.git('add', '-A');
    b.git('commit', '-q', '-m', 'ST-9');
    b.git('checkout', '-q', 'main');
    bPut('design/approved-screens.json', JSON.stringify({ screens: [] }));
    bPut('workers/jobs/j.ts', 'export const j = 1;\n');
    b.git('add', '-A');
    b.git('commit', '-q', '-m', 'the base moves on');
    b.git('checkout', '-q', 'web/st-9');
    b.git('merge', '-q', '--no-ff', '--no-commit', 'main');
    expect(
      'a lane concluding a merge of its base needs no approval for what the base logged',
      bHook('guard-bash.mjs', 'git commit -m "Merge main"', 'web-engineer'),
      0,
    );
    expect(
      "and the ownership audit doesn't ask it to revert the base's changes",
      bHook('lane-audit.mjs', 'git merge --no-commit main', 'web-engineer'),
      0,
    );
    bPut('design/approved-screens.json', JSON.stringify({ screens: ['mine'] }));
    b.git('add', 'design/approved-screens.json');
    expect(
      "but its own change to a protected file mid-merge still needs a person's approval",
      bHook('guard-bash.mjs', 'git commit -m "Merge main"', 'web-engineer'),
      2,
      "needs a person's approval",
    );
    b.git('merge', '--abort');
  }

  // --- delegated merges: the lead merges a branch that passes verify --------------------------------
  {
    const mergeFixture = (merge) =>
      JSON.stringify({ ...JSON.parse(fixture), approvals: { delegate: { merge } } });
    const m = newRepo(false);
    cleanups.push(m.dir);
    mkdirSync(join(m.dir, '.claude'), { recursive: true });
    writeFileSync(join(m.dir, '.claude/code-kit.json'), mergeFixture(true));
    writeFileSync(join(m.dir, '.gitignore'), '.claude/approvals/\n.claude/state/\n');
    m.git('add', '-A');
    m.git('commit', '-q', '-m', 'kit');
    const mPut = (rel, body) => {
      mkdirSync(dirname(join(m.dir, rel)), { recursive: true });
      writeFileSync(join(m.dir, rel), body);
    };
    const mHook = (command, agent) =>
      spawnSync('node', [join(hooks, 'guard-bash.mjs')], {
        input: JSON.stringify({
          cwd: m.dir,
          tool_input: { command },
          ...(agent ? { agent_type: agent } : {}),
        }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: m.dir },
        encoding: 'utf8',
      });
    const mKit = (...args) =>
      spawnSync('node', [kitCli, ...args], { cwd: m.dir, encoding: 'utf8' });
    m.git('checkout', '-q', '-b', 'web/st-1');
    mPut('apps/office/lib/a.ts', 'export const a = 1;\n');
    m.git('add', '-A');
    m.git('commit', '-q', '-m', 'ST-1');
    m.git('checkout', '-q', '-b', 'web/st-2', 'main');
    mPut('workers/stray.ts', 'export const s = 1;\n');
    m.git('add', '-A');
    m.git('commit', '-q', '-m', 'ST-2 strays');
    m.git('checkout', '-q', 'main');
    const mergeCmd = `node "${kitCli}" merge web/st-1 --delegated`;
    expect('a lane never merges', mHook(mergeCmd, 'web-engineer'), 2, 'only the lead merges');
    expect('the lead may run the delegated merge', mHook(mergeCmd), 0);
    expect(
      'a branch that fails verify is not merged',
      mKit('merge', 'web/st-2', '--delegated'),
      1,
      "workers/stray.ts: the web lane doesn't own it",
    );
    expect(
      'and main is unchanged',
      truth(!m.git('log', '--oneline', 'main').includes('strays')),
      0,
    );
    expect(
      'AUT-5 a branch that passes verify is merged',
      mKit('merge', 'web/st-1', '--delegated'),
      0,
    );
    expect(
      'with a merge commit that says it was verified and delegated',
      truth(
        m
          .git('log', '-1', '--format=%B', 'main')
          .includes('merged by the lead within the delegated rules') &&
          existsSync(join(m.dir, 'apps/office/lib/a.ts')),
      ),
      0,
    );
    expect(
      'temporary worktrees are cleaned up',
      truth(m.git('worktree', 'list').trim().split('\n').length === 1),
      0,
    );
    expect('the merge needs --delegated', mKit('merge', 'web/st-1'), 1);
    m.git('checkout', '-q', '-b', 'web/st-3', 'main');
    mPut('apps/office/lib/c.ts', 'export const c = 3;\n');
    m.git('add', 'apps/office/lib/c.ts');
    m.git('commit', '-q', '-m', 'ST-3');
    m.git('checkout', '-q', 'main');
    m.git('update-index', '--assume-unchanged', '.claude/code-kit.json');
    writeFileSync(join(m.dir, '.claude/code-kit.json'), mergeFixture(false));
    expect(
      'ACT-4 the person merges a verified branch with --person, no delegation needed',
      truth(
        mKit('merge', 'web/st-3', '--person').status === 0 &&
          m.git('log', '-1', '--format=%B', 'main').includes('merged by the person'),
      ),
      0,
    );
    expect(
      'no agent merges as the person',
      mHook(`node "${kitCli}" merge web/st-3 --person`),
      2,
      "the person's own act",
    );
    // Delegation is the target's rule: main stops delegating, committed there.
    m.git('update-index', '--no-assume-unchanged', '.claude/code-kit.json');
    m.git('commit', '-q', '-am', 'stop delegating merges');
    expect(
      'without approvals.delegate.merge on the target the command refuses',
      mKit('merge', 'web/st-1', '--delegated'),
      1,
      "main doesn't delegate merges",
    );
    expect('and so does the hook', mHook(mergeCmd), 2, "doesn't delegate merges");
    m.git('checkout', '-q', '-b', 'lead/m3', 'main~1');
    expect(
      "a branch whose own config delegates merges can't grant itself one its target doesn't allow",
      mKit('merge', 'web/st-1', '--delegated'),
      1,
      "main doesn't delegate merges",
    );
    m.git('checkout', '-q', 'main');
  }

  // --- the merge queue: in the order reviews passed, each verified against the base as it is then ---
  {
    const q = newRepo(false);
    cleanups.push(q.dir);
    mkdirSync(join(q.dir, '.claude'), { recursive: true });
    writeFileSync(
      join(q.dir, '.claude/code-kit.json'),
      JSON.stringify({ ...JSON.parse(fixture), approvals: { delegate: { merge: true } } }),
    );
    writeFileSync(join(q.dir, '.gitignore'), '.claude/approvals/\n.claude/state/\n');
    q.git('add', '-A');
    q.git('commit', '-q', '-m', 'kit');
    const qPut = (rel, body) => {
      mkdirSync(dirname(join(q.dir, rel)), { recursive: true });
      writeFileSync(join(q.dir, rel), body);
    };
    const qKit = (...args) =>
      spawnSync('node', [kitCli, ...args], { cwd: q.dir, encoding: 'utf8' });
    const qHook = (command, agent) =>
      spawnSync('node', [join(hooks, 'guard-bash.mjs')], {
        input: JSON.stringify({
          cwd: q.dir,
          tool_input: { command },
          ...(agent ? { agent_type: agent } : {}),
        }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: q.dir },
        encoding: 'utf8',
      });
    for (const [branch, file, body] of [
      ['web/st-a', 'apps/office/lib/shared.ts', 'export const shared = "a";\n'],
      ['web/st-b', 'apps/office/lib/shared.ts', 'export const shared = "b";\n'],
      ['web/st-c', 'apps/office/lib/c.ts', 'export const c = 1;\n'],
    ]) {
      q.git('checkout', '-q', '-b', branch, 'main');
      qPut(file, body);
      q.git('add', '-A');
      q.git('commit', '-q', '-m', branch);
    }
    q.git('checkout', '-q', 'main');
    expect(
      'MQ-1 a lane may not queue a branch',
      qHook(`node "${kitCli}" queue add web/st-a`, 'web-engineer'),
      2,
      'only the lead puts branches in the merge queue',
    );
    expect('the lead may', qHook(`node "${kitCli}" queue add web/st-a`), 0);
    expect(
      'no lane merges the queue',
      qHook(`node "${kitCli}" queue merge --delegated`, 'web-engineer'),
      2,
      'only the lead merges',
    );
    expect(
      'and no agent merges it as the person',
      qHook(`node "${kitCli}" queue merge --person`),
      2,
      "the person's own act",
    );
    const says = (res, text) =>
      truth(res.status === 0 && res.stdout.includes(text), res.stdout + res.stderr);
    for (const b of ['web/st-a', 'web/st-b', 'web/st-c']) qKit('queue', 'add', b);
    expect(
      'a branch already waiting keeps its place',
      says(qKit('queue', 'add', 'web/st-a'), 'already in the merge queue'),
      0,
    );
    expect(
      'MQ-4 the queue lists the branches in the order their reviews passed',
      truth(
        JSON.parse(qKit('queue', '--json').stdout)
          .map((e) => `${e.branch}:${e.state}`)
          .join() === 'web/st-a:waiting,web/st-b:waiting,web/st-c:waiting',
      ),
      0,
    );
    expect(
      'there is no branch to queue',
      qKit('queue', 'add', 'web/st-z'),
      1,
      'There is no branch',
    );
    expect(
      'MQ-1 the head merges first, verified',
      says(qKit('queue', 'merge', '--delegated'), 'Next in the queue: web/st-b'),
      0,
    );
    const conflict = qKit('queue', 'merge', '--delegated');
    expect(
      'MQ-3 a branch that no longer merges cleanly is sent back, with why',
      truth(
        conflict.status === 1 &&
          conflict.stderr.includes('sent back to its lane (conflicts with main after web/st-a)'),
        conflict.stderr,
      ),
      0,
    );
    expect(
      'recorded as a send-back, as the review would',
      truth(
        readFileSync(join(q.dir, '.claude/state/reviews.jsonl'), 'utf8').includes(
          '"reason":"conflicts with main after web/st-a"',
        ),
      ),
      0,
    );
    expect(
      'and main is as web/st-a left it',
      truth(readFileSync(join(q.dir, 'apps/office/lib/shared.ts'), 'utf8').includes('"a"')),
      0,
    );
    expect(
      'the next one merges',
      says(qKit('queue', 'merge', '--delegated'), 'The queue is empty.'),
      0,
    );
    expect(
      'MQ-4 merged and sent-back entries stay listed with their state',
      truth(
        JSON.parse(qKit('queue', '--json').stdout)
          .map((e) => `${e.branch}:${e.state}`)
          .join() === 'web/st-a:merged,web/st-b:sent back,web/st-c:merged',
      ),
      0,
    );
    expect(
      'an empty queue merges nothing',
      says(qKit('queue', 'merge', '--delegated'), 'empty'),
      0,
    );
    qKit('queue', 'add', 'web/st-b');
    expect(
      'a branch can be taken out',
      says(qKit('queue', 'drop', 'web/st-b'), 'Took web/st-b out'),
      0,
    );
    expect(
      'the merge needs --delegated or --person',
      qKit('queue', 'merge'),
      1,
      'needs --delegated',
    );
  }

  // --- approvals reach lanes in their own worktrees ----------------------------------------------
  git('worktree', 'add', '-q', '.claude/worktrees/dep', '-b', 'web/st-7');
  const laneTree = join(repo, '.claude/worktrees/dep');
  const inLaneTree = (command, agent = 'web-engineer') =>
    hook('guard-bash.mjs', { cwd: laneTree, tool_input: { command }, agent_type: agent });
  expect(
    "a lane in its own worktree is told the approval in the lead's checkout",
    inLaneTree('pnpm add dayjs'),
    2,
    '> .claude/approvals/web/dep-dayjs',
  );
  approveFor('web', 'dep-dayjs');
  expect(
    "an approval given at the lead's terminal reaches the lane's worktree",
    inLaneTree('pnpm add dayjs'),
    0,
  );
  writeFileSync(
    join(laneTree, 'design/approved-screens.json'),
    JSON.stringify({ screens: [{ file: screen }] }, null, 2),
  );
  const commitRegister = 'git add design/approved-screens.json && git commit -m d';
  expect('a protected commit in the worktree needs approval', inLaneTree(commitRegister), 2);
  approveFor('web', 'design');
  expect('and the approval in the main checkout is found', inLaneTree(commitRegister), 0);
  expect(
    'it serves only the lane it was given to',
    inLaneTree(commitRegister, 'backend-engineer'),
    2,
  );
  rmSync(join(repo, '.claude/approvals'), { recursive: true });
  git('worktree', 'remove', '--force', '.claude/worktrees/dep');
  git('branch', '-q', '-D', 'web/st-7');

  // --- layers and per-file checks after an edit --------------------------------------------------
  expect(
    'domain may import schemas',
    edited('packages/domain/src/a.ts', "import { X } from '@kit/schemas';\n", 'ai-engineer'),
    0,
  );
  expect(
    'domain may not import services',
    edited(
      'packages/domain/src/b.ts',
      "import { S } from '../../../workers/services/s';\n",
      'ai-engineer',
    ),
    2,
    'may depend on schemas',
  );
  expect(
    'domain may not import I/O packages',
    edited('packages/domain/src/c.ts', "import { readFileSync } from 'node:fs';\n", 'ai-engineer'),
    2,
    'node:fs',
  );
  expect(
    'providers may import services',
    edited('workers/providers/p.ts', "import { S } from '../services/s';\n", 'backend-engineer'),
    0,
  );
  expect(
    'services may not import providers',
    edited('workers/services/s.ts', "export { P } from '../providers/p';\n", 'backend-engineer'),
    2,
  );
  expect("the project's per-file check passes", edited('docs/a.lint', 'good'), 0);
  expect('and fails', edited('docs/b.lint', 'bad'), 2, 'grep -q good docs/b.lint');
  expect('excluded files are not checked', edited('skip/c.lint', 'bad'), 0);
  for (const f of [
    'packages/domain/src/a.ts',
    'packages/domain/src/b.ts',
    'packages/domain/src/c.ts',
    'workers/providers/p.ts',
    'workers/services/s.ts',
    'docs/a.lint',
    'docs/b.lint',
    'skip/c.lint',
  ])
    rmSync(join(repo, f));

  // Agent worktrees live under .claude/worktrees, which projects usually lint-ignore: the check must
  // run inside the worktree, on the path relative to it, not be skipped as a .claude/ file.
  git('worktree', 'add', '-q', '.claude/worktrees/w', '-b', 'lane/w');
  const inWorktree = join(repo, '.claude/worktrees/w/docs/w.lint');
  mkdirSync(dirname(inWorktree), { recursive: true });
  writeFileSync(inWorktree, 'bad');
  expect(
    'edits in an agent worktree get the per-file checks, relative to that worktree',
    hook('post-edit-check.mjs', { tool_input: { file_path: inWorktree } }),
    2,
    'grep -q good docs/w.lint',
  );
  const worktree = join(repo, '.claude/worktrees/w');
  mkdirSync(join(worktree, 'supabase/migrations'), { recursive: true });
  writeFileSync(join(worktree, 'supabase/migrations/9_agent.sql'), 'select 1;');
  expect(
    "the lead's audit ignores an agent's work in progress, even with its shell in that worktree",
    hook('lane-audit.mjs', { cwd: worktree }),
    0,
  );
  expect('and so does its finish check', hook('stop-check.mjs', { cwd: worktree }), 0);
  expect(
    'the agent itself is still audited there',
    hook('lane-audit.mjs', { cwd: worktree, agent_type: 'web-engineer' }),
    2,
  );
  git('worktree', 'remove', '--force', '.claude/worktrees/w');
  git('branch', '-q', '-D', 'lane/w');

  // --- brownfield: a baseline of existing violations, and no specs yet ---------------------------
  const cli = (...args) =>
    spawnSync('node', [join(here, '..', 'bin', 'code-kit.mjs'), ...args], {
      cwd: repo,
      encoding: 'utf8',
    });
  const legacy = 'packages/domain/src/legacy.ts';
  put(legacy, "import { S } from '../../../workers/services/s';\n");
  git('add', legacy);
  expect('baseline lists existing violations', cli('baseline'), 0);
  expect('baseline --write records them', cli('baseline', '--write'), 0);
  commitAll('adopt code-kit with a baseline'); // the lead commits it, like any kit change
  expect(
    'an existing violation no longer blocks an edit',
    edited(
      legacy,
      "import { S } from '../../../workers/services/s';\nexport const x = 1;\n",
      'ai-engineer',
    ),
    0,
  );
  expect(
    'a new one in the same file does',
    edited(
      legacy,
      "import { S } from '../../../workers/services/s';\nimport { P } from '../../../workers/providers/p';\n",
      'ai-engineer',
    ),
    2,
    'providers',
  );
  expect('nor at the end', stop('ai-engineer'), 2, 'layer rules');
  const rebaseline = cli('baseline', '--write');
  const recorded = readFileSync(join(repo, '.claude/code-kit.baseline.json'), 'utf8');
  expect(
    'the baseline only shrinks: re-recording refuses the new violation',
    truth(
      rebaseline.status === 1 &&
        rebaseline.stderr.includes('only shrinks') &&
        recorded.includes('workers/services/s') &&
        !recorded.includes('workers/providers/p'),
      rebaseline.stdout + rebaseline.stderr,
    ),
    0,
  );
  git('rm', '-q', '-f', legacy, '.claude/code-kit.baseline.json');
  git('commit', '-q', '-m', 'drop the legacy fixture');
  const noSpecs = JSON.parse(fixture);
  delete noSpecs.docs;
  put('.claude/code-kit.json', JSON.stringify(noSpecs));
  git('checkout', '-q', '-b', 'lane/no-specs');
  expect(
    'without specs, lanes are not held to a spec-check',
    write('workers/jobs/y.ts', 'backend-engineer'),
    0,
  );
  put('.claude/code-kit.json', fixture);
  expect('with specs they are', write('workers/jobs/y.ts', 'backend-engineer'), 2, 'spec-check');
  git('checkout', '-q', 'lane/work');

  // --- the mod's refusal cards, read from what the hooks really print (CARD-1) -------------------
  const cardOf = (res) => refusalCard(res.stderr);
  const owned = cardOf(write('workers/jobs/z.ts', 'web-engineer'));
  expect(
    'CARD-1 a write refused for another lane reads as a card: the file, its owner, what to do',
    truth(
      owned?.title === 'Write refused: workers/jobs/z.ts' &&
        owned.why.includes('backend lane') &&
        owned.todo.startsWith('Write a short change request for the lead') &&
        owned.request === null,
      JSON.stringify(owned),
    ),
    0,
  );
  const guarded = cardOf(write('design/approved-screens.json', 'web-engineer'));
  expect(
    'a protected path names the approval that would allow it, and for which lane',
    truth(
      guarded?.title === 'Approval needed: design/approved-screens.json' &&
        guarded.request?.names.join() === 'design' &&
        guarded.request.lane === 'web',
      JSON.stringify(guarded),
    ),
    0,
  );
  const installing = cardOf(bash('npm install dayjs', 'web-engineer'));
  expect(
    'a refused install names the package, the dependency approval and the command',
    truth(
      installing?.title === 'Install refused: dayjs' &&
        installing.request?.names.join() === 'dep-dayjs' &&
        installing.request.what === 'npm install dayjs',
      JSON.stringify(installing),
    ),
    0,
  );
  const forced = cardOf(bash('git push --force'));
  expect(
    'a refused command shows the rule and the command, with nothing to approve',
    truth(
      forced?.title === 'Command refused' &&
        forced.command === 'git push --force' &&
        forced.request === null,
      JSON.stringify(forced),
    ),
    0,
  );
  // HOLD-1: which refusals a person's approval would allow, read from the hooks' real text.
  const holdOf = (res) => holdable(res.stderr);
  expect(
    'HOLD-1 a refused install is holdable, for its dependency approval and lane',
    truth(
      JSON.stringify(holdOf(bash('npm install dayjs', 'web-engineer'))?.names) ===
        '["dep-dayjs"]' && holdOf(bash('npm install dayjs', 'web-engineer')).lane === 'web',
    ),
    0,
  );
  expect(
    'so is a protected write, for its approval',
    truth(holdOf(write('design/approved-screens.json', 'web-engineer'))?.names.join() === 'design'),
    0,
  );
  expect(
    "and a lane's kit edit through the shell, for the kit approval",
    truth(holdOf(bash('echo x > .claude/agents/web.md', 'web-engineer'))?.names.join() === 'kit'),
    0,
  );
  expect(
    "but not another lane's file, a force-push or the approval log",
    truth(
      holdOf(write('workers/jobs/z.ts', 'web-engineer')) === null &&
        holdOf(bash('git push --force')) === null &&
        holdOf(bash('cat .claude/approval-log.jsonl > x')) === null,
    ),
    0,
  );
  expect(
    "text that isn't a code-kit refusal is left to Claude Code",
    truth(refusalCard('Context Graph: read src/b.ts first.') === null),
    0,
  );

  // --- the CLI -----------------------------------------------------------------------------------
  const whoLock = cli('who', 'pnpm-lock.yaml');
  expect(
    "who names the reviewer of a file any agent may write, not 'nobody'",
    truth(
      whoLock.stdout.includes('pnpm-lock.yaml: any agent may write it; the lead reviews it'),
      whoLock.stdout + whoLock.stderr,
    ),
    0,
  );
  expect(
    'and so does trace',
    truth(JSON.parse(cli('trace', 'pnpm-lock.yaml', '--json').stdout).reviewer === 'lead'),
    0,
  );
  // --- the harness settings: the person's own change (SET-1, SET-2) --------------------------------
  {
    const s = newRepo();
    cleanups.push(s.dir);
    const sCli = (...args) =>
      spawnSync('node', [join(here, '..', 'bin', 'code-kit.mjs'), ...args], {
        cwd: s.dir,
        encoding: 'utf8',
      });
    const set = sCli(
      'settings',
      'set',
      'autonomy',
      'propose',
      '--reason',
      'try proposing first',
      '--via',
      'pane',
    );
    const written = JSON.parse(readFileSync(join(s.dir, '.claude/code-kit.json'), 'utf8'));
    expect(
      'SET-2 settings set writes the harness setting into the config',
      truth(set.status === 0 && written.harness?.autonomy === 'propose', set.stdout + set.stderr),
      0,
    );
    expect(
      "and gives the kit approval with the person's reason, marked as the pane's",
      truth(
        readFileSync(join(s.dir, '.claude/approvals/kit'), 'utf8').includes(
          'try proposing first (changed in the code-kit pane)',
        ),
      ),
      0,
    );
    const listed = JSON.parse(sCli('settings', '--json').stdout);
    expect(
      'settings --json lists every setting with its value and default',
      truth(
        listed.find((r) => r.key === 'autonomy')?.value === 'propose' &&
          listed.find((r) => r.key === 'hold.minutes')?.default === 2,
      ),
      0,
    );
    const harness = JSON.parse(sCli('check', '--json').stdout).harness;
    expect(
      'USE-4 check --json carries the harness settings in force, for the mod',
      truth(
        harness?.autonomy === 'propose' && harness?.background?.pauseAtPercent === 80,
        JSON.stringify(harness),
      ),
      0,
    );
    const bad = sCli('settings', 'set', 'hold.minutes', '99', '--reason', 'longer');
    expect(
      'a value out of range changes nothing',
      truth(
        bad.status === 1 &&
          bad.stderr.includes('Nothing changed') &&
          JSON.parse(readFileSync(join(s.dir, '.claude/code-kit.json'), 'utf8')).harness.hold ===
            undefined,
        bad.stderr,
      ),
      0,
    );
    expect(
      'and a reason is needed',
      sCli('settings', 'set', 'autonomy', 'off'),
      1,
      'Give a reason',
    );
    const sBash = (command, agent) =>
      spawnSync('node', [join(hooks, 'guard-bash.mjs')], {
        input: JSON.stringify({
          cwd: s.dir,
          tool_input: { command },
          ...(agent ? { agent_type: agent } : {}),
        }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: s.dir },
        encoding: 'utf8',
      });
    expect(
      'the lead may not change the settings',
      sBash('node "/x/code-kit.mjs" settings set autonomy autonomous --reason go'),
      2,
      "the person's own act",
    );
    expect(
      'nor may a lane',
      sBash('code-kit settings set autonomy off --reason x', 'web-engineer'),
      2,
      "the person's own act",
    );
    expect('but listing them is fine', sBash('code-kit settings --json'), 0);

    // HOLD-3, HOLD-4: a held call waits in `code-kit hold` until the band answers, or the hold time ends.
    const waiting = (id, minutes) =>
      new Promise((done) => {
        const child = spawn(
          'node',
          [join(here, '..', 'bin', 'code-kit.mjs'), 'hold', id, '--minutes', minutes],
          { cwd: s.dir },
        );
        let said = '';
        child.stdout.on('data', (d) => (said += d));
        child.on('close', () => done(said.trim()));
      });
    const approved = waiting('toolu_held1', '1');
    await new Promise((r) => setTimeout(r, 400));
    const answered = sCli('hold', 'toolu_held1', '--answer', 'approved');
    expect(
      'HOLD-3 hold waits until the band answers, and prints the answer',
      truth(answered.status === 0 && (await approved) === 'approved', answered.stderr),
      0,
    );
    expect(
      'and the answer is used up',
      truth(!existsSync(join(s.dir, '.claude/state/held/toolu_held1'))),
      0,
    );
    expect(
      'HOLD-4 with no answer in the hold time it times out',
      truth((await waiting('toolu_held2', '0.01')) === 'timed out'),
      0,
    );
    expect(
      'an id that could reach outside the folder is refused',
      sCli('hold', '../config', '--answer', 'approved'),
      1,
    );
  }

  const check = cli('check');
  expect(
    'check validates the config',
    truth(check.status === 0 && check.stdout.includes('is valid'), check.stderr),
    0,
  );
  const checked = JSON.parse(cli('check', '--json').stdout);
  expect(
    'PANE-5 check --json gives the lanes, with their agents, for the mod',
    truth(
      checked.valid && checked.lanes.web.agent === 'web-engineer' && checked.problems.length === 0,
      JSON.stringify(checked),
    ),
    0,
  );
  const badCheck = cli('check', '--json', '--config', 'nope.json');
  expect(
    'and reports a missing or invalid config as JSON, not an error',
    truth(
      badCheck.status === 1 && JSON.parse(badCheck.stdout).exists === false,
      badCheck.stdout + badCheck.stderr,
    ),
    0,
  );
  const draft = JSON.parse(fixture);
  draft.lanes.jobs = { agent: 'jobs-engineer', paths: ['workers/jobs/**'] };
  draft.lanes.backend.exclude = ['workers/ai/**', 'workers/jobs/**'];
  put('.claude/code-kit.draft.json', JSON.stringify(draft));
  put('workers/jobs/run.ts', "import { S } from '../services/s';\n");
  put('workers/services/s.ts', 'export const S = 1;\n');
  git('add', 'workers/jobs/run.ts', 'workers/services/s.ts');
  const diff = cli('diff', '--config', '.claude/code-kit.draft.json');
  expect(
    'diff shows the new lane and the files that move to it',
    truth(
      diff.stdout.includes('+ lane jobs: jobs-engineer') &&
        diff.stdout.includes(
          'backend lane / backend-engineer → jobs lane / jobs-engineer: 1 file(s)',
        ),
      diff.stdout + diff.stderr,
    ),
    0,
  );
  const graph = cli('graph', '--depth', '2');
  expect(
    'graph shows folder dependencies',
    truth(graph.stdout.includes('workers/jobs → workers/services'), graph.stdout),
    0,
  );
  put('pnpm-lock.yaml', 'lockfileVersion: 9\n');
  put('random/orphan.ts', 'export {};\n');
  git('add', 'pnpm-lock.yaml', 'random/orphan.ts');
  const unowned = cli('unowned');
  expect(
    'unowned lists files nobody may write',
    truth(unowned.stdout.includes('random/orphan.ts'), unowned.stdout + unowned.stderr),
    0,
  );
  expect(
    'but not files any actor may write',
    truth(!unowned.stdout.includes('pnpm-lock.yaml'), unowned.stdout),
    0,
  );
  git('rm', '-q', '--cached', 'pnpm-lock.yaml', 'random/orphan.ts');
  rmSync(join(repo, 'pnpm-lock.yaml'));
  rmSync(join(repo, 'random/orphan.ts'));
  expect('an invalid draft is reported', cli('check', '--config', 'nope.json'), 1);
  git('rm', '-q', '-f', 'workers/jobs/run.ts', 'workers/services/s.ts');
  rmSync(join(repo, '.claude/code-kit.draft.json'));

  // --- proof before finishing --------------------------------------------------------------------
  put('runbooks/x.md', 'x');
  expect(
    'a lane cannot finish with uncommitted work',
    stop('platform-engineer'),
    2,
    'Commit your work',
  );
  commitAll('lane work');
  expect('a lane with committed work may finish', stop('platform-engineer'), 0);
  expect('read-only agents are not checked', stop('Explore'), 0);
  put('workers/jobs/x.ts', 'export const x = 1;\n');
  expect(
    'a check whose files changed runs, and its failure blocks',
    stop('backend-engineer'),
    2,
    'workers: `test -f workers/ok` fails',
  );
  put('workers/ok', '');
  expect(
    'once it passes, the lane still commits first',
    stop('backend-engineer'),
    2,
    'Commit your work',
  );
  commitAll('workers');
  put('supabase/functions/a/index.ts', '');
  put('supabase/functions/b/index.ts', '');
  put('supabase/functions/b/ok', '');
  expect(
    '"each" runs the check in every changed directory',
    stop('backend-engineer'),
    2,
    'in supabase/functions/a',
  );
  put('supabase/functions/a/ok', '');
  expect('and passes when every one does', stop('backend-engineer'), 2, 'Commit your work');
  commitAll('functions');
  put('supabase/migrations/4_w.sql', 'select 1;');
  expect('the owning lane runs its check', stop('db-engineer'), 2, 'Commit your work');
  rmSync(join(repo, 'supabase/migrations/4_w.sql'));
  put('tests/db/x.sql', 'select 1;');
  expect(
    "a lane that doesn't own a check's files may not change them",
    stop('qa-engineer'),
    2,
    'database files it does not own',
  );
  rmSync(join(repo, 'tests/db/x.sql'));
  put('runbooks/tool/x.md', 'x');
  expect('a missing tool skips its check', stop('platform-engineer'), 2, 'Commit your work');
  rmSync(join(repo, 'runbooks/tool/x.md'));
  put('runbooks/required/x.md', 'x');
  expect('unless the check requires it', stop('platform-engineer'), 2, 'is not installed');
  rmSync(join(repo, 'runbooks/required/x.md'));
  put('packages/domain/src/d.ts', "import { S } from '../../../workers/services/s';\n");
  expect(
    'layer rules are checked at the end too (shell writes)',
    stop('ai-engineer'),
    2,
    'layer rules',
  );
  rmSync(join(repo, 'packages/domain/src/d.ts'));
  expect('the lead finishes with nothing changed', stop(), 0);

  // --- the finish check keeps its own count, not the flag every stop hook shares ------------------
  put('runbooks/loop.md', 'x');
  const stopAgain = (session = 's1') =>
    hook('stop-check.mjs', {
      agent_type: 'platform-engineer',
      session_id: session,
      stop_hook_active: true,
    });
  expect(
    "another plugin's block (stop_hook_active) doesn't switch the finish check off",
    stopAgain(),
    2,
    'Commit your work',
  );
  expect('the same problem blocks again', stopAgain(), 2, 'Commit your work');
  expect('and a third time, saying it is the last', stopAgain(), 2, "won't block on it again");
  expect('then lets the finish through rather than loop', stopAgain(), 0);
  expect('a new session counts from the start', stopAgain('s2'), 2, 'Commit your work');
  const failing = JSON.parse(cli('stops', '--json', '--session', 's2').stdout);
  expect(
    'BAND-2 stops lists the finish check failing in a session, with whose and why',
    truth(
      failing.length === 1 &&
        failing[0].agentType === 'platform-engineer' &&
        failing[0].title.startsWith('Commit your work'),
      JSON.stringify(failing),
    ),
    0,
  );
  expect(
    'and none for a session whose finish went through',
    truth(JSON.parse(cli('stops', '--json', '--session', 's1').stdout).length === 0),
    0,
  );
  rmSync(join(repo, 'runbooks/loop.md'));

  // --- verify: a branch's changes as a whole, for CI and review ---------------------------------
  const v = newRepo();
  cleanups.push(v.dir);
  const vPut = (rel, body = '') => {
    mkdirSync(dirname(join(v.dir, rel)), { recursive: true });
    writeFileSync(join(v.dir, rel), body);
  };
  const vCommit = (m) => {
    v.git('add', '-A');
    v.git('commit', '-q', '-m', m);
  };
  const vCli = (...args) =>
    spawnSync('node', [join(here, '..', 'bin', 'code-kit.mjs'), ...args], {
      cwd: v.dir,
      encoding: 'utf8',
    });
  const verify = (...args) => vCli('verify', '--base', 'main', ...args);
  const says = (res, text) =>
    truth(res.stdout.includes(text) || res.stderr.includes(text), res.stdout + res.stderr);
  const failsWith = (res, text) =>
    truth(res.status === 1 && (res.stdout + res.stderr).includes(text), res.stdout + res.stderr);
  vPut('design/approved-screens.json', JSON.stringify({ screens: [] }));
  vPut('packages/schemas/src/s.ts', 'export const S = 1;\n');
  vCommit('base');

  v.git('checkout', '-q', '-b', 'web/st-1');
  vPut('apps/office/lib/a.ts', 'export const a = 1;\n');
  vCommit('web work');
  expect('verify passes a lane branch that stays in its paths', verify('--no-checks'), 0);
  const asJson = verify('--no-checks', '--json');
  expect(
    'CARD-3 verify --json reports the branch, its lane and the problems by group',
    truth(
      asJson.status === 0 &&
        (() => {
          const j = JSON.parse(asJson.stdout);
          return j.lane === 'web' && j.problems === 0 && Array.isArray(j.found.ownership);
        })(),
      asJson.stdout + asJson.stderr,
    ),
    0,
  );
  expect(
    'and holds it to the lane named by the branch',
    says(verify('--no-checks'), 'held to the web lane'),
    0,
  );
  vPut('workers/x.ts', 'export const x = 1;\n');
  vCommit('strays');
  expect(
    "verify fails a lane branch that changes another lane's files",
    failsWith(verify('--no-checks'), "workers/x.ts: the web lane doesn't own it"),
    0,
  );
  expect(
    '--branch names the lane when CI checks out a merge commit',
    failsWith(
      verify('--no-checks', '--branch', 'backend/st-2'),
      "apps/office/lib/a.ts: the backend lane doesn't own it",
    ),
    0,
  );
  expect(
    "a lead branch is held to the lead's paths for what its own commits change",
    failsWith(
      verify('--no-checks', '--branch', 'lead/m1'),
      "apps/office/lib/a.ts: changed by a commit on the lead's branch, but the lead doesn't own it",
    ),
    0,
  );
  // Lane work reaches the lead's branch by merging the lane's branch, and isn't the lead's own change.
  const laneBranch = v.git('branch', '--show-current').trim();
  v.git('checkout', '-q', '-b', 'lead/m9', 'main');
  vPut('docs/notes.md', 'the lead writes here\n');
  vCommit('lead notes');
  v.git('merge', '-q', '--no-ff', '-m', 'Merge the lane', laneBranch);
  const leadVerify = verify('--no-checks');
  expect(
    "lane work merged into the lead's branch isn't held to the lead's paths",
    truth(
      !(leadVerify.stdout + leadVerify.stderr).includes(
        "changed by a commit on the lead's branch",
      ) && (leadVerify.stdout + leadVerify.stderr).includes("held to the lead's paths"),
      leadVerify.stdout + leadVerify.stderr,
    ),
    0,
  );
  v.git('checkout', '-q', laneBranch);
  vPut('apps/office/app/home/page.tsx', 'export default function P() {}\n');
  vCommit('screen');
  expect(
    'verify fails a screen whose design is not approved',
    failsWith(verify('--no-checks', '--branch', 'x'), 'apps/office/app/home/page.tsx is a screen'),
    0,
  );
  vPut('.env.local', 'KEY=1');
  vCommit('secret');
  expect(
    'verify fails committed secrets',
    failsWith(verify('--no-checks'), '.env.local may hold secrets'),
    0,
  );
  v.git('rm', '-q', '.env.local');
  vCommit('secret removed');
  expect(
    "a secret committed and then deleted still fails: it's in the branch's history",
    failsWith(
      verify('--no-checks'),
      ".env.local may hold secrets, and it's in this branch's history",
    ),
    0,
  );
  // Where gitleaks is installed, verify scans the branch's commits with it (a stand-in here).
  const fakeBin = mkdtempSync(join(tmpdir(), 'code-kit-gitleaks-'));
  cleanups.push(fakeBin);
  writeFileSync(
    join(fakeBin, 'gitleaks'),
    '#!/bin/sh\necho "Finding: AWS key in apps/office/lib/a.ts (commit abc123)"\nexit 1\n',
    { mode: 0o755 },
  );
  const scanned = spawnSync(
    'node',
    [join(here, '..', 'bin', 'code-kit.mjs'), 'verify', '--base', 'main', '--no-checks'],
    {
      cwd: v.dir,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
    },
  );
  expect(
    "and what gitleaks finds in the branch's commits",
    failsWith(scanned, "gitleaks found possible secrets in this branch's commits"),
    0,
  );

  v.git('checkout', '-q', 'main');
  v.git('checkout', '-q', '-b', 'lead/contracts');
  vPut(
    'design/approved-screens.json',
    JSON.stringify({ screens: [{ file: 'apps/office/app/home/page.tsx' }] }),
  );
  vCommit('registered by hand');
  expect(
    'verify fails a protected change with no approval-log entry',
    failsWith(verify('--no-checks'), 'no approval-log entry records this change'),
    0,
  );
  v.git('reset', '-q', '--hard', 'main');
  vPut(
    'design/approved-screens.json',
    JSON.stringify({ screens: [{ file: 'apps/office/app/home/page.tsx' }] }),
  );
  const viaHook = spawnSync('node', [join(hooks, 'guard-bash.mjs')], {
    input: JSON.stringify({
      cwd: v.dir,
      tool_input: { command: 'git add -A && git commit -m register' },
    }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: v.dir },
    encoding: 'utf8',
  });
  expect(
    'the commit hook logs a protected file staged by `git add -A && git commit`',
    truth(
      viaHook.status === 0 &&
        readFileSync(join(v.dir, '.claude/approval-log.jsonl'), 'utf8').includes(
          '"file":"design/approved-screens.json"',
        ),
      viaHook.stderr,
    ),
    0,
  );
  vCommit('registered through the hook');
  expect('verify passes a protected change the hook logged', verify('--no-checks'), 0);
  v.git('branch', '-q', '-f', 'main', 'HEAD'); // merged: main now has a log
  const log = readFileSync(join(v.dir, '.claude/approval-log.jsonl'), 'utf8');
  vPut('.claude/approval-log.jsonl', log.replace('design/approved-screens.json', 'forged'));
  vCommit('rewrite the log');
  expect(
    'verify fails a rewritten approval log',
    failsWith(verify('--no-checks'), 'append-only'),
    0,
  );
  v.git('reset', '-q', '--hard', 'HEAD~1');
  v.git('checkout', '-q', 'main');
  appendFileSync(
    join(v.dir, '.claude/approval-log.jsonl'),
    '{"file":"elsewhere","approval":"lead"}\n',
  );
  vCommit('main moves on');
  v.git('checkout', '-q', 'lead/contracts');
  expect(
    "verify compares with where the branch left the base, not the base's tip",
    verify('--no-checks'),
    0,
  );
  // The README's `merge=union` puts the branch's own entries before the base's newer ones.
  writeFileSync(join(v.dir, '.git/info/attributes'), '.claude/approval-log.jsonl merge=union\n');
  const branchEntry = '{"file":"design/approved-screens.json","approval":"design","note":"again"}';
  appendFileSync(join(v.dir, '.claude/approval-log.jsonl'), `${branchEntry}\n`);
  vCommit('the branch logs another change');
  v.git('merge', '-q', '--no-edit', 'main');
  const merged = readFileSync(join(v.dir, '.claude/approval-log.jsonl'), 'utf8');
  expect(
    'verify reads a union-merged approval log as appended to, keeping the branch entries',
    truth(
      merged.indexOf(branchEntry) < merged.indexOf('"file":"elsewhere"') &&
        verify('--no-checks').status === 0,
      merged,
    ),
    0,
  );
  const lines = merged.split('\n').filter(Boolean);
  const elsewhere = lines.findIndex((l) => l.includes('"file":"elsewhere"'));
  [lines[0], lines[elsewhere]] = [lines[elsewhere], lines[0]];
  vPut('.claude/approval-log.jsonl', `${lines.join('\n')}\n`);
  vCommit('reorder the log');
  expect(
    'verify still fails a log whose earlier lines were reordered',
    failsWith(verify('--no-checks'), 'append-only'),
    0,
  );
  v.git('reset', '-q', '--hard', 'HEAD~1');
  vPut('packages/domain/src/d.ts', "import { S } from '../../../workers/services/s';\n");
  vPut('workers/services/s.ts', 'export const S = 1;\n');
  vCommit('domain reaches into services');
  expect(
    'verify fails new layer violations',
    failsWith(verify('--no-checks', '--branch', 'x'), 'Layer rules'),
    0,
  );
  vPut(
    '.claude/code-kit.baseline.json',
    JSON.stringify({
      layers: {
        'packages/domain/src/d.ts': [
          'packages/domain/src/d.ts: domain may not import services (../../../workers/services/s)',
        ],
      },
    }),
  );
  vCommit('excuse it');
  expect(
    'verify fails a baseline that grew',
    failsWith(verify('--no-checks', '--branch', 'x'), 'only shrinks'),
    0,
  );

  v.git('checkout', '-q', 'main');
  v.git('checkout', '-q', '-b', 'backend/st-3');
  vPut('workers/jobs/j.ts', 'export const j = 1;\n');
  vCommit('backend work');
  expect(
    'verify runs the checks for changed files',
    failsWith(verify(), 'workers: `test -f workers/ok` fails'),
    0,
  );
  expect('--no-checks leaves them to CI', verify('--no-checks'), 0);

  v.git('checkout', '-q', 'main');
  v.git('checkout', '-q', '-b', 'web/st-8');
  const baseLog = existsSync(join(v.dir, '.claude/approval-log.jsonl'))
    ? readFileSync(join(v.dir, '.claude/approval-log.jsonl'), 'utf8')
    : '';
  vPut('package.json', '{ "dependencies": { "dayjs": "1" } }\n');
  vCommit('add dayjs');
  expect(
    "verify fails a lane's manifest change outside its paths with no dependency approval",
    failsWith(verify('--no-checks'), "package.json: the web lane doesn't own it"),
    0,
  );
  vPut(
    '.claude/approval-log.jsonl',
    `${baseLog}{"approval":"dependency","packages":["dep-dayjs"],"reason":"dates","file":"package.json"}\n`,
  );
  vCommit('logged by the commit hook');
  expect('and passes it once the dependency approval is logged', verify('--no-checks'), 0);
  vPut('apps/field/package.json', '{}\n');
  vPut(
    '.claude/approval-log.jsonl',
    `${readFileSync(join(v.dir, '.claude/approval-log.jsonl'), 'utf8')}{"approval":"dependency","file":"apps/field/package.json"}\n`,
  );
  vCommit("another lane's manifest");
  expect(
    "a dependency approval never covers another lane's manifest",
    failsWith(verify('--no-checks'), "apps/field/package.json: the web lane doesn't own it"),
    0,
  );
  v.git('checkout', '-q', 'main');
  v.git('branch', '-q', '-D', 'web/st-8');

  // --- status: stories and requirements, from the plan, the specs, git and the tests ------------
  v.git('checkout', '-q', 'main');
  v.git('branch', '-q', '-D', 'web/st-1');
  vPut(
    'docs/spec/01-booking.md',
    '# 01. Booking\n\n### BOOK-1 Request a booking\n\nx\n\n### BOOK-2 Cancel\n\nx\n\n### BOOK-3 Waitlist (removed)\n\nx\n\n### BOOK-4 Reminders\n\nx\n',
  );
  const plan = (st1) =>
    `# Plan\n\n## M1\n\n### ST-1 Booking form\n\n**Lane:** web\n**Requirements:** BOOK-1\n**Status:** ${st1}\n\n` +
    '### ST-2 Cancel\n\n**Lane:** web\n**Requirements:** BOOK-2\n**Depends on:** ST-1\n**Status:** todo\n\n' +
    '### ST-3 Stray\n\n**Lane:** nope\n**Requirements:** BOOK-9\n';
  vPut('docs/spec/plan.md', plan('todo'));
  vCommit('specs and plan');
  v.git('checkout', '-q', '-b', 'web/st-1');
  vPut(
    'apps/office/e2e/booking.spec.ts',
    "test('BOOK-1 a customer requests a booking', () => {});\n",
  );
  vCommit('ST-1');
  v.git('checkout', '-q', 'main');
  const st = JSON.parse(vCli('status', '--json').stdout);
  const story = (id) => st.stories.find((s) => s.id === id);
  const req = (id) => st.requirements.find((r) => r.id === id);
  expect(
    'status: a story with commits on its branch is in review',
    truth(story('ST-1').state === 'review', JSON.stringify(story('ST-1'))),
    0,
  );
  expect(
    'a story waits on an unfinished dependency',
    truth(story('ST-2').state === 'blocked' && story('ST-2').waitingOn[0] === 'ST-1'),
    0,
  );
  expect(
    'the plan is flagged as out of date',
    truth(st.drift.some((d) => d.story === 'ST-1' && d.actual === 'review')),
    0,
  );
  expect(
    'gaps are listed: unknown requirement, unknown lane, requirement in no story',
    truth(
      ['cites BOOK-9', 'unknown lane "nope"', 'BOOK-4 is in no story'].every((t) =>
        st.problems.some((p) => p.includes(t)),
      ) && !st.problems.some((p) => p.includes('BOOK-3')),
      st.problems.join(' / '),
    ),
    0,
  );
  expect('a removed requirement needs no story', truth(req('BOOK-3').state === 'removed'), 0);
  v.git('merge', '-q', '--ff-only', 'web/st-1');
  vPut('docs/spec/plan.md', plan('review'));
  vCommit('ST-1 reviewed');
  const after = JSON.parse(vCli('status', '--json').stdout);
  expect(
    'once merged, a reviewed story is done and the next is ready',
    truth(
      after.stories.find((s) => s.id === 'ST-1').state === 'done' &&
        after.stories.find((s) => s.id === 'ST-2').state === 'ready',
    ),
    0,
  );
  const book1 = after.requirements.find((r) => r.id === 'BOOK-1');
  expect(
    'a requirement is done with its stories, and tested when a test names it',
    truth(
      book1.state === 'done' && book1.tests[0] === 'apps/office/e2e/booking.spec.ts',
      JSON.stringify(book1),
    ),
    0,
  );
  expect('status prints a readable report', says(vCli('status'), 'Ready to dispatch: ST-2'), 0);

  // --- adapters: another tool in the project adds its own rules ---------------------------------
  const c = newRepo();
  cleanups.push(c.dir);
  c.git('checkout', '-q', '-b', 'web/st-9');
  const cHook = (name, input) =>
    spawnSync('node', [join(hooks, name)], {
      input: JSON.stringify({ cwd: c.dir, ...input }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: c.dir },
      encoding: 'utf8',
    });
  const cWrite = (rel, agent) =>
    cHook('guard-paths.mjs', { tool_input: { file_path: join(c.dir, rel) }, ...as(agent) });
  const cBash = (command) => cHook('guard-bash.mjs', { tool_input: { command } });
  const cCli = (...args) =>
    spawnSync('node', [join(here, '..', 'bin', 'code-kit.mjs'), ...args], {
      cwd: c.dir,
      encoding: 'utf8',
    });
  expect(
    'without .ctx/, a lane may not write Context Graph decisions',
    cWrite('.ctx/decisions.ctx', 'web-engineer'),
    2,
  );
  mkdirSync(join(c.dir, '.ctx'));
  expect('with .ctx/, any lane records decisions', cWrite('.ctx/decisions.ctx', 'web-engineer'), 0);
  expect(
    "but a lane may not change ctx's rules without approval",
    cWrite('.ctx/graph.ctx', 'web-engineer'),
    2,
    "Context Graph's rules",
  );
  expect("the lead owns ctx's rules", cWrite('.ctx/graph.ctx'), 0);
  expect(
    'no Claude actor writes a ratification trailer',
    cBash('git commit -m "ratify" --trailer "Ctx-Ratified-By: someone"'),
    2,
    "a person's act",
  );
  expect('other commits are untouched', cBash('git commit -m "ST-9 cancel"'), 0);
  for (const act of [
    'ctx ratify C:events --commit',
    'cd src && ' + 'ctx drop src.small --reason no',
    'node "/x/adapters/claude-code/ctx.mjs" drop src.small --reason no',
    'npx @warren-dean/context-graph ratify C:events --commit',
  ])
    expect(
      `no Claude actor runs the person's ctx act: ${act}`,
      cBash(act),
      2,
      "the person's own acts",
    );
  expect('ratifying without a commit is untouched', cBash('ctx ratify C:events'), 0);
  expect(
    'text that only mentions the act is untouched',
    cBash("echo 'ctx ratify C:events --commit'"),
    0,
  );
  expect(
    'the lead commits a delegated ratification',
    cBash('git commit -m "ratify" --trailer "Ctx-Ratified-By: sidequest-lead (delegated)"'),
    0,
  );
  expect(
    'a lane never does',
    cHook('guard-bash.mjs', {
      tool_input: {
        command: 'git commit -m "ratify" --trailer "Ctx-Ratified-By: sidequest-lead (delegated)"',
      },
      agent_type: 'web-engineer',
    }),
    2,
    "Context Graph's [delegate] rules",
  );
  writeFileSync(join(c.dir, '.claude/code-kit.json'), relayFixture);
  expect(
    'with approvals.lead on, the lead adds the trailer the person gives in chat',
    cBash('git commit -m "ratify" --trailer "Ctx-Ratified-By: someone"'),
    0,
  );
  writeFileSync(join(c.dir, '.claude/code-kit.json'), fixture);
  const listed = cCli('adapters');
  expect(
    'adapters lists what the active adapter adds, and its setup',
    truth(
      listed.stdout.includes('context-graph: active') && listed.stdout.includes('merge=union'),
      listed.stdout + listed.stderr,
    ),
    0,
  );
  expect('with .ctx/, any lane writes file cards too', cWrite('.ctx/cards.ctx', 'web-engineer'), 0);

  // --- layer rules before the write --------------------------------------------------------------
  const cEdit = (tool, rel, toolInput) =>
    cHook('guard-paths.mjs', {
      tool_name: tool,
      tool_input: { file_path: join(c.dir, rel), ...toolInput },
    });
  expect(
    'a write that would break a layer is refused before it reaches disk',
    cEdit('Write', 'packages/schemas/src/order.ts', {
      content: "import { rule } from '../../domain/src/rule';\nexport type Order = {};\n",
    }),
    2,
    'would break the layer rules',
  );
  expect(
    'nothing was written',
    truth(!existsSync(join(c.dir, 'packages/schemas/src/order.ts'))),
    0,
  );
  expect(
    'a write within the rules goes through',
    cEdit('Write', 'packages/schemas/src/order.ts', { content: 'export type Order = {};\n' }),
    0,
  );
  mkdirSync(join(c.dir, 'packages/schemas/src'), { recursive: true });
  writeFileSync(
    join(c.dir, 'packages/schemas/src/legacy.ts'),
    "import { rule } from '../../domain/src/rule';\nexport const a = 1;\n",
  );
  expect(
    'an edit that adds no violation is allowed in a file that already has one',
    cEdit('Edit', 'packages/schemas/src/legacy.ts', { old_string: 'a = 1', new_string: 'a = 2' }),
    0,
  );
  expect(
    'but one that adds a violation is not',
    cEdit('Edit', 'packages/schemas/src/legacy.ts', {
      old_string: 'export const a = 1;',
      new_string: "import { svc } from '../../../workers/services/s';\nexport const a = 1;",
    }),
    2,
    'would break the layer rules',
  );
  rmSync(join(c.dir, 'packages'), { recursive: true, force: true });

  const off = JSON.parse(fixture);
  off.adapters = { 'context-graph': false };
  writeFileSync(join(c.dir, '.claude/code-kit.json'), JSON.stringify(off));
  expect('the config can switch an adapter off', cWrite('.ctx/decisions.ctx', 'web-engineer'), 2);
  expect('and says so', says(cCli('adapters'), 'context-graph: switched off in the config'), 0);

  // A person's ratification from their terminal is signed with the trailer, not logged by the hooks.
  const r = newRepo();
  cleanups.push(r.dir);
  mkdirSync(join(r.dir, '.ctx'));
  writeFileSync(join(r.dir, '.ctx/graph.ctx'), 'L L:repo Repo\n');
  r.git('add', '-A');
  r.git('commit', '-q', '-m', 'graph');
  r.git('checkout', '-q', '-b', 'ratify');
  const rVerify = () =>
    spawnSync(
      'node',
      [join(here, '..', 'bin', 'code-kit.mjs'), 'verify', '--base', 'main', '--no-checks'],
      { cwd: r.dir, encoding: 'utf8' },
    );
  const rCommit = (line, trailer) => {
    writeFileSync(join(r.dir, '.ctx/graph.ctx'), `L L:repo Repo\n${line}\n`);
    r.git('add', '-A');
    r.git('commit', '-q', '-m', 'ratify', ...(trailer ? ['--trailer', trailer] : []));
  };
  rCommit('C C:events Events', 'Ctx-Ratified-By: warren');
  expect("verify accepts a graph change signed with a person's ratification trailer", rVerify(), 0);
  rCommit('C C:jobs Jobs', 'Ctx-Ratified-By: sidequest-lead (delegated)');
  expect(
    'but not a delegated one, which the hooks log',
    failsWith(rVerify(), 'no approval-log entry records this change'),
    0,
  );
  r.git('reset', '-q', '--hard', 'HEAD~1');
  rCommit('C C:jobs Jobs');
  expect(
    'nor a later unsigned commit to the same file',
    failsWith(rVerify(), 'no approval-log entry records this change'),
    0,
  );

  // --- next: the step to take, from the project's state -----------------------------------------
  const nextIn = (dir) => {
    const res = spawnSync('node', [join(here, '..', 'bin', 'code-kit.mjs'), 'next', '--json'], {
      cwd: dir,
      encoding: 'utf8',
    });
    try {
      return JSON.parse(res.stdout);
    } catch {
      return { step: `unreadable: ${res.stdout}${res.stderr}` };
    }
  };
  const nextIs = (label, dir, step, args) => {
    const n = nextIn(dir);
    expect(
      label,
      truth(n.step === step && (args === undefined || n.args === args), JSON.stringify(n)),
      0,
    );
    return n;
  };
  const blank = mkdtempSync(join(tmpdir(), 'code-kit-blank-'));
  cleanups.push(blank);
  const blankNext = nextIs('next: a blank folder starts with spec-design', blank, 'spec-design');
  expect(
    'and says git is needed before init',
    truth(blankNext.attention.some((a) => a.includes('git init'))),
    0,
  );
  const idea = newRepo(false);
  cleanups.push(idea.dir);
  const brief = (status, question = '') =>
    `# X\n\n**Status:** ${status}\n\n## Open questions\n\n| Question | Owner | Blocks |\n| --- | --- | --- |\n${question}`;
  mkdirSync(join(idea.dir, 'docs'));
  writeFileSync(
    join(idea.dir, 'docs/brief.md'),
    brief('scoped', '| Which payment provider? | Lead | PAY-1 |\n'),
  );
  const scoped = nextIs(
    'a spec still being shaped goes back to spec-design',
    idea.dir,
    'spec-design',
  );
  expect(
    'with its open questions noted',
    truth(scoped.attention.some((a) => a.includes('1 open question(s) in docs/brief.md'))),
    0,
  );
  writeFileSync(join(idea.dir, 'docs/brief.md'), brief('ready'));
  nextIs('a ready spec goes to init, with its docs', idea.dir, 'init', 'docs');
  mkdirSync(join(idea.dir, '.claude'));
  writeFileSync(join(idea.dir, '.claude/code-kit.draft.json'), '{}');
  nextIs('a waiting draft goes to init for approval', idea.dir, 'init');
  writeFileSync(join(idea.dir, '.claude/code-kit.json'), '{ "version": 2 }');
  nextIs('an invalid config goes to check', idea.dir, 'check');
  const legacyRepo = newRepo(false);
  cleanups.push(legacyRepo.dir);
  mkdirSync(join(legacyRepo.dir, 'src'));
  writeFileSync(join(legacyRepo.dir, 'src/app.ts'), 'export {};\n');
  legacyRepo.git('add', '-A');
  nextIs('existing code without code-kit goes to init', legacyRepo.dir, 'init');

  const ready = nextIs('with the kit on: ready stories go to dispatch', v.dir, 'dispatch', 'ST-2');
  expect(
    'a ready story with a gap in the plan is held back',
    truth(ready.attention.some((a) => a.includes("ST-3 can't be dispatched"))),
    0,
  );
  v.git('checkout', '-q', '-b', 'web/st-2');
  vPut('apps/office/lib/cancel.ts', 'export const cancel = 1;\n');
  vCommit('ST-2');
  v.git('checkout', '-q', 'main');
  nextIs('finished stories go to review', v.dir, 'review', 'ST-2');
  // A review that sends the branch back: the same commits aren't finished work to review again.
  const sent = vCli('sent-back', 'web/st-2', '--reason', 'cancel needs its test');
  expect(
    'sent-back records the commit a review sent back',
    truth(sent.status === 0, sent.stderr),
    0,
  );
  const backState = JSON.parse(vCli('status', '--json').stdout).stories.find(
    (s) => s.id === 'ST-2',
  );
  expect(
    'status reads a sent-back branch as sent back',
    truth(backState.state === 'sent back', JSON.stringify(backState)),
    0,
  );
  nextIs("next proposes the lane's fix, not another review", v.dir, 'dispatch', 'ST-2');
  v.git('checkout', '-q', 'web/st-2');
  vPut('apps/office/lib/cancel.test.ts', "test('BOOK-2 cancel', () => {});\n");
  vCommit('ST-2 fix');
  v.git('checkout', '-q', 'main');
  nextIs('once the lane commits its fix, the branch goes to review again', v.dir, 'review', 'ST-2');
  // The merge queue: a branch whose review passed isn't reviewed again; the person merges it here.
  vCli('queue', 'add', 'web/st-2');
  const waitingMerge = nextIn(v.dir);
  expect(
    'MQ-2 a queued branch is not reviewed again, and waits for the person where merges are not delegated',
    truth(
      waitingMerge.step !== 'review' &&
        waitingMerge.attention.some((a) =>
          a.includes('web/st-2 passed review and waits for the person'),
        ),
      JSON.stringify(waitingMerge),
    ),
    0,
  );
  const vConfig = readFileSync(join(v.dir, '.claude/code-kit.json'), 'utf8');
  writeFileSync(
    join(v.dir, '.claude/code-kit.json'),
    JSON.stringify({ ...JSON.parse(vConfig), approvals: { delegate: { merge: true } } }),
  );
  nextIs(
    'MQ-2 where merges are delegated, the lead merges the head first',
    v.dir,
    'merge',
    'web/st-2',
  );
  writeFileSync(
    join(v.dir, '.claude/code-kit.json'),
    JSON.stringify({
      ...JSON.parse(vConfig),
      approvals: { delegate: { merge: true } },
      harness: { autonomy: 'propose' },
    }),
  );
  expect(
    'but not under autonomy propose: the person merges',
    truth(nextIn(v.dir).step !== 'merge'),
    0,
  );
  writeFileSync(join(v.dir, '.claude/code-kit.json'), vConfig);
  vCli('queue', 'drop', 'web/st-2');
  // story: one story's facts for the drill-down.
  vPut(
    '.claude/state/spec-check/web_st-2.md',
    '# Spec check\n\n| Requirement | Status (done / partial / missing / conflicts) | Where | Note |\n| --- | --- | --- | --- |\n| BOOK-2 Cancel | done | apps/office/lib/cancel.ts | |\n',
  );
  const told = vCli('story', 'st-2', '--json');
  const facts = JSON.parse(told.stdout || '{}');
  expect(
    "VIEW-7 story gives a story's requirements, its spec-check rows, its diff and verify without checks",
    truth(
      facts.id === 'ST-2' &&
        facts.branch === 'web/st-2' &&
        facts.requirements.map((r) => r.id).join() === 'BOOK-2' &&
        facts.specCheck?.rows[0]?.requirement === 'BOOK-2' &&
        facts.specCheck.rows[0].status === 'done' &&
        facts.diff.files.some((f) => f.path === 'apps/office/lib/cancel.ts' && f.added === 1) &&
        facts.diff.text.includes('+export const cancel = 1;') &&
        Object.values(facts.verify.problems).flat().length === 0 &&
        facts.verify.checks === false,
      told.stderr || told.stdout.slice(0, 400),
    ),
    0,
  );
  expect(
    'and leaves no temporary worktree behind',
    truth(v.git('worktree', 'list').trim().split('\n').length === 1),
    0,
  );
  expect(
    'a story the plan has not is refused',
    vCli('story', 'ST-99', '--json'),
    1,
    'There is no story ST-99',
  );
  // timeline: when each story's work happened, for the lanes' bars.
  const timed = JSON.parse(vCli('timeline', '--json').stdout || '{}');
  const st2 = timed.stories?.find((s) => s.id === 'ST-2');
  expect(
    "VIEW-2 timeline gives a story branch's start, last commit and send-backs",
    truth(
      st2 &&
        st2.branch === 'web/st-2' &&
        st2.started > 0 &&
        st2.lastCommit >= st2.started &&
        st2.merged === null &&
        st2.sentBack.length === 1 &&
        timed.now >= st2.lastCommit,
      JSON.stringify(st2),
    ),
    0,
  );
  // A story with commits whose dependency isn't done is blocked on it, not finished.
  const planNow = readFileSync(join(v.dir, 'docs/spec/plan.md'), 'utf8');
  vPut(
    'docs/spec/plan.md',
    planNow.replace(/(### ST-1 [\s\S]*?\*\*Status:\*\* )[a-z ]+/, '$1in progress'),
  );
  const blockedNow = JSON.parse(vCli('status', '--json').stdout).stories.find(
    (s) => s.id === 'ST-2',
  );
  expect(
    'a story whose dependency is not done is blocked on it, even with commits on its branch',
    truth(
      blockedNow.state === 'blocked' && blockedNow.waitingOn.join() === 'ST-1',
      JSON.stringify(blockedNow),
    ),
    0,
  );
  expect(
    'and next does not propose reviewing it',
    truth(!nextIn(v.dir).args.split(' ').includes('ST-2'), JSON.stringify(nextIn(v.dir))),
    0,
  );
  vPut('docs/spec/plan.md', planNow);
  const donePlan = plan('done')
    .replace('**Depends on:** ST-1\n**Status:** todo', '**Depends on:** ST-1\n**Status:** done')
    .replace('### ST-3 Stray\n\n**Lane:** nope\n**Requirements:** BOOK-9\n', '');
  vPut('docs/spec/plan.md', donePlan);
  vPut('docs/spec/01-booking.md', '# 01. Booking\n\n### BOOK-1 Request\n\n### BOOK-2 Cancel\n');
  vCommit('all done');
  nextIs('when every story is done, next says so', v.dir, 'done');
  vPut(
    'docs/spec/plan.md',
    `${donePlan}\n### ST-4 Contracts\n\n**Lane:** lead\n**Requirements:** none\n**Status:** todo\n`,
  );
  vCommit('a story for the lead');
  nextIs("the lead's own story goes to the lead, not to dispatch", v.dir, 'lead', 'ST-4');
  const withLead = JSON.parse(vCli('status', '--json').stdout);
  expect(
    'a lead story that delivers no requirement is not a gap in the plan',
    truth(!withLead.problems.some((p) => p.includes('ST-4')), withLead.problems.join(' / ')),
    0,
  );
  vPut('docs/spec/plan.md', donePlan);
  vCommit('lead story removed');

  // --- trace: what a file is for, in the project's terms ------------------------------------------
  const traced = JSON.parse(vCli('trace', 'apps/office/e2e/booking.spec.ts', '--json').stdout);
  expect(
    'trace finds the requirement a file delivers through the story its commit names',
    truth(
      traced.requirements.length === 1 &&
        traced.requirements[0].id === 'BOOK-1' &&
        traced.requirements[0].spec === 'docs/spec/01-booking.md' &&
        traced.requirements[0].stories[0] === 'ST-1',
      JSON.stringify(traced),
    ),
    0,
  );
  expect(
    'with its lane and owner (the first lane whose paths match)',
    truth(
      traced.lane?.name === 'web' && traced.owner === 'web lane / web-engineer',
      JSON.stringify(traced),
    ),
    0,
  );
  const layered = JSON.parse(vCli('trace', 'packages/domain/src/x.ts', '--json').stdout);
  expect(
    'and its layer, with what that layer may import',
    truth(
      layered.layer?.name === 'domain' &&
        layered.layer.mayImport.join() === 'schemas' &&
        layered.layer.denyPackages.includes('node:*'),
      JSON.stringify(layered),
    ),
    0,
  );
} finally {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true });
}
process.stdout.write(failed ? `\n${failed} hook test(s) failed\n` : '\nAll hook tests passed\n');
process.exit(failed ? 1 : 0);
