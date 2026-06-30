---
name: test
description: Detect project type, run tests, distinguish code bugs from test bugs
mode: inline
allowed_tools:
  - Bash
  - ReadFile
  - Grep
  - Glob
---

# Task

You are running the project's test suite and analyzing the results.

## Steps

1. Detect project type by checking for known config files:
   - `go.mod` → Go project → `go test ./...`
   - `package.json` → Node project → check `scripts.test`, run `npm test` (or `pnpm test` / `yarn test` based on lockfile)
   - `pyproject.toml` / `setup.py` / `requirements.txt` → Python → `pytest` (fall back to `python -m unittest`)
   - `Cargo.toml` → Rust → `cargo test`
   - `pom.xml` / `build.gradle` → Java → `mvn test` / `gradle test`
   - None matched: report and stop.
2. Run the test command, capture stdout + stderr.
3. If all tests pass:
   - Report pass count and total runtime.
   - If a coverage tool is available, run it once and call out files with < 50% coverage as candidates for new tests.
   - Suggest 1-3 edge-case scenarios likely not exercised (boundary inputs, error paths, concurrent access).
4. If tests fail, classify each failure:
   - **Code bug**: the assertion expects behavior X, the code does Y, and Y is wrong → the source code needs the fix.
   - **Test bug**: the assertion expects behavior X, the code correctly does Y, but the test was written assuming X by mistake → the test needs the fix.
   - **Environment**: missing dependency, port conflict, fixture path wrong → not strictly code or test, call it out separately.
5. For each failure, produce a one-paragraph summary: `[category] file:line — assertion / observation / recommendation`.

## Notes

- Do not modify any files in this skill — only run tests and report.
- Run the full suite once. Do not re-run individual tests after triage.
- $ARGUMENTS, when present, may target a specific package / test name; thread that into the test command.

$ARGUMENTS
