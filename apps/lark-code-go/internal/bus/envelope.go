package bus

import "encoding/json"

// JSON-RPC 2.0 standard error code constants.
const (
	ParseError     = -32700
	InvalidRequest = -32600
	MethodNotFound = -32601
	InvalidParams  = -32602
	InternalError  = -32603
)

// JsonRpcRequest represents a JSON-RPC 2.0 request sent by the client.
type JsonRpcRequest struct {
	Jsonrpc string          `json:"jsonrpc"`
	ID      string          `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// JsonRpcSuccess represents a successful JSON-RPC 2.0 response returned by the server.
type JsonRpcSuccess struct {
	Jsonrpc string      `json:"jsonrpc"`
	ID      string      `json:"id"`
	Result  interface{} `json:"result"`
}

// JsonRpcErrorObject represents a JSON-RPC 2.0 error object within an error response.
type JsonRpcErrorObject struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

// JsonRpcError represents an error JSON-RPC 2.0 response returned by the server.
type JsonRpcError struct {
	Jsonrpc string             `json:"jsonrpc"`
	ID      string             `json:"id,omitempty"`
	Error   JsonRpcErrorObject `json:"error"`
}

// EventPushEnvelope represents a server-pushed event wrapper delivered to subscribed clients.
type EventPushEnvelope struct {
	Kind  string          `json:"kind"`
	Event json.RawMessage `json:"event"`
}

// MakeSuccess constructs a JSON-RPC 2.0 success response with the given ID and result.
func MakeSuccess(id string, result interface{}) *JsonRpcSuccess {
	return &JsonRpcSuccess{
		Jsonrpc: "2.0",
		ID:      id,
		Result:  result,
	}
}

// MakeError constructs a JSON-RPC 2.0 error response with the given ID, error code, message, and optional data.
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

// MakeEventPush constructs an event push envelope wrapping the given event payload.
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
