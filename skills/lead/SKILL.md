---
name: lead
description: Make this Claude Code session the project's lead session (or, in a project built as streams, one stream's lead), where code-kit's loop runs and the plan's stories are dispatched from, when several sessions work one project. Running it moves the lead here as the person sends it; the skill confirms it and says what it means. Use when the person says this session should lead, asks which session leads, or runs /code-kit:lead.
---

# Lead from this session

Several Claude Code sessions can work one project at once. One is the lead session: code-kit's loop runs there, and the plan's stories are dispatched from it. The others are working sessions: they stay quiet (no loop prompts, no other session's decisions), and each records its ad hoc task, with the paths it leases, before it changes code.

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/bin/code-kit.mjs"`, run from the project root.

**When the person ran `/code-kit:lead`**, typing it was their choice: code-kit recorded this session as the lead (of the stream they named) as the prompt arrived, and its note in your context says so, or why it couldn't. Don't ask them to run anything. Run `who` to confirm, and tell them in a sentence or two what it means: which stream this session leads, its lanes and plan, and which session leads the rest. When the note says another lead holds the main checkout, move this session into a worktree of its own on the branch the note names (EnterWorktree) before you change anything. If the note says it couldn't (a stream that doesn't exist, say), tell them why and what the streams are.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/code-kit.mjs" who
```

**When the person asked in words** ("lead from this session"), and didn't run the command:

1. See who leads now:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/code-kit.mjs" who
   node "${CLAUDE_PLUGIN_ROOT}/bin/code-kit.mjs" sessions
   ```

2. If this session already leads, say so and stop.
3. Otherwise, tell them what moving the lead does: this session starts running the loop and dispatching the plan's stories, and the session that led becomes a working session, which stops prompting its lead. Choosing the lead is theirs, and the hooks refuse it from an agent: they run `/code-kit:lead` (with the stream, in a project built as streams), or use **Lead from here** in the code-kit band.

**A project built as streams** (`code-kit streams` lists them; spec 31) has a lead per stream, and they lead at once: each runs its own loop, dispatches only its own stream's lanes and stories, and writes only its own stream's plan and specs. The argument names the stream (`/code-kit:lead studio`).

Moving one stream's lead leaves the other streams' leads as they are. The first lead works in the main checkout; every other stream's lead works in a worktree of its own (start the session with `claude --worktree`, or move it into one), on `lead/<stream>`, and its plan changes reach the base through the merge queue. A session that leads with no stream named leads every stream that has no lead of its own. A working session joins a stream with `sessions stream <name>`, the person's command too.

A working session doesn't need this to work: it records its task (`code-kit task "<what>" --touches "<globs>"`), works in a worktree of its own, and `code-kit task done` when it's finished.
