// What the code-kit mod shows, as pure functions of the CLI's JSON: the mod's hooks run the CLI and
// pass its output here, and pass the elements `$.ui.resolve` gives them. Nothing here touches the mods
// API, files or processes, so it is tested with node as well as with `claude plugin test`.

export const PANE_ID = 'code-kit-lanes';
export const NOT_CODE_KIT = "This project doesn't use code-kit.";

/** A CLI run's stdout as JSON, or null when it printed none. */
export function parseJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/**
 * Where the project stands, from `code-kit check --json` and, when the config is valid and names a
 * plan, `code-kit status --json` (null when it has none, or the run failed):
 *   { kind: 'none' }                         no .claude/code-kit.json
 *   { kind: 'invalid', problems }            a config that doesn't validate
 *   { kind: 'ok', lanes, planGaps }          lanes with their agents, and the plan's gaps (or null)
 */
export function projectState(check, status) {
  if (!check || check.exists === false) return { kind: 'none' };
  if (!check.valid) return { kind: 'invalid', problems: check.problems ?? [] };
  const lanes = [
    { name: 'lead', agent: null },
    ...Object.entries(check.lanes ?? {}).map(([name, l]) => ({ name, agent: l.agent })),
  ];
  return { kind: 'ok', lanes, planGaps: status ? (status.problems ?? []).length : null };
}

/** The Lanes pane's body, drawn with the elements `$.ui.resolve(e)` returned. */
export function lanesPane(state, { Box, Text }) {
  const line = (text, style = {}) => Text({ ...style, children: [text] });
  if (!state || state.kind === 'none') return line(NOT_CODE_KIT, { dimColor: true });
  if (state.kind === 'invalid')
    return line('The config is invalid: run code-kit check.', { color: 'red' });
  const width = Math.max(...state.lanes.map((l) => l.name.length));
  const rows = state.lanes.map((l) =>
    Box({
      key: `lane-${l.name}`,
      flexDirection: 'row',
      columnGap: 2,
      children: [
        line(l.name.padEnd(width), { bold: true }),
        line(l.agent ?? 'the main session', { dimColor: true }),
      ],
    }),
  );
  const notes = [];
  if (state.planGaps)
    notes.push(
      line(`The plan has ${state.planGaps} gap(s): run code-kit status.`, { color: 'yellow' }),
    );
  return Box({ flexDirection: 'column', children: [...notes, ...rows] });
}
