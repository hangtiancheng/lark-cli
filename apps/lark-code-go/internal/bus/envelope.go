package bus

import "encoding/json"

// JSON-RPC 2.0 错误码常量
const (
	ParseError     = -32700
	InvalidRequest = -32600
	MethodNotFound = -32601
	InvalidParams  = -32602
	InternalError  = -32603
)

// JsonRpcRequest 表示客户端发送的 JSON-RPC 2.0 请求
type JsonRpcRequest struct {
	Jsonrpc string          `json:"jsonrpc"`
	ID      string          `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// JsonRpcSuccess 表示服务端返回的成功响应
type JsonRpcSuccess struct {
	Jsonrpc string      `json:"jsonrpc"`
	ID      string      `json:"id"`
	Result  interface{} `json:"result"`
}

// JsonRpcErrorObject 表示 JSON-RPC 错误对象
type JsonRpcErrorObject struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

// JsonRpcError 表示服务端返回的错误响应
type JsonRpcError struct {
	Jsonrpc string             `json:"jsonrpc"`
	ID      string             `json:"id,omitempty"`
	Error   JsonRpcErrorObject `json:"error"`
}

// EventPushEnvelope 表示服务端推送的事件信封
type EventPushEnvelope struct {
	Kind  string          `json:"kind"`
	Event json.RawMessage `json:"event"`
}

// MakeSuccess 构造 JSON-RPC 成功响应
func MakeSuccess(id string, result interface{}) *JsonRpcSuccess {
	return &JsonRpcSuccess{
		Jsonrpc: "2.0",
		ID:      id,
		Result:  result,
	}
}

// MakeError 构造 JSON-RPC 错误响应
func MakeError(id string, code int, message string, data interface{}) *JsonRpcError {
	return &JsonRpcError{
		Jsonrpc: "2.0",
		ID:      id,
		Error: JsonRpcErrorObject{
			Code:    code,
			Message: message,
			Data:    data,
		},
	}
}

// MakeEventPush 构造事件推送信封
func MakeEventPush(event interface{}) (*EventPushEnvelope, error) {
	data, err := json.Marshal(event)
	if err != nil {
		return nil, err
	}
	return &EventPushEnvelope{
		Kind:  "event",
		Event: data,
	}, nil
}
