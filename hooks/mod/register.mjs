// The code-kit mod: code-kit in the session, for the person. It draws and acts, but never enforces: the
// settings hooks beside it enforce the rules, in every session, CI and harness. Claude Code before
// 2.1.287 doesn't load this module and runs those hooks as before.
//
// Everything it shows comes from the code-kit CLI's JSON, run in the session's folder; the mod never
// imports hooks/lib, which uses node modules a hooks module may not. What it draws is built by the pure
// functions in view.mjs.
import {
  NOT_CODE_KIT,
  PANE_ID,
  agentsAtWork,
  lanesPane,
  parseJson,
  projectState,
} from './view.mjs';

let state = null; // the project as last read, for the pane
let refresh = null; // the open pane's refresh timer

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'lanes',
      description: "code-kit's lanes: agents, stories, branches and what's ready",
    });
    return next(e);
  });

  // PANE-1: /lanes opens the pane, and closes it when it's open. CARD-4: outside a code-kit project it
  // says so and opens nothing. PANE-4: while it's open it stays current.
  on('command.run', { command: 'lanes' }, async ($, e) => {
    // Asked, not remembered: the person may have closed it with Escape.
    const panes = await $.ui.panes();
    if (panes.some((p) => p.id === PANE_ID)) {
      refresh?.cancel();
      refresh = null;
      await $.ui.close({ id: PANE_ID });
      return {};
    }
    const cli = `${$.plugin.root}/bin/code-kit.mjs`;
    const cwd = await $.session.cwd();
    const json = async (...args) => {
      const ran = await $.process.run(['node', cli, ...args, '--json'], { cwd });
      return ran.exitCode === 0 ? parseJson(ran.stdout) : null;
    };
    const atWork = async () => agentsAtWork(await $.agent.list());
    // Everything the pane shows, read again; returns the config's check.
    const load = async () => {
      const ran = await $.process.run(['node', cli, 'check', '--json'], { cwd });
      const check = parseJson(ran.stdout);
      const [status, next] = check?.valid
        ? [await json('status'), await json('next')]
        : [null, null];
      state = projectState(check, status, next, await atWork());
      return check;
    };
    // What a refresh waits on: commits and branches, the plan, and the agents at work.
    const fingerprint = async (check) => {
      const refs = await $.process.run(
        ['git', 'for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads'],
        { cwd },
      );
      const planFile = check?.docs?.plan;
      const plan = planFile && (await $.fs.exists(planFile)) ? await $.fs.read(planFile) : '';
      return [refs.stdout, plan, [...(await atWork())].sort().join(',')].join('\n');
    };

    const check = await load();
    if (state.kind === 'none') return { text: NOT_CODE_KIT };
    const placed = await $.ui.open({
      id: PANE_ID,
      title: 'Lanes',
      focus: true,
      closeOnEscape: true,
    });
    $.ui.invalidate('ui.render');

    // Within 2 seconds of a change, and every 10 seconds regardless; never a model call.
    let seen = await fingerprint(check);
    let quiet = 0;
    let busy = false;
    refresh?.cancel();
    refresh = $.clock.every(2000, async () => {
      if (busy) return;
      busy = true;
      try {
        const open = await $.ui.panes();
        if (!open.some((p) => p.id === PANE_ID)) {
          refresh?.cancel();
          refresh = null;
          return;
        }
        const now = await fingerprint(check);
        quiet += 1;
        if (now === seen && quiet < 5) return;
        seen = now;
        quiet = 0;
        await load();
        $.ui.invalidate('ui.render');
      } finally {
        busy = false;
      }
    });
    // Opened but not drawn yet: it waits for room, and the reason says what seats it.
    if (!placed.isPlaced) return { text: `The Lanes pane is waiting: ${placed.reason}` };
    return {};
  });

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) =>
    lanesPane(state, $.ui.resolve(e)),
  );
}
