package transport_test

import (
	"context"
	"encoding/json"
	"net"
	"testing"
	"time"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/transport"
)

func freePort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to get free port: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	return port
}

func TestServerClientPingRoundtrip(t *testing.T) {
	port := freePort(t)

	// Start server
	server := transport.NewServer("127.0.0.1", port)
	server.Register("core.ping", func(ctx context.Context, params json.RawMessage) (any, error) {
		return map[string]any{
			"server_version": "0.1.0",
			"uptime_ms":      100,
			"received_at":    time.Now().UTC().Format(time.RFC3339),
		}, nil
	})

	if err := server.Start(); err != nil {
		t.Fatalf("server start failed: %v", err)
	}
	defer server.Stop()

	// Give server time to start
	time.Sleep(50 * time.Millisecond)

	// Connect client
	client := transport.NewClient("127.0.0.1", port)
	if err := client.Connect(); err != nil {
		t.Fatalf("client connect failed: %v", err)
	}
	defer client.Close()

	// Send command
	result, err := client.SendCommand("core.ping", map[string]any{
		"client": "test",
	})
	if err != nil {
		t.Fatalf("send command failed: %v", err)
	}

	// Parse result
	var pong struct {
		ServerVersion string `json:"server_version"`
	}
	if err := json.Unmarshal(result, &pong); err != nil {
		t.Fatalf("unmarshal result failed: %v", err)
	}

	if pong.ServerVersion != "0.1.0" {
		t.Errorf("expected version 0.1.0, got %s", pong.ServerVersion)
	}
}

func TestServerMethodNotFound(t *testing.T) {
	port := freePort(t)

	server := transport.NewServer("127.0.0.1", port)
	if err := server.Start(); err != nil {
		t.Fatalf("server start failed: %v", err)
	}
	defer server.Stop()

	time.Sleep(50 * time.Millisecond)

	client := transport.NewClient("127.0.0.1", port)
	if err := client.Connect(); err != nil {
		t.Fatalf("client connect failed: %v", err)
	}
	defer client.Close()

	_, err := client.SendCommand("nonexistent.method", nil)
	if err == nil {
		t.Error("expected error for unknown method")
	}
}

func TestServerHandlerError(t *testing.T) {
	port := freePort(t)

	server := transport.NewServer("127.0.0.1", port)
	server.Register("test.error", func(ctx context.Context, params json.RawMessage) (any, error) {
		return nil, transport.NewHandlerError(-32001, "custom error")
	})

	if err := server.Start(); err != nil {
		t.Fatalf("server start failed: %v", err)
	}
	defer server.Stop()

	time.Sleep(50 * time.Millisecond)

	client := transport.NewClient("127.0.0.1", port)
	if err := client.Connect(); err != nil {
		t.Fatalf("client connect failed: %v", err)
	}
	defer client.Close()

	_, err := client.SendCommand("test.error", nil)
	if err == nil {
		t.Error("expected error from handler")
	}
}

func TestClientDisconnect(t *testing.T) {
	port := freePort(t)

	server := transport.NewServer("127.0.0.1", port)
	if err := server.Start(); err != nil {
		t.Fatalf("server start failed: %v", err)
	}
	defer server.Stop()

	time.Sleep(50 * time.Millisecond)

	client := transport.NewClient("127.0.0.1", port)
	if err := client.Connect(); err != nil {
		t.Fatalf("client connect failed: %v", err)
	}

	// Close the client
	client.Close()

	// WaitForDisconnect should resolve
	select {
	case <-client.WaitForDisconnect():
		// OK
	case <-time.After(time.Second):
		t.Error("WaitForDisconnect timed out")
	}
}
