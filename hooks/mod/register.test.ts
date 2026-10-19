// The mod end to end through Claude Code's harness: `claude plugin test` (Claude Code 2.1.287 or later),
// which `npm test` runs when it's available. The CLI, git and the agents are stubbed with what they
// report; the CLI itself is tested in test/hooks.test.mjs, and the drawing in test/units.test.mjs.
import { expect, mock, test } from 'claude-code/testing';
import { rasterCells, sprite, tintOf } from './art.mjs';

const PANE = 'code-kit-lanes';
const APPROVE = 'code-kit-approve';
const RESULT = 'code-kit-result';
const SETTINGS = 'code-kit-settings';
const TEAM = 'code-kit-team';

/** A project as the stubs report it; tests change it to move the world on. */
function project() {
  return {
    check: {
      file: '.claude/code-kit.json',
      exists: true,
      valid: true,
      problems: [] as string[],
      lead: { paths: ['docs/**'] },
      harnessSet: ['autonomy'] as string[], // the person chose autonomy (the default, autonomous)
      lanes: {
        web: { agent: 'web-engineer', paths: ['apps/web/**'] },
        api: { agent: 'api-engineer', paths: ['apps/api/**'] },
        core: { agent: 'core-engineer', paths: ['packages/core/**'] },
      } as Record<string, { agent: string; paths: string[] }>,
      adapters: [],
      docs: { specs: 'docs/specs', plan: 'docs/plan.md' },
    },
    stories: [
      {
        id: 'ST-4',
        title: 'Booking form',
        lane: 'web',
        state: 'in progress',
        branch: 'web/st-4',
        waitingOn: [],
      },
      {
        id: 'ST-6',
        title: 'Contracts',
        lane: 'lead',
        state: 'ready',
        branch: 'lead/st-6',
        waitingOn: [],
      },
      {
        id: 'ST-7',
        title: 'Schema',
        lane: 'lead',
        state: 'ready',
        branch: 'lead/st-7',
        waitingOn: [],
      },
      {
        id: 'ST-9',
        title: 'Pricing',
        lane: 'core',
        state: 'ready',
        branch: 'core/st-9',
        waitingOn: [],
      },
    ] as any[],
    next: { step: 'dispatch', args: 'ST-9', then: [{ step: 'lead', args: 'ST-6 ST-7' }] } as any,
    requests: [] as any[],
    inForce: [] as any[],
    verifyOut: 'No problems.',
    verifyExit: 0,
    refusal: '',
    drawn: [] as any[],
    taken: [] as string[], // command names another command already holds
    stops: [] as any[],
    refs: ' aaa refs/heads/main\n bbb refs/heads/web/st-4\n',
    agents: [] as { type: string; status: string; id?: string; description?: string }[],
    limits: [] as { kind: string; percentUsed: number }[],
    contextPercent: 0, // LEAN-3: how full the lead's context is
    notified: [] as { text: string; title?: string }[], // NOTIFY-1
    viewed: [] as (string | null)[], // WATCH-1
    approveExit: 0,
    mergeExit: 0,
    answer: 'Merge',
    open: new Set<string>(),
    opened: [] as string[],
    closed: [] as string[],
    prompts: [] as string[],
    acts: [] as string[][],
    runs: 0,
    settings: [
      {
        key: 'autonomy',
        value: 'autonomous',
        default: 'autonomous',
        about: 'How the lead loop acts',
      },
      { key: 'hold.minutes', value: 2, default: 2, about: 'How long a call is held' },
      { key: 'agents.reviewer.on', value: false, default: false, about: 'A background reviewer' },
      { key: 'agents.reviewer.model', value: null, default: null, about: "The reviewer's model" },
    ] as any[],
    setExit: 0,
    allowed: false, // an approval in force: the hooks beneath let the call through
    bashRuns: 0,
    delegated: [] as string[][], // HELM-6: the mod never approves for the lead, so this stays empty
    holds: [] as string[][],
    draft: '', // what the person has typed in the prompt
    heads: { 'web/st-4': 'abc123def4567890\n' } as Record<string, string>,
    registered: [] as any[],
    queue: [] as any[],
    requirements: [] as any[],
    times: [] as any[],
    blits: [] as string[],
    adapters: [] as any[],
    agentsThrow: false,
    registerFails: 0,
    commands: [] as any[],
    story: {
      id: 'ST-4',
      title: 'Booking form',
      lane: 'web',
      state: 'review',
      base: 'main',
      branch: 'web/st-4',
      worktree: null,
      requirements: [
        {
          id: 'BOOK-1',
          title: 'Request a booking',
          spec: 'docs/spec/01.md',
          state: 'in progress',
          tests: [],
        },
      ],
      specCheck: {
        file: '.claude/state/spec-check/web_st-4.md',
        rows: [{ requirement: 'BOOK-1', status: 'partial', where: 'apps/web/form.tsx', note: '' }],
      },
      diff: {
        files: [
          { path: 'apps/web/form.tsx', added: 2, removed: 0 },
          { path: 'apps/web/api.ts', added: 1, removed: 0 },
        ],
        text:
          'diff --git a/apps/web/form.tsx b/apps/web/form.tsx\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/apps/web/form.tsx\n@@ -0,0 +1,2 @@\n+export const form = 1;\n+export const x = 2;\n' +
          'diff --git a/apps/web/api.ts b/apps/web/api.ts\nindex 2222222..3333333 100644\n--- a/apps/web/api.ts\n+++ b/apps/web/api.ts\n@@ -1 +1,2 @@\n a\n+b\n',
        truncated: false,
      },
      verify: {
        checks: false,
        where: 'a temporary worktree',
        problems: { Ownership: ["apps/api/x.ts: not the web lane's"], Checks: [] },
      },
    } as any,
    sent: [] as { to: any; text: string }[],
    loopPaused: false, // the pause recorded by `code-kit loop`
    leadSession: null as string | null, // LOOP-10: the session holding the lead lease
    leadClaims: 0,
    asked: [] as { question: string; options: string[]; header?: string }[], // dialogs the mod opened
    typed: null as string | null, // what the person types under the dialog's Other, if anything
    agentFiles: {} as Record<string, string>, // .claude/agents/<name>.md, by path
    spawned: [] as any[], // agent.spawn as it reached Claude Code beneath the mod
    map: null as any, // `code-kit map <story> --json`
    trail: null as any, // `code-kit trail --json`
    journal: { events: [] as any[] }, // `code-kit journal --json`
    team: null as any, // `code-kit team --json`, for a team's project
    teamSince: { people: {} } as any, // `code-kit team since --json`
    questions: [] as any[], // `code-kit ask --json`
    reports: [] as any[], // `code-kit report --json`
    fills: [] as string[], // what the mod put in the prompt
    leadBusy: false, // prompts are queued behind the lead's turn, and never resolve in the test
    sideAsks: [] as any[], // side calls: { fork } or { model }, with their prompt
    sideReply: { isAnswered: true, text: 'dayjs formats the booking dates.', usage: null } as any,
    holdWaits: false, // false: the hold ends at once, as if timed out (tests about cards, not hold)
    waiting: new Map<string, (answer: string) => void>(),
  };
}
type World = ReturnType<typeof project>;

function stub(on: any, w: World) {
  on('process.run', ($: any, e: any) => {
    const argv: readonly string[] = e.argv;
    w.runs += 1;
    const ran = (exitCode: number, stdout: string, stderr = '') => ({
      value: { exitCode, stdout, stderr },
    });
    const sub = argv[2];
    if (argv[0] === 'git' && argv[1] === 'rev-parse') return ran(0, w.heads[argv.at(-1)!] ?? '');
    if (argv[0] === 'git') return ran(0, w.refs);
    if (sub === 'check') return ran(w.check.valid ? 0 : 1, JSON.stringify(w.check));
    if (sub === 'status')
      return ran(
        0,
        JSON.stringify({
          base: 'main',
          stories: w.stories,
          requirements: w.requirements,
          problems: [],
          drift: [],
        }),
      );
    if (sub === 'next') return ran(0, JSON.stringify(w.next));
    if (sub === 'requests' && argv[3] === 'drop') {
      w.acts.push([...argv.slice(2)]);
      const drop = new Set(argv[4].split(',').map(Number));
      w.requests = w.requests.filter((_, i) => !drop.has(i + 1));
      return ran(0, 'Dropped.');
    }
    if (sub === 'requests') return ran(0, JSON.stringify({ open: w.requests, inForce: w.inForce }));
    if (sub === 'ask' && argv[3] === 'answer') {
      w.acts.push([...argv.slice(2)]);
      w.questions = w.questions.map((q) => (q.id === argv[4] ? { ...q, state: 'answered' } : q));
      return ran(0, 'Recorded.');
    }
    if (sub === 'ask') return ran(0, JSON.stringify(w.questions));
    if (sub === 'report' && ['send', 'discard'].includes(argv[3])) {
      w.acts.push([...argv.slice(2)]);
      w.reports = w.reports.map((r) =>
        r.id === argv[4] ? { ...r, state: argv[3] === 'send' ? 'sent' : 'discarded' } : r,
      );
      return ran(
        0,
        argv[3] === 'send' ? 'Filed https://github.com/o/code-kit/issues/9' : 'Discarded.',
      );
    }
    if (sub === 'report') return ran(0, JSON.stringify(w.reports));
    if (sub === 'verify')
      return ran(w.verifyExit, w.verifyExit ? '' : w.verifyOut, w.verifyExit ? w.verifyOut : '');
    if (sub === 'stops') return ran(0, JSON.stringify(w.stops));
    if (sub === 'story') return ran(0, JSON.stringify(w.story));
    if (sub === 'adapters') return ran(0, JSON.stringify(w.adapters));
    if (sub === 'timeline')
      return ran(0, JSON.stringify({ base: 'main', now: 0, stories: w.times }));
    if (sub === 'map') return ran(w.map ? 0 : 1, JSON.stringify(w.map));
    if (sub === 'trail') return ran(w.trail ? 0 : 1, JSON.stringify(w.trail));
    if (sub === 'journal') return ran(0, JSON.stringify(w.journal));
    if (sub === 'team' && argv[3] === 'since') {
      w.acts.push([...argv.slice(2)]);
      return ran(0, JSON.stringify(w.teamSince));
    }
    if (sub === 'team' && ['keep', 'release', 'board', 'reassign'].includes(argv[3])) {
      w.acts.push([...argv.slice(2)]);
      return ran(0, '');
    }
    if (sub === 'team') return ran(w.team ? 0 : 1, JSON.stringify(w.team));
    if (sub === 'intend') {
      w.acts.push([...argv.slice(2)]);
      return ran(0, '');
    }
    if (sub === 'loop' && ['pause', 'resume'].includes(argv[3])) {
      w.acts.push([...argv.slice(2)]);
      w.loopPaused = argv[3] === 'pause';
      return ran(0, '');
    }
    if (sub === 'loop' && argv[3] === 'lead') {
      const session = argv[argv.indexOf('--session') + 1];
      if (w.leadSession && w.leadSession !== session && !argv.includes('--take'))
        return ran(1, '', `Another session (${w.leadSession}) runs the lead loop in this project.`);
      w.leadSession = session;
      w.leadClaims += 1;
      return ran(0, 'This session runs the lead loop.');
    }
    if (sub === 'loop' && argv[3] === 'release') {
      w.acts.push([...argv.slice(2)]);
      if (w.leadSession === argv[argv.indexOf('--session') + 1]) w.leadSession = null;
      return ran(0, '');
    }
    if (sub === 'loop')
      return ran(
        0,
        JSON.stringify({
          paused: w.loopPaused,
          at: null,
          lead: w.leadSession ? { session: w.leadSession, at: '2026-10-16T00:00:00.000Z' } : null,
        }),
      );
    if (sub === 'sent-back') {
      w.acts.push([...argv.slice(2)]);
      return ran(0, `Recorded: ${argv[3]} was sent back.`);
    }
    if (sub === 'queue' && argv[3] === 'merge') {
      w.acts.push([...argv.slice(2)]);
      w.queue = w.queue.map((e, i) => (i === 0 ? { ...e, state: 'merged' } : e));
      return ran(0, 'Merged web/st-4 into main: verify passed on 2 file(s). The queue is empty.');
    }
    if (sub === 'queue') return ran(0, JSON.stringify(w.queue));
    if (sub === 'approve' && argv.includes('--delegated')) {
      w.delegated.push([...argv.slice(2)]);
      return ran(1, '', 'Nothing was approved.');
    }
    if (sub === 'hold') {
      const id = argv[3];
      const at = argv.indexOf('--answer');
      if (at > 0) {
        w.acts.push([...argv.slice(2)]);
        w.waiting.get(id)?.(argv[at + 1]);
        return ran(0, '');
      }
      w.holds.push([...argv.slice(2)]);
      if (!w.holdWaits) return ran(0, 'timed out\n');
      // Waits, as `code-kit hold` does, until the band answers or the test times it out.
      return new Promise((done) =>
        w.waiting.set(id, (answer) => {
          w.waiting.delete(id);
          done(ran(0, `${answer}\n`));
        }),
      );
    }
    if (sub === 'approve') {
      w.acts.push([...argv.slice(2)]);
      if (w.approveExit === 0) {
        w.requests = [];
        w.allowed = true;
      }
      return ran(w.approveExit, '', w.approveExit ? 'approve needs --reason' : '');
    }
    if (sub === 'merge') {
      w.acts.push([...argv.slice(2)]);
      return w.mergeExit
        ? ran(1, '', 'Nothing was merged. code-kit verify found 1 problem(s) on web/st-4')
        : ran(0, 'Merged web/st-4 into main.');
    }
    if (sub === 'settings' && argv[3] === 'set') {
      w.acts.push([...argv.slice(2)]);
      if (w.setExit)
        return ran(
          1,
          '',
          '"harness.hold.minutes" must be a number of minutes from 0 (off) to 10\nNothing was changed.',
        );
      const row = w.settings.find((s) => s.key === argv[4]);
      if (argv[4] === 'autonomy') {
        (w.check as any).harness = { ...(w.check as any).harness, autonomy: argv[5] };
        w.check.harnessSet = [...new Set([...w.check.harnessSet, 'autonomy'])];
      }
      const raw = argv[5];
      row.value =
        raw === 'null'
          ? null
          : raw === 'true'
            ? true
            : raw === 'false'
              ? false
              : /^\d+$/.test(raw)
                ? Number(raw)
                : raw;
      return ran(0, `Set harness.${argv[4]} to ${raw}.`);
    }
    if (sub === 'settings') return ran(0, JSON.stringify(w.settings));
    return ran(1, '', `unexpected ${argv.join(' ')}`);
  });
  on('session.start', () => ({ cwd: '/work' }));
  // Claude Code's own drawing, beneath the mod: nothing of code-kit's.
  on('ui.render', ($: any, e: any) => {
    w.drawn.push(e);
    return { type: 'Box', props: {}, children: [] };
  });
  // What the settings hooks beneath answer a Write or a Bash call with.
  on('tool.call', { tool: 'Write' }, () =>
    w.refusal ? { deny: w.refusal } : { result: { type: 'create' } },
  );
  on('tool.call', { tool: 'Bash' }, () => {
    w.bashRuns += 1;
    return w.refusal && !w.allowed
      ? { deny: w.refusal }
      : { result: { stdout: 'added 1 package', stderr: '', interrupted: false } };
  });
  on('agent.list', () => {
    if (w.agentsThrow) throw new Error('no session is bound in this process');
    return { value: w.agents };
  });
  on('agent.register', ($: any, e: any) => {
    if (w.registerFails > 0) {
      w.registerFails -= 1;
      throw new Error('no session is bound in this process');
    }
    w.registered.push(e);
    return { value: { agent: `code-kit:${e.name}` } };
  });
  on('prompt.read', () => ({ value: { text: w.draft, cursor: w.draft.length } }));
  on('model.fork', ($: any, e: any) => {
    w.sideAsks.push({ fork: true, prompt: e.prompt });
    return { value: w.sideReply };
  });
  on('model.complete', ($: any, e: any) => {
    w.sideAsks.push({ model: e.model, prompt: e.prompt });
    // LEAN-6: the loop reads the lead's reply with a small model; the test's reading answers it.
    if (/Say where that reply left things/.test(e.prompt)) return { value: w.sideReply };
    return { value: { isAnswered: true, text: 'From the facts alone.', usage: null } };
  });
  // Claude Code's own settings hooks beneath: none answer a permission denial.
  on('classic.PermissionDenied', () => ({}));
  on('prompt.fill', ($: any, e: any) => {
    w.fills.push(e.text);
    w.draft = e.text;
    return { isFilled: true };
  });
  on('session.send', ($: any, e: any) => {
    w.sent.push({ to: e.to, text: e.text });
    return { isDelivered: true };
  });
  on('turn.start', ($: any, e: any) => e);
  on('turn.complete', () => ({ text: '' }));
  on('session.end', ($: any, e: any) => ({ sessionId: e.sessionId }));
  on('fs.read', ($: any, e: any) => {
    if (w.agentFiles[e.path] === undefined) throw new Error(`ENOENT: ${e.path}`);
    return { value: w.agentFiles[e.path] };
  });
  on('agent.spawn', ($: any, e: any) => {
    w.spawned.push(e);
    return { model: e.model ?? 'claude-opus-5-5', agentId: `a-${w.spawned.length}` };
  });
  on('session.usage', () => ({
    value: { startedAt: 0, context: { percent: w.contextPercent }, rateLimits: w.limits },
  }));
  on('session.measure', ($: any, e: any) => ({ changed: e.changed }));
  // NOTIFY-1: the person's notification channel; WATCH-1: the main view.
  on('ui.notify', ($: any, e: any) => {
    w.notified.push({ text: e.text, title: e.title });
    return { value: { isSent: true, channel: 'iterm2' } };
  });
  on('ui.view', ($: any, e: any) => {
    w.viewed.push(e.agentId ?? null);
    return { value: {} };
  });
  // A model request, answered with the usage the test gave it.
  on('turn.step', async function* ($: any, e: any) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: e.messageCount === 0 ? null : { model: e.model, ...stepUsage(e.messageCount) },
    };
  } as any);
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } }));
  on('fs.list', () => ({ value: [] }));
  on('session.cwd', () => ({ value: '/work' }));
  on('session.id', () => ({ value: 's1' }));
  on('command.register', ($: any, e: any) =>
    w.taken.includes(e.name) ? { deny: `/${e.name} is taken` } : { value: undefined },
  );
  on('prompt.submit', ($: any, e: any) => {
    w.prompts.push(e.text);
    // A busy lead: the prompt is queued, and its turn doesn't end while the test looks.
    if (w.leadBusy) return new Promise(() => {});
    return { text: e.text };
  });
  // $.ui.ask is the AskUserQuestion dialog: the person picks w.answer where it's one of its labels, types
  // w.typed under Other, or else dismisses it.
  on('tool.call', { tool: 'AskUserQuestion' }, ($: any, e: any) => {
    const q = e.questions[0];
    const labels = (q.options ?? []).map((o: any) => o.label);
    w.asked.push({ question: q.question, options: labels, header: q.header });
    const answer = labels.includes(w.answer) ? w.answer : w.typed;
    if (answer == null) return { deny: 'The person dismissed the question.' };
    return { result: { questions: e.questions, answers: { [q.question]: answer } } };
  });
  // Another plugin's command, as the mod asks for it (Context Graph's /graph).
  on('command.run', ($: any, e: any) => {
    w.commands.push({ command: e.command, args: e.args });
    return { text: '' };
  });
  on('ui.blit', ($: any, e: any) => {
    w.blits.push(e.key);
    return { value: undefined };
  });
  on('ui.panes', () => ({ value: [...w.open].map((id) => ({ id, title: id, isShown: true })) }));
  on('ui.open', ($: any, e: any) => {
    w.opened.push(e.id);
    w.open.add(e.id);
    return { value: { isPlaced: true } };
  });
  on('ui.close', ($: any, e: any) => {
    w.closed.push(e.id);
    w.open.delete(e.id);
    return { value: undefined };
  });
}

/** A request of n thousand tokens, split as a model request's usage is. */
function stepUsage(thousands: number) {
  const n = thousands * 1000;
  return {
    input_tokens: n * 0.3,
    cache_creation_input_tokens: n * 0.1,
    output_tokens: n * 0.1,
    cache_read_input_tokens: n * 0.5,
  };
}

/** One model request by an agent (or the lead) of so many thousand tokens, run to its end. */
async function request($: any, agentId: string | undefined, thousands: number) {
  const s = $.turn.step({
    turnId: `t-${agentId ?? 'lead'}`,
    index: 0,
    model: 'claude-sonnet-5-5',
    messageCount: thousands, // the stub beneath answers with this many thousand tokens
    ...(agentId ? { agentId } : {}),
  });
  for await (const _ of s);
  return s.result;
}

/** A session started on the project, with the mock clock. */
async function start($: any, on: any, w: World, interactive = true) {
  stub(on, w);
  const clock = mock.clock(on);
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: interactive });
  await clock.advance(2000); // the first look at the project
  return clock;
}

const pane = ($: any, requestId: string) =>
  $.ui.mount({
    plugin: 'code-kit',
    component: 'Pane',
    requestId,
    surface: 'terminal',
    viewport: { columns: 120, rows: 40 },
    props: { title: requestId, isFocused: true, bodyColumns: 80 },
  });
const bandUi = ($: any) =>
  $.ui.mount({
    plugin: 'code-kit',
    component: 'AbovePrompt',
    requestId: 'above-prompt',
    surface: 'terminal',
    viewport: { columns: 120, rows: 40 },
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100 },
  });
const press = ($: any, key: string, requestId?: string) =>
  $.ui.press({ plugin: 'code-kit', key, ...(requestId ? { requestId } : {}) });
const lanes = ($: any) => $.command.run({ command: 'lanes', args: '' });
const teamCmd = ($: any) => $.command.run({ command: 'team', args: '' });
const dayjs = {
  at: '2026-10-06T00:00:00.000Z',
  actor: 'web-engineer',
  lane: 'web',
  names: ['dep-dayjs'],
  what: 'npm install dayjs',
  why: 'a new dependency',
};

// --- the Lanes pane -------------------------------------------------------------------------------

test('PANE-1 /lanes opens the Lanes pane, and /lanes again closes it', async ($, on) => {
  const w = project();
  await start($, on, w);
  const first = await lanes($);
  expect(w.opened).toEqual([PANE]);
  expect(first.text ?? '').toBe('');
  await lanes($);
  expect(w.opened).toEqual([PANE]);
  expect(w.closed).toEqual([PANE]);
});

test('PANE-1 after Escape closes the pane, /lanes opens it again', async ($, on) => {
  const w = project();
  await start($, on, w);
  await lanes($);
  w.open.clear(); // the person's Escape: the pane is no longer among those open
  await lanes($);
  expect(w.opened).toEqual([PANE, PANE]);
});

test('PANE-2 each lane shows its agent, story, branch and state', async ($, on) => {
  const w = project();
  await start($, on, w);
  await lanes($);
  const ui = await pane($, PANE);
  expect(await ui.find({ key: 'lane-web' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: 'ST-4 Booking form · web/st-4' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /building/ })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /idle/ })).toBeDefined();
  await ui.unmount();
});

