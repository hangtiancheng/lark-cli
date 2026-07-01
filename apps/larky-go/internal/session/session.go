package session

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// TypeCompactBoundary marks a session record as a compaction boundary rather
// than a plain conversation message. A boundary record's Content holds a JSON
// blob (see CompactBoundary) carrying the summary text plus the recent tail
// (keep) that was preserved verbatim at compaction time. Plain messages leave
// Type empty (omitempty), so old sessions and normal turns are unaffected.
const TypeCompactBoundary = "compact_boundary"

type Message struct {
	Role string `json:"role"`
	// Type distinguishes record kinds. Empty (the default, omitted from JSON)
	// means a plain conversation message; TypeCompactBoundary means Content is a
	// CompactBoundary JSON blob written by SaveCompactBoundary.
	Type string `json:"type,omitempty"`
	// ToolUseID records the tool call ID, used during resume to verify tool_use/tool_result pairing.
	// This field may be present in both assistant tool_use records and user tool_result records.
	ToolUseID string `json:"tool_use_id,omitempty"`
	Content   string `json:"content"`
	Ts        int64  `json:"ts"`
}

// KeepMessage is one verbatim message preserved in the recent tail at the moment
// of compaction. Only role + content text is stored (matching how the session
// log already persists messages — text only, no tool blocks).
type KeepMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// CompactBoundary is the structured payload stored (as JSON) in the Content of a
// TypeCompactBoundary record. Summary is the LLM-produced summary of the
// older prefix; Keep is the recent tail that was kept verbatim. On resume the
// compacted state is rebuilt as: [user message = Summary] + Keep + any plain
// messages appended after the boundary.
type CompactBoundary struct {
	Summary string        `json:"summary"`
	Keep    []KeepMessage `json:"keep"`
}

// SaveCompactBoundary appends a compaction boundary record to the session log.
// The boundary is append-only: the original prefix messages stay in the file but
// are not replayed on resume (see FindLastCompactBoundary). The summary + keep
// are inlined into the record's Content as a CompactBoundary JSON blob.
func SaveCompactBoundary(workDir, sessionID, summary string, keep []KeepMessage) {
	blob, err := json.Marshal(CompactBoundary{Summary: summary, Keep: keep})
	if err != nil {
		return
	}
	SaveMessage(workDir, sessionID, Message{
		Role:    "system",
		Type:    TypeCompactBoundary,
		Content: string(blob),
		Ts:      time.Now().Unix(),
	})
}

// FindLastCompactBoundary scans the loaded records for the last compaction
// boundary. It returns the parsed boundary, the slice of plain messages appended
// after that boundary, and ok=true when a boundary was found. When no boundary
// exists (ok=false) the caller should replay all records verbatim
// (backward-compatible: old sessions have no boundary records).
func FindLastCompactBoundary(msgs []Message) (boundary CompactBoundary, after []Message, ok bool) {
	last := -1
	for i, m := range msgs {
		if m.Type == TypeCompactBoundary {
			last = i
		}
	}
	if last < 0 {
		return CompactBoundary{}, nil, false
	}
	if err := json.Unmarshal([]byte(msgs[last].Content), &boundary); err != nil {
		// Corrupt boundary blob — fall back to full replay rather than losing
		// the conversation.
		return CompactBoundary{}, nil, false
	}
	for _, m := range msgs[last+1:] {
		if m.Type == TypeCompactBoundary {
			continue // defensive; FindLast already targeted the final one
		}
		after = append(after, m)
	}
	return boundary, after, true
}

type SessionInfo struct {
	ID           string
	FirstMessage string
	MessageCount int
	FileSize     int64
	GitBranch    string
	ModTime      time.Time
}

func NewID() string {
	var b [2]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand rarely fails; fall back to lower 16 bits of nanoseconds to avoid same-second collisions
		return fmt.Sprintf("%s-%04x", time.Now().Format("20060102-150405"), time.Now().UnixNano()&0xFFFF)
	}
	return time.Now().Format("20060102-150405") + "-" + hex.EncodeToString(b[:])
}

