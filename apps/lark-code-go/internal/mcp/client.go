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

// Client 实现 JSON-RPC 2.0 over stdio 的 MCP 客户端
type Client struct {
	name    string
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	stdout  io.ReadCloser
	mu      sync.Mutex
	nextID  int
	pending map[int]chan json.RawMessage
}

// NewClient 创建 MCP 客户端
func NewClient(name string, command string, args []string, env map[string]string) *Client {
	return &Client{
		name:    name,
		pending: make(map[int]chan json.RawMessage),
	}
}

// Start 启动 MCP 服务器进程并执行初始化握手
func (c *Client) Start(ctx context.Context, command string, args []string, env map[string]string) error {
	cmd := exec.CommandContext(ctx, command, args...)

	// 设置环境变量
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

	// 排空 stderr
	cmd.Stderr = io.Discard

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start MCP server: %w", err)
	}

	c.cmd = cmd
	c.stdin = stdin
	c.stdout = stdout

	// 启动读取循环
	go c.readLoop()

	// MCP 初始化握手
	if _, err := c.call(ctx, "initialize", map[string]any{
		"protocolVersion": "2024-11-05",
		"capabilities":    map[string]any{},
		"clientInfo":      map[string]any{"name": "lark-code-go", "version": "0.1.0"},
	}); err != nil {
		return fmt.Errorf("MCP initialize failed: %w", err)
	}

	// 发送 initialized 通知
	if err := c.notify("notifications/initialized", map[string]any{}); err != nil {
		return fmt.Errorf("MCP initialized notification failed: %w", err)
	}

	return nil
}

// Stop 关闭 MCP 客户端
func (c *Client) Stop() {
	if c.stdin != nil {
		_ = c.stdin.Close()
	}
	if c.cmd != nil && c.cmd.Process != nil {
		_ = c.cmd.Process.Kill()
		_ = c.cmd.Wait()
	}
}

// ListTools 列出 MCP 服务器提供的工具
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

// CallTool 调用 MCP 工具
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

// ToolDef 表示 MCP 工具定义
type ToolDef struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

// ToolCallResult 表示 MCP 工具调用结果
type ToolCallResult struct {
	Content []ContentItem `json:"content"`
	IsError bool          `json:"isError"`
}

// ContentItem 表示 MCP 内容项
type ContentItem struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// call 发送 JSON-RPC 请求并等待响应
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

// notify 发送 JSON-RPC 通知（无响应）
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

// readLoop 读取 MCP 服务器输出
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
					ch <- errRaw // 传递错误给调用方处理
				} else if resultRaw, ok := raw["result"]; ok {
					ch <- resultRaw
				}
			}
		}
	}
}

// lineScanner 简单的按行读取器
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
