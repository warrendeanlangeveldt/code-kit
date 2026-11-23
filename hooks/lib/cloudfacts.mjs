// A project's cloud machine (spec 32), the parts a hub shares with code-kit: the machine's name from its
// folder and its remote (CLOUD-11), and the machine workflow (CLOUD-15) as a file, as its steps with the
// act each runs for, and whether a file a repository holds is code-kit's. Nothing of a project is read
// here, so a hub that draws a run's steps, or names the machine a run will make, says what code-kit says.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (path) =>
  readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const VERSION = JSON.parse(read('.claude-plugin/plugin.json')).version;

/** A git remote's address as a machine with an https credential can use it. */
export function httpsRemote(url) {
  const scp = String(url).match(/^(?:[\w.-]+@)?([\w.-]+\.[a-z]{2,}):(?!\/)(.+)$/i);
  if (scp) return `https://${scp[1]}/${scp[2]}`;
  const ssh = String(url).match(/^ssh:\/\/(?:[\w.-]+@)?([\w.-]+)(?::\d+)?\/(.+)$/i);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  return String(url);
}

/** A project's folder name, as a machine's folder and name can hold it. */
export const folderName = (name) =>
  String(name)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '') || 'project';

/**
 * CLOUD-11: a project's machine, named from its folder and a hash of its remote's address, so a second
 * computer with the same clone, and a workflow's checkout of the repository, find the same one.
 */
export function machineNameOf(folder, remote) {
  const address = httpsRemote(remote)
    .replace(/\.git$/, '')
    .toLowerCase();
  const hash = createHash('sha256').update(address).digest('hex').slice(0, 8);
  const slug = folderName(folder)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return `ck-${slug || 'project'}-${hash}`;
}

/** Where a repository keeps the machine workflow. */
export const WORKFLOW_FILE = '.github/workflows/code-kit-machine.yml';
/** What the workflow is asked to do: `up` makes the machine ready, `down` removes it. */
export const MACHINE_ACTS = ['up', 'start', 'stop', 'down'];

/** What the workflow does first, whatever it was asked: written out in the template. */
const FIRST_STEPS = [
  { name: 'Check out the repository', stage: 'prepare' },
  { name: 'Set up Node', stage: 'prepare' },
];
/** What it does for each act, after the platform's steps: code-kit's own commands, run unattended. */
const ACT_STEPS = [
  {
    name: 'Make the machine',
    stage: 'machine',
    act: 'up',
    run: '$CODE_KIT cloud up --unattended --platform {{key}} --stage machine',
  },
  {
    name: 'Copy the repository there',
    stage: 'clone',
    act: 'up',
    run: '$CODE_KIT cloud up --unattended --platform {{key}} --stage clone',
  },
  {
    name: 'Install code-kit and the terminal there',
    stage: 'ready',
    act: 'up',
    run: '$CODE_KIT cloud up --unattended --platform {{key}}',
  },
  {
    name: "Start the lead's session",
    stage: 'start',
    act: 'start',
    run: '$CODE_KIT cloud open --unattended --platform {{key}}',
  },
  {
    name: "Stop the lead's session",
    stage: 'stop',
    act: 'stop',
    run: '$CODE_KIT cloud stop --unattended --platform {{key}}',
  },
  {
    name: 'Remove the machine',
    stage: 'remove',
    act: 'down',
    env: { DISCARD: "${{ inputs.discard && '--discard' || '' }}" },
    run: '$CODE_KIT cloud down --unattended --platform {{key}} $DISCARD',
  },
];

/**
 * The workflow's steps in the order they run, each { name, stage, acts }: the acts it runs for, and what
 * it is a stage of (`prepare`: the runner made ready; `signin`: the platform's token read from the
 * repository's secret; then `machine`, `clone`, `ready`, `start`, `stop` and `remove`). Whoever draws a
 * run or says what a failed one needs reads the stage, never the name.
 */
export function workflowSteps(adapter) {
  if (!adapter.workflow) return [];
  return [
    ...FIRST_STEPS.map((st) => ({ name: st.name, stage: st.stage, acts: [...MACHINE_ACTS] })),
    ...adapter.workflow.steps.map((st) => ({
      name: st.name,
      stage: st.stage ?? 'prepare',
      acts: [...MACHINE_ACTS],
    })),
    ...ACT_STEPS.map((st) => ({ name: st.name, stage: st.stage, acts: [st.act] })),
  ];
}

const indent = (text, by) =>
  text
    .split('\n')
    .map((l) => (l ? `${' '.repeat(by)}${l}` : l))
    .join('\n');
/** A step as the workflow file writes it: a command of several lines as a block. */
const stepYaml = (st) =>
  [
    `      - name: ${st.name}`,
    ...(st.act ? [`        if: inputs.act == '${st.act}'`] : []),
    ...(st.env
      ? ['        env:', ...Object.entries(st.env).map(([k, v]) => `          ${k}: ${v}`)]
      : []),
    ...(st.run.includes('\n')
      ? ['        run: |', indent(st.run, 10)]
      : [`        run: ${st.run}`]),
  ].join('\n');

const render = (adapter, version) =>
  read('templates/cloud-machine.yml')
    .replace('      #{{steps}}', [...adapter.workflow.steps, ...ACT_STEPS].map(stepYaml).join('\n'))
    .replaceAll('{{version}}', version)
    .replaceAll('{{platform}}', adapter.label)
    .replaceAll('{{key}}', adapter.key)
    .replaceAll('{{secret}}', adapter.workflow.secret);

/**
 * CLOUD-15: the workflow a repository commits so that its machine is made, started, stopped and removed
 * with nobody at a computer: code-kit's own file, with the platform's steps from its adapter and this
 * code-kit's version in the commands it runs. The same text for the same adapter and version, so a
 * committed file can be told from one changed by hand.
 */
export function machineWorkflow(adapter) {
  return adapter.workflow ? render(adapter, VERSION) : null;
}

/**
 * Whether a file a repository holds is code-kit's (CLOUD-15): `current` for this version's, `version`
 * for another version's whose steps are these (with the version it names), and `changed` for anything
 * else, a file changed by hand included. Line endings and the file's last newline aren't a change.
 */
export function workflowStanding(text, adapter) {
  if (!adapter.workflow || typeof text !== 'string') return { is: 'changed', version: null };
  const same = (a, b) => a.replace(/\r\n/g, '\n').trimEnd() === b.trimEnd();
  if (same(text, render(adapter, VERSION))) return { is: 'current', version: VERSION };
  const version = text.match(/^# code-kit (\d+\.\d+\.\d+(?:-[\w.]+)?):/)?.[1] ?? null;
  return version && same(text, render(adapter, version))
    ? { is: 'version', version }
    : { is: 'changed', version: null };
}