test('PANE-3 the ready stories are listed with their lanes, the lead stories as its own', async ($, on) => {
  const w = project();
  await start($, on, w);
  await lanes($);
  const ui = await pane($, PANE);
  for (const id of ['ST-6', 'ST-7', 'ST-9'])
    expect(await ui.find({ key: `ready-${id}` })).toBeDefined();
  expect(await ui.findAll({ type: 'Text', text: "the lead's own" })).toHaveLength(2);
  await ui.unmount();
});

test('PANE-4 a lane that commits shows the change within 2 seconds', async ($, on) => {
  const w = project();
  const clock = await start($, on, w);
  await lanes($);
  w.agents = [{ type: 'web-engineer', status: 'running' }];
  w.stories[0] = { ...w.stories[0], state: 'review' };
  w.refs = ' aaa refs/heads/main\n ccc refs/heads/web/st-4\n';
  await clock.advance(2000);
  const building = await pane($, PANE);
  expect(await building.find({ type: 'Text', text: '●' })).toBeDefined();
  await building.unmount();
  // The agent finishes: the branch now waits for review, and the active mark goes.
  w.agents = [{ type: 'web-engineer', status: 'completed' }];
  await clock.advance(2000);
  const finished = await pane($, PANE);
  expect(await finished.find({ type: 'Text', text: /in review/ })).toBeDefined();
  expect(await finished.find({ type: 'Text', text: '●' })).toBeUndefined();
  await finished.unmount();
});

test('PANE-4 with nothing changed it reads the project every 10 seconds while the pane is open', async ($, on) => {
  const w = project();
  const clock = await start($, on, w);
  await lanes($);
  const before = w.runs;
  await clock.advance(8000); // four quiet ticks: git only
  expect(w.runs - before).toBe(4);
  // The fifth reads it all (check, status, next, requests, stops, queue, timeline, the lead's questions,
  // the reports waiting, and which session runs the loop, while this one doesn't) between two looks at git.
  await clock.advance(2000);
  expect(w.runs - before).toBe(16);
});

test('CARD-4 outside a code-kit project, /lanes says so, opens nothing, and there is no band', async ($, on) => {
  const w = project();
  w.check = { ...w.check, exists: false, valid: false };
  await start($, on, w);
  const res = await lanes($);
  expect(res.text).toBe("This project doesn't use code-kit.");
  expect(w.opened).toEqual([]);
  const ui = await bandUi($);
  expect(await ui.find({ type: 'Text', text: 'code-kit' })).toBeUndefined();
  await ui.unmount();
});

test('PANE-5 an invalid config shows one line and no lanes', async ($, on) => {
  const w = project();
  w.check = { ...w.check, valid: false, problems: ['"lanes" must be an object'] };
  await start($, on, w);
  await lanes($);
  const ui = await pane($, PANE);
  expect(
    await ui.find({ type: 'Text', text: /The config is invalid: run code-kit check\./ }),
  ).toBeDefined();
  expect(await ui.find({ key: 'lane-web' })).toBeUndefined();
  await ui.unmount();
});

// --- the band, and the person's acts ------------------------------------------------------------

test('BAND-2 with nothing waiting there is no band', async ($, on) => {
  const w = project();
  await start($, on, w);
  const ui = await bandUi($);
  expect(await ui.find({ type: 'Text', text: 'code-kit' })).toBeUndefined();
  await ui.unmount();
});

test('BAND-2 and BAND-4 one open request reads "1 approval waiting", with Approve… on 1', async ($, on) => {
  const w = project();
  w.requests = [dayjs];
  await start($, on, w);
  const ui = await bandUi($);
  expect(await ui.find({ type: 'Text', text: '1 approval waiting' })).toBeDefined();
  const button = await ui.find({ key: 'band-approve' });
  expect(button?.props.hotkey).toBe('1');
  await ui.unmount();
});

test("HELM-6 a request the lead decides isn't the person's: only theirs waits in the band", async ($, on) => {
  const w = project();
  w.requests = [
    { ...dayjs, n: 1, by: 'lead' },
    { ...dayjs, names: ['contract'], what: 'packages/contracts/a.ts', n: 2, by: 'person' },
  ];
  await start($, on, w);
  const ui = await bandUi($);
  expect(await ui.find({ type: 'Text', text: '1 approval waiting' })).toBeDefined();
  await press($, 'band-decide');
  await ui.unmount();
  // Not needed drops it by the number the CLI gave it, past the lead's request it doesn't show.
  const decisions = await pane($, PANE);
  await press($, 'decide-dropRequest', PANE);
  expect(w.acts).toContainEqual(['requests', 'drop', '2', '--via', 'pane']);
  await decisions.unmount();
});

test('ACT-1 and BAND-3 approving with the prefilled reason grants it for the lane, and the line goes', async ($, on) => {
  const w = project();
  w.requests = [dayjs];
  const clock = await start($, on, w);
  const ui = await bandUi($);
  await press($, 'band-approve');
  expect(w.opened).toContain(APPROVE);
  const confirm = await pane($, APPROVE);
  const reason = 'Approve dayjs for the web lane: npm install dayjs';
  expect((await confirm.find({ key: 'approve-reason' }))?.props.value).toBe(reason);
  expect(
    await confirm.find({ type: 'Text', text: /until the install is committed \(at most 7 days\)/ }),
  ).toBeDefined();
  await press($, 'approve-confirm', APPROVE);
  expect(w.acts).toEqual([
    ['approve', 'dep-dayjs', '--lane', 'web', '--reason', reason, '--via', 'pane'],
  ]);
  expect(w.closed).toContain(APPROVE);
  await clock.advance(2000);
  await confirm.unmount();
  await ui.unmount();
  const after = await bandUi($);
  expect(await after.find({ type: 'Text', text: /approval waiting/ })).toBeUndefined();
  await after.unmount();
});

test('ACT-1 the person may type their own reason, and an empty one is not accepted', async ($, on) => {
  const w = project();
  w.requests = [dayjs];
  await start($, on, w);
  const ui = await bandUi($);
  await press($, 'band-approve');
  const confirm = await pane($, APPROVE);
  await $.ui.input({ plugin: 'code-kit', key: 'approve-reason', text: '   ' });
  expect(w.acts).toEqual([]);
  expect(await confirm.find({ type: 'Text', text: /Give a reason/ })).toBeDefined();
  await $.ui.input({
    plugin: 'code-kit',
    key: 'approve-reason',
    text: 'dates on the booking form',
  });
  expect(w.acts[0]).toContain('dates on the booking form');
  await confirm.unmount();
  await ui.unmount();
});

test("ACT-5 the person asks about an approval in its pane; the answer stays there, out of the lead's conversation", async ($, on) => {
  const w = project();
  w.requests = [dayjs];
  await start($, on, w);
  const ui = await bandUi($);
  await press($, 'band-approve');
  const confirm = await pane($, APPROVE);
  await $.ui.input({
    plugin: 'code-kit',
    key: 'ask-about',
    text: 'Why does the booking form need this?',
  });
  expect(w.sideAsks).toHaveLength(1);
  expect(w.sideAsks[0].fork).toBe(true);
  expect(w.sideAsks[0].prompt).toMatch(/approvals asked for: dep-dayjs/);
  expect(w.sideAsks[0].prompt).toMatch(/for: the web lane/);
  expect(w.sideAsks[0].prompt).toMatch(/story: ST-4 Booking form/);
  expect(w.sideAsks[0].prompt).toMatch(/Question: Why does the booking form need this\?$/);
  expect(
    await confirm.find({ type: 'Text', text: 'You: Why does the booking form need this?' }),
  ).toBeDefined();
  expect(JSON.stringify(await confirm.find({ key: 'aside-a-0' }))).toMatch(
    /dayjs formats the booking dates/,
  );
  // A follow-up carries the aside so far; nothing went to the lead, and nothing was approved.
  await $.ui.input({ plugin: 'code-kit', key: 'ask-about', text: 'Is it maintained?' });
  expect(w.sideAsks[1].prompt).toMatch(
    /Q: Why does the booking form need this\?\nA: dayjs formats the booking dates\./,
  );
  expect(w.prompts).toEqual([]);
  expect(w.acts).toEqual([]);
  await confirm.unmount();
  await ui.unmount();
});

test('ACT-5 before the lead has replied there is nothing to fork: it answers from the facts alone', async ($, on) => {
  const w = project();
  w.requests = [dayjs];
  w.sideReply = { isAnswered: false, reason: 'nothing-to-fork' };
  await start($, on, w);
  const ui = await bandUi($);
  await press($, 'band-approve');
  const confirm = await pane($, APPROVE);
  await $.ui.input({ plugin: 'code-kit', key: 'ask-about', text: 'What is it?' });
  expect(w.sideAsks.map((a) => a.model ?? 'fork')).toEqual(['fork', 'sonnet']);
  expect(JSON.stringify(await confirm.find({ key: 'aside-a-0' }))).toMatch(/From the facts alone/);
  await confirm.unmount();
  await ui.unmount();
});

test('ACT-1 cancelling writes nothing', async ($, on) => {
  const w = project();
  w.requests = [dayjs];
  await start($, on, w);
  const ui = await bandUi($);
  await press($, 'band-approve');
  const confirm = await pane($, APPROVE);
  await press($, 'approve-cancel', APPROVE);
  expect(w.acts).toEqual([]);
  expect(w.closed).toContain(APPROVE);
  await confirm.unmount();
  await ui.unmount();
});

test('ACT-1 a grant that fails approves nothing, and the band says why', async ($, on) => {
  const w = project();
  w.requests = [dayjs];
  w.approveExit = 1;
  await start($, on, w);
  const ui = await bandUi($);
  await press($, 'band-approve');
  const confirm = await pane($, APPROVE);
  await press($, 'approve-confirm', APPROVE);
  await confirm.unmount();
  await ui.unmount();
  const after = await bandUi($);
  expect(
    await after.find({ type: 'Text', text: /Nothing was approved: approve needs --reason/ }),
  ).toBeDefined();
  expect(await after.find({ type: 'Text', text: '1 approval waiting' })).toBeDefined();
  await after.unmount();
});

test("DECIDE-1 while the loop runs the build, a lane's finished work never waits in the band for the person", async ($, on) => {
  const w = project();
  w.stories[0] = { ...w.stories[0], state: 'review' };
  await start($, on, w);
  const band = await bandUi($);
  expect(await band.find({ key: 'band-review' })).toBeUndefined();
  expect(await band.find({ key: 'band-merge' })).toBeUndefined();
  await band.unmount();
});

test('ACT-3 Review asks the lead to run the review skill on the branch', async ($, on) => {
  const w = project();
  // The person runs the build themselves: reviews and merges wait in the band for them.
  (w.check as any).harness = { autonomy: 'off' };
  w.stories[0] = { ...w.stories[0], state: 'review' };
  await start($, on, w);
  const ui = await bandUi($);
  expect(await ui.find({ type: 'Text', text: 'ST-4 ready for review' })).toBeDefined();
  await press($, 'band-review');
  expect(w.prompts.some((p) => p.includes('/code-kit:review web/st-4'))).toBe(true);
  await ui.unmount();
  const asked = await bandUi($);
  expect(await asked.find({ type: 'Text', text: 'ST-4 being reviewed' })).toBeDefined();
  await asked.unmount();
});

test('ACT-4 Merge confirms, then merges as the person', async ($, on) => {
  const w = project();
  // The person runs the build themselves: reviews and merges wait in the band for them.
  (w.check as any).harness = { autonomy: 'off' };
  w.stories[0] = { ...w.stories[0], state: 'review' };
  await start($, on, w);
  const ui = await bandUi($);
  await press($, 'band-merge');
  expect(w.acts).toEqual([['merge', 'web/st-4', '--person']]);
  expect(w.opened).toContain(RESULT);
  const shown = await pane($, RESULT);
  expect(await shown.find({ type: 'Text', text: 'Merged web/st-4' })).toBeDefined();
  await shown.unmount();
  await ui.unmount();
});

test('ACT-4 a branch that fails verify is not merged, and the problems are shown', async ($, on) => {
  const w = project();
  // The person runs the build themselves: reviews and merges wait in the band for them.
  (w.check as any).harness = { autonomy: 'off' };
  w.stories[0] = { ...w.stories[0], state: 'review' };
  w.mergeExit = 1;
  await start($, on, w);
  const ui = await bandUi($);
  await press($, 'band-merge');
  const shown = await pane($, RESULT);
  expect(await shown.find({ type: 'Text', text: 'Nothing merged: web/st-4' })).toBeDefined();
  expect(await shown.find({ type: 'Text', text: /verify found 1 problem/ })).toBeDefined();
  await shown.unmount();
  await ui.unmount();
});

test('ACT-4 cancelling the confirmation merges nothing', async ($, on) => {
  const w = project();
  // The person runs the build themselves: reviews and merges wait in the band for them.
  (w.check as any).harness = { autonomy: 'off' };
  w.stories[0] = { ...w.stories[0], state: 'review' };
  w.answer = 'Cancel';
  await start($, on, w);
  const ui = await bandUi($);
  await press($, 'band-merge');
  expect(w.acts).toEqual([]);
  await ui.unmount();
});

test('BAND-2 a failing finish check shows, with Lanes opening the pane', async ($, on) => {
  const w = project();
  w.stops = [
    {
      session: 's1',
      agent: 'a1',
      agentType: 'web-engineer',
      title: 'Check tests failed',
      count: 1,
      at: null,
    },
  ];
  await start($, on, w);
  const ui = await bandUi($);
  expect(
    await ui.find({ type: 'Text', text: 'Finish check failing: Check tests failed' }),
  ).toBeDefined();
  await press($, 'band-lanes');
  expect(w.opened).toContain(PANE);
  await ui.unmount();
});

test('ACT-3 the story shows as being reviewed until the lead has reported', async ($, on) => {
  const w = project();
  // The person runs the build themselves: reviews and merges wait in the band for them.
  (w.check as any).harness = { autonomy: 'off' };
  w.stories[0] = { ...w.stories[0], state: 'review' };
  await start($, on, w);
  const ui = await bandUi($);
  await press($, 'band-review');
  await ui.unmount();
  await $.turn.start({ turnId: 't-review' } as any);
  const during = await bandUi($);
  expect(await during.find({ type: 'Text', text: 'ST-4 being reviewed' })).toBeDefined();
  await during.unmount();
  await $.turn.complete({
    turnId: 't-review',
    answer: 'Reviewed: merge.',
    durationMs: 1,
    isAborted: false,
  } as any);
  const after = await bandUi($);
  expect(await after.find({ type: 'Text', text: 'ST-4 ready for review' })).toBeDefined();
  await after.unmount();
});

// --- refusal cards and the commands -------------------------------------------------------------

/** The refused call's row, as an unfolded group or a standalone call draws it. */
const toolResult = ($: any, id: string, tool: string, output: unknown = null) =>
  $.ui.mount({
    plugin: 'code-kit',
    component: 'ToolUse',
    requestId: id,
    surface: 'terminal',
    viewport: { columns: 120, rows: 40 },
    props: {
      tool_use_id: id,
      tool,
      input: {},
      isRunning: false,
      isErrored: true,
      isInterrupted: false,
      output,
    },
  });
const resultBlock = ($: any, id: string, tool: string) =>
  $.ui.mount({
    plugin: 'code-kit',
    component: 'ToolResult',
    requestId: id,
    surface: 'terminal',
    viewport: { columns: 120, rows: 40 },
    props: { tool_use_id: id, tool, output: null, isErrored: true },
  });

test('CARD-1 a refused write is drawn as a card, its text a press away', async ($, on) => {
  const w = project();
  w.refusal =
    'PreToolUse:Write hook error: Blocked: The web-engineer (web lane) may not write apps/office/x.ts (owned by the backend lane / backend-engineer).\nWrite a short change request for the lead instead, and stop.';
  await start($, on, w);
  await $.tool.call({
    tool: 'Write',
    tool_use_id: 'tu-1',
    file_path: '/work/apps/office/x.ts',
    content: 'x',
  } as any);
  const ui = await toolResult($, 'tu-1', 'Write');
  expect(await ui.find({ type: 'Text', text: 'Write refused: apps/office/x.ts' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /backend lane \/ backend-engineer/ })).toBeDefined();
  expect(
    await ui.find({ type: 'Text', text: /Write a short change request for the lead/ }),
  ).toBeDefined();
  expect(await ui.find({ key: 'card-approve' })).toBeUndefined();
  await press($, 'card-raw', 'tu-1');
  expect(await ui.find({ type: 'Text', text: /may not write apps\/office\/x.ts/ })).toBeDefined();
  await ui.unmount();
});

test('CARD-1 a refusal an approval would allow has Approve…, which opens the confirmation', async ($, on) => {
  const w = project();
  w.refusal =
    'Blocked: a new dependency (dayjs) needs a person\'s approval. Write a short change request for the lead.\n  ! echo "<what you are approving>" > .claude/approvals/web/dep-dayjs\n(a person runs it; it allows installing it for the web lane, until the install is committed, at most 7 days)\nCommand: npm install dayjs';
  await start($, on, w);
  await $.tool.call({ tool: 'Bash', tool_use_id: 'tu-2', command: 'npm install dayjs' } as any);
  const ui = await toolResult($, 'tu-2', 'Bash');
  expect(await ui.find({ type: 'Text', text: 'Install refused: dayjs' })).toBeDefined();
  await press($, 'card-approve', 'tu-2');
  expect(w.opened).toContain(APPROVE);
  const confirm = await pane($, APPROVE);
  expect((await confirm.find({ key: 'approve-reason' }))?.props.value).toBe(
    'Approve dayjs for the web lane: npm install dayjs',
  );
  await confirm.unmount();
  await ui.unmount();
});

test("CARD-1 a refusal that isn't code-kit's is drawn as Claude Code draws it", async ($, on) => {
  const w = project();
  w.refusal = 'Context Graph: read src/b.ts in full first.';
  await start($, on, w);
  await $.tool.call({
    tool: 'Write',
    tool_use_id: 'tu-3',
    file_path: '/work/src/a.ts',
    content: 'x',
  } as any);
  const ui = await toolResult($, 'tu-3', 'Write');
  expect(await ui.find({ type: 'Text', text: /refused/ })).toBeUndefined();
  await ui.unmount();
});

test('CARD-2 /approvals lists the open requests and the approvals in force, with minutes left', async ($, on) => {
  const w = project();
  w.requests = [dayjs];
  w.inForce = [{ name: 'design', lane: 'web', reason: 'new screens agreed', minutesLeft: 42 }];
  await start($, on, w);
  const res = await $.command.run({ command: 'approvals', args: '' });
  expect(res.text).toContain('dayjs for the web lane: npm install dayjs');
  expect(res.text).toContain('design for the web lane, 42 min left: new screens agreed');
});

test("CARD-3 /verify-branch prints verify's report on this branch", async ($, on) => {
  const w = project();
  w.verifyExit = 1;
  w.verifyOut =
    'Layer rules:\n  packages/domain/x.ts imports workers/s (domain may not import workers)\n\n1 problem(s). Fix them on this branch.';
  await start($, on, w);
  const res = await $.command.run({ command: 'verify-branch', args: '' });
  expect(res.text).toContain('domain may not import workers');
  expect(res.text).toContain('1 problem(s)');
});

test('CARD-4 outside a code-kit project, /approvals and /verify-branch say so', async ($, on) => {
  const w = project();
  w.check = { ...w.check, exists: false, valid: false };
  await start($, on, w);
  expect((await $.command.run({ command: 'approvals', args: '' })).text).toBe(
    "This project doesn't use code-kit.",
  );
  expect((await $.command.run({ command: 'verify-branch', args: '' })).text).toBe(
    "This project doesn't use code-kit.",
  );
});

const install =
  'Blocked: a new dependency (dayjs) needs a person\'s approval. Write a short change request for the lead.\n  ! echo "<what you are approving>" > .claude/approvals/dep-dayjs\n(a person runs it; it allows installing it for any agent, until the install is committed, at most 7 days)\nCommand: npm install dayjs';

test('CARD-1 a group holding a refusal unfolds, so its row can be the card', async ($, on) => {
  const w = project();
  await start($, on, w);
  const call = {
    tool_use_id: 'tu-9',
    tool: 'Bash',
    input: {},
    isRunning: false,
    isErrored: true,
    isInterrupted: false,
    output: install,
  };
  const plain = { ...call, tool_use_id: 'tu-8', isErrored: false, output: { stdout: 'ok' } };
  const mountGroup = (calls: any[]) =>
    $.ui.mount({
      plugin: 'code-kit',
      component: 'ToolGroup',
      requestId: 'g-1',
      surface: 'terminal',
      viewport: { columns: 120, rows: 40 },
      props: { calls, isActive: false, isExpanded: false },
    });
  const folded = await mountGroup([plain]);
  expect(w.drawn.at(-1).props.isExpanded).toBe(false);
  await folded.unmount();
  const unfolded = await mountGroup([plain, call]);
  expect(w.drawn.at(-1).props.isExpanded).toBe(true);
  await unfolded.unmount();
});

test('CARD-1 the card is drawn from the text the model read, and the result block beneath is left empty', async ($, on) => {
  const w = project();
  await start($, on, w);
  const row = await toolResult($, 'tu-10', 'Bash', install);
  expect(await row.find({ type: 'Text', text: 'Install refused: dayjs' })).toBeDefined();
  expect(await row.find({ key: 'card-approve' })).toBeDefined();
  await row.unmount();
  w.refusal = install;
  await $.tool.call({ tool: 'Bash', tool_use_id: 'tu-11', command: 'npm install dayjs' } as any);
  const block = await resultBlock($, 'tu-11', 'Bash');
  expect(await block.find({ type: 'Text', text: /dayjs/ })).toBeUndefined();
  await block.unmount();
});

test('CARD-4 a command whose name is taken is left out; the rest of the mod still works', async ($, on) => {
  const w = project();
  w.requests = [dayjs];
  w.taken = ['approvals'];
  stub(on, w);
  const clock = mock.clock(on);
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true });
  await clock.advance(2000);
  const res = await $.command.run({ command: 'lanes', args: '' });
  expect(res.text ?? '').toBe('');
  expect(w.opened).toContain(PANE);
  const ui = await bandUi($);
  expect(await ui.find({ type: 'Text', text: '1 approval waiting' })).toBeDefined();
  await ui.unmount();
});

/** Another plugin drawing its own line in the band, as Context Graph's mod does. */
const neighbour = {
  name: 'neighbour',
  register(on: any) {
    on('ui.render', { component: 'AbovePrompt' }, async ($: any, e: any, next: any) => {
      const { Box, Text } = $.ui.resolve(e);
      const below = await next(e);
      return Box({
        flexDirection: 'column',
        children: [Text({ children: ['2 proposals to ratify'] }), ...(below ? [below] : [])],
      });
    });
  },
};

test(
  "BAND-2 code-kit's lines and another plugin's stand together",
  { plugins: [neighbour] },
  async ($, on) => {
    const w = project();
    w.requests = [dayjs];
    await start($, on, w);
    const ui = await bandUi($);
    expect(await ui.find({ type: 'Text', text: '1 approval waiting' })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: '2 proposals to ratify' })).toBeDefined();
    await ui.unmount();
  },
);

// --- the harness settings -------------------------------------------------------------------------

const harness = ($: any) => $.command.run({ command: 'harness', args: '' });

