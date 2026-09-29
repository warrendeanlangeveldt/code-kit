#!/usr/bin/env node
// The hooks end to end, run against throwaway git repositories in the OS temp folder with
// test/fixture.json as their config. Exit 0 = allowed, 2 = blocked.
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
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
  git('worktree', 'remove', '--force', '.claude/worktrees/w');
  git('branch', '-q', '-D', 'lane/w');
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
} finally {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true });
}
process.stdout.write(failed ? `\n${failed} hook test(s) failed\n` : '\nAll hook tests passed\n');
process.exit(failed ? 1 : 0);
