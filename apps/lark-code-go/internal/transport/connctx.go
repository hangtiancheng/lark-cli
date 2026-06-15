package transport

import (
	"context"
	"net"
)

type contextKey string

const connContextKey contextKey = "conn"

// ContextWithConn stores a network connection in the given context.
func ContextWithConn(ctx context.Context, conn net.Conn) context.Context {
	return context.WithValue(ctx, connContextKey, conn)
}

// ConnFromContext retrieves the network connection stored in the context.
func ConnFromContext(ctx context.Context) net.Conn {
	conn, _ := ctx.Value(connContextKey).(net.Conn)
	return conn
}
