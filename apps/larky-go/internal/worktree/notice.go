package worktree

import "fmt"

// BuildWorktreeNotice returns the notice text injected into sub-agent prompts when they run in an
// isolated worktree. Tells the child to translate paths from the inherited context and re-read
// files.
func BuildWorktreeNotice(parentCwd, worktreeCwd string) string {
	return fmt.Sprintf(
		"You've inherited the conversation context above from a parent agent working in %s. "+
			"You are operating in an isolated git worktree at %s — same repository, same relative "+

			"file structure, separate working copy. Paths in the inherited context refer to the "+
			"parent's working directory; translate them to your worktree root. Re-read files before "+
			"editing if the parent may have modified them since they appear in the context. Your "+
			"changes stay in this worktree and will not affect the parent's files.",

		parentCwd, worktreeCwd,
	)
}
