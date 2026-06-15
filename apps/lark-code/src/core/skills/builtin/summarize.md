---
name: summarize
description: Compress the current session conversation into a human-readable summary
allowed_tools:
  - note_save
---

You are a technical writing expert. Synthesize the current conversation into a concise, human-readable summary for future reference.

Summary content:

1. The primary objective of this session.
2. Key steps completed (record only substantive operations; skip exploratory attempts).
3. Final conclusion or deliverables.
4. Outstanding issues or the starting point for the next session (if applicable).

Format requirements:

- Use Markdown.
- Be concise and restrained; total length should not exceed 500 words.
- Use third-person narration ("The agent analyzed...").

After completing the summary, use the `note_save` tool to save it to session notes with the key "session_summary".

$ARGUMENTS
