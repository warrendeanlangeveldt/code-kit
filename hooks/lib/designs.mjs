// Designs handed over (docs/specs/24-designs-handed-over.md). An approved design is files in the
// repository, each state's code where the tool gives it and a PNG, named in the design register with a
// hash of each, so a lane builds from what the person approved and the review compares with it. The
// design gate (ONB-2) refuses a screen until the register lists it; this checks what the register holds.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { markdownFiles } from './plan.mjs';

/** The states a screen has when its spec names none: the ones every screen is asked for. */
export const STATE_WORDS = ['default', 'empty', 'loading', 'error'];

/** A file's sha256, or null when it isn't there. */
export function sha256Of(root, rel) {
  try {
    return createHash('sha256')
      .update(readFileSync(join(root, rel)))
      .digest('hex');
  } catch {
    return null;
  }
}

/** The register's entries: `{ entries }`, or `{ entries: [], error }` when it can't be read. */
export function readRegister(root, config, text = null) {
  const register = config.designGate?.register;
  if (!register) return { entries: [] };
  try {
    const raw = JSON.parse(text ?? readFileSync(join(root, register), 'utf8'));
    return { entries: Array.isArray(raw.screens) ? raw.screens : [] };
  } catch (e) {
    return { entries: [], error: `${register} is missing or invalid (${e.message}).` };
  }
}

/** HAND-2: whether an entry's design is files in the repository rather than only in a design tool. */
export const handedOver = (entry) => Array.isArray(entry?.states) && entry.states.length > 0;

/** The tool an entry's design lives in, for an entry not handed over yet: "paper" from "paper:…". */
export const toolOf = (entry) =>
  entry?.source?.tool ??
  String(entry?.design ?? '').match(/^([a-z][\w-]*):/i)?.[1] ??
  'the design tool';

/**
 * HAND-2: the states the specs' `## Screens` sections give `screen`: its `**States:**` line, or else the
 * usual state words its text mentions (default always). Null when no spec lists the screen.
 */
export function screenStates(root, specs, screen) {
  if (!specs || !screen) return null;
  const name = String(screen).toLowerCase();
  for (const file of markdownFiles(root, specs)) {
    let text;
    try {
      text = readFileSync(join(root, file), 'utf8');
    } catch {
      continue;
    }
    const section = text.split(/^## /m).find((s) => /^Screens\b/i.test(s));
    if (!section) continue;
    const lines = section.split('\n');
    const at = lines.findIndex(
      (l, i) => i > 0 && /^(#{3,4}\s|\s*[-*]\s)/.test(l) && l.toLowerCase().includes(name),
    );
    if (at < 0) continue;
    const ownIndent = lines[at].match(/^\s*/)[0].length;
    const isHeading = /^#{3,4}\s/.test(lines[at]);
    const block = [lines[at]];
    for (const l of lines.slice(at + 1)) {
      if (/^#{1,4}\s/.test(l)) break;
      if (!isHeading && /^\s*[-*]\s/.test(l) && l.match(/^\s*/)[0].length <= ownIndent) break;
      block.push(l);
    }
    const body = block.join('\n');
    const listed = body.match(/\*\*States:\*\*\s*(.+)/i)?.[1];
    if (listed)
      return listed
        .split(/[,;]/)
        .map((s) => s.trim().toLowerCase().replace(/\.$/, ''))
        .filter(Boolean);
    return STATE_WORDS.filter((w) => w === 'default' || new RegExp(`\\b${w}\\b`, 'i').test(body));
  }
  return null;
}

/**
 * HAND-2: what's wrong with a register entry, in sentences naming the screen, the state and the file:
 * a design only in a tool, a field missing, a file not there, a hash that isn't the approved one, or a
 * state the spec lists with none. `specs` is the specs' folder, for the states each screen should have.
 */
export function entryProblems(root, entry, specs = null) {
  const screen = entry.screen ?? entry.file;
  const fix = 'Export it from the design tool with /code-kit:design, as the person approved it.';
  if (!handedOver(entry))
    return [
      `${entry.file}: its approved design (${screen}) is only in ${toolOf(entry)}, not as files a lane can read. Hand it over: /code-kit:design --hand-over.`,
    ];
  const problems = [];
  for (const field of ['screen', 'story', 'approved', 'source'])
    if (!entry[field]) problems.push(`${entry.file}: its register entry has no "${field}".`);
  for (const state of entry.states) {
    const name = state?.name ?? '(unnamed)';
    const where = `${screen}'s ${name} state`;
    if (!state?.image) problems.push(`${where} has no image. ${fix}`);
    if (!state?.code && !state?.why)
      problems.push(`${where} has no code, and no "why" saying the tool gives none. ${fix}`);
    if (!state?.viewport) problems.push(`${where} doesn't say the viewport it was drawn at.`);
    for (const kind of ['image', 'code']) {
      const rel = state?.[kind];
      if (!rel) continue;
      const hash = sha256Of(root, rel);
      if (hash === null) problems.push(`${where}: ${rel} isn't there. ${fix}`);
      else if (!state.sha256?.[kind])
        problems.push(`${where}: ${rel} has no approved hash in the register.`);
      else if (state.sha256[kind] !== hash)
        problems.push(
          `${where}: ${rel} isn't the approved design: its hash differs from the one recorded. An approved design changes only with a new approval.`,
        );
    }
  }
  const wanted = screenStates(root, specs, entry.screen);
  const have = new Set(entry.states.map((s) => String(s?.name ?? '').toLowerCase()));
  for (const w of wanted ?? [])
    if (!have.has(w))
      problems.push(`${screen}'s ${w} state, which the spec lists, has no approved design. ${fix}`);
  return problems;
}

/**
 * HAND-3: the register entries a story's screens are built from: those its own id names, and those of
 * the design stories it depends on. `stories` is the plan's.
 */
export function designsFor(entries, story, stories = []) {
  const s = stories.find((x) => x.id === story);
  const from = new Set([story, ...(s?.dependsOn ?? [])]);
  return entries.filter((e) => from.has(e.story));
}
