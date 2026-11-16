---
name: promote
description: Decide the candidates for core in a project built as streams (spec 31): code in one stream's module that another stream repeats, wants to import or copied, or that repeats core. Reads each candidate's evidence, promotes it with a platform story that moves it into core and switches every stream to it, or keeps it in its module with why. Use when code-kit's loop or `code-kit next` says candidates are proposed for core, or the person runs /code-kit:promote [candidate ids].
---

# Decide what goes into core

In a project built as streams, each stream's lanes own its modules, and core is the code every stream builds on. When the same capability shows up in two streams, it belongs in core: built once, with one owner. code-kit raises a candidate when it sees code alike in two streams' modules (names aside), a lane refused an import of another stream's module, a lane copying files into a module, module code that repeats core, or a story's requirement that another stream's spec already has. Nothing moves by itself: you decide each one. It's yours when your stream is the platform (it owns core), or, without a platform stream, when the candidate touches your stream.

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/bin/code-kit.mjs"`.

## 1. Read the candidates

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/code-kit.mjs" promote --json
```

Each open candidate has its `id`, `kind` (`clone`, `core-clone`, `import`, `copy`, `requirement`), `what`, the files (`where`), the streams it touches and its evidence. The argument, if given, names the ids to take. For each, read the code on both sides: the lines `what` names, and enough around them to see what the code does and what it depends on.

## 2. Judge it

Promote only when all of these hold:

- **A second real use.** Two streams use it, or one stream uses it and another needs it now (a refused import, a story whose requirement repeats one). One stream's code stays in its module however general it looks.
- **The same thing.** The two copies do the same job for the same reason. Code alike by accident (two loops over different things) isn't a capability: reject it with that reason.
- **Core can own it without knowing the streams.** Once moved, it must not import a module or name a stream's types, data or rules. Where it does, either the stream-specific part stays behind (core takes a parameter, an interface or a callback), or it isn't core's.
- **It fits core's layer.** It moves into the core layer of the same technical layer (an API module's code into API core), never across layers.

A `core-clone` is a stream rebuilding what core already has: there's nothing to promote. Reject it with "use core's <name>", and tell that stream's lead, who sends the lane back to use core's.

## 3. Act on it

- **Promote.** Write a story in the platform's plan (yours, as the platform's lead; without one, in your stream's plan on a core lane), with `**Promotes:** <id>`, that moves the code into core, switches every stream's module that had it to core's, and proves it with tests every stream that uses it runs. Large code moves in steps, lower layers first, a few files a story. Then record it:

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/bin/code-kit.mjs" promote accept <id> --story ST-n
  ```

  The candidate closes when that story merges.

- **Keep it in its module.** Say why, so it isn't proposed again until its evidence changes (a third stream, a new copy):

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/bin/code-kit.mjs" promote reject <id> --reason "<why it stays>"
  ```

## 4. Report

One line per candidate: what it was, what you decided and why. "P-3: the price rounding in both streams' checkout promoted as ST-210 (same rule, no stream types)."
