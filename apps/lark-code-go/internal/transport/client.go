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

// EventHandler processes events pushed by the server.
type EventHandler func(event json.RawMessage) error

// Client is a TCP-based NDJSON JSON-RPC client.
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

// NewClient creates a new TCP client.
func NewClient(host string, port int) *Client {
	return &Client{
		host:         host,
		port:         port,
		pending:      make(map[string]chan *pendingResult),
		disconnectCh: make(chan struct{}),
	}
}

// Connect establishes a TCP connection and starts the read loop.
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

// WaitForDisconnect returns a channel that is closed when the connection is lost.
func (c *Client) WaitForDisconnect() <-chan struct{} {
	return c.disconnectCh
}

// Close shuts down the connection.
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

// OnEvent registers an event handler (persists across reconnections).
func (c *Client) OnEvent(handler EventHandler) {
	c.eventHandlers = append(c.eventHandlers, handler)
}

// SendCommand sends a JSON-RPC command and waits for the response.
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

// readLoop reads messages from the connection and dispatches them.
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

	// Connection lost.
	c.signalDisconnect()

	// Reject all pending requests.
	c.pendingMu.Lock()
	for id, ch := range c.pending {
		close(ch)
		delete(c.pending, id)
	}
	c.pendingMu.Unlock()
}

// dispatch parses incoming messages and routes them to pending request channels or event handlers.
func (c *Client) dispatch(line []byte) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(line, &raw); err != nil {
		return
	}

	// Check if the message is an event push.
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

	// Check if the message is a JSON-RPC response.
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

// signalDisconnect notifies listeners that the connection has been lost.
func (c *Client) signalDisconnect() {
	c.closeMu.Lock()
	defer c.closeMu.Unlock()

	if !c.closed {
		c.closed = true
		close(c.disconnectCh)
	}
}
