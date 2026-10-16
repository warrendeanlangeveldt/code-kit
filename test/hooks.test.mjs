#!/usr/bin/env node
// The hooks end to end, run against throwaway git repositories in the OS temp folder with
// test/fixture.json as their config. Exit 0 = allowed, 2 = blocked.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
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
  expect(
    "an env file's template is written like any other file",
    write('apps/office/.env.local.example', 'web-engineer'),
    0,
  );
  expect('files outside the project are blocked', write(join('..', 'elsewhere.txt')), 2);
  expect("the lead writes the config's outside paths", write(join('..', 'code-kit', 'x.mjs')), 0);
  expect('a lane may not', write(join('..', 'code-kit', 'x.mjs'), 'web-engineer'), 2);
  const memoryFile = join(homedir(), '.claude', 'projects', 'p', 'memory', 'x.md');
  expect("the lead writes Claude's memory", writeAt(memoryFile), 0);
  expect('a lane may not', writeAt(memoryFile, 'web-engineer'), 2);
  expect(
    "a lane writes scratch files in Claude Code's own temporary folder",
    writeAt(
      '/private/tmp/claude-501/-Users-x-project/session-1/scratchpad/probe.py',
      'web-engineer',
    ),
    0,
  );
  expect('but nowhere else in /tmp', writeAt('/private/tmp/elsewhere/probe.py', 'web-engineer'), 2);
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
    'reading the log through the shell is refused too, and the refusal says to use the Read tool',
    bash('cat .claude/approval-log.jsonl | head'),
    2,
    'with the Read tool',
  );
  expect(
    "a lane may read the log's history with git, as a review does",
    bash('git diff main...HEAD -- .claude/approval-log.jsonl | head -40', 'web-engineer'),
    0,
  );
  expect(
    'but not write what git prints anywhere',
    bash('git show HEAD:.claude/approval-log.jsonl > /tmp/log.jsonl', 'web-engineer'),
    2,
  );
  expect(
    'nor through tee',
    bash(
      'git log -p -- .claude/approval-log.jsonl | tee .claude/approval-log.jsonl',
      'web-engineer',
    ),
    2,
  );
  expect(
    'the lead edits the kit through the shell',
    bash("sed -i '' s/a/b/ .claude/code-kit.json"),
    0,
  );
  expect('a lane may not', bash("sed -i '' s/a/b/ .claude/code-kit.json", 'web-engineer'), 2);
  expect(
    'a lane may read the kit in a line that writes elsewhere',
    bash(
      '(npm ci >/tmp/ci.log 2>&1; tail -3 /tmp/ci.log); ls .claude/skills 2>/dev/null',
      'web-engineer',
    ),
    0,
  );
  expect(
    'but not write it through a pipe',
    bash('echo x | tee .claude/agents/web.md', 'web-engineer'),
    2,
  );
  expect(
    'a lane may read the config with an inline script, without asking anyone',
    bash(
      `python3 -c "\nimport json;c=json.load(open('.claude/code-kit.json'))\nfor k,v in c['lanes'].items():\n  if len(v)>0: print(k, json.dumps(v)[:300].replace('\\n',' '))"`,
      'web-engineer',
    ),
    0,
  );
  expect(
    'or with node',
    bash(
      `node -e "const c=JSON.parse(require('fs').readFileSync('.claude/code-kit.json','utf8'));console.log(Object.keys(c))"`,
      'web-engineer',
    ),
    0,
  );
  expect(
    'and no approval request is filed for it',
    truth(
      !existsSync(join(repo, '.claude/state/requests.jsonl')) ||
        !readFileSync(join(repo, '.claude/state/requests.jsonl'), 'utf8').includes('json.load'),
    ),
    0,
  );
  expect(
    'an inline script that writes the kit is still refused',
    bash(
      `python3 -c "import json;c=json.load(open('.claude/code-kit.json'));c['x']=1;json.dump(c,open('.claude/code-kit.json','w'))"`,
      'web-engineer',
    ),
    2,
  );
  expect(
    'and so is one that writes it with node',
    bash(`node -e "require('fs').writeFileSync('.claude/code-kit.json','{}')"`, 'web-engineer'),
    2,
  );
  expect(
    "and so is a script's output redirected into it",
    bash(`python3 -c "print('{}')" > .claude/code-kit.json`, 'web-engineer'),
    2,
  );
  expect(
    "and a Python script run from a file, which the hook can't read",
    bash('python3 tools/fix.py .claude/code-kit.json', 'web-engineer'),
    2,
  );
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
  expect(
    'text that mentions an install, quoted in an echo, adds no dependency',
    bash(
      'echo "- gotchas — stage/commit separately; write package.json before npm install" >> NOTES.md',
    ),
    0,
  );
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
    expect(
      "--via takes pane or a tool's name, nothing else",
      kit('approve', 'dep-x', '--reason', 'y', '--via', 'Chat Pane!'),
      1,
    );
    expect(
      "--via <tool> marks the approval as given in that tool's pane",
      truth(
        kit('approve', 'kit', '--reason', 'the reviewer model', '--via', 'context-graph').status ===
          0 &&
          readFileSync(join(repo, '.claude/approvals/kit'), 'utf8').includes(
            'the reviewer model (approved in the context-graph pane)',
          ),
      ),
      0,
    );
    put('.claude/code-kit.json', relayFixture);
    expect(
      'ACT-2 no agent approves as the person, even with chat approvals on',
      bash(`node "${kitCli}" approve dep-zod --reason "yes" --via pane`),
      2,
      "the person's own act",
    );
    put('.claude/code-kit.json', fixture);

    // CARD-5: a read-only agent (a reviewer) is never asked about: what it changed goes back.
    rmSync(requestsFile, { force: true });
    const byReviewer = write('design/approved-screens.json', 'code-kit:reviewer');
    expect(
      'CARD-5 a reviewer writing a protected file is refused, told to put it back, and asks no one',
      truth(
        byReviewer.status === 2 &&
          byReviewer.stderr.includes('code-kit:reviewer is read-only') &&
          byReviewer.stderr.includes('git restore -- design/approved-screens.json') &&
          reqs().open.length === 0,
        byReviewer.stderr + JSON.stringify(reqs().open),
      ),
      0,
    );
    // CARD-5: a request is answered by an approval given after it, even once that approval is gone.
    write('design/approved-screens.json', 'web-engineer');
    kit('approve', 'design', '--lane', 'web', '--reason', 'the booking screens are approved');
    rmSync(join(repo, '.claude/approvals/web/design'), { force: true });
    expect(
      'CARD-5 an approval given after a request answers it, even after it expired or was used up',
      truth(!reqs().open.some((r) => r.names.join() === 'design'), JSON.stringify(reqs().open)),
      0,
    );
    // CARD-5: a request whose file someone else has since committed is no longer waiting.
    rmSync(requestsFile, { force: true });
    rmSync(join(repo, '.claude/state/approvals-given.jsonl'), { force: true });
    write('design/approved-screens.json', 'web-engineer');
    expect(
      'the request is open until then',
      truth(reqs().open.some((r) => r.names.join() === 'design')),
      0,
    );
    put('design/approved-screens.json', '{ "screens": [] }\n');
    git('add', 'design/approved-screens.json');
    git('commit', '-q', '--no-verify', '-m', 'The lead registers the screens');
    expect(
      'CARD-5 a request whose file was committed since, by someone who could, is no longer waiting',
      truth(!reqs().open.some((r) => r.names.join() === 'design'), JSON.stringify(reqs().open)),
      0,
    );
    // CARD-6: every approval given, newest first, with who gave it.
    kit('approve', 'design', '--lane', 'web', '--reason', 'screens again', '--via', 'pane');
    const history = reqs().history;
    expect(
      'CARD-6 requests lists every approval given, newest first, with who gave it',
      truth(
        history[0]?.name === 'design' &&
          history[0].lane === 'web' &&
          history[0].by === 'you, in the pane' &&
          history.some((h) => h.name === 'dep-lodash' && h.by === 'you, in the pane') &&
          kit('requests').stdout.includes('Approvals given (newest first):'),
        JSON.stringify(history.slice(0, 3)),
      ),
      0,
    );
    // CARD-7: a request waits until it's answered or dropped, not 60 minutes.
    rmSync(requestsFile, { force: true });
    rmSync(join(repo, '.claude/state/approvals-given.jsonl'), { force: true });
    rmSync(join(repo, '.claude/approvals'), { recursive: true, force: true });
    bash(addLodash, 'web-engineer');
    const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString();
    writeFileSync(
      requestsFile,
      readFileSync(requestsFile, 'utf8').replace(/"at":"[^"]+"/, `"at":"${twoHoursAgo}"`),
    );
    expect(
      'CARD-7 a request nobody answered still waits two hours on',
      truth(
        reqs().open.some((r) => r.names.join() === 'dep-lodash'),
        JSON.stringify(reqs().open),
      ),
      0,
    );
    expect(
      "CARD-7 a lane can't drop a request",
      bash(`node "${kitCli}" requests drop 1`, 'web-engineer'),
      2,
      'only the lead',
    );
    expect(
      "CARD-7 nor can the lead dismiss one in the person's name",
      bash(`node "${kitCli}" requests drop 1 --via pane`),
      2,
      "the person's",
    );
    expect(
      'CARD-7 the lead drops one nobody needs',
      bash(`node "${kitCli}" requests drop 1 --reason "went with dayjs"`),
      0,
    );
    const dropped = kit('requests', 'drop', '1', '--reason', 'went with dayjs');
    expect(
      'and it stops waiting',
      truth(
        dropped.status === 0 && dropped.stdout.includes('Dropped 1 request') && !reqs().open.length,
        dropped.stdout + dropped.stderr,
      ),
      0,
    );
    bash(addLodash, 'web-engineer');
    expect(
      'CARD-7 refused again later, it asks again',
      truth(reqs().open.length === 1, JSON.stringify(reqs().open)),
      0,
    );
    // CARD-7: a dependency request closes once the package is in a committed manifest.
    rmSync(requestsFile, { force: true });
    bash(addLodash, 'web-engineer');
    put('apps/office/package.json', '{ "dependencies": { "lodash": "^4.17.21" } }\n');
    git('add', 'apps/office/package.json');
    git('commit', '-q', '--no-verify', '-m', 'web: lodash, installed by the person');
    expect(
      'CARD-7 a package request closes once the package is committed, whoever installed it',
      truth(!reqs().open.some((r) => r.names.join() === 'dep-lodash'), JSON.stringify(reqs().open)),
      0,
    );
    rmSync(requestsFile, { force: true });
    rmSync(join(repo, '.claude/state/approvals-given.jsonl'), { force: true });
    rmSync(join(repo, '.claude/approvals'), { recursive: true, force: true });
  }

  // --- questions for the person (ASK-1 to ASK-4) --------------------------------------------------
  {
    const q = newRepo();
    cleanups.push(q.dir);
    const qKit = (...args) =>
      spawnSync('node', [kitCli, ...args], { cwd: q.dir, encoding: 'utf8' });
    const qBash = (command, agent) =>
      spawnSync('node', [join(hooks, 'guard-bash.mjs')], {
        input: JSON.stringify({
          cwd: q.dir,
          tool_input: { command },
          ...(agent ? { agent_type: agent } : {}),
        }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: q.dir },
        encoding: 'utf8',
      });
    mkdirSync(join(q.dir, 'docs/spec'), { recursive: true });
    writeFileSync(
      join(q.dir, 'docs/spec/01-weather.md'),
      '# 01. Weather\n\n### WX-1 Forecast\n\nx\n',
    );
    writeFileSync(
      join(q.dir, 'docs/spec/plan.md'),
      '# Plan\n\n## M1\n\n### ST-1 Forecast\n\n**Lane:** web\n**Requirements:** WX-1\n**Status:** todo\n\n### ST-2 Alerts\n\n**Lane:** web\n**Requirements:** WX-1\n**Depends on:** ST-1\n**Status:** todo\n',
    );
    writeFileSync(
      join(q.dir, 'docs/brief.md'),
      '# Brief\n\n**Status:** ready\n\n## Open questions\n\n| Question | Owner |\n| --- | --- |\n| Accounts: AWS and hosting | you |\n| The product domain | you |\n| Which index for search | Lead |\n',
    );
    q.git('add', '-A');
    q.git('commit', '-q', '-m', 'plan');
    expect(
      "ASK-1 a lane can't ask the person: it goes through the lead",
      qBash(`node "${kitCli}" ask "Which provider?"`, 'web-engineer'),
      2,
      'only the lead asks',
    );
    expect('ASK-1 the lead may', qBash(`node "${kitCli}" ask "Which provider?"`), 0);
    const asked = qKit(
      'ask',
      'Which weather provider?',
      '--story',
      'ST-1',
      '--blocks',
      '--option',
      'Bureau of Meteorology: free, Australian data',
      '--option',
      'Commercial',
    );
    expect(
      'ASK-1 the lead asks, with options; it waits for the person',
      truth(
        asked.status === 0 &&
          asked.stdout.startsWith('Asked Q-1.') &&
          asked.stdout.includes('ST-1 waits on it'),
        asked.stdout + asked.stderr,
      ),
      0,
    );
    const listed = JSON.parse(qKit('ask', '--json').stdout);
    expect(
      'with what each option does',
      truth(
        listed[0].options[0].label === 'Bureau of Meteorology' &&
          listed[0].options[0].effect === 'free, Australian data' &&
          listed[0].state === 'open',
        JSON.stringify(listed),
      ),
      0,
    );
    expect(
      'ASK-1 the same question again is asked once',
      truth(
        qKit('ask', 'Which weather provider?', '--story', 'ST-1').stdout.startsWith(
          'Q-1 is already open',
        ),
      ),
      0,
    );
    const waiting = JSON.parse(qKit('status', '--json').stdout).stories;
    expect(
      'ASK-3 its story waits on the person, and what depends on it is blocked',
      truth(
        waiting[0].state === 'waiting on you' &&
          waiting[0].waitingFor.id === 'Q-1' &&
          waiting[1].state === 'blocked',
        JSON.stringify(waiting.map((s) => [s.id, s.state])),
      ),
      0,
    );
    const nextWait = JSON.parse(qKit('next', '--json').stdout);
    expect(
      'ASK-3 next dispatches nothing, and says it waits on the person',
      truth(
        nextWait.step === 'wait' &&
          nextWait.why.startsWith('ST-1 waits on the person (Q-1)') &&
          nextWait.attention.some((a) =>
            a.startsWith('ST-1 waits on the person: Which weather provider?'),
          ),
        JSON.stringify(nextWait),
      ),
      0,
    );
    expect(
      "ASK-4 next lists the brief's open questions for the person's Decisions tab, with who decides, leaving out the lead's own",
      truth(
        nextWait.brief.map((b) => b.question).join('|') ===
          'Accounts: AWS and hosting|The product domain' &&
          nextWait.brief[0].path === 'docs/brief.md' &&
          nextWait.brief[0].owner === 'you',
        JSON.stringify(nextWait.brief),
      ),
      0,
    );
    expect(
      "ASK-2 no agent answers in the person's name",
      qBash(`node "${kitCli}" ask answer Q-1 "Commercial" --via pane`),
      2,
      'their own act',
    );
    const answered = qKit('ask', 'answer', 'Q-1', 'Bureau', 'of', 'Meteorology');
    expect(
      'ASK-2 the lead records what the person said in chat, marked as such',
      truth(
        answered.status === 0 &&
          answered.stdout.includes('(given in chat, recorded by the lead)') &&
          JSON.parse(qKit('ask', '--json').stdout)[0].answer.via === 'chat',
        answered.stdout,
      ),
      0,
    );
    expect(
      'ASK-3 answered, its story is ready again',
      truth(JSON.parse(qKit('status', '--json').stdout).stories[0].state === 'ready'),
      0,
    );
    expect(
      "ASK-2 an answered question can't be answered again",
      qKit('ask', 'answer', 'Q-1', 'Commercial'),
      1,
      'answered already',
    );
    qKit('ask', 'May sessions show your city?');
    expect('ASK-1 withdrawing says why', qKit('ask', 'withdraw', 'Q-2'), 1, '--reason');
    expect(
      'ASK-1 the lead withdraws one settled another way',
      truth(
        qKit('ask', 'withdraw', 'Q-2', '--reason', 'the brief says suburbs only').status === 0 &&
          !JSON.parse(qKit('ask', '--json').stdout).some((x) => x.state === 'open'),
      ),
      0,
    );
  }

  // --- bug reports for code-kit (REPORT-1 to REPORT-3) --------------------------------------------
  {
    const r = newRepo();
    cleanups.push(r.dir);
    const fakeBin = mkdtempSync(join(tmpdir(), 'code-kit-gh-'));
    cleanups.push(fakeBin);
    const ghLog = join(fakeBin, 'calls.log');
    // A stand-in for gh: signed in, an issue already filed once `filed` exists.
    writeFileSync(
      join(fakeBin, 'gh'),
      `#!/bin/sh\necho "$@" >> "${ghLog}"\ncase "$1 $2" in\n  "auth status") exit 0 ;;\n  "issue list") if [ -f "${fakeBin}/filed" ]; then echo '[{"number":9,"url":"https://github.com/o/code-kit/issues/9"}]'; else echo '[]'; fi ;;\n  "issue create") touch "${fakeBin}/filed"; echo "https://github.com/o/code-kit/issues/9" ;;\n  "issue comment") echo ok ;;\nesac\n`,
    );
    chmodSync(join(fakeBin, 'gh'), 0o755);
    const rKit = (args, path = `${fakeBin}:${process.env.PATH}`) =>
      spawnSync(process.execPath, [kitCli, ...args], {
        cwd: r.dir,
        encoding: 'utf8',
        env: { ...process.env, PATH: path },
      });
    expect(
      'REPORT-1 with reporting off, an agent is told to tell the person instead',
      rKit(['report', 'Refused a lane its own file', '--what', 'x']),
      1,
      'is off',
    );
    writeFileSync(
      join(r.dir, '.claude/code-kit.json'),
      JSON.stringify({ ...JSON.parse(fixture), harness: { report: { on: true } } }),
    );
    const drafted = rKit([
      'report',
      'Refused a lane its own file',
      '--what',
      `guard-paths refused ${r.dir}/apps/office/a.ts for the web lane; mail sam@example.com`,
      '--rule',
      'lanes',
    ]);
    const draft = JSON.parse(rKit(['report', '--json']).stdout)[0];
    expect(
      "REPORT-2 the draft keeps code-kit's facts and leaves out the project's paths and email addresses",
      truth(
        drafted.status === 0 &&
          draft.state === 'draft' &&
          draft.body.includes('<project>/apps/office/a.ts') &&
          !draft.body.includes(r.dir) &&
          draft.body.includes('<email>') &&
          !draft.body.includes('sam@example.com') &&
          draft.body.includes('**code-kit:** ') &&
          draft.body.includes(draft.fingerprint),
        draft?.body,
      ),
      0,
    );
    expect(
      "REPORT-3 no agent sends a report: it goes under the person's account",
      spawnSync('node', [join(hooks, 'guard-bash.mjs')], {
        input: JSON.stringify({
          cwd: r.dir,
          tool_input: { command: `node "${kitCli}" report send R-1` },
        }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: r.dir },
        encoding: 'utf8',
      }),
      2,
      "the person's own act",
    );
    const noGh = rKit(['report', 'send', 'R-1'], '/usr/bin:/bin');
    expect(
      'REPORT-3 without gh nothing is sent, and the person gets the link to file it',
      truth(
        noGh.status === 1 &&
          noGh.stderr.includes('/issues/new?title=Refused%20a%20lane') &&
          JSON.parse(rKit(['report', '--json']).stdout)[0].state === 'draft',
        noGh.stderr,
      ),
      0,
    );
    const sent = rKit(['report', 'send', 'R-1']);
    expect(
      "REPORT-3 sent, it files an issue on code-kit's repository",
      truth(
        sent.status === 0 &&
          sent.stdout.includes('Filed https://github.com/o/code-kit/issues/9') &&
          readFileSync(ghLog, 'utf8').includes(
            'issue create --repo warrendeanlangeveldt/code-kit --title Refused a lane its own file',
          ),
        sent.stdout + sent.stderr,
      ),
      0,
    );
    rKit(['report', 'Refused a lane its own file', '--what', 'again', '--rule', 'lanes']);
    const again = rKit(['report', 'send', 'R-2']);
    expect(
      'REPORT-3 the same bug filed already gets a comment, not a second issue',
      truth(
        again.status === 0 &&
          again.stdout.startsWith('Someone had filed it already') &&
          readFileSync(ghLog, 'utf8').includes('issue comment 9'),
        again.stdout + again.stderr,
      ),
      0,
    );
    rKit(['report', 'Another', '--what', 'x']);
    expect(
      'REPORT-3 the person discards one',
      truth(
        rKit(['report', 'discard', 'R-3']).status === 0 &&
          !JSON.parse(rKit(['report', '--json']).stdout).some((x) => x.state === 'draft'),
      ),
      0,
    );
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
    // HELM-3: the lead approves a package for a story in the plan.
    put(
      'docs/spec/plan.md',
      '# Plan\n\n## M1\n\n### ST-4 Bookings table\n\n**Lane:** web\n**Requirements:** BOOK-1\n**Status:** in progress\n\n### ST-138 Image libraries\n\n**Lane:** backend\n**Requirements:** MED-5\n**Status:** in progress\n',
    );
    expect(
      "with it set, a lane's refusal names the lead's delegated command",
      bash(addLodash, 'web-engineer'),
      2,
      'approve dep-lodash --lane web --delegated',
    );
    expect(
      "HELM-2 the lane is told it's the lead's decision, with no command for the person",
      truth(
        (() => {
          const r = bash(addLodash, 'web-engineer');
          return (
            r.status === 2 &&
            r.stderr.includes("is the lead's decision") &&
            r.stderr.includes('Hand the lead a change request') &&
            !r.stderr.includes('! echo') &&
            !/ask the person|a person runs/i.test(r.stderr)
          );
        })(),
      ),
      0,
    );
    expect(
      "and the request is the lead's to decide",
      truth(
        JSON.parse(
          spawnSync('node', [kitCli, 'requests', '--json'], { cwd: repo, encoding: 'utf8' }).stdout,
        ).open.some((r) => r.names.includes('dep-lodash') && r.by === 'lead' && r.n >= 1),
      ),
      0,
    );
    expect(
      'HELM-4 next hands it to the lead to decide',
      truth(
        JSON.parse(
          spawnSync('node', [kitCli, 'next', '--json'], { cwd: repo, encoding: 'utf8' }).stdout,
        ).step === 'decide',
      ),
      0,
    );
    expect(
      'HELM-3 a package approved without a story is refused',
      delegate('good-pkg', '--lane', 'web', '--reason', 'x'),
      1,
      'Name the story the package is for',
    );
    expect(
      'and one for a story the plan does not have',
      delegate('good-pkg', '--lane', 'web', '--story', 'ST-999', '--reason', 'x'),
      1,
      'has no story ST-999',
    );
    expect(
      'a Python package the backend lane asked for',
      bash('cd workers && uv add "pillow>=12.3.0"', 'backend-engineer'),
      2,
      "is the lead's decision",
    );
    expect(
      "is judged by the lead, without the npm registry (which hasn't heard of it)",
      truth(
        delegate(
          'pillow',
          '--lane',
          'backend',
          '--story',
          'ST-138',
          '--reason',
          'MED-5 needs HEIC decoding',
        ).status === 0 &&
          readFileSync(join(repo, '.claude/approvals/backend/dep-pillow'), 'utf8').includes(
            'dependencies (pillow, from uv, judged by the lead) for ST-138',
          ),
      ),
      0,
    );
    expect('a lane never approves', bash(delegateGood, 'web-engineer'), 2, 'only the lead');
    expect('the lead may run it', bash(delegateGood), 0);
    expect(
      'AUT-2 a package within the rules is approved, marked with its rule',
      truth(
        delegate('good-pkg', '--lane', 'web', '--reason', 'tables for ST-4', '--story', 'ST-4')
          .status === 0 &&
          readFileSync(join(repo, '.claude/approvals/web/dep-good-pkg'), 'utf8').includes(
            'tables for ST-4 (approved by the lead within the delegated rules: dependencies (good-pkg) for ST-4)',
          ),
      ),
      0,
    );
    expect(
      'and it allows the install',
      bash('pnpm --filter office add good-pkg', 'web-engineer'),
      0,
    );
    expect(
      'a scoped package too',
      delegate('@scope/fine', '--lane', 'web', '--reason', 'x', '--story', 'ST-4'),
      0,
    );
    expect(
      'AUT-4 a copyleft licence goes to the person',
      delegate('gpl-pkg', '--lane', 'web', '--reason', 'x', '--story', 'ST-4'),
      1,
      'licence (GPL-3.0)',
    );
    expect(
      'so does an old package',
      delegate('old-pkg', '--reason', 'x', '--story', 'ST-4'),
      1,
      'last release',
    );
    expect(
      'a little-used one',
      delegate('tiny-pkg', '--reason', 'x', '--story', 'ST-4'),
      1,
      'downloads',
    );
    expect(
      'one whose install runs scripts',
      delegate('scripted-pkg', '--reason', 'x', '--story', 'ST-4'),
      1,
      'runs a script that runs its own code',
    );
    expect(
      'and one the registry has never heard of',
      delegate('nowhere-pkg', '--reason', 'x', '--story', 'ST-4'),
      1,
      "isn't on the npm registry",
    );
    expect(
      'it is all or nothing',
      truth(
        delegate('good-pkg', 'gpl-pkg', '--lane', 'qa', '--reason', 'x', '--story', 'ST-4')
          .status === 1 && !approved('qa/dep-good-pkg'),
      ),
      0,
    );
    expect(
      'HELM-2 a lane writing a protected file the lead decides is told so, with no command for the person',
      truth(
        (() => {
          const r = write('design/approved-screens.json', 'web-engineer');
          return (
            r.status === 2 &&
            r.stderr.includes("needs the lead's approval") &&
            r.stderr.includes('The lead decides this') &&
            !r.stderr.includes('! echo')
          );
        })(),
      ),
      0,
    );
    put('.claude/code-kit.json', fixture);
    expect(
      'one the person keeps is brought to them by the lead',
      truth(
        (() => {
          const r = write('design/approved-screens.json', 'web-engineer');
          return (
            r.status === 2 &&
            r.stderr.includes("needs a person's approval") &&
            r.stderr.includes('the lead brings it to them')
          );
        })(),
      ),
      0,
    );
    put('.claude/code-kit.json', delegateFixture);
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
    rmSync(join(repo, 'docs/spec/plan.md'), { force: true });
    rmSync(join(repo, '.claude/approvals/backend/dep-pillow'), { force: true });
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

  // --- SETUP-1: the approved setup is committed straight onto main, while main has no rules yet ------
  {
    const u = newRepo(false);
    cleanups.push(u.dir);
    mkdirSync(join(u.dir, '.claude'), { recursive: true });
    writeFileSync(join(u.dir, '.claude/code-kit.json'), fixture);
    writeFileSync(join(u.dir, '.gitignore'), '.claude/approvals/\n.claude/state/\n');
    const uHook = (command, agent) =>
      spawnSync('node', [join(hooks, 'guard-bash.mjs')], {
        input: JSON.stringify({
          cwd: u.dir,
          tool_input: { command },
          ...(agent ? { agent_type: agent } : {}),
        }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: u.dir },
        encoding: 'utf8',
      });
    expect(
      'SETUP-1 the lead commits the approved setup on main while main has no rules',
      uHook('git add -A && git commit -m "Switch on code-kit"'),
      0,
    );
    expect('but a lane may not', uHook('git commit -m x', 'web-engineer'), 2);
    expect(
      'nor may anyone merge onto main that way',
      uHook('git merge web/st-1'),
      2,
      'never commit or merge on main',
    );
    u.git('add', '-A');
    u.git('commit', '-q', '-m', 'Switch on code-kit');
    expect(
      'once main has the rules, a commit on it is refused as before',
      uHook('git commit -m "more"'),
      2,
      'the lead merges it after review',
    );
  }

  // --- SETUP-2: the base has no code-kit rules committed yet (set up before 0.8.0): the lead puts them there
  {
    const f = newRepo(false);
    cleanups.push(f.dir);
    const fKit = (...args) =>
      spawnSync('node', [kitCli, ...args], { cwd: f.dir, encoding: 'utf8' });
    f.git('checkout', '-q', '-b', 'lead/st-1');
    mkdirSync(join(f.dir, '.claude'), { recursive: true });
    writeFileSync(
      join(f.dir, '.claude/code-kit.json'),
      JSON.stringify({ ...JSON.parse(fixture), approvals: { delegate: { merge: true } } }),
    );
    writeFileSync(join(f.dir, '.gitignore'), '.claude/approvals/\n.claude/state/\n');
    mkdirSync(join(f.dir, 'docs/spec'), { recursive: true });
    writeFileSync(
      join(f.dir, 'docs/spec/01-booking.md'),
      '# 01. Booking\n\n### BOOK-1 Request\n\nx\n',
    );
    writeFileSync(
      join(f.dir, 'docs/spec/plan.md'),
      '# Plan\n\n## M1\n\n### ST-1 Booking form\n\n**Lane:** web\n**Requirements:** BOOK-1\n**Status:** todo\n\n### ST-2 Booking list\n\n**Lane:** web\n**Requirements:** BOOK-1\n**Depends on:** ST-1\n**Status:** todo\n',
    );
    // Committed through the commit hook, which logs the kit's files as it does in a session.
    spawnSync('node', [join(hooks, 'guard-bash.mjs')], {
      input: JSON.stringify({
        cwd: f.dir,
        tool_input: { command: 'git add -A && git commit -m "switch on code-kit"' },
      }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: f.dir },
      encoding: 'utf8',
    });
    f.git('add', '-A');
    f.git('commit', '-q', '-m', 'switch on code-kit');
    // The lead carries on from its first branch, where the rules are.
    f.git('checkout', '-q', '-b', 'lead/st-2');
    fKit('queue', 'add', 'lead/st-1');
    const step = JSON.parse(fKit('next', '--json').stdout);
    expect(
      'next gives the lead the rules step, not the person a first merge',
      truth(step.step === 'rules' && step.args === 'main', JSON.stringify(step)),
      0,
    );
    expect(
      'and check reports merges as not yet delegated',
      truth(
        JSON.parse(fKit('check', '--json').stdout).delegatesMerge === false &&
          JSON.parse(fKit('check', '--json').stdout).firstMerge === true,
      ),
      0,
    );
    expect(
      "the lead's merge is refused, saying to put the rules onto main first",
      fKit('queue', 'merge', '--delegated'),
      1,
      'queue rules',
    );
    const rHook = (command, agent) =>
      spawnSync('node', [join(hooks, 'guard-bash.mjs')], {
        input: JSON.stringify({
          cwd: f.dir,
          tool_input: { command },
          ...(agent ? { agent_type: agent } : {}),
        }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: f.dir },
        encoding: 'utf8',
      });
    expect(
      'a lane may not put the rules onto main',
      rHook(`node "${kitCli}" queue rules`, 'web-engineer'),
      2,
      'only the lead',
    );
    expect('the lead may', rHook(`node "${kitCli}" queue rules`), 0);
    writeFileSync(join(f.dir, 'scratch.txt'), 'uncommitted work\n');
    const put = fKit('queue', 'rules');
    expect(
      'queue rules commits the approved rules onto main',
      truth(put.status === 0 && put.stdout.includes('onto main'), put.stdout + put.stderr),
      0,
    );
    expect(
      "without switching branches or touching the lead's work",
      truth(
        f.git('rev-parse', '--abbrev-ref', 'HEAD').trim() === 'lead/st-2' &&
          existsSync(join(f.dir, 'scratch.txt')),
      ),
      0,
    );
    expect(
      'main holds only the rules on top of what it had',
      truth(
        f.git('diff', '--name-only', 'main~1', 'main').trim() === '.claude/code-kit.json',
        f.git('diff', '--name-only', 'main~1', 'main'),
      ),
      0,
    );
    const again = fKit('queue', 'rules');
    expect(
      'run again, it says main already has them',
      truth(again.status === 0 && again.stdout.includes('already has'), again.stdout),
      0,
    );
    expect(
      'next now has the lead merge the queue',
      truth(JSON.parse(fKit('next', '--json').stdout).step === 'merge'),
      0,
    );
    expect(
      'the lead merges within the rules now on main',
      fKit('queue', 'merge', '--delegated'),
      0,
    );
    // LOOP-6: the loop's pause, recorded for other tools.
    const loopNow = () => JSON.parse(fKit('loop', '--json').stdout);
    expect('the loop starts unpaused', truth(loopNow().paused === false), 0);
    fKit('loop', 'pause');
    expect('code-kit loop pause records the pause', truth(loopNow().paused === true), 0);
    fKit('loop', 'resume');
    expect('and resume clears it', truth(loopNow().paused === false), 0);
    const fHook = (command) =>
      spawnSync('node', [join(hooks, 'guard-bash.mjs')], {
        input: JSON.stringify({ cwd: f.dir, tool_input: { command } }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: f.dir },
        encoding: 'utf8',
      });
    expect(
      'no agent pauses or resumes the loop',
      fHook(`node "${kitCli}" loop resume`),
      2,
      "the person's own act",
    );
    // LOOP-10: one session runs the loop; a second one opened in the project doesn't take it.
    expect('a session takes the lead', fKit('loop', 'lead', '--session', 's1'), 0);
    expect(
      'the loop names the session that runs it, beside the pause',
      truth(loopNow().lead?.session === 's1' && loopNow().paused === false),
      0,
    );
    expect('it renews its own lease', fKit('loop', 'lead', '--session', 's1'), 0);
    expect(
      'another session is refused while the lease is live, and told how to take it',
      fKit('loop', 'lead', '--session', 's2'),
      1,
      '--take',
    );
    fKit('loop', 'pause');
    expect('pausing keeps the lead', truth(loopNow().lead?.session === 's1'), 0);
    fKit('loop', 'resume');
    expect(
      'taken over, the other session runs it',
      fKit('loop', 'lead', '--session', 's2', '--take'),
      0,
    );
    const notLead = fKit('loop', 'release', '--session', 's1');
    expect(
      "a session that isn't the lead releases nothing",
      truth(notLead.stdout.includes("wasn't running") && loopNow().lead?.session === 's2'),
      0,
    );
    const released = fKit('loop', 'release', '--session', 's2');
    expect('the lead releases it', truth(released.stdout.includes('no longer')), 0);
    expect('with nobody leading, lead is null', truth(loopNow().lead === null), 0);
    // A lease not renewed within its time has lapsed: the session that wrote it has ended.
    writeFileSync(
      join(f.dir, '.claude/state/loop.json'),
      JSON.stringify({ paused: false, lead: { session: 's1', at: '2020-01-01T00:00:00.000Z' } }),
    );
    expect('a lapsed lease is nobody', truth(loopNow().lead === null), 0);
    expect('and the next session takes it', fKit('loop', 'lead', '--session', 's3'), 0);
    expect('lead needs a session', fKit('loop', 'lead'), 1, '--session');
    expect(
      'no agent takes or releases the lead',
      fHook(`node "${kitCli}" loop lead --session s9 --take`),
      2,
      'Lead from here',
    );
    expect(
      'after it, main delegates merges to the lead by its committed rules',
      truth(
        JSON.parse(fKit('check', '--json').stdout).delegatesMerge === true &&
          JSON.parse(fKit('check', '--json').stdout).firstMerge === false,
      ),
      0,
    );
  }

  // --- TEAM-1: the team in the config, and who the developer at this machine is --------------------
  {
    const t = newRepo(false);
    cleanups.push(t.dir);
    mkdirSync(join(t.dir, '.claude'), { recursive: true });
    const base = JSON.parse(fixture);
    const teamConfig = (team, owners) =>
      JSON.stringify({
        ...base,
        team,
        lanes: { ...base.lanes, web: { ...base.lanes.web, ...(owners ? { owners } : {}) } },
      });
    // A stand-in for the GitHub CLI: it answers `gh api user` with the handle in GH_LOGIN.
    const bin = join(t.dir, 'fake-bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'gh'), '#!/bin/sh\n[ -n "$GH_LOGIN" ] && echo "$GH_LOGIN" || exit 1\n');
    chmodSync(join(bin, 'gh'), 0o755);
    const tKit = (login, ...args) =>
      spawnSync('node', [kitCli, ...args], {
        cwd: t.dir,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_LOGIN: login ?? '' },
      });
    writeFileSync(join(t.dir, '.claude/code-kit.json'), teamConfig({ techLead: 'alex' }, ['sam']));
    const report = JSON.parse(tKit('sam', 'check', '--json').stdout || '{}');
    expect(
      'TEAM-1 check reports the team with its defaults, and who you are',
      truth(
        report.team?.techLead === 'alex' &&
          report.team.staleDays === 3 &&
          report.team.provider === 'github' &&
          report.team.owners.web?.[0] === 'sam' &&
          report.me === 'sam',
        JSON.stringify({ team: report.team, me: report.me }),
      ),
      0,
    );
    expect(
      'who you are is cached, so a hook needs no call to GitHub',
      truth(JSON.parse(tKit(null, 'check', '--json').stdout || '{}').me === 'sam'),
      0,
    );
    const text = tKit('sam', 'check');
    expect(
      'check says it in words',
      truth(
        text.stdout.includes('Team: alex is the tech lead') &&
          text.stdout.includes('Lane web is owned by sam') &&
          text.stdout.includes('You are sam.'),
        text.stdout,
      ),
      0,
    );
    writeFileSync(join(t.dir, '.claude/code-kit.json'), teamConfig(undefined, ['sam']));
    expect(
      'owners without a team are refused',
      tKit('sam', 'check'),
      1,
      'lanes.web.owners needs "team"',
    );
    writeFileSync(
      join(t.dir, '.claude/code-kit.json'),
      teamConfig({ techLead: 'alex', staleDays: 0, provider: { command: '' } }),
    );
    const bad = tKit('sam', 'check');
    expect(
      'a bad stale threshold and provider are refused, each saying what it must be',
      truth(
        bad.status === 1 &&
          bad.stderr.includes('"team.staleDays" must be a whole number') &&
          bad.stderr.includes('"team.provider" must be "github"'),
        bad.stderr,
      ),
      0,
    );
    writeFileSync(join(t.dir, '.claude/code-kit.json'), fixture);
    expect(
      'a project without a team reports none',
      truth(JSON.parse(tKit('sam', 'check', '--json').stdout || '{}').team === null),
      0,
    );
  }

  // --- TEAM-2, TEAM-3, TEAM-8: two developers share claims through the repository --------------------
  {
    const root = mkdtempSync(join(tmpdir(), 'ck-team-'));
    cleanups.push(root);
    const origin = join(root, 'origin.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
    const store = join(root, 'github.json');
    writeFileSync(
      store,
      JSON.stringify({
        categories: [
          { id: 'C1', name: 'Intents' },
          { id: 'C2', name: 'General' },
        ],
        discussions: [
          {
            id: 'D12',
            number: 12,
            title: 'Move report storage to the data lane',
            body: 'Touches: packages/schemas/**, apps/api/reports/**\n\nWhy.',
            author: { login: 'alex' },
            category: { name: 'Intents' },
            closed: false,
            closedAt: null,
            stateReason: null,
            createdAt: '2026-10-10T00:00:00Z',
            url: 'https://github.com/o/r/discussions/12',
            comments: [],
          },
          {
            id: 'D13',
            number: 13,
            title: 'Lunch on Friday?',
            body: 'Not an intent.',
            author: { login: 'kim' },
            category: { name: 'General' },
            closed: false,
            closedAt: null,
            stateReason: null,
            createdAt: '2026-10-10T00:00:00Z',
            url: 'https://github.com/o/r/discussions/13',
            comments: [],
          },
        ],
        pulls: [
          {
            number: 14,
            title: 'Booking list',
            author: { login: 'sam' },
            headRefName: 'web/st-4',
            isDraft: true,
            updatedAt: '2026-10-10T00:00:00Z',
            url: 'https://github.com/o/r/pull/14',
          },
        ],
      }),
    );
    // A stand-in for the GitHub CLI, answering from the store as the person in GH_LOGIN.
    const bin = join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(
      join(bin, 'gh'),
      `#!/usr/bin/env node
const { readFileSync, writeFileSync } = require('node:fs');
const a = process.argv.slice(2), file = process.env.GH_STORE, login = process.env.GH_LOGIN;
const db = JSON.parse(readFileSync(file, 'utf8'));
const opt = (n) => a[a.indexOf(n) + 1];
if (process.env.GH_DOWN) process.exit(1);
if (a[0] === 'api' && a[1] === 'user') { if (!login) process.exit(1); console.log(login); }
else if (a[0] === 'api' && a[1].startsWith('repos/{owner}/{repo}/events')) console.log(JSON.stringify(db.events ?? []));
else if (a[0] === 'api' && a[1] === 'graphql') {
  const vars = {};
  for (let k = 2; k < a.length; k++) if (a[k] === '-f' || a[k] === '-F') { const [n, ...v] = a[k + 1].split('='); vars[n] = v.join('='); k++; }
  const q = vars.query, save = () => writeFileSync(file, JSON.stringify(db)), out = (data) => console.log(JSON.stringify({ data }));
  const byId = (id) => db.discussions.find((d) => d.id === id);
  if (q.includes('createDiscussion')) { const number = 200 + db.discussions.length; const d = { id: 'D' + number, number, title: vars.title, body: vars.body, url: 'https://github.com/o/r/discussions/' + number, createdAt: new Date().toISOString(), closed: false, closedAt: null, stateReason: null, author: { login }, category: { name: db.categories.find((c) => c.id === vars.category).name }, comments: [] }; db.discussions.push(d); save(); out({ createDiscussion: { discussion: { number, url: d.url } } }); }
  else if (q.includes('addDiscussionComment')) { byId(vars.id).comments.push({ author: { login }, body: vars.body }); save(); out({ addDiscussionComment: { comment: { id: 'X' } } }); }
  else if (q.includes('closeDiscussion')) { const d = byId(vars.id); d.closed = true; d.closedAt = new Date().toISOString(); d.stateReason = vars.reason; save(); out({ closeDiscussion: { discussion: { number: d.number } } }); }
  else if (q.includes('discussion(number')) out({ repository: { discussion: db.discussions.find((d) => d.number === Number(vars.number)) ?? null } });
  else if (q.includes('discussions(')) out({ repository: { id: 'R1', hasDiscussionsEnabled: db.discussionsEnabled !== false, discussionCategories: { nodes: db.categories }, discussions: { nodes: db.discussions } } });
  else process.exit(3);
}
else if (a[0] === 'project') {
  const p = (db.project ??= { id: 'PVT_1', fields: [{ id: 'F0', name: 'Title' }], items: [], edits: 0 });
  const save = () => writeFileSync(file, JSON.stringify(db));
  if (a[1] === 'view') console.log(JSON.stringify({ id: p.id, number: Number(a[2]) }));
  else if (a[1] === 'field-list') console.log(JSON.stringify({ fields: p.fields }));
  else if (a[1] === 'field-create') { const f = { id: 'F' + p.fields.length, name: opt('--name') }; p.fields.push(f); save(); console.log(JSON.stringify(f)); }
  else if (a[1] === 'item-create') { const i = { id: 'I' + p.items.length, title: opt('--title'), body: opt('--body'), values: {} }; p.items.push(i); save(); console.log(JSON.stringify({ id: i.id, title: i.title })); }
  else if (a[1] === 'item-list') console.log(JSON.stringify({ items: p.items.map((i) => ({ id: i.id, title: i.title, ...Object.fromEntries(Object.entries(i.values).map(([k, v]) => [k.toLowerCase(), v])) })) }));
  else if (a[1] === 'item-edit') { const i = p.items.find((x) => x.id === opt('--id')); const name = p.fields.find((f) => f.id === opt('--field-id')).name; if (a.includes('--clear')) delete i.values[name]; else i.values[name] = opt('--text'); p.edits += 1; save(); }
  else process.exit(2);
}
else if (a[0] === 'pr' && a[1] === 'list') console.log(JSON.stringify(db.pulls));
else process.exit(2);
`,
    );
    chmodSync(join(bin, 'gh'), 0o755);
    const config = JSON.stringify({ ...JSON.parse(fixture), team: { techLead: 'alex' } });
    const clone = (name) => {
      const dir = join(root, name);
      execFileSync('git', ['clone', '-q', origin, dir], { stdio: 'ignore' });
      mkdirSync(join(dir, '.claude'), { recursive: true });
      writeFileSync(join(dir, '.claude/code-kit.json'), config);
      return dir;
    };
    const a = clone('sam');
    const b = clone('dev2');
    const as =
      (dir, login, extra = {}) =>
      (...args) =>
        spawnSync('node', [kitCli, ...args], {
          cwd: dir,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            GH_LOGIN: login,
            GH_STORE: store,
            ...extra,
          },
        });
    const sam = as(a, 'sam');
    const dev2 = as(b, 'dev2');
    const claimed = sam('team', 'claim', 'ST-9', '--lease', 'packages/core/**');
    expect(
      'TEAM-3 a developer claims a story through the shared repository',
      truth(claimed.status === 0 && claimed.stdout.includes('Claimed ST-9 as sam'), claimed.stderr),
      0,
    );
    const seen = JSON.parse(dev2('team', '--json', '--fresh').stdout || '{}');
    expect(
      "another developer's session sees the claim with its lease",
      truth(
        seen.reachable === true &&
          seen.me === 'dev2' &&
          seen.claims?.some(
            (c) => c.story === 'ST-9' && c.by === 'sam' && c.lease[0] === 'packages/core/**',
          ),
        JSON.stringify(seen.claims),
      ),
      0,
    );
    expect(
      'and its own claim of the story fails, naming who holds it',
      dev2('team', 'claim', 'ST-9'),
      1,
      'ST-9 is claimed by sam',
    );
    expect(
      'the intents and open pull requests come from GitHub, with what each touches',
      truth(
        seen.intents?.[0]?.id === 12 &&
          seen.intents[0].touches.join() === 'packages/schemas/**,apps/api/reports/**' &&
          seen.pulls?.[0]?.branch === 'web/st-4' &&
          seen.pulls[0].draft === true,
        JSON.stringify({ intents: seen.intents, pulls: seen.pulls }),
      ),
      0,
    );
    expect(
      "a developer can't release someone else's claim",
      dev2('team', 'release', 'ST-9'),
      1,
      "ST-9 is sam's claim: only they or the tech lead (alex) can release it.",
    );
    const regrown = sam('team', 'claim', 'ST-9', '--lease', 'packages/core/**,apps/web/**');
    expect(
      'the holder can claim it again, with a grown lease',
      truth(regrown.status === 0, regrown.stderr),
      0,
    );
    // The same clone, now as the tech lead.
    rmSync(join(b, '.claude/state/whoami.json'), { force: true });
    const alex = as(b, 'alex');
    expect(
      'the tech lead can release any claim',
      truth(alex('team', 'release', 'ST-9').stdout.includes("Released ST-9 (sam's claim)")),
      0,
    );
    expect(
      'and after it, the story is free for anyone',
      truth(alex('team', 'claim', 'ST-9').status === 0),
      0,
    );
    const words = sam('team', '--fresh');
    expect(
      'team says it in words',
      truth(
        words.stdout.includes('Tech lead: alex. You are sam.') &&
          words.stdout.includes('ST-9 by alex') &&
          words.stdout.includes('#12 Move report storage to the data lane (alex)') &&
          words.stdout.includes('#14 Booking list (sam, web/st-4, draft)'),
        words.stdout,
      ),
      0,
    );
    // TEAM-1, TEAM-4: the hooks, as each developer's session runs them.
    const c = clone('dev2b');
    const owned = JSON.stringify({
      ...JSON.parse(fixture),
      team: { techLead: 'alex' },
      lanes: {
        ...JSON.parse(fixture).lanes,
        web: { ...JSON.parse(fixture).lanes.web, owners: ['sam'] },
      },
    });
    for (const dir of [a, b, c]) writeFileSync(join(dir, '.claude/code-kit.json'), owned);
    const hookAs = (dir, login) => (name, toolInput, agent) =>
      spawnSync('node', [join(hooks, name)], {
        input: JSON.stringify({
          cwd: dir,
          tool_name: name === 'guard-bash.mjs' ? 'Bash' : 'Write',
          tool_input: toolInput,
          ...(agent ? { agent_type: agent } : {}),
        }),
        encoding: 'utf8',
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: dir,
          PATH: `${bin}:${process.env.PATH}`,
          GH_LOGIN: login,
          GH_STORE: store,
        },
      });
    const dev2Hook = hookAs(c, 'dev2');
    const samHook = hookAs(a, 'sam');
    const alexHook = hookAs(b, 'alex');
    const write = (dir, rel) => ({ file_path: join(dir, rel), content: 'x\n' });
    expect(
      "TEAM-1 another developer's lead may not edit the tech lead's paths, and is told to raise an intent",
      dev2Hook('guard-paths.mjs', write(c, 'docs/notes.md')),
      2,
      "docs/notes.md is the tech lead's (alex)",
    );
    expect('the tech lead may', alexHook('guard-paths.mjs', write(b, 'docs/notes.md')), 0);
    expect(
      "making a story's branch in a lane someone else owns is refused, naming them",
      dev2Hook('guard-bash.mjs', { command: 'git switch -c web/st-4' }),
      2,
      "the web lane is sam's",
    );
    expect(
      "making a story's branch someone else claimed is refused, naming them",
      dev2Hook('guard-bash.mjs', { command: 'git switch -c core/st-9' }),
      2,
      'ST-9 is already claimed by alex',
    );
    expect(
      "the lane's owner makes the branch, which claims the story",
      truth(
        samHook('guard-bash.mjs', { command: 'git switch -c web/st-4' }).status === 0 &&
          JSON.parse(sam('team', '--json', '--fresh').stdout || '{}').claims?.some(
            (x) => x.story === 'ST-4' && x.by === 'sam',
          ),
      ),
      0,
    );
    execFileSync('git', ['-C', a, 'switch', '-q', '-c', 'web/st-4']);
    mkdirSync(join(a, 'apps/office'), { recursive: true });
    writeFileSync(join(a, 'apps/office/report.ts'), 'export const r = 1;\n');
    execFileSync('git', ['-C', a, 'add', 'apps/office/report.ts']);
    const committed = samHook('guard-bash.mjs', { command: 'git commit -m report' });
    expect('the commit itself is allowed', committed, 0);
    const grown = JSON.parse(sam('team', '--json', '--fresh').stdout || '{}').claims?.find(
      (x) => x.story === 'ST-4',
    );
    expect(
      "TEAM-4 a commit on the story's branch grows its lease with what the branch changes",
      truth(grown?.lease.includes('apps/office/report.ts'), JSON.stringify(grown)),
      0,
    );
    expect(
      "another person's agent editing a leased file is refused, naming who leases it and for which story",
      truth(
        (() => {
          sam('team', 'claim', 'ST-4', '--lease', 'docs/reports/**');
          rmSync(join(b, '.claude/state/team.json'), { force: true });
          const r = alexHook('guard-paths.mjs', write(b, 'docs/reports/format.md'));
          return (
            r.status === 2 && r.stderr.includes('docs/reports/format.md is leased by sam for ST-4')
          );
        })(),
      ),
      0,
    );
    expect(
      "an edit by another lane's owner's agent in their own lane is that owner's rule, before any lease",
      alexHook('guard-paths.mjs', write(b, 'apps/office/report.ts'), 'web-engineer'),
      2,
      "The web lane is sam's",
    );
    expect(
      'a merged story releases its claim, whoever merged it',
      truth(
        spawnSync(
          'node',
          [
            '--input-type=module',
            '-e',
            `import { teamProvider } from ${JSON.stringify(join(hooks, 'lib/team.mjs'))};
             const r = teamProvider(process.cwd(), { techLead: 'alex', provider: 'github', owners: {} }).release('ST-4', { merged: true });
             process.exit(r.released ? 0 : 1);`,
          ],
          {
            cwd: c,
            env: {
              ...process.env,
              PATH: `${bin}:${process.env.PATH}`,
              GH_LOGIN: 'dev2',
              GH_STORE: store,
            },
          },
        ).status === 0,
      ),
      0,
    );
    for (const dir of [a, b, c]) writeFileSync(join(dir, '.claude/code-kit.json'), config);

    // TEAM-5: intents before code.
    const raised = sam(
      'intend',
      'Split',
      'the',
      'report',
      'format',
      '--touches',
      'docs/reports/**,apps/office/**',
    );
    expect(
      'TEAM-5 a developer raises an intent, as a discussion in Intents the team sees, with what it touches',
      truth(
        raised.status === 0 &&
          raised.stdout.includes('Raised intent #') &&
          JSON.parse(dev2('team', '--json', '--fresh').stdout || '{}').intents?.some(
            (i) =>
              i.about === 'Split the report format' &&
              i.by === 'sam' &&
              i.touches.join() === 'docs/reports/**,apps/office/**',
          ),
        raised.stdout + raised.stderr,
      ),
      0,
    );
    const raisedId = raised.stdout.match(/#(\d+)/)?.[1];
    expect(
      'a discussion in another category is not an intent',
      truth(
        !JSON.parse(dev2('team', '--json', '--fresh').stdout || '{}').intents?.some(
          (i) => i.id === 13,
        ),
      ),
      0,
    );
    const withoutCategory = JSON.parse(readFileSync(store, 'utf8'));
    writeFileSync(
      store,
      JSON.stringify({ ...withoutCategory, categories: [{ id: 'C2', name: 'General' }] }),
    );
    expect(
      "without an Intents category nothing is raised, and it says how to add one, since GitHub won't let a tool",
      sam('intend', 'Anything'),
      1,
      "Add it once in the repository's Settings › Discussions",
    );
    writeFileSync(store, JSON.stringify(withoutCategory));
    const twice = sam('intend', 'Split the report format again');
    const twiceId = twice.stdout.match(/#(\d+)/)?.[1];
    expect(
      'the tech lead marks one a duplicate: closed as such',
      truth(
        alex('intend', 'duplicate', twiceId).stdout.includes(
          `Marked intent #${twiceId} a duplicate`,
        ) &&
          JSON.parse(readFileSync(store, 'utf8')).discussions.find(
            (d) => String(d.number) === twiceId,
          )?.stateReason === 'DUPLICATE',
      ),
      0,
    );
    expect(
      'only the tech lead agrees or drops one',
      sam('intend', 'agree', raisedId),
      1,
      'Only the tech lead (alex)',
    );
    expect(
      "an agent can't agree one, even in the tech lead's session",
      alexHook('guard-bash.mjs', { command: `node "${kitCli}" intend agree ${raisedId}` }),
      2,
      "the tech lead's own decision",
    );
    const agreed = alex('intend', 'agree', raisedId, '--reason', 'reports are per site now');
    const closed = JSON.parse(readFileSync(store, 'utf8')).discussions.find(
      (d) => String(d.number) === raisedId,
    );
    expect(
      'the tech lead agrees it: the issue closes with their words, and it leaves the open intents',
      truth(
        agreed.status === 0 &&
          closed?.closed === true &&
          closed.stateReason === 'RESOLVED' &&
          closed.comments.some((c) =>
            c.body.includes('Agreed by @alex, the tech lead: reports are per site now'),
          ) &&
          !JSON.parse(dev2('team', '--json', '--fresh').stdout || '{}').intents?.some(
            (i) => String(i.id) === raisedId,
          ),
        agreed.stderr + JSON.stringify(closed),
      ),
      0,
    );

    // TEAM-11: CODEOWNERS from the config.
    writeFileSync(join(a, '.claude/code-kit.json'), owned);
    const printed = sam('team', 'codeowners');
    expect(
      "TEAM-11 CODEOWNERS names the tech lead for their paths, then each owned lane's owners",
      truth(
        printed.stdout.includes('/docs/** @alex') &&
          printed.stdout.includes('/packages/schemas/** @alex') &&
          printed.stdout.includes('/apps/office/** @sam') &&
          printed.stdout.indexOf('@alex') < printed.stdout.indexOf('@sam') &&
          !printed.stdout.includes('.claude/**'),
        printed.stdout,
      ),
      0,
    );
    expect(
      '--write puts it in .github/CODEOWNERS',
      truth(
        sam('team', 'codeowners', '--write').status === 0 &&
          readFileSync(join(a, '.github/CODEOWNERS'), 'utf8').includes('/apps/office/** @sam'),
      ),
      0,
    );
    writeFileSync(join(a, '.claude/code-kit.json'), config);

    // TEAM-10: an agreed intent becomes a decision record.
    expect(
      "an intent that isn't agreed isn't recorded",
      sam('intend', 'record', '12'),
      1,
      "Intent #12 isn't agreed yet",
    );
    mkdirSync(join(b, 'docs/decisions'), { recursive: true });
    writeFileSync(join(b, 'docs/decisions/0002-use-postgres.md'), '# Use Postgres\n');
    const recorded = alex('intend', 'record', raisedId);
    const recordPath = join(b, 'docs/decisions/0003-split-the-report-format.md');
    const record = existsSync(recordPath) ? readFileSync(recordPath, 'utf8') : '';
    expect(
      'TEAM-10 the agreed intent is written as the next decision record, from the discussion',
      truth(
        recorded.stdout.includes('Wrote docs/decisions/0003-split-the-report-format.md') &&
          record.startsWith('# Split the report format\n') &&
          record.includes('**Raised by:** @sam · **Agreed by:** @alex') &&
          record.includes(`**Discussion:** https://github.com/o/r/discussions/${raisedId}`) &&
          record.includes('- `docs/reports/**`') &&
          record.includes('## Agreed\n\nreports are per site now') &&
          !record.includes('Touches:') &&
          !record.includes('Raised with code-kit'),
        recorded.stdout + recorded.stderr + record,
      ),
      0,
    );
    expect(
      'recorded again, it says where it already is',
      truth(
        alex('intend', 'record', raisedId).stdout.includes(
          'is already recorded: docs/decisions/0003-split-the-report-format.md',
        ),
      ),
      0,
    );

    // TEAM-6: since you last looked.
    const hourAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
    const db = JSON.parse(readFileSync(store, 'utf8'));
    db.events = [
      {
        type: 'PushEvent',
        created_at: hourAgo(50),
        actor: { login: 'sam' },
        payload: { ref: 'refs/heads/web/st-4', size: 2 },
      },
      {
        type: 'PullRequestEvent',
        created_at: hourAgo(40),
        actor: { login: 'sam' },
        // As GitHub sends it now: trimmed to the number and branches. The title and draft come from
        // the pull requests themselves.
        payload: { action: 'opened', number: 14, pull_request: { number: 14 } },
      },
      {
        type: 'PullRequestReviewEvent',
        created_at: hourAgo(30),
        actor: { login: 'alex' },
        payload: { review: { state: 'changes_requested' }, pull_request: { number: 14 } },
      },
      { type: 'WatchEvent', created_at: hourAgo(20), actor: { login: 'stranger' }, payload: {} },
      {
        type: 'PushEvent',
        created_at: hourAgo(60 * 30),
        actor: { login: 'old' },
        payload: { ref: 'refs/heads/x', size: 1 },
      },
    ];
    writeFileSync(store, JSON.stringify(db));
    // Pushes are read from git, not the feed: sam pushes two commits on a story branch.
    const pusher = clone('pusher');
    const pg = (...args) =>
      execFileSync(
        'git',
        [
          '-C',
          pusher,
          '-c',
          'user.name=Sam',
          '-c',
          'user.email=123+sam@users.noreply.github.com',
          ...args,
        ],
        { stdio: 'ignore' },
      );
    pg('switch', '-q', '-c', 'web/st-9');
    for (const n of [1, 2]) pg('commit', '-q', '--allow-empty', '-m', `ST-9 part ${n}`);
    pg('push', '-q', 'origin', 'web/st-9');
    const dev2c = as(c, 'dev2');
    rmSync(join(c, '.claude/state/team-seen.json'), { force: true });
    const first = dev2c('team', 'since');
    expect(
      'TEAM-6 since you last looked: by person, in plain sentences, from the last day the first time',
      truth(
        first.stdout.includes('Since yesterday:') &&
          first.stdout.includes('sam: opened draft pull request #14 Booking list;') &&
          first.stdout.includes('pushed 2 commits to web/st-9') &&
          first.stdout.includes(
            'alex: asked for changes on #14 Booking list; marked as a duplicate intent #',
          ) &&
          first.stdout.includes('; agreed intent #') &&
          !first.stdout.includes('Lunch') &&
          !first.stdout.includes('stranger') &&
          !first.stdout.includes('old:'),
        first.stdout,
      ),
      0,
    );
    expect(
      'reading it marks it read',
      truth(dev2c('team', 'since').stdout.includes('Nothing new.')),
      0,
    );
    sam('team', 'claim', 'ST-21');
    const later = JSON.parse(dev2c('team', 'since', '--json', '--peek').stdout || '{}');
    expect(
      'a claim taken since shows under its holder',
      truth(
        later.people?.sam?.some((e) => e.kind === 'claimed' && e.text === 'claimed ST-21'),
        JSON.stringify(later),
      ),
      0,
    );
    expect(
      '--peek leaves it unread',
      truth(dev2c('team', 'since').stdout.includes('claimed ST-21')),
      0,
    );

    // TEAM-9: stale claims. An old claim, as sam's session would have pushed it ten days ago.
    const oldAt = new Date(Date.now() - 10 * 86400_000).toISOString();
    const tree = execFileSync('git', ['-C', a, 'mktree'], { input: '', encoding: 'utf8' }).trim();
    const oldSha = execFileSync(
      'git',
      [
        '-C',
        a,
        '-c',
        'user.name=sam',
        '-c',
        'user.email=sam@users.noreply.github.com',
        'commit-tree',
        tree,
        '-m',
        JSON.stringify({ story: 'ST-30', by: 'sam', at: oldAt, lease: ['docs/old/**'] }),
      ],
      { encoding: 'utf8' },
    ).trim();
    execFileSync('git', ['-C', a, 'push', '-q', 'origin', `${oldSha}:refs/code-kit/claims/ST-30`]);
    const staleNow = JSON.parse(dev2c('team', '--json', '--fresh').stdout || '{}').claims?.find(
      (x) => x.story === 'ST-30',
    );
    expect(
      'TEAM-9 a claim with nothing on it for more than the stale days is stale',
      truth(staleNow?.stale === true && staleNow.active === oldAt, JSON.stringify(staleNow)),
      0,
    );
    expect(
      'team marks it stale',
      truth(
        dev2c('team').stdout.includes(
          'ST-30 by sam, 10 days ago · stale, nothing since 10 days ago',
        ),
      ),
      0,
    );
    rmSync(join(b, '.claude/state/team.json'), { force: true });
    expect(
      "someone held up by it is told it's stale and that the tech lead may reassign it",
      alexHook('guard-paths.mjs', write(b, 'docs/old/notes.md')),
      2,
      "It's stale: nothing on it since",
    );
    expect(
      'only the tech lead reassigns a claim',
      dev2c('team', 'reassign', 'ST-30', 'dev2'),
      1,
      'Only the tech lead (alex) reassigns a claim.',
    );
    expect(
      "and not through an agent, even in the tech lead's session",
      alexHook('guard-bash.mjs', { command: `node "${kitCli}" team reassign ST-30 dev2` }),
      2,
      "the tech lead's own decision",
    );
    const kept = sam('team', 'keep', 'ST-30');
    expect(
      'the holder keeps it, and the clock starts again',
      truth(
        kept.stdout.includes('Kept ST-30') &&
          JSON.parse(dev2c('team', '--json', '--fresh').stdout || '{}').claims?.find(
            (x) => x.story === 'ST-30',
          )?.stale === false,
        kept.stdout + kept.stderr,
      ),
      0,
    );
    const handed = alex('team', 'reassign', 'ST-30', 'dev2');
    const nowHeld = JSON.parse(dev2c('team', '--json', '--fresh').stdout || '{}').claims?.find(
      (x) => x.story === 'ST-30',
    );
    expect(
      'the tech lead reassigns it: the new holder has it with its lease',
      truth(
        handed.stdout.includes('Reassigned ST-30 from sam to dev2') &&
          nowHeld?.by === 'dev2' &&
          nowHeld.lease.join() === 'docs/old/**',
        handed.stdout + handed.stderr + JSON.stringify(nowHeld),
      ),
      0,
    );

    // TEAM-12: the plan on a Project board.
    execFileSync('git', [
      '-C',
      a,
      '-c',
      'user.name=sam',
      '-c',
      'user.email=s@x',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'start',
    ]);
    execFileSync('git', ['-C', a, 'branch', '-f', 'main']);
    mkdirSync(join(a, 'docs/spec'), { recursive: true });
    writeFileSync(
      join(a, 'docs/spec/01-pricing.md'),
      '# 01. Pricing\n\n### PRICE-1 Price\n\nx\n\n### PRICE-2 Old\n\nx\n',
    );
    writeFileSync(
      join(a, 'docs/spec/plan.md'),
      '# Plan\n\n## M1\n\n### ST-9 Pricing\n\n**Lane:** data\n**Requirements:** PRICE-1\n**Status:** todo\n\n### ST-30 Old reports\n\n**Lane:** data\n**Requirements:** PRICE-2\n**Status:** todo\n',
    );
    writeFileSync(
      join(a, '.claude/code-kit.json'),
      JSON.stringify({
        ...JSON.parse(fixture),
        team: { techLead: 'alex', board: { owner: 'o', number: 3 } },
      }),
    );
    rmSync(join(a, '.claude/state/team.json'), { force: true });
    const synced = sam('team', 'board');
    const board = JSON.parse(readFileSync(store, 'utf8')).project;
    const item = (title) => board?.items.find((i) => i.title === title);
    expect(
      'TEAM-12 each story is on the board with its lane, who has claimed it and its state',
      truth(
        synced.stdout.includes('Board o/3 synced: 2 items added') &&
          item('ST-9 Pricing')?.values.Lane === 'data' &&
          item('ST-9 Pricing').values['Claimed by'] === 'alex' &&
          item('ST-30 Old reports')?.values['Claimed by'] === 'dev2' &&
          item('ST-30 Old reports').body === 'Requirements: PRICE-2' &&
          ['Lane', 'Claimed by', 'Stale', 'State'].every((n) =>
            board.fields.some((f) => f.name === n),
          ),
        synced.stdout + synced.stderr + JSON.stringify(board),
      ),
      0,
    );
    const edits = board.edits;
    const again = sam('team', 'board');
    expect(
      'synced again with nothing changed, it adds and edits nothing',
      truth(
        again.stdout.includes('0 items added, 0 fields changed') &&
          JSON.parse(readFileSync(store, 'utf8')).project.edits === edits,
        again.stdout + again.stderr,
      ),
      0,
    );
    rmSync(join(a, '.claude/state/board.json'), { force: true });
    expect(
      "on a machine that hasn't synced before, the items already there are found, not doubled",
      truth(
        sam('team', 'board').stdout.includes('0 items added, 0 fields changed') &&
          JSON.parse(readFileSync(store, 'utf8')).project.items.length === 2,
      ),
      0,
    );
    writeFileSync(join(a, '.claude/code-kit.json'), config);

    // TEAM-8: the shared repository can't be reached.
    execFileSync('git', ['-C', a, 'remote', 'set-url', 'origin', join(root, 'gone.git')]);
    const cut = sam('team', '--fresh');
    expect(
      "TEAM-8 when the repository can't be reached, team says claims aren't checked and every other rule holds",
      truth(
        cut.status === 0 &&
          cut.stdout.includes(
            "claims and leases aren't checked until it can be; every other rule still holds",
          ),
        cut.stdout,
      ),
      0,
    );
    expect(
      "and a claim says it couldn't be made",
      sam('team', 'claim', 'ST-11'),
      1,
      "can't be reached",
    );
    // TEAM-2: another provider, as a command.
    writeFileSync(
      join(root, 'provider.mjs'),
      `const op = process.argv[2]; let input = ''; process.stdin.on('data', (d) => (input += d)).on('end', () => {
  const { team } = JSON.parse(input);
  if (op === 'state') console.log(JSON.stringify({ at: new Date().toISOString(), reachable: true, me: 'sam', techLead: team.techLead, claims: [{ story: 'ST-3', by: 'kim', at: new Date().toISOString(), lease: [] }], intents: [], pulls: [] }));
  else if (op === 'claim') console.log(JSON.stringify({ ok: false, holder: { story: JSON.parse(input).story, by: 'kim', at: new Date().toISOString() } }));
  else process.exit(3);
});`,
    );
    writeFileSync(
      join(a, '.claude/code-kit.json'),
      JSON.stringify({
        ...JSON.parse(fixture),
        team: { techLead: 'alex', provider: { command: `node "${join(root, 'provider.mjs')}"` } },
      }),
    );
    const viaCommand = JSON.parse(sam('team', '--json', '--fresh').stdout || '{}');
    expect(
      'TEAM-2 a provider named by a command answers the same questions',
      truth(viaCommand.claims?.[0]?.by === 'kim', JSON.stringify(viaCommand)),
      0,
    );
    expect(
      'and its refusal of a claim names who holds it',
      sam('team', 'claim', 'ST-3'),
      1,
      'ST-3 is claimed by kim',
    );
    expect(
      'a provider that fails is unreachable, and team says so',
      truth(sam('team', 'release', 'ST-3').stderr.includes('The team provider')),
      0,
    );
    // TEAM-8: a hosted provider with GitHub as its fallback: while it's down, claims go through GitHub.
    execFileSync('git', ['-C', a, 'remote', 'set-url', 'origin', origin]);
    writeFileSync(join(root, 'down.mjs'), 'process.exit(7);\n');
    writeFileSync(
      join(a, '.claude/code-kit.json'),
      JSON.stringify({
        ...JSON.parse(fixture),
        team: {
          techLead: 'alex',
          provider: { command: `node "${join(root, 'down.mjs')}"`, fallback: 'github' },
        },
      }),
    );
    const viaGitHub = sam('team', 'claim', 'ST-40', '--lease', 'apps/office/**');
    expect(
      'TEAM-8 with the provider down and GitHub its fallback, a claim is made through GitHub',
      truth(viaGitHub.status === 0, viaGitHub.stdout + viaGitHub.stderr),
      0,
    );
    const fellBack = JSON.parse(sam('team', '--json', '--fresh').stdout || '{}');
    expect(
      'and the state says it came through GitHub, and why',
      truth(
        fellBack.reachable === true &&
          fellBack.claims?.some((c) => c.story === 'ST-40' && c.by === 'sam') &&
          /The team provider/.test(fellBack.fallback ?? ''),
        JSON.stringify(fellBack),
      ),
      0,
    );
    expect('a provider with GitHub as its fallback is a valid config', sam('check'), 0);
    writeFileSync(
      join(a, '.claude/code-kit.json'),
      JSON.stringify({
        ...JSON.parse(fixture),
        team: { techLead: 'alex', provider: { command: 'x', fallback: 'gitlab' } },
      }),
    );
    expect(
      'a fallback other than github is refused',
      sam('check'),
      1,
      '"team.provider" must be "github" or { "command"',
    );
    sam('team', 'release', 'ST-40');
    writeFileSync(join(a, '.claude/code-kit.json'), config);

    // --- TEAM-13: a project becomes a team's through team init, and one developer's again ----------
    const solo = join(root, 'solo');
    execFileSync('git', ['clone', '-q', origin, solo], { stdio: 'ignore' });
    mkdirSync(join(solo, '.claude'), { recursive: true });
    writeFileSync(join(solo, '.claude/code-kit.json'), fixture);
    const me = as(solo, 'alex');
    const soloConfig = () => JSON.parse(readFileSync(join(solo, '.claude/code-kit.json'), 'utf8'));
    const shown = me('team', 'init', '--tech-lead', 'alex', '--owner', 'web=sam,@kim');
    expect(
      'TEAM-13 team init shows the team section it would write, and writes nothing',
      truth(
        shown.status === 0 &&
          shown.stdout.includes('"techLead": "alex"') &&
          shown.stdout.includes('lanes.web.owners: sam, kim') &&
          shown.stdout.includes('Nothing is written yet') &&
          soloConfig().team === undefined,
        shown.stdout + shown.stderr,
      ),
      0,
    );
    const written = me('team', 'init', '--tech-lead', 'alex', '--owner', 'web=sam,@kim', '--write');
    expect(
      'with --write it writes the team and the owners, and says GitHub is ready',
      truth(
        written.status === 0 &&
          soloConfig().team?.techLead === 'alex' &&
          soloConfig().lanes.web.owners.join() === 'sam,kim' &&
          written.stdout.includes('Wrote the team') &&
          written.stdout.includes('Lane web: sam, kim') &&
          written.stdout.includes('GitHub is ready for the team.'),
        written.stdout + written.stderr,
      ),
      0,
    );
    expect('and the config it wrote is valid', me('check'), 0);
    expect(
      "a lane that isn't in the config is refused, naming the lanes there are",
      me('team', 'init', '--owner', 'nope=sam'),
      1,
      'There\'s no lane "nope" in the config. The lanes are: ',
    );
    expect(
      'a bad value changes nothing, and says what it must be',
      me('team', 'init', '--stale-days', '0', '--write'),
      1,
      'Nothing changed: "team.staleDays" must be a whole number',
    );
    const missing = me('team', 'init', '--intents', 'Proposals', '--write');
    const missingState = JSON.parse(me('team', '--json', '--fresh').stdout || '{}');
    expect(
      'an intents category the repository lacks is named as still to set up, by init and by the state',
      truth(
        missing.stdout.includes('Still to set up:') &&
          missing.stdout.includes('no "Proposals" discussion category') &&
          missingState.setup?.some((x) => x.includes('"Proposals"')) &&
          missingState.provider?.name === 'GitHub',
        missing.stdout + JSON.stringify(missingState.setup),
      ),
      0,
    );
    const lane = (command, agent) =>
      spawnSync('node', [join(hooks, 'guard-bash.mjs')], {
        input: JSON.stringify({
          cwd: solo,
          tool_input: { command },
          ...(agent ? { agent_type: agent } : {}),
        }),
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: solo,
          PATH: `${bin}:${process.env.PATH}`,
          GH_LOGIN: 'alex',
          GH_STORE: store,
        },
        encoding: 'utf8',
      });
    expect(
      "a lane agent can't write the team's setup",
      lane(`node "${kitCli}" team init --tech-lead kim --write`, 'web-engineer'),
      2,
      "the team's setup is the lead's to write",
    );
    expect(
      'but may look at what init would write',
      lane(`node "${kitCli}" team init --tech-lead kim`, 'web-engineer'),
      0,
    );
    expect('and the lead writes it', lane(`node "${kitCli}" team init --tech-lead kim --write`), 0);
    const off = me('team', 'init', '--off', '--write');
    expect(
      'team init --off takes the team and every owner out: one developer again',
      truth(
        off.status === 0 &&
          soloConfig().team === undefined &&
          soloConfig().lanes.web.owners === undefined &&
          JSON.parse(me('check', '--json').stdout || '{}').team === null,
        off.stdout + off.stderr,
      ),
      0,
    );
  }

  // --- ONB-7: the security review, for the changes that need it ----------------------------------
  {
    const sr = newRepo();
    cleanups.push(sr.dir);
    const srKit = (...args) =>
      spawnSync('node', [kitCli, ...args], { cwd: sr.dir, encoding: 'utf8' });
    const securityOf = (branch) =>
      JSON.parse(srKit('security', '--branch', branch, '--json').stdout || '{}');
    mkdirSync(join(sr.dir, 'docs/spec'), { recursive: true });
    writeFileSync(
      join(sr.dir, 'docs/spec/01-orders.md'),
      '# 01. Orders\n\n## Requirements\n\n### ORD-1 Place an order\n\nx\n\n## Threat model\n\n- **Sensitive:** delivery addresses\n\n## Security requirements\n\n### ORD-2 A customer sees only their own orders\n\nx\n\n## Quality targets\n\nx\n',
    );
    writeFileSync(
      join(sr.dir, 'docs/spec/plan.md'),
      '# Plan\n\n### ST-2 Order list\n\n**Lane:** backend\n**Requirements:** ORD-2\n**Status:** todo\n\n### ST-3 Order styles\n\n**Lane:** web\n**Requirements:** ORD-1\n**Status:** todo\n\n### ST-4 Sign in\n\n**Lane:** backend\n**Requirements:** ORD-1\n**Status:** todo\n\n### ST-5 Dates\n\n**Lane:** web\n**Requirements:** ORD-1\n**Status:** todo\n',
    );
    sr.git('add', '-A');
    sr.git('commit', '-q', '-m', 'spec');
    const branchWith = (branch, files) => {
      sr.git('checkout', '-q', '-b', branch);
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(join(sr.dir, dirname(path)), { recursive: true });
        writeFileSync(join(sr.dir, path), text);
      }
      sr.git('add', '-A');
      sr.git('commit', '-q', '-m', branch);
      sr.git('checkout', '-q', 'main');
    };
    branchWith('backend/st-4', {
      'supabase/functions/auth/login.ts':
        'export const handler = (req) => {\n  const { email, password } = req.body;\n  return email;\n};\n',
    });
    branchWith('web/st-5', { 'package.json': '{ "dependencies": { "dayjs": "1.11.0" } }\n' });
    branchWith('backend/st-2', {
      'workers/orders/list.ts': 'export const list = (rows) => rows;\n',
    });
    branchWith('web/st-3', {
      'apps/office/app/orders.css': '.orders { color: red; }\n',
      'apps/office/app/orders.test.ts': "test('ORD-1', () => login(req.body));\n",
    });
    const signIn = srKit('security', '--branch', 'backend/st-4');
    expect(
      'ONB-7 a branch adding a sign-in handler that reads the request needs the security review, and says where',
      truth(
        signIn.status === 0 &&
          signIn.stdout.includes('ST-4 on backend/st-4 needs the security review') &&
          signIn.stdout.includes('sign-in or sessions (supabase/functions/auth/login.ts') &&
          signIn.stdout.includes('input from outside') &&
          signIn.stdout.includes('supabase/functions/auth/login.ts:2'),
        signIn.stdout + signIn.stderr,
      ),
      0,
    );
    expect(
      'and with no security-reviewer agent it says to re-run init to add it',
      truth(signIn.stdout.includes('Re-run /code-kit:init to add it'), signIn.stdout),
      0,
    );
    const deps = securityOf('web/st-5');
    expect(
      'ONB-7 a branch changing package.json needs it for its dependencies',
      truth(
        deps.needed && deps.reasons.some((r) => r.kind === 'dependencies'),
        JSON.stringify(deps),
      ),
      0,
    );
    const cited = securityOf('backend/st-2');
    expect(
      'ONB-7 a story citing a security requirement needs it, naming the requirement, though its code alone would not',
      truth(
        cited.needed &&
          cited.reasons.length === 1 &&
          cited.reasons[0].kind === 'requirements' &&
          cited.reasons[0].where.join() === 'ORD-2',
        JSON.stringify(cited),
      ),
      0,
    );
    const styles = srKit('security', '--branch', 'web/st-3');
    expect(
      'ONB-7 a stylesheet and a test need no security review',
      truth(
        styles.status === 0 && styles.stdout.includes('needs no security review'),
        styles.stdout,
      ),
      0,
    );
    mkdirSync(join(sr.dir, '.claude/agents'), { recursive: true });
    writeFileSync(
      join(sr.dir, '.claude/agents/security-reviewer.md'),
      readFileSync(join(here, '..', 'templates/security-reviewer.md'), 'utf8'),
    );
    expect(
      'with the agent in place, it says to run it on the diff',
      truth(
        srKit('security', '--branch', 'backend/st-4').stdout.includes(
          'Run the security-reviewer agent on the diff (git diff main...backend/st-4)',
        ),
      ),
      0,
    );
    expect(
      'a branch that does not exist is refused, saying so',
      srKit('security', '--branch', 'web/st-9'),
      1,
      '--branch web/st-9 is not a known branch',
    );
  }

  // --- ONB-1 to ONB-3: onboarding in the right order -----------------------------------------------
  {
    const o = newRepo();
    cleanups.push(o.dir);
    const oKit = (...args) =>
      spawnSync('node', [kitCli, ...args], { cwd: o.dir, encoding: 'utf8' });
    const nextOf = () => JSON.parse(oKit('next', '--json').stdout || '{}');
    mkdirSync(join(o.dir, 'docs/spec'), { recursive: true });
    writeFileSync(
      join(o.dir, 'docs/spec/01-booking.md'),
      '# 01. Booking\n\n### BOOK-1 Book\n\nx\n\n### BOOK-2 Store\n\nx\n',
    );
    writeFileSync(
      join(o.dir, 'docs/spec/plan.md'),
      '# Plan\n\n## M1\n\n### ST-1 Design: booking screens\n\n**Lane:** design\n**Requirements:** BOOK-1\n**Status:** todo\n\n### ST-2 Booking screens\n\n**Lane:** web\n**Requirements:** BOOK-1\n**Depends on:** ST-1\n**Status:** todo\n\n### ST-3 Booking store\n\n**Lane:** backend\n**Requirements:** BOOK-2\n**Status:** todo\n',
    );
    o.git('add', '-A');
    o.git('commit', '-q', '-m', 'spec');
    const designing = nextOf();
    expect(
      'ONB-2 a ready design story comes first, then the stories that need no design',
      truth(
        designing.step === 'design' &&
          designing.args === 'ST-1' &&
          designing.then?.some((t) => t.step === 'dispatch' && t.args === 'ST-3'),
        JSON.stringify(designing),
      ),
      0,
    );
    expect(
      'and the screens wait for their design',
      truth(!JSON.stringify(designing).includes('ST-2')),
      0,
    );
    const status = JSON.parse(oKit('status', '--json').stdout || '{}');
    expect(
      'a design story is no gap in the plan',
      truth(
        !status.problems?.some((p) => p.includes('unknown lane')),
        JSON.stringify(status.problems),
      ),
      0,
    );
    // ONB-3: a companion the config wants is set up before any coding.
    const wanting = JSON.stringify({ ...JSON.parse(fixture), adapters: { 'context-graph': true } });
    writeFileSync(join(o.dir, '.claude/code-kit.json'), wanting);
    const setup = nextOf();
    expect(
      'ONB-3 a companion the config wants and that is not set up comes before the design and the coding',
      truth(
        setup.step === 'setup' &&
          setup.args === 'context-graph:init' &&
          setup.why.includes('before any code is written'),
        JSON.stringify(setup),
      ),
      0,
    );
    mkdirSync(join(o.dir, '.ctx'));
    expect('once it is set up, the build goes on', truth(nextOf().step === 'design'), 0);
    // ONB-1: an agent naming a skill that doesn't exist.
    mkdirSync(join(o.dir, '.claude/agents'), { recursive: true });
    writeFileSync(
      join(o.dir, '.claude/agents/web-engineer.md'),
      '# web-engineer\n\n**Skills to use:** spec-check, `new-screen`, context-graph:cards\n',
    );
    expect(
      'ONB-1 next says when a lane agent names a skill that does not exist',
      truth(
        nextOf().attention?.some((a) =>
          a.startsWith("web-engineer names a skill that doesn't exist: new-screen."),
        ),
        JSON.stringify(nextOf().attention),
      ),
      0,
    );
    mkdirSync(join(o.dir, '.claude/skills/new-screen'), { recursive: true });
    writeFileSync(
      join(o.dir, '.claude/skills/new-screen/SKILL.md'),
      '---\nname: new-screen\n---\n',
    );
    expect(
      'once the skill is written, it says nothing',
      truth(!nextOf().attention?.some((a) => a.includes('names a skill'))),
      0,
    );
    // ONB-5: a setup older than init's tells the person what re-running it adds.
    const older = (n) =>
      nextOf().attention?.some((x) => x.startsWith("This project's code-kit setup predates"));
    const { setup: _, ...unversioned } = JSON.parse(wanting);
    writeFileSync(join(o.dir, '.claude/code-kit.json'), JSON.stringify(unversioned));
    // ONB-7: with the design gate and the QA lane in place, the security reviewer is still missing.
    const securityGap = nextOf();
    expect(
      'ONB-7 an older setup without the security reviewer gets the update step, naming it',
      truth(
        securityGap.step === 'update' &&
          securityGap.why.includes('a security reviewer (.claude/agents/security-reviewer.md)') &&
          !securityGap.why.includes('design gate'),
        JSON.stringify(securityGap),
      ),
      0,
    );
    writeFileSync(
      join(o.dir, '.claude/agents/security-reviewer.md'),
      readFileSync(join(here, '..', 'templates/security-reviewer.md'), 'utf8'),
    );
    o.git('add', '.claude/agents/security-reviewer.md');
    o.git('commit', '-q', '-m', 'security reviewer');
    expect(
      'ONB-5 a project set up before setup 3 is told to re-run init, and why',
      truth(older() && nextOf().step !== 'update'),
      0,
    );
    // ONB-6: what an older setup is missing, named, and nothing new starts until init adds it.
    const { designGate: __, ...ungated } = unversioned;
    const { qa: ___, ...noQa } = unversioned.lanes;
    writeFileSync(
      join(o.dir, '.claude/code-kit.json'),
      JSON.stringify({
        ...ungated,
        lanes: noQa,
        shell: {
          ...ungated.shell,
          restricted: ungated.shell.restricted.map((r) => ({ ...r, lanes: ['data'] })),
        },
      }),
    );
    writeFileSync(
      join(o.dir, 'docs/spec/plan.md'),
      readFileSync(join(o.dir, 'docs/spec/plan.md'), 'utf8').replace('**Depends on:** ST-1\n', ''),
    );
    const update = nextOf();
    expect(
      'ONB-6 an older setup missing the design gate, design stories and a QA lane gets the update step, naming each',
      truth(
        update.step === 'update' &&
          update.why.includes('a design gate for mobile and web') &&
          update.why.includes('ST-2 is planned with no design') &&
          update.why.includes('a QA lane') &&
          update.attention.some((a) => a.includes('ST-1, ST-2, ST-3 wait until /code-kit:init')),
        JSON.stringify(update),
      ),
      0,
    );
    o.git('checkout', '-q', '-b', 'backend/st-3');
    writeFileSync(join(o.dir, 'store.txt'), 'x\n');
    o.git('add', 'store.txt');
    o.git('commit', '-q', '-m', 'ST-3 start');
    o.git('checkout', '-q', '-');
    const inFlight = nextOf();
    expect(
      'and work already started goes on to its review, with nothing new dispatched after it',
      truth(
        inFlight.step === 'review' && inFlight.args === 'ST-3' && !inFlight.then.length,
        JSON.stringify(inFlight),
      ),
      0,
    );
    o.git('branch', '-q', '-D', 'backend/st-3');
    writeFileSync(
      join(o.dir, '.claude/code-kit.json'),
      JSON.stringify({ ...JSON.parse(wanting), setup: 3 }),
    );
    expect('one set up by the current init is not', truth(!older()), 0);
    expect('and its build goes on', truth(nextOf().step !== 'update'), 0);
    writeFileSync(
      join(o.dir, '.claude/code-kit.json'),
      JSON.stringify({ ...JSON.parse(wanting), setup: 9 }),
    );
    expect(
      'a setup newer than this code-kit is refused',
      oKit('check'),
      1,
      '"setup" must be a whole number from 1 to 3',
    );
    writeFileSync(join(o.dir, '.claude/code-kit.json'), wanting);
    // MAP-5: the whole project's code, by folder, for when no story is at work.
    mkdirSync(join(o.dir, 'apps/web/src'), { recursive: true });
    mkdirSync(join(o.dir, 'packages/core/src'), { recursive: true });
    writeFileSync(join(o.dir, 'packages/core/src/price.ts'), 'export const price = 1;\n');
    writeFileSync(
      join(o.dir, 'apps/web/src/form.ts'),
      "import { price } from '../../../packages/core/src/price';\nexport const f = price;\n",
    );
    o.git('add', '-A');
    o.git('commit', '-q', '-m', 'code');
    const whole = JSON.parse(oKit('map', 'project', '--json').stdout || '{}');
    const web = whole.files?.find((f) => f.path === 'apps/web/src');
    expect(
      'MAP-5 map project lists the folders with their file counts and the imports between them',
      truth(
        whole.story?.id === 'project' &&
          web?.files === 1 &&
          web.imports.join() === 'packages/core/src' &&
          whole.files.some((f) => f.path === 'packages/core/src'),
        JSON.stringify(whole),
      ),
      0,
    );
  }

  // --- MAP-1 and TRAIL-1: a story's code by layer, and each requirement's trail -------------------
  {
    const t = newRepo();
    cleanups.push(t.dir);
    const tPut = (rel, body) => {
      mkdirSync(dirname(join(t.dir, rel)), { recursive: true });
      writeFileSync(join(t.dir, rel), body);
    };
    const tKit = (...args) =>
      spawnSync('node', [kitCli, ...args], { cwd: t.dir, encoding: 'utf8' });
    tPut(
      'docs/spec/01-booking.md',
      '# 01. Booking\n\n### BOOK-1 Request\n\nx\n\n### BOOK-2 Cancel\n\nx\n',
    );
    tPut(
      'docs/spec/plan.md',
      '# Plan\n\n## Milestone 1: Bookings\n\n### ST-1 Booking form\n\n**Lane:** web\n**Requirements:** BOOK-1\n**Status:** todo\n\n### ST-12 Cancel\n\n**Lane:** web\n**Requirements:** BOOK-2\n**Status:** todo\n',
    );
    t.git('add', '-A');
    t.git('commit', '-q', '-m', 'plan');
    tPut('apps/office/domain/booking.ts', 'export const booking = 1;\n');
    tPut(
      'apps/office/services/book.ts',
      "import { booking } from '../domain/booking.js';\nexport const book = booking;\n",
    );
    tPut(
      'apps/office/e2e/booking.spec.ts',
      "import { book } from '../services/book';\ntest('BOOK-1 books', () => {});\n",
    );
    t.git('add', '-A');
    t.git('commit', '-q', '-m', 'ST-1: booking form');
    tPut('apps/office/services/cancel.ts', 'export const cancel = 1;\n');
    t.git('add', '-A');
    t.git('commit', '-q', '-m', 'ST-12: cancel');
    const map = JSON.parse(tKit('map', 'ST-1', '--json').stdout || '{}');
    const at = (p) => map.files?.find((f) => f.path === p);
    expect(
      "MAP-1 map gives a story's files by layer, with the imports between them, and not a later story's",
      truth(
        map.files?.length === 3 &&
          at('apps/office/domain/booking.ts')?.layer === 'domain' &&
          at('apps/office/services/book.ts')?.layer === 'services' &&
          at('apps/office/services/book.ts')?.imports.join() === 'apps/office/domain/booking.ts' &&
          at('apps/office/e2e/booking.spec.ts')?.layer === 'tests' &&
          at('apps/office/e2e/booking.spec.ts')?.imports.join() ===
            'apps/office/services/book.ts' &&
          at('apps/office/services/book.ts')?.lane === 'web' &&
          map.layers.join() === 'domain,services,tests',
        JSON.stringify(map),
      ),
      0,
    );
    const rows = JSON.parse(tKit('trail', '--json').stdout || '{}').requirements ?? [];
    const row = (id) => rows.find((r) => r.id === id);
    expect(
      'TRAIL-1 trail follows each requirement to its stories, their code and the tests that name it',
      truth(
        row('BOOK-1')
          ?.stories.map((x) => x.id)
          .join() === 'ST-1' &&
          row('BOOK-1').files.join() ===
            'apps/office/domain/booking.ts,apps/office/services/book.ts' &&
          row('BOOK-1').tests.join() === 'apps/office/e2e/booking.spec.ts' &&
          row('BOOK-2')?.files.join() === 'apps/office/services/cancel.ts' &&
          row('BOOK-2').tests.length === 0,
        JSON.stringify(rows),
      ),
      0,
    );
    tPut(
      'docs/brief.md',
      '# Bookings\n\n## Problem\n\nGroomers lose bookings on paper.\n\n## Decision log\n\n| Date | Decision | Why |\n| --- | --- | --- |\n| 2026-10-01 | Web only | Groomers use laptops |\n',
    );
    t.git('add', '-A');
    t.git('commit', '-q', '-m', 'brief');
    const events = JSON.parse(tKit('journal', '--json').stdout || '{}').events ?? [];
    const kinds = events.map((e) => e.kind);
    expect(
      'JOURNAL-1 journal tells the lineage: the request and its decisions first, then the specification and the work',
      truth(
        kinds[0] === 'request' &&
          events[0].text.includes('Groomers lose bookings on paper') &&
          kinds[1] === 'decision' &&
          events[1].text === 'Decided: Web only, because groomers use laptops.' &&
          kinds.includes('spec'),
        JSON.stringify(events),
      ),
      0,
    );
    const st = JSON.parse(tKit('status', '--json').stdout || '{}');
    expect(
      "a story carries its milestone, the plan's heading above it",
      truth(
        st.stories?.[0]?.milestone === 'Milestone 1: Bookings',
        JSON.stringify(st.stories?.[0]),
      ),
      0,
    );
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
    // The lane agent's worktree, where its branch is checked out.
    const laneTree = join(m.dir, '.claude/worktrees/agent-web');
    m.git('worktree', 'add', '-q', laneTree, 'web/st-1');
    expect(
      'AUT-5 a branch that passes verify is merged',
      mKit('merge', 'web/st-1', '--delegated'),
      0,
    );
    expect(
      "and the lane agent's clean worktree is removed, the branch kept",
      truth(!existsSync(laneTree) && m.git('branch', '--list', 'web/st-1').includes('web/st-1')),
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

    // The queue merges the commit the review passed; a branch that moves on is reviewed again.
    const tipOf = (b) => q.git('rev-parse', b).trim();
    q.git('checkout', '-q', '-b', 'web/st-d', 'main');
    qPut('apps/office/lib/d.ts', 'export const d = 1;\n');
    q.git('add', '-A');
    q.git('commit', '-q', '-m', 'web/st-d');
    q.git('checkout', '-q', 'main');
    const reviewed = tipOf('web/st-d');
    expect(
      'the queue records the commit the review passed',
      says(qKit('queue', 'add', 'web/st-d'), `at ${reviewed.slice(0, 7)}`),
      0,
    );
    expect(
      'in its entry',
      truth(
        JSON.parse(qKit('queue', '--json').stdout).find((e) => e.state === 'waiting')?.commit ===
          reviewed,
      ),
      0,
    );
    q.git('checkout', '-q', 'web/st-d');
    qPut('apps/office/lib/d.ts', 'export const d = 2;\n');
    q.git('commit', '-q', '-am', 'after the review');
    q.git('checkout', '-q', 'main');
    const moved = qKit('queue', 'merge', '--delegated');
    expect(
      'a branch that moved on after its review is not merged',
      truth(
        moved.status === 1 &&
          moved.stderr.includes(
            `has moved on since its review passed (${reviewed.slice(0, 7)} → ${tipOf('web/st-d').slice(0, 7)})`,
          ),
        moved.stdout + moved.stderr,
      ),
      0,
    );
    expect(
      'it leaves the queue as moved, not sent back to its lane',
      truth(
        JSON.parse(qKit('queue', '--json').stdout).at(-1)?.state === 'moved' &&
          !readFileSync(join(q.dir, '.claude/state/reviews.jsonl'), 'utf8').includes('web/st-d'),
      ),
      0,
    );
    expect('and main has none of it', truth(!existsSync(join(q.dir, 'apps/office/lib/d.ts'))), 0);
    qKit('queue', 'add', 'web/st-d');
    q.git('checkout', '-q', 'web/st-d');
    qPut('apps/office/lib/d.ts', 'export const d = 3;\n');
    q.git('commit', '-q', '-am', 'a second review');
    q.git('checkout', '-q', 'main');
    expect(
      'queued again after another review, it keeps its place at the new commit',
      says(qKit('queue', 'add', 'web/st-d'), 'keeps its place in the merge queue, now at'),
      0,
    );
    const merged = qKit('queue', 'merge', '--delegated');
    expect(
      'and merges at the commit that review passed',
      says(merged, `at ${tipOf('web/st-d').slice(0, 7)}`),
      0,
    );
    expect(
      'the merge commit names it',
      truth(
        q
          .git('log', '-1', '--format=%B', 'main')
          .includes(`at ${tipOf('web/st-d').slice(0, 7)}, the commit the review passed,`),
      ),
      0,
    );

    // A check whose tool isn't installed is skipped, and said to be: a pass never hides it.
    q.git('checkout', '-q', '-b', 'platform/st-e', 'main');
    qPut('runbooks/tool/x.md', 'x\n');
    q.git('add', '-A');
    q.git('commit', '-q', '-m', 'platform/st-e');
    const skippedRun = qKit('verify', '--base', 'main');
    expect(
      'verify names a check that did not run',
      truth(
        skippedRun.status === 0 &&
          skippedRun.stdout.includes(
            "Not run, because a tool isn't installed here: missing tool (`no-such-tool-xyz --version` isn't installed)",
          ) &&
          skippedRun.stdout.includes('No problems in what ran.'),
        skippedRun.stdout + skippedRun.stderr,
      ),
      0,
    );
    expect(
      'and lists it in its JSON',
      truth(
        JSON.parse(qKit('verify', '--base', 'main', '--json').stdout).skipped[0]?.check ===
          'missing tool',
      ),
      0,
    );
    q.git('checkout', '-q', 'main');
    qKit('queue', 'add', 'platform/st-e');
    expect(
      'a merge says which checks did not run',
      says(qKit('queue', 'merge', '--delegated'), 'Not run, because'),
      0,
    );
    expect(
      'and so does its merge commit',
      truth(q.git('log', '-1', '--format=%B', 'main').includes('Not run, because')),
      0,
    );
    q.git('checkout', '-q', '-b', 'platform/st-f', 'main');
    qPut('runbooks/required/x.md', 'x\n');
    q.git('add', '-A');
    q.git('commit', '-q', '-m', 'platform/st-f');
    const required = qKit('verify', '--base', 'main');
    expect(
      'a check that requires its tool fails verify instead',
      truth(
        required.status === 1 &&
          required.stdout.includes('`no-such-tool-xyz --version` is not installed'),
        required.stdout + required.stderr,
      ),
      0,
    );
    q.git('checkout', '-q', 'main');
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
    const checked = JSON.parse(sCli('check', '--json').stdout);
    expect(
      'check --json says which harness settings the person chose, the rest being defaults',
      truth(checked.harnessSet.join() === 'autonomy', JSON.stringify(checked.harnessSet)),
      0,
    );
    expect(
      'and settings --json marks each as chosen or not',
      truth(
        JSON.parse(sCli('settings', '--json').stdout)
          .filter((r) => r.set)
          .map((r) => r.key)
          .join() === 'autonomy',
      ),
      0,
    );
    // SET-4: the lane agents' model, for the mod to start each lane agent on.
    const lanes = sCli(
      'settings',
      'set',
      'agents.lanes.model',
      'sonnet',
      '--reason',
      'cheaper lanes',
    );
    expect(
      'SET-4 the lane model is set like any setting, and check --json carries it for the mod',
      truth(
        lanes.status === 0 &&
          JSON.parse(readFileSync(join(s.dir, '.claude/code-kit.json'), 'utf8')).harness.agents
            ?.lanes?.model === 'sonnet' &&
          JSON.parse(sCli('check', '--json').stdout).harness?.agents?.lanes?.model === 'sonnet',
        lanes.stdout + lanes.stderr,
      ),
      0,
    );
    expect(
      "and null puts the lanes back on the session's model",
      truth(
        sCli('settings', 'set', 'agents.lanes.model', 'null', '--reason', 'back').status === 0 &&
          JSON.parse(sCli('check', '--json').stdout).harness?.agents?.lanes?.model === null,
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
  {
    // LEAN-1: on its story's branch, a lane writes its full report before its short hand-back.
    const was = String(git('rev-parse', '--abbrev-ref', 'HEAD')).trim();
    git('checkout', '-q', '-b', 'platform/st-5');
    expect(
      'LEAN-1 a lane on its story branch writes its report before it finishes',
      stop('platform-engineer'),
      2,
      'Write your full report to .claude/state/reports/platform_st-5.md',
    );
    put('.claude/state/reports/platform_st-5.md', '# ST-5\n\nDone: the runbook.\n');
    expect('and with it written, finishes', stop('platform-engineer'), 0);
    const handingBack = (message) =>
      hook('stop-check.mjs', { ...as('platform-engineer'), last_assistant_message: message });
    expect(
      'LEAN-1 a hand-back longer than ten lines is refused, with the report to point to instead',
      handingBack(Array.from({ length: 15 }, (_, i) => `- step ${i}: ran it, passed`).join('\n')),
      2,
      'Your hand-back is 15 lines',
    );
    expect(
      'and a short one finishes',
      handingBack(
        'ST-5 platform/st-5: done.\nNo decision needed.\nReport: .claude/state/reports/platform_st-5.md',
      ),
      0,
    );
    git('checkout', '-q', was);
    git('branch', '-q', '-D', 'platform/st-5');
  }
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
  // Context Graph runs in the background: a lane adds the guidance it finds, with no approval.
  expect(
    "and adds to ctx's rules: guidance applies with no one asked",
    cWrite('.ctx/graph.ctx', 'web-engineer'),
    0,
  );
  expect("but ctx's settings stay the person's", cWrite('.ctx/config.toml', 'web-engineer'), 2);
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
    'ctx settings set card_writer true --reason "try it"',
  ])
    expect(
      `no Claude actor runs the person's ctx act: ${act}`,
      cBash(act),
      2,
      "the person's own acts",
    );
  // A heredoc or a quoted message that mentions one is data, not the act.
  expect(
    "a commit message whose line starts with a person's ctx act is not the act",
    cBash("git commit -F - <<'EOF'\nctx settings set changes one as the person's act\nEOF"),
    0,
  );
  expect(
    'nor is a quoted message that spans lines',
    cBash('git commit -m "Notes\nctx drop src.small is the person\'s"'),
    0,
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
  // Context Graph's card writer and curator are read-only agents to code-kit, yet record cards and
  // decisions like any agent: the paths any actor may write are theirs too, and nothing else is.
  expect(
    'the card writer, a read-only agent, writes file cards',
    cWrite('.ctx/cards.ctx', 'context-graph:card-writer'),
    0,
  );
  expect(
    'and the curator records decisions',
    cWrite('.ctx/decisions.ctx', 'context-graph:curator'),
    0,
  );
  expect(
    'but neither writes anything else',
    cWrite('apps/office/x.ts', 'context-graph:card-writer'),
    2,
    'read-only',
  );
  {
    const before = existsSync(join(c.dir, '.ctx/cards.ctx'))
      ? readFileSync(join(c.dir, '.ctx/cards.ctx'), 'utf8')
      : '';
    writeFileSync(
      join(c.dir, '.ctx/cards.ctx'),
      `${before}F apps/office/a.ts 0123456789ab 2026-10-10 w A card.\n`,
    );
    expect(
      "nor does the audit flag a card the card writer's shell command wrote",
      cHook('lane-audit.mjs', as('context-graph:card-writer')),
      0,
    );
    writeFileSync(join(c.dir, '.ctx/cards.ctx'), before);
  }
  {
    // The card writer works in the lead's checkout, where the lead has uncommitted work of its own.
    mkdirSync(join(c.dir, 'apps/office'), { recursive: true });
    writeFileSync(join(c.dir, 'apps/office/lead-wip.ts'), 'export const wip = 1;\n');
    const writer = { ...as('context-graph:card-writer'), tool_use_id: 'tu-card-1' };
    const shell = (id, command) =>
      cHook('guard-bash.mjs', { ...writer, tool_use_id: id, tool_input: { command } });
    shell('tu-card-1', 'node ctx card apps/office/a.ts --text "A card."');
    const cards = readFileSync(join(c.dir, '.ctx/cards.ctx'), 'utf8');
    writeFileSync(
      join(c.dir, '.ctx/cards.ctx'),
      `${cards}F apps/office/b.ts 0123456789ab 2026-10-10 w B.\n`,
    );
    expect(
      "a read-only agent's command answers for what it changed, not the lead's uncommitted work",
      cHook('lane-audit.mjs', writer),
      0,
    );
    shell('tu-card-2', 'node ctx card apps/office/a.ts --text "A card." > apps/office/out.ts');
    writeFileSync(join(c.dir, 'apps/office/out.ts'), 'x\n');
    expect(
      'but a file its command wrote outside its paths is still caught',
      cHook('lane-audit.mjs', { ...writer, tool_use_id: 'tu-card-2' }),
      2,
      'apps/office/out.ts',
    );
    rmSync(join(c.dir, 'apps/office/out.ts'));
    rmSync(join(c.dir, 'apps/office/lead-wip.ts'));
    writeFileSync(join(c.dir, '.ctx/cards.ctx'), cards);
  }

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

  // ctx's rules change with no approval (its own gate checks a person signed any rule that blocks
  // edits); its settings are the person's, signed with the trailer when they commit them themselves.
  const r = newRepo();
  cleanups.push(r.dir);
  mkdirSync(join(r.dir, '.ctx'));
  writeFileSync(join(r.dir, '.ctx/graph.ctx'), 'L L:repo Repo\n');
  writeFileSync(join(r.dir, '.ctx/config.toml'), '[repo]\nratifiers = ["warren"]\n');
  r.git('add', '-A');
  r.git('commit', '-q', '-m', 'graph');
  r.git('checkout', '-q', '-b', 'ctx-work');
  const rVerify = () =>
    spawnSync(
      'node',
      [join(here, '..', 'bin', 'code-kit.mjs'), 'verify', '--base', 'main', '--no-checks'],
      { cwd: r.dir, encoding: 'utf8' },
    );
  writeFileSync(
    join(r.dir, '.ctx/graph.ctx'),
    'L L:repo Repo\nK G repo.utc L:repo Dates are stored in UTC\n',
  );
  r.git('add', '-A');
  r.git('commit', '-q', '-m', 'guidance an agent found');
  expect(
    "verify accepts guidance an agent added to ctx's rules, unsigned and unlogged",
    rVerify(),
    0,
  );
  const rSettings = (body, trailer) => {
    writeFileSync(join(r.dir, '.ctx/config.toml'), body);
    r.git('add', '-A');
    r.git('commit', '-q', '-m', 'settings', ...(trailer ? ['--trailer', trailer] : []));
  };
  rSettings(
    '[repo]\nratifiers = ["warren"]\n\n[harness]\ncurator = true\n',
    'Ctx-Ratified-By: warren',
  );
  expect(
    "verify accepts ctx's settings committed with the person's ratification trailer",
    rVerify(),
    0,
  );
  rSettings(
    '[repo]\nratifiers = ["warren"]\n\n[harness]\ncurator = false\n',
    'Ctx-Ratified-By: sidequest-lead (delegated)',
  );
  expect(
    'but not with a delegated one, which the hooks log',
    failsWith(rVerify(), 'no approval-log entry records this change'),
    0,
  );
  r.git('reset', '-q', '--hard', 'HEAD~1');
  rSettings('[repo]\nratifiers = ["warren"]\n\n[harness]\ncurator = false\n');
  expect(
    'nor a later unsigned commit to the settings',
    failsWith(rVerify(), 'no approval-log entry records this change'),
    0,
  );

  // JOIN-1 to JOIN-3: what Context Graph knows of the lanes' work, through its adapter. A stand-in
  // ctx on the PATH answers as ctx does, so the test needs no install.
  {
    const bin = mkdtempSync(join(tmpdir(), 'code-kit-ctx-'));
    cleanups.push(bin);
    writeFileSync(
      join(bin, 'ctx'),
      `#!/usr/bin/env node
const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'agents') console.log(JSON.stringify(rest.includes('s1') ? [
  { agent: 'a1', agentType: 'web-engineer', read: [], searched: [], cardsOwed: ['src/a.ts'],
    edited: [{ path: 'src/a.ts', understood: false, missing: ['src/b.ts'] }, { path: 'src/c.ts', understood: true, missing: [] }] },
  { agent: 'main', agentType: null, read: [], searched: [], cardsOwed: [], edited: [] },
] : []));
else if (cmd === 'file') console.log(JSON.stringify({ path: rest[0], rules: [
  { id: 'K:no-fetch', mode: 'E', text: 'No fetch in components' },
  { id: 'K:dates', mode: 'G?', text: 'Dates through lib/date' },
] }));
else process.exit(1);
`,
      { mode: 0o755 },
    );
    const withCtx = (...args) =>
      spawnSync('node', [join(here, '..', 'bin', 'code-kit.mjs'), ...args], {
        cwd: r.dir,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      });
    const facts = JSON.parse(withCtx('adapters', '--json', '--session', 's1').stdout || '[]');
    const web = facts.find((f) => f.name === 'context-graph')?.lanes?.['web-engineer'];
    expect(
      'JOIN-2 adapters --json gives each agent type its edits without understanding and cards owed',
      truth(
        web?.withoutUnderstanding.length === 1 &&
          web.withoutUnderstanding[0].path === 'src/a.ts' &&
          web.withoutUnderstanding[0].unread.join() === 'src/b.ts' &&
          web.cardsOwed.join() === 'src/a.ts' &&
          facts[0].open?.command === 'graph',
        JSON.stringify(facts),
      ),
      0,
    );
    const without = spawnSync(
      process.execPath,
      [join(here, '..', 'bin', 'code-kit.mjs'), 'adapters', '--json'],
      {
        cwd: r.dir,
        encoding: 'utf8',
        env: { ...process.env, PATH: '/usr/bin:/bin' },
      },
    );
    expect(
      'JOIN-1 without ctx available there are no combined facts',
      truth(
        without.status === 0 && JSON.parse(without.stdout).length === 0,
        without.stdout + without.stderr,
      ),
      0,
    );
  }

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
  expect(
    "MQ-2 delegation is the base's committed rule: an uncommitted one doesn't let the lead merge",
    truth(nextIn(v.dir).step !== 'merge'),
    0,
  );
  // Delegation is read from the rules committed on the base, so the change is committed there.
  v.git('commit', '-q', '-am', 'delegate merges');
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
  v.git('commit', '-q', '-am', 'stop delegating merges');
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
  // --- regression: fixes prove their bug, tests aren't weakened (REG-1, REG-2) ---------------------
  {
    const g = newRepo();
    cleanups.push(g.dir);
    const gConfig = (extra = {}) =>
      writeFileSync(
        join(g.dir, '.claude/code-kit.json'),
        JSON.stringify({
          ...JSON.parse(fixture),
          checks: [
            {
              name: 'office tests',
              files: ['apps/office/**'],
              run: ['node --test apps/office/*.test.mjs'],
            },
          ],
          ...extra,
        }),
      );
    gConfig();
    const gPut = (rel, body = '') => {
      mkdirSync(dirname(join(g.dir, rel)), { recursive: true });
      writeFileSync(join(g.dir, rel), body);
    };
    const gCommit = (m) => {
      g.git('add', '-A');
      g.git('commit', '-q', '-m', m);
    };
    const gCli = (...args) =>
      spawnSync(process.execPath, [kitCli, ...args], { cwd: g.dir, encoding: 'utf8' });
    const gVerify = () => gCli('verify', '--base', 'main');
    const gBash = (command, agent) =>
      spawnSync('node', [join(hooks, 'guard-bash.mjs')], {
        input: JSON.stringify({ cwd: g.dir, tool_input: { command }, ...as(agent) }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: g.dir },
        encoding: 'utf8',
      });
    const said = (res) => res.stdout + res.stderr;
    const plan = (fixes) =>
      `# Plan\n\n### ST-1 Stop double booking\n\n**Lane:** web\n**Requirements:** none\n**Depends on:** none\n**Status:** in progress\n${fixes ? `**Fixes:** ${fixes}\n` : ''}\n### ST-2 Tidy booking\n\n**Lane:** web\n**Requirements:** none\n**Depends on:** none\n**Status:** in progress\n**Fixes:** taken slots offered\n\n### ST-3 Rename\n\n**Lane:** web\n**Requirements:** none\n**Depends on:** none\n**Status:** in progress\n`;
    const twoCases = `import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { free } from './booking.mjs';\ntest('lists slots', () => { assert.equal(free([]).length, 0); assert.ok(true); });\ntest('keeps order', () => { assert.deepEqual(free([]), []); });\n`;
    gPut('design/approved-screens.json', JSON.stringify({ screens: [] }));
    gPut('docs/spec/plan.md', plan('two people could book the same slot'));
    // The bug: taken slots are offered as free.
    gPut('apps/office/booking.mjs', 'export const free = (slots) => slots;\n');
    gPut('apps/office/old.test.mjs', twoCases);
    gCommit('base');

    // REG-1: a fix whose test fails without it, on an assertion.
    g.git('checkout', '-q', '-b', 'web/st-1');
    gPut(
      'apps/office/booking.mjs',
      'export const free = (slots) => slots.filter((s) => !s.taken);\n',
    );
    gPut(
      'apps/office/booking.test.mjs',
      `import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { free } from './booking.mjs';\ntest('a taken slot is not free', () => { assert.deepEqual(free([{ taken: true }]), []); });\n`,
    );
    gCommit('ST-1 fix double booking');
    let res = gVerify();
    expect(
      'REG-1 a fix whose test fails without it passes verify',
      truth(res.status === 0 && !said(res).includes('Fixes and their tests'), said(res)),
      0,
    );

    // REG-1: a fix whose test passes without it doesn't prove the bug.
    g.git('checkout', '-q', 'main');
    g.git('checkout', '-q', '-b', 'web/st-2');
    gPut(
      'apps/office/booking.mjs',
      'export const free = (slots) => slots.filter((s) => !s.taken);\n',
    );
    gPut(
      'apps/office/tidy.test.mjs',
      `import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { free } from './booking.mjs';\ntest('no slots, none free', () => { assert.deepEqual(free([]), []); });\n`,
    );
    gCommit('ST-2 tidy');
    res = gVerify();
    expect(
      "REG-1 a fix whose tests also pass without it fails verify: they don't prove the bug",
      truth(
        res.status === 1 &&
          said(res).includes('Fixes and their tests') &&
          said(res).includes('also pass without the fix') &&
          said(res).includes('apps/office/tidy.test.mjs'),
        said(res),
      ),
      0,
    );

    // REG-1: a test that fails without the fix only because it calls what the fix adds.
    g.git('checkout', '-q', 'main');
    g.git('checkout', '-q', '-b', 'web/fix-cancel');
    gPut(
      'apps/office/booking.mjs',
      'export const free = (slots) => slots;\nexport const cancel = (slot) => ({ ...slot, taken: false });\n',
    );
    gPut(
      'apps/office/cancel.test.mjs',
      `import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { cancel } from './booking.mjs';\ntest('a cancelled slot is free', () => { assert.equal(cancel({ taken: true }).taken, false); });\n`,
    );
    gCommit('fix cancel');
    res = gVerify();
    expect(
      'REG-1 a test failing without the fix only because it calls what the fix adds proves nothing',
      truth(
        res.status === 1 && said(res).includes('only because they call what the fix adds'),
        said(res),
      ),
      0,
    );

    // REG-1: a fix with no test.
    g.git('checkout', '-q', 'main');
    g.git('checkout', '-q', '-b', 'web/fix-typo');
    gPut('apps/office/booking.mjs', 'export const free = (slots) => slots; // offered\n');
    gCommit('fix typo');
    res = gVerify();
    expect(
      'REG-1 a fix that adds no test fails verify',
      truth(res.status === 1 && said(res).includes('adds or changes no test'), said(res)),
      0,
    );
    expect(
      "REG-1 CI's --no-checks still proves a fix",
      truth(
        gCli('verify', '--base', 'main', '--no-checks').stdout.includes('adds or changes no test'),
      ),
      0,
    );

    // REG-1: a story that isn't a fix isn't asked to prove one.
    g.git('checkout', '-q', 'main');
    g.git('checkout', '-q', '-b', 'web/st-3');
    gPut('apps/office/booking.mjs', 'export const free = (slots) => slots; // renamed nothing\n');
    gCommit('ST-3 rename');
    res = gVerify();
    expect(
      "REG-1 a story with no Fixes line on a branch not named fix-… isn't checked as a fix",
      truth(res.status === 0, said(res)),
      0,
    );

    // REG-2: the commit hook refuses a weakened test, as a request the person can approve.
    g.git('checkout', '-q', 'main');
    g.git('checkout', '-q', '-b', 'web/st-4');
    gPut(
      'apps/office/old.test.mjs',
      twoCases.replace("test('keeps order'", "test.skip('keeps order'"),
    );
    res = gBash('git add -A && git commit -m skip', 'web-engineer');
    expect(
      'REG-2 a lane committing a skipped test is refused',
      truth(
        res.status === 2 &&
          res.stderr.includes('apps/office/old.test.mjs is a weakened test') &&
          res.stderr.includes('adds a skip or focus marker'),
        res.stderr,
      ),
      0,
    );
    const held = holdable(res.stderr);
    expect(
      'REG-2 the refusal is held for the person with the tests approval',
      truth(held?.kind === 'approval' && held.names.join() === 'tests', JSON.stringify(held)),
      0,
    );
    const asked = JSON.parse(gCli('requests', '--json').stdout).open;
    expect(
      'REG-2 and it waits in the Decisions tab as a request',
      truth(
        asked.some((r) => r.names.includes('tests') && r.what === 'apps/office/old.test.mjs'),
        JSON.stringify(asked),
      ),
      0,
    );
    expect(
      'REG-2 the lead is refused too: only the person allows it',
      gBash('git add -A && git commit -m skip'),
      2,
      'is a weakened test',
    );
    gConfig({ approvals: { delegate: { protected: ['design'] } } });
    expect(
      'REG-2 the lead may not approve it within delegated rules',
      gCli('approve', 'tests', '--delegated', '--reason', 'flaky'),
      1,
      "weakening a test is the person's to allow",
    );
    gConfig();
    gPut('.claude/approvals/web/tests', 'The keeps-order test is wrong until ST-9');
    res = gBash('git add -A && git commit -m skip', 'web-engineer');
    const logged = readFileSync(join(g.dir, '.claude/approval-log.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(
      "REG-2 with the person's approval it may, logged with what it weakened, and the approval is used up",
      truth(
        res.status === 0 &&
          logged.some(
            (e) =>
              e.approval === 'tests' &&
              e.file === 'apps/office/old.test.mjs' &&
              e.reason.startsWith('The keeps-order test is wrong') &&
              e.weakened?.[0]?.includes('skip'),
          ) &&
          !existsSync(join(g.dir, '.claude/approvals/web/tests')),
        res.stderr + JSON.stringify(logged),
      ),
      0,
    );
    g.git('commit', '-q', '-m', 'ST-4 skip with approval');
    res = gVerify();
    expect(
      'REG-2 verify accepts a weakened test the log shows the person approved',
      truth(!said(res).includes('Weakened tests'), said(res)),
      0,
    );

    // REG-2: verify catches what was weakened outside Claude Code.
    g.git('checkout', '-q', 'main');
    g.git('checkout', '-q', '-b', 'web/st-5');
    gPut(
      'apps/office/old.test.mjs',
      twoCases.replace(/test\('keeps order'.*\n/, '').replace('assert.ok(true); ', ''),
    );
    gPut('apps/office/__snapshots__/old.snap', 'changed\n');
    gCommit('ST-5 cut a test');
    res = gVerify();
    expect(
      'REG-2 verify names a test cut down outside the hooks',
      truth(
        res.status === 1 &&
          said(res).includes('Weakened tests') &&
          said(res).includes(
            'apps/office/old.test.mjs has 1 fewer test case ("keeps order" gone)',
          ) &&
          said(res).includes("needs the person's tests approval"),
        said(res),
      ),
      0,
    );
    g.git('checkout', '-q', 'main');
    gPut('apps/office/__snapshots__/old.snap', 'first\n');
    gCommit('a snapshot');
    g.git('checkout', '-q', '-b', 'web/st-6');
    gPut('apps/office/__snapshots__/old.snap', 'rewritten\n');
    gCommit('ST-6 update snapshot');
    expect(
      'REG-2 a rewritten snapshot needs the approval too',
      truth(said(gVerify()).includes('apps/office/__snapshots__/old.snap rewrites a snapshot')),
      0,
    );

    // REG-2: a test moved with the same cases isn't weakened.
    g.git('checkout', '-q', 'main');
    g.git('checkout', '-q', '-b', 'web/st-7');
    g.git('mv', 'apps/office/old.test.mjs', 'apps/office/sub.test.mjs');
    res = gBash('git commit -m move', 'web-engineer');
    expect('REG-2 a test moved with the same cases is not flagged', res, 0);
    g.git('commit', '-q', '-m', 'ST-7 move');
    expect(
      'REG-2 nor does verify flag the move',
      truth(!said(gVerify()).includes('Weakened tests')),
      0,
    );
  }
} finally {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true });
}
process.stdout.write(failed ? `\n${failed} hook test(s) failed\n` : '\nAll hook tests passed\n');
process.exit(failed ? 1 : 0);
