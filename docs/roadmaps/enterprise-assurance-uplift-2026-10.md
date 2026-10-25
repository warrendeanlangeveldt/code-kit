# CodeKit — Proactive Enterprise Engineering Assurance Uplift

**Status:** Proposed roadmap; not an implementation claim  
**Prepared:** 2026-10-25  
**Scope:** Open-source CodeKit core, Claude Code integration, portable agent adapters, durability, evidence and architecture/engineering enforcement  
**Companion:** CodeKit Hub has a separate **private** self-hosted enterprise roadmap. This public document deliberately excludes private repository URLs, customer identities, private project metrics and customer implementation details.

## 1. Position and product boundaries

**Thesis:** CodeKit makes organisational architecture and engineering obligations part of the AI development execution path. It is more than retrospective observation and more than a coding-agent orchestrator: it carries intent through requirements, design, lane ownership, implementation, review, verification and merge, and can prevent certain violations *before* they occur.

The desired organisational outcome is **governed developer autonomy**: teams may choose models, agents and implementation styles, but the same versioned project/organisation controls, accountable approvals and verifiable delivery evidence apply.

Preserve an **opinionated default engineering loop**, with explicit extension points and exemptions. Do **not** claim that every arbitrary tool can be proactively blocked: enforcement strength depends on integration and execution boundaries.

**Open-core commitments**
- CodeKit MIT core remains genuinely useful offline to solo developers and GitHub-only teams.
- Hub is optional; neither local engineering checks nor local recovery require an account, network connection or hosted service.
- Policies and adapters are portable. Customer-defined policies must not depend on the proprietary Hub.
- The paid value is organisation-wide coordination, durable cross-machine authority, central governance evidence and deployment in customer-controlled environments—not deliberately withholding basic quality checks.

## 2. Baseline: what is implemented now

Verified from current repository code and documentation (not a live runtime certification):

| Implemented mechanism | Evidence / entry point | Limit |
|---|---|---|
| Configured lanes, ownership and protected paths | `hooks/lib/rules.mjs`, `.claude/code-kit.json` | Hook-visible writes and Git-based verification; hooks are not a sandbox |
| Pre-use controls on Edit/Write/Bash/Agent and post-use audit | `hooks/hooks.json`, `hooks/guard-*.mjs`, `hooks/lane-audit.mjs` | Some shell effects detected after execution; other MCP tool effects not covered pre-use |
| Architectural layer and package rules | `hooks/lib/layers.mjs`, `hooks/lib/verify.mjs` | **Only JS/TS imports are analysed**, via patterns; configured Python layer policies are currently **not enforced by this engine**. This is a material coverage gap for polyglot projects. |
| Specs, stories, design gate and requirements trace | `hooks/lib/plan.mjs`, `hooks/lib/storymap.mjs`, `skills/next`, `skills/spec-check` | A named test does not by itself prove real acceptance criteria |
| Approval evidence in Git | `.claude/approval-log.jsonl`, `hooks/lib/verify.mjs` | Must distinguish human attestations from agent assertions |
| Stop checks, branch verify, regression protections | `hooks/stop-check.mjs`, `hooks/lib/verify.mjs`, `hooks/lib/regression.mjs` | A non-run check must never be represented as a pass |
| Merge queue verifies reviewed SHA | `hooks/lib/queue.mjs`, `skills/review` | Interrupted side effects require deterministic reconciliation |
| Dispatch records and send-back records | `hooks/lib/dispatches.mjs`, `hooks/lib/reviews.mjs` | Partial lifecycle log, not a complete execution event stream |
| Story journal and timeline | `hooks/lib/journal.mjs`, `hooks/lib/timeline.mjs` | Reconstructed from Git and scattered state; not source of truth for in-flight operations |
| Session state, lead leases and lane claims | `hooks/lib/sessions.mjs`, `hooks/lib/loop-state.mjs`, `hooks/lib/laneclaims.mjs` | Shutdown can leave apparent live sessions or claims |
| Project metadata snapshots for providers | `hooks/lib/snapshot.mjs`, `docs/specs/21-hub-adapter-and-reports.md` | Reporting snapshots are not execution checkpoints |
| Context Graph adapter | `hooks/lib/adapters/` | Complementary context evidence; not a substitute for execution truth |

