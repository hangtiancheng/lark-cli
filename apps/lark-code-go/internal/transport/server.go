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

// HandlerFunc 处理 JSON-RPC 请求并返回结果或错误
type HandlerFunc func(ctx context.Context, params json.RawMessage) (any, error)

// HandlerError 表示 JSON-RPC handler 抛出的错误
type HandlerError struct {
	Code    int
	Message string
	Data    any
}

func (e *HandlerError) Error() string {
	return fmt.Sprintf("[%d] %s", e.Code, e.Message)
}

// NewHandlerError 构造 HandlerError
func NewHandlerError(code int, message string) *HandlerError {
	return &HandlerError{Code: code, Message: message}
}

// Server 是 TCP NDJSON JSON-RPC 服务端
type Server struct {
	host     string
	port     int
	listener net.Listener
	handlers map[string]HandlerFunc
	mu       sync.RWMutex

	// 连接管理
	conns   map[net.Conn]struct{}
	connsMu sync.Mutex

	// 事件推送（由 broadcaster 注入）
	broadcaster *Broadcaster

	// 关闭信号
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// NewServer 创建 TCP 服务器
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

// Register 注册 JSON-RPC handler
func (s *Server) Register(method string, handler HandlerFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.handlers[method] = handler
}

// SetBroadcaster 设置事件广播器
func (s *Server) SetBroadcaster(b *Broadcaster) {
	s.broadcaster = b
}

// Start 开始监听 TCP 连接
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

// Addr 返回服务器监听地址
func (s *Server) Addr() string {
	if s.listener == nil {
		return ""
	}
	return s.listener.Addr().String()
}

// Stop 优雅关闭服务器
func (s *Server) Stop() {
	s.cancel()
	if s.listener != nil {
		_ = s.listener.Close()
	}

	// 关闭所有连接
	s.connsMu.Lock()
	for conn := range s.conns {
		_ = conn.Close()
	}
	s.connsMu.Unlock()

	s.wg.Wait()
}

// acceptLoop 接受新连接
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

// handleConnection 处理单个连接的读写
func (s *Server) handleConnection(conn net.Conn) {
	defer s.wg.Done()
	defer func() {
		s.connsMu.Lock()
		delete(s.conns, conn)
		s.connsMu.Unlock()

		// 清理 broadcaster 中的订阅
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

// handleLine 解析并分发单行 JSON-RPC 请求
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

	// 特殊处理 event.subscribe —— 需要注册 broadcaster writer
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

	// 异步执行 handler 防止阻塞读取循环
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		// 将连接注入 context，供 handler 使用（如 event.subscribe）
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

// sendJSON 将对象序列化为 JSON 并写入连接
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

// WriteToConn 向指定连接写入 JSON 数据（供 broadcaster 使用）
func WriteToConn(conn net.Conn, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	_, err = conn.Write(data)
	return err
}
