package transport

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"sync"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/bus"
)

// HandlerFunc processes a JSON-RPC request and returns a result or error.
type HandlerFunc func(ctx context.Context, params json.RawMessage) (any, error)

// HandlerError represents an error raised by a JSON-RPC handler.
type HandlerError struct {
	Code    int
	Message string
	Data    any
}

func (e *HandlerError) Error() string {
	return fmt.Sprintf("[%d] %s", e.Code, e.Message)
}

// NewHandlerError constructs a new HandlerError with the given code and message.
func NewHandlerError(code int, message string) *HandlerError {
	return &HandlerError{Code: code, Message: message}
}

// Server is a TCP-based NDJSON JSON-RPC server.
type Server struct {
	host     string
	port     int
	listener net.Listener
	handlers map[string]HandlerFunc
	mu       sync.RWMutex

	// Active connection tracking.
	conns   map[net.Conn]struct{}
	connsMu sync.Mutex

	// Event broadcasting (injected by the Broadcaster).
	broadcaster *Broadcaster

	// Graceful shutdown signaling.
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// NewServer creates a new TCP server.
func NewServer(host string, port int) *Server {
	ctx, cancel := context.WithCancel(context.Background())
	return &Server{
		host:     host,
		port:     port,
		handlers: make(map[string]HandlerFunc),
		conns:    make(map[net.Conn]struct{}),
		ctx:      ctx,
		cancel:   cancel,
	}
}

// Register registers a JSON-RPC handler for the given method.
func (s *Server) Register(method string, handler HandlerFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.handlers[method] = handler
}

// SetBroadcaster sets the event broadcaster.
func (s *Server) SetBroadcaster(b *Broadcaster) {
	s.broadcaster = b
}

// Start begins listening for incoming TCP connections.
func (s *Server) Start() error {
	addr := net.JoinHostPort(s.host, fmt.Sprintf("%d", s.port))
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("failed to listen on %s: %w", addr, err)
	}
	s.listener = listener
	slog.Info("server listening", "addr", addr)

	s.wg.Add(1)
	go s.acceptLoop()

	return nil
}

// Addr returns the server's listening address.
func (s *Server) Addr() string {
	if s.listener == nil {
		return ""
	}
	return s.listener.Addr().String()
}

// Stop gracefully shuts down the server.
func (s *Server) Stop() {
	s.cancel()
	if s.listener != nil {
		_ = s.listener.Close()
	}

	// Close all active connections.
	s.connsMu.Lock()
	for conn := range s.conns {
		_ = conn.Close()
	}
	s.connsMu.Unlock()

	s.wg.Wait()
}

// acceptLoop accepts new incoming connections.
func (s *Server) acceptLoop() {
	defer s.wg.Done()

	for {
		conn, err := s.listener.Accept()
		if err != nil {
			select {
			case <-s.ctx.Done():
				return
			default:
				slog.Error("accept error", "error", err)
				continue
			}
		}

		s.connsMu.Lock()
		s.conns[conn] = struct{}{}
		s.connsMu.Unlock()

		s.wg.Add(1)
		go s.handleConnection(conn)
	}
}

// handleConnection handles the read/write lifecycle of a single connection.
func (s *Server) handleConnection(conn net.Conn) {
	defer s.wg.Done()
	defer func() {
		s.connsMu.Lock()
		delete(s.conns, conn)
		s.connsMu.Unlock()

		// Clean up the broadcaster subscription for this connection.
		if s.broadcaster != nil {
			s.broadcaster.UnsubscribeWriter(conn)
		}

		_ = conn.Close()
	}()

	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 0, 1024*1024), 10*1024*1024) // 10MB max line

	for scanner.Scan() {
		select {
		case <-s.ctx.Done():
			return
		default:
		}

		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		s.handleLine(conn, line)
	}
}

// handleLine parses and dispatches a single line as a JSON-RPC request.
func (s *Server) handleLine(conn net.Conn, line []byte) {
	var req bus.JsonRpcRequest
	if err := json.Unmarshal(line, &req); err != nil {
		s.sendJSON(conn, bus.MakeError("", bus.ParseError, "invalid JSON", nil))
		return
	}

	if req.Jsonrpc != "2.0" || req.ID == "" || req.Method == "" {
		s.sendJSON(conn, bus.MakeError(req.ID, bus.InvalidRequest, "invalid JSON-RPC request", nil))
		return
	}

	// Special handling for event.subscribe: register the broadcaster writer.
	if req.Method == "event.subscribe" && s.broadcaster != nil {
		s.broadcaster.RegisterWriter(conn)
	}

	s.mu.RLock()
	handler, ok := s.handlers[req.Method]
	s.mu.RUnlock()

	if !ok {
		s.sendJSON(conn, bus.MakeError(req.ID, bus.MethodNotFound,
			fmt.Sprintf("method not found: %s", req.Method), nil))
		return
	}

	// Execute the handler asynchronously to avoid blocking the read loop.
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		// Inject the connection into the context for handler access (e.g., event.subscribe).
		handlerCtx := ContextWithConn(s.ctx, conn)
		result, err := handler(handlerCtx, req.Params)
		if err != nil {
			if he, ok := err.(*HandlerError); ok {
				s.sendJSON(conn, bus.MakeError(req.ID, he.Code, he.Message, nil))
			} else {
				s.sendJSON(conn, bus.MakeError(req.ID, bus.InternalError, err.Error(), nil))
			}
			return
		}
		s.sendJSON(conn, bus.MakeSuccess(req.ID, result))
	}()
}

// sendJSON serializes the given value as JSON and writes it to the connection.
func (s *Server) sendJSON(conn net.Conn, v any) {
	data, err := json.Marshal(v)
	if err != nil {
		slog.Error("failed to marshal response", "error", err)
		return
	}

	data = append(data, '\n')
	if _, err := conn.Write(data); err != nil {
		slog.Debug("failed to write to client", "error", err)
	}
}

// WriteToConn writes a JSON-encoded value to the given connection (used by the broadcaster).
func WriteToConn(conn net.Conn, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	_, err = conn.Write(data)
	return err
}
