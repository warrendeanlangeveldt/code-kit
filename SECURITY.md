# Security

code-kit runs as Claude Code hooks: it reads your repository and its git history, and runs the commands your `.claude/code-kit.json` lists as checks. It sends nothing over the network.

To report a vulnerability, use GitHub's private vulnerability reporting on this repository (Security → Report a vulnerability) rather than a public issue. You'll get a reply within a week.

The hooks are a guard rail for agents, not a sandbox. They stop the actions they recognise; they are not a boundary against a person, or a process deliberately working around them.
