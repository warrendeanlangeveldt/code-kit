// The mod end to end through Claude Code's harness: `claude plugin test` (Claude Code 2.1.287 or later),
// which `npm test` runs when it's available. The CLI, git and the agents are stubbed with what they
// report; the CLI itself is tested in test/hooks.test.mjs, and the drawing in test/units.test.mjs.
import { expect, mock, test } from 'claude-code/testing';

const PANE = 'code-kit-lanes';

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
    refs: 'aaa refs/heads/main\nbbb refs/heads/web/st-4\n',
    agents: [] as { type: string; status: string }[],
    open: new Set<string>(),
    opened: [] as string[],
    closed: [] as string[],
    runs: 0,
  };
}

function stub(on: any, w: ReturnType<typeof project>) {
  on('process.run', ($: any, e: any) => {
    const argv: readonly string[] = e.argv;
    w.runs += 1;
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } });
    if (argv[0] === 'git') return ok(w.refs);
    if (argv.includes('check'))
      return {
        value: { exitCode: w.check.valid ? 0 : 1, stdout: JSON.stringify(w.check), stderr: '' },
      };
    if (argv.includes('status'))
      return ok(
        JSON.stringify({
          base: 'main',
          stories: w.stories,
          requirements: {},
          problems: [],
          drift: [],
        }),
      );
    if (argv.includes('next')) return ok(JSON.stringify(w.next));
    return { value: { exitCode: 1, stdout: '', stderr: `unexpected ${argv.join(' ')}` } };
  });
  on('agent.list', () => ({ value: w.agents }));
  on('fs.exists', () => ({ value: true }));
  on('fs.read', () => ({ value: '### ST-4 Booking form\n' }));
  on('session.cwd', () => ({ value: '/work' }));
  on('command.register', () => ({ value: undefined }));
  on('ui.panes', () => ({
    value: [...w.open].map((id) => ({ id, title: 'Lanes', isShown: true })),
  }));
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

const mount = ($: any) =>
  $.ui.mount({
    plugin: 'code-kit',
    component: 'Pane',
    requestId: PANE,
    surface: 'terminal',
    viewport: { columns: 120, rows: 40 },
    props: { title: 'Lanes', isFocused: true, bodyColumns: 80 },
  });
const lanes = ($: any) => $.command.run({ command: 'lanes', args: '' });

test('PANE-1 /lanes opens the Lanes pane, and /lanes again closes it', async ($, on) => {
  const w = project();
  stub(on, w);
  mock.clock(on);
  const first = await lanes($);
  expect(w.opened).toEqual([PANE]);
  expect(first.text ?? '').toBe('');
  await lanes($);
  expect(w.opened).toEqual([PANE]);
  expect(w.closed).toEqual([PANE]);
});

test('PANE-1 after Escape closes the pane, /lanes opens it again', async ($, on) => {
  const w = project();
  stub(on, w);
  mock.clock(on);
  await lanes($);
  w.open.clear(); // the person's Escape: the pane is no longer among those open
  await lanes($);
  expect(w.opened).toEqual([PANE, PANE]);
  await lanes($);
});

test('PANE-2 each lane shows its agent, story, branch and state', async ($, on) => {
  const w = project();
  stub(on, w);
  mock.clock(on);
  await lanes($);
  const ui = await mount($);
  expect(await ui.find({ key: 'lane-web' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /web-engineer/ })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: 'ST-4 Booking form · web/st-4' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /building/ })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /idle/ })).toBeDefined();
  await ui.unmount();
  await lanes($);
});

test('PANE-3 the ready stories are listed with their lanes, the lead stories as its own', async ($, on) => {
  const w = project();
  stub(on, w);
  mock.clock(on);
  await lanes($);
  const ui = await mount($);
  for (const id of ['ST-6', 'ST-7', 'ST-9'])
    expect(await ui.find({ key: `ready-${id}` })).toBeDefined();
  expect(await ui.findAll({ type: 'Text', text: "the lead's own" })).toHaveLength(2);
  await ui.unmount();
  await lanes($);
});

test('PANE-4 a lane that commits shows the change within 2 seconds', async ($, on) => {
  const w = project();
  stub(on, w);
  const clock = mock.clock(on);
  await lanes($);
  w.agents = [{ type: 'web-engineer', status: 'running' }];
  w.stories[0] = { ...w.stories[0], state: 'review' };
  w.refs = 'aaa refs/heads/main\nccc refs/heads/web/st-4\n';
  await clock.advance(2000);
  const building = await mount($);
  expect(await building.find({ type: 'Text', text: '●' })).toBeDefined();
  await building.unmount();
  // The agent finishes: the branch now waits for review, and the active mark goes.
  w.agents = [{ type: 'web-engineer', status: 'completed' }];
  await clock.advance(2000);
  const finished = await mount($);
  expect(await finished.find({ type: 'Text', text: /in review/ })).toBeDefined();
  expect(await finished.find({ type: 'Text', text: '●' })).toBeUndefined();
  await finished.unmount();
  await lanes($);
});

test('PANE-4 with nothing changed it reads the project again only every 10 seconds', async ($, on) => {
  const w = project();
  stub(on, w);
  const clock = mock.clock(on);
  await lanes($);
  const before = w.runs;
  await clock.advance(8000); // four quiet ticks: git only
  expect(w.runs - before).toBe(4);
  await clock.advance(2000); // the fifth reads it all again: git, check, status, next
  expect(w.runs - before).toBe(8);
  await lanes($);
});

test('CARD-4 outside a code-kit project, /lanes says so and opens nothing', async ($, on) => {
  const w = project();
  w.check = { ...w.check, exists: false, valid: false };
  stub(on, w);
  mock.clock(on);
  const res = await lanes($);
  expect(res.text).toBe("This project doesn't use code-kit.");
  expect(w.opened).toEqual([]);
});

test('PANE-5 an invalid config shows one line and no lanes', async ($, on) => {
  const w = project();
  w.check = { ...w.check, valid: false, problems: ['"lanes" must be an object'] };
  stub(on, w);
  mock.clock(on);
  await lanes($);
  const ui = await mount($);
  expect(
    await ui.find({ type: 'Text', text: /The config is invalid: run code-kit check\./ }),
  ).toBeDefined();
  expect(await ui.find({ key: 'lane-web' })).toBeUndefined();
  await ui.unmount();
  await lanes($);
});
