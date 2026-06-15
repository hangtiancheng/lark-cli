package transport

import (
	"context"
	"net"
)

type contextKey string

const connContextKey contextKey = "conn"

// ContextWithConn 将连接存入 context
func ContextWithConn(ctx context.Context, conn net.Conn) context.Context {
	return context.WithValue(ctx, connContextKey, conn)
}

// ConnFromContext 从 context 中取出连接
func ConnFromContext(ctx context.Context) net.Conn {
	conn, _ := ctx.Value(connContextKey).(net.Conn)
	return conn
}
