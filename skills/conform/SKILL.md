---
name: conform
description: Bring an existing codebase to the project's standards and engineering principles. Suggests the standards (those the code already follows, and those it should move to), audits the code against each one the person adopts, records every breach in the baseline as evidence, and drafts a refactor pathway (a conformance milestone per standard, layer by layer) for the plan. Use for a brownfield project, when the person wants the code refactored to the standards, when code-kit next says the project has no standards or a standard has breaches no story covers, or runs /code-kit:conform [standard ids].
---

# Conform existing code to the standards

Only the lead runs this. The CLI is `node "${CLAUDE_PLUGIN_ROOT}/bin/code-kit.mjs"`, from the project root; below it's `code-kit`.

New code is held to a standard as soon as it's adopted. Existing code that breaks it is recorded, file by file, in the baseline (`.claude/code-kit.baseline.json`), and brought to it two ways: by the refactor stories of its conformance milestone, and by every story that changes one of those files, which must fix its recorded breaches before it merges (verify refuses it otherwise). The breaches only ever shrink, except on the branch that adopts the standard.

The argument names standards to audit or plan (`PAT-1 ARC-2`). With none, start from step 1.

## 1. The standards

Run `code-kit standards`.

- **None yet:** suggest them as `/code-kit:init`'s Standards section describes (`${CLAUDE_PLUGIN_ROOT}/skills/init/SKILL.md`), in two groups:
  - **What the code already follows**, inferred from it with the evidence ("41 of 43 modules reach the database through repositories"), as init does.
  - **What it should move to:** the engineering principles and patterns the project's docs ask for (architecture, decisions, ADRs, principles) and the code doesn't follow yet, and the ones its stack and size call for that nothing covers (data access behind one boundary, no business rules in handlers or screens, secrets from the environment, one way to call each external service). For each, say what it is, why, how much of the code breaks it today (a rough count from a first look), and whether it's `required` or `recommended`. A pattern the code follows both ways is put to the person as a choice, with both counts.
- **Some already:** offer the ones the code should move to that the file doesn't have, the same way.

Standards are guardrails, and guardrails are the person's: write nothing until they approve, edit or drop each one. Then write them to `docs/standards.md` (or `docs.standards`) on a branch, `lead/conform-<ids>`, with the person's `standards` approval.

## 2. The audit

For each standard being adopted (new on this branch, or tightened), find where the code breaks it. A breach is evidence: the file, where in it, and what breaks the standard, in one line ("line 42: the handler queries the database itself"). Never a guess.

- **Enforced by a layer rule:** `code-kit baseline` already finds these; `code-kit baseline --write` records them. Don't record them again.
- **Checked or advice:** audit the code layer by layer with read-only agents, one per layer or per few hundred files, in parallel. Start each with the Agent tool (any type outside the lanes; code-kit's hooks hold such agents read-only), giving it the standards to look for with their why, the files to read (`git ls-files` under the layer's paths, without tests and generated files), and this answer shape:

  ```json
  {
    "breaches": [
      {
        "standard": "PAT-1",
        "file": "src/api/orders.ts",
        "breach": "line 42: the handler queries the database itself"
      }
    ]
  }
  ```

  Tell it to read every file it's given, to report only what it saw, with the line, and to report nothing for a file that meets the standard.

Check a sample of each agent's breaches yourself, then record each:

```bash
code-kit conform record PAT-1 src/api/orders.ts --breach "line 42: the handler queries the database itself"
```

`code-kit conform` then shows each standard's breaches by file. Commit the standards file and the baseline together on the branch. verify accepts breaches only for the standards this branch adopts, and the commit needs the person's `standards` approval.

## 3. The refactor pathway

```bash
code-kit conform plan            # every standard with breaches no open story covers
code-kit conform plan PAT-1      # one
```

It drafts the pathway: a conformance milestone per standard, required ones first and structure before detail (architecture, patterns, policies, conventions, then principles). Each milestone's stories go through the layers in dependency order, so what other layers import is refactored first. A story takes at most five files of one lane's folder, and depends on the same standard's stories in the layers it imports. The first story of each milestone waits on the last of the one before. Each story carries `**Requirements:** none`, `**Conforms:**` (its standard), `**Files:**`, `**Depends on:**` and `**Size:**`, lists its breaches, and asks for tests that pin down what the files do first, where they have none.

Show the person the pathway: how many milestones and stories, and the order. They decide where the milestones go among the feature milestones (each is its own milestone, never mixed into a feature one). Then add the milestones to the plan as they approve them, and commit the plan with the standards and the baseline, or on its own if those are merged already.

## 4. After

- Refactor stories are dispatched like any other. Their lane runs `code-kit conform --story <id>` for what to fix, fixes each breach without changing what the code does, and runs `code-kit conform fixed <standard> <file>` for it; verify refuses the branch while a breach in its files is still recorded.
- Any other story that changes a file with recorded breaches fixes them too (`code-kit conform --for <files>` lists them); verify refuses it otherwise. A breach too large to fix in that story is a reason to schedule its refactor story first, not to merge around it.
- In review, check each breach taken out is really fixed, and that behaviour didn't change: the same tests pass, none weakened. A breach removed from the baseline but still in the code is sent back.
- `code-kit conform` shows the progress: each standard's breaches, its stories and what's not planned yet. `code-kit next` says when a standard has breaches no story covers.
