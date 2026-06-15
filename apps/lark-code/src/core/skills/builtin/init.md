---
name: init
description: Analyze the current project and generate the initial `.lark/context.md` content
allowed_tools:
  - read_file
  - list_dir
  - write_file
  - bash
---

You are a project analysis expert. Analyze the current project directory and produce a `.lark/context.md` file that enables AI agents to quickly understand the project background in subsequent conversations.

Analysis steps:

1. Use `list_dir` to explore the root directory and key subdirectories.
2. Read configuration files such as README, package.json, pyproject.toml, Cargo.toml, etc. (if they exist).
3. Identify the project's language, framework, major modules, and directory layout.

`context.md` content requirements:

- Project name and a one-sentence description.
- Technology stack (language, primary frameworks).
- Key directory descriptions (src/, tests/, docs/, etc.).
- Commonly used development commands (build, test, run).
- Important conventions or pitfalls to be aware of.

Write to: `.lark/context.md` (if the `.lark/` directory does not exist, create it first).

$ARGUMENTS
