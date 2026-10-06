// The code-kit mod: code-kit in the session, for the person. It draws and acts, but never enforces: the
// settings hooks beside it enforce the rules, in every session, CI and harness. Claude Code before
// 2.1.287 doesn't load this module and runs those hooks as before.
//
// Everything it shows comes from the code-kit CLI's JSON, run in the session's folder; the mod never
// imports hooks/lib, which uses node modules a hooks module may not. What it draws is built by the pure
// functions in view.mjs. It acts only on the person's presses: approving (`approve --via pane`), asking
// the lead to review, and merging (`merge --person`). No agent reaches those: they are the mod's own
// buttons, and the hooks refuse both commands from every agent.
import {
  APPROVE_ID,
  NOT_CODE_KIT,
  PANE_ID,
  RESULT_ID,
  approvalsText,
  agentsAtWork,
  approvePane,
  band,
  bandLines,
  lanesPane,
  parseJson,
  prefilledReason,
  projectState,
  refusalCard,
  refusalView,
  resultPane,
} from './view.mjs';

// What the session knows of the project, read again when it changes.
let model = { state: null, requests: null, stops: [] };
let reviewing = new Set(); // stories the person asked the lead to review (ACT-3)
let reviewTurn = null; // 'next' until the lead's review turn starts, then its id
let approving = null; // the open Approve… confirmation: { request, reason, error }
let result = null; // what the last merge reported
let notice = null; // why the person's last act failed
let act = null; // the session's actions, made at session start
const refusals = new Map(); // tool_use_id → the refusal text a hook gave (CARD-1)
const expanded = new Set(); // cards showing their raw text
const REFUSALS_KEPT = 200;