test('SET-2 /harness opens the settings, each with its value, and /harness again closes it', async ($, on) => {
  const w = project();
  await start($, on, w);
  await harness($);
  expect(w.opened).toContain(SETTINGS);
  const ui = await pane($, SETTINGS);
  expect(await ui.find({ type: 'Text', text: 'hold.minutes' })).toBeDefined();
  expect((await ui.find({ key: 'set-hold.minutes' }))?.props.value).toBe('2');
  expect((await ui.find({ key: 'set-autonomy' }))?.props.value).toBe('autonomous');
  await ui.unmount();
  await harness($);
  expect(w.closed).toContain(SETTINGS);
});

test('SET-2 a change asks for a reason, then is written by the CLI as the pane', async ($, on) => {
  const w = project();
  await start($, on, w);
  await harness($);
  const ui = await pane($, SETTINGS);
  await $.ui.select({
    plugin: 'code-kit',
    key: 'set-autonomy',
    value: 'propose',
    requestId: SETTINGS,
  });
  expect(w.acts).toEqual([]);
  expect(await ui.find({ type: 'Text', text: /Set autonomy to propose\?/ })).toBeDefined();
  await $.ui.input({ plugin: 'code-kit', key: 'settings-reason', text: '   ' });
  expect(w.acts).toEqual([]);
  expect(await ui.find({ type: 'Text', text: /Give a reason/ })).toBeDefined();
  await $.ui.input({ plugin: 'code-kit', key: 'settings-reason', text: 'watch it for a week' });
  expect(w.acts).toEqual([
    ['settings', 'set', 'autonomy', 'propose', '--reason', 'watch it for a week', '--via', 'pane'],
  ]);
  expect(await ui.find({ key: 'settings-confirm' })).toBeUndefined();
  expect((await ui.find({ key: 'set-autonomy' }))?.props.value).toBe('propose');
  await ui.unmount();
});

test('SET-2 a number is typed; one the CLI refuses shows why and changes nothing', async ($, on) => {
  const w = project();
  w.setExit = 1;
  await start($, on, w);
  await harness($);
  const ui = await pane($, SETTINGS);
  await $.ui.input({ plugin: 'code-kit', key: 'set-hold.minutes', text: '45' });
  await $.ui.input({ plugin: 'code-kit', key: 'settings-reason', text: 'longer' });
  expect(await ui.find({ type: 'Text', text: /from 0 \(off\) to 10/ })).toBeDefined();
  expect(w.settings[1].value).toBe(2);
  await press($, 'settings-cancel', SETTINGS);
  expect(await ui.find({ key: 'settings-confirm' })).toBeUndefined();
  await ui.unmount();
});