**Critical finding:** `next` derives states from plans and Git; an unfinished story may return `wait`. The skill *instructs* the model to redispatch when an agent has stopped. Crash recovery is therefore not yet an explicit, deterministic pre-dispatch reconciliation transaction.

## 3. Target architecture

```text
Requirements / ADRs / policy version / design decisions
                    |
             CodeKit policy core
      (pure rules, enforcement contracts)
                    |
     +--------------+----------------+
     |              |                |
 Claude adapter   Codex adapter   Other adapters
 (hooks/mod)      (supported      (capability-
                  surfaces)        qualified)
     +--------------+----------------+
                    |
           Durable execution runtime
   action boundary -> event append -> effect -> reconcile
                    |
         Local SQLite + append-only outbox
         snapshots / materialized projections
                    |
   existing Git / CI evidence / approval log / review
                    |
          Optional team provider adapter
            (GitHub or CodeKit Hub)
```

**Authority hierarchy:**
1. Git objects, signed/reviewed commits and repository checks prove source changes.
2. Project/organisation policies and approved decisions define what was authorised.
3. An append-only execution ledger records observable operations, attempts, outcomes and references to evidence.
4. Projections and human-readable journals are *derived views*, never stronger proof than underlying evidence.
5. Remote Hub adds shared coordination and replicated execution metadata; it must not silently supersede local Git reality.

### Architecture and engineering contract

Represent each control in a canonical policy model with:
- unique `policy_id`, version/hash, source and owner;
- scope (organisation/repository/layer/path/story) and precedence;
- enforceable condition, enforcement phase (`pre_action`, `post_action`, `pre_commit`, `pre_merge`, `ci`);
- severity (`deny`, `approval_required`, `warn`, `inform`);
- evidence needed to prove satisfaction, waiver rules and expiry;
- supported adapter capabilities and *explicit visibility gaps*.

Start with existing lane, protected-path, layer, dependency, standards, design, spec and regression rules; do not replace their mature implementations in one rewrite. Add contract tests for consistent policy decisions across adapters.

## 4. Durable execution: event protocol and recovery

### 4.1 Event schema v1

All runtime records have a common envelope:

```json
{
  "schema_version": 1,
  "event_id": "01J...unique...",
  "project_id": "stable-project-id",
  "stream_id": "story/ST-42",
  "sequence": 87,
  "type": "ActionStarted",
  "observed_at": "2026-10-25T11:30:00Z",
  "producer": "code-kit",
  "session_id": "session-...",
  "agent_id": "agent-...",
  "lane": "backend",
  "attempt_id": "attempt-3",
  "action_id": "action-19",
  "causation_id": "event-...",
  "correlation_id": "workflow-...",
  "policy_hash": "sha256:...",
  "fencing_epoch": 9,
  "data": {
    "operation": "test.run",
    "target": "tests/booking.spec.ts",
    "git_head_before": "abc123",
    "evidence_ref": null
  }
}
```

Define schemas and migration compatibility, ordering per stream, event de-duplication, allowable producers, payload size, redactable fields and invariant validation. Never copy raw prompts, secrets, file contents, tool output or environment variables into events by default.

**Minimum event families**
- **Workflow:** `StoryPlanned`, `StoryClaimed`, `StoryDispatched`, `PhaseStarted`, `PhaseCompleted`, `ReviewRequested`, `ReviewCompleted`, `StoryMerged`.
- **Worker:** `ExecutionAttemptStarted`, `HeartbeatObserved`, `ExecutionInterrupted`, `LeaseAcquired`, `LeaseExpired`, `WorkerFenced`, `ExecutionResumed`.
- **Action:** `ActionPlanned`, `ActionStarted`, `ActionObserved`, `ActionVerified`, `ActionFailed`, `ActionOutcomeUnknown`.
- **Control:** `PolicyEvaluated`, `ActionDenied`, `ApprovalRequested`, `ApprovalGranted`, `ApprovalRevoked`, `ExceptionApplied`.
- **Recovery:** `RecoveryStarted`, `ArtifactReconciled`, `RecoveryBlocked`, `RecoveryCompleted`.

