package teams

import (
	"os"
	"os/exec"
)

func detectBackend() TeamMode {
	// Default to in-process mode — it enables real-time progress tracking
	// in the TUI without requiring an external multiplexer.
	return ModeInProcess
}

// detectPaneBackend applies the old heuristic for users who explicitly
// want a tmux/iTerm pane-based backend.
// Priority: tmux (if we're already in one) > iTerm2 (if we're in one) >
// tmux (if installed) > in-process fallback.
func detectPaneBackend() TeamMode {
	if os.Getenv("TMUX") != "" {
		return ModeTmux
	}
	if os.Getenv("ITERM_SESSION_ID") != "" {
		return ModeITerm
	}
	if _, err := exec.LookPath("tmux"); err == nil {
		return ModeTmux
	}
	return ModeInProcess
}