test("SET-2 the reviewer's model can go back to the session's", async ($, on) => {
  const w = project();
  w.settings[3].value = 'haiku';
  await start($, on, w);
  await harness($);
  const ui = await pane($, SETTINGS);
  expect(await ui.find({ type: 'Text', text: /default the session's/ })).toBeDefined();
  await $.ui.select({
    plugin: 'code-kit',
    key: 'set-agents.reviewer.model',
    value: '',
    requestId: SETTINGS,
  });
  await press($, 'settings-ok', SETTINGS);
  expect(w.acts).toEqual([]);
  await $.ui.input({ plugin: 'code-kit', key: 'settings-reason', text: 'same as the lead' });
  expect(w.acts[0].slice(0, 4)).toEqual(['settings', 'set', 'agents.reviewer.model', 'null']);
  await ui.unmount();
});

test('CARD-4 outside a code-kit project, /harness says so and opens nothing', async ($, on) => {
  const w = project();
  w.check.exists = false;
  w.check.valid = false;
  await start($, on, w);
  const said = await harness($);
  expect(String(said?.text)).toMatch(/code-kit/);
  expect(w.opened).not.toContain(SETTINGS);
});

// --- usage per lane ---------------------------------------------------------------------------------

const working = (id: string, type: string, description: string) => ({
  id,
  type,
  description,
  status: 'running',
});

test("USE-1 a lane agent's requests show on its lane's row and its story", async ($, on) => {
  const w = project();
  w.agents = [working('a1', 'web-engineer', 'Build ST-4: the booking form')];
  const clock = await start($, on, w);
  await lanes($);
  await request($, 'a1', 120);
  await request($, 'a1', 80);
  await clock.advance(2000);
  const ui = await pane($, PANE);
  expect((await ui.find({ key: 'lane-web' }))?.text).toContain('200k');
  await press($, 'tab-usage', PANE);
  expect((await ui.find({ key: 'usage-ST-4' }))?.text).toContain('200k');
  expect((await ui.find({ key: 'lane-api' }))?.text).not.toMatch(/\d+k/);
  await ui.unmount();
});

test("USE-1 the lead's requests are the lead's; an agent's brief names its story", async ($, on) => {
  const w = project();
  w.agents = [working('a2', 'core-engineer', 'ST-9 pricing rules')];
  await start($, on, w);
  await lanes($);
  await request($, undefined, 30);
  await request($, 'a2', 50);
  const ui = await pane($, PANE);
  expect((await ui.find({ key: 'lane-lead' }))?.text).toContain('30k');
  expect((await ui.find({ key: 'lane-core' }))?.text).toContain('50k');
  await press($, 'tab-usage', PANE);
  expect((await ui.find({ key: 'usage-ST-9' }))?.text).toContain('50k');
  await ui.unmount();
});

test("USE-2 the background agents' share and the plan's 5-hour use", async ($, on) => {
  const w = project();
  w.limits = [{ kind: 'five_hour', percentUsed: 62 }];
  w.agents = [
    working('a1', 'web-engineer', 'ST-4 booking form'),
    working('r1', 'code-reviewer', 'Review web/st-4'),
  ];
  await start($, on, w);
  await lanes($);
  await request($, 'a1', 150);
  await request($, 'r1', 50);
  const ui = await pane($, PANE);
  await press($, 'tab-usage', PANE);
  expect(await ui.find({ type: 'Text', text: 'Background agents  50k (25%)' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: '62% of the 5-hour window' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: 'This session  200k tokens' })).toBeDefined();
  await ui.unmount();
});

test('USE-3 a story past three times the median of three finished ones is flagged in the band', async ($, on) => {
  const w = project();
  w.stories = [
    ...['ST-1', 'ST-2', 'ST-3'].map((id) => ({
      id,
      title: id,
      lane: 'api',
      state: 'done',
      branch: `api/${id.toLowerCase()}`,
      waitingOn: [],
    })),
    ...w.stories,
  ];
  w.agents = ['ST-1', 'ST-2', 'ST-3', 'ST-4'].map((id, i) =>
    working(`a${i}`, i < 3 ? 'api-engineer' : 'web-engineer', `${id} work`),
  );
  await start($, on, w);
  await request($, 'a0', 190);
  await request($, 'a1', 200);
  await request($, 'a2', 210);
  await request($, 'a3', 500);
  let ui = await bandUi($);
  expect(await ui.find({ type: 'Text', text: /has used/ })).toBeUndefined();
  await ui.unmount();
  await request($, 'a3', 200);
  ui = await bandUi($);
  expect(await ui.find({ type: 'Text', text: 'ST-4 has used 3.5× the usual' })).toBeDefined();
  await ui.unmount();
});

test('USE-3 with fewer than three finished, nothing is flagged', async ($, on) => {
  const w = project();
  w.stories = [
    { id: 'ST-1', title: 'a', lane: 'api', state: 'done', branch: 'api/st-1', waitingOn: [] },
    ...w.stories,
  ];
  w.agents = [working('a0', 'api-engineer', 'ST-1'), working('a1', 'web-engineer', 'ST-4')];
  await start($, on, w);
  await request($, 'a0', 10);
  await request($, 'a1', 900);
  const ui = await bandUi($);
  expect(await ui.find({ type: 'Text', text: /has used/ })).toBeUndefined();
  await ui.unmount();
});

test('USE-4 past the pause point the band says background agents are paused, and below it not', async ($, on) => {
  const w = project();
  await start($, on, w);
  const measure = (percentUsed: number) =>
    $.session.measure({
      context: {} as any,
      rateLimits: [{ kind: 'five_hour', percentUsed }],
      changed: ['rateLimits'],
    });
  await measure(82);
  let ui = await bandUi($);
  expect(
    await ui.find({ type: 'Text', text: 'background agents paused: plan at 82%' }),
  ).toBeDefined();
  await ui.unmount();
  await measure(79);
  ui = await bandUi($);
  expect(await ui.find({ type: 'Text', text: /paused/ })).toBeUndefined();
  await ui.unmount();
});

test('USE-4 the pause point is the harness setting', async ($, on) => {
  const w = project();
  (w.check as any).harness = { background: { pauseAtPercent: 90 } };
  w.limits = [{ kind: 'five_hour', percentUsed: 85 }];
  await start($, on, w);
  let ui = await bandUi($);
  expect(await ui.find({ type: 'Text', text: /paused/ })).toBeUndefined();
  await ui.unmount();
  w.limits = [{ kind: 'five_hour', percentUsed: 91 }];
  await $.session.measure({ context: {} as any, rateLimits: w.limits, changed: ['rateLimits'] });
  ui = await bandUi($);
  expect(await ui.find({ type: 'Text', text: /plan at 91%/ })).toBeDefined();
  await ui.unmount();
});

// --- hold and ask -----------------------------------------------------------------------------------

const webInstall =
  'Blocked: a new dependency (dayjs) needs a person\'s approval. Write a short change request for the lead.\n  ! echo "<what you are approving>" > .claude/approvals/web/dep-dayjs\n(a person runs it; it allows installing it for the web lane, until the install is committed, at most 7 days)\nCommand: npm install dayjs';

/** A lane's call, left running while the test answers it; returned once the mod has it held. */
async function heldCall($: any, w: World, clock: any, id = 'tu-h1') {
  w.holdWaits = true;
  const call = $.tool.call({
    tool: 'Bash',
    tool_use_id: id,
    command: 'npm install dayjs',
    agentId: 'a1',
  } as any);
  for (let i = 0; i < 50 && !w.waiting.has(id); i++) await clock.advance(1);
  expect(w.waiting.has(id)).toBe(true);
  return { call };
}
/** A call refused, whichever shape the refusal came back in. */
const refused = (res: any) => Boolean(res?.deny || res?.isError);
const refusalText = (res: any) => String(res?.deny ?? res?.text ?? '');

test('HOLD-1 and HOLD-2 a lane installing a new package is held, and the band asks with the time left', async ($, on) => {
  const w = project();
  w.refusal = webInstall;
  const clock = await start($, on, w);
  const { call } = await heldCall($, w, clock);
  let ui = await bandUi($);
  expect(
    await ui.find({ type: 'Text', text: /^web wants to install dayjs · 2:00$/ }),
  ).toBeDefined();
  expect((await ui.find({ key: 'band-approveHeld' }))?.props.hotkey).toBe('1');
  expect((await ui.find({ key: 'band-refuseHeld' }))?.props.hotkey).toBe('2');
  await ui.unmount();
  await clock.advance(7000);
  ui = await bandUi($);
  expect(await ui.find({ type: 'Text', text: /· 1:53$/ })).toBeDefined();
  await ui.unmount();
  w.waiting.get('tu-h1')?.('timed out');
  // A timed-out hold refuses the call, as the hooks did; awaited, so the test doesn't end mid-call.
  expect(refused(await call)).toBe(true);
});

test('DECIDE-2 a decision in the band says which story it is for, and d opens it as a card with its lineage', async ($, on) => {
  const w = project();
  w.refusal = webInstall;
  w.stories[0] = { ...w.stories[0], requirements: ['BOOK-1'] };
  w.requirements = [{ id: 'BOOK-1', title: 'Request a booking', state: 'in progress' }];
  w.journal = {
    events: [
      { at: 1, kind: 'request', text: 'You asked for “Bookings”: guests book a room online.' },
      {
        at: 2,
        kind: 'dispatch',
        story: 'ST-4',
        text: 'ST-4 Booking form (BOOK-1) was handed to the web lane.',
      },
    ],
  };
  w.agents = [{ id: 'a1', type: 'web-engineer', description: 'ST-4', status: 'running' }];
  const clock = await start($, on, w);
  await lanes($);
  const { call } = await heldCall($, w, clock);
  const band = await bandUi($);
  expect(await band.find({ type: 'Text', text: 'for ST-4 Booking form (BOOK-1)' })).toBeDefined();
  expect((await band.find({ key: 'band-decide' }))?.props.hotkey).toBe('d');
  await press($, 'band-decide');
  await band.unmount();
  const ui = await pane($, PANE);
  const card = await ui.find({ key: 'decision-card' });
  expect(card?.text).toMatch(/ST-4 Booking form · web\/st-4/);
  expect(card?.text).toMatch(/BOOK-1 Request a booking/);
  expect(card?.text).toMatch(/npm install dayjs/);
  expect(card?.text).toMatch(/ST-4 Booking form \(BOOK-1\) was handed to the web lane/);
  expect(card?.text).toMatch(/Blocked: a new dependency \(dayjs\) needs a person's approval\./);
  expect(card?.text).not.toMatch(/limits you set/);
  expect((await ui.find({ key: 'decision-option-approveHeld' }))?.text).toMatch(
    /The held call runs now, and the agent carries on/,
  );
  await ui.unmount();
  w.waiting.get('tu-h1')?.('timed out');
  // A timed-out hold refuses the call, as the hooks did; awaited, so the test doesn't end mid-call.
  expect(refused(await call)).toBe(true);
});

test('DECIDE-3 an option on the card answers the decision, as the band would', async ($, on) => {
  const w = project();
  w.refusal = webInstall;
  w.agents = [{ id: 'a1', type: 'web-engineer', description: 'ST-4', status: 'running' }];
  const clock = await start($, on, w);
  await lanes($);
  const { call } = await heldCall($, w, clock);
  const band = await bandUi($);
  await press($, 'band-decide');
  await band.unmount();
  const ui = await pane($, PANE);
  await press($, 'decide-refuseHeld', PANE);
  expect(refused(await call)).toBe(true);
  await ui.unmount();
  const after = await bandUi($);
  expect(await after.find({ key: 'band-decide' })).toBeUndefined();
  await after.unmount();
});

test('DECIDE-3 notes are labelled note, not you, and need no decision', async ($, on) => {
  const w = project();
  w.limits = [{ kind: 'five_hour', percentUsed: 91 }];
  await start($, on, w);
  const band = await bandUi($);
  expect(await band.find({ type: 'Text', text: 'you' })).toBeUndefined();
  expect(await band.find({ key: 'band-decide' })).toBeUndefined();
  await band.unmount();
});

const question = (extra: any = {}) => ({
  id: 'Q-1',
  at: '2026-10-12T05:59:00.000Z',
  by: 'lead',
  question: 'Which weather provider: the Bureau of Meteorology or a commercial service?',
  why: null,
  story: 'ST-4',
  blocks: true,
  options: [
    { label: 'Bureau of Meteorology', effect: 'Free, Australian data; we credit the Bureau.' },
    { label: 'Commercial', effect: 'A paid key; global coverage.' },
  ],
  state: 'open',
  answer: null,
  withdrawn: null,
  ...extra,
});

test("ASK-2 the lead's question waits in the band and as a card; an option answers it and tells the lead", async ($, on) => {
  const w = project();
  w.questions = [
    question(),
    question({
      id: 'Q-2',
      question: 'May sessions show your city?',
      story: null,
      blocks: false,
      options: [],
    }),
  ];
  await start($, on, w);
  const band = await bandUi($);
  expect(
    await band.find({ type: 'Text', text: /^2 questions from the lead: Which weather provider/ }),
  ).toBeDefined();
  await press($, 'band-openDecision');
  await band.unmount();
  const ui = await pane($, PANE);
  // One card per question, not one for both.
  expect(await ui.find({ key: 'decision-pick-0' })).toBeDefined();
  expect(await ui.find({ key: 'decision-pick-1' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: 'ST-4 waits on your answer.' })).toBeDefined();
  expect(
    await ui.find({ type: 'Text', text: 'Free, Australian data; we credit the Bureau.' }),
  ).toBeDefined();
  await press($, 'decide-answerWith-0', PANE);
  expect(w.acts).toContainEqual(['ask', 'answer', 'Q-1', 'Bureau of Meteorology', '--via', 'pane']);
  expect(w.prompts.at(-1)).toBe(
    'The person answered Q-1 (Which weather provider: the Bureau of Meteorology or a commercial service?): Bureau of Meteorology. ST-4 no longer waits on them. Carry on with it.',
  );
  await ui.unmount();
});

test("ASK-2 a question with no options, or Something else…, is answered in the person's own words", async ($, on) => {
  const w = project();
  w.questions = [
    question({
      id: 'Q-2',
      question: 'May sessions show your city?',
      story: null,
      blocks: false,
      options: [],
    }),
  ];
  await start($, on, w);
  const band = await bandUi($);
  await press($, 'band-openDecision');
  await band.unmount();
  const ui = await pane($, PANE);
  await press($, 'decide-answer', PANE);
  expect(w.opened).toContain('code-kit-answer');
  const box = await pane($, 'code-kit-answer');
  await $.ui.input({ plugin: 'code-kit', key: 'answer-text', text: '' });
  expect(
    await box.find({ type: 'Text', text: 'Type your answer: the lead builds on it.' }),
  ).toBeDefined();
  await $.ui.input({
    plugin: 'code-kit',
    key: 'answer-text',
    text: 'Only the suburb, never the street',
  });
  expect(w.acts).toContainEqual([
    'ask',
    'answer',
    'Q-2',
    'Only the suburb, never the street',
    '--via',
    'pane',
  ]);
  expect(w.prompts.at(-1)).toBe(
    'The person answered Q-2 (May sessions show your city?): Only the suburb, never the street. Carry on with it.',
  );
  expect(w.closed).toContain('code-kit-answer');
  await box.unmount();
  await ui.unmount();
});

test("ASK-4 the brief's open questions are the person's decisions: answered to the lead, or put off for the session", async ($, on) => {
  const w = project();
  w.next = {
    ...w.next,
    brief: [
      { question: 'Accounts: AWS, Supabase, Fly', path: 'docs/brief.md' },
      { question: 'The product domain', path: 'docs/brief.md' },
    ],
  };
  await start($, on, w);
  const band = await bandUi($);
  expect(
    await band.find({
      type: 'Text',
      text: '2 open questions in your brief: Accounts: AWS, Supabase, Fly',
    }),
  ).toBeDefined();
  await press($, 'band-openDecision');
  await band.unmount();
  const ui = await pane($, PANE);
  expect(await ui.find({ type: 'Text', text: 'Accounts: AWS, Supabase, Fly' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: 'open in docs/brief.md' })).toBeDefined();
  await press($, 'decide-laterBrief', PANE);
  expect(await ui.find({ type: 'Text', text: 'The product domain' })).toBeDefined();
  await press($, 'decide-answerBrief', PANE);
  const box = await pane($, 'code-kit-answer');
  await $.ui.input({ plugin: 'code-kit', key: 'answer-text', text: 'myaila.com.au' });
  await box.unmount();
  expect(w.prompts.at(-1)).toBe(
    'The person answered an open question in docs/brief.md, "The product domain": myaila.com.au. Record it in the brief\'s decision log, take it out of the open questions, and carry on with it.',
  );
  await ui.unmount();
  const after = await bandUi($);
  expect(await after.find({ type: 'Text', text: /in your brief/ })).toBeUndefined();
  await after.unmount();
});

test("ASK-5 a brief's question shows as a question, with who decides and what it holds up, and can be asked about before answering", async ($, on) => {
  const w = project();
  w.next = {
    ...w.next,
    brief: [
      {
        question: 'Product domain (for the inbound email address and the privacy policy URL).',
        owner: 'Product owner',
        blocks: 'CAP-1 (M2)',
        path: 'docs/brief.md',
      },
    ],
  };
  w.requests = [];
  w.inForce = [{ name: 'dep-rrule', lane: 'domain', reason: 'rrule', minutesLeft: 50 }];
  w.journal = {
    events: [
      {
        at: 1,
        kind: 'request',
        text: 'You asked for “My Aila”: a household’s default parent carries the mental load. Things get missed.',
      },
    ],
  };
  await start($, on, w);
  const band = await bandUi($);
  await press($, 'band-openDecision');
  await band.unmount();
  const ui = await pane($, PANE);
  expect(await ui.find({ type: 'Text', text: 'An open question in your brief' })).toBeDefined();
  expect(
    await ui.find({
      type: 'Text',
      text: 'Product domain (for the inbound email address and the privacy policy URL).',
    }),
  ).toBeDefined();
  expect(await ui.find({ type: 'Text', text: 'Product owner' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: 'CAP-1 (M2)' })).toBeDefined();
  // What they asked for in a line, and no approvals that have nothing to do with it.
  expect(
    await ui.find({
      type: 'Text',
      text: '“My Aila”: a household’s default parent carries the mental load.',
    }),
  ).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /dep-rrule/ })).toBeUndefined();
  await press($, 'decide-answerBrief', PANE);
  const box = await pane($, 'code-kit-answer');
  await $.ui.input({ plugin: 'code-kit', key: 'ask-about', text: 'What is this for?' });
  expect(w.sideAsks[0].prompt).toMatch(/An open question in docs\/brief\.md:\n- Product domain/);
  expect(w.sideAsks[0].prompt).toMatch(/what it holds up: CAP-1 \(M2\)/);
  expect(JSON.stringify(await box.find({ key: 'aside-a-0' }))).toMatch(
    /dayjs formats the booking dates/,
  );
  expect(w.prompts).toEqual([]);
  await box.unmount();
  await ui.unmount();
});

test('ASK-2 and ASK-4 an answer closes its decision at once, though the lead hears it only when its turn ends', async ($, on) => {
  const w = project();
  w.leadBusy = true;
  w.questions = [question({ options: [] })];
  w.next = { ...w.next, brief: [{ question: 'The product domain', path: 'docs/brief.md' }] };
  await start($, on, w);
  const band = await bandUi($);
  await press($, 'band-openDecision');
  await band.unmount();
  const ui = await pane($, PANE);
  await press($, 'decide-answer', PANE);
  let box = await pane($, 'code-kit-answer');
  await $.ui.input({ plugin: 'code-kit', key: 'answer-text', text: 'The Bureau' });
  await box.unmount();
  expect(w.closed).toContain('code-kit-answer');
  expect(await ui.find({ type: 'Text', text: /Which weather provider/ })).toBeUndefined();
  await press($, 'decide-answerBrief', PANE);
  box = await pane($, 'code-kit-answer');
  await $.ui.input({ plugin: 'code-kit', key: 'answer-text', text: 'myaila.com.au' });
  await box.unmount();
  expect(w.prompts).toHaveLength(2);
  expect(
    await ui.find({ type: 'Text', text: 'Nothing needs you. The lead is handling the build.' }),
  ).toBeDefined();
  await ui.unmount();
});

test("PERM-1 a call Claude Code's own permission check refused waits for the person, who runs it or says not now", async ($, on) => {
  const w = project();
  await start($, on, w);
  await $.classic.PermissionDenied({
    tool_name: 'Bash',
    tool_input: { command: 'pnpm db:generate && pnpm db:migrate' },
    tool_use_id: 'tu-1',
    reason: 'Permission for this action was denied by the Claude Code auto mode classifier.',
  });
  const band = await bandUi($);
  expect(
    await band.find({ type: 'Text', text: "Claude Code refused the lead's `pnpm db:generate`" }),
  ).toBeDefined();
  await press($, 'band-runDenied');
  expect(w.fills).toEqual(['! pnpm db:generate && pnpm db:migrate']);
  await press($, 'band-decide');
  await band.unmount();
  const ui = await pane($, PANE);
  expect(
    await ui.find({
      type: 'Text',
      text: /^Claude Code's own permission check refused it \(Permission for this action/,
    }),
  ).toBeDefined();
  await press($, 'decide-deniedDone', PANE);
  expect(w.prompts.at(-1)).toMatch(
    /^The person ran it themselves, or allowed it: pnpm db:generate && pnpm db:migrate/,
  );
  await ui.unmount();
  const after = await bandUi($);
  expect(await after.find({ type: 'Text', text: /Claude Code refused/ })).toBeUndefined();
  await after.unmount();
});

test('PERM-1 a refused call that later goes through no longer waits for the person', async ($, on) => {
  const w = project();
  await start($, on, w);
  const refused = (id: string, command: string) =>
    $.classic.PermissionDenied({
      tool_name: 'Bash',
      tool_input: { command },
      tool_use_id: id,
      reason: 'Permission for this action was denied by the Claude Code auto mode classifier.',
    });
  await refused('tu-1', 'pnpm db:generate');
  await refused('tu-2', 'pnpm db:migrate');
  // another command going through leaves both waiting
  await $.tool.call({ tool: 'Bash', tool_use_id: 'tu-3', command: 'pnpm test' } as any);
  let band = await bandUi($);
  expect(await band.find({ type: 'Text', text: /^2 calls refused by Claude Code/ })).toBeDefined();
  await band.unmount();
  // the lead retries one and it goes through: only the other still waits
  await $.tool.call({ tool: 'Bash', tool_use_id: 'tu-4', command: 'pnpm db:generate' } as any);
  band = await bandUi($);
  expect(
    await band.find({ type: 'Text', text: "Claude Code refused the lead's `pnpm db:migrate`" }),
  ).toBeDefined();
  await band.unmount();
  await $.tool.call({ tool: 'Bash', tool_use_id: 'tu-5', command: 'pnpm db:migrate' } as any);
  band = await bandUi($);
  expect(
    await band.find({ type: 'Text', text: /Claude Code refused|refused by Claude Code/ }),
  ).toBeUndefined();
  await band.unmount();
});

test('CARD-8 two approvals waiting are two decisions, each approved or dropped on its own', async ($, on) => {
  const w = project();
  w.requests = [
    dayjs,
    {
      ...dayjs,
      at: '2026-10-06T00:05:00.000Z',
      actor: 'api-engineer',
      lane: 'api',
      names: ['dep-zod'],
      what: 'npm install zod',
    },
  ];
  await start($, on, w);
  const band = await bandUi($);
  expect(await band.find({ type: 'Text', text: '2 approvals waiting' })).toBeDefined();
  await press($, 'band-decide');
  await band.unmount();
  const ui = await pane($, PANE);
  expect(await ui.find({ key: 'decision-pick-0' })).toBeDefined();
  expect(await ui.find({ key: 'decision-pick-1' })).toBeDefined();
  await press($, 'decision-pick-1', PANE);
  await press($, 'decide-dropRequest', PANE);
  expect(w.acts).toContainEqual(['requests', 'drop', '2', '--via', 'pane']);
  await ui.unmount();
});

test('CARD-9 many decisions read as short cards, a few at a time, with the selected one in full', async ($, on) => {
  const w = project();
  w.requests = Array.from({ length: 8 }, (_, i) => ({
    ...dayjs,
    at: `2026-10-06T00:0${i}:00.000Z`,
    names: [`dep-pkg${i}`, 'dep-a', 'dep-b', 'dep-c'],
    what: `pnpm --filter @app/web add pkg${i} a b c 2>&1 | tail -20 && cat > tsconfig.json <<'EOF'\n{ "x": 1 }\nEOF`,
  }));
  w.questions = [question()];
  await start($, on, w);
  const band = await bandUi($);
  await press($, 'band-decide');
  await band.unmount();
  const ui = await pane($, PANE);
  expect((await ui.find({ key: 'decision-kinds' }))?.text).toBe('8 approvals · 1 question');
  // Five cards at a time, each a headline and a line under it; the command cut at its pipe, on one line.
  expect(await ui.find({ key: 'decision-item-4' })).toBeDefined();
  expect(await ui.find({ key: 'decision-item-5' })).toBeUndefined();
  expect(await ui.find({ type: 'Text', text: '  ↓ 4 more' })).toBeDefined();
  expect((await ui.find({ key: 'decision-pick-0' }))?.props.label).toBe(
    'Approve pkg0, a, b and 1 more',
  );
  expect(
    await ui.find({
      type: 'Text',
      text: 'for the web lane · ST-4 · pnpm --filter @app/web add pkg0 a b c',
    }),
  ).toBeDefined();
  expect((await ui.findAll({ type: 'Text' })).some((t: any) => /tsconfig|EOF/.test(t.text))).toBe(
    false,
  );
  await press($, 'decision-next', PANE);
  await press($, 'decision-next', PANE);
  await press($, 'decision-next', PANE);
  expect(await ui.find({ type: 'Text', text: /↑ \d+ more/ })).toBeDefined();
  expect((await ui.findAll({ type: 'Text' })).some((t: any) => t.text === '4 of 9')).toBe(true);
  await ui.unmount();
});

test('REPORT-3 a bug report an agent drafted waits for the person, who reads it and sends it, or discards it', async ($, on) => {
  const w = project();
  w.reports = [
    {
      id: 'R-1',
      at: '2026-10-13T00:00:00Z',
      by: 'lead',
      title: 'Decisions tab misses a held call',
      fingerprint: 'ck-1',
      body: '**What happened:** the card never showed',
      state: 'draft',
      sent: null,
    },
  ];
  await start($, on, w);
  const band = await bandUi($);
  expect(
    await band.find({
      type: 'Text',
      text: 'A bug report for code-kit to send: Decisions tab misses a held call',
    }),
  ).toBeDefined();
  await press($, 'band-openDecision');
  await band.unmount();
  const ui = await pane($, PANE);
  expect(
    await ui.find({ type: 'Text', text: '**What happened:** the card never showed' }),
  ).toBeDefined();
  await press($, 'decide-sendReport', PANE);
  expect(w.acts).toContainEqual(['report', 'send', 'R-1']);
  expect(w.opened).toContain('code-kit-result');
  await ui.unmount();
});

test('ASK-3 a lane whose story waits on the person reads waiting on you', async ($, on) => {
  const w = project();
  w.stories = w.stories.map((s: any) =>
    s.id === 'ST-4'
      ? { ...s, state: 'waiting on you', waitingFor: { id: 'Q-1', question: 'x' } }
      : s,
  );
  await start($, on, w);
  await lanes($);
  const ui = await pane($, PANE);
  expect((await ui.findAll({ type: 'Text' })).some((t: any) => /waiting on you/.test(t.text))).toBe(
    true,
  );
  await ui.unmount();
});

test('JOURNAL-1 the Journal tab tells the lineage, from the request to now, with the loop and your choices in it', async ($, on) => {
  const w = project();
  w.journal = {
    events: [
      {
        at: Date.parse('2026-10-01T09:00:00Z'),
        kind: 'request',
        text: 'You asked for “Bookings”.',
      },
      {
        at: Date.parse('2026-10-01T09:30:00Z'),
        kind: 'dispatch',
        story: 'ST-4',
        text: 'ST-4 Booking form was handed to the web lane.',
      },
      {
        at: Date.parse('2026-10-02T10:00:00Z'),
        kind: 'approval',
        who: 'person',
        text: 'You approved adding the package dayjs: “dates”.',
      },
      {
        at: Date.parse('2026-10-02T11:00:00Z'),
        kind: 'merge',
        story: 'ST-4',
        text: 'ST-4 Booking form was merged into main.',
      },
    ],
  };
  await start($, on, w);
  await lanes($);
  const ui = await pane($, PANE);
  expect((await ui.find({ key: 'tab-journal' }))?.props.hotkey).toBe('3');
  await press($, 'tab-journal', PANE);
  const journal = await ui.find({ key: 'journal' });
  expect(journal?.text).toMatch(
    /2026-10-01[\s\S]*You asked for “Bookings”[\s\S]*handed to the web lane[\s\S]*2026-10-02[\s\S]*You approved adding the package dayjs[\s\S]*merged into main/,
  );
  await ui.unmount();
});

test('HOLD-3 on Approve the approval is written as the pane writes it, and the same call runs', async ($, on) => {
  const w = project();
  w.refusal = webInstall;
  const clock = await start($, on, w);
  const { call } = await heldCall($, w, clock);
  const shown = await bandUi($);
  await press($, 'band-approveHeld');
  await shown.unmount();
  expect(w.opened).toContain(APPROVE);
  const confirm = await pane($, APPROVE);
  await press($, 'approve-confirm', APPROVE);
  expect(w.acts).toEqual([
    [
      'approve',
      'dep-dayjs',
      '--lane',
      'web',
      '--reason',
      'Approve dayjs for the web lane: npm install dayjs',
      '--via',
      'pane',
    ],
    ['hold', 'tu-h1', '--answer', 'approved'],
  ]);
  const res: any = await call;
  expect(refused(res)).toBe(false);
  expect(w.bashRuns).toBe(2);
  const ui = await bandUi($);
  expect(await ui.find({ type: 'Text', text: /wants to/ })).toBeUndefined();
  await ui.unmount();
  await confirm.unmount();
});

test("HOLD-3 an approval that can't be written refuses the call, and the band says nothing was approved", async ($, on) => {
  const w = project();
  w.refusal = webInstall;
  w.approveExit = 1;
  const clock = await start($, on, w);
  const { call } = await heldCall($, w, clock);
  const shown = await bandUi($);
  await press($, 'band-approveHeld');
  await shown.unmount();
  const confirm = await pane($, APPROVE);
  await press($, 'approve-confirm', APPROVE);
  await confirm.unmount();
  const res: any = await call;
  expect(refused(res)).toBe(true);
  expect(refusalText(res)).toMatch(/needs a person's approval/);
  const ui = await bandUi($);
  expect(await ui.find({ type: 'Text', text: /Nothing was approved/ })).toBeDefined();
  await ui.unmount();
});

test('HOLD-4 Refuse, or no answer in the hold time, lets the refusal through and the request stays', async ($, on) => {
  const w = project();
  w.refusal = webInstall;
  const clock = await start($, on, w);
  let { call } = await heldCall($, w, clock);
  const shown = await bandUi($);
  await press($, 'band-refuseHeld');
  await shown.unmount();
  let res: any = await call;
  expect(refused(res)).toBe(true);
  expect(w.bashRuns).toBe(1);
  ({ call } = await heldCall($, w, clock, 'tu-h2'));
  expect(w.holds.at(-1)).toEqual(['hold', 'tu-h2', '--minutes', '2']);
  w.waiting.get('tu-h2')?.('timed out');
  res = await call;
  expect(refused(res)).toBe(true);
  w.requests = [{ ...dayjs, names: ['dep-dayjs'] }];
  await clock.advance(60000);
  const ui = await bandUi($);
  expect(await ui.find({ type: 'Text', text: '1 approval waiting' })).toBeDefined();
  await ui.unmount();
});

const leadInstall =
  'Blocked: a new dependency (dayjs) is the lead\'s decision. The lead decides this, not the person. Hand the lead a change request and stop: the package, the story and requirement that need it, what the project already has that you checked, and anything lighter that would do. The lead approves it, or tells you what to use instead.\n  Decided by the lead: node "/x/bin/code-kit.mjs" approve dep-dayjs --lane web --delegated --story <ST-n> --reason "<what the story needs it for, what the project already has, how it fits>"\nCommand: npm install dayjs';

test("HOLD-5 and HELM-6 a lane's call the lead decides isn't held, and the mod doesn't approve it for the lead", async ($, on) => {
  const w = project();
  w.refusal = leadInstall;
  await start($, on, w);
  const res: any = await $.tool.call({
    tool: 'Bash',
    tool_use_id: 'tu-d',
    command: 'npm install dayjs',
    agentId: 'a1',
  } as any);
  expect(refused(res)).toBe(true);
  expect(w.holds).toEqual([]);
  expect(w.delegated).toEqual([]);
  const band = await bandUi($);
  expect(await band.find({ type: 'Text', text: /wants to install/ })).toBeUndefined();
  await band.unmount();
});

test("HOLD-5 a call the person decides is held for them, without trying the lead's rules", async ($, on) => {
  const w = project();
  w.refusal = webInstall;
  const clock = await start($, on, w);
  const { call } = await heldCall($, w, clock);
  expect(w.delegated).toEqual([]);
  w.waiting.get('tu-h1')?.('timed out');
  // A timed-out hold refuses the call, as the hooks did; awaited, so the test doesn't end mid-call.
  expect(refused(await call)).toBe(true);
});

test('HOLD-6 with nobody to ask, or hold off, the call is refused at once', async ($, on) => {
  const w = project();
  w.refusal = webInstall;
  await start($, on, w, false);
  const res: any = await $.tool.call({
    tool: 'Bash',
    tool_use_id: 'tu-p',
    command: 'npm install dayjs',
  } as any);
  expect(refused(res)).toBe(true);
  expect(w.holds).toEqual([]);
});

test('HOLD-6 hold.minutes 0 switches holding off', async ($, on) => {
  const w = project();
  w.refusal = webInstall;
  (w.check as any).harness = { autonomy: 'autonomous', hold: { minutes: 0 } };
  await start($, on, w);
  const res: any = await $.tool.call({
    tool: 'Bash',
    tool_use_id: 'tu-0',
    command: 'npm install dayjs',
  } as any);
  expect(refused(res)).toBe(true);
  expect(w.holds).toEqual([]);
  expect(w.delegated).toEqual([]);
});

test('HOLD-1 a refusal no approval allows (force-push) is refused at once, unheld', async ($, on) => {
  const w = project();
  w.refusal =
    'Blocked: force-pushing rewrites history others may have pulled.\nCommand: git push --force';
  await start($, on, w);
  const res: any = await $.tool.call({
    tool: 'Bash',
    tool_use_id: 'tu-f',
    command: 'git push --force',
  } as any);
  expect(refused(res)).toBe(true);
  expect(w.holds).toEqual([]);
  expect(w.delegated).toEqual([]);
});

// --- the lead loop ----------------------------------------------------------------------------------

/** One lead turn, start to end: the person's prompt, or one the loop submitted. */
async function leadTurn($: any, id = 't-1') {
  await $.turn.start({ turnId: id, text: '' } as any);
  await $.turn.complete({ turnId: id, answer: 'Done.', durationMs: 1, isAborted: false } as any);
}
/** Lets the loop's work after a turn settle. */
const settle = async (clock: any) => {
  for (let i = 0; i < 5; i++) await clock.advance(1);
};

test('LOOP-1 and LOOP-2 with the lead idle, the loop dispatches every ready story in one prompt and records it', async ($, on) => {
  const w = project();
  w.next = { step: 'dispatch', args: 'ST-9 ST-10 ST-11 ST-12', then: [] };
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  expect(w.prompts).toEqual([
    'Dispatch ST-9, ST-10, ST-11, ST-12: run /code-kit:dispatch ST-9 ST-10 ST-11 ST-12.',
  ]);
  await lanes($);
  const ui = await pane($, PANE);
  expect((await ui.find({ key: 'loop-step-0' }))?.text).toMatch(/dispatch ST-9 ST-10 ST-11 ST-12/);
  await ui.unmount();
});

test('LOOP-9 the loop never asks for a story an agent is still on: it waits, and goes on once the agent finishes', async ($, on) => {
  const w = project();
  w.next = { step: 'dispatch', args: 'ST-9', then: [] };
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  expect(w.prompts).toEqual(['Dispatch ST-9: run /code-kit:dispatch ST-9.']);
  // Dispatched, and ST-4 still being built: next (reading only branches) offers both again.
  w.agents = [
    { id: 'a1', type: 'web-engineer', status: 'running', description: 'ST-4 booking form' },
    { id: 'a2', type: 'core-engineer', status: 'running', description: 'ST-9 pricing' },
  ];
  w.next = { step: 'review', args: 'ST-4', then: [{ step: 'dispatch', args: 'ST-9' }] };
  await leadTurn($, 't-2');
  await settle(clock);
  expect(w.prompts).toHaveLength(1);
  const band = await bandUi($);
  expect(
    await band.find({ type: 'Text', text: /waiting: ST-4, ST-9 are still with their agents/ }),
  ).toBeDefined();
  await band.unmount();
  // The web agent finishes: ST-4 is reviewed; ST-9 is still being built, so it isn't dispatched again.
  w.agents = [{ ...w.agents[0], status: 'completed' }, w.agents[1]];
  await clock.advance(2000);
  await settle(clock);
  expect(w.prompts.slice(1)).toEqual(['Review ST-4: run /code-kit:review ST-4.']);
});

test('LOOP-1 nothing is submitted mid-turn, or while the person has a draft, or twice for the same step', async ($, on) => {
  const w = project();
  const clock = await start($, on, w);
  await $.turn.start({ turnId: 't-1', text: '' } as any);
  await clock.advance(4000);
  expect(w.prompts).toEqual([]);
  w.draft = 'half a thought';
  await $.turn.complete({ turnId: 't-1', answer: '', durationMs: 1, isAborted: false } as any);
  await settle(clock);
  expect(w.prompts).toEqual([]);
  w.draft = '';
  await leadTurn($, 't-2');
  await settle(clock);
  expect(w.prompts).toEqual(['Dispatch ST-9: run /code-kit:dispatch ST-9.']);
  await leadTurn($, 't-3');
  await settle(clock);
  // LOOP-13: the turn left ST-9 where it stood, so it's parked, and the next step goes instead.
  expect(w.prompts.filter((p: string) => p.startsWith('Dispatch ST-9'))).toHaveLength(1);
  expect(w.prompts.at(-1)).toMatch(/^Build ST-6, ST-7 yourself/);
});

test("LOOP-1 review and the lead's own stories are prompted with their skill", async ($, on) => {
  const w = project();
  w.next = { step: 'review', args: 'ST-4', then: [] };
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  w.next = { step: 'lead', args: 'ST-6', then: [] };
  w.refs += ' ccc refs/heads/web/st-4-moved\n';
  await leadTurn($, 't-2');
  await settle(clock);
  expect(w.prompts[0]).toBe('Review ST-4: run /code-kit:review ST-4.');
  expect(w.prompts[1]).toMatch(/^Build ST-6 yourself.*lead\/st-6/);
});

test('LOOP-8 a step the lead was asked for twice and that is still next goes to the person, while lanes keep committing', async ($, on) => {
  const w = project();
  w.next = { step: 'merge', args: 'lead/st-1', then: [] };
  const clock = await start($, on, w);
  for (const [i, turn] of ['t-1', 't-2', 't-3', 't-4'].entries()) {
    // A lane commits between the lead's turns: the project moves, but not this step.
    w.refs += ` c${i} refs/heads/core/st-${i}\n`;
    await leadTurn($, turn);
    await settle(clock);
  }
  expect(w.prompts).toHaveLength(2);
  expect(w.prompts.every((p: string) => p.startsWith('Merge lead/st-1'))).toBe(true);
  const ui = await bandUi($);
  expect(
    await ui.find({
      type: 'Text',
      text: 'Merge lead/st-1: still next after 2 prompts. Ask the lead again?',
    }),
  ).toBeDefined();
  await press($, 'band-go');
  await ui.unmount();
  expect(w.prompts).toHaveLength(3);
  // Once the step changes, the loop goes on by itself.
  w.next = { step: 'dispatch', args: 'ST-9', then: [] };
  await leadTurn($, 't-5');
  await settle(clock);
  expect(w.prompts.at(-1)).toBe('Dispatch ST-9: run /code-kit:dispatch ST-9.');
});

test('LOOP-5 under propose the band offers the step, and nothing goes until Go', async ($, on) => {
  const w = project();
  (w.check as any).harness = { autonomy: 'propose' };
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  expect(w.prompts).toEqual([]);
  const ui = await bandUi($);
  expect(await ui.find({ type: 'Text', text: 'Dispatch ST-9?' })).toBeDefined();
  await press($, 'band-go');
  await ui.unmount();
  expect(w.prompts).toEqual(['Dispatch ST-9: run /code-kit:dispatch ST-9.']);
});

test('LOOP-5 under off the loop takes no step, and the band shows no loop', async ($, on) => {
  const w = project();
  (w.check as any).harness = { autonomy: 'off' };
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  expect(w.prompts).toEqual([]);
  const ui = await bandUi($);
  expect(await ui.find({ type: 'Text', text: /loop/ })).toBeUndefined();
  await ui.unmount();
});

test('LOOP-6 Pause stops new steps until Resume', async ($, on) => {
  const w = project();
  w.next = { step: 'review', args: 'ST-4', then: [] };
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  let ui = await bandUi($);
  expect(await ui.find({ type: 'Text', text: 'loop on · last: review ST-4' })).toBeDefined();
  await press($, 'band-pause');
  await ui.unmount();
  w.next = { step: 'dispatch', args: 'ST-9', then: [] };
  await leadTurn($, 't-2');
  await settle(clock);
  expect(w.prompts).toEqual(['Review ST-4: run /code-kit:review ST-4.']);
  ui = await bandUi($);
  expect(await ui.find({ type: 'Text', text: 'loop paused' })).toBeDefined();
  await press($, 'band-resume');
  await ui.unmount();
  expect(w.prompts).toEqual([
    'Review ST-4: run /code-kit:review ST-4.',
    'Dispatch ST-9: run /code-kit:dispatch ST-9.',
  ]);
});

test('LOOP-6 the pause is recorded for other tools, and a new session starts with the loop running', async ($, on) => {
  const w = project();
  w.loopPaused = true; // left by an earlier session
  w.next = { step: 'review', args: 'ST-4', then: [] };
  const clock = await start($, on, w);
  expect(w.acts).toContainEqual(['loop', 'resume']);
  expect(w.loopPaused).toBe(false);
  await leadTurn($);
  await settle(clock);
  w.acts = [];
  let ui = await bandUi($);
  await press($, 'band-pause');
  await ui.unmount();
  expect(w.acts).toEqual([['loop', 'pause']]);
  ui = await bandUi($);
  await press($, 'band-resume');
  await ui.unmount();
  expect(w.acts).toEqual([
    ['loop', 'pause'],
    ['loop', 'resume'],
  ]);
});

// It steps the clock through tens of minutes of the mod's 2-second refresh, each tick a real round of
// stubbed CLI runs: about 1.5 to 3 seconds locally, and more on a shared CI runner.
test(
  'LOOP-3 a quiet lane agent is nudged at 5 minutes, restarted through the lead at 10, and flagged after 2 restarts',
  { timeoutMs: 30000 },
  async ($, on) => {
    const w = project();
    w.next = { step: 'wait', args: '', then: [] };
    w.agents = [
      { id: 'a1', type: 'web-engineer', description: 'ST-4 booking form', status: 'running' },
    ];
    const clock = await start($, on, w);
    // First seen at the next look (2 s), so quiet for 5 minutes a look later.
    await clock.advance(5 * 60000 + 2000);
    expect(w.sent).toEqual([
      {
        to: 'a1',
        text: 'No tool call for 5 minutes: report where you are, or carry on.',
      },
    ]);
    await lanes($);
    let ui = await pane($, PANE);
    expect((await ui.find({ key: 'lane-web' }))?.text).toMatch(/nudged/);
    await ui.unmount();
    await clock.advance(5 * 60000);
    expect(w.prompts[0]).toMatch(
      /^web-engineer \(agent a1\) on ST-4 has made no tool call for 10 minutes\. Stop it with TaskStop.*\/code-kit:dispatch ST-4$/,
    );
    ui = await pane($, PANE);
    expect((await ui.find({ key: 'lane-web' }))?.text).toMatch(/restarted 1\/2/);
    await ui.unmount();
    // The lane's agent is started again, and stalls again, twice more.
    for (const id of ['a2', 'a3']) {
      w.agents = [
        { id, type: 'web-engineer', description: 'ST-4 booking form', status: 'running' },
      ];
      await clock.advance(10 * 60000 + 2000);
    }
    expect(w.prompts).toHaveLength(2);
    const band = await bandUi($);
    expect(await band.find({ type: 'Text', text: 'web stalled 3 times on ST-4' })).toBeDefined();
    expect(await band.find({ key: 'band-resumeStall' })).toBeDefined();
    await band.unmount();
  },
);

test('LEAN-5 a lane agent past its context limit is told to wrap up, and its story goes on with a fresh agent', async ($, on) => {
  const w = project();
  w.next = { step: 'wait', args: '', then: [] };
  w.agents = [
    { id: 'a1', type: 'web-engineer', description: 'ST-4 booking form', status: 'running' },
  ];
  const clock = await start($, on, w);
  await clock.advance(2000);
  await request($, 'a1', 100);
  expect(w.sent).toEqual([]);
  // 270k of context, past the 250k limit: told once, however many requests follow.
  await request($, 'a1', 300);
  await request($, 'a1', 320);
  expect(w.sent).toHaveLength(1);
  expect(w.sent[0].text).toMatch(/^Your context is past 250k tokens/);
  await $.turn.complete({
    turnId: 't-a1',
    agentId: 'a1',
    answer: 'ST-4: committed, report written.',
    durationMs: 1,
    isAborted: false,
  } as any);
  await leadTurn($, 't-2');
  await settle(clock);
  expect(w.prompts.at(-1)).toMatch(
    /^web-engineer handed ST-4 back at its context limit, with its work committed on web\/st-4\. Carry the story on with a fresh agent: run node ".*" worktrees release web\/st-4/,
  );
  expect(w.prompts.at(-1)).toMatch(
    /Read your earlier report first: \.claude\/state\/reports\/web_st-4\.md/,
  );
});

test("LEAN-4 past compact.at the lead's context is compacted between turns, without asking", async ($, on) => {
  const w = project();
  const compacted: string[] = [];
  on('session.compact', ($: any, e: any) => {
    compacted.push(e.instructions);
    return {
      messages: [{ role: 'user', text: 'Summary: ST-4 in progress on web/st-4.', toolUses: [] }],
    };
  });
  w.contextPercent = 35;
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  expect(compacted).toEqual([]);
  w.contextPercent = 46;
  await leadTurn($, 't-2');
  await settle(clock);
  expect(compacted).toHaveLength(1);
  expect(compacted[0]).toMatch(/^The lead's context is compacted between turns/);
  expect(w.asked.filter((a) => /Compact/.test(a.question))).toEqual([]);
});

test('LOOP-3 an agent whose work is done is never nudged or restarted: it handed back, or its branch waits in the merge queue', async ($, on) => {
  const w = project();
  w.next = { step: 'wait', args: '', then: [] };
  w.agents = [
    { id: 'a1', type: 'web-engineer', description: 'ST-4 booking form', status: 'running' },
  ];
  const clock = await start($, on, w);
  await clock.advance(2000);
  // The agent hands its work back, but stays listed as running while it waits for messages.
  await $.turn.complete({
    turnId: 't-a1',
    agentId: 'a1',
    answer: 'ST-4 done.',
    durationMs: 1,
    isAborted: false,
  } as any);
  await clock.advance(11 * 60000);
  expect(w.sent).toEqual([]);
  expect(w.prompts).toEqual([]);
  // Another, whose story's branch is in the merge queue, isn't stalled either.
  w.agents = [
    { id: 'a2', type: 'web-engineer', description: 'ST-4 booking form', status: 'running' },
  ];
  w.queue = [{ branch: 'web/st-4', passed: '2026-10-11T00:00:00Z', state: 'waiting' }];
  await clock.advance(11 * 60000);
  expect(w.sent).toEqual([]);
  expect(w.prompts).toEqual([]);
});

test('LOOP-3 until the person has chosen how hands-off the loop is, a restart is offered, not taken', async ($, on) => {
  const w = project();
  (w.check as any).harnessSet = [];
  w.next = { step: 'wait', args: '', then: [] };
  w.agents = [
    { id: 'a1', type: 'web-engineer', description: 'ST-4 booking form', status: 'running' },
  ];
  const clock = await start($, on, w);
  await clock.advance(10 * 60000 + 4000);
  expect(w.prompts).toEqual([]);
  const band = await bandUi($);
  expect(await band.find({ type: 'Text', text: /Next: Restart ST-4/ })).toBeDefined();
  expect(await band.find({ key: 'band-keepGoing' })).toBeDefined();
  await band.unmount();
});

// It steps the clock through tens of minutes of the mod's 2-second refresh, each tick a real round of
// stubbed CLI runs: about 1.5 to 3 seconds locally, and more on a shared CI runner.
test(
  'LOOP-3 an agent waiting on a held call (or running a long command) is never quiet',
  { timeoutMs: 30000 },
  async ($, on) => {
    const w = project();
    w.next = { step: 'wait', args: '', then: [] };
    w.refusal = webInstall;
    (w.check as any).harness = { hold: { minutes: 10 } };
    w.agents = [{ id: 'a1', type: 'web-engineer', description: 'ST-4', status: 'running' }];
    const clock = await start($, on, w);
    const { call } = await heldCall($, w, clock);
    await clock.advance(6 * 60000);
    expect(w.sent).toEqual([]);
    w.waiting.get('tu-h1')?.('timed out');
    await call;
    // Its quiet time starts again when the call ends: nudged 5 minutes after, not at once.
    await clock.advance(2000);
    expect(w.sent).toEqual([]);
    await clock.advance(5 * 60000);
    expect(w.sent.map((m) => m.to)).toEqual(['a1']);
  },
);

test('LOOP-7 when every story is done the loop stops, and the band says so until dismissed', async ($, on) => {
  const w = project();
  w.stories = w.stories.map((s) => ({ ...s, state: 'done' }));
  w.next = { step: 'done', args: '', then: [] };
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  expect(w.prompts).toEqual([]);
  let ui = await bandUi($);
  expect(await ui.find({ type: 'Text', text: 'Milestone done: 4 stories merged' })).toBeDefined();
  await press($, 'band-dismissDone');
  await ui.unmount();
  ui = await bandUi($);
  expect(await ui.find({ type: 'Text', text: /Milestone done/ })).toBeUndefined();
  await ui.unmount();
});

/** The lead's turn, ending with what it said; `isAborted` when the person stopped it. */
async function leadSays($: any, id: string, answer: string, isAborted = false) {
  await $.turn.start({ turnId: id, text: '' } as any);
  await $.turn.complete({
    turnId: id,
    answer,
    durationMs: 1,
    isAborted,
    reason: isAborted ? 'aborted' : 'answer',
  } as any);
}
/** What the person types and sends to the lead. */
const personSays = ($: any, text: string) =>
  $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false } as any);
/** The side call's reading of the lead's reply (LOOP-11). */
const outcome = (o: any) => ({ isAnswered: true, text: JSON.stringify(o), usage: null });
const unread = { isAnswered: true, text: 'Nothing to classify.', usage: null };

test('LOOP-10 a second session opened in the project never prompts its lead; Lead from here moves the loop to it', async ($, on) => {
  const w = project();
  w.leadSession = 's-other'; // a working session already runs the loop
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  await clock.advance(4000);
  expect(w.prompts).toEqual([]);
  const ui = await bandUi($);
  expect(await ui.find({ type: 'Text', text: 'the loop runs in another session' })).toBeDefined();
  await press($, 'band-leadHere');
  await ui.unmount();
  expect(w.leadSession).toBe('s1');
  expect(w.prompts).toEqual(['Dispatch ST-9: run /code-kit:dispatch ST-9.']);
});

test("LOOP-10 a new session leaves a live lead session's pause alone", async ($, on) => {
  const w = project();
  w.loopPaused = true;
  w.leadSession = 's-other';
  await start($, on, w);
  expect(w.acts).not.toContainEqual(['loop', 'resume']);
  expect(w.loopPaused).toBe(true);
});

test('LOOP-10 the lead session renews its lease while it runs, and releases it as it ends', async ($, on) => {
  const w = project();
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  expect(w.leadSession).toBe('s1');
  const claims = w.leadClaims;
  await clock.advance(32000);
  expect(w.leadClaims).toBeGreaterThan(claims);
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: {} } as any);
  expect(w.acts).toContainEqual(['loop', 'release', '--session', 's1']);
  expect(w.leadSession).toBe(null);
});

