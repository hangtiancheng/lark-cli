package transport

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"sync"

	"github.com/google/uuid"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/bus"
)

// EventHandler 处理服务端推送的事件
type EventHandler func(event json.RawMessage) error

// Client 是 TCP NDJSON JSON-RPC 客户端
type Client struct {
	host string
	port int
	conn net.Conn
	mu   sync.Mutex

	pending   map[string]chan *pendingResult
	pendingMu sync.Mutex

	eventHandlers []EventHandler
	disconnectCh  chan struct{}
	closed        bool
	closeMu       sync.Mutex
}

type pendingResult struct {
	result json.RawMessage
	err    *bus.JsonRpcErrorObject
}

// NewClient 创建 TCP 客户端
func NewClient(host string, port int) *Client {
	return &Client{
		host:         host,
		port:         port,
		pending:      make(map[string]chan *pendingResult),
		disconnectCh: make(chan struct{}),
	}
}

// Connect 建立 TCP 连接并启动读取循环
func (c *Client) Connect() error {
	addr := net.JoinHostPort(c.host, fmt.Sprintf("%d", c.port))
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		return fmt.Errorf("failed to connect to %s: %w", addr, err)
	}
	c.conn = conn
	go c.readLoop()
	return nil
}

// WaitForDisconnect 返回一个 channel，在连接断开时关闭
func (c *Client) WaitForDisconnect() <-chan struct{} {
	return c.disconnectCh
}

// Close 关闭连接
func (c *Client) Close() {
	c.closeMu.Lock()
	defer c.closeMu.Unlock()

	if c.closed {
		return
	}
	c.closed = true
	close(c.disconnectCh)

	if c.conn != nil {
		_ = c.conn.Close()
	}

	c.pendingMu.Lock()
	for id, ch := range c.pending {
		close(ch)
		delete(c.pending, id)
	}
	c.pendingMu.Unlock()
}

// OnEvent 注册事件处理器（跨重连持久化）
func (c *Client) OnEvent(handler EventHandler) {
	c.eventHandlers = append(c.eventHandlers, handler)
}

// SendCommand 发送 JSON-RPC 命令并等待响应
func (c *Client) SendCommand(method string, params any) (json.RawMessage, error) {
	if c.conn == nil {
		return nil, fmt.Errorf("not connected")
	}

	reqID := uuid.New().String()

	var paramsRaw json.RawMessage
	if params != nil {
		data, err := json.Marshal(params)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal params: %w", err)
		}
		paramsRaw = data
	}

	req := bus.JsonRpcRequest{
		Jsonrpc: "2.0",
		ID:      reqID,
		Method:  method,
		Params:  paramsRaw,
	}

	resultCh := make(chan *pendingResult, 1)
	c.pendingMu.Lock()
	c.pending[reqID] = resultCh
	c.pendingMu.Unlock()

	data, err := json.Marshal(req)
	if err != nil {
		c.pendingMu.Lock()
		delete(c.pending, reqID)
		c.pendingMu.Unlock()
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	c.mu.Lock()
	_, err = c.conn.Write(append(data, '\n'))
	c.mu.Unlock()
	if err != nil {
		c.pendingMu.Lock()
		delete(c.pending, reqID)
		c.pendingMu.Unlock()
		return nil, fmt.Errorf("failed to write: %w", err)
	}

	result, ok := <-resultCh
	if !ok {
		return nil, fmt.Errorf("connection closed")
	}

	if result.err != nil {
		return nil, fmt.Errorf("[%d] %s", result.err.Code, result.err.Message)
	}

	return result.result, nil
}

// readLoop 从连接读取消息并分发
func (c *Client) readLoop() {
	scanner := bufio.NewScanner(c.conn)
	scanner.Buffer(make([]byte, 0, 1024*1024), 10*1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		c.dispatch(line)
	}

	// 连接断开
	c.signalDisconnect()

	// 拒绝所有 pending 请求
	c.pendingMu.Lock()
	for id, ch := range c.pending {
		close(ch)
		delete(c.pending, id)
	}
	c.pendingMu.Unlock()
}

// dispatch 解析消息并路由到 pending 或 event handler
func (c *Client) dispatch(line []byte) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(line, &raw); err != nil {
		return
	}

	// 检查是否为事件推送
	if kindRaw, ok := raw["kind"]; ok {
		var kind string
		if err := json.Unmarshal(kindRaw, &kind); err == nil && kind == "event" {
			if eventRaw, ok := raw["event"]; ok {
				for _, handler := range c.eventHandlers {
					_ = handler(eventRaw)
				}
			}
			return
		}
	}

	// 检查是否为 JSON-RPC 响应
	if idRaw, ok := raw["id"]; ok {
		var id string
		if err := json.Unmarshal(idRaw, &id); err != nil {
			return
		}

		c.pendingMu.Lock()
		ch, ok := c.pending[id]
		if ok {
			delete(c.pending, id)
		}
		c.pendingMu.Unlock()

		if !ok {
			return
		}

		result := &pendingResult{}
		if errRaw, ok := raw["error"]; ok {
			var errObj bus.JsonRpcErrorObject
			if err := json.Unmarshal(errRaw, &errObj); err == nil {
				result.err = &errObj
			}
		} else if resRaw, ok := raw["result"]; ok {
			result.result = resRaw
		}

		ch <- result
	}
}

// signalDisconnect 通知连接断开
func (c *Client) signalDisconnect() {
	c.closeMu.Lock()
	defer c.closeMu.Unlock()

	if !c.closed {
		c.closed = true
		close(c.disconnectCh)
	}
}
