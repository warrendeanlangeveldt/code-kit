// The mod end to end through Claude Code's harness: `claude plugin test` (Claude Code 2.1.287 or later),
// which `npm test` runs when it's available. The CLI is stubbed with the JSON it prints; the CLI itself
// is tested in test/hooks.test.mjs.
import { expect, test } from 'claude-code/testing';

const valid = JSON.stringify({
  file: '.claude/code-kit.json',
  exists: true,
  valid: true,
  problems: [],
  lead: { paths: ['docs/**'] },
  lanes: { web: { agent: 'web-engineer', paths: ['apps/web/**'] } },
  adapters: [],
});
const missing = JSON.stringify({
  file: '.claude/code-kit.json',
  exists: false,
  valid: false,
  problems: [],
});
const invalid = JSON.stringify({
  file: '.claude/code-kit.json',
  exists: true,
  valid: false,
  problems: ['"lanes" must be an object'],
});
const status = JSON.stringify({
  base: 'main',
  stories: [],
  requirements: {},
  problems: [],
  drift: [],
});

/** Stubs the CLI: check prints `check`, status prints a plan with no gaps. */
function cli(
  on: any,
  check: string,
  opened: string[],
  closed: string[] = [],
  open = new Set<string>(),
) {
  on('ui.panes', () => ({ value: [...open].map((id) => ({ id, title: 'Lanes', isShown: true })) }));
  on('process.run', ($: any, e: any) => {
    const argv: readonly string[] = e.argv;
    const out = argv.includes('check') ? check : status;
    return {
      value: {
        exitCode: argv.includes('check') && check !== valid ? 1 : 0,
        stdout: out,
        stderr: '',
      },
    };
  });
  on('session.cwd', () => ({ value: '/work' }));
  on('command.register', () => ({ value: undefined }));
  on('ui.open', ($: any, e: any) => {
    opened.push(e.id);
    open.add(e.id);
    return { value: { isPlaced: true } };
  });
  on('ui.close', ($: any, e: any) => {
    closed.push(e.id);
    open.delete(e.id);
    return { value: undefined };
  });
}

test('PANE-1 /lanes opens the Lanes pane, and /lanes again closes it', async ($, on) => {
  const opened: string[] = [];
  const closed: string[] = [];
  cli(on, valid, opened, closed);
  const first = await $.command.run({ command: 'lanes', args: '' });
  expect(opened).toEqual(['code-kit-lanes']);
  expect(first.text ?? '').toBe('');
  await $.command.run({ command: 'lanes', args: '' });
  expect(opened).toEqual(['code-kit-lanes']);
  expect(closed).toEqual(['code-kit-lanes']);
});

test('PANE-1 after Escape closes the pane, /lanes opens it again', async ($, on) => {
  const opened: string[] = [];
  const open = new Set<string>();
  cli(on, valid, opened, [], open);
  await $.command.run({ command: 'lanes', args: '' });
  open.clear();
  // The person's Escape: the pane is no longer among those open.
  await $.command.run({ command: 'lanes', args: '' });
  expect(opened).toEqual(['code-kit-lanes', 'code-kit-lanes']);
  await $.command.run({ command: 'lanes', args: '' });
});

test('PANE-1 the pane lists the lanes with their agents', async ($, on) => {
  const opened: string[] = [];
  cli(on, valid, opened);
  await $.command.run({ command: 'lanes', args: '' });
  const ui = await $.ui.mount({
    plugin: 'code-kit',
    component: 'Pane',
    requestId: 'code-kit-lanes',
    surface: 'terminal',
    viewport: { columns: 100, rows: 30 },
    props: { title: 'Lanes', isFocused: true, bodyColumns: 60 },
  });
  expect(await ui.find({ key: 'lane-web' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /web-engineer/ })).toBeDefined();
  await ui.unmount();
  await $.command.run({ command: 'lanes', args: '' });
});

test('CARD-4 outside a code-kit project, /lanes says so and opens nothing', async ($, on) => {
  const opened: string[] = [];
  cli(on, missing, opened);
  const res = await $.command.run({ command: 'lanes', args: '' });
  expect(res.text).toBe("This project doesn't use code-kit.");
  expect(opened).toEqual([]);
});

test('PANE-5 an invalid config shows one line and no lanes', async ($, on) => {
  const opened: string[] = [];
  cli(on, invalid, opened);
  await $.command.run({ command: 'lanes', args: '' });
  const ui = await $.ui.mount({
    plugin: 'code-kit',
    component: 'Pane',
    requestId: 'code-kit-lanes',
    surface: 'terminal',
    viewport: { columns: 100, rows: 30 },
    props: { title: 'Lanes', isFocused: true, bodyColumns: 60 },
  });
  expect(
    await ui.find({ type: 'Text', text: /The config is invalid: run code-kit check\./ }),
  ).toBeDefined();
  expect(await ui.find({ key: 'lane-web' })).toBeUndefined();
  await ui.unmount();
  await $.command.run({ command: 'lanes', args: '' });
});
