// Hold and ask (spec 06), the pure parts. The hooks stay the only judge: the mod lets a call run,
// and when the result is a refusal a person's approval would allow, it holds the call, asks, writes the
// approval and retries the same call (docs/spikes/harness.md, spike B). This reads such a refusal.
import { refusalCard } from './view.mjs';

/** The kinds of refusal a person's approval would allow (HOLD-1): a new package, a protected file, the kit. */
const HOLDABLE = new Set(['dependency', 'approval', 'kit']);

/**
 * From a refused call's result text, what would let it through: { kind, names, lane, what, title }, or
 * null when no approval a person can give would allow it (another lane's files, force-push, the log…).
 */
export function holdable(resultText) {
  const card = refusalCard(resultText);
  if (!card || !HOLDABLE.has(card.kind) || !card.request?.names.length) return null;
  return { kind: card.kind, title: card.title, ...card.request };
}

/** A tool call's result as text, whichever shape the engine gave it. */
export function resultText(result) {
  if (!result) return '';
  if (typeof result.deny === 'string') return result.deny;
  if (typeof result.text === 'string') return result.text;
  return typeof result.result === 'string' ? result.result : '';
}
