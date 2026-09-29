#!/usr/bin/env node
// The hooks end to end, run against throwaway git repositories in the OS temp folder with
// test/fixture.json as their config. Exit 0 = allowed, 2 = blocked.
import { spawnSync, execFileSync } from 'node:child_process';
import {
  appendFileSync,
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

const here = dirname(fileURLToPath(import.meta.url));
const hooks = join(here, '..', 'hooks');
const fixture = readFileSync(join(here, 'fixture.json'), 'utf8');

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

  // --- the CLI -----------------------------------------------------------------------------------
  const check = cli('check');
  expect(
    'check validates the config',
    truth(check.status === 0 && check.stdout.includes('is valid'), check.stderr),
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
  const unowned = cli('unowned');
  expect(
    'unowned lists files nobody may write',
    truth(unowned.stdout.includes('have no owner'), unowned.stderr),
    0,
  );
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
  const listed = cCli('adapters');
  expect(
    'adapters lists what the active adapter adds, and its setup',
    truth(
      listed.stdout.includes('context-graph: active') && listed.stdout.includes('merge=union'),
      listed.stdout + listed.stderr,
    ),
    0,
  );
  const off = JSON.parse(fixture);
  off.adapters = { 'context-graph': false };
  writeFileSync(join(c.dir, '.claude/code-kit.json'), JSON.stringify(off));
  expect('the config can switch an adapter off', cWrite('.ctx/decisions.ctx', 'web-engineer'), 2);
  expect('and says so', says(cCli('adapters'), 'context-graph: switched off in the config'), 0);

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
  vPut(
    'docs/spec/plan.md',
    plan('done')
      .replace('**Depends on:** ST-1\n**Status:** todo', '**Depends on:** ST-1\n**Status:** done')
      .replace('### ST-3 Stray\n\n**Lane:** nope\n**Requirements:** BOOK-9\n', ''),
  );
  vPut('docs/spec/01-booking.md', '# 01. Booking\n\n### BOOK-1 Request\n\n### BOOK-2 Cancel\n');
  vCommit('all done');
  nextIs('when every story is done, next says so', v.dir, 'done');
} finally {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true });
}
process.stdout.write(failed ? `\n${failed} hook test(s) failed\n` : '\nAll hook tests passed\n');
process.exit(failed ? 1 : 0);