One action is identified by a stable idempotency key; retries produce new *attempts*, not uncorrelated duplicate operations. Event replay **reconstructs state**—it never re-executes arbitrary operations.

### 4.2 Local SQLite store

Use `node:sqlite` when supported; review Node 22 experimental/stability implications and test against supported later Node LTS versions. Define an explicit minimum runtime (at least Node 22.13 for flagless use) or ship a tested fallback.

- Database in main checkout's ignored `.claude/state/` (or stable external data location), not under the updatable plugin root and not separately per ephemeral worktree.
- WAL, busy timeout, transactional append with unique `event_id`, per-stream version compare-and-swap, schema migrations, integrity checks and durable outbox.
- Local files never go into Git accidentally. Secure permissions and retention; `code-kit doctor` reports missing/corrupt stores.
- Snapshot/materialize projections periodically, with validation of snapshot version and hash; retain enough prior events to verify recovery.
- Use durable transaction boundaries; document fsync/performance trade-offs and benchmark hook latency.
- Keep existing JSONL logs/approval Git records during migration; ingest or reference historical evidence as **imported**, not as fabricated observed runtime events.

### 4.3 Explicit recovery state machine

`next` must run `reconcile` before planning new dispatches:

```text
ACTIVE -> SUSPECTED_LOST -> CONFIRMED_INTERRUPTED
                           -> RECONCILING
                           -> { SAFE_TO_RESUME | REVIEW_REQUIRED | HUMAN_REQUIRED }
                           -> NEW_ATTEMPT -> ACTIVE
```

On recovery:
1. Validate session liveness and owned lease epoch; do not infer death from an expired timestamp alone.
2. Read last durable event/snapshot for each unfinished stream.
3. Compare action boundaries with Git HEAD, worktrees, dirty/untracked files, test-result evidence, approval state and merge queue.
4. Classify effects as **verified complete**, **verified absent**, or **outcome unknown**.
5. Preserve all dirty changes and evidence; do not silently stash, reset, delete or claim someone else's work.
6. Produce a compact recovery brief: story requirement references, current branch/commit, accepted artifacts, unresolved effects, rules, approvals, and next safe action.
7. Dispatch a **new worker** with a new fenced attempt; rerun only checks whose evidence is stale relative to relevant hashes.
8. If a non-idempotent effect cannot be reconciled, stop and require an authorised decision.

Protected operations (merge, deploy, schema migration, remote write, dependency install) need per-operation reconciliation policies and idempotency keys. Stale workers must be prevented from acting after a replacement lease is granted; local hook fencing is useful but **not** a security boundary for unrelated or hostile tools.

### 4.4 Replay and durability invariants

- No verified committed work is lost through a routine session restart.
- No potentially irreversible action is blindly replayed.
- At most one accepted worker holds a fenced lane/story lease at a time.
- A policy exception requires authenticated, attributable authorisation and an immutable decision reference.
- A missing/failed/not-run test is never reported as passed.
- Local recovery remains usable when Hub is offline, with **explicitly lowered cross-machine guarantees**.
- Journal/timeline/trace projections distinguish observed, reconstructed and agent-declared evidence.

## 5. Proactive controls and audit evidence

### Before, during and after execution

| Boundary | Target |
|---|---|
| Requirement intake | Validate scope, decision authority, specification consistency and unresolved decisions before dispatch |
| Pre-tool | Enforce tool-specific paths, commands, permissions, high-risk categories and versioned architectural rules where adapter supports a true veto |
| Post-tool | Detect filesystem/tool side effects, correlate to action id, and flag policy drift immediately |
| Before commit | Check ownership, generated code/contracts, regression weakening, secrets, dependency changes and provenance |
| Before merge | Verify *reviewed SHA*; require all mandatory quality gates and authorisations; abort if policy/evidence changed |
| CI/remote | Independent evaluation of branch, repo protection and artefacts even for contributors without local CodeKit |
| After release | Correlate release commit and checks to change request and approvals; monitor deviations |

