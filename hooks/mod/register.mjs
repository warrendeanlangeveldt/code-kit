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
  ANSWER_ID,
  APPROVE_ID,
  NOT_CODE_KIT,
  PANE_ID,
  RESULT_ID,
  SETTINGS_ID,
  approvalsText,
  agentsAtWork,
  shownState,
  attribution,
  answerPane,
  approvalAsidePrompt,
  approvePane,
  questionAsidePrompt,
  commandItself,
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
import { axisStart, barCells, poseOf, rasterCells, sprite, tintOf } from './art.mjs';
import {
  DEFAULT_UI,
  SENDBACK_ID,
  closeGoesBack,
  laneActions,
  lanesFrame,
  liveLevel,
  sendBackPane,
  toolLine,
} from './panes.mjs';
import {
  agentFileModel,
  answeredPrompt,
  designHandedOver,
  laneModel,
  leadPrompt,
  nudgeText,
  outcomePrompt,
  PARK_MS,
  parkWatch,
  readOutcome,
  restartPrompt,
  stallDue,
  stepKey,
  stepLabel,
  stepStories,
  storiesInFlight,
  storiesSignature,
  withoutInFlight,
} from './loop.mjs';
import { goalOf, nextText } from './mission.mjs';
import { contextOf, decisionCards, nativeChoice } from './decisions.mjs';
import { DEFAULT_TEAM_UI, TEAM_ID, teamFrame } from './teamview.mjs';
import { glowOf, mapStoryOf, touchOf } from './codemap.mjs';
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
let teamSince = null; // TEAM-6: since you last looked, as read when the Team pane's tab opened
let teamUi = { ...DEFAULT_TEAM_UI }; // TEAM-7: the Team pane's own state
let boardSynced = -Infinity; // TEAM-12: when the board was last synced
let projectRead = -Infinity; // MAP-5: when the whole project's map was last read
const BOARD_EVERY_MS = 10 * 60000;
let act = null; // the session's actions, made at session start
let settingRows = []; // the harness settings, from `code-kit settings --json`
let pendingSetting = null; // a change waiting for the person's reason: { key, value, reason, error }
let ledger = {}; // the session's tokens by agent and story (USE-1)
let rateLimits = []; // the session's limits, as session.measure last gave them
const agentsSeen = new Map(); // agent id → its $.agent.list() entry, kept once it leaves the list
const held = new Map(); // tool_use_id → a call held for the person (HOLD-2)
const denied = new Map(); // tool_use_id → a call Claude Code's own permission check refused (PERM-1)
const briefLater = new Set(); // the brief's questions the person put off this session (ASK-4)
let answering = null; // the open Answer… box: { kind: 'question' | 'brief', question, id?, path?, text, error }
let where = null; // { cli, cwd, interactive }, from session start
// The lead loop (spec 05): what it did, and what it waits on.
const loop = {
  paused: false,
  started: false, // it has taken a step this session: from then on it also acts between turns
  steps: [], // { at, kind, target, prompt? }, kept for the session
  lastKey: null, // the last step submitted or proposed, and the project as it stood then
  lastPrint: null,
  asked: { key: null, times: 0 }, // the step the lead was last prompted with, and how often in a row
  proposal: null, // under autonomy propose, or a step asked too often: { prompt, label, kind, target }
  pending: [], // restarts waiting for the lead to be idle: { story, prompt }
  nextStep: null, // what `code-kit next` last said, for the band's next row
  done: null, // { count } once every story is done
  doneDismissed: false,
  // LOOP-11: the step the lead's turn was prompted with, until that turn ends: { prompt, key, label, kind, target }
  sent: null,
  // LOOP-11, LOOP-12: what holds the loop: { kind: 'person' | 'stopped' | 'blocked' | 'design', key, label, prompt, question, options, reason }
  waiting: null,
  handedDesign: new Set(), // LOOP-12: design stories handed to the lead this session
  // LOOP-13: stories the lead said wait on other work: id → { on, why, watch, sig, at }
  parked: new Map(),
};
// LOOP-10: whether this session runs the loop, the session that does when another does, and when this
// one last renewed its lease.
const lease = { mine: false, other: null, renewed: -Infinity };
const LEASE_RENEW_MS = 30000;
// LOOP-11: the lead's last reply, read once before the loop next prompts it: { turnId, text, aborted, sent, read }
let lastReply = null;
let turnQuestions = []; // the open questions as the lead's running turn started
// DECIDE-4: decisions asked in Claude Code's own question dialog this session, and whether one is open.
const offered = new Set();
let offering = false;
/** LOOP-8: the times in a row the lead is prompted with one step before the person is asked. */
const ASK_LIMIT = 2;
let leadTurn = null; // the lead's running turn, if any
const activity = new Map(); // agent id → { at, inFlight, nudged, stopped, lane, story }
const restarts = new Map(); // story → times the loop restarted it
const flagged = new Map(); // story → { lane, story, count }: stalled past its restarts
/**
 * LOOP-3: whether an agent's work is done, so it isn't stalled however quiet: it handed back, or its
 * story is in review, waiting in the merge queue or merged.
 */
