// The mod end to end through Claude Code's harness: `claude plugin test` (Claude Code 2.1.287 or later),
// which `npm test` runs when it's available. The CLI, git and the agents are stubbed with what they
// report; the CLI itself is tested in test/hooks.test.mjs, and the drawing in test/units.test.mjs.
import { expect, mock, test } from 'claude-code/testing';

const PANE = 'code-kit-lanes';
const APPROVE = 'code-kit-approve';
const RESULT = 'code-kit-result';
const SETTINGS = 'code-kit-settings';

/** A project as the stubs report it; tests change it to move the world on. */
function project() {
  return {
    check: {
      file: '.claude/code-kit.json',
      exists: true,
      valid: true,
      problems: [] as string[],
      lead: { paths: ['docs/**'] },
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
    delegateExit: 1,
    delegated: [] as string[][],
    holds: [] as string[][],
    draft: '', // what the person has typed in the prompt
    heads: { 'web/st-4': 'abc123def4567890\n' } as Record<string, string>,
    registered: [] as any[],
    queue: [] as any[],
    sent: [] as { to: any; text: string }[],
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
          requirements: {},
          problems: [],
          drift: [],
        }),
      );
    if (sub === 'next') return ran(0, JSON.stringify(w.next));
    if (sub === 'requests') return ran(0, JSON.stringify({ open: w.requests, inForce: w.inForce }));
    if (sub === 'verify')
      return ran(w.verifyExit, w.verifyExit ? '' : w.verifyOut, w.verifyExit ? w.verifyOut : '');
    if (sub === 'stops') return ran(0, JSON.stringify(w.stops));
    if (sub === 'queue' && argv[3] === 'merge') {
      w.acts.push([...argv.slice(2)]);
      w.queue = w.queue.map((e, i) => (i === 0 ? { ...e, state: 'merged' } : e));
      return ran(0, 'Merged web/st-4 into main: verify passed on 2 file(s). The queue is empty.');
    }
    if (sub === 'queue') return ran(0, JSON.stringify(w.queue));
    if (sub === 'approve' && argv.includes('--delegated')) {
      w.delegated.push([...argv.slice(2)]);
      if (w.delegateExit === 0) w.allowed = true;
      return ran(w.delegateExit, '', w.delegateExit ? 'Nothing was approved.' : '');
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
  on('agent.list', () => ({ value: w.agents }));
  on('agent.register', ($: any, e: any) => {
    w.registered.push(e);
    return { value: { agent: `code-kit:${e.name}` } };
  });
  on('prompt.read', () => ({ value: { text: w.draft, cursor: w.draft.length } }));
  on('session.send', ($: any, e: any) => {
    w.sent.push({ to: e.to, text: e.text });
    return { isDelivered: true };
  });
  on('turn.start', ($: any, e: any) => e);
  on('turn.complete', () => ({ text: '' }));
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: w.limits } }));
  on('session.measure', ($: any, e: any) => ({ changed: e.changed }));
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
    return { text: e.text };
  });
  // $.ui.ask is the AskUserQuestion dialog: the person picks a label.
  on('tool.call', { tool: 'AskUserQuestion' }, ($: any, e: any) => ({
    result: { questions: e.questions, answers: { [e.questions[0].question]: w.answer } },
  }));
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
  expect(await ui.find({ type: 'Text', text: /web-engineer/ })).toBeDefined();
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
  // The fifth reads it all (check, status, next, requests, stops, queue) between two looks at git.
  await clock.advance(2000);
  expect(w.runs - before).toBe(12);
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

test('ACT-3 Review asks the lead to run the review skill on the branch', async ($, on) => {
  const w = project();
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
  await heldCall($, w, clock);
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

test('HOLD-5 within the delegated rules the call is approved as delegated and runs, without asking', async ($, on) => {
  const w = project();
  w.refusal = webInstall;
  w.delegateExit = 0;
  await start($, on, w);
  const res: any = await $.tool.call({
    tool: 'Bash',
    tool_use_id: 'tu-d',
    command: 'npm install dayjs',
    agentId: 'a1',
  } as any);
  expect(refused(res)).toBe(false);
  expect(w.delegated[0]).toEqual(
    expect.arrayContaining(['approve', 'dep-dayjs', '--lane', 'web', '--delegated']),
  );
  expect(w.holds).toEqual([]);
});

test('HOLD-5 with autonomy propose the delegated rules are not tried; the call is held', async ($, on) => {
  const w = project();
  w.refusal = webInstall;
  w.delegateExit = 0;
  (w.check as any).harness = { autonomy: 'propose', hold: { minutes: 2 } };
  const clock = await start($, on, w);
  await heldCall($, w, clock);
  expect(w.delegated).toEqual([]);
  w.waiting.get('tu-h1')?.('timed out');
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
  expect((await ui.find({ key: 'step-0' }))?.text).toMatch(/dispatch\s*ST-9 ST-10 ST-11 ST-12/);
  await ui.unmount();
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
  expect(w.prompts).toHaveLength(1);
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

test('LOOP-3 a quiet lane agent is nudged at 5 minutes, restarted through the lead at 10, and flagged after 2 restarts', async ($, on) => {
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
    w.agents = [{ id, type: 'web-engineer', description: 'ST-4 booking form', status: 'running' }];
    await clock.advance(10 * 60000 + 2000);
  }
  expect(w.prompts).toHaveLength(2);
  const band = await bandUi($);
  expect(await band.find({ type: 'Text', text: 'web stalled 3 times on ST-4' })).toBeDefined();
  expect(await band.find({ key: 'band-resumeStall' })).toBeDefined();
  await band.unmount();
});

test('LOOP-3 an agent waiting on a held call (or running a long command) is never quiet', async ($, on) => {
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
});

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
  expect((await ui.find({ key: 'queue-web/st-4-waiting' }))?.text).toMatch(
    /1\.\s*web\/st-4\s*waiting/,
  );
  expect((await ui.find({ key: 'queue-api/st-3-sent back' }))?.text).toMatch(
    /conflicts with main after api\/st-2/,
  );
  expect((await ui.find({ key: 'lane-web' }))?.text).toMatch(/queued/);
  await ui.unmount();
});
