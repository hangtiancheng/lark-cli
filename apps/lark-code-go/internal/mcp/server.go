package mcp

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/config"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/tools"
)

// ServerManager 管理多个 MCP 服务器连接
type ServerManager struct {
	mu      sync.RWMutex
	clients map[string]*Client
	tools   []tools.Tool
}

// NewServerManager 创建 MCP 服务器管理器
func NewServerManager() *ServerManager {
	return &ServerManager{
		clients: make(map[string]*Client),
	}
}

// StartAll 启动所有配置的 MCP 服务器
func (m *ServerManager) StartAll(ctx context.Context, servers []config.McpServerConfig) error {
	for _, srv := range servers {
		if srv.Transport != "stdio" {
			slog.Warn("only stdio transport is supported, skipping", "server", srv.Name)
			continue
		}

		client := NewClient(srv.Name, srv.Command, srv.Args, srv.Env)
		if err := client.Start(ctx, srv.Command, srv.Args, srv.Env); err != nil {
			slog.Error("failed to start MCP server", "server", srv.Name, "error", err)
			continue
		}

		// 发现工具
		toolDefs, err := client.ListTools(ctx)
		if err != nil {
			slog.Error("failed to list MCP tools", "server", srv.Name, "error", err)
			client.Stop()
			continue
		}

		m.mu.Lock()
		m.clients[srv.Name] = client
		for _, td := range toolDefs {
			m.tools = append(m.tools, NewMcpTool(srv.Name, td, client))
		}
		m.mu.Unlock()

		slog.Info("MCP server started", "server", srv.Name, "tools", len(toolDefs))
	}

	return nil
}

// StopAll 停止所有 MCP 服务器
func (m *ServerManager) StopAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for name, client := range m.clients {
		client.Stop()
		slog.Info("MCP server stopped", "server", name)
	}
	m.clients = make(map[string]*Client)
	m.tools = nil
}

// GetTools 返回所有 MCP 工具
func (m *ServerManager) GetTools() []tools.Tool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.tools
}

// McpTool 将 MCP 工具定义适配为 Tool 接口
type McpTool struct {
	serverName string
	def        ToolDef
	client     *Client
}

// NewMcpTool 创建 MCP 工具适配器
func NewMcpTool(serverName string, def ToolDef, client *Client) *McpTool {
	return &McpTool{
		serverName: serverName,
		def:        def,
		client:     client,
	}
}

func (t *McpTool) Name() string {
	return fmt.Sprintf("%s__%s", t.serverName, t.def.Name)
}

func (t *McpTool) Description() string {
	return t.def.Description
}

func (t *McpTool) InputSchema() map[string]any {
	return t.def.InputSchema
}

func (t *McpTool) Invoke(ctx context.Context, params map[string]any) (*tools.ToolResult, error) {
	result, err := t.client.CallTool(ctx, t.def.Name, params)
	if err != nil {
		return &tools.ToolResult{
			Content:   fmt.Sprintf("MCP tool call failed: %s", err),
			IsError:   true,
			ErrorType: tools.ErrorTypeRuntime,
		}, nil
	}

	if result.IsError {
		text := extractMCPContent(result.Content)
		return &tools.ToolResult{
			Content:   text,
			IsError:   true,
			ErrorType: tools.ErrorTypeRuntime,
		}, nil
	}

	text := extractMCPContent(result.Content)
	return &tools.ToolResult{Content: text}, nil
}

// extractMCPContent 从 MCP 响应内容中提取文本
func extractMCPContent(items []ContentItem) string {
	var parts []string
	for _, item := range items {
		if item.Type == "text" && item.Text != "" {
			parts = append(parts, item.Text)
		}
	}
	if len(parts) == 0 {
		return "(no text content)"
	}
	result := parts[0]
	for i := 1; i < len(parts); i++ {
		result += "\n" + parts[i]
	}
	return result
}

// ensure McpTool satisfies Tool
var _ tools.Tool = (*McpTool)(nil)