export function register(on) {
  on('session.start', async ($, e, next) => {
    // A name another command already holds is refused; the rest of the mod goes on without it.
    const unavailable = (name) => (err) =>
      $.ui.log(`code-kit: /${name} isn't available in this session: ${err?.message ?? err}`);
    await $.command
      .register({
        name: 'lanes',
        description: "code-kit's lanes: agents, stories, branches and what's ready",
        immediate: true,
      })
      .catch(unavailable('lanes'));
    await $.command
      .register({
        name: 'approvals',
        description: "code-kit's approval requests waiting, and the approvals in force",
        immediate: true,
      })
      .catch(unavailable('approvals'));
    await $.command
      .register({
        name: 'verify-branch',
        description: 'Run code-kit verify on this branch, checks included',
      })
      .catch(unavailable('verify-branch'));
    const cli = `${$.plugin.root}/bin/code-kit.mjs`;
    const cwd = e.cwd ?? (await $.session.cwd());
    const session = await $.session.id();
    const json = async (...args) => {
      const ran = await $.process.run(['node', cli, ...args, '--json'], { cwd });
      return ran.exitCode === 0 ? parseJson(ran.stdout) : null;
    };
    const stamp = async (path) => {
      const s = await $.fs.stat(`${cwd}/${path}`).catch(() => null);
      return s ? `${path}@${s.mtimeMs}` : `${path}-`;
    };
    const listing = async (path) => {
      const entries = await $.fs.list(`${cwd}/${path}`).catch(() => []);
      const stamps = [];
      for (const entry of entries)
        stamps.push(
          entry.kind === 'dir'
            ? await listing(`${path}/${entry.name}`)
            : await stamp(`${path}/${entry.name}`),
        );
      return stamps.join(',');
    };

    act = {
      // Everything the band and the pane show, read again.
      reload: async () => {
        const ran = await $.process.run(['node', cli, 'check', '--json'], { cwd });
        const check = parseJson(ran.stdout);
        const valid = Boolean(check?.valid);
        const status = valid ? await json('status') : null;
        const nextStep = valid ? await json('next') : null;
        const requests = valid ? await json('requests') : null;
        const stops = valid ? ((await json('stops', '--session', session)) ?? []) : [];
        const atWork = agentsAtWork(await $.agent.list());
        model = {
          state: projectState(check, status, nextStep, atWork),
          requests,
          stops,
          check,
          base: status?.base ?? null,
        };
        $.ui.invalidate('ui.render');
      },
      // What a refresh waits on, read cheaply: branches and HEAD, the config and the plan, requests,
      // approvals and finish checks, and the agents at work. Only a change runs the CLI.
      fingerprint: async () => {
        const refs = await $.process.run(
          ['git', 'for-each-ref', '--format=%(HEAD)%(objectname) %(refname)', 'refs/heads'],
          { cwd },
        );
        const plan = model.check?.docs?.plan;
        return [
          refs.stdout,
          await stamp('.claude/code-kit.json'),
          plan ? await stamp(plan) : '',
          await stamp('.claude/state/requests.jsonl'),
          await listing('.claude/approvals'),
          await listing('.claude/state/stop-blocks'),
          [...agentsAtWork(await $.agent.list())].sort().join(','),
        ].join('\n');
      },
      // PANE-1: open the Lanes pane, or close it when it's open.
      lanes: async () => {
        // Asked, not remembered: the person may have closed it with Escape.
        if ((await $.ui.panes()).some((p) => p.id === PANE_ID)) {
          await $.ui.close({ id: PANE_ID });
          return {};
        }
        await act.reload();
        if (model.state.kind === 'none') return { text: NOT_CODE_KIT };
        const placed = await $.ui.open({
          id: PANE_ID,
          title: 'Lanes',
          focus: true,
          closeOnEscape: true,
        });
        // Opened but not drawn yet: it waits for room, and the reason says what seats it.
        if (!placed.isPlaced) return { text: `The Lanes pane is waiting: ${placed.reason}` };
        return {};
      },
      // ACT-1: the confirmation, prefilled from the request.
      approve: async (line) => {
        approving = { request: line.request, reason: prefilledReason(line.request), error: null };
        await $.ui.open({ id: APPROVE_ID, title: 'Approve', focus: true, closeOnEscape: true });
        $.ui.invalidate('ui.render');
      },
      confirmApproval: async (reason) => {
        if (!approving) return;
        if (!reason.trim()) {
          approving = { ...approving, error: 'Give a reason: it goes in the approval log.' };
          $.ui.invalidate('ui.render');
          return;
        }
        const { request } = approving;
        const ran = await $.process.run(
          [
            'node',
            cli,
            'approve',
            ...request.names,
            ...(request.lane ? ['--lane', request.lane] : []),
            '--reason',
            reason.trim(),
            '--via',
            'pane',
          ],
          { cwd },
        );
        if (ran.exitCode !== 0) {
          const why = (ran.stderr || ran.stdout).trim().split('\n')[0];
          notice = `Nothing was approved: ${why}`;
          approving = { ...approving, error: notice };
          $.ui.invalidate('ui.render');
          return;
        }
        approving = null;
        notice = null;
        await $.ui.close({ id: APPROVE_ID });
        await act.reload();
      },
      cancelApproval: async () => {
        approving = null;
        await $.ui.close({ id: APPROVE_ID });
      },
      // ACT-3: ask the lead, and show the story as being reviewed until its turn ends.
      review: async (line) => {
        reviewing.add(line.story.id);
        reviewTurn = 'next';
        $.ui.invalidate('ui.render');
        await $.prompt.submit({
          text: `Review ${line.story.id} (${line.story.title}): run /code-kit:review ${line.story.branch}.`,
        });
      },
      // ACT-4: confirm, then verify and merge as the person; nothing merges unless verify passes.
      merge: async (line) => {
        const { branch } = line.story;
        const into = model.base ?? 'the base branch';
        const answer = await $.ui
          .ask(
            `Merge ${branch} into ${into}? code-kit verify runs first, checks included, and nothing merges unless it passes.`,
            ['Merge', 'Cancel'],
          )
          .catch(() => 'Cancel');
        if (answer !== 'Merge') return;
        const ran = await $.process.run(['node', cli, 'merge', branch, '--person'], {
          cwd,
          timeoutMs: 600000,
        });
        result = {
          ok: ran.exitCode === 0,
          title: ran.exitCode === 0 ? `Merged ${branch}` : `Nothing merged: ${branch}`,
          text: `${ran.stdout}${ran.stderr}`.trim(),
        };
        await $.ui.open({ id: RESULT_ID, title: 'Merge', focus: true, closeOnEscape: true });
        await act.reload();
      },
      // CARD-2: no model call; the transcript shows it.
      approvals: async () => {
        await act.reload();
        if (model.state.kind === 'none') return { text: NOT_CODE_KIT };
        return { text: approvalsText(model.requests) };
      },
      // CARD-3: verify's own report, checks included.
      verify: async () => {
        if (model.state?.kind === 'none') return { text: NOT_CODE_KIT };
        const ran = await $.process.run(['node', cli, 'verify'], { cwd, timeoutMs: 600000 });
        return { text: `${ran.stdout}${ran.stderr}`.trim() };
      },
      dismiss: async () => {
        notice = null;
        $.ui.invalidate('ui.render');
      },
    };

    // PANE-4 and BAND-3: within 2 seconds of a change. With nothing changed, the project is read
    // again every 10 seconds while the pane is open, and every minute otherwise (approvals expire).
    let seen = null;
    let quiet = 0;
    let busy = false;
    $.clock.every(2000, async () => {
      if (busy) return;
      busy = true;
      try {
        const now = await act.fingerprint();
        const paneOpen = (await $.ui.panes()).some((p) => p.id === PANE_ID);
        quiet += 1;
        if (now === seen && quiet < (paneOpen ? 5 : 30)) return;
        quiet = 0;
        await act.reload();
        // Taken again: what it covers (the plan) can change with what was read.
        seen = await act.fingerprint();
      } finally {
        busy = false;
      }
    });
    return next(e);
  });

  const starting = (name) => ({
    text: `code-kit is still starting; try /${name} again in a moment.`,
  });
  on('command.run', { command: 'lanes' }, async ($, e) => (act ? act.lanes() : starting('lanes')));
  on('command.run', { command: 'approvals' }, async ($, e) =>
    act ? act.approvals() : starting('approvals'),
  );
  on('command.run', { command: 'verify-branch' }, async ($, e) =>
    act ? act.verify() : starting('verify-branch'),
  );

  // CARD-1: the text a code-kit hook refused a call with, kept for the call's result to draw as a card.
  on('tool.call', async ($, e, next) => {
    const res = await next(e);
    const text = res?.deny ?? (res?.isError ? (res.text ?? String(res.result ?? '')) : null);
    if (text && refusalCard(text)) {
      refusals.set(e.tool_use_id, text);
      if (refusals.size > REFUSALS_KEPT) refusals.delete(refusals.keys().next().value);
    }
    return res;
  }).catch(($, e, next) => next(e)); // it only watches: whatever fails here, the call goes on as it would
  // A refused call's text: kept from its tool.call, or the output its row carries (what the model read).
  const refusalOf = (id, output) =>
    refusalCard(refusals.get(id) ?? (typeof output === 'string' ? output : null));
  // Shell calls fold into one line ("Ran 1 shell command"); a group holding a refusal unfolds, so
  // the refused call's row can be drawn as its card.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const refused = e.props.calls.some((c) => c.tool_use_id && refusalOf(c.tool_use_id, c.output));
    return refused && !e.props.isExpanded
      ? next({ ...e, props: { ...e.props, isExpanded: true } })
      : next(e);
  });
  // The card takes the call's row; the result block beneath a standalone row is then left empty.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const card = refusalOf(e.props.tool_use_id, e.props.output);
    if (!card || !act) return next(e);
    return $.ui.resolve(e).Box({ children: [] });
  });
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const id = e.props.tool_use_id;
    const card = refusalOf(id, e.props.output);
    if (!card || !act) return next(e);
    return refusalView(card, expanded.has(id), $.ui.resolve(e), {
      onApprove: () => act.approve({ request: card.request }),
      onToggle: () => {
        if (expanded.has(id)) expanded.delete(id);
        else expanded.add(id);
        $.ui.invalidate('ui.render');
      },
    });
  });

  on('turn.start', async ($, e, next) => {
    if (reviewTurn === 'next') reviewTurn = e.turnId;
    return next(e);
  });
  // The lead has reported on the review it was asked for.
  on('turn.complete', async ($, e, next) => {
    if (reviewTurn && reviewTurn === e.turnId) {
      reviewing = new Set();
      reviewTurn = null;
      $.ui.invalidate('ui.render');
    }
    return next(e);
  });

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) =>
    lanesPane(model.state, $.ui.resolve(e)),
  );

  // BAND-2: absent when nothing waits.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const lines = bandLines({ ...model, reviewing, notice });
    if (!lines.length || !act) return next(e);
    return band(lines, $.ui.resolve(e), (id, line) => act[id](line));
  });

  on('ui.render', { component: 'Pane', requestId: APPROVE_ID }, async ($, e) => {
    if (!approving) return resultPane(null, $.ui.resolve(e));
    return approvePane(approving, $.ui.resolve(e), {
      onInput: (value) => {
        approving = { ...approving, reason: value };
        $.ui.invalidate('ui.render');
      },
      onSubmit: (value) => act.confirmApproval(value),
      onCancel: () => act.cancelApproval(),
    });
  });

  on('ui.render', { component: 'Pane', requestId: RESULT_ID }, async ($, e) =>
    resultPane(result, $.ui.resolve(e)),
  );
}
