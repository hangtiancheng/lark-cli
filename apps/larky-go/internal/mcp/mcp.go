package mcp

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/hangtiancheng/lark-cli/apps/larky/internal/tools"
)

var nonAlphanumeric = regexp.MustCompile(`[^a-zA-Z0-9_]`)

type ServerConfig struct {
	Name      string            `yaml:"name"`
	Command   string            `yaml:"command"`
	Args      []string          `yaml:"args"`
	URL       string            `yaml:"url"`
	Transport string            `yaml:"transport"`
	Headers   map[string]string `yaml:"headers"`
	Env       map[string]string `yaml:"env"`
}

func (c *ServerConfig) IsStdio() bool {
	return c.Command != ""
}

// transportKind picks the HTTP transport variant. Empty/"http"/"streamable" →
// Streamable HTTP (2025-03-26 spec); "sse" → legacy SSE (2024-11-05 spec).
func (c *ServerConfig) transportKind() string {
	switch strings.ToLower(c.Transport) {
	case "sse":
		return "sse"
	default:
		return "http"
	}
}

// headerRoundTripper injects fixed headers onto every outgoing request.
type headerRoundTripper struct {
	base    http.RoundTripper
	headers map[string]string
}

func (h *headerRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	for k, v := range h.headers {
		clone.Header.Set(k, os.ExpandEnv(v))
	}
	return h.base.RoundTrip(clone)
}

func newHTTPClient(headers map[string]string) *http.Client {
	if len(headers) == 0 {
		return http.DefaultClient
	}
	return &http.Client{
		Transport: &headerRoundTripper{
			base:    http.DefaultTransport,
			headers: headers,
		},
	}
}

type Client struct {
	config    ServerConfig
	session   *mcp.ClientSession
	sdkClient *mcp.Client
}

func NewClient(config ServerConfig) *Client {
	return &Client{config: config}
}

func (c *Client) Connect(ctx context.Context) error {
	impl := &mcp.Implementation{Name: "larky", Version: "0.1.0"}
	c.sdkClient = mcp.NewClient(impl, nil)

	var transport mcp.Transport
	switch {
	case c.config.IsStdio():
		cmd := exec.Command(c.config.Command, c.config.Args...)
		cmd.Env = os.Environ()
		for k, v := range c.config.Env {
			cmd.Env = append(cmd.Env, k+"="+os.ExpandEnv(v))
		}
		// Detach stderr from the parent tty. Otherwise child processes (npx/node)
		// detect stderr as a TTY and emit OSC color queries; the terminal sends
		// the response to the controlling process's stdin, polluting the TUI input.
		cmd.Stderr = io.Discard
		transport = &mcp.CommandTransport{Command: cmd}
	case c.config.URL != "":
		httpClient := newHTTPClient(c.config.Headers)
		if c.config.transportKind() == "sse" {
			transport = &mcp.SSEClientTransport{Endpoint: c.config.URL, HTTPClient: httpClient}
		} else {
			transport = &mcp.StreamableClientTransport{Endpoint: c.config.URL, HTTPClient: httpClient}
		}
	default:
		return fmt.Errorf("MCP server %s: neither command nor url configured", c.config.Name)
	}

	session, err := c.sdkClient.Connect(ctx, transport, nil)
	if err != nil {
		return fmt.Errorf("connect MCP server %s: %w", c.config.Name, err)
	}
	c.session = session
	return nil
}

func (c *Client) ListTools(ctx context.Context) ([]*mcp.Tool, error) {
	result, err := c.session.ListTools(ctx, nil)
	if err != nil {
		return nil, err
	}
	return result.Tools, nil
}

func (c *Client) CallTool(ctx context.Context, name string, args map[string]any) (string, bool, error) {
	result, err := c.session.CallTool(ctx, &mcp.CallToolParams{
		Name:      name,
		Arguments: args,
	})
	if err != nil {
		return "", true, err
	}
	var parts []string
	for _, content := range result.Content {
		if tc, ok := content.(*mcp.TextContent); ok {
			parts = append(parts, tc.Text)
		}
	}
	text := strings.Join(parts, "\n")
	if text == "" {
		text = "(no output)"
	}
	return text, result.IsError, nil
}

