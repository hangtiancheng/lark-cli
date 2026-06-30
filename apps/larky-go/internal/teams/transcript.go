package teams

import (
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/hangtiancheng/lark-cli/apps/larky/internal/conversation"
)

// transcriptEntry 是序列化到磁盘的单条对话记录。
type transcriptEntry struct {
	Role        string                 `json:"role"`
	Content     string                 `json:"content,omitempty"`
	ToolUses    []transcriptToolUse    `json:"tool_uses,omitempty"`
	ToolResults []transcriptToolResult `json:"tool_results,omitempty"`
}

type transcriptToolUse struct {
	ToolUseID string         `json:"tool_use_id"`
	ToolName  string         `json:"tool_name"`
	Arguments map[string]any `json:"arguments,omitempty"`
}

type transcriptToolResult struct {
	ToolUseID string `json:"tool_use_id"`
	Content   string `json:"content"`
	IsError   bool   `json:"is_error,omitempty"`
}

// serializeConversation 将对话历史序列化为可持久化的 JSON 格式。
func serializeConversation(conv *conversation.Manager) []transcriptEntry {
	var entries []transcriptEntry
	for _, msg := range conv.GetMessages() {
		entry := transcriptEntry{Role: msg.Role, Content: msg.Content}
		for _, tu := range msg.ToolUses {
			entry.ToolUses = append(entry.ToolUses, transcriptToolUse{
				ToolUseID: tu.ToolUseID,
				ToolName:  tu.ToolName,
				Arguments: tu.Arguments,
			})
		}
		for _, tr := range msg.ToolResults {
			entry.ToolResults = append(entry.ToolResults, transcriptToolResult{
				ToolUseID: tr.ToolUseID,
				Content:   tr.Content,
				IsError:   tr.IsError,
			})
		}
		entries = append(entries, entry)
	}
	return entries
}

// deserializeConversation 从磁盘格式恢复对话管理器。
func deserializeConversation(entries []transcriptEntry) *conversation.Manager {
	conv := conversation.NewManager()
	for _, e := range entries {
		var toolUses []conversation.ToolUseBlock
		for _, tu := range e.ToolUses {
			toolUses = append(toolUses, conversation.ToolUseBlock{
				ToolUseID: tu.ToolUseID,
				ToolName:  tu.ToolName,
				Arguments: tu.Arguments,
			})
		}
		var toolResults []conversation.ToolResultBlock
		for _, tr := range e.ToolResults {
			toolResults = append(toolResults, conversation.ToolResultBlock{
				ToolUseID: tr.ToolUseID,
				Content:   tr.Content,
				IsError:   tr.IsError,
			})
		}
		msg := conversation.Message{
			Role:        e.Role,
			Content:     e.Content,
			ToolUses:    toolUses,
			ToolResults: toolResults,
		}
		conv.AppendMessages([]conversation.Message{msg})
	}
	return conv
}

// transcriptDir 返回团队的 transcript 存储目录。
func transcriptDir(teamName string) string {
	return filepath.Join(teamsBaseDir(), teamName, "transcripts")
}

// SaveTranscript 将队友的对话历史持久化到磁盘，用于调试和问题排查。
// 文件路径为 .larky/teams/<team>/transcripts/<agentID>.json。
func SaveTranscript(teamName, agentID string, conv *conversation.Manager) (string, error) {
	dir := transcriptDir(teamName)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, agentID+".json")
	data, err := json.MarshalIndent(serializeConversation(conv), "", "  ")
	if err != nil {
		return "", err
	}
	return path, os.WriteFile(path, data, 0o644)
}

// LoadTranscript 从磁盘加载队友的对话历史。
// 返回 nil 表示文件不存在或解析失败。
func LoadTranscript(teamName, agentID string) *conversation.Manager {
	path := filepath.Join(transcriptDir(teamName), agentID+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var entries []transcriptEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		return nil
	}
	return deserializeConversation(entries)
}
