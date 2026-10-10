// The reviewer agent (spec 07), the pure parts: its definition, the lead's prompts that start it and
// that hand its findings on, and reading its report. The hooks keep it read-only: any subagent that
// isn't a lane's may only read (hooks/lib/rules.mjs).

export const REVIEWER = 'reviewer';
export const SEVERITIES = ['blocker', 'concern', 'nit'];
/** The lead reviews without the reviewer once it has had this long (spec 07's quality target). */
export const REVIEW_WAIT_MS = 15 * 60000;

/** The reviewer's definition, for `$.agent.register`: read, search and run commands; never write. */
export function reviewerSpec({ cli, checklist, model }) {
  return {
    name: REVIEWER,
    description:
      "code-kit's background reviewer: reviews one finished branch, read-only, and reports findings graded blocker, concern or nit. Started by the lead when code-kit's loop asks for it.",
    tools: ['Read', 'Grep', 'Glob', 'Bash'],
    ...(model ? { model } : {}),
    prompt: [
      "You are code-kit's reviewer. You review one branch, read-only: you never edit or write files, commit, approve, merge or record a send-back (code-kit's hooks refuse those for you). The lead decides; you report.",
      '',
      'For the branch you are given:',
      `1. Run \`node "${cli}" verify --branch <branch>\` from the branch's worktree if it has one (\`git worktree list\`), otherwise in a throwaway worktree (\`git worktree add .claude/worktrees/reviewer-<n> <branch>\`, removed when you're done). A failing verify is always a blocker.`,
      `2. Read ${checklist} and apply its review checklist to the branch's changes against its base, and to the story's requirements. Skip its steps that act (recording a send-back, merging): those are the lead's.`,
      "3. Run the project's test commands that cover the changed files.",
      '',
      'Grade each finding: blocker (it must not merge as it is: a failing check, a requirement not met, a rule broken), concern (worth fixing; the lead decides), nit (small). Say where (path:line), what is wrong and what fixed looks like, and the requirement or rule it cites.',
      '',
      'End your report with one fenced json block, exactly this shape:',
      '```json',
      '{"verify": {"passed": true, "problems": []}, "findings": [{"severity": "blocker", "where": "src/a.ts:12", "text": "…", "rule": "REQ-1"}]}',
      '```',
    ].join('\n'),
  };
}

/** The lead's prompt to start the reviewer for a branch at its head (REVW-1). */
export function startReviewerPrompt({ agent, story, branch, head }) {
  const reqs = story.requirements?.length ? ` (requirements ${story.requirements.join(', ')})` : '';
  return `Start code-kit's reviewer in the background for ${branch}: use the Agent tool with subagent_type "${agent}", run_in_background true, description "Review ${branch} (${story.id})", and the prompt "Review ${branch} at ${head.slice(0, 12)} for ${story.id} ${story.title ?? ''}${reqs}." Then carry on; its findings come back to you and code-kit asks for your review then.`;
}

/**
 * The reviewer's report, read (REVW-3): { findings, verify } from its json block, every failed
 * verify problem a blocker; or { error } when the report has no block that reads.
 */
export function readReport(answer) {
  const blocks = [...String(answer ?? '').matchAll(/```json\s*\n([\s\S]*?)```/g)];
  if (!blocks.length) return { error: "the reviewer's report had no findings block" };
  let data;
  try {
    data = JSON.parse(blocks.at(-1)[1]);
  } catch {
    return { error: "the reviewer's findings block isn't valid JSON" };
  }
  const findings = (Array.isArray(data.findings) ? data.findings : [])
    .filter((f) => f && SEVERITIES.includes(f.severity) && typeof f.text === 'string')
    .map((f) => ({
      severity: f.severity,
      text: f.text,
      ...(f.where ? { where: String(f.where) } : {}),
      ...(f.rule ? { rule: String(f.rule) } : {}),
    }));
  const verify = data.verify ?? null;
  return { findings: withVerify(findings, verify), verify };
}

/** Findings with a blocker for each problem of a failed verify, unless one already names it. */
export function withVerify(findings, verify) {
  if (!verify || verify.passed !== false) return findings;
  const problems = verify.problems?.length ? verify.problems : ['code-kit verify fails'];
  const extra = problems
    .filter((p) => !findings.some((f) => f.severity === 'blocker' && f.text.includes(p)))
    .map((p) => ({ severity: 'blocker', text: `verify: ${p}`, rule: 'code-kit verify' }));
  return [...extra, ...findings];
}

/** "1 blocker, 2 nits": the findings counted by severity. */
export function findingsCount(findings) {
  const n = (s) => findings.filter((f) => f.severity === s).length;
  const parts = SEVERITIES.flatMap((s) => (n(s) ? [`${n(s)} ${s}${n(s) === 1 ? '' : 's'}`] : []));
  return parts.length ? parts.join(', ') : 'no findings';
}

/** The lead's review prompt, with the reviewer's findings (REVW-4); a blocker means send back. */
export function leadReviewPrompt(storyId, review) {
  const head = `Review ${storyId}: run /code-kit:review ${storyId}.`;
  if (!review || review.state === 'skipped')
    return `${head}${review?.why ? ` (No background review: ${review.why}.)` : ''}`;
  if (review.state === 'failed')
    return `${head} (The background reviewer didn't report: ${review.error}. Review it yourself.)`;
  const lines = review.findings.map(
    (f) =>
      `- ${f.severity}${f.where ? ` ${f.where}` : ''}: ${f.text}${f.rule ? ` (${f.rule})` : ''}`,
  );
  return [
    `${head} code-kit's reviewer found ${lines.length ? findingsCount(review.findings) : 'nothing to fix'} on ${review.branch} at ${review.head.slice(0, 12)}${lines.length ? ':' : '.'}`,
    ...lines,
    ...(review.findings.some((f) => f.severity === 'blocker')
      ? ['A blocker means you send the branch back. Concerns and nits are yours to weigh.']
      : []),
  ].join('\n');
}
