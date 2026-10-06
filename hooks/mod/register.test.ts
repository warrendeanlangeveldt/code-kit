// The mod end to end through Claude Code's harness: `claude plugin test` (Claude Code 2.1.287 or later),
// which `npm test` runs when it's available. The CLI, git and the agents are stubbed with what they
// report; the CLI itself is tested in test/hooks.test.mjs, and the drawing in test/units.test.mjs.
import { expect, mock, test } from 'claude-code/testing';

const PANE = 'code-kit-lanes';
const APPROVE = 'code-kit-approve';
const RESULT = 'code-kit-result';

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
    stops: [] as any[],
    refs: ' aaa refs/heads/main\n bbb refs/heads/web/st-4\n',
    agents: [] as { type: string; status: string }[],
    approveExit: 0,
    mergeExit: 0,
    answer: 'Merge',
    open: new Set<string>(),
    opened: [] as string[],
    closed: [] as string[],
    prompts: [] as string[],
    acts: [] as string[][],
    runs: 0,
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
    if (sub === 'requests') return ran(0, JSON.stringify({ open: w.requests, inForce: [] }));
    if (sub === 'stops') return ran(0, JSON.stringify(w.stops));
    if (sub === 'approve') {
      w.acts.push([...argv.slice(2)]);
      if (w.approveExit === 0) w.requests = [];
      return ran(w.approveExit, '', w.approveExit ? 'approve needs --reason' : '');
    }
    if (sub === 'merge') {
      w.acts.push([...argv.slice(2)]);
      return w.mergeExit
        ? ran(1, '', 'Nothing was merged. code-kit verify found 1 problem(s) on web/st-4')
        : ran(0, 'Merged web/st-4 into main.');
    }
    return ran(1, '', `unexpected ${argv.join(' ')}`);
  });
  on('session.start', () => ({ cwd: '/work' }));
  // Claude Code's own drawing, beneath the mod: nothing of code-kit's.
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }));
  on('agent.list', () => ({ value: w.agents }));
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } }));
  on('fs.list', () => ({ value: [] }));
  on('session.cwd', () => ({ value: '/work' }));
  on('session.id', () => ({ value: 's1' }));
  on('command.register', () => ({ value: undefined }));
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

/** A session started on the project, with the mock clock. */
async function start($: any, on: any, w: World) {
  stub(on, w);
  const clock = mock.clock(on);
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true });
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
  // The fifth reads it all (check, status, next, requests, stops) between two looks at git.
  await clock.advance(2000);
  expect(w.runs - before).toBe(11);
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
  expect(await confirm.find({ type: 'Text', text: /for 60 minutes/ })).toBeDefined();
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
  on('turn.start', ($: any, e: any) => e);
  on('turn.complete', () => ({ text: '' }));
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