Establish an **enforcement capability matrix** by tool **and language**. In particular, build AST-based (or language-appropriate tool-backed) dependency checking for Python before claiming enforcement of configured Python layer restrictions; report configured-but-unsupported language rules as **not enforced**, preferably fail setup/verification for mandatory policies. Add polyglot fixtures and drift tests.

Establish an **enforcement capability matrix** by tool; `prevented`, `observed after`, `detectable in CI`, `not observable`. In policy-critical contexts, no adapter can advertise assurance above its actual enforcement surface. Make all important missing dependencies explicit in `verify`.

### Evidence record for a governed change

`request -> requirement -> architectural policy/ADR -> story -> worker attempts -> action evidence -> Git commit -> tests -> review -> approval/waiver -> verified merge -> release`.

- Each edge includes an identifier and timestamp; source Git SHA and policy hash anchor evidence.
- Attach test attestation to the relevant commit, environment and test plan.
- Separate **machine-observed evidence**, **Git/CI attestations**, **human approvals** and **agent narratives**.
- Preserve append-only exceptions and policy-decision lineage; prefer independent CI and signed attestations for regulated cases.
- Integrate Context Graph decisions as references to graph version/constraint, not duplicate sensitive context into telemetry.

**Non-goals:** claiming sandbox security from hooks; claiming automated proof of semantic correctness from a successful test suite; making Claude's freeform judgment a trusted authority; mandating one vendor or removing developer choice.

## 6. Adapter architecture (beyond Claude Code)

Extract the portable rules/runtime contract from Claude-specific hook surfaces.

```ts
interface AgentRuntimeAdapter {
  id: string;
  capabilities(): EnforcementCapabilities;
  observe(input: NormalizedAction): Promise<Observation>;
  enforce?(decision: PolicyDecision): Promise<EnforcementResult>;
  identifySession(): Promise<SessionIdentity>;
  identifyWorker(): Promise<WorkerIdentity>;
  reportEffects?(actionId: string): Promise<EffectEvidence[]>;
}
```

- **Claude Code** first: move existing hooks into the adapter without behaviour regression.
- **Codex** next: investigate plugin, hook and CLI execution surfaces and deliver only supportable claims; `cannot-prevent` must be visible for unsupported APIs.
- **Other agents** (Cursor, Copilot, etc.) follow demand, runtime access and enterprise buyer validation.
- Build a provider-neutral **CI verifier** and repository policy pack as the minimum universal control plane.
- Test each adapter against the same fixture and policy conformance corpus, including bypass attempts.
- Document whether a given integration is monitor-only, partial preventative or fully enforced under a controlled runner.

## 7. Uplift workstreams and order

| ID | Stage | Deliverable | Acceptance / exit gate | Priority |
|---|---|---|---|---|
| CK-00 | Evidence baseline | Baseline corpus, failure taxonomy, measurement harness, privacy review and current-control inventory | Reproducible representative tasks + metrics; no claims beyond measurement | P0 |
| CK-01 | Canonical policy | Versioned engineering policy schema, precedence, capabilities, exceptions and conformance tests | Existing configs migrate without weakened checks; decision trace shows rule and version | P0 |
| CK-02 | Event contract | Versioned event envelope, producers, data classifications and projection contract | Schema fixtures and invalid-event rejection; correlation across lead and lanes | P0 |
| CK-03 | SQLite ledger | Transactional local event streams, outbox, snapshots, integrity check and migrations | Process termination/restart preserves committed events; concurrent writes dedupe | P0 |
| CK-04 | Recovery | Deterministic `reconcile`, lease/fence state and replacement-agent handoff | Crash matrix passes; dirty work never discarded; unknown effects require reconciliation | P0 |
| CK-05 | Audit unification | Journal/timeline/trail render from correlated evidence; verify provenance map | One change traversable from requirement to verified SHA without fabricated history | P1 |
| CK-06 | Enforcement hardening | Pre/post action policy, independent CI attestation, explicit coverage/missed-check reporting | Adversarial fixtures; no skipped mandatory gate counted as success | P1 |
| CK-07 | Provider interface v2 | `appendEvents`, `getEvents`, `getCheckpoint`, `claimExecution`, `renewExecution`, `reconcileExecution` | Local/GitHub/Hub provider conformance; offline replay/outbox tested | P1 |
| CK-08 | Portable runtime | Pure core + Claude adapter, then supported Codex adapter | Existing Claude fixtures pass; adapters publish accurate capability matrix | P2 |
| CK-09 | Architecture governance packs | Reference policy libraries for contracts, architecture, security, change and quality | Independent owner approval, versioning and documented exceptions | P2 |
| CK-10 | Production hardening | Metrics, migrations, operational recovery guide and release/version compatibility | RC, security review, performance budget, upgrade/downgrade tests | P2 |

