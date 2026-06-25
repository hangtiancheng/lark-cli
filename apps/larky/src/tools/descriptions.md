Execute a shell command and return stdout and stderr.

IMPORTANT: Avoid using this tool to run cat, head, tail, sed, awk or echo commands. Instead use the dedicated ReadFile, EditFile, or WriteFile tools which provide a better experience.

Usage Notes

- The working directory persists between commands, but shell state does not.
- Always quote file paths containing spaces with double quotes.
- Try to maintain your current working directory using absolute paths, avoid cd unless the user explicitly requests it.
- Optional timeout in seconds (max 600s). Default 120s.
- When issuing multiple independent commands, make separate tool calls instead of chaining with &&.
- Use && to chain sequential dependent commands. Use ; only when you don't care if earlier commands failed.

Git Safety Protocol

- NEVER run destructive git commands (push --force, reset --hard, checkout ., clean -f, branch -D) unless the user explicitly requests it.
- NEVER skip hooks (--no-verify) unless the user explicitly requests it.
- Prefer creating a new commit rather than amending an existing one.

Avoiding unnecessary sleep commands. Do NOT retry failing commands in a sleep loop -- diagnose the root cause instead.
When using find, search from "." or a specific path, not "/" -- scanning the full filesystem is too expensive.

---

Read a file and return its contents with line numbers.

Usage Notes

- The file_path should be an absolute path when possible.
- By default reads up to 2000 lines from the beginning of the file.
- Use offset and limit to read specific parts of large files. Only read what you need.
- Results are returned with line numbers (1-based) for easy reference.
- This tool can only read files, not directories. Use glob to list directory contents.
- Do NOT re-read a file you just edited to verify -- EditFile would have errored if the change failed.

---

Replace an extract string in a file, The old_string MUST appear exactly once in the file.

Usage Notes

- You MUST read the file with ReadFile before editing, this tool will fail otherwise.
- When editing text from ReadFile output, preserve the exact indentation (tabs/spaces) as shown.
- Always prefer editing existing files over creating new ones.
- The edit will FAIL if old_string is not unique in the file, provide more surrounding context to make it unique.
- Use the smallest old_string that is clearly unique -- 2-4 adjacent lines is usually sufficient.
- The new_string MUST be different from old_string.

---

Write content to a file, creating parent directories if needed. Overwrites existing files.

Usage Notes

- If modifying an existing file, prefer EditFile over WriteFile -- it only sends the diff.
- Use this tool only to create new files or for complete rewrites.
- You MUST read existing files with ReadFile before overwriting them.
- NEVER create documentation files (\*.md) or README files unless explicitly requested.

---

File files matching a glob pattern, returning relative paths sorted alphabetically.

Usage Notes

- Supports patterns like `"**/*.ts", "**/*.go"`.
- Search from "." or a specific path, never from "/".
- Automatically skips .git, node_modules, `__pycache__`, and similar directories.
- Use this instead of find or ls command via Bash.

---

Search file content using a regex pattern, returning file:line:content matches.

Usage Notes

- Supports full regex syntax (e.g., `"log.*Error", "func\\s+\\w+"`).
- Filter files with the include parameter (e.g., `"*.ts", "*.go"`).
- Search from ". or a specific path, never from "/".
- Automatically skips .git, node_modules, `__pycache__`, and similar directories.
- Use this instead of grep or rg commands via Bash.
