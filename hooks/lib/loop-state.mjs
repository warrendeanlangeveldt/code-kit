// The lead loop's state, kept beside the merge queue (spec 05): whether the person has paused it
// (LOOP-6), so other tools sharing the project can hold their own background work while it's paused;
// and which session runs it (LOOP-10), so a second session opened in the project never prompts its
// lead too. The mod records both through the CLI.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { projectWorktrees } from './rules.mjs';

export const LOOP_FILE = '.claude/state/loop.json';
/** LOOP-10: a lead session renews its lease well within this; one not renewed for this long has ended. */
export const LEAD_LEASE_MS = 90000;

const loopFile = (root) => join(projectWorktrees(root)[0] ?? root, LOOP_FILE);

function readRaw(root) {
  try {
    const state = JSON.parse(readFileSync(loopFile(root), 'utf8'));
    return state && typeof state === 'object' ? state : {};
  } catch {
    return {};
  }
}

function writeRaw(root, state) {
  const file = loopFile(root);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state)}\n`);
}

/** The session holding the lead lease, while it holds it: { session, at }, or null. */
const liveLead = (state, now) => {
  const lead = state.lead;
  if (!lead?.session || !lead.at) return null;
  return now - Date.parse(lead.at) < LEAD_LEASE_MS ? { session: lead.session, at: lead.at } : null;
};

/** { paused, at, lead }: not paused when nothing was recorded; `lead` is the live lead session or null. */
export function readLoop(root, now = Date.now()) {
  const state = readRaw(root);
  return { paused: state.paused === true, at: state.at ?? null, lead: liveLead(state, now) };
}

export function writeLoop(root, paused, now = Date.now()) {
  writeRaw(root, { ...readRaw(root), paused, at: new Date(now).toISOString() });
}

/**
 * LOOP-10: `session` takes or renews the lead lease. Another live session keeps it unless `take` (the
 * person moved the loop here): { ok: true } or { ok: false, lead } naming the session that has it.
 */
export function claimLead(root, session, { take = false } = {}, now = Date.now()) {
  const state = readRaw(root);
  const lead = liveLead(state, now);
  if (lead && lead.session !== session && !take) return { ok: false, lead };
  writeRaw(root, { ...state, lead: { session, at: new Date(now).toISOString() } });
  return { ok: true, lead: null };
}

/** LOOP-10: the lead session ends: its lease goes, so the next session to act takes the loop at once. */
export function releaseLead(root, session) {
  const state = readRaw(root);
  if (state.lead?.session !== session) return false;
  const { lead: _lead, ...rest } = state;
  writeRaw(root, rest);
  return true;
}
