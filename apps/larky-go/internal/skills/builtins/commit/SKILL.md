---
name: commit
description: Analyze git diff and produce a conventional commit
mode: inline
allowed_tools:
  - Bash
  - ReadFile
  - Grep
---

# Task

You are creating a git commit for the user.

## Steps

1. Run `git status` to see what has changed.
2. Run `git diff` and `git diff --staged` to inspect the actual changes. Read both staged and unstaged.
3. Decide the commit type from the diff content:
   - `feat`: new user-facing capability
   - `fix`: bug fix
   - `docs`: documentation only
   - `refactor`: code restructuring without behavior change
   - `test`: tests only
   - `chore`: build / tooling / non-source changes
4. Compose a message in conventional-commit format: `type(scope): description`.
   - Description in English, no trailing period, ≤ 72 chars.
   - Scope optional; use the package or module touched (e.g. `feat(skills): ...`).
5. Stage files one by one with `git add <path>` — never `git add -A` or `git add .`.
   - Skip `.env`, credentials, secrets, large binaries, build artifacts.
   - If more than 10 files changed, ask the user whether to split into multiple commits before staging.
6. Create the commit with `git commit -m "<message>"`.
7. Report the commit hash and the message.

## Notes

- If the user provided extra context in `$ARGUMENTS`, fold it into the message body (after the title line, blank line, then prose).
- Do not push.
- If the working tree is clean, report that and stop.

$ARGUMENTS
