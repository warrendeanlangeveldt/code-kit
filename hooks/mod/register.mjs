// The code-kit mod: code-kit in the session, for the person. It draws and acts, but never enforces: the
// settings hooks beside it enforce the rules, in every session, CI and harness. Claude Code before
// 2.1.287 doesn't load this module and runs those hooks as before.
//
// Everything it shows comes from the code-kit CLI's JSON, run in the session's folder; the mod never
// imports hooks/lib, which uses node modules a hooks module may not. What it draws is built by the pure
// functions in view.mjs.
import { NOT_CODE_KIT, PANE_ID, lanesPane, parseJson, projectState } from './view.mjs';

let state = null; // the project as last read, for the pane

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'lanes',
      description: "code-kit's lanes: agents, stories, branches and what's ready",
    });
    return next(e);
  });

  // PANE-1: /lanes opens the pane, and closes it when it's open. CARD-4: outside a code-kit project it
  // says so and opens nothing.
  on('command.run', { command: 'lanes' }, async ($, e) => {
    // Asked, not remembered: the person may have closed it with Escape.
    const panes = await $.ui.panes();
    if (panes.some((p) => p.id === PANE_ID)) {
      await $.ui.close({ id: PANE_ID });
      return {};
    }
    const cli = `${$.plugin.root}/bin/code-kit.mjs`;
    const cwd = await $.session.cwd();
    const checked = await $.process.run(['node', cli, 'check', '--json'], { cwd });
    const check = parseJson(checked.stdout);
    let status = null;
    if (check?.valid) {
      const ran = await $.process.run(['node', cli, 'status', '--json'], { cwd });
      status = ran.exitCode === 0 ? parseJson(ran.stdout) : null;
    }
    state = projectState(check, status);
    if (state.kind === 'none') return { text: NOT_CODE_KIT };
    const placed = await $.ui.open({
      id: PANE_ID,
      title: 'Lanes',
      focus: true,
      closeOnEscape: true,
    });
    // Opened but not drawn yet: it waits for room, and the reason says what seats it.
    if (!placed.isPlaced) return { text: `The Lanes pane is waiting: ${placed.reason}` };
    $.ui.invalidate('ui.render');
    return {};
  });

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) =>
    lanesPane(state, $.ui.resolve(e)),
  );
}
