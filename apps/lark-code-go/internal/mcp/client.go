package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os/exec"
	"sync"
)

// Client implements an MCP client using JSON-RPC 2.0 over stdio.
type Client struct {
	name    string
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	stdout  io.ReadCloser
	mu      sync.Mutex
	nextID  int
	pending map[int]chan json.RawMessage
}

// NewClient creates a new MCP client with the given name and command.
func NewClient(name string, command string, args []string, env map[string]string) *Client {
	return &Client{
		name:    name,
		pending: make(map[int]chan json.RawMessage),
	}
}

// Start launches the MCP server process and performs the initialization handshake.
func (c *Client) Start(ctx context.Context, command string, args []string, env map[string]string) error {
	cmd := exec.CommandContext(ctx, command, args...)

	// Set environment variables for the subprocess
	for k, v := range env {
		cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
	}

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("failed to get stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to get stdout pipe: %w", err)
	}

	// Discard stderr output
	cmd.Stderr = io.Discard

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start MCP server: %w", err)
	}

	c.cmd = cmd
	c.stdin = stdin
	c.stdout = stdout

	// Start the read loop
	go c.readLoop()

	// Perform MCP initialization handshake
	if _, err := c.call(ctx, "initialize", map[string]any{
		"protocolVersion": "2024-11-05",
		"capabilities":    map[string]any{},
		"clientInfo":      map[string]any{"name": "lark-code-go", "version": "0.1.0"},
	}); err != nil {
		return fmt.Errorf("MCP initialize failed: %w", err)
	}

	// Send the initialized notification
	if err := c.notify("notifications/initialized", map[string]any{}); err != nil {
		return fmt.Errorf("MCP initialized notification failed: %w", err)
	}

	return nil
}

// Stop shuts down the MCP client and kills the server process.
func (c *Client) Stop() {
	if c.stdin != nil {
		_ = c.stdin.Close()
	}
	if c.cmd != nil && c.cmd.Process != nil {
		_ = c.cmd.Process.Kill()
		_ = c.cmd.Wait()
	}
}

// ListTools lists all tools provided by the MCP server.
func (c *Client) ListTools(ctx context.Context) ([]ToolDef, error) {
	result, err := c.call(ctx, "tools/list", map[string]any{})
	if err != nil {
		return nil, err
	}

	var response struct {
		Tools []ToolDef `json:"tools"`
	}
	if err := json.Unmarshal(result, &response); err != nil {
		return nil, fmt.Errorf("failed to parse tools/list response: %w", err)
	}

	return response.Tools, nil
}

// CallTool invokes an MCP tool with the given arguments.
func (c *Client) CallTool(ctx context.Context, name string, arguments map[string]any) (*ToolCallResult, error) {
	result, err := c.call(ctx, "tools/call", map[string]any{
		"name":      name,
		"arguments": arguments,
	})
	if err != nil {
		return nil, err
	}

	var callResult ToolCallResult
	if err := json.Unmarshal(result, &callResult); err != nil {
		return nil, fmt.Errorf("failed to parse tools/call response: %w", err)
	}

	return &callResult, nil
}

// ToolDef represents an MCP tool definition.
type ToolDef struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

// ToolCallResult represents the result of an MCP tool call.
type ToolCallResult struct {
	Content []ContentItem `json:"content"`
	IsError bool          `json:"isError"`
}

// ContentItem represents an MCP content item.
type ContentItem struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// call sends a JSON-RPC request and waits for the response.
func (c *Client) call(ctx context.Context, method string, params map[string]any) (json.RawMessage, error) {
	c.mu.Lock()
	c.nextID++
	id := c.nextID
	ch := make(chan json.RawMessage, 1)
	c.pending[id] = ch
	c.mu.Unlock()

	req := map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"method":  method,
		"params":  params,
	}

	data, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}

	c.mu.Lock()
	_, err = c.stdin.Write(append(data, '\n'))
	c.mu.Unlock()
	if err != nil {
		return nil, fmt.Errorf("failed to write to MCP stdin: %w", err)
	}

	select {
	case result := <-ch:
		return result, nil
	case <-ctx.Done():
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return nil, ctx.Err()
	}
}

// notify sends a JSON-RPC notification (no response expected).
func (c *Client) notify(method string, params map[string]any) error {
	req := map[string]any{
		"jsonrpc": "2.0",
		"method":  method,
		"params":  params,
	}

	data, err := json.Marshal(req)
	if err != nil {
		return err
	}

	c.mu.Lock()
	_, err = c.stdin.Write(append(data, '\n'))
	c.mu.Unlock()
	return err
}

// readLoop reads and dispatches messages from the MCP server stdout.
func (c *Client) readLoop() {
	buf := make([]byte, 0, 64*1024)
	scanner := newLineScanner(c.stdout, buf)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var raw map[string]json.RawMessage
		if err := json.Unmarshal(line, &raw); err != nil {
			slog.Warn("mcp client: failed to parse response", "error", err)
			continue
		}

		if idRaw, ok := raw["id"]; ok {
			var id int
			if err := json.Unmarshal(idRaw, &id); err != nil {
				continue
			}

			c.mu.Lock()
			ch, ok := c.pending[id]
			if ok {
				delete(c.pending, id)
			}
			c.mu.Unlock()

			if ok {
				if errRaw, ok := raw["error"]; ok {
					ch <- errRaw // Forward the error to the caller for handling
				} else if resultRaw, ok := raw["result"]; ok {
					ch <- resultRaw
				}
			}
		}
	}
}

// lineScanner is a simple line-by-line reader.
type lineScanner struct {
	reader io.Reader
	buf    []byte
	line   []byte
	err    error
}

func newLineScanner(r io.Reader, buf []byte) *lineScanner {
	return &lineScanner{reader: r, buf: buf}
}

func (s *lineScanner) Scan() bool {
	s.line = nil
	tmp := make([]byte, 1)
	for {
		_, err := s.reader.Read(tmp)
		if err != nil {
			s.err = err
			return false
		}
		if tmp[0] == '\n' {
			return true
		}
		s.line = append(s.line, tmp[0])
	}
}

func (s *lineScanner) Bytes() []byte {
	return s.line
}