test("LOOP-11 a reply that waits on the person holds the loop; the dialog asks the lead's question and the answer goes to the lead", async ($, on) => {
  const w = project();
  w.sideReply = unread;
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  expect(w.prompts).toEqual(['Dispatch ST-9: run /code-kit:dispatch ST-9.']);
  w.sideReply = outcome({
    outcome: 'needs-person',
    question: 'Should ST-9 show prices with GST?',
    options: [
      { label: 'Include GST', effect: 'Every price shows GST.' },
      { label: 'Exclude GST', effect: 'GST is added at checkout.' },
    ],
    reason: 'a pricing rule only the person can set',
  });
  w.next = { step: 'review', args: 'ST-4', then: [] };
  w.answer = 'Include GST';
  await leadSays($, 't-2', 'Before I dispatch ST-9: should its prices include GST?');
  await settle(clock);
  // The side call read the reply over the lead's own conversation, with the step it answered.
  // LEAN-6: read by a small model from the reply itself, not a fork over the lead's conversation.
  expect(w.sideAsks.at(-1).fork).toBeUndefined();
  expect(w.sideAsks.at(-1).model).toBe('sonnet');
  expect(w.sideAsks.at(-1).prompt).toMatch(/prompted you: "Dispatch ST-9/);
  expect(w.sideAsks.at(-1).prompt).toMatch(/should its prices include GST\?/);
  expect(w.asked.at(-1)).toEqual({
    question: 'Should ST-9 show prices with GST?',
    options: ['Include GST', 'Exclude GST'],
    header: 'the lead',
  });
  expect(w.prompts.slice(1)).toEqual([
    'The person answered what you asked ("Should ST-9 show prices with GST?"): Include GST. Carry on with it.',
  ]);
});

test('LOOP-11 dismissed, what the lead waits on stays in the band, and the loop prompts again only once the person has spoken', async ($, on) => {
  const w = project();
  w.sideReply = unread;
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  w.sideReply = outcome({
    outcome: 'needs-person',
    question: 'Which plan names should the pricing page use?',
    options: [
      { label: 'Basic and Pro', effect: 'Two plans.' },
      { label: 'Starter, Team, Business', effect: 'Three plans.' },
    ],
  });
  w.next = { step: 'review', args: 'ST-4', then: [] };
  await leadSays($, 't-2', 'Which plan names do you want on the pricing page?');
  await settle(clock);
  await clock.advance(6000);
  expect(w.prompts).toHaveLength(1);
  expect(w.asked).toHaveLength(1); // asked once, and dismissed: not asked again
  const ui = await bandUi($);
  expect(
    await ui.find({
      type: 'Text',
      text: 'The lead waits on you: Which plan names should the pricing page use?',
    }),
  ).toBeDefined();
  await ui.unmount();
  // The person answers in the chat; the lead's reply to them doesn't wait on them.
  await personSays($, 'Basic and Pro.');
  w.sideReply = outcome({ outcome: 'done' });
  await leadSays($, 't-3', 'Updated the plan names.');
  await settle(clock);
  expect(w.prompts.at(-1)).toBe('Review ST-4: run /code-kit:review ST-4.');
});

test("LEAN-3 when a milestone finishes, the person is asked to compact the lead's context first, and the loop goes on after", async ($, on) => {
  const w = project();
  w.stories = [
    {
      id: 'ST-1',
      title: 'Foundations',
      lane: 'web',
      state: 'in review',
      branch: 'web/st-1',
      milestone: 'M0',
      waitingOn: [],
    },
    ...w.stories.map((s) => ({ ...s, milestone: 'M1' })),
  ];
  const compacted: string[] = [];
  // Under compact.at (40%), so only the milestone brings the question.
  w.contextPercent = 30;
  on('session.compact', ($: any, e: any) => {
    compacted.push(e.instructions);
    // A compaction leaves the summary in the conversation's place.
    return {
      messages: [
        { role: 'user', text: 'Summary: M0 done; ST-4 in progress on web/st-4.', toolUses: [] },
      ],
    };
  });
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  expect(compacted).toEqual([]);
  const prompted = w.prompts.length;
  // ST-1 merges: M0 is done, and the next turn's end asks before the loop's next step.
  w.stories[0] = { ...w.stories[0], state: 'done' };
  w.refs += ' m1 refs/heads/main-moved\n';
  await clock.advance(2000);
  w.answer = 'Compact now';
  w.contextPercent = 62;
  await leadTurn($, 't-2');
  await settle(clock);
  expect(w.asked.at(-1)?.question).toMatch(
    /^M0 is done, and the lead's context is 62% full\. Compact it/,
  );
  expect(w.asked.at(-1)?.options).toEqual(['Compact now', 'Not now']);
  expect(compacted).toHaveLength(1);
  expect(compacted[0]).toMatch(/^M0 is done/);
  expect(compacted[0]).toMatch(/every story in flight now/);
  // The loop's step follows the compaction.
  expect(w.prompts.length).toBeGreaterThan(prompted);
  // The same milestone isn't offered twice, and a context below the floor isn't worth compacting.
  w.contextPercent = 10;
  await leadTurn($, 't-3');
  await settle(clock);
  expect(compacted).toHaveLength(1);
});

test("LOOP-13 a review the lead's turn didn't move isn't prompted again while other lanes commit, whatever the reply reads as", async ($, on) => {
  const w = project();
  w.stories.push({
    id: 'ST-160',
    title: 'Content security policy',
    lane: 'web',
    state: 'in review',
    branch: 'web/st-160',
    waitingOn: [],
  });
  w.refs += ' p1 refs/heads/web/st-160\n';
  w.next = { step: 'review', args: 'ST-160', then: [] };
  w.sideReply = unread;
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  expect(w.prompts).toEqual(['Review ST-160: run /code-kit:review ST-160.']);
  // The lead says it waits, the reading comes back done, and lanes keep committing.
  w.sideReply = outcome({ outcome: 'done' });
  for (const [i, turn] of ['t-2', 't-3', 't-4', 't-5'].entries()) {
    w.refs += ` x${i} refs/heads/core/st-${i}\n`;
    await leadSays($, turn, 'ST-160 waits on ST-165; nothing to review yet.');
    await settle(clock);
    w.sideReply = unread;
  }
  expect(w.prompts).toHaveLength(1);
  // Its own branch moves: it's prompted again.
  w.refs = w.refs.replace(' p1 refs/heads/web/st-160', ' p2 refs/heads/web/st-160');
  await leadTurn($, 't-6');
  await settle(clock);
  expect(w.prompts).toHaveLength(2);
});

test('LOOP-13 stories the lead says wait on other work are parked, each until what it waits on moves', async ($, on) => {
  const w = project();
  w.stories.push(
    {
      id: 'ST-158',
      title: 'Storage',
      lane: 'web',
      state: 'in review',
      branch: 'web/st-158',
      waitingOn: [],
    },
    {
      id: 'ST-164',
      title: 'Callers use the storage',
      lane: 'api',
      state: 'in progress',
      branch: 'api/st-164',
      dependsOn: ['ST-158'],
      waitingOn: [],
    },
    {
      id: 'ST-172',
      title: 'Silent tests',
      lane: 'core',
      state: 'in review',
      branch: 'core/st-172',
      waitingOn: [],
    },
    {
      id: 'ST-173',
      title: 'Verdicts',
      lane: 'lead',
      state: 'in review',
      branch: 'lead/st-173',
      waitingOn: [],
    },
  );
  w.refs += ' s1 refs/heads/web/st-158\n s2 refs/heads/api/st-164\n s3 refs/heads/core/st-172\n';
  w.next = { step: 'review', args: 'ST-158 ST-172', then: [] };
  w.sideReply = unread;
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  expect(w.prompts.at(-1)).toBe('Review ST-158, ST-172: run /code-kit:review.');
  // The lead says neither is due yet; next then names a third story as well.
  w.sideReply = outcome({
    outcome: 'waiting',
    waits: [
      { story: 'ST-158', on: [], why: 'it merges with its paired branch' },
      { story: 'ST-172', on: [], why: 'its merge checks are re-running' },
    ],
  });
  w.next = { step: 'review', args: 'ST-158 ST-172 ST-173', then: [] };
  await leadSays(
    $,
    't-2',
    'None of these is due: ST-158 merges with ST-164; ST-172 re-runs its checks.',
  );
  await settle(clock);
  // Only the story that isn't waiting is asked for.
  expect(w.prompts.at(-1)).toBe('Review ST-173: run /code-kit:review ST-173.');
  const asked = w.prompts.length;
  // Lanes committing elsewhere don't wake them, and nothing is prompted while both still wait.
  w.sideReply = unread;
  w.next = { step: 'review', args: 'ST-158 ST-172', then: [] };
  w.refs += ' x1 refs/heads/core/st-9\n';
  await leadTurn($, 't-3');
  await settle(clock);
  expect(w.prompts).toHaveLength(asked);
  // The story building on ST-158 commits: that alone doesn't wake it.
  w.refs = w.refs.replace(' s2 refs/heads/api/st-164', ' s9 refs/heads/api/st-164');
  await leadTurn($, 't-4');
  await settle(clock);
  expect(w.prompts).toHaveLength(asked);
  // It finishes: ST-158 wakes, and ST-172 still waits.
  w.stories = w.stories.map((s: any) => (s.id === 'ST-164' ? { ...s, state: 'in review' } : s));
  w.refs += ' s10 refs/heads/api/st-164-done\n';
  await clock.advance(2000);
  await leadTurn($, 't-5');
  await settle(clock);
  expect(w.prompts.at(-1)).toBe('Review ST-158: run /code-kit:review ST-158.');
  expect(w.prompts).toHaveLength(asked + 1);
});

test('LOOP-11 a turn the person stopped holds the loop, with no dialog, until they speak or press Carry on', async ($, on) => {
  const w = project();
  w.sideReply = unread;
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  w.next = { step: 'review', args: 'ST-4', then: [] };
  await leadSays($, 't-2', '', true);
  await settle(clock);
  await clock.advance(4000);
  expect(w.prompts).toHaveLength(1);
  expect(w.asked).toEqual([]);
  const ui = await bandUi($);
  expect(
    await ui.find({ type: 'Text', text: "You stopped the lead's turn: the loop waits for you" }),
  ).toBeDefined();
  await press($, 'band-carryOn');
  await ui.unmount();
  expect(w.prompts.at(-1)).toBe('Review ST-4: run /code-kit:review ST-4.');
});

test("LOOP-11 a step the lead didn't take waits with its reason; Ask again prompts it, and a new step goes on", async ($, on) => {
  const w = project();
  w.next = { step: 'merge', args: 'lead/st-1', then: [] };
  w.sideReply = unread;
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  expect(w.prompts).toHaveLength(1);
  w.sideReply = outcome({
    outcome: 'blocked',
    reason: 'main has a failing check that lead/st-1 does not touch',
  });
  w.refs += ' c1 refs/heads/core/st-1\n';
  await leadSays($, 't-2', "I can't merge lead/st-1 while main's checks fail.");
  await settle(clock);
  // The person's own turn, and lanes committing, don't make the step worth prompting again.
  w.sideReply = unread;
  w.refs += ' c2 refs/heads/core/st-2\n';
  await leadTurn($, 't-3');
  await settle(clock);
  expect(w.prompts).toHaveLength(1);
  expect(w.asked.at(-1)?.options).toEqual(['Ask again', 'Not now']);
  expect(w.asked.at(-1)?.question).toMatch(/the lead didn't take it.*Ask the lead again\?$/);
  const ui = await bandUi($);
  expect(
    await ui.find({
      type: 'Text',
      text: "Merge lead/st-1: the lead didn't take it: main has a failing check that lead/st-1 does not touch",
    }),
  ).toBeDefined();
  await press($, 'band-askAgain');
  await ui.unmount();
  expect(w.prompts).toHaveLength(2);
  expect(w.prompts[1]).toMatch(/^Merge lead\/st-1/);
  // A new step isn't held by the old one.
  w.sideReply = outcome({ outcome: 'blocked', reason: 'still failing' });
  await leadSays($, 't-4', 'Still failing.');
  await settle(clock);
  w.next = { step: 'dispatch', args: 'ST-9', then: [] };
  w.sideReply = unread;
  await leadTurn($, 't-5');
  await settle(clock);
  expect(w.prompts.at(-1)).toBe('Dispatch ST-9: run /code-kit:dispatch ST-9.');
});

test('LOOP-12 a design story is handed to the lead once; the loop leaves designing it to the person and the lead', async ($, on) => {
  const w = project();
  w.next = { step: 'design', args: 'ST-21 ST-22', then: [] };
  w.sideReply = unread;
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  expect(w.prompts).toEqual([
    'Design ST-21, ST-22 before any of their screens are built: run /code-kit:design ST-21 ST-22.',
  ]);
  // The person and the lead go back and forth; ST-21's approved design changes the project.
  for (const turn of ['t-2', 't-3']) {
    await personSays($, 'Make the header calmer.');
    w.refs += ` ${turn} refs/heads/design/${turn}\n`;
    await leadTurn($, turn);
    await settle(clock);
  }
  expect(w.prompts.filter((p: string) => p.startsWith('Design'))).toHaveLength(1);
  const ui = await bandUi($);
  expect(
    await ui.find({
      type: 'Text',
      text: "Design ST-21, ST-22: with you and the lead, so the loop doesn't prompt it again",
    }),
  ).toBeDefined();
  await ui.unmount();
  // A design story not handed over yet is.
  w.next = { step: 'design', args: 'ST-22 ST-30', then: [] };
  await leadTurn($, 't-4');
  await settle(clock);
  expect(w.prompts.at(-1)).toBe(
    'Design ST-22, ST-30 before any of their screens are built: run /code-kit:design ST-22 ST-30.',
  );
});

test("DECIDE-4 the loop's first offer is asked in Claude Code's own dialog; Keep going records it and takes the step", async ($, on) => {
  const w = project();
  (w.check as any).harnessSet = [];
  w.sideReply = unread;
  w.answer = 'Keep going';
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  expect(w.asked[0].options).toEqual(['Keep going', 'Ask each time', 'Off']);
  expect(w.asked[0].question).toMatch(
    /^code-kit can keep the build moving between your prompts\. Next: Dispatch ST-9\. How much should it do on its own\?$/,
  );
  expect(w.acts.some((a) => a.join(' ').startsWith('settings set autonomy autonomous'))).toBe(true);
  expect(w.prompts).toEqual(['Dispatch ST-9: run /code-kit:dispatch ST-9.']);
});

test("DECIDE-4 the lead's question is asked in the dialog: an option answers it, and a dismissed one isn't asked again", async ($, on) => {
  const w = project();
  w.questions = [question()];
  w.next = { step: 'wait', args: '', then: [] };
  const clock = await start($, on, w);
  await clock.advance(4000);
  expect(w.asked).toHaveLength(1);
  expect(w.asked[0]).toEqual({
    question: 'Which weather provider: the Bureau of Meteorology or a commercial service?',
    options: ['Bureau of Meteorology', 'Commercial'],
    header: 'question',
  });
  await clock.advance(6000);
  expect(w.asked).toHaveLength(1);
  const ui = await bandUi($);
  expect(
    await ui.find({ type: 'Text', text: /^The lead asks: Which weather provider/ }),
  ).toBeDefined();
  await ui.unmount();
});

test("DECIDE-4 an option chosen in the dialog, or the person's own words typed there, answer the lead's question", async ($, on) => {
  const w = project();
  w.questions = [question()];
  w.next = { step: 'wait', args: '', then: [] };
  w.typed = 'Both, the Bureau first';
  const clock = await start($, on, w);
  await clock.advance(4000);
  expect(w.acts).toContainEqual([
    'ask',
    'answer',
    'Q-1',
    'Both, the Bureau first',
    '--via',
    'pane',
  ]);
  expect(w.prompts.at(-1)).toMatch(
    /^The person answered Q-1 .*: Both, the Bureau first\. ST-4 no longer waits/,
  );
});

test('DECIDE-4 nothing is asked in a session another one runs the loop for', async ($, on) => {
  const w = project();
  w.leadSession = 's-other';
  w.questions = [question()];
  w.next = { step: 'wait', args: '', then: [] };
  const clock = await start($, on, w);
  await clock.advance(6000);
  expect(w.asked).toEqual([]);
});

// --- the lane agents' model (SET-4) ---------------------------------------------------------------

const dispatch = ($: any, subagentType: string, model?: string) =>
  $.agent.spawn({
    prompt: 'ST-9 pricing',
    description: 'ST-9 pricing',
    subagentType,
    ...(model ? { model } : {}),
  });

test("SET-4 a lane agent starts on the lane model set; the lead's own choice, an agent file's model and other agents are left alone", async ($, on) => {
  const w = project();
  (w.check as any).harness = { agents: { lanes: { model: 'sonnet' } } };
  w.agentFiles['/work/.claude/agents/web-engineer.md'] =
    '---\nname: web-engineer\nmodel: opus\n---\nYou are the web engineer.\n';
  w.agentFiles['/work/.claude/agents/api-engineer.md'] =
    '---\nname: api-engineer\nmodel: inherit\n---\n';
  await start($, on, w);
  await dispatch($, 'core-engineer');
  await dispatch($, 'api-engineer');
  await dispatch($, 'core-engineer', 'haiku');
  await dispatch($, 'web-engineer');
  await dispatch($, 'general-purpose');
  expect(w.spawned.map((e) => [e.subagentType, e.model ?? null])).toEqual([
    ['core-engineer', 'sonnet'],
    ['api-engineer', 'sonnet'],
    ['core-engineer', 'haiku'],
    ['web-engineer', null],
    ['general-purpose', null],
  ]);
});

test('SET-4 with no lane model set, lane agents start as Claude Code decides', async ($, on) => {
  const w = project();
  await start($, on, w);
  await dispatch($, 'core-engineer');
  expect(w.spawned[0].model ?? null).toBe(null);
});

test("LEAN-7 the security reviewer starts on the reviewers' model, Sonnet unless set, and its own file's model wins", async ($, on) => {
  const w = project();
  await start($, on, w);
  await dispatch($, 'security-reviewer');
  await dispatch($, 'security-reviewer', 'opus');
  w.agentFiles['/work/.claude/agents/security-reviewer.md'] =
    '---\nname: security-reviewer\nmodel: opus\n---\n';
  await dispatch($, 'security-reviewer');
  expect(w.spawned.map((e) => e.model ?? null)).toEqual(['sonnet', 'opus', null]);
});

// --- the reviewer -----------------------------------------------------------------------------------

/** ST-4 finished on web/st-4, the reviewer on. */
function reviewing() {
  const w = project();
  w.stories[0] = { ...w.stories[0], state: 'review', requirements: ['BOOK-1'] };
  w.next = { step: 'review', args: 'ST-4', then: [] };
  (w.check as any).harness = { agents: { reviewer: { on: true } } };
  return w;
}
const report = (json: object) =>
  'Reviewed web/st-4.\n\n\`\`\`json\n' + JSON.stringify(json) + '\n\`\`\`\n';

test('REVW-1 with the reviewer on, a finished branch has the lead start one in the background, and the pane shows it running', async ($, on) => {
  const w = reviewing();
  const clock = await start($, on, w);
  expect(w.registered[0]).toMatchObject({
    name: 'reviewer',
    tools: ['Read', 'Grep', 'Glob', 'Bash'],
  });
  await leadTurn($);
  await settle(clock);
  expect(w.prompts[0]).toMatch(
    /^Start code-kit's reviewer in the background for web\/st-4: use the Agent tool with subagent_type "code-kit:reviewer", run_in_background true, description "Review web\/st-4 \(ST-4\)".*at abc123def456 for ST-4 Booking form \(requirements BOOK-1\)/,
  );
  await clock.advance(3 * 60000);
  await lanes($);
  const ui = await pane($, PANE);
  expect((await ui.find({ key: 'review-web/st-4' }))?.text).toMatch(/running 3m/);
  await ui.unmount();
  // While it runs, the lead isn't asked to review.
  await leadTurn($, 't-2');
  await settle(clock);
  expect(w.prompts).toHaveLength(1);
});

test("REVW-3 and REVW-4 the reviewer's findings, a failed verify as a blocker, go into the lead's review", async ($, on) => {
  const w = reviewing();
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  w.agents = [
    {
      id: 'r1',
      type: 'code-kit:reviewer',
      description: 'Review web/st-4 (ST-4)',
      status: 'completed',
    },
  ];
  await $.turn.complete({
    turnId: 't-r1',
    agentId: 'r1',
    answer: report({
      verify: { passed: false, problems: ['apps/api/x.ts is outside the web lane'] },
      findings: [{ severity: 'nit', where: 'apps/web/form.tsx:3', text: 'Unused import.' }],
    }),
    durationMs: 1,
    isAborted: false,
  } as any);
  await leadTurn($, 't-2');
  await settle(clock);
  expect(w.prompts[1]).toBe(
    [
      "Review ST-4: run /code-kit:review ST-4. code-kit's reviewer found 1 blocker, 1 nit on web/st-4 at abc123def456:",
      '- blocker: verify: apps/api/x.ts is outside the web lane (code-kit verify)',
      '- nit apps/web/form.tsx:3: Unused import.',
      'A blocker means you send the branch back. Concerns and nits are yours to weigh.',
    ].join('\n'),
  );
  await lanes($);
  const ui = await pane($, PANE);
  expect((await ui.find({ key: 'review-web/st-4' }))?.text).toMatch(/done · 1 blocker, 1 nit/);
  await ui.unmount();
});

test("REVW-1 a reviewer that hasn't reported in 15 minutes is passed over: the lead reviews without it", async ($, on) => {
  const w = reviewing();
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  await clock.advance(15 * 60000 + 2000);
  await leadTurn($, 't-2');
  await settle(clock);
  expect(w.prompts[1]).toMatch(/didn't report: no report within 15 minutes\. Review it yourself/);
});

test('REVW-1 a branch that moves gets a new review', async ($, on) => {
  const w = reviewing();
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  w.heads['web/st-4'] = 'fff000111222333\n';
  await leadTurn($, 't-2');
  await settle(clock);
  expect(w.prompts[1]).toMatch(/^Start code-kit's reviewer.*at fff000111222/);
});

test('USE-4 past the pause point no reviewer starts: the review is skipped and the lead reviews alone', async ($, on) => {
  const w = reviewing();
  w.limits = [{ kind: 'five_hour', percentUsed: 81 }];
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  expect(w.prompts).toEqual([
    'Review ST-4: run /code-kit:review ST-4. (No background review: background agents paused, the plan at 81%.)',
  ]);
  await lanes($);
  const ui = await pane($, PANE);
  expect((await ui.find({ key: 'review-web/st-4' }))?.text).toMatch(
    /skipped: background agents paused/,
  );
  await ui.unmount();
});

test("REVW-2 the reviewer's model is the setting's, registered again when it changes", async ($, on) => {
  const w = reviewing();
  (w.check as any).harness = { agents: { reviewer: { on: true, model: 'haiku' } } };
  await start($, on, w);
  expect(w.registered.at(-1)).toMatchObject({ name: 'reviewer', model: 'haiku' });
  expect(w.registered.at(-1).tools).not.toContain('Write');
});

// --- the merge queue --------------------------------------------------------------------------------

// --- the code map and the trail -----------------------------------------------------------------

const storyMap = () => ({
  story: { id: 'ST-4', title: 'Booking form', lane: 'web', state: 'in progress' },
  layers: ['domain', 'services', 'tests'],
  files: [
    {
      path: 'apps/web/domain/booking.ts',
      layer: 'domain',
      lane: 'web',
      imports: [],
      adapters: {
        'context-graph': { card: { state: 'current', text: 'A booking and its rules.' } },
      },
    },
    {
      path: 'apps/web/services/book.ts',
      layer: 'services',
      lane: 'web',
      imports: ['apps/web/domain/booking.ts'],
      adapters: { 'context-graph': { card: { state: 'stale', text: 'Books a slot.' } } },
    },
    {
      path: 'apps/web/e2e/book.spec.ts',
      layer: 'tests',
      lane: 'web',
      imports: ['apps/web/services/book.ts'],
      adapters: { 'context-graph': { card: { state: 'missing', text: '' } } },
    },
  ],
  open: { command: 'graph' },
});

test("MAP-1 the Code map shows the selected lane's story by layer, its imports, and the selected file's card", async ($, on) => {
  const w = project();
  w.map = storyMap();
  const clock = await start($, on, w);
  await lanes($);
  const ui = await pane($, PANE);
  await press($, 'tab-code', PANE);
  await clock.advance(1);
  expect((await ui.find({ key: 'map-story-ST-4' }))?.props.variant).toBe('primary');
  const drawn = (await ui.find({ key: 'code-map' }))?.text ?? '';
  for (const name of [
    'domain',
    'services',
    'tests',
    'booking.ts',
    'book.ts',
    'book.spec.ts',
    '✓ why written',
    'why out of date',
    'no why yet',
  ])
    expect(drawn).toContain(name);
  // An import between neighbouring layers is drawn as a line.
  expect(drawn).toMatch(/[─┐┘└┌]/);
  expect((await ui.find({ key: 'code-file' }))?.text).toMatch(
    /apps\/web\/domain\/booking.ts.*A booking and its rules\..*imported by book.ts/s,
  );
  await press($, 'code-next', PANE);
  expect((await ui.find({ key: 'code-file' }))?.text).toMatch(
    /book.ts.*Books a slot\..*changed since its why was written.*imports booking.ts.*imported by book.spec.ts/s,
  );
  await press($, 'code-open', PANE);
  expect(w.commands).toContainEqual({ command: 'graph', args: 'apps/web/services/book.ts' });
  await ui.unmount();
});

test('MAP-2 a file a lane reads or edits glows in the code map, in the lane, and stops after a while', async ($, on) => {
  const w = project();
  w.map = storyMap();
  w.agents = [{ id: 'a1', type: 'web-engineer', description: 'ST-4', status: 'running' }];
  const clock = await start($, on, w);
  await lanes($);
  const ui = await pane($, PANE);
  await press($, 'tab-code', PANE);
  await $.tool.call({ tool: 'Bash', tool_use_id: 'tu-w', command: 'ls', agentId: 'a1' } as any);
  await clock.advance(2000);
  await $.tool
    .call({
      tool: 'Read',
      tool_use_id: 'tu-r',
      file_path: '/repo/.claude/worktrees/agent-a1/apps/web/services/book.ts',
      agentId: 'a1',
    } as any)
    .catch(() => {});
  await clock.advance(1);
  expect((await ui.find({ key: 'code-map' }))?.text).toContain('web reading');
  // The box fills with the lane's colour, the status written over it.
  const filled = (await ui.findAll({ type: 'Text' })).find((t: any) => /web reading/.test(t.text));
  expect(filled?.props.backgroundColor).toMatch(/^#[0-9a-f]{6}$/);
  expect(await ui.find({ key: 'code-legend' })).toBeDefined();
  await clock.advance(30000);
  expect((await ui.find({ key: 'code-map' }))?.text).not.toContain('web reading');
  await ui.unmount();
});

test('TRAIL-1 the Trail tab follows each requirement of the spec to its stories, code and tests, with gaps in red', async ($, on) => {
  const w = project();
  w.requirements = [
    {
      id: 'BOOK-1',
      title: 'Request',
      file: 'docs/specs/01-booking.md',
      state: 'in progress',
      stories: ['ST-4'],
      tests: ['apps/web/e2e/book.spec.ts'],
    },
    {
      id: 'BOOK-2',
      title: 'Cancel',
      file: 'docs/specs/01-booking.md',
      state: 'no story',
      stories: [],
      tests: [],
    },
  ];
  w.trail = {
    base: 'main',
    requirements: [
      {
        id: 'BOOK-1',
        title: 'Request',
        spec: '01-booking.md',
        state: 'in progress',
        stories: [{ id: 'ST-4', state: 'in progress', lane: 'web' }],
        files: ['apps/web/services/book.ts'],
        tests: ['apps/web/e2e/book.spec.ts'],
      },
      {
        id: 'BOOK-2',
        title: 'Cancel',
        spec: '01-booking.md',
        state: 'no story',
        stories: [],
        files: [],
        tests: [],
      },
    ],
  };
  const clock = await start($, on, w);
  await lanes($);
  const ui = await pane($, PANE);
  await press($, 'tab-map', PANE);
  await clock.advance(1);
  expect((await ui.find({ key: 'trail-BOOK-1' }))?.text).toMatch(
    /BOOK-1\s*Request\s*─+\s*● ST-4\s*─+\s*1 file\s*─+\s*✓ book\.spec\.ts/,
  );
  const gap = await ui.find({ key: 'trail-BOOK-2' });
  expect(gap?.text).toMatch(/BOOK-2.*╌+\s*no story.*╌+\s*no code.*╌+\s*no test names it/);
  expect((await ui.find({ key: 'map-files' }))?.text).toMatch(/book.ts/);
  await ui.unmount();
});

test('MQ-2 where the lead merges, the loop prompts it to merge the head of the queue', async ($, on) => {
  const w = project();
  w.next = { step: 'merge', args: 'web/st-4', then: [] };
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  expect(w.prompts[0]).toMatch(
    /^Merge web\/st-4, next in the merge queue: run node ".*\/bin\/code-kit\.mjs" queue merge --delegated\./,
  );
});

test('MQ-2 where the person merges, the head of the queue waits in the band for their Merge', async ($, on) => {
  const w = project();
  w.queue = [{ branch: 'web/st-4', passed: '2026-10-10T00:00:00Z', state: 'waiting' }];
  await start($, on, w);
  const ui = await bandUi($);
  expect(await ui.find({ type: 'Text', text: 'web/st-4 is next to merge' })).toBeDefined();
  await press($, 'band-mergeQueue');
  await ui.unmount();
  expect(w.acts).toEqual([['queue', 'merge', '--person']]);
  expect(w.opened).toContain(RESULT);
});

test("SETUP-2 with no rules on the base yet, the lead puts them there under autonomy: the band doesn't ask the person to merge", async ($, on) => {
  const w = project();
  (w.check as any).firstMerge = true;
  w.queue = [{ branch: 'lead/st-1', passed: '2026-10-10T00:00:00Z', state: 'waiting' }];
  w.next = { step: 'rules', args: 'main', then: [] };
  await start($, on, w);
  const ui = await bandUi($);
  expect(await ui.find({ type: 'Text', text: /next to merge/ })).toBeUndefined();
  await ui.unmount();
});

test("SETUP-2 with the loop off, the merge is the person's, and its card says how the rules get onto main", async ($, on) => {
  const w = project();
  (w.check as any).firstMerge = true;
  (w.check as any).harness = { autonomy: 'off' };
  w.queue = [{ branch: 'lead/st-1', passed: '2026-10-10T00:00:00Z', state: 'waiting' }];
  await start($, on, w);
  const band = await bandUi($);
  expect(await band.find({ type: 'Text', text: 'lead/st-1 is next to merge' })).toBeDefined();
  await press($, 'band-decide');
  await band.unmount();
  const ui = await pane($, PANE);
  expect((await ui.find({ key: 'decision-card' }))?.text).toMatch(
    /code-kit queue rules puts them there/,
  );
  await ui.unmount();
});

test('MQ-2 where the lead merges under autonomy, the band offers no Merge', async ($, on) => {
  const w = project();
  (w.check as any).delegatesMerge = true;
  w.queue = [{ branch: 'web/st-4', passed: '2026-10-10T00:00:00Z', state: 'waiting' }];
  await start($, on, w);
  const ui = await bandUi($);
  expect(await ui.find({ type: 'Text', text: /next to merge/ })).toBeUndefined();
  await ui.unmount();
});

test('MQ-4 the pane shows the queue in order, what it merged and sent back, and the lane as queued', async ($, on) => {
  const w = project();
  w.stories[0] = { ...w.stories[0], state: 'review' };
  w.queue = [
    { branch: 'api/st-2', passed: '2026-10-10T00:00:00Z', state: 'merged' },
    {
      branch: 'api/st-3',
      passed: '2026-10-10T00:01:00Z',
      state: 'sent back',
      reason: 'conflicts with main after api/st-2',
    },
    { branch: 'web/st-4', passed: '2026-10-10T00:02:00Z', state: 'waiting' },
  ];
  await start($, on, w);
  await lanes($);
  const ui = await pane($, PANE);
  expect((await ui.find({ key: 'lane-web' }))?.text).toMatch(/queued/);
  await press($, 'tab-queue', PANE);
  expect((await ui.find({ key: 'queue-web/st-4-waiting' }))?.text).toMatch(
    /1\.\s*web\/st-4\s*waiting/,
  );
  expect((await ui.find({ key: 'queue-api/st-3-sent back' }))?.text).toMatch(
    /conflicts with main after api\/st-2/,
  );
  await ui.unmount();
});

// --- panes v2 ---------------------------------------------------------------------------------------

const inlinePane = ($: any) =>
  $.ui.mount({
    plugin: 'code-kit',
    component: 'Pane',
    requestId: PANE,
    surface: 'terminal',
    viewport: { columns: 90, rows: 30 },
    props: { title: PANE, isFocused: true, bodyColumns: 80, placement: 'inline' },
  });

test('VIEW-1 the header counts the stories by state, and a count filters the lanes', async ($, on) => {
  const w = project();
  w.stories = [
    { id: 'ST-1', title: 'Done', lane: 'api', state: 'done', branch: 'api/st-1', waitingOn: [] },
    ...w.stories,
  ];
  w.limits = [{ kind: 'five_hour', percentUsed: 40 }];
  await start($, on, w);
  await lanes($);
  const ui = await pane($, PANE);
  expect((await ui.find({ key: 'count-building' }))?.props.label).toBe('● 1 building');
  expect((await ui.find({ key: 'count-ready' }))?.props.label).toBe('○ 3 ready');
  expect((await ui.find({ key: 'count-merged' }))?.props.label).toBe('✓ 1 merged');
  expect(await ui.find({ type: 'Text', text: 'plan 40%' })).toBeDefined();
  await press($, 'count-building', PANE);
  expect(await ui.find({ key: 'lane-web' })).toBeDefined();
  expect(await ui.find({ key: 'lane-api' })).toBeUndefined();
  await press($, 'count-building', PANE);
  expect(await ui.find({ key: 'lane-api' })).toBeDefined();
  await ui.unmount();
});

test('MISSION-1 the band shows the goal, what the lead is doing, the next step and each agent at work', async ($, on) => {
  const w = project();
  w.stories = w.stories.map((x: any) => ({ ...x, milestone: 'Milestone 2: Bookings' }));
  w.stories[0] = { ...w.stories[0], state: 'done' };
  w.next = { step: 'review', args: 'ST-9', then: [{ step: 'dispatch', args: 'ST-10' }] };
  w.agents = [{ id: 'a1', type: 'web-engineer', description: 'ST-4', status: 'running' }];
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  await $.tool.call({
    tool: 'Bash',
    tool_use_id: 'tu-m',
    command: 'npm run test:e2e',
    agentId: 'a1',
  } as any);
  await $.turn.start({ turnId: 't-busy', text: '' } as any);
  await clock.advance(3000);
  const ui = await bandUi($);
  const rows = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text);
  expect(rows).toContain('Milestone 2: Bookings · 1 of 4 stories done');
  expect(rows.some((t: string) => /^lead at work · loop on · last: review ST-9$/.test(t))).toBe(
    true,
  );
  expect(rows).toContain('Review ST-9, then Dispatch ST-10');
  expect(rows).toContain('web     ');
  expect(rows).toContain('Bash npm run test:e2e');
  expect(await ui.find({ key: 'band-pause' })).toBeDefined();
  await ui.unmount();
});

test('MISSION-1 with nothing happening the band has no mission rows', async ($, on) => {
  const w = project();
  w.next = { step: 'wait', args: '', then: [] };
  await start($, on, w);
  const ui = await bandUi($);
  const rows = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text);
  expect(rows.some((t: string) => /^(goal|now|next) +$/.test(t))).toBe(false);
  await ui.unmount();
});

test("VIEW-4 each lane shows its agent's last tool call and the time since, amber once quiet", async ($, on) => {
  const w = project();
  w.next = { step: 'wait', args: '', then: [] };
  w.agents = [{ id: 'a1', type: 'web-engineer', description: 'ST-4', status: 'running' }];
  const clock = await start($, on, w);
  await $.tool.call({
    tool: 'Bash',
    tool_use_id: 'tu-l',
    command: 'npm test',
    agentId: 'a1',
  } as any);
  await clock.advance(12000);
  await lanes($);
  let ui = await pane($, PANE);
  const live = await ui.find({ type: 'Text', text: /^Bash npm test · / });
  expect(live?.text).toBe('Bash npm test · 12s ago');
  expect(live?.props.color).toBeUndefined();
  await ui.unmount();
  await clock.advance(5 * 60000);
  ui = await pane($, PANE);
  expect((await ui.find({ type: 'Text', text: /^Bash npm test · 5m ago$/ }))?.props.color).toBe(
    'yellow',
  );
  await ui.unmount();
});

test('VIEW-5 what needs the person is pinned at the top with its letter: a held install, a on Approve', async ($, on) => {
  const w = project();
  w.refusal = webInstall;
  const clock = await start($, on, w);
  const { call } = await heldCall($, w, clock);
  await lanes($);
  const ui = await pane($, PANE);
  expect((await ui.find({ key: 'need-held' }))?.text).toMatch(
    /web wants to install dayjs · 2:00for ST-4 Booking form/,
  );
  expect((await ui.find({ key: 'need-approveHeld' }))?.props.hotkey).toBe('a');
  await press($, 'need-approveHeld', PANE);
  expect(w.opened).toContain(APPROVE);
  await ui.unmount();
  w.waiting.get('tu-h1')?.('timed out');
  // A timed-out hold refuses the call, as the hooks did; awaited, so the test doesn't end mid-call.
  expect(refused(await call)).toBe(true);
});

test('VIEW-6 tabs on 1 to 7, j and k move between lanes, and the selected lane has its keys', async ($, on) => {
  const w = project();
  w.agents = [{ id: 'a1', type: 'web-engineer', description: 'ST-4', status: 'running' }];
  await start($, on, w);
  await lanes($);
  const ui = await pane($, PANE);
  expect((await ui.find({ key: 'tab-queue' }))?.props.hotkey).toBe('6');
  expect((await ui.find({ key: 'tab-code' }))?.props.hotkey).toBe('4');
  await press($, 'tab-queue', PANE);
  expect(await ui.find({ type: 'Text', text: 'The merge queue is empty.' })).toBeDefined();
  await press($, 'tab-lanes', PANE);
  expect((await ui.find({ key: 'lane-next' }))?.props.hotkey).toBe('j');
  await press($, 'lane-next', PANE);
  await press($, 'lane-next', PANE);
  expect((await ui.find({ key: 'lane-web' }))?.text).toMatch(/^›/);
  // WATCH-1: w puts the lane agent's transcript in the main view.
  expect((await ui.find({ key: 'act-watch' }))?.props.hotkey).toBe('w');
  await press($, 'act-watch', PANE);
  expect(w.viewed).toEqual(['a1']);
  expect((await ui.find({ key: 'act-nudge' }))?.props.hotkey).toBe('n');
  await press($, 'act-nudge', PANE);
  expect(w.sent).toEqual([
    { to: 'a1', text: 'The person asks: report where you are, or carry on.' },
  ]);
  w.answer = 'Stop';
  await press($, 'act-stop', PANE);
  expect(w.prompts.at(-1)).toMatch(
    /^The person asked to stop web-engineer \(agent a1\) on ST-4: stop it with TaskStop/,
  );
  await press($, 'lane-prev', PANE);
  expect((await ui.find({ key: 'lane-lead' }))?.text).toMatch(/^›/);
  await ui.unmount();
});

test('NOTIFY-1 a decision new since the last look raises one notification; what waited before, and notify.on false, raise none', async ($, on) => {
  const w = project();
  w.requests = [dayjs];
  const clock = await start($, on, w);
  await clock.advance(2000);
  // The approval waiting when the session first looked isn't news.
  expect(w.notified).toEqual([]);
  w.questions = [question()];
  w.refs += ' q1 refs/heads/web/st-4-q\n';
  await clock.advance(2000);
  await clock.advance(2000);
  expect(w.notified).toHaveLength(1);
  expect(w.notified[0].title).toBe('code-kit: the lead asks you');
  await clock.advance(2000);
  expect(w.notified).toHaveLength(1);
  // Turned off, a new decision raises nothing.
  (w.check as any).harness = { notify: { on: false } };
  w.questions = [question(), question({ id: 'Q-2', question: 'Which payment provider?' })];
  w.refs += ' q2 refs/heads/web/st-4-q2\n';
  await clock.advance(2000);
  await clock.advance(2000);
  expect(w.notified).toHaveLength(1);
});

test('VIEW-6 s sends the selected story back, with the reason the person gives', async ($, on) => {
  const w = project();
  w.stories[0] = { ...w.stories[0], state: 'review' };
  await start($, on, w);
  await lanes($);
  const ui = await pane($, PANE);
  await press($, 'lane-next', PANE);
  await press($, 'lane-next', PANE);
  expect((await ui.find({ key: 'act-sendBack' }))?.props.hotkey).toBe('s');
  await press($, 'act-sendBack', PANE);
  expect(w.opened).toContain('code-kit-sendback');
  const confirm = await pane($, 'code-kit-sendback');
  await $.ui.input({ plugin: 'code-kit', key: 'sendback-reason', text: '' });
  expect(await confirm.find({ type: 'Text', text: /Give a reason/ })).toBeDefined();
  await $.ui.input({
    plugin: 'code-kit',
    key: 'sendback-reason',
    text: 'the cancel button has no test',
  });
  expect(w.acts).toEqual([['sent-back', 'web/st-4', '--reason', 'the cancel button has no test']]);
  expect(w.closed).toContain('code-kit-sendback');
  await confirm.unmount();
  await ui.unmount();
});

test('VIEW-6 f puts the keys in the filter, which narrows the lanes by name, agent or story', async ($, on) => {
  const w = project();
  await start($, on, w);
  await lanes($);
  const ui = await pane($, PANE);
  expect((await ui.find({ key: 'filter-focus' }))?.props.hotkey).toBe('f');
  await $.ui.input({ plugin: 'code-kit', key: 'filter', text: 'api-eng', kind: 'change' });
  expect(await ui.find({ key: 'lane-api' })).toBeDefined();
  expect(await ui.find({ key: 'lane-web' })).toBeUndefined();
  await ui.unmount();
});

test('VIEW-8 inline, the pane is the header, what needs the person and one line per lane', async ($, on) => {
  const w = project();
  await start($, on, w);
  await lanes($);
  const ui = await inlinePane($);
  expect(await ui.find({ key: 'count-building' })).toBeDefined();
  expect(await ui.find({ key: 'tabs' })).toBeUndefined();
  expect((await ui.find({ key: 'lane-web' }))?.text).toMatch(/^web\s*building\s*ST-4/);
  await ui.unmount();
});

// --- the story drill-down ---------------------------------------------------------------------------

/** The Lanes pane with web's lane selected. */
async function onWeb($: any) {
  await lanes($);
  const ui = await pane($, PANE);
  await press($, 'lane-next', PANE);
  await press($, 'lane-next', PANE);
  return ui;
}

test('VIEW-7 Enter on a lane opens its story: requirements with the spec-check, verify, the diff and its acts', async ($, on) => {
  const w = project();
  w.stories[0] = { ...w.stories[0], state: 'review' };
  await start($, on, w);
  const ui = await onWeb($);
  const open = await ui.find({ key: 'open-story' });
  expect(open?.props.label).toBe('Open ST-4');
  expect(open?.props.hotkey).toBe('o');
  expect(open?.props.autoFocus).toBe(true);
  await press($, 'open-story', PANE);
  expect((await ui.find({ key: 'story-head' }))?.text).toMatch(
    /ST-4 Booking form\s*web · review · web\/st-4/,
  );
  expect((await ui.find({ key: 'req-BOOK-1' }))?.text).toMatch(/spec-check: partial/);
  expect((await ui.find({ key: 'story-verify' }))?.text).toMatch(/Ownership: apps\/api\/x.ts/);
  expect((await ui.find({ key: 'file-0' }))?.props.label).toBe('apps/web/form.tsx +2 -0');
  const code = await ui.find({ type: 'Code' });
  expect(code?.props.format).toBe('diff');
  expect(String(code?.props.source)).toMatch(/^--- \/dev\/null\n\+\+\+ b\/apps\/web\/form.tsx\n@@/);
  await press($, 'file-1', PANE);
  expect(String((await ui.find({ type: 'Code' }))?.props.source)).toMatch(
    /\+\+\+ b\/apps\/web\/api.ts/,
  );
  expect((await ui.find({ key: 'story-review' }))?.props.hotkey).toBe('r');
  expect((await ui.find({ key: 'story-sendBack' }))?.props.hotkey).toBe('s');
  await press($, 'story-back', PANE);
  expect(await ui.find({ key: 'tabs' })).toBeDefined();
  await ui.unmount();
});

test("REVW-5 the drill-down shows the reviewer's findings by severity, each a way into the diff", async ($, on) => {
  const w = reviewing();
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  w.agents = [
    {
      id: 'r1',
      type: 'code-kit:reviewer',
      description: 'Review web/st-4 (ST-4)',
      status: 'completed',
    },
  ];
  await $.turn.complete({
    turnId: 't-r1',
    agentId: 'r1',
    answer: report({
      verify: { passed: true, problems: [] },
      findings: [
        { severity: 'nit', where: 'apps/web/form.tsx:2', text: 'x is unused.' },
        {
          severity: 'concern',
          where: 'apps/web/api.ts:2',
          text: 'No error handling.',
          rule: 'BOOK-1',
        },
      ],
    }),
    durationMs: 1,
    isAborted: false,
  } as any);
  const ui = await onWeb($);
  await press($, 'open-story', PANE);
  const findings = (await ui.find({ key: 'story-findings' }))?.text ?? '';
  expect(findings).toMatch(/Review of abc123d/);
  expect(findings.indexOf('Concerns')).toBeLessThan(findings.indexOf('Nits'));
  await press($, 'finding-concern-0', PANE);
  expect(String((await ui.find({ type: 'Code' }))?.props.source)).toMatch(/apps\/web\/api.ts/);
  await ui.unmount();
});

// --- the traceability map ---------------------------------------------------------------------------

/** 40 requirements over two specs: 30 done (20 tested), 4 in progress, 3 todo, 3 without a story. */
function requirementsMap() {
  const reqs: any[] = [];
  for (let i = 1; i <= 40; i++) {
    const state = i <= 30 ? 'done' : i <= 34 ? 'in progress' : i <= 37 ? 'todo' : 'no story';
    reqs.push({
      id: `BOOK-${i}`,
      title: `Requirement ${i}`,
      file: i <= 20 ? 'docs/spec/01-booking.md' : 'docs/spec/02-payments.md',
      removed: false,
      state,
      stories: state === 'no story' ? [] : ['ST-4'],
      tests: i <= 20 ? [`apps/web/b${i}.test.ts`] : [],
    });
  }
  return reqs;
}

test('TRACE-1 the map: a cell per requirement, a row per spec, and a legend with the gaps counted', async ($, on) => {
  const w = project();
  w.requirements = requirementsMap();
  await start($, on, w);
  await lanes($);
  const ui = await pane($, PANE);
  expect((await ui.find({ key: 'tab-map' }))?.props.label).toBe('Trail');
  expect((await ui.find({ key: 'tab-map' }))?.props.hotkey).toBe('5');
  await press($, 'tab-map', PANE);
  const legend = (await ui.find({ key: 'map-legend' }))?.text ?? '';
  expect(legend).toMatch(/■ 20 done and tested/);
  expect(legend).toMatch(/✗ 3 without a story/);
  expect((await ui.find({ key: 'map-row-01-booking' }))?.text.replace(/\s/g, '')).toBe(
    '01-booking' + '■'.repeat(20),
  );
  const cells = await Promise.all(w.requirements.map((r) => ui.find({ key: `cell-${r.id}` })));
  expect(cells.filter((c) => c?.text === '✗')).toHaveLength(3);
  await ui.unmount();
});

test('TRACE-2 selecting a cell, by keys or the list, shows its spec, stories with their branches, and tests', async ($, on) => {
  const w = project();
  w.requirements = requirementsMap();
  w.stories[0] = { ...w.stories[0], branchExists: true };
  await start($, on, w);
  await lanes($);
  const ui = await pane($, PANE);
  await press($, 'tab-map', PANE);
  expect((await ui.find({ key: 'map-detail' }))?.text).toMatch(/BOOK-1 Requirement 1/);
  await press($, 'cell-next', PANE);
  expect(JSON.stringify((await ui.find({ key: 'cell-BOOK-2' }))?.children)).toMatch(
    /"inverse":true/,
  );
  await press($, 'row-next', PANE);
  expect(JSON.stringify((await ui.find({ key: 'cell-BOOK-21' }))?.children)).toMatch(
    /"inverse":true/,
  );
  // The list holds the selected requirement's spec: payments' twenty, none of booking's.
  const options = (await ui.find({ key: 'map-select' }))?.props.options ?? [];
  expect(options.length).toBe(20);
  expect(options.every((o: any) => Number(o.value.split('-')[1]) > 20)).toBe(true);
  await $.ui.select({ plugin: 'code-kit', key: 'map-select', value: 'BOOK-40', requestId: PANE });
  expect((await ui.find({ key: 'map-detail' }))?.text).toMatch(/No story delivers it yet/);
  await press($, 'row-prev', PANE);
  await $.ui.select({ plugin: 'code-kit', key: 'map-select', value: 'BOOK-3', requestId: PANE });
  const detail = (await ui.find({ key: 'map-detail' }))?.text ?? '';
  expect(detail).toMatch(/docs\/spec\/01-booking.md · done and tested/);
  expect(detail).toMatch(/ST-4 Booking form · web · in progress · web\/st-4/);
  expect(detail).toMatch(/apps\/web\/b3.test.ts/);
  await ui.unmount();
});

test('TRACE-3 the map follows the project: a commit that finishes a requirement shows within 2 seconds', async ($, on) => {
  const w = project();
  w.requirements = requirementsMap();
  const clock = await start($, on, w);
  await lanes($);
  const ui = await pane($, PANE);
  await press($, 'tab-map', PANE);
  w.requirements = w.requirements.map((r) =>
    r.id === 'BOOK-31' ? { ...r, state: 'done', tests: ['t'] } : r,
  );
  w.refs += ' ddd refs/heads/web/st-9\n';
  await clock.advance(2000);
  expect((await ui.find({ key: 'map-legend' }))?.text).toMatch(/■ 21 done and tested/);
  await ui.unmount();
});

// --- timelines and characters ---------------------------------------------------------------------

test('VIEW-2 a lane dispatched 40 minutes ago and in review for 5 shows 35 minutes building and 5 in review, to now', async ($, on) => {
  const w = project();
  w.stories[0] = { ...w.stories[0], state: 'review' };
  const clock = await start($, on, w);
  const now = clock.now() + 2000;
  w.times = [
    {
      id: 'ST-4',
      lane: 'web',
      branch: 'web/st-4',
      state: 'review',
      started: now - 40 * 60000,
      lastCommit: now - 5 * 60000,
      merged: null,
      sentBack: [],
      approvals: [],
    },
  ];
  w.refs += ' eee refs/heads/web/st-4-again\n';
  await clock.advance(2000);
  await lanes($);
  const ui = await pane($, PANE);
  const bar = (await ui.find({ key: 'bar-web' }))?.text.trim() ?? '';
  const building = [...bar].filter((c) => c === '█').length;
  const review = [...bar].filter((c) => c === '▒').length;
  expect(building + review).toBe(66);
  expect(Math.abs(building - (66 * 35) / 40)).toBeLessThanOrEqual(1);
  expect(bar.endsWith('▒')).toBe(true);
  await ui.unmount();
});

test('VIEW-3 each lane has its character: web works, api waits on a held call, the lead rests', async ($, on) => {
  const w = project();
  w.refusal =
    'Blocked: a new dependency (zod) needs a person\'s approval. Write a short change request for the lead.\n  ! echo "<what you are approving>" > .claude/approvals/api/dep-zod\n(a person runs it; it allows installing it for the api lane, until the install is committed, at most 7 days)\nCommand: npm install zod';
  w.agents = [
    { id: 'a1', type: 'web-engineer', description: 'ST-4', status: 'running' },
    { id: 'a2', type: 'api-engineer', description: 'ST-5', status: 'running' },
  ];
  const clock = await start($, on, w);
  w.holdWaits = true;
  const call = $.tool.call({
    tool: 'Bash',
    tool_use_id: 'tu-z',
    command: 'npm install zod',
    agentId: 'a2',
  } as any);
  for (let i = 0; i < 50 && !w.waiting.has('tu-z'); i++) await clock.advance(1);
  await lanes($);
  const ui = await pane($, PANE);
  const names = ['lead', 'web', 'api', 'core'];
  const cells = async (lane: string) => (await ui.find({ key: `char-${lane}` }))?.props.cells;
  expect(await cells('web')).toBe(rasterCells(sprite('working', 0, tintOf('web', names))));
  expect(await cells('api')).toBe(rasterCells(sprite('waiting', 0, tintOf('api', names))));
  expect(await cells('lead')).toBe(
    rasterCells(sprite('idle', 0, tintOf('lead', names), { lead: true })),
  );
  // The working character repaints in place; the waiting one doesn't.
  await clock.advance(2000);
  await clock.advance(1200);
  expect(w.blits).toContain('char-web');
  expect(w.blits).not.toContain('char-api');
  await ui.unmount();
  w.waiting.get('tu-z')?.('timed out');
  await call;
});

test('VIEW-3 nothing repaints when no agent is working', async ($, on) => {
  const w = project();
  const clock = await start($, on, w);
  await lanes($);
  const ui = await pane($, PANE);
  await clock.advance(6000);
  expect(w.blits).toEqual([]);
  await ui.unmount();
});

test('VIEW-2 and VIEW-3 on Desktop the characters and timelines are SVG', async ($, on) => {
  const w = project();
  w.agents = [{ id: 'a1', type: 'web-engineer', description: 'ST-4', status: 'running' }];
  const clock = await start($, on, w);
  const now = clock.now() + 2000;
  w.times = [
    {
      id: 'ST-4',
      lane: 'web',
      branch: 'web/st-4',
      state: 'in progress',
      started: now - 600000,
      lastCommit: null,
      merged: null,
      sentBack: [],
      approvals: [],
    },
  ];
  w.refs += ' fff refs/heads/x\n';
  await clock.advance(2000);
  await lanes($);
  const ui = await $.ui.mount({
    plugin: 'code-kit',
    component: 'Pane',
    requestId: PANE,
    surface: 'desktop',
    viewport: { columns: 120, rows: 40 },
    props: { title: PANE, isFocused: true, bodyColumns: 80, placement: 'dock' },
  });
  const svgs = await ui.findAll({ type: 'Svg' });
  expect(
    svgs.some((s) => s.props.alt === 'web: working' && String(s.props.source).includes('<animate')),
  ).toBe(true);
  expect(svgs.some((s) => s.props.alt === "web's timeline")).toBe(true);
  await ui.unmount();
});

// --- the combined lane view ---------------------------------------------------------------------------

/** A project where Context Graph's adapter reports on the web lane's agent. */
function combinedProject() {
  const w = project();
  w.stories[0] = { ...w.stories[0], state: 'review' };
  (w.check as any).adapters = ['context-graph'];
  w.adapters = [
    {
      name: 'context-graph',
      lanes: {
        'web-engineer': {
          withoutUnderstanding: [{ path: 'apps/web/form.tsx', unread: ['apps/web/api.ts'] }],
          cardsOwed: ['apps/web/form.tsx', 'apps/web/api.ts'],
        },
      },
      open: { command: 'graph' },
    },
  ];
  w.story.adapters = [
    {
      name: 'context-graph',
      files: {
        'apps/web/form.tsx': {
          rules: [
            { id: 'K:no-fetch', text: 'No fetch in components', mode: 'E', proposed: false },
            { id: 'K:dates', text: 'Dates through lib/date', mode: 'G?', proposed: true },
          ],
        },
        'apps/web/api.ts': {
          rules: [{ id: 'K:no-fetch', text: 'No fetch in components', mode: 'E', proposed: false }],
        },
      },
      open: { command: 'graph' },
    },
  ];
  return w;
}

test('JOIN-2 each lane shows its edits without understanding, red above zero, and its cards owed', async ($, on) => {
  const w = combinedProject();
  await start($, on, w);
  await lanes($);
  const ui = await pane($, PANE);
  expect((await ui.find({ key: 'lane-web' }))?.text).toMatch(
    /1 edited without understanding\s*2 cards owed/,
  );
  expect(
    (await ui.find({ type: 'Text', text: '1 edited without understanding' }))?.props.color,
  ).toBe('red');
  // LANES-2: a lane whose facts are all zero shows none of them.
  expect((await ui.find({ key: 'lane-api' }))?.text).not.toMatch(/understanding|owed/);
  await ui.unmount();
});

test('JOIN-1 without an adapter that knows, the lanes show no such slots', async ($, on) => {
  const w = project();
  await start($, on, w);
  await lanes($);
  const ui = await pane($, PANE);
  expect((await ui.find({ key: 'lane-web' }))?.text).not.toMatch(/understanding|owed/);
  await ui.unmount();
});

test('JOIN-2 to JOIN-4 the drill-down names the unread files, the cards owed and the rules, and opens a file in Context Graph', async ($, on) => {
  const w = combinedProject();
  await start($, on, w);
  const ui = await onWeb($);
  await press($, 'open-story', PANE);
  expect((await ui.find({ key: 'story-understanding' }))?.text).toMatch(
    /apps\/web\/form.tsx\s*still unread: apps\/web\/api.ts/,
  );
  expect((await ui.find({ key: 'story-cards' }))?.text).toMatch(/Cards owed \(2\)/);
  const rules = (await ui.find({ key: 'story-rules' }))?.text ?? '';
  expect(rules).toMatch(/agreed\s+K:no-fetch\s+No fetch in components\s+\(2 files\)/);
  expect(rules.indexOf('K:no-fetch')).toBeLessThan(rules.indexOf('K:dates'));
  expect(rules).toMatch(/proposed\s+K:dates/);
  expect((await ui.find({ key: 'story-open-in' }))?.props.hotkey).toBe('v');
  await press($, 'story-open-in', PANE);
  expect(w.commands).toContainEqual({ command: 'graph', args: 'apps/web/form.tsx' });
  await press($, 'unread-file-0', PANE);
  expect(w.commands.length).toBe(2);
  await ui.unmount();
});

test("with no session bound (claude -p before it mounts), the agent list's failure leaves the project's refresh working", async ($, on) => {
  const w = project();
  w.agentsThrow = true;
  const clock = await start($, on, w);
  await lanes($);
  w.stories[0] = { ...w.stories[0], state: 'review' };
  w.refs += ' abc refs/heads/web/st-4-done\n';
  await clock.advance(2000);
  const ui = await pane($, PANE);
  expect((await ui.find({ key: 'lane-web' }))?.text).toMatch(/in review/);
  await ui.unmount();
});

test('REVW-2 a reviewer that could not be registered yet is registered at a later refresh, then used', async ($, on) => {
  const w = reviewing();
  w.registerFails = 1;
  const clock = await start($, on, w);
  expect(w.registered).toEqual([]);
  w.refs += ' abc refs/heads/x\n';
  await clock.advance(2000);
  expect(w.registered.map((s) => s.name)).toEqual(['reviewer']);
  await leadTurn($);
  await settle(clock);
  expect(w.prompts[0]).toMatch(/^Start code-kit's reviewer/);
});

// --- the first offer: how hands-off the loop is -----------------------------------------------------

/** A project where nobody has chosen autonomy yet: the default stands in. */
function unchosen() {
  const w = project();
  w.check.harnessSet = [];
  return w;
}

test('until autonomy is chosen, the loop offers its first step: keep going, ask each time, or off', async ($, on) => {
  const w = unchosen();
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  expect(w.prompts).toEqual([]);
  const ui = await bandUi($);
  expect(
    await ui.find({
      type: 'Text',
      text: 'code-kit can keep the build moving between your prompts. Next: Dispatch ST-9.',
    }),
  ).toBeDefined();
  expect((await ui.find({ key: 'band-keepGoing' }))?.props.label).toMatch(/Keep going$/);
  expect(await ui.find({ key: 'band-askEach' })).toBeDefined();
  expect(await ui.find({ key: 'band-loopOff' })).toBeDefined();
  await ui.unmount();
});

test("Keep going records autonomous as the person's choice and takes the step", async ($, on) => {
  const w = unchosen();
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  const ui = await bandUi($);
  await press($, 'band-keepGoing');
  await ui.unmount();
  expect(w.acts[0]).toEqual([
    'settings',
    'set',
    'autonomy',
    'autonomous',
    '--reason',
    'Chosen when code-kit first offered to keep the build moving between prompts',
    '--via',
    'pane',
  ]);
  expect(w.prompts).toEqual(['Dispatch ST-9: run /code-kit:dispatch ST-9.']);
  // From then on it acts on its own.
  w.next = { step: 'review', args: 'ST-4', then: [] };
  await leadTurn($, 't-2');
  await settle(clock);
  expect(w.prompts[1]).toBe('Review ST-4: run /code-kit:review ST-4.');
});

test('Ask each time records propose, and the step waits for Go', async ($, on) => {
  const w = unchosen();
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  let ui = await bandUi($);
  await press($, 'band-askEach');
  await ui.unmount();
  expect(w.acts[0]?.slice(0, 4)).toEqual(['settings', 'set', 'autonomy', 'propose']);
  expect(w.prompts).toEqual([]);
  ui = await bandUi($);
  expect(await ui.find({ type: 'Text', text: 'Dispatch ST-9?' })).toBeDefined();
  await press($, 'band-go');
  await ui.unmount();
  expect(w.prompts).toEqual(['Dispatch ST-9: run /code-kit:dispatch ST-9.']);
});

test('Off records off, and the loop does nothing', async ($, on) => {
  const w = unchosen();
  const clock = await start($, on, w);
  await leadTurn($);
  await settle(clock);
  let ui = await bandUi($);
  await press($, 'band-loopOff');
  await ui.unmount();
  expect(w.acts[0]?.slice(0, 4)).toEqual(['settings', 'set', 'autonomy', 'off']);
  await leadTurn($, 't-2');
  await settle(clock);
  expect(w.prompts).toEqual([]);
  ui = await bandUi($);
  expect(await ui.find({ type: 'Text', text: /keep the build moving|Dispatch/ })).toBeUndefined();
  await ui.unmount();
});

// --- an idle lane's detail --------------------------------------------------------------------------

test('VIEW-6 a selected idle lane shows what it owns and its stories, Enter opens its next one, and the header counts it', async ($, on) => {
  const w = project();
  w.stories = [
    { id: 'ST-1', title: 'Schema', lane: 'api', state: 'done', branch: 'api/st-1', waitingOn: [] },
    {
      id: 'ST-2',
      title: 'Endpoints',
      lane: 'api',
      state: 'blocked',
      branch: 'api/st-2',
      waitingOn: ['ST-9'],
    },
    {
      id: 'ST-9',
      title: 'Pricing',
      lane: 'core',
      state: 'ready',
      branch: 'core/st-9',
      waitingOn: [],
    },
  ];
  await start($, on, w);
  await lanes($);
  const ui = await pane($, PANE);
  expect(await ui.find({ type: 'Text', text: '1 of 3 stories done' })).toBeDefined();
  expect((await ui.find({ key: 'count-idle' }))?.props.label).toMatch(/· \d+ idle/);
  for (let i = 0; i < 3; i++) await press($, 'lane-next', PANE);
  const api = (await ui.find({ key: 'lane-api' }))?.text ?? '';
  expect(api).toMatch(/owns\s*apps\/api\/\*\*/);
  expect(api).toMatch(/agent\s*api-engineer/);
  // LANES-3: the lane's stories as cards.
  expect((await ui.find({ key: 'card-ST-1' }))?.text).toMatch(/ST-1\s*merged\s*Schema/);
  expect((await ui.find({ key: 'card-ST-2' }))?.text).toMatch(
    /ST-2\s*blocked\s*Endpoints.*waits on ST-9/,
  );
  expect((await ui.find({ key: 'open-story' }))?.props.label).toBe('Open ST-2');
  await press($, 'open-story', PANE);
  expect(await ui.find({ key: 'story-head' })).toBeDefined();
  await ui.unmount();
});

test('VIEW-6 the filter is one row, its key beside the box', async ($, on) => {
  const w = project();
  await start($, on, w);
  await lanes($);
  const ui = await pane($, PANE);
  const row = await ui.find({ key: 'filter-row' });
  expect(row).toBeDefined();
  expect((await ui.find({ key: 'filter-focus' }))?.props.hotkey).toBe('f');
  expect(await ui.findAll({ key: 'filter' })).toHaveLength(1);
  await ui.unmount();
});

test('the lead reads orchestrating while its turn runs, and idle once it ends; an agent at work outside a story too', async ($, on) => {
  const w = project();
  w.agents = [
    { id: 'a9', type: 'api-engineer', description: 'look at the logs', status: 'running' },
  ];
  const clock = await start($, on, w);
  await lanes($);
  const ui = await pane($, PANE);
  expect((await ui.find({ key: 'lane-api' }))?.text).toMatch(/api\s*working/);
  await $.turn.start({ turnId: 't-1', text: '' } as any);
  // LANES-2: the lead mid-turn is orchestrating, not a lane at work on nothing.
  expect((await ui.find({ key: 'lane-lead' }))?.text).toMatch(/lead\s*orchestrating/);
  expect((await ui.find({ key: 'count-working' }))?.props.label).toBe('▶ 1 working');
  await $.turn.complete({ turnId: 't-1', answer: '', durationMs: 1, isAborted: false } as any);
  await settle(clock);
  expect((await ui.find({ key: 'lane-lead' }))?.text).toMatch(/lead\s*idle/);
  await ui.unmount();
});

// --- teams (spec 16) ---------------------------------------------------------------------------------

/** A team's state as `code-kit team --json` reports it, seen by `me`. */
function teamOf(me: string) {
  const at = '2026-10-06T09:00:00.000Z'; // a Tuesday
  return {
    at,
    reachable: true,
    github: true,
    me,
    techLead: 'alex',
    owners: { web: ['sam'] },
    staleDays: 3,
    claims: [
      { story: 'ST-4', by: 'sam', at, active: at, stale: true, lease: ['apps/web/booking/**'] },
      {
        story: 'ST-9',
        by: 'kim',
        at,
        active: at,
        stale: false,
        lease: ['apps/web/booking/form.tsx'],
      },
    ],
    intents: [
      {
        id: 12,
        by: 'kim',
        about: 'Split the booking form',
        touches: ['apps/web/**'],
        at,
        url: 'u',
        state: 'open',
      },
    ],
    pulls: [
      {
        number: 14,
        title: 'Booking list',
        by: 'kim',
        branch: 'web/st-9',
        draft: false,
        updated: at,
        url: 'u',
      },
    ],
  };
}

test('TEAM-7 and TEAM-9 the band names what of the team needs you: your stale claim, a collision, an intent touching yours, a review in your lane', async ($, on) => {
  const w = project();
  w.team = teamOf('sam');
  (w.check as any).team = { techLead: 'alex' };
  (w.check as any).lanes.web.paths = ['apps/web/**'];
  await start($, on, w);
  const band = await bandUi($);
  expect(
    await band.find({ type: 'Text', text: 'Still on ST-4? Nothing on it since Tuesday' }),
  ).toBeDefined();
  expect(
    await band.find({ type: 'Text', text: "ST-4 and kim's ST-9 both change apps/web/booking/**" }),
  ).toBeDefined();
  expect(
    await band.find({ type: 'Text', text: 'kim intends: Split the booking form (touches yours)' }),
  ).toBeDefined();
  expect(
    await band.find({
      type: 'Text',
      text: "kim's #14 Booking list is in your web lane and waits for your review",
    }),
  ).toBeDefined();
  await press($, 'band-keepClaim');
  expect(w.acts).toContainEqual(['team', 'keep', 'ST-4']);
  await band.unmount();
});

test('TEAM-5 the tech lead sees every open intent with Agree and Drop, which act as them', async ($, on) => {
  const w = project();
  w.team = teamOf('alex');
  (w.check as any).team = { techLead: 'alex' };
  await start($, on, w);
  const band = await bandUi($);
  expect(
    await band.find({ type: 'Text', text: 'kim intends: Split the booking form' }),
  ).toBeDefined();
  expect(await band.find({ type: 'Text', text: /Still on/ })).toBeUndefined();
  await press($, 'band-agreeIntent');
  expect(w.acts).toContainEqual([
    'intend',
    'agree',
    '12',
    '--reason',
    'agreed in the code-kit pane',
  ]);
  // TEAM-10: then the lead records it where agents read it, through a pull request.
  expect(
    w.prompts.some((p) => p.includes('intend record 12') && p.includes('lead/decision-12')),
  ).toBe(true);
  await band.unmount();
});

test("TEAM-8 when the shared repository can't be reached the band says so as a note", async ($, on) => {
  const w = project();
  w.team = { ...teamOf('sam'), reachable: false, claims: [], intents: [], pulls: [] };
  (w.check as any).team = { techLead: 'alex' };
  await start($, on, w);
  const band = await bandUi($);
  expect(
    await band.find({
      type: 'Text',
      text: "team: the shared repository can't be reached, so claims aren't checked",
    }),
  ).toBeDefined();
  expect(await band.find({ type: 'Text', text: 'note' })).toBeDefined();
  await band.unmount();
});

test('TEAM-7 /team opens the Team pane on its people: each with their lanes, claims, pulls and intents; /team again closes it', async ($, on) => {
  const w = project();
  w.team = teamOf('sam');
  (w.check as any).team = { techLead: 'alex' };
  await start($, on, w);
  await teamCmd($);
  expect(w.opened).toEqual([TEAM]);
  const ui = await pane($, TEAM);
  expect((await ui.find({ key: 'team-header' }))?.text).toMatch(
    /tech lead alex[\s\S]*you are sam · own web[\s\S]*2 claimed · 1 intent open · 1 pull request/,
  );
  expect((await ui.find({ key: 'team-person-alex' }))?.text).toMatch(/alex · tech lead/);
  expect((await ui.find({ key: 'team-person-sam' }))?.text).toMatch(
    /sam · you · owns web[\s\S]*ST-4 · stale since Tuesday/,
  );
  expect((await ui.find({ key: 'team-person-kim' }))?.text).toMatch(
    /#14 Booking list \(web\/st-9\)[\s\S]*intends: Split the booking form/,
  );
  // GitHub's own provider has no drift checks, so no Drift tab.
  expect(await ui.find({ key: 'team-tab-drift' })).toBeUndefined();
  await ui.unmount();
  await teamCmd($);
  expect(w.closed).toEqual([TEAM]);
});

test('TEAM-6 since you last looked is read when its tab opens, which marks it read, and again each time it opens', async ($, on) => {
  const w = project();
  w.team = teamOf('sam');
  w.teamSince = {
    since: '2026-10-10T00:00:00Z',
    github: true,
    people: { kim: [{ at: 1, by: 'kim', kind: 'pushed', text: 'pushed 2 commits to web/st-9' }] },
  };
  (w.check as any).team = { techLead: 'alex' };
  await start($, on, w);
  await teamCmd($);
  const ui = await pane($, TEAM);
  const reads = () => w.acts.filter((a) => a[0] === 'team' && a[1] === 'since').length;
  expect(reads()).toBe(0);
  expect((await ui.find({ key: 'team-tab-activity' }))?.props.hotkey).toBe('2');
  await press($, 'team-tab-activity', TEAM);
  expect(w.acts).toContainEqual(['team', 'since', '--json']);
  expect((await ui.find({ key: 'team-since' }))?.text).toMatch(
    /kim[\s\S]*pushed 2 commits to web\/st-9/,
  );
  await press($, 'team-tab-people', TEAM);
  await press($, 'team-tab-activity', TEAM);
  expect(reads()).toBe(2);
  await ui.unmount();
});

test("TEAM-9 the Claims tab: Keep and Release on yours, and nothing on others'", async ($, on) => {
  const w = project();
  w.team = teamOf('sam');
  (w.check as any).team = { techLead: 'alex' };
  await start($, on, w);
  await teamCmd($);
  const ui = await pane($, TEAM);
  await press($, 'team-tab-claims', TEAM);
  expect((await ui.find({ key: 'team-claims-ST-4' }))?.text).toMatch(
    /ST-4[\s\S]*sam \(you\)[\s\S]*stale since Tuesday[\s\S]*leases apps\/web\/booking\/\*\*/,
  );
  expect(await ui.find({ key: 'team-release-ST-9' })).toBeUndefined();
  expect(await ui.find({ key: 'team-reassign-ST-4' })).toBeUndefined();
  await press($, 'team-keep-ST-4', TEAM);
  expect(w.acts).toContainEqual(['team', 'keep', 'ST-4']);
  await press($, 'team-release-ST-4', TEAM);
  expect(w.acts).toContainEqual(['team', 'release', 'ST-4']);
  await ui.unmount();
});

test("TEAM-9 the tech lead releases or reassigns anyone's claim from the Claims tab", async ($, on) => {
  const w = project();
  w.team = teamOf('alex');
  (w.check as any).team = { techLead: 'alex' };
  await start($, on, w);
  await teamCmd($);
  const ui = await pane($, TEAM);
  await press($, 'team-tab-claims', TEAM);
  await press($, 'team-release-ST-9', TEAM);
  expect(w.acts).toContainEqual(['team', 'release', 'ST-9']);
  expect(await ui.find({ key: 'team-reassign-to-ST-9' })).toBeUndefined();
  await press($, 'team-reassign-ST-9', TEAM);
  expect(await ui.find({ key: 'team-reassign-to-ST-9' })).toBeDefined();
  await $.ui.input({ plugin: 'code-kit', key: 'team-reassign-to-ST-9', text: '@sam' });
  expect(w.acts).toContainEqual(['team', 'reassign', 'ST-9', 'sam']);
  expect(await ui.find({ key: 'team-reassign-to-ST-9' })).toBeUndefined();
  await ui.unmount();
});

test('TEAM-5 the Intents tab lists the open intents, with Agree and Drop for the tech lead', async ($, on) => {
  const w = project();
  w.team = teamOf('alex');
  (w.check as any).team = { techLead: 'alex' };
  await start($, on, w);
  await teamCmd($);
  const ui = await pane($, TEAM);
  await press($, 'team-tab-intents', TEAM);
  expect((await ui.find({ key: 'team-intents-12' }))?.text).toMatch(
    /#12[\s\S]*Split the booking form[\s\S]*kim[\s\S]*touches apps\/web\/\*\*/,
  );
  await press($, 'team-drop-12', TEAM);
  expect(w.acts).toContainEqual([
    'intend',
    'drop',
    '12',
    '--reason',
    'dropped in the code-kit pane',
  ]);
  await ui.unmount();
});

test('TEAM-5 a developer sees the intents without Agree or Drop', async ($, on) => {
  const w = project();
  w.team = teamOf('sam');
  (w.check as any).team = { techLead: 'alex' };
  await start($, on, w);
  await teamCmd($);
  const ui = await pane($, TEAM);
  await press($, 'team-tab-intents', TEAM);
  expect(await ui.find({ key: 'team-intents-12' })).toBeDefined();
  expect(await ui.find({ key: 'team-agree-12' })).toBeUndefined();
  await ui.unmount();
});

test("TEAM-13 the Setup tab shows the team's config and what's still missing, and asks the lead to change it", async ($, on) => {
  const w = project();
  w.team = {
    ...teamOf('sam'),
    provider: {
      name: 'GitHub',
      live: false,
      detail: 'claims are refs on origin, intents are discussions in "Intents"',
    },
    setup: [
      'Discussions are off for this repository. Turn them on in its Settings › Features, add a "Intents" category.',
    ],
  };
  (w.check as any).team = {
    techLead: 'alex',
    staleDays: 3,
    intents: 'Intents',
    provider: 'github',
    owners: { web: ['sam'] },
  };
  await start($, on, w);
  await teamCmd($);
  const ui = await pane($, TEAM);
  expect((await ui.find({ key: 'team-provider' }))?.text).toBe(
    'Through GitHub: claims are refs on origin, intents are discussions in "Intents"',
  );
  expect((await ui.find({ key: 'team-setup-count' }))?.text).toBe(
    '1 thing to set up: see Setup (6).',
  );
  await press($, 'team-tab-setup', TEAM);
  expect((await ui.find({ key: 'team-config' }))?.text).toMatch(
    /Tech lead\s+alex[\s\S]*Provider\s+GitHub[\s\S]*Lane web\s+sam[\s\S]*Unowned lanes\s+api, core/,
  );
  expect((await ui.find({ key: 'team-todo' }))?.text).toMatch(/Discussions are off/);
  await press($, 'team-setup', TEAM);
  expect(w.prompts.at(-1)).toMatch(/\/code-kit:team-init/);
  await ui.unmount();
});

test('TEAM-13 without a team, /team says how to set one up, and opens nothing', async ($, on) => {
  const w = project();
  await start($, on, w);
  const said = await teamCmd($);
  expect(said.text).toMatch(/isn't set up as a team[\s\S]*\/code-kit:team-init/);
  expect(w.opened).toEqual([]);
});

test('TEAM-7 the Lanes pane has no Team tab: the team has its own pane', async ($, on) => {
  const w = project();
  w.team = teamOf('sam');
  (w.check as any).team = { techLead: 'alex' };
  await start($, on, w);
  await lanes($);
  const ui = await pane($, PANE);
  expect(await ui.find({ key: 'tab-team' })).toBeUndefined();
  await ui.unmount();
});

test('a live provider says so in the Team pane, by its own name, and has a Drift tab', async ($, on) => {
  const w = project();
  w.team = {
    ...teamOf('kim'),
    provider: {
      name: 'the code-kit teams hub',
      live: true,
      account: 'kim',
      detail: 'claims, leases and intents as they happen',
    },
    findings: [],
  };
  (w.check as any).team = { techLead: 'alex' };
  await start($, on, w);
  await teamCmd($);
  const ui = await pane($, TEAM);
  expect((await ui.find({ key: 'team-provider' }))?.text).toBe(
    'Through the code-kit teams hub · live · signed in as kim: claims, leases and intents as they happen',
  );
  await press($, 'team-tab-drift', TEAM);
  expect(
    await ui.find({ type: 'Text', text: 'No drift found on the branches at work.' }),
  ).toBeDefined();
  await ui.unmount();
});

test("with a live provider (the hub), the band says when it fell back to GitHub, and names drift on your work; the Team tab shows who's at work and the drift found", async ($, on) => {
  const w = project();
  const at = new Date().toISOString();
  w.team = {
    ...teamOf('kim'),
    fallback: "The code-kit teams hub can't be reached.",
    sessions: [
      {
        login: 'kim',
        branch: 'web/st-9',
        agents: [{ type: 'web-engineer', story: 'ST-9', tool: 'Edit' }],
        seen: at,
        away: false,
      },
      { login: 'sam', branch: 'api/st-4', agents: [], seen: at, away: true },
    ],
    findings: [
      {
        id: 1,
        branch: 'web/st-9',
        by: 'kim',
        conflictsWith: 'spec docs/specs/02-booking.md',
        severity: 'blocker',
        text: 'BOOK-2 now holds prices in cents.',
        at,
      },
      {
        id: 2,
        branch: 'api/st-4',
        by: 'sam',
        conflictsWith: 'branch web/st-9',
        severity: 'note',
        text: 'only a note',
        at,
      },
    ],
  };
  (w.check as any).team = { techLead: 'alex' };
  await start($, on, w);
  const band = await bandUi($);
  expect(
    await band.find({
      type: 'Text',
      text: "team: the team's provider can't be reached, so claims are checked through GitHub until it's back",
    }),
  ).toBeDefined();
  expect(
    await band.find({ type: 'Text', text: 'drift on web/st-9: BOOK-2 now holds prices in cents.' }),
  ).toBeDefined();
  expect(await band.find({ type: 'Text', text: /only a note/ })).toBeUndefined();
  // The drift line's Team button (the second: the collision's comes first) opens the Team pane on the drift.
  await press($, 'band-team-2', 'above-prompt');
  expect(w.opened).toEqual([TEAM]);
  const ui = await pane($, TEAM);
  expect((await ui.find({ key: 'team-provider' }))?.text).toMatch(
    /can't be reached \(The code-kit teams hub can't be reached\.\): claims are checked through GitHub/,
  );
  expect((await ui.find({ key: 'team-drift-web/st-9' }))?.text).toMatch(
    /web\/st-9 · kim[\s\S]*blocker · spec docs\/specs\/02-booking\.md: BOOK-2 now holds prices in cents\./,
  );
  await press($, 'team-tab-people', TEAM);
  expect((await ui.find({ key: 'team-person-kim' }))?.text).toMatch(
    /at work on web\/st-9: web-engineer on ST-9 \(Edit\)[\s\S]*drift on web\/st-9 \(blocker\): BOOK-2 now holds prices in cents\./,
  );
  expect((await ui.find({ key: 'team-person-sam' }))?.text).toMatch(/away \(last seen/);
  await ui.unmount();
});

test('TEAM-12 with a board, the mod syncs it in the background, at most every 10 minutes', async ($, on) => {
  const w = project();
  w.team = teamOf('sam');
  (w.check as any).team = { techLead: 'alex', board: { owner: 'o', number: 3 } };
  const clock = await start($, on, w);
  const syncs = () => w.acts.filter((a) => a[0] === 'team' && a[1] === 'board').length;
  expect(syncs()).toBe(1);
  await clock.advance(60000);
  expect(syncs()).toBe(1);
  await clock.advance(10 * 60000);
  expect(syncs()).toBe(2);
});

test('TRACE-2 a project with more requirements than a list holds still draws its trail', async ($, on) => {
  const w = project();
  w.requirements = Array.from({ length: 134 }, (_, i) => ({
    id: `AILA-${i + 1}`,
    title: `Requirement ${i + 1}`,
    file: 'docs/spec/03-aila.md',
    removed: false,
    state: 'todo',
    stories: ['ST-4'],
    tests: [],
  }));
  await start($, on, w);
  await lanes($);
  const ui = await pane($, PANE);
  await press($, 'tab-map', PANE);
  expect((await ui.find({ key: 'map-select' }))?.props.options.length).toBe(64);
  await ui.unmount();
});

test('MAP-5 with no story at work, the code map shows the whole project, by folder', async ($, on) => {
  const w = project();
  w.stories = w.stories.map((s) => ({ ...s, state: 'ready' }));
  w.map = {
    story: { id: 'project', title: 'The whole project', lane: null, state: null },
    layers: ['other'],
    files: [
      { path: 'apps/web/src', layer: 'other', lane: 'web', imports: ['packages/core'], files: 12 },
      { path: 'packages/core', layer: 'other', lane: 'core', imports: [], files: 4 },
    ],
  };
  await start($, on, w);
  await lanes($);
  const ui = await pane($, PANE);
  await press($, 'tab-code', PANE);
  expect((await ui.find({ key: 'map-story-project' }))?.props.variant).toBe('primary');
  expect(await ui.find({ type: 'Text', text: /hasn't changed any code yet/ })).toBeUndefined();
  expect(JSON.stringify(await ui.find({ key: 'map-stories' }))).toMatch(/Whole project/);
  await ui.unmount();
});