func sessionsDir(workDir string) string {
	return filepath.Join(workDir, ".larky", "sessions")
}

func SessionFilePath(workDir, id string) string {
	return filepath.Join(sessionsDir(workDir), id+".jsonl")
}

func SaveMessage(workDir, sessionID string, msg Message) {
	dir := sessionsDir(workDir)
	os.MkdirAll(dir, 0o755)

	f, err := os.OpenFile(SessionFilePath(workDir, sessionID), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()

	data, _ := json.Marshal(msg)
	f.Write(data)
	f.Write([]byte("\n"))
}

func LoadSession(workDir, sessionID string) []Message {
	path := SessionFilePath(workDir, sessionID)
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	var msgs []Message
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 256*1024), 1024*1024)
	for scanner.Scan() {
		var msg Message
		if json.Unmarshal(scanner.Bytes(), &msg) == nil && msg.Content != "" {
			msgs = append(msgs, msg)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil
	}
	return msgs
}

// maxSessionAgeDays is the maximum retention period for sessions; older sessions are auto-cleaned.
const maxSessionAgeDays = 30

func ListSessions(workDir string) []SessionInfo {
	dir := sessionsDir(workDir)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}

	branch := currentGitBranch(workDir)
	cutoff := time.Now().AddDate(0, 0, -maxSessionAgeDays)

	var sessions []SessionInfo
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".jsonl") {
			continue
		}
		id := strings.TrimSuffix(e.Name(), ".jsonl")
		info, err := e.Info()
		if err != nil {
			continue
		}

		// Auto-clean sessions older than 30 days
		if info.ModTime().Before(cutoff) {
			os.Remove(filepath.Join(dir, e.Name()))
			continue
		}

		msgs := LoadSession(workDir, id)
		first := ""
		for _, msg := range msgs {
			if msg.Role == "user" {
				first = msg.Content
				break
			}
		}

		sessions = append(sessions, SessionInfo{
			ID:           id,
			FirstMessage: first,
			MessageCount: len(msgs),
			FileSize:     info.Size(),
			GitBranch:    branch,
			ModTime:      info.ModTime(),
		})
	}

	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].ModTime.After(sessions[j].ModTime)
	})

	return sessions
}

func currentGitBranch(dir string) string {
	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func FormatRelativeTime(t time.Time) string {
	d := time.Since(t)
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		m := int(d.Minutes())
		if m == 1 {
			return "1 minute ago"
		}
		return fmt.Sprintf("%d minutes ago", m)
	case d < 24*time.Hour:
		h := int(d.Hours())
		if h == 1 {
			return "1 hour ago"
		}
		return fmt.Sprintf("%d hours ago", h)
	case d < 7*24*time.Hour:
		days := int(d.Hours() / 24)
		if days == 1 {
			return "1 day ago"
		}
		return fmt.Sprintf("%d days ago", days)
	default:
		weeks := int(d.Hours() / 24 / 7)
		if weeks == 1 {
			return "1 week ago"
		}
		return fmt.Sprintf("%d weeks ago", weeks)
	}
}

func FormatFileSize(bytes int64) string {
	switch {
	case bytes < 1024:
		return fmt.Sprintf("%dB", bytes)
	case bytes < 1024*1024:
		kb := float64(bytes) / 1024
		if kb == float64(int(kb)) {
			return fmt.Sprintf("%.0fKB", kb)
		}
		return fmt.Sprintf("%.1fKB", kb)
	default:
		mb := float64(bytes) / 1024 / 1024
		return fmt.Sprintf("%.1fMB", mb)
	}
}

func MatchesSearch(s SessionInfo, query string) bool {
	if query == "" {
		return true
	}
	q := strings.ToLower(query)
	return strings.Contains(strings.ToLower(s.FirstMessage), q) ||
		strings.Contains(strings.ToLower(s.ID), q)
}
