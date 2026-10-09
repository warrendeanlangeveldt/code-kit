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
  SETTINGS_ID,
  approvalsText,
  agentsAtWork,
  attribution,
  approvePane,
  band,
  bandLines,
  finishedStories,
  ago,
  parseJson,
  planOf,
  prefilledReason,
  projectState,
  refusalCard,
  refusalView,
  resultPane,
  settingsView,
  usageSummary,
  withUsage,
} from './view.mjs';
import { holdable } from './hold.mjs';
import {
  DEFAULT_UI,
  SENDBACK_ID,
  lanesFrame,
  liveLevel,
  sendBackPane,
  toolLine,
} from './panes.mjs';
import { leadPrompt, nudgeText, restartPrompt, stallDue, stepKey, stepLabel } from './loop.mjs';
import { harnessSettings } from '../lib/harness.mjs';
import {
  REVIEW_WAIT_MS,
  findingsCount,
  leadReviewPrompt,
  readReport,
  reviewerSpec,
  startReviewerPrompt,
  withVerify,
} from './review.mjs';

// What the session knows of the project, read again when it changes.
let model = { state: null, requests: null, stops: [] };
let reviewing = new Set(); // stories the person asked the lead to review (ACT-3)
let reviewTurn = null; // 'next' until the lead's review turn starts, then its id
let approving = null; // the open Approve… confirmation: { request, reason, error }
let result = null; // what the last merge reported
let notice = null; // why the person's last act failed
let act = null; // the session's actions, made at session start
let settingRows = []; // the harness settings, from `code-kit settings --json`
let pendingSetting = null; // a change waiting for the person's reason: { key, value, reason, error }
let ledger = {}; // the session's tokens by agent and story (USE-1)
let rateLimits = []; // the session's limits, as session.measure last gave them
const agentsSeen = new Map(); // agent id → its $.agent.list() entry, kept once it leaves the list
const held = new Map(); // tool_use_id → a call held for the person (HOLD-2)
let where = null; // { cli, cwd, interactive }, from session start
// The lead loop (spec 05): what it did, and what it waits on.
const loop = {
  paused: false,
  started: false, // it has taken a step this session: from then on it also acts between turns
  steps: [], // { at, kind, target, prompt? }, kept for the session
  lastKey: null, // the last step submitted or proposed, and the project as it stood then
  lastPrint: null,
  proposal: null, // under autonomy propose: { step, prompt, label }
  pending: [], // restarts waiting for the lead to be idle: { story, prompt }
  done: null, // { count } once every story is done
  doneDismissed: false,
};
let leadTurn = null; // the lead's running turn, if any
const activity = new Map(); // agent id → { at, inFlight, nudged, stopped, lane, story }
const restarts = new Map(); // story → times the loop restarted it
const flagged = new Map(); // story → { lane, story, count }: stalled past its restarts
/** An agent's activity record, made on first sight. */
const activityOf = (agentId, now) => {
  let a = activity.get(agentId);
  if (!a) activity.set(agentId, (a = { at: now, inFlight: 0, nudged: false, stopped: false }));
  return a;
};
const harness = () => harnessSettings(model.check?.harness);
// Panes v2 (spec 11): the Lanes pane's own state, the lead's last tool call, and a send-back waiting
// for the person's reason.
let paneUi = { ...DEFAULT_UI };
let leadLast = null; // { tool, at }
let sendingBack = null; // { lane, branch, story, reason, error }
const personAsks = []; // prompts the person asked for (stop an agent), waiting for the lead to be idle
// The reviewer (spec 07): each branch's review at its head, and the agent type registered for it.
const reviews = new Map(); // branch → { branch, head, story, state, startedAt, findings, why?, error? }
let reviewerAgent = null; // the registered agent's full name
let reviewerModel = null; // the model it was registered with ('' for the session's)
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
    await $.command
      .register({
        name: 'harness',
        description: "code-kit's harness settings: autonomy, agents, hold time",
        immediate: true,
      })
      .catch(unavailable('harness'));
    rateLimits = (await $.session.usage().catch(() => null))?.rateLimits ?? [];
    const cli = `${$.plugin.root}/bin/code-kit.mjs`;
    const cwd = e.cwd ?? (await $.session.cwd());
    const session = await $.session.id();
    where = { cli, cwd, interactive: e.isInteractive !== false };
    // The held call's answer, for the `code-kit hold` it waits in.
    const answerHeld = (id, answer) =>
      $.process.run(['node', cli, 'hold', id, '--answer', answer], { cwd });
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
        const queue = valid ? ((await json('queue')) ?? []) : [];
        const atWork = agentsAtWork(await $.agent.list());
        model = {
          state: projectState(check, status, nextStep, atWork),
          requests,
          stops,
          queue,
          check,
          base: status?.base ?? null,
        };
        if (model.state.kind === 'ok') await act.registerReviewer();
        $.ui.invalidate('ui.render');
      },
      // REVW-2: the reviewer, read-only by the hooks' rule for agents outside the lanes. Registered
      // again when its model setting changes.
      registerReviewer: async () => {
        const wanted = harness().agents.reviewer.model ?? '';
        if (reviewerModel === wanted) return;
        reviewerModel = wanted;
        const spec = reviewerSpec({
          cli,
          checklist: `${$.plugin.root}/skills/review/SKILL.md`,
          model: wanted || undefined,
        });
        reviewerAgent =
          (
            await $.agent.register(spec).catch((err) => {
              $.ui.log(`code-kit: the reviewer agent isn't available: ${err?.message ?? err}`);
              return null;
            })
          )?.agent ?? null;
      },
      // REVW-1, REVW-4, LOOP-4: for stories in review, start the reviewer at each branch's head, and
      // once it has reported (or failed, or was skipped) prompt the lead's review with its findings.
      // Null while every review is still running.
      reviewStep: async (step) => {
        const now = await $.clock.now();
        const plan = planOf(rateLimits, harness().background.pauseAtPercent);
        for (const id of (step.args ?? '').split(/\s+/).filter(Boolean)) {
          const story = (model.state.stories ?? []).find((s) => s.id === id);
          if (!story?.branch) continue;
          const head = (
            await $.process.run(['git', 'rev-parse', '--verify', '--quiet', story.branch], { cwd })
          ).stdout.trim();
          if (!head) continue;
          let review = reviews.get(story.branch);
          if (!review || review.head !== head) {
            // USE-4: past the plan's pause point, no reviewer starts; the lead reviews alone.
            review = {
              branch: story.branch,
              head,
              story: id,
              startedAt: now,
              findings: [],
              ...(plan.paused
                ? {
                    state: 'skipped',
                    why: `background agents paused, the plan at ${plan.percent}%`,
                  }
                : { state: 'running' }),
            };
            reviews.set(story.branch, review);
            if (!plan.paused)
              return {
                prompt: startReviewerPrompt({
                  agent: reviewerAgent,
                  story,
                  branch: story.branch,
                  head,
                }),
                kind: 'reviewer',
                target: story.branch,
                key: `reviewer:${story.branch}@${head}`,
                label: `Start the reviewer on ${story.branch}`,
              };
            await act.record('skipped', `review of ${story.branch}`);
          }
          if (review.state === 'running') {
            if (now - review.startedAt < REVIEW_WAIT_MS) continue;
            review.state = 'failed';
            review.error = 'no report within 15 minutes';
          }
          return {
            prompt: leadReviewPrompt(id, review),
            kind: 'review',
            target: id,
            key: `review:${story.branch}@${head}`,
            label: `Review ${id}`,
          };
        }
        return null;
      },
      // REVW-3: the reviewer's report, read from the turn it ended with; a failed verify is a blocker.
      reviewed: async (agentId, answer) => {
        let review = [...reviews.values()].find((r) => r.agentId === agentId);
        if (!review) {
          const agent = ((await $.agent.list()) ?? []).find((a) => a.id === agentId);
          if (!agent || !reviewerAgent || agent.type !== reviewerAgent) return;
          review = [...reviews.values()].find(
            (r) => r.state === 'running' && agent.description?.includes(r.branch),
          );
          if (!review) return;
          review.agentId = agentId;
        }
        const report = readReport(answer);
        if (report.error) {
          review.state = 'failed';
          review.error = report.error;
        } else {
          review.state = 'done';
          review.findings = report.findings;
          // With the branch checked out in a worktree, verify there too: its problems are blockers.
          const story = (model.state?.stories ?? []).find((s) => s.id === review.story);
          if (story?.worktree) {
            const ran = await $.process.run(['node', cli, 'verify', '--no-checks', '--json'], {
              cwd: story.worktree,
              timeoutMs: 120000,
            });
            if (ran.exitCode !== 0) {
              const problems = Object.values(parseJson(ran.stdout)?.found ?? {}).flat();
              review.findings = withVerify(review.findings, { passed: false, problems });
            }
          }
        }
        await act.record(
          'reviewed',
          `${review.branch}: ${review.state === 'done' ? findingsCount(review.findings) : review.error}`,
        );
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
          await stamp('.claude/state/merge-queue.json'),
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
        approving = {
          request: line.request,
          reason: prefilledReason(line.request),
          error: null,
          heldId: line.heldId ?? null,
        };
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
          // HOLD-3: a held call whose approval couldn't be written is refused as the hooks refused it.
          if (approving.heldId) await answerHeld(approving.heldId, 'refused');
          $.ui.invalidate('ui.render');
          return;
        }
        if (approving.heldId) await answerHeld(approving.heldId, 'approved');
        approving = null;
        notice = null;
        await $.ui.close({ id: APPROVE_ID });
        await act.reload();
      },
      // HOLD-2: Approve opens ACT-1's confirmation for the held call; Refuse lets the refusal through.
      approveHeld: (line) =>
        act.approve({
          request: { names: line.held.names, lane: line.held.lane, what: line.held.what },
          heldId: line.held.id,
        }),
      refuseHeld: async (line) => {
        await answerHeld(line.held.id, 'refused');
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
      // MQ-2: the head of the queue, merged by the person: verified first, sent back if it fails.
      mergeQueue: async (line) => {
        const answer = await $.ui
          .ask(
            `Merge ${line.branch}, next in the merge queue, into ${model.base ?? 'the base branch'}? code-kit verify runs first; if it conflicts or fails, it goes back to its lane.`,
            ['Merge', 'Cancel'],
          )
          .catch(() => 'Cancel');
        if (answer !== 'Merge') return;
        const ran = await $.process.run(['node', cli, 'queue', 'merge', '--person'], {
          cwd,
          timeoutMs: 600000,
        });
        result = {
          ok: ran.exitCode === 0,
          title: ran.exitCode === 0 ? `Merged ${line.branch}` : `Not merged: ${line.branch}`,
          text: `${ran.stdout}${ran.stderr}`.trim(),
        };
        await $.ui.open({ id: RESULT_ID, title: 'Merge', focus: true, closeOnEscape: true });
        await act.reload();
      },
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
      // SET-2: the Settings view; a change is the person's, confirmed with a reason.
      harness: async () => {
        if ((await $.ui.panes()).some((p) => p.id === SETTINGS_ID)) {
          await $.ui.close({ id: SETTINGS_ID });
          return {};
        }
        await act.reload();
        if (model.state.kind === 'none') return { text: NOT_CODE_KIT };
        settingRows = (await json('settings')) ?? [];
        await $.ui.open({ id: SETTINGS_ID, title: 'Harness', focus: true, closeOnEscape: true });
        $.ui.invalidate('ui.render');
        return {};
      },
      chooseSetting: (key, value) => {
        const row = settingRows.find((x) => x.key === key);
        if (row && String(row.value ?? 'null') === value) return;
        pendingSetting = { key, value, reason: '', error: null };
        $.ui.invalidate('ui.render');
      },
      confirmSetting: async (reason) => {
        if (!pendingSetting) return;
        if (!reason?.trim()) {
          pendingSetting = {
            ...pendingSetting,
            error: 'Give a reason: the approval log keeps it.',
          };
          $.ui.invalidate('ui.render');
          return;
        }
        const ran = await $.process.run(
          [
            'node',
            cli,
            'settings',
            'set',
            pendingSetting.key,
            pendingSetting.value,
            '--reason',
            reason.trim(),
            '--via',
            'pane',
          ],
          { cwd },
        );
        if (ran.exitCode !== 0) {
          pendingSetting = {
            ...pendingSetting,
            error: (ran.stderr || ran.stdout).trim().split('\n')[0],
          };
          $.ui.invalidate('ui.render');
          return;
        }
        pendingSetting = null;
        settingRows = (await json('settings')) ?? settingRows;
        await act.reload();
      },
      cancelSetting: () => {
        pendingSetting = null;
        $.ui.invalidate('ui.render');
      },
      // USE-1: a model request's tokens, put down to the agent that made it and its story and lane.
      measure: async (agentId, usage) => {
        if (agentId && !agentsSeen.has(agentId))
          for (const a of (await $.agent.list()) ?? []) agentsSeen.set(a.id, a);
        const who = attribution(agentId, agentsSeen.get(agentId) ?? null, model.check, model.state);
        ledger = withUsage(ledger, who, usage);
        $.ui.invalidate('ui.render');
      },
      // --- the lead loop (spec 05) ---------------------------------------------------------------
      record: async (kind, target, prompt) => {
        loop.steps.push({ at: await $.clock.now(), kind, target, ...(prompt ? { prompt } : {}) });
        if (loop.steps.length > 50) loop.steps.shift();
      },
      // LOOP-1: a prompt to the lead, recorded. It isn't awaited: the turn it starts runs on.
      submit: async (prompt, kind, target) => {
        loop.started = true;
        loop.proposal = null;
        await act.record(kind, target, prompt);
        $.ui.invalidate('ui.render');
        $.prompt.submit({ text: prompt }).catch((err) => {
          notice = `The loop couldn't prompt the lead: ${err?.message ?? err}`;
          $.ui.invalidate('ui.render');
        });
      },
      // LOOP-1, LOOP-5, LOOP-7: with the lead idle and no draft, the step `next` reports.
      step: async (trigger) => {
        const h = harness();
        if (loop.paused || h.autonomy === 'off' || model.state?.kind !== 'ok' || loop.done) return;
        if (leadTurn) return;
        if (trigger === 'tick' && !loop.started && !loop.pending.length) return;
        const box = await $.prompt.read().catch(() => null);
        if (box?.text?.trim()) return;
        if (loop.pending.length) {
          const { story, prompt } = loop.pending.shift();
          return act.submit(prompt, 'restart', story);
        }
        const ran = await $.process.run(['node', cli, 'next', '--json'], { cwd });
        const step = ran.exitCode === 0 ? parseJson(ran.stdout) : null;
        if (!step) {
          notice = `The loop is waiting: code-kit next failed (${(ran.stderr || ran.stdout).trim().split('\n')[0]})`;
          $.ui.invalidate('ui.render');
          return;
        }
        if (step.step === 'done') {
          const count = (model.state.stories ?? []).filter((s) => s.state === 'done').length;
          loop.done = { count };
          await act.record('done', `${count} stories`);
          $.ui.invalidate('ui.render');
          return;
        }
        let prompt = leadPrompt(step, { cli });
        let kind = step.step;
        let target = step.args ?? '';
        let key = stepKey(step);
        let label = stepLabel(step);
        // LOOP-4: with the reviewer on, a branch is reviewed in the background before the lead's review.
        if (step.step === 'review' && harness().agents.reviewer.on && reviewerAgent) {
          const due = await act.reviewStep(step);
          if (!due) return;
          ({ prompt, kind, target, key, label } = due);
        }
        if (!prompt) return;
        // Never the same step twice while the project stands still.
        const print = await act.fingerprint();
        if (key === loop.lastKey && print === loop.lastPrint) return;
        loop.lastKey = key;
        loop.lastPrint = print;
        if (h.autonomy === 'propose') {
          loop.proposal = { prompt, label, kind, target };
          $.ui.invalidate('ui.render');
          return;
        }
        await act.submit(prompt, kind, target);
      },
      go: async () => {
        if (!loop.proposal || leadTurn) return;
        const { prompt, kind, target } = loop.proposal;
        await act.submit(prompt, kind, target);
      },
      // LOOP-6: pausing stops new steps at once; a turn in progress finishes.
      pause: async () => {
        loop.paused = true;
        loop.proposal = null;
        await act.record('pause', 'the loop');
        $.ui.invalidate('ui.render');
      },
      resume: async () => {
        loop.paused = false;
        loop.lastKey = null;
        await act.record('resume', 'the loop');
        $.ui.invalidate('ui.render');
        await act.step('resume');
      },
      dismissDone: () => {
        loop.doneDismissed = true;
        $.ui.invalidate('ui.render');
      },
      // LOOP-3: a lane stalled past its restarts; Resume lets the loop restart it again.
      resumeStall: async (line) => {
        const { story } = line.stall;
        flagged.delete(story);
        restarts.set(story, 0);
        for (const a of activity.values()) if (a.story === story) a.stopped = false;
        await act.record('resume', story);
        $.ui.invalidate('ui.render');
      },
      // LOOP-3: each lane agent at work, by the time since its last tool call.
      stalls: async () => {
        const h = harness();
        if (loop.paused || h.autonomy === 'off' || model.state?.kind !== 'ok') return;
        const now = await $.clock.now();
        const lanes = Object.entries(model.check?.lanes ?? {});
        const waitingOnPerson = new Set([...held.values()].map((c) => c.agentId));
        for (const agent of (await $.agent.list()) ?? []) {
          if (agent.status !== 'running') continue;
          const lane = lanes.find(([, l]) => l.agent === agent.type)?.[0];
          if (!lane) continue;
          agentsSeen.set(agent.id, agent);
          const a = activityOf(agent.id, now);
          a.lane = lane;
          a.story = attribution(agent.id, agent, model.check, model.state).story ?? lane;
          // A held call, or a long command still running, isn't quiet.
          if (a.inFlight > 0 || waitingOnPerson.has(agent.id)) {
            a.at = now;
            continue;
          }
          const due = stallDue(now - a.at, a, restarts.get(a.story) ?? 0, h.stall);
          if (due === 'nudge') {
            a.nudged = true;
            await act.record('nudge', `${lane} · ${a.story}`);
            // An undelivered message still counts as the nudge; the restart follows.
            await $.session
              .send({ to: { agentId: agent.id }, text: nudgeText(h.stall.nudgeMinutes) })
              .catch(() => {});
          } else if (due === 'restart') {
            a.stopped = true;
            const n = (restarts.get(a.story) ?? 0) + 1;
            restarts.set(a.story, n);
            loop.pending.push({
              story: a.story,
              prompt: restartPrompt({
                type: agent.type,
                id: agent.id,
                story: a.story,
                minutes: h.stall.restartMinutes,
              }),
            });
            await act.record('restart', `${lane} · ${a.story} (${n}/${h.stall.maxRestarts})`);
          } else if (due === 'flag') {
            a.stopped = true;
            flagged.set(a.story, { lane, story: a.story, count: (restarts.get(a.story) ?? 0) + 1 });
            await act.record('flag', `${lane} · ${a.story}`);
          }
          if (due) $.ui.invalidate('ui.render');
        }
        if (loop.pending.length) await act.step('tick');
      },
      // --- panes v2: the selected lane's acts (VIEW-6) ----------------------------------------
      // A prompt the person asked for: submitted now if the lead is idle, else when it next is.
      askLead: async (prompt, kind, target) => {
        await act.record(kind, target, prompt);
        if (leadTurn) personAsks.push(prompt);
        else
          $.prompt.submit({ text: prompt }).catch((err) => {
            notice = `Couldn't prompt the lead: ${err?.message ?? err}`;
          });
        $.ui.invalidate('ui.render');
      },
      runningAgentOf: async (lane) =>
        ((await $.agent.list()) ?? []).find(
          (a) => a.status === 'running' && a.type === lane.agent,
        ) ?? null,
      nudgeLane: async (lane) => {
        const agent = await act.runningAgentOf(lane);
        if (!agent) return;
        await act.record('nudge', `${lane.name} · by the person`);
        await $.session
          .send({
            to: { agentId: agent.id },
            text: 'The person asks: report where you are, or carry on.',
          })
          .catch(() => {});
        $.ui.invalidate('ui.render');
      },
      stopLane: async (lane) => {
        const agent = await act.runningAgentOf(lane);
        if (!agent) return;
        const answer = await $.ui
          .ask(
            `Stop ${agent.type} on ${lane.story?.id ?? lane.name}? Its uncommitted work stays in its worktree.`,
            ['Stop', 'Cancel'],
          )
          .catch(() => 'Cancel');
        if (answer !== 'Stop') return;
        await act.askLead(
          `The person asked to stop ${agent.type} (agent ${agent.id})${lane.story ? ` on ${lane.story.id}` : ''}: stop it with TaskStop, and don't dispatch its story again until they say so.`,
          'stop',
          lane.name,
        );
      },
      sendBack: async (lane) => {
        if (!lane.branch) return;
        sendingBack = {
          lane: lane.name,
          branch: lane.branch,
          story: lane.story?.id ?? lane.branch,
          reason: '',
          error: null,
        };
        await $.ui.open({ id: SENDBACK_ID, title: 'Send back', focus: true, closeOnEscape: true });
        $.ui.invalidate('ui.render');
      },
      confirmSendBack: async (reason) => {
        if (!sendingBack) return;
        if (!reason?.trim()) {
          sendingBack = { ...sendingBack, error: 'Give a reason: the lane reads it for its fix.' };
          $.ui.invalidate('ui.render');
          return;
        }
        const ran = await $.process.run(
          ['node', cli, 'sent-back', sendingBack.branch, '--reason', reason.trim()],
          { cwd },
        );
        if (ran.exitCode !== 0) {
          sendingBack = { ...sendingBack, error: (ran.stderr || ran.stdout).trim().split('\n')[0] };
          $.ui.invalidate('ui.render');
          return;
        }
        await act.record('sent back', `${sendingBack.branch}: ${reason.trim()}`);
        sendingBack = null;
        await $.ui.close({ id: SENDBACK_ID });
        await act.reload();
      },
      cancelSendBack: async () => {
        sendingBack = null;
        await $.ui.close({ id: SENDBACK_ID });
      },
      // VIEW-6: a lane's act, from its key or button.
      laneAct: async (id, lane) => {
        if (id === 'approve') {
          const call = [...held.values()].find((c) => (c.lane ?? 'lead') === lane.name);
          if (call) return act.approveHeld({ held: call });
          const request = (model.requests?.open ?? []).find(
            (r) => (r.lane ?? 'lead') === lane.name,
          );
          if (request) return act.approve({ request });
          return;
        }
        if (id === 'review' && lane.story)
          return act.review({ story: { ...lane.story, branch: lane.branch } });
        if (id === 'merge') return act.mergeQueue({ branch: lane.branch });
        if (id === 'sendBack') return act.sendBack(lane);
        if (id === 'nudge') return act.nudgeLane(lane);
        if (id === 'stop') return act.stopLane(lane);
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
        await act.stalls();
        const now = await act.fingerprint();
        const paneOpen = (await $.ui.panes()).some((p) => p.id === PANE_ID);
        quiet += 1;
        if (now === seen && quiet < (paneOpen ? 5 : 30)) return;
        quiet = 0;
        await act.reload();
        // Taken again: what it covers (the plan) can change with what was read.
        seen = await act.fingerprint();
        // Between turns, a change (a lane finished, a branch moved) can make a step due.
        if (now !== seen || quiet === 0) await act.step('tick');
      } finally {
        busy = false;
      }
    });
    // HOLD-2: the countdown on a held call, redrawn each second while one waits.
    $.clock.every(1000, () => {
      if (held.size) $.ui.invalidate('ui.render');
    });
    return next(e);
  });

  const starting = (name) => ({
    text: `code-kit is still starting; try /${name} again in a moment.`,
  });
  on('command.run', { command: 'lanes' }, async ($, e) => (act ? act.lanes() : starting('lanes')));
  on('command.run', { command: 'harness' }, async ($, e) =>
    act ? act.harness() : starting('harness'),
  );
  on('command.run', { command: 'approvals' }, async ($, e) =>
    act ? act.approvals() : starting('approvals'),
  );
  on('command.run', { command: 'verify-branch' }, async ($, e) =>
    act ? act.verify() : starting('verify-branch'),
  );

  // CARD-1: the text a code-kit hook refused a call with, kept for the call's result to draw as a card.
  // HOLD-1 to HOLD-6: a refusal a person's approval would allow is held while the band asks. The hooks
  // stay the judge: the call is run again once the approval is written, and refused as before otherwise.
  on('tool.call', async ($, e, next) => {
    // LOOP-3: a lane agent's tool call is activity; while it runs, the agent isn't quiet.
    const calledAt = await $.clock.now();
    const busy = e.agentId ? activityOf(e.agentId, calledAt) : null;
    if (busy) {
      busy.inFlight += 1;
      busy.nudged = false;
      busy.stopped = false;
      // VIEW-4: the agent's current or last tool call.
      busy.tool = toolLine(e);
      busy.at = calledAt;
    } else if (!e.agentId) leadLast = { tool: toolLine(e), at: calledAt };
    try {
      const res = await next(e);
      const text = res?.deny ?? (res?.isError ? (res.text ?? String(res.result ?? '')) : null);
      if (text && refusalCard(text)) {
        refusals.set(e.tool_use_id, text);
        if (refusals.size > REFUSALS_KEPT) refusals.delete(refusals.keys().next().value);
      }
      const ask = text ? holdable(text) : null;
      const settings = model.check?.harness;
      const minutes = settings?.hold?.minutes ?? 2;
      // HOLD-6: nobody to ask (claude -p, the SDK), or hold switched off: refused as today.
      if (!ask || !where?.interactive || minutes <= 0 || model.state?.kind !== 'ok') return res;
      const id = e.tool_use_id;
      // HOLD-5: under autonomy, the project's delegated rules decide first, without asking.
      if ((settings?.autonomy ?? 'autonomous') === 'autonomous') {
        const delegated = await $.process.run(
          [
            'node',
            where.cli,
            'approve',
            ...ask.names,
            ...(ask.lane ? ['--lane', ask.lane] : []),
            '--delegated',
            '--reason',
            `Held call within the delegated rules: ${ask.what}`,
          ],
          { cwd: where.cwd, timeoutMs: 60000 },
        );
        if (delegated.exitCode === 0) return next(e);
      }
      const agent = e.agentId ? agentsSeen.get(e.agentId) : null;
      held.set(id, {
        id,
        agentId: e.agentId ?? null,
        who: ask.lane ?? agent?.type ?? (e.agentId ? 'an agent' : 'the lead'),
        kind: ask.kind,
        names: ask.names,
        lane: ask.lane,
        what: ask.what,
        since: await $.clock.now(),
        minutes,
      });
      $.ui.invalidate('ui.render');
      // The wait is a process the band's answer ends (`code-kit hold`), so it isn't the hook's own time.
      const waited = await $.process
        .run(['node', where.cli, 'hold', id, '--minutes', String(minutes)], {
          cwd: where.cwd,
          // A little past the hold time, within the host's ten minutes for a process.
          timeoutMs: Math.min(minutes * 60000 + 15000, 600000),
        })
        .catch(() => null);
      held.delete(id);
      $.ui.invalidate('ui.render');
      // HOLD-3: the same call, now with the approval in force; HOLD-4: refused as the hooks refused it.
      return waited?.stdout.trim() === 'approved' ? next(e) : res;
    } finally {
      if (busy) {
        busy.inFlight -= 1;
        busy.at = await $.clock.now();
      }
    }
  }).catch(($, e, next) => next(e)); // whatever fails here, the call goes on as it would
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

  // USE-1: each model request's usage, as the request ends; the lead's requests carry no agentId.
  on('turn.step', async function* ($, e, next) {
    const res = yield* next(e);
    if (e.agentId) activityOf(e.agentId, 0).at = await $.clock.now();
    if (res?.usage && act) await act.measure(e.agentId, res.usage).catch(() => {});
    return res;
  });
  // USE-4: the plan's 5-hour use, as Claude Code measures it.
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      rateLimits = e.rateLimits;
      $.ui.invalidate('ui.render');
    }
    return next(e);
  });

  // What the pane and band show of usage: the session's tokens and the plan's use.
  const usageNow = () => ({
    usage: usageSummary(ledger, finishedStories(model.state)),
    plan: planOf(rateLimits, model.check?.harness?.background?.pauseAtPercent),
  });

  on('turn.start', async ($, e, next) => {
    leadTurn = e.turnId;
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
    const res = await next(e);
    // REVW-3: a subagent's last turn may be the reviewer's report.
    if (e.agentId && act) await act.reviewed(e.agentId, e.answer).catch(() => {});
    // LOOP-1: the lead is idle; the loop's next step, if one is due (submitted from turn.complete,
    // as the spike found it must be). The prompt it submits isn't awaited: that turn isn't this hook's.
    if (!e.agentId && (!leadTurn || leadTurn === e.turnId)) {
      leadTurn = null;
      // What the person asked for goes first, whatever the loop's state.
      if (personAsks.length) {
        const text = personAsks.shift();
        $.prompt.submit({ text }).catch(() => {});
        return res;
      }
      await act?.step('turn').catch(() => {});
    }
    return res;
  });

  // What the pane and band show of the loop.
  const loopNow = (now) => {
    const h = harness();
    const state =
      h.autonomy === 'off' ? 'off' : loop.done ? 'done' : loop.paused ? 'paused' : 'running';
    const laneNotes = {};
    for (const a of activity.values()) {
      if (!a.lane) continue;
      const n = restarts.get(a.story) ?? 0;
      if (a.nudged && !a.stopped) laneNotes[a.lane] = 'nudged';
      if (a.stopped && n) laneNotes[a.lane] = `restarted ${n}/${h.stall.maxRestarts}`;
    }
    for (const f of flagged.values()) laneNotes[f.lane] = 'stalled';
    const last = [...loop.steps]
      .reverse()
      .find((s) => ['dispatch', 'review', 'lead', 'restart'].includes(s.kind));
    return {
      state: state === 'done' && loop.doneDismissed ? 'stopped' : state,
      autonomy: h.autonomy,
      started: loop.started,
      last: last ? `${last.kind} ${last.target}` : null,
      proposal: loop.proposal,
      flagged: [...flagged.values()],
      doneCount: loop.done?.count ?? 0,
      steps: loop.steps,
      laneNotes,
      now,
      reviews: [...reviews.values()].map((r) => ({
        ...r,
        summary: findingsCount(r.findings),
        blockers: r.findings.filter((f) => f.severity === 'blocker').length,
      })),
    };
  };

  // VIEW-4: each lane's current or last tool call, and how long ago.
  const liveNow = (now) => {
    const stall = harness().stall;
    const live = {};
    if (leadLast) live.lead = { tool: leadLast.tool, ago: ago(now - leadLast.at), level: null };
    for (const a of activity.values()) {
      if (!a.lane || !a.tool) continue;
      if (live[a.lane] && live[a.lane].at > a.at) continue;
      live[a.lane] = {
        tool: a.tool,
        at: a.at,
        ago: a.inFlight > 0 ? 'now' : ago(now - a.at),
        level: liveLevel(now - a.at, stall, {
          flagged: [...flagged.values()].some((f) => f.lane === a.lane),
          running: a.inFlight > 0,
        }),
      };
    }
    return live;
  };
  // The band's lines, which the pane pins as what needs the person (VIEW-5).
  const linesNow = (now) =>
    bandLines({
      ...model,
      reviewing,
      notice,
      ...usageNow(),
      held: [...held.values()],
      now,
      loop: loopNow(now),
    });

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const now = await $.clock.now();
    const { usage, plan } = usageNow();
    const lanesNow = model.state?.kind === 'ok' ? model.state.lanes : [];
    return lanesFrame(
      {
        state: model.state,
        usage,
        plan,
        loop: { ...loopNow(now), queue: model.queue ?? [] },
        needs: linesNow(now),
        live: liveNow(now),
        held: [...held.values()],
        requests: model.requests?.open ?? [],
        ui: paneUi,
        placement: e.props.placement,
      },
      $.ui.resolve(e),
      {
        onTab: (tab) => {
          paneUi = { ...paneUi, tab };
          $.ui.invalidate('ui.render');
        },
        onFilter: (state) => {
          paneUi = { ...paneUi, filter: paneUi.filter === state ? null : state };
          $.ui.invalidate('ui.render');
        },
        onMove: (step) => {
          if (!lanesNow.length) return;
          const at = lanesNow.findIndex((l) => l.name === paneUi.selected);
          const to =
            at < 0
              ? step > 0
                ? 0
                : lanesNow.length - 1
              : (at + step + lanesNow.length) % lanesNow.length;
          paneUi = { ...paneUi, selected: lanesNow[to].name };
          $.ui.invalidate('ui.render');
        },
        onNeed: (id, line) => act?.[id]?.(line),
        onLane: (id, lane) => act?.laneAct(id, lane),
        onSearch: (search) => {
          paneUi = { ...paneUi, search };
          $.ui.invalidate('ui.render');
        },
        onFocusSearch: () => $.ui.focus({ requestId: PANE_ID, key: 'filter' }).catch(() => {}),
      },
    );
  });

  on('ui.render', { component: 'Pane', requestId: SENDBACK_ID }, async ($, e) =>
    sendBackPane(sendingBack, $.ui.resolve(e), {
      onInput: (value) => {
        if (sendingBack) sendingBack = { ...sendingBack, reason: value };
        $.ui.invalidate('ui.render');
      },
      onSubmit: (value) => act.confirmSendBack(value),
      onCancel: () => act.cancelSendBack(),
    }),
  );

  // BAND-2: absent when nothing waits. Its lines go above whatever else the band holds (another
  // plugin's lines, such as Context Graph's, or Claude Code's own), which it keeps.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const lines = linesNow(await $.clock.now());
    if (!lines.length || !act) return next(e);
    const ours = band(lines, $.ui.resolve(e), (id, line) => act[id](line));
    const below = await next(e);
    return below ? $.ui.resolve(e).Box({ flexDirection: 'column', children: [ours, below] }) : ours;
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

  on('ui.render', { component: 'Pane', requestId: SETTINGS_ID }, async ($, e) =>
    settingsView(settingRows, pendingSetting, $.ui.resolve(e), {
      onChoose: (key, value) => act.chooseSetting(key, value),
      onReason: (value) => {
        if (pendingSetting) pendingSetting = { ...pendingSetting, reason: value };
        $.ui.invalidate('ui.render');
      },
      onConfirm: (reason) => act.confirmSetting(reason),
      onCancel: () => act.cancelSetting(),
    }),
  );

  on('ui.render', { component: 'Pane', requestId: RESULT_ID }, async ($, e) =>
    resultPane(result, $.ui.resolve(e)),
  );
}
