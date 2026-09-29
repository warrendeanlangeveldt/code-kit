## Enforced, not advised

The code-kit plugin enforces the rules in `.claude/code-kit.json` on every tool call:

- who writes where (the lead delegates lane work to the lane agents in `.claude/agents/`);
- the layer rules ({{layer names, in order}});
- spec-check before lane code{{; designs approved before screens}};
- an audit log of every change to protected paths (`.claude/approval-log.jsonl`), which the person reviews in the pull request;
- the project's checks before any agent finishes.

If a hook blocks you, fix the cause; never work around it.

Changing the rules means editing `.claude/code-kit.json` (the lead only), then running the `code-kit:check` skill.