func (c *Client) Close() {
	if c.session != nil {
		c.session.Close()
	}
}

// Manager handles multiple MCP servers

type Manager struct {
	configs map[string]ServerConfig
	clients map[string]*Client
}

func NewManager() *Manager {
	return &Manager{
		configs: make(map[string]ServerConfig),
		clients: make(map[string]*Client),
	}
}

func (m *Manager) LoadConfigs(configs []ServerConfig) {
	for _, cfg := range configs {
		m.configs[cfg.Name] = cfg
	}
}

type ServerInfo struct {
	Name         string
	Instructions string
}

type ConnectResult struct {
	Mgr     *Manager
	Tools   []tools.Tool
	Servers []ServerInfo
	Errors  []string
}

func (m *Manager) ConnectAll(ctx context.Context) ConnectResult {
	var errs []string
	var registered []tools.Tool
	var servers []ServerInfo
	for name, cfg := range m.configs {
		client := NewClient(cfg)
		if err := client.Connect(ctx); err != nil {
			msg := fmt.Sprintf("MCP server '%s': %s", name, err)
			log.Println(msg)
			errs = append(errs, msg)
			continue
		}
		m.clients[name] = client

		info := ServerInfo{Name: name}
		if initResult := client.session.InitializeResult(); initResult != nil {
			info.Instructions = initResult.Instructions
		}
		servers = append(servers, info)

		toolDefs, err := client.ListTools(ctx)
		if err != nil {
			msg := fmt.Sprintf("MCP server '%s' list tools: %s", name, err)
			log.Println(msg)
			errs = append(errs, msg)
			continue
		}

		for _, td := range toolDefs {
			registered = append(registered, &MCPToolWrapper{
				serverName: name,
				toolDef:    td,
				client:     client,
			})
		}
	}
	return ConnectResult{Mgr: m, Tools: registered, Servers: servers, Errors: errs}
}

func (m *Manager) RegisterAllTools(ctx context.Context, registry *tools.Registry) []string {
	result := m.ConnectAll(ctx)
	for _, t := range result.Tools {
		registry.Register(t)
	}
	return result.Errors
}

func (m *Manager) Shutdown() {
	for _, client := range m.clients {
		client.Close()
	}
	m.clients = make(map[string]*Client)
}

// MCPToolWrapper adapts an MCP tool to the Tool interface

type MCPToolWrapper struct {
	serverName string
	toolDef    *mcp.Tool
	client     *Client
}

func (w *MCPToolWrapper) Name() string {
	return "mcp__" + SanitizeName(w.serverName) + "__" + SanitizeName(w.toolDef.Name)
}

func SanitizeName(name string) string {
	return nonAlphanumeric.ReplaceAllString(name, "_")
}
func (w *MCPToolWrapper) Description() string          { return w.toolDef.Description }
func (w *MCPToolWrapper) Category() tools.ToolCategory { return tools.CategoryCommand }
func (w *MCPToolWrapper) ShouldDefer() bool            { return true }

func (w *MCPToolWrapper) Schema() map[string]any {
	inputSchema := w.toolDef.InputSchema
	if inputSchema == nil {
		inputSchema = map[string]any{"type": "object", "properties": map[string]any{}}
	}
	return map[string]any{
		"name":         w.Name(),
		"description":  w.Description(),
		"input_schema": inputSchema,
	}
}

func (w *MCPToolWrapper) Execute(ctx context.Context, args map[string]any) tools.ToolResult {
	text, isError, err := w.client.CallTool(ctx, w.toolDef.Name, args)
	if err != nil {
		return tools.ToolResult{Output: fmt.Sprintf("MCP tool call failed: %s", err), IsError: true}
	}
	return tools.ToolResult{Output: text, IsError: isError}
}