**Avoid a platform rewrite.** Add adapters at proven seams, wrap existing audit formats, and migrate incrementally behind feature flags.

### Initial measurable hypothesis

For representative greenfield and brownfield tasks, compare:
1. same model without CodeKit;
2. with CodeKit;
3. with Context Graph;
4. with both;
5. forced interruption and recovery in each configuration.

Track end-to-end acceptance success, regressions, architectural violations, security-rule breaches, approvals required, developer interventions, tokens, wall time, CI failures, false blocks, time to resume, and **percentage of verified work retained after interruption**. Run repeated trials with identical budgets and a blinded/independent evaluator. Publish both improvements and trade-offs.

## 8. Reference crash and adversarial test suite

- Terminate session before first edit; midway through edit; after write before event outcome; after tests pass before report; before and after commit; after review before queue; during merge.
- Crash concurrent lead and lane sessions; restart within 1 minute and after lease expiry; old worker wakes after replacement.
- Simulate SQLite busy/partial write, disk full, corrupted projection, plugin upgrade, event duplication, out-of-order remote delivery.
- Attempt unapproved protected file, architectural violation, test weakening, dependency install, cross-lane write and fake approval.
- Attempt non-hook MCP file writes and shell obfuscation; explicitly document that independent CI/sandbox layers are needed.
- Simulate offline Hub, conflicting remote ownership, two machines replaying same outbox and branch movement after review.
- Verify no secret/raw source is emitted in default event export or provider snapshots.

**Release gate:** a fresh session must classify every unfinished story without an LLM inventing its state; safe work continues; unknown effects do not auto-repeat; all current baseline governance checks still pass.

## 9. Compatibility, operation and rollout

- Feature flags: `execution.ledger`, `execution.reconcile`, `execution.remoteSync`; rollout initially observe-only, then opt-in enforcement, then default.
- Store migrations and schema/version negotiation: older clients read what they understand and fail safely on unknown mandatory controls.
- Do not change existing approval scope without a recorded human policy decision.
- Migration imports existing approval logs, reviews and dispatches as historical references with an `origin: imported` marker.
- Support export/restore, `code-kit doctor`, backup guidance and anonymised diagnostic bundles.
- Define clear ownership for policy bypass findings and a security contact path.

## 10. Definition of enterprise-assurance readiness

**CodeKit alone** can claim a portable, preventive engineering governance *framework* only when its supported enforcement surfaces, policy versions, CI proofs, recovery behaviour and limitations are accurately documented and independently demonstrated.

**CodeKit + Hub** may claim enterprise coordination or cross-machine durability only when the companion Hub's lease, security, disaster-recovery, identity, tenant-isolation and customer-managed deployment gates pass.

Do not claim compliance certification, tamper-proof observation of arbitrary processes, model independence or recovery of unpublished source until independently verified.

## 11. Explicitly deferred

Full autonomous production deployment, blanket support for every AI coding tool, capture of full prompts or file contents, mandatory customer source storage, an arbitrary model gateway, and a public harness marketplace. These are not prerequisites to proving this product's engineering assurance value.

---

**Decision to validate with pilots:** Customers should be able to keep their existing AI tools and engineering methods while knowing, at each consequential stage, *which policy applied, what was prevented, what was reviewed, what evidence was produced, and what remains uncertain*.