const finishedWork = (a) => {
  if (a.handedBack) return true;
  const story = (model.state?.stories ?? []).find((s) => s.id === a.story);
  if (!story) return false;
  if (['review', 'done'].includes(story.state)) return true;
  return (model.queue ?? []).some(
    (q) => q.branch === story.branch && ['waiting', 'merging'].includes(q.state),
  );
};
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
let storyOpen = null; // the drill-down's story (VIEW-7): { id, lane, data, error }
const personAsks = []; // prompts the person asked for (stop an agent), waiting for the lead to be idle
// VIEW-3: the characters' animation, and the surface the Lanes pane was last drawn on.
let frame = 0;
let animation = null; // the timer repainting working characters, while one works
let paneSurface = null;
let paneColumns = 80;
let codeMap = null; // MAP-1: `code-kit map <story> --json` for the Code map tab's story
let trailData = null; // TRAIL-1: `code-kit trail --json` while the Trail tab shows
let journalData = null; // JOURNAL-1: `code-kit journal --json`, for the Journal tab and the decisions
const touches = []; // MAP-2: { path, verb, lane, at }, the files agents read and edited lately
const TOUCHES_KEPT = 200;
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
    await $.command
      .register({
        name: 'team',
        description:
          "code-kit's team: who's at work on what, claims, intents, drift and the team's setup",
        immediate: true,
      })
      .catch(unavailable('team'));
    rateLimits = (await $.session.usage().catch(() => null))?.rateLimits ?? [];
    const cli = `${$.plugin.root}/bin/code-kit.mjs`;
    const cwd = e.cwd ?? (await $.session.cwd());
    const session = await $.session.id();
    where = { cli, cwd, session, interactive: e.isInteractive !== false };
    // The held call's answer, for the `code-kit hold` it waits in.
    const answerHeld = (id, answer) =>
      $.process.run(['node', cli, 'hold', id, '--answer', answer], { cwd });
    const json = async (...args) => {
      const ran = await $.process.run(['node', cli, ...args, '--json'], { cwd });
      return ran.exitCode === 0 ? parseJson(ran.stdout) : null;
    };
    // What a CLI run said, in a line: why it refused, for a notice.
    const firstLine = (ran) => (ran.stderr || ran.stdout).trim().split('\n')[0];
    // A session starts with the loop running: a pause recorded by an earlier one no longer holds. A pause
    // by a session that still runs the loop (LOOP-10) is that session's, and stays.
    const recorded = await json('loop').catch(() => null);
    if (recorded?.paused && (!recorded.lead || recorded.lead.session === session))
      await $.process.run(['node', cli, 'loop', 'resume'], { cwd }).catch(() => {});
    lease.other = recorded?.lead && recorded.lead.session !== session ? recorded.lead : null;
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
        const all = valid ? await json('requests') : null;
        // HELM-6: the person sees only their own decisions; the lead decides the rest.
        const requests = all
          ? { ...all, open: (all.open ?? []).filter((r) => r.by !== 'lead') }
          : null;
        const stops = valid ? ((await json('stops', '--session', session)) ?? []) : [];
        const queue = valid ? ((await json('queue')) ?? []) : [];
        // VIEW-2: when each story's work happened, for the lanes' timelines.
        const timeline = valid && check.docs?.plan ? await json('timeline') : null;
        // JOIN-1: what the active adapters know of the lanes' work, where any does.
        const adapters =
          valid && check.adapters?.length
            ? ((await json('adapters', '--session', session)) ?? [])
            : [];
        // TEAM-7: the team's claims, intents and pull requests, where the project is a team's.
        const team = valid && check.team ? await json('team') : null;
        // ASK-2: the lead's questions waiting for the person; REPORT-3: bug reports waiting to be sent.
        const questions = valid
          ? ((await json('ask')) ?? []).filter((q) => q.state === 'open')
          : [];
        const reports = valid
          ? ((await json('report')) ?? []).filter((r) => r.state === 'draft')
          : [];
        // TEAM-12: the plan mirrored onto the team's Project board, at most every 10 minutes, in the
        // background: a slow GitHub never holds up the band.
        const at = await $.clock.now();
        if (team && check.team?.board && at - boardSynced >= BOARD_EVERY_MS) {
          boardSynced = at;
          $.process.run(['node', cli, 'team', 'board'], { cwd, timeoutMs: 120000 }).catch(() => {});
        }
        // LOOP-10: while another session runs the loop, whether it still does (its lease lapses as it ends).
        if (!lease.mine) {
          const lead = (await json('loop').catch(() => null))?.lead ?? null;
          lease.other = lead && lead.session !== session ? lead : null;
        }
        // The agents at work; none where the session has none bound (claude -p before it mounts).
        const atWork = agentsAtWork(await $.agent.list().catch(() => []));
        model = {
          state: projectState(check, status, nextStep, atWork),
          requests,
          stops,
          queue,
          status,
          timeline,
          adapters,
          check,
          team,
          questions,
          reports,
          // ASK-4: the brief's open questions, less those put off this session.
          brief: (nextStep?.brief ?? []).filter((b) => !briefLater.has(b.question)),
          base: status?.base ?? null,
        };
        if (model.state.kind === 'ok') await act.registerReviewer();
        await act.readMaps();
        $.ui.invalidate('ui.render');
      },
      // MAP-1, TRAIL-1: what the Code map and Trail tabs draw, read while they show.
      readMaps: async () => {
        if (model.state?.kind !== 'ok') return;
        if (paneUi.tab === 'code') {
          const id = mapStoryOf(stateNow(), paneUi.selected, paneUi.mapStory);
          // MAP-5: the whole project reads every code file, so at most every 30 seconds.
          const now = await $.clock.now();
          const fresh =
            id === 'project' && codeMap?.story?.id === 'project' && now - projectRead < 30000;
          if (!fresh) {
            codeMap = id ? ((await json('map', id)) ?? codeMap) : null;
            if (id === 'project') projectRead = now;
          }
        }
        if (paneUi.tab === 'map') trailData = (await json('trail')) ?? trailData;
        // TEAM-6: since you last looked, read once each time its tab opens, which marks it read.
        if (teamUi.tab === 'activity' && model.check?.team && !teamSince)
          teamSince = (await json('team', 'since')) ?? { people: {} };
        // JOURNAL-1, DECIDE-2: the lineage, for the Journal tab and the decisions' cards.
        const deciding = held.size > 0 || (model.requests?.open ?? []).length > 0;
        if (model.check?.docs?.plan && (['journal', 'decisions'].includes(paneUi.tab) || deciding))
          journalData = (await json('journal')) ?? journalData;
      },
      // REVW-2: the reviewer, read-only by the hooks' rule for agents outside the lanes. Registered
      // again when its model setting changes.
      registerReviewer: async () => {
        const wanted = harness().agents.reviewer.model ?? '';
        if (reviewerModel === wanted) return;
        const spec = reviewerSpec({
          cli,
          checklist: `${$.plugin.root}/skills/review/SKILL.md`,
          model: wanted || undefined,
        });
        // Until the session is bound (claude -p, early on) registering fails: it's tried again next time.
        const done = await $.agent.register(spec).catch((err) => {
          $.ui.log(`code-kit: the reviewer agent isn't available yet: ${err?.message ?? err}`, {
            to: 'debug',
          });
          return null;
        });
        if (!done) return;
        reviewerModel = wanted;
        reviewerAgent = done.agent ?? null;
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
          const agent = ((await $.agent.list().catch(() => [])) ?? []).find(
            (a) => a.id === agentId,
          );
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
        const specs = model.check?.docs?.specs;
        return [
          refs.stdout,
          await stamp('.claude/code-kit.json'),
          plan ? await stamp(plan) : '',
          // TRACE-3: the map follows the specs too.
          specs ? await listing(specs) : '',
          await stamp('.claude/state/requests.jsonl'),
          // TEAM-7: a live provider (the hub's helper) rewrites the team's state as events arrive.
          await stamp('.claude/state/team.json'),
          await stamp('.claude/state/merge-queue.json'),
          await listing('.claude/approvals'),
          await listing('.claude/state/stop-blocks'),
          [...agentsAtWork(await $.agent.list().catch(() => []))].sort().join(','),
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
      // DECIDE-3: the Decisions tab, on the decision the person asked about.
      decide: async (line) => {
        const cards = cardsNow(await $.clock.now());
        const at = Math.max(
          0,
          cards.findIndex((c) => c.line.kind === line?.kind),
        );
        paneUi = { ...paneUi, tab: 'decisions', decision: at, story: null };
        if (!(await $.ui.panes()).some((p) => p.id === PANE_ID))
          await $.ui.open({ id: PANE_ID, title: 'Lanes', focus: true, closeOnEscape: true });
        $.ui.invalidate('ui.render');
        await act.readMaps();
        $.ui.invalidate('ui.render');
        return {};
      },
      // ASK-2, ASK-4, REPORT-3: a question's Answer… or a report's Read it opens its card.
      openDecision: (line) => act.decide(line),
      // ACT-1: the confirmation, prefilled from the request.
      approve: async (line) => {
        approving = {
          request: line.request,
          reason: prefilledReason(line.request),
          error: null,
          heldId: line.heldId ?? null,
          aside: { thread: [], draft: '' },
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
      // CARD-7: a request nobody needs any more stops waiting; nothing is approved.
      dropRequest: async (line) => {
        const open = model.requests?.open ?? [];
        const same = (r) =>
          [...r.names].sort().join() === [...line.request.names].sort().join() &&
          (r.lane ?? r.actor) === (line.request.lane ?? line.request.actor);
        const numbers = open.flatMap((r, i) => (same(r) ? [r.n ?? i + 1] : []));
        if (!numbers.length) return;
        const ran = await $.process.run(
          ['node', cli, 'requests', 'drop', numbers.join(','), '--via', 'pane'],
          { cwd },
        );
        notice = ran.exitCode === 0 ? null : `Nothing was dropped: ${firstLine(ran)}`;
        await act.reload();
      },
      // ASK-2: the lead's option, pressed: the answer is recorded and sent to the lead.
      answerWith: (line) => act.sendAnswer({ kind: 'question', ...line.question }, line.choice),
      // ASK-2, ASK-4: Answer… opens a box for the person's own words.
      answer: async (line) => {
        answering = {
          kind: 'question',
          ...line.question,
          text: '',
          error: null,
          aside: { thread: [], draft: '' },
        };
        await $.ui.open({ id: ANSWER_ID, title: 'Answer', focus: true, closeOnEscape: true });
        $.ui.invalidate('ui.render');
      },
      answerBrief: async (line) => {
        answering = {
          kind: 'brief',
          ...line.brief,
          text: '',
          error: null,
          aside: { thread: [], draft: '' },
        };
        await $.ui.open({ id: ANSWER_ID, title: 'Answer', focus: true, closeOnEscape: true });
        $.ui.invalidate('ui.render');
      },
      laterBrief: (line) => {
        briefLater.add(line.brief.question);
        model = {
          ...model,
          brief: (model.brief ?? []).filter((b) => b.question !== line.brief.question),
        };
        $.ui.invalidate('ui.render');
      },
      confirmAnswer: async (text) => {
        if (!answering) return;
        if (!text.trim()) {
          answering = { ...answering, error: 'Type your answer: the lead builds on it.' };
          $.ui.invalidate('ui.render');
          return;
        }
        const done = await act.sendAnswer(answering, text.trim());
        if (done) {
          answering = null;
          await $.ui.close({ id: ANSWER_ID });
        }
      },
      cancelAnswer: async () => {
        answering = null;
        await $.ui.close({ id: ANSWER_ID });
      },
      // The answer recorded (a question's, in code-kit) and told to the lead, which carries on with it.
      sendAnswer: async (q, text) => {
        if (q.kind === 'question') {
          const ran = await $.process.run(
            ['node', cli, 'ask', 'answer', q.id, text, '--via', 'pane'],
            { cwd },
          );
          if (ran.exitCode !== 0) {
            notice = `Your answer wasn't recorded: ${firstLine(ran)}`;
            if (answering) answering = { ...answering, error: notice };
            $.ui.invalidate('ui.render');
            return false;
          }
        }
        notice = null;
        // Answered, the decision goes at once; the lead hears it as a turn of its own once it's idle, which
        // can be long after (so the prompt isn't waited on).
        if (q.kind === 'brief') {
          briefLater.add(q.question);
          model = { ...model, brief: (model.brief ?? []).filter((b) => b.question !== q.question) };
        }
        if (q.kind === 'question')
          model = { ...model, questions: (model.questions ?? []).filter((x) => x.id !== q.id) };
        // LOOP-11: answered, what the lead waited on no longer holds the loop.
        if (
          q.kind === 'lead' ||
          (q.kind === 'question' && loop.waiting?.questionIds?.includes(q.id))
        )
          loop.waiting = null;
        $.ui.invalidate('ui.render');
        const said = /[.!?]$/.test(text) ? text : `${text}.`;
        $.prompt
          .submit({
            text:
              q.kind === 'question'
                ? `The person answered ${q.id} (${q.question}): ${said}${q.blocks ? ` ${q.story} no longer waits on them.` : ''} Carry on with it.`
                : q.kind === 'lead'
                  ? answeredPrompt(q.question, text)
                  : `The person answered an open question in ${q.path}, "${q.question}": ${said} Record it in the brief's decision log, take it out of the open questions, and carry on with it.`,
          })
          .catch(() => {});
        await act.reload();
        return true;
      },
      // PERM-1: a call Claude Code refused, which only the person can run or allow.
      runDenied: async (line) => {
        await $.prompt.fill({ text: `! ${line.denial.command}`, mode: 'replace' }).catch(() => {});
      },
      deniedDone: async (line) => {
        denied.delete(line.denial.id);
        $.ui.invalidate('ui.render');
        $.prompt
          .submit({
            text: `The person ran it themselves, or allowed it: ${line.denial.command ?? line.denial.what} (Claude Code had refused it for ${line.denial.who}). Check it worked, and carry on.`,
          })
          .catch(() => {});
      },
      deniedNo: async (line) => {
        denied.delete(line.denial.id);
        $.ui.invalidate('ui.render');
        $.prompt
          .submit({
            text: `The person won't run ${line.denial.command ?? line.denial.what} now (Claude Code refused it for ${line.denial.who}). Don't try to get around it: carry on with other work, and if a story can't go on without it, ask with code-kit ask --blocks.`,
          })
          .catch(() => {});
      },
      // REPORT-3: the person sends a drafted report to code-kit's GitHub, or discards it.
      sendReport: async (line) => {
        const ran = await $.process.run(['node', cli, 'report', 'send', line.report.id], {
          cwd,
          timeoutMs: 120000,
        });
        result = {
          ok: ran.exitCode === 0,
          title: ran.exitCode === 0 ? 'Report sent' : 'Report not sent',
          text: `${ran.stdout}${ran.stderr}`.trim(),
        };
        await $.ui.open({ id: RESULT_ID, title: 'Report', focus: true, closeOnEscape: true });
        await act.reload();
      },
      discardReport: async (line) => {
        await $.process.run(['node', cli, 'report', 'discard', line.report.id], { cwd });
        await act.reload();
      },
      // HOLD-2: Approve opens ACT-1's confirmation for the held call; Refuse lets the refusal through.
      approveHeld: (line) =>
        act.approve({
          request: {
            names: line.held.names,
            lane: line.held.lane,
            what: line.held.what,
            why: line.held.refusal ?? null,
          },
          heldId: line.held.id,
        }),
      // ACT-5: a side call over the lead's own conversation (it shares the prompt cache, and nothing is
      // added to the conversation); before the lead's first reply, from the prompt's facts alone.
      sideCall: async (prompt) => {
        const failed = (err) => ({ isAnswered: false, reason: String(err?.message ?? err) });
        const reply = await $.model.fork({ prompt }).catch(failed);
        if (reply.isAnswered || reply.reason !== 'nothing-to-fork') return reply;
        return $.model.complete({ model: 'sonnet', prompt, maxTokens: 800 }).catch(failed);
      },
      // ASK-5: a question about a question, asked in the answer box before answering.
      askAnswer: async (question) => {
        const q = question.trim();
        if (!answering || !q) return;
        const asked = answering;
        const turn = { question: q, pending: true };
        const thread = asked.aside.thread;
        answering = { ...asked, aside: { thread: [...thread, turn], draft: '' } };
        $.ui.invalidate('ui.render');
        const reply = await act.sideCall(questionAsidePrompt({ q: asked, thread, question: q }));
        if (!answering || answering.question !== asked.question) return;
        const done = reply.isAnswered
          ? { question: q, answer: reply.text }
          : {
              question: q,
              error: `No answer: ${reply.reason}${reply.status ? ` (${reply.status})` : ''}`,
            };
        answering = {
          ...answering,
          aside: {
            ...answering.aside,
            thread: answering.aside.thread.map((t) => (t === turn ? done : t)),
          },
        };
        $.ui.invalidate('ui.render');
      },
      // ACT-5: a question about the approval, answered in its pane by a side call over the lead's own
      // conversation (it shares the prompt cache, and nothing is added to the conversation); before the
      // lead's first reply, from code-kit's facts alone.
      askApproval: async (question) => {
        const q = question.trim();
        if (!approving || !q) return;
        const asked = approving;
        const thread = asked.aside.thread;
        const turn = { question: q, pending: true };
        approving = { ...asked, aside: { thread: [...thread, turn], draft: '' } };
        $.ui.invalidate('ui.render');
        const row = (model.state?.lanes ?? []).find((l) => l.name === asked.request.lane);
        const prompt = approvalAsidePrompt({
          request: asked.request,
          story: row?.story ?? null,
          thread,
          question: q,
        });
        const reply = await act.sideCall(prompt);
        // Answered for this approval only: a pane closed or moved on meanwhile keeps what it has.
        if (!approving || approving.request !== asked.request) return;
        const done = reply.isAnswered
          ? { question: q, answer: reply.text }
          : {
              question: q,
              error: `No answer: ${reply.reason}${reply.status ? ` (${reply.status})` : ''}`,
            };
        approving = {
          ...approving,
          aside: {
            ...approving.aside,
            thread: approving.aside.thread.map((t) => (t === turn ? done : t)),
          },
        };
        $.ui.invalidate('ui.render');
      },
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
      // TEAM-9: the person keeps or releases their stale claim; TEAM-5: the tech lead agrees or drops an
      // intent. Each is the person's own press, run as them.
      teamAct: async (args, done) => {
        const ran = await $.process.run(['node', cli, ...args], { cwd, timeoutMs: 60000 });
        notice =
          ran.exitCode === 0
            ? null
            : `${done} failed: ${(ran.stderr || ran.stdout).trim().split('\n')[0]}`;
        await act.reload();
      },
      keepClaim: (line) => act.teamAct(['team', 'keep', line.claim.story], 'Keeping the claim'),
      // TEAM-9: the tech lead hands a claim, with its lease, to someone else.
      reassignTo: async (story, handle) => {
        const to = handle.trim().replace(/^@/, '');
        if (!to) return;
        teamUi = { ...teamUi, reassign: null, handle: '' };
        await act.teamAct(['team', 'reassign', story, to], `Reassigning ${story}`);
      },
      // TEAM-13: the team's setup is changed through its init, by the lead, with the person.
      teamSetup: async () => {
        await $.prompt
          .submit({ text: "Run /code-kit:team-init: I want to change this project's team setup." })
          .catch((err) => {
            notice = `Couldn't ask the lead: ${err?.message ?? err}`;
          });
        $.ui.invalidate('ui.render');
      },
      releaseClaim: (line) =>
        act.teamAct(['team', 'release', line.claim.story], 'Releasing the claim'),
      // TEAM-10: agreed, the lead records it where agents read it, through a pull request.
      agreeIntent: async (line) => {
        const { id, about } = line.intent;
        await act.teamAct(
          ['intend', 'agree', String(id), '--reason', 'agreed in the code-kit pane'],
          'Agreeing the intent',
        );
        if (notice) return;
        await $.prompt
          .submit({
            text: `Intent #${id} (${about}) was agreed. Record it so every agent builds on it: run node "${cli}" intend record ${id}, then commit the decision record on a branch lead/decision-${id}, push it and open a pull request.`,
          })
          .catch(() => {});
      },
      dropIntent: (line) =>
        act.teamAct(
          ['intend', 'drop', String(line.intent.id), '--reason', 'dropped in the code-kit pane'],
          'Dropping the intent',
        ),
      // TEAM-7: the Team pane, opened from the band (on what the line is about) or /team (which closes
      // it when it's open).
      team: async (line, { toggle = false } = {}) => {
        const open = (await $.ui.panes()).some((p) => p.id === TEAM_ID);
        if (open && toggle) {
          await $.ui.close({ id: TEAM_ID });
          return {};
        }
        if (toggle || !model.state) await act.reload();
        if (model.state?.kind === 'none') return { text: NOT_CODE_KIT };
        if (!model.check?.team)
          return {
            text: "This project isn't set up as a team: one developer, no claims or owners. To share it with a team, run /code-kit:team-init.",
          };
        const tab =
          line?.kind === 'teamIntent'
            ? 'intents'
            : line?.kind === 'teamDrift'
              ? 'drift'
              : ['teamStale', 'teamCollision'].includes(line?.kind)
                ? 'claims'
                : line
                  ? 'people'
                  : teamUi.tab;
        teamUi = { ...teamUi, tab };
        // Opening it reads since-you-last-looked again, which marks it read.
        if (tab !== 'activity' || !open) teamSince = null;
        if (!open) {
          const placed = await $.ui.open({
            id: TEAM_ID,
            title: 'Team',
            focus: true,
            closeOnEscape: true,
          });
          if (!placed?.isPlaced && placed?.reason)
            return { text: `The Team pane is waiting: ${placed.reason}` };
        }
        await act.readMaps();
        $.ui.invalidate('ui.render');
        return {};
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
          for (const a of (await $.agent.list().catch(() => [])) ?? []) agentsSeen.set(a.id, a);
        const who = attribution(agentId, agentsSeen.get(agentId) ?? null, model.check, model.state);
        ledger = withUsage(ledger, who, usage);
        $.ui.invalidate('ui.render');
      },
      // --- the lead loop (spec 05) ---------------------------------------------------------------
      record: async (kind, target, prompt) => {
        loop.steps.push({ at: await $.clock.now(), kind, target, ...(prompt ? { prompt } : {}) });
        if (loop.steps.length > 50) loop.steps.shift();
      },
      // LOOP-1: a prompt to the lead, recorded. It isn't awaited: the turn it starts runs on. LOOP-11:
      // the step is kept until that turn ends, so the loop reads the reply to it.
      submit: async (
        prompt,
        kind,
        target,
        { key = `${kind}:${target}`, label = `${kind} ${target}` } = {},
      ) => {
        loop.started = true;
        loop.proposal = null;
        loop.sent = { prompt, key, label, kind, target };
        // LOOP-12: a design story is handed to the lead once; the person designs it with the lead.
        if (kind === 'design')
          for (const id of String(target).split(/\s+/).filter(Boolean)) loop.handedDesign.add(id);
        await act.record(kind, target, prompt);
        $.ui.invalidate('ui.render');
        $.prompt.submit({ text: prompt }).catch((err) => {
          loop.sent = null;
          notice = `The loop couldn't prompt the lead: ${err?.message ?? err}`;
          $.ui.invalidate('ui.render');
        });
      },
      // LOOP-10: this session takes or renews the lease of the one session that runs the loop; another
      // session holding it keeps it, unless the person moves it here (`take`).
      lead: async ({ take = false } = {}) => {
        const now = await $.clock.now();
        if (lease.mine && !take && now - lease.renewed < LEASE_RENEW_MS) return true;
        const ran = await $.process
          .run(['node', cli, 'loop', 'lead', '--session', session, ...(take ? ['--take'] : [])], {
            cwd,
          })
          .catch(() => ({ exitCode: 1 }));
        const was = lease.mine;
        lease.mine = ran.exitCode === 0;
        lease.renewed = now;
        lease.other = lease.mine ? null : ((await json('loop').catch(() => null))?.lead ?? null);
        // Taken over by another session: this one stops prompting its lead, and offers nothing more.
        if (was && !lease.mine) {
          loop.proposal = null;
          loop.pending = [];
          loop.waiting = null;
        }
        if (was !== lease.mine || !lease.mine) $.ui.invalidate('ui.render');
        return lease.mine;
      },
      // LOOP-10: the person moves the loop to this session; the other stops prompting its lead.
      leadHere: async () => {
        if (!(await act.lead({ take: true }))) {
          notice = "This session couldn't take the loop: code-kit loop lead failed.";
          $.ui.invalidate('ui.render');
          return;
        }
        loop.lastKey = null;
        await act.record('lead', 'this session');
        $.ui.invalidate('ui.render');
        await act.step('resume');
      },
      // LOOP-13: where the watched stories stand now: their states, branch commits, and agents at work.
      storiesNow: async () => {
        const refs = await $.process
          .run(['git', 'for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads'], { cwd })
          .catch(() => ({ stdout: '' }));
        const heads = new Map(
          String(refs.stdout ?? '')
            .split('\n')
            .map((l) => /^\s*(\S+)\s+(?:refs\/heads\/)?(\S+)/.exec(l))
            .filter(Boolean)
            .map((m) => [m[2], m[1]]),
        );
        const inFlight = storiesInFlight(await $.agent.list().catch(() => []));
        const stories = model.state?.stories ?? [];
        return {
          heads,
          inFlight,
          stories,
          sig: (ids) => storiesSignature(ids, stories, heads, inFlight),
        };
      },
      park: async (waits) => {
        if (!waits.length) return;
        const now = await $.clock.now();
        const seen = await act.storiesNow();
        for (const w of waits) {
          const watch = parkWatch(w.id, w.on, seen.stories);
          loop.parked.set(w.id, { on: w.on, why: w.why, watch, sig: seen.sig(watch), at: now });
        }
        $.ui.invalidate('ui.render');
      },
      // LOOP-13: a parked story wakes when anything it watches moves, or after PARK_MS with nothing moving.
      unpark: async () => {
        if (!loop.parked.size) return;
        const now = await $.clock.now();
        const seen = await act.storiesNow();
        for (const [id, p] of loop.parked)
          if (now - p.at >= PARK_MS || seen.sig(p.watch) !== p.sig) loop.parked.delete(id);
      },
      // LOOP-11: the lead's last reply, read once before the loop prompts it again. A reply that waits on
      // the person, or a turn they stopped, holds the loop until they speak; a step the lead didn't take
      // holds that step while it's still next.
      hear: async () => {
        const reply = lastReply;
        if (!reply || reply.read) return;
        reply.read = true;
        const sent = reply.sent;
        const step = sent
          ? {
              key: sent.key,
              label: sent.label,
              prompt: sent.prompt,
              stepKind: sent.kind,
              target: sent.target,
            }
          : {};
        if (reply.aborted) {
          loop.waiting = { kind: 'stopped', ...step };
          $.ui.invalidate('ui.render');
          return;
        }
        // It asked through code-kit: those questions are the person's decisions already.
        const open = ((await json('ask').catch(() => null)) ?? []).filter(
          (q) => q.state === 'open',
        );
        const asked = open.filter((q) => !reply.asked.includes(q.id));
        if (asked.length) {
          model = { ...model, questions: open };
          loop.waiting = {
            kind: 'person',
            ...step,
            questionIds: asked.map((q) => q.id),
            reason: `it asked you ${asked.map((q) => q.id).join(', ')} through code-kit`,
          };
          $.ui.invalidate('ui.render');
          return;
        }
        if (!reply.text.trim()) return;
        const said = await act.sideCall(
          outcomePrompt({ prompt: sent?.prompt ?? null, answer: reply.text }),
        );
        const heard = said.isAnswered ? readOutcome(said.text) : null;
        // Spec 05's data: what came of the step, once known.
        const record = sent ? loop.steps.findLast((x) => x.prompt === sent.prompt) : null;
        if (record) record.outcome = heard?.outcome ?? 'unread';
        // LOOP-13: stories the lead said wait on other work are parked, each until what it waits on moves.
        const ids = stepStories(sent);
        if (['waiting', 'blocked'].includes(heard?.outcome) && ids.length) {
          const named = new Map((heard.waits ?? []).map((w) => [w.story, w]));
          // A blocked step, or a reply that names none, parks all its stories; otherwise those it names.
          const waiting =
            heard.outcome === 'blocked' || !named.size ? ids : ids.filter((id) => named.has(id));
          await act.park(
            waiting.map((id) => ({
              id,
              on: named.get(id)?.on ?? [],
              why: named.get(id)?.why ?? heard.reason ?? null,
            })),
          );
        }
        if (heard?.outcome === 'needs-person')
          loop.waiting = {
            kind: 'person',
            ...step,
            question: heard.question,
            options: heard.options,
            reason: heard.reason,
          };
        else if (heard?.outcome === 'blocked' && sent)
          loop.waiting = { kind: 'blocked', ...step, reason: heard.reason, stories: ids };
        if (loop.waiting) $.ui.invalidate('ui.render');
      },
      // LOOP-11: the person's choice from the lead's options, or their own words, told to the lead.
      answerLead: (line) =>
        act.sendAnswer({ kind: 'lead', question: line.waiting.question }, line.choice),
      answerLeadTyped: (line, text) =>
        act.sendAnswer({ kind: 'lead', question: line.waiting.question }, text),
      answerLeadText: async (line) => {
        answering = {
          kind: 'lead',
          question: line.waiting.question,
          options: line.waiting.options ?? [],
          text: '',
          error: null,
          aside: { thread: [], draft: '' },
        };
        await $.ui.open({ id: ANSWER_ID, title: 'Answer', focus: true, closeOnEscape: true });
        $.ui.invalidate('ui.render');
      },
      // DECIDE-4: a question's answer typed in the dialog, as the person's own words.
      answerTyped: (line, text) => act.sendAnswer({ kind: 'question', ...line.question }, text),
      // LOOP-11, LOOP-12: the person asks the lead again for the step that held the loop.
      askAgain: async () => {
        const w = loop.waiting;
        if (!w?.prompt || leadTurn) return;
        loop.waiting = null;
        for (const id of w.stories ?? []) loop.parked.delete(id);
        loop.asked = { key: w.key, times: 0 };
        await act.submit(w.prompt, w.stepKind, w.target, { key: w.key, label: w.label });
      },
      // LOOP-11: the person lets the loop go on.
      carryOn: async () => {
        for (const id of loop.waiting?.stories ?? []) loop.parked.delete(id);
        loop.waiting = null;
        loop.lastKey = null;
        $.ui.invalidate('ui.render');
        await act.step('resume');
      },
      // DECIDE-4: the next decision the person settles with a choice, asked in Claude Code's own question
      // dialog while the lead is idle. Each is asked once: dismissed, it stays in the band and the
      // Decisions tab. Never in a session another one runs the loop for, nor over what the person types.
      offer: async () => {
        if (offering || leadTurn || loop.sent || !where.interactive) return;
        if (lease.other && !lease.mine) return;
        const now = await $.clock.now();
        const choice = cardsNow(now)
          .map((card) => ({ card, choice: nativeChoice(card) }))
          .find((c) => c.choice && !offered.has(c.choice.key));
        if (!choice) return;
        const box = await $.prompt.read().catch(() => null);
        if (box?.text?.trim()) return;
        offered.add(choice.choice.key);
        offering = true;
        const { question, header, options, typed } = choice.choice;
        const answer = await $.ui
          .ask(question, { options: options.map((o) => o.label), header })
          .catch(() => null)
          .finally(() => {
            offering = false;
          });
        if (answer == null) return;
        const picked = options.find((o) => o.label === answer);
        if (picked?.act) await act[picked.act](picked.line);
        else if (!picked && typed && answer.trim())
          await act[typed](choice.card.line, answer.trim());
        act.offer().catch(() => {});
      },
      // LOOP-1, LOOP-5, LOOP-7: with the lead idle and no draft, the step `next` reports.
      step: async (trigger) => {
        const h = harness();
        if (loop.paused || h.autonomy === 'off' || model.state?.kind !== 'ok' || loop.done) return;
        if (leadTurn) return;
        if (trigger === 'tick' && !loop.started && !loop.pending.length) return;
        const box = await $.prompt.read().catch(() => null);
        if (box?.text?.trim()) return;
        // LOOP-10: one session in the project runs the loop; in any other, the lead is the person's alone.
        if (!(await act.lead())) return;
        // LOOP-11: the lead's last reply first: one that waits on the person holds every step.
        await act.hear();
        if (loop.waiting && ['person', 'stopped'].includes(loop.waiting.kind)) return;
        if (loop.pending.length) {
          const { story, prompt } = loop.pending.shift();
          // Until the person has chosen how hands-off the loop is, or under propose, a restart is offered
          // like any other step, not taken.
          const chosenYet = (model.check?.harnessSet ?? []).includes('autonomy');
          if (!chosenYet || h.autonomy === 'propose') {
            loop.proposal = {
              prompt,
              label: `Restart ${story}`,
              kind: 'restart',
              target: story,
              key: `restart:${story}`,
              first: !chosenYet,
            };
            $.ui.invalidate('ui.render');
            return;
          }
          return act.submit(prompt, 'restart', story);
        }
        const ran = await $.process.run(['node', cli, 'next', '--json'], { cwd });
        // LOOP-13: a parked story stays out of the step until what it waits on moves.
        await act.unpark();
        // LOOP-9: never a story an agent is already at work on, building or reviewing it.
        const step =
          ran.exitCode === 0
            ? withoutInFlight(
                parseJson(ran.stdout),
                storiesInFlight(await $.agent.list().catch(() => [])),
                loop.parked,
              )
            : null;
        // MISSION-1: the band shows what the loop takes next.
        loop.nextStep = step;
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
        // A different step, or none for the lead, starts the count of times in a row again.
        if (key !== loop.asked.key || !prompt) {
          loop.asked = { key, times: 0 };
          if (loop.proposal?.repeated) loop.proposal = null;
        }
        // LOOP-11, LOOP-12: a step the lead didn't take, or designs left to the person and the lead, hold
        // that step while it's still next; any other step goes on.
        if (loop.waiting) {
          // LOOP-13: a blocked step's stories are parked, so the line stays while any of them is, and
          // other steps go on; a step without stories holds while it's still next.
          const stories = loop.waiting.stories ?? [];
          const held = stories.length
            ? stories.some((id) => loop.parked.has(id))
            : loop.waiting.key === key;
          if (held && !stories.length) return;
          if (!held) {
            loop.waiting = null;
            $.ui.invalidate('ui.render');
          }
        }
        if (!prompt) return;
        if (designHandedOver(step, loop.handedDesign)) {
          loop.waiting = { kind: 'design', key, label, prompt, stepKind: kind, target };
          $.ui.invalidate('ui.render');
          return;
        }
        // Never the same step twice while the project stands still.
        const print = await act.fingerprint();
        if (key === loop.lastKey && print === loop.lastPrint) return;
        loop.lastKey = key;
        loop.lastPrint = print;
        // LOOP-8: a step the lead was asked for twice and that is still next didn't take: the project
        // moving elsewhere (lanes committing) doesn't make a third prompt useful. The person decides.
        if (loop.asked.times >= ASK_LIMIT) {
          if (loop.proposal?.label !== label) {
            loop.proposal = { prompt, label, kind, target, key, repeated: loop.asked.times };
            $.ui.invalidate('ui.render');
          }
          return;
        }
        // Until the person has chosen how hands-off the loop is, its first step is offered, not taken.
        const chosen = (model.check?.harnessSet ?? []).includes('autonomy');
        if (h.autonomy === 'propose' || !chosen) {
          loop.proposal = { prompt, label, kind, target, key, first: !chosen };
          $.ui.invalidate('ui.render');
          return;
        }
        loop.asked.times += 1;
        await act.submit(prompt, kind, target, { key, label });
      },
      // The first offer's answers: the person's choice of autonomy, recorded as theirs, then acted on.
      chooseAutonomy: async (value) => {
        const ran = await $.process.run(
          [
            'node',
            cli,
            'settings',
            'set',
            'autonomy',
            value,
            '--reason',
            'Chosen when code-kit first offered to keep the build moving between prompts',
            '--via',
            'pane',
          ],
          { cwd },
        );
        if (ran.exitCode !== 0) {
          notice = `Nothing was changed: ${(ran.stderr || ran.stdout).trim().split('\n')[0]}`;
          $.ui.invalidate('ui.render');
          return false;
        }
        await act.reload();
        return true;
      },
      keepGoing: async () => {
        if (!(await act.chooseAutonomy('autonomous'))) return;
        await act.go();
      },
      askEach: async () => {
        if (!(await act.chooseAutonomy('propose'))) return;
        if (loop.proposal) loop.proposal = { ...loop.proposal, first: false };
        $.ui.invalidate('ui.render');
      },
      loopOff: async () => {
        if (!(await act.chooseAutonomy('off'))) return;
        loop.proposal = null;
        $.ui.invalidate('ui.render');
      },
      go: async () => {
        if (!loop.proposal || leadTurn) return;
        const { prompt, kind, target, key, label, repeated } = loop.proposal;
        // The person asked again: once more, then it's theirs to offer again if it still doesn't take.
        loop.asked.times = repeated ? ASK_LIMIT : loop.asked.times + 1;
        await act.submit(prompt, kind, target, { key, label });
      },
      // LOOP-6: pausing stops new steps at once; a turn in progress finishes.
      pause: async () => {
        loop.paused = true;
        loop.proposal = null;
        // Recorded, so other tools' background work in this project pauses with the loop.
        await $.process.run(['node', cli, 'loop', 'pause'], { cwd }).catch(() => {});
        await act.record('pause', 'the loop');
        $.ui.invalidate('ui.render');
      },
      resume: async () => {
        loop.paused = false;
        await $.process.run(['node', cli, 'loop', 'resume'], { cwd }).catch(() => {});
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
        for (const agent of (await $.agent.list().catch(() => [])) ?? []) {
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
          // LOOP-3: an agent whose work is done isn't stalled: it handed back, or its story is in review,
          // in the merge queue or merged. Nothing to nudge or restart.
          if (finishedWork(a)) {
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
      // VIEW-3: working characters repaint in place while the pane shows them; nothing runs otherwise.
      animate: async () => {
        const open = (await $.ui.panes()).some((p) => p.id === PANE_ID);
        const now = await $.clock.now();
        const art = artNow(now, liveNow(now));
        const working = Object.keys(art.poses).filter((n) => art.poses[n] === 'working');
        if (!open || paneSurface !== 'terminal' || !working.length) {
          animation?.cancel();
          animation = null;
          return;
        }
        if (animation) return;
        animation = $.clock.every(400, async () => {
          frame = (frame + 1) % 2;
          const at = await $.clock.now();
          const still = artNow(at, liveNow(at));
          for (const name of Object.keys(still.poses).filter((n) => still.poses[n] === 'working'))
            await $.ui
              .blit({
                requestId: PANE_ID,
                key: `char-${name}`,
                cells: rasterCells(
                  sprite('working', frame, still.tints[name], { lead: name === 'lead' }),
                ),
              })
              .catch(() => {});
        });
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
        ((await $.agent.list().catch(() => [])) ?? []).find(
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
      // VIEW-7: a story's drill-down, its facts from `code-kit story --json`.
      openStory: async (lane) => {
        if (!lane.story) return;
        const id = lane.story.id;
        paneUi = { ...paneUi, story: id, file: null };
        storyOpen = { id, lane: lane.name, data: null, error: null };
        $.ui.invalidate('ui.render');
        const ran = await $.process.run(['node', cli, 'story', id, '--json'], {
          cwd,
          timeoutMs: 180000,
        });
        if (storyOpen?.id !== id) return;
        const data = ran.exitCode === 0 ? parseJson(ran.stdout) : null;
        storyOpen = data
          ? { ...storyOpen, data }
          : {
              ...storyOpen,
              error: (ran.stderr || ran.stdout).trim().split('\n')[0] || 'code-kit story failed',
            };
        $.ui.invalidate('ui.render');
      },
      closeStory: () => {
        paneUi = { ...paneUi, story: null, file: null };
        storyOpen = null;
        $.ui.invalidate('ui.render');
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
        // LOOP-10: the lead session renews its lease; DECIDE-4: with the lead idle, a decision waiting.
        if (lease.mine) await act.lead();
        if (!leadTurn) act.offer().catch(() => {});
        await act.stalls();
        await act.animate();
        const now = await act.fingerprint();
        const paneOpen = (await $.ui.panes()).some((p) => [PANE_ID, TEAM_ID].includes(p.id));
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
  on('command.run', { command: 'team' }, async ($, e) =>
    act ? act.team(null, { toggle: true }) : starting('team'),
  );
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
  // PERM-1: Claude Code's own permission check refused a call (auto mode, a deny rule): code-kit can't
  // approve past it, so it waits in the band for the person, who can run it themselves or allow it.
  on('classic.PermissionDenied', async ($, e, next) => {
    const res = await next(e);
    const input = e.tool_input && typeof e.tool_input === 'object' ? e.tool_input : {};
    const command =
      e.tool_name === 'Bash' && typeof input.command === 'string' ? input.command : null;
    const path = input.file_path ?? input.notebook_path ?? null;
    const lane = e.agent_id ? activity.get(e.agent_id)?.lane : null;
    denied.set(e.tool_use_id ?? `${e.tool_name}-${denied.size}`, {
      id: e.tool_use_id ?? `${e.tool_name}-${denied.size}`,
      agentId: e.agent_id ?? null,
      who: lane ? `the ${lane} lane` : (e.agent_type ?? (e.agent_id ? 'an agent' : 'the lead')),
      tool: e.tool_name,
      command,
      what: command
        ? `\`${commandItself(command)}\``
        : path
          ? `${e.tool_name} on ${path}`
          : e.tool_name,
      reason:
        typeof e.reason === 'string'
          ? e.reason.trim().replace(/\s+/g, ' ').slice(0, 200) || null
          : null,
      at: await $.clock.now(),
    });
    $.ui.invalidate('ui.render');
    return res;
  });

  on('tool.call', async ($, e, next) => {
    // LOOP-3: a lane agent's tool call is activity; while it runs, the agent isn't quiet.
    const calledAt = await $.clock.now();
    const busy = e.agentId ? activityOf(e.agentId, calledAt) : null;
    if (busy) {
      busy.inFlight += 1;
      busy.nudged = false;
      busy.stopped = false;
      busy.handedBack = false;
      // VIEW-4: the agent's current or last tool call.
      busy.tool = toolLine(e);
      busy.at = calledAt;
    } else if (!e.agentId) leadLast = { tool: toolLine(e), at: calledAt };
    // MAP-2: the file the call reads or edits glows in the code map, in its lane's colour. An agent
    // first seen on this call has its lane found by its type.
    const touch = touchOf(e, where?.cwd);
    if (touch && busy && !busy.lane) {
      const agent = ((await $.agent.list().catch(() => [])) ?? []).find((a) => a.id === e.agentId);
      busy.lane =
        Object.entries(model.check?.lanes ?? {}).find(([, l]) => l.agent === agent?.type)?.[0] ??
        busy.lane;
    }
    const touchLane = busy ? busy.lane : e.agentId ? null : 'lead';
    if (touch && touchLane) {
      touches.push({ ...touch, lane: touchLane, at: calledAt });
      if (touches.length > TOUCHES_KEPT) touches.shift();
      if (paneUi.tab === 'code') $.ui.invalidate('ui.render');
    }
    try {
      const res = await next(e);
      const text = res?.deny ?? (res?.isError ? (res.text ?? String(res.result ?? '')) : null);
      // PERM-1: a refused call that later goes through (retried, or allowed) no longer waits for the person.
      if (!text && denied.size) {
        const command = e.tool === 'Bash' ? (e.command ?? null) : null;
        const before = denied.size;
        for (const [id, d] of denied)
          if (
            d.tool === e.tool &&
            d.agentId === (e.agentId ?? null) &&
            (!d.command || d.command === command)
          )
            denied.delete(id);
        if (denied.size < before) $.ui.invalidate('ui.render');
      }
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
        // DECIDE-2: the call itself, and the rule that refused it.
        command: e.command ?? e.file_path ?? null,
        refusal: text.split('\n')[0],
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

  // SET-4: a lane agent starts on the lane model the person set, unless the lead's call names one or
  // the lane's agent file sets its own.
  on('agent.spawn', async ($, e, next) => {
    const setting = harness().agents.lanes.model;
    const lanes = model.check?.lanes ?? {};
    if (!setting || e.model || !Object.values(lanes).some((l) => l.agent === e.subagentType))
      return next(e);
    const file = where
      ? await $.fs.read(`${where.cwd}/.claude/agents/${e.subagentType}.md`).catch(() => null)
      : null;
    const chosen = laneModel({
      type: e.subagentType,
      model: e.model,
      lanes,
      setting,
      fileModel: typeof file === 'string' ? agentFileModel(file) : null,
    });
    return next(chosen ? { ...e, model: chosen } : e);
  }).catch(($, e, next) => next(e));

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
    // LOOP-11: the questions already open, so the loop knows which the lead asked in this turn.
    turnQuestions = (model.questions ?? []).map((q) => q.id);
    $.ui.invalidate('ui.render'); // the lead's lane reads working while its turn runs
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
    // LOOP-3: a lane agent that has handed back its work isn't stalled while it waits; a message that
    // starts it again shows as its next tool call.
    if (e.agentId) activityOf(e.agentId, await $.clock.now()).handedBack = true;
    // REVW-3: a subagent's last turn may be the reviewer's report.
    if (e.agentId && act) await act.reviewed(e.agentId, e.answer).catch(() => {});
    // LOOP-1: the lead is idle; the loop's next step, if one is due (submitted from turn.complete,
    // as the spike found it must be). The prompt it submits isn't awaited: that turn isn't this hook's.
    if (!e.agentId && (!leadTurn || leadTurn === e.turnId)) {
      leadTurn = null;
      // LOOP-11: the lead's reply, read before the loop next prompts it, with the step it answered.
      lastReply = {
        turnId: e.turnId,
        text: e.answer ?? '',
        aborted: Boolean(e.isAborted),
        sent: loop.sent,
        asked: turnQuestions,
        read: false,
      };
      loop.sent = null;
      $.ui.invalidate('ui.render');
      // What the person asked for goes first, whatever the loop's state.
      if (personAsks.length) {
        const text = personAsks.shift();
        $.prompt.submit({ text }).catch(() => {});
        return res;
      }
      await act?.step('turn').catch(() => {});
      // DECIDE-4: a decision waiting, asked in Claude Code's own dialog; not awaited, the person answers.
      act?.offer().catch(() => {});
    }
    return res;
  });

  // LOOP-11: the person speaking to the lead answers what the loop waited on, whatever they said; the
  // loop reads the lead's reply to them before it prompts again. Designs stay theirs (LOOP-12).
  on('prompt.submit', async ($, e, next) => {
    if (['composer', 'bridge'].includes(e.origin?.kind) && loop.waiting?.kind !== 'design') {
      if (loop.waiting) $.ui.invalidate('ui.render');
      loop.waiting = null;
      loop.asked = { key: null, times: 0 };
    }
    return next(e);
  });

  // LOOP-10: the lead session ends: the next session to act takes the loop at once.
  on('session.end', async ($, e, next) => {
    if (lease.mine && where) {
      lease.mine = false;
      await $.process
        .run(['node', where.cli, 'loop', 'release', '--session', where.session], { cwd: where.cwd })
        .catch(() => {});
    }
    return next(e);
  });

  // What the pane and band show of the loop.
  const loopNow = (now) => {
    const h = harness();
    const state =
      h.autonomy === 'off'
        ? 'off'
        : lease.other && !lease.mine
          ? 'elsewhere'
          : loop.done
            ? 'done'
            : loop.paused
              ? 'paused'
              : 'running';
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
      waiting: loop.waiting,
      flagged: [...flagged.values()],
      doneCount: loop.done?.count ?? 0,
      steps: loop.steps,
      // LANES-1: the step the lead is taking now (the loop's last prompt, while its turn runs), and the next.
      current: leadTurn && loop.started ? (loop.steps.at(-1) ?? null) : null,
      nextText: nextText(loop.nextStep),
      laneNotes,
      now,
      reviews: [...reviews.values()].map((r) => ({
        ...r,
        summary: findingsCount(r.findings),
        blockers: r.findings.filter((f) => f.severity === 'blocker').length,
      })),
    };
  };

  // The project as the panes draw it: the lead active while its turn runs, which the last read can't know.
  const stateNow = () =>
    model.state?.kind === 'ok'
      ? {
          ...model.state,
          lanes: model.state.lanes.map((l) =>
            l.name === 'lead' ? { ...l, active: Boolean(leadTurn) } : l,
          ),
        }
      : model.state;
  // VIEW-4: each lane's current or last tool call, and how long ago.
  // JOIN-2: each lane's facts from the adapters: edits without understanding and cards owed.
  const factsOf = (lane) => {
    const key = lane.agent ?? 'lead';
    const out = { withoutUnderstanding: [], cardsOwed: [] };
    for (const a of model.adapters ?? []) {
      const f = a.lanes?.[key];
      if (!f) continue;
      out.withoutUnderstanding.push(...f.withoutUnderstanding);
      out.cardsOwed.push(...f.cardsOwed.filter((c) => !out.cardsOwed.includes(c)));
    }
    return out;
  };
  const combinedNow = () => {
    if (!(model.adapters ?? []).some((a) => a.lanes)) return null;
    const lanesNow = stateNow()?.kind === 'ok' ? stateNow().lanes : [];
    return Object.fromEntries(
      lanesNow.map((l) => {
        const f = factsOf(l);
        return [l.name, { without: f.withoutUnderstanding.length, owed: f.cardsOwed.length }];
      }),
    );
  };
  // VIEW-2, VIEW-3: each lane's pose and tint, and its story's bar on the shared axis.
  const artNow = (now, live) => {
    const lanesNow = stateNow()?.kind === 'ok' ? stateNow().lanes : [];
    const names = lanesNow.map((l) => l.name);
    const queue = model.queue ?? [];
    const asking = new Set([
      ...[...held.values()].map((c) => c.lane ?? 'lead'),
      ...(model.requests?.open ?? []).map((r) => r.lane ?? 'lead'),
    ]);
    const stalled = new Set([...flagged.values()].map((f) => f.lane));
    const times = (model.timeline?.stories ?? []).filter((t) =>
      lanesNow.some((l) => l.story?.id === t.id),
    );
    const start = axisStart(times, now);
    const width = Math.max(10, Math.min(120, paneColumns - 14));
    const poses = {};
    const tints = {};
    const bars = {};
    for (const l of lanesNow) {
      poses[l.name] = poseOf(l, {
        live: live[l.name],
        waiting: asking.has(l.name),
        flagged: stalled.has(l.name),
        shown: shownState(l, queue),
      });
      tints[l.name] = tintOf(l.name, names);
      const t = times.find((x) => x.id === l.story?.id);
      if (t) bars[l.name] = barCells(t, { start, now, width });
    }
    return { surface: paneSurface, frame, poses, tints, bars, svgWidth: width * 6 };
  };
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
  // VIEW-7: the drill-down's view of the open story, with what the session knows of it.
  const storyNow = (open, now, usage) => {
    const lane = model.state?.lanes?.find((l) => l.name === open.lane) ?? null;
    const branch = open.data?.branch ?? lane?.branch ?? null;
    return {
      story: open,
      review: branch ? (reviews.get(branch) ?? null) : null,
      tokens: usage?.stories?.[open.id] ?? 0,
      outlier: usage?.outliers?.find((o) => o.id === open.id)?.ratio ?? null,
      steps: loop.steps.filter(
        (s) => s.target.includes(open.id) || (branch && s.target.includes(branch)),
      ),
      actions: lane
        ? laneActions(lane, {
            queue: model.queue ?? [],
            held: [...held.values()],
            requests: model.requests?.open ?? [],
          }).filter((a) => !['nudge', 'stop'].includes(a.id))
        : [],
      file: paneUi.file,
      now,
      understanding: lane && (model.adapters ?? []).some((a) => a.lanes) ? factsOf(lane) : null,
    };
  };
  // The band's lines, which the pane pins as what needs the person (VIEW-5).
  // JOURNAL-1: the lineage from the project's records, with this session's loop steps and your own acts
  // in it, in time order.
  const STEP_WORDS = {
    dispatch: (t) => `The loop asked the lead to hand out ${t}.`,
    review: (t) => `The loop asked the lead to review ${t}.`,
    lead: (t) => `The loop asked the lead to build ${t} itself.`,
    merge: (t) => `The loop asked the lead to merge ${t}.`,
    restart: (t) => `The loop asked the lead to restart ${t}, which had gone quiet.`,
    nudge: (t) => `The loop nudged ${t}, which had gone quiet.`,
    flag: (t) => `${t} stalled again after its restarts, so it came to you.`,
    pause: () => 'You paused the loop.',
    resume: () => 'You resumed the loop.',
    lead: () => 'You moved the loop to this session.',
    done: (t) => `Every story was done (${t}).`,
  };
  const journalNow = () => {
    const recorded = journalData?.events ?? [];
    const steps = loop.steps
      .filter((x) => STEP_WORDS[x.kind])
      .map((x) => ({
        at: x.at,
        kind: 'loop',
        who: ['pause', 'resume', 'lead'].includes(x.kind) ? 'person' : 'lead',
        text: STEP_WORDS[x.kind](x.target),
      }));
    return [...recorded, ...steps].sort((a, b) => a.at - b.at);
  };
  // DECIDE-2: the decisions that need the person, each with its lineage.
  const cardsNow = (now, lines = linesNowRaw(now)) => {
    const events = journalData?.events ?? [];
    const goal = goalOf(model.state?.stories ?? []);
    const asked =
      events.find((e) => e.kind === 'request')?.text.replace(/^You asked for /, '') ?? null;
    return decisionCards(lines, {
      state: model.state,
      status: model.status,
      check: model.check,
      goal: goal ? goal.name : null,
      request: asked,
      journal: events,
      inForce: model.requests?.inForce ?? [],
    });
  };
  // The band's lines, each that needs the person carrying which story it's for.
  const linesNow = (now) => {
    const lines = linesNowRaw(now);
    const cards = cardsNow(now, lines);
    return lines.map((l) => {
      const card = cards.find((c) => c.source === l);
      return card ? { ...l, context: contextOf(card) } : l;
    });
  };
  const linesNowRaw = (now) =>
    bandLines({
      ...model,
      reviewing,
      notice,
      ...usageNow(),
      held: [...held.values()],
      now,
      loop: loopNow(now),
      leadBusy: Boolean(leadTurn),
      live: liveNow(now),
      nextStep: loop.nextStep,
      combined: combinedNow(),
      team: model.team ?? null,
      denied: [...denied.values()],
    });

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const now = await $.clock.now();
    paneSurface = e.surface;
    paneColumns = e.props.bodyColumns ?? paneColumns;
    const { usage, plan } = usageNow();
    const lanesNow = stateNow()?.kind === 'ok' ? stateNow().lanes : [];
    return lanesFrame(
      {
        state: stateNow(),
        usage,
        plan,
        loop: { ...loopNow(now), queue: model.queue ?? [] },
        needs: linesNow(now).filter((l) => !l.mission),
        cards: cardsNow(now),
        journal: journalNow(),
        now,
        live: liveNow(now),
        held: [...held.values()],
        requests: model.requests?.open ?? [],
        ui: paneUi,
        status: model.status ?? null,
        // VIEW-6: what each lane owns, for the selected lane's detail.
        paths: {
          lead: model.check?.lead?.paths ?? [],
          ...Object.fromEntries(
            Object.entries(model.check?.lanes ?? {}).map(([n, l]) => [n, l.paths ?? []]),
          ),
        },
        art: artNow(now, liveNow(now)),
        combined: combinedNow(),
        codeMap,
        trail: trailData,
        glow: glowOf(touches, now),
        surface: paneSurface,
        columns: paneColumns,
        placement: e.props.placement,
        story: storyOpen ? storyNow(storyOpen, now, usage) : null,
      },
      $.ui.resolve(e),
      {
        onTab: (tab) => {
          paneUi = { ...paneUi, tab };
          $.ui.invalidate('ui.render');
          act?.readMaps().then(() => $.ui.invalidate('ui.render'));
        },
        onDecision: (i) => {
          paneUi = { ...paneUi, decision: i };
          $.ui.invalidate('ui.render');
        },
        onMapStory: (id) => {
          paneUi = { ...paneUi, mapStory: id, mapFile: null };
          $.ui.invalidate('ui.render');
          act?.readMaps().then(() => $.ui.invalidate('ui.render'));
        },
        onMapFile: (path) => {
          paneUi = { ...paneUi, mapFile: path };
          $.ui.invalidate('ui.render');
        },
        // MAP-3: the file in Context Graph's own view, through the command its adapter names.
        onOpenFile: (path) => {
          const command = codeMap?.open?.command;
          if (!command) return;
          $.command.run({ command, args: path }).catch((err) => {
            notice = `Couldn't open ${path}: ${err?.message ?? err}`;
            $.ui.invalidate('ui.render');
          });
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
          // VIEW-6: Enter opens the selected lane's story: the focus waits on its Open button.
          if (
            lanesNow[to].story ||
            (model.state?.stories ?? []).some((s) => s.lane === lanesNow[to].name)
          )
            $.ui.focus({ requestId: PANE_ID, key: 'open-story' }).catch(() => {});
        },
        onOpen: (lane) => act?.openStory(lane),
        // TRACE-2: a cell selected by its keys or the requirement list.
        onCell: (cell) => {
          paneUi = { ...paneUi, cell };
          $.ui.invalidate('ui.render');
        },
        story: {
          onBack: () => act?.closeStory(),
          onFile: (file) => {
            paneUi = { ...paneUi, file };
            $.ui.invalidate('ui.render');
          },
          // JOIN-4: a file in the adapter's own view, through the command it names.
          onOpenIn: (adapter, path) =>
            $.command.run({ command: adapter.open.command, args: path }).catch((err) => {
              notice = `Couldn't open ${path} in ${adapter.name}: ${err?.message ?? err}`;
              $.ui.invalidate('ui.render');
            }),
          onAct: (id) => {
            const lane = lanesNow.find((l) => l.name === storyOpen?.lane);
            if (lane) act?.laneAct(id, lane);
          },
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

  // VIEW-6: Escape on a story goes back to the lanes; on the lanes, it closes the pane.
  on('ui.close', async ($, e, next) => {
    if (closeGoesBack(e, PANE_ID, paneUi)) {
      act?.closeStory();
      return;
    }
    return next(e);
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
      onAskInput: (value) => {
        approving = { ...approving, aside: { ...approving.aside, draft: value } };
        $.ui.invalidate('ui.render');
      },
      onAsk: (value) => act.askApproval(value),
    });
  });

  // ASK-2, ASK-4: the person's answer, in their own words.
  on('ui.render', { component: 'Pane', requestId: ANSWER_ID }, async ($, e) => {
    if (!answering) return resultPane(null, $.ui.resolve(e));
    return answerPane(answering, $.ui.resolve(e), {
      onInput: (value) => {
        answering = { ...answering, text: value };
        $.ui.invalidate('ui.render');
      },
      onSubmit: (value) => act.confirmAnswer(value),
      onCancel: () => act.cancelAnswer(),
      onAskInput: (value) => {
        answering = { ...answering, aside: { ...answering.aside, draft: value } };
        $.ui.invalidate('ui.render');
      },
      onAsk: (value) => act.askAnswer(value),
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

  // TEAM-7: the Team pane.
  on('ui.render', { component: 'Pane', requestId: TEAM_ID }, async ($, e) =>
    teamFrame(
      {
        team: model.team ?? null,
        since: teamSince,
        config: model.check?.team ? { ...model.check.team, lanes: model.check.lanes ?? {} } : null,
        ui: teamUi,
      },
      $.ui.resolve(e),
      {
        onTab: (tab) => {
          if (tab !== 'activity') teamSince = null;
          teamUi = { ...teamUi, tab, reassign: null, handle: '' };
          $.ui.invalidate('ui.render');
          act?.readMaps().then(() => $.ui.invalidate('ui.render'));
        },
        onNeed: (id, line) => act?.[id]?.(line),
        onReassign: (story) => {
          teamUi = { ...teamUi, reassign: story, handle: '' };
          $.ui.invalidate('ui.render');
        },
        onHandle: (handle) => {
          teamUi = { ...teamUi, handle };
          $.ui.invalidate('ui.render');
        },
        onReassignTo: (story, handle) => act?.reassignTo(story, handle),
        onSetup: () => act?.teamSetup(),
      },
    ),
  );

  on('ui.render', { component: 'Pane', requestId: RESULT_ID }, async ($, e) =>
    resultPane(result, $.ui.resolve(e)),
  );
}
