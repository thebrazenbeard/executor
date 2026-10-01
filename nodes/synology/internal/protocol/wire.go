package protocol

import "encoding/json"

type DeviceProfile struct {
	Kind              string `json:"kind"`
	Platform          string `json:"platform,omitempty"`
	Arch              string `json:"arch,omitempty"`
	PackageArch       string `json:"packageArch,omitempty"`
	NodeVersion       string `json:"nodeVersion,omitempty"`
	ExecutionCapacity int    `json:"executionCapacity,omitempty"`
}

type Hello struct {
	Type             string         `json:"type"`
	DeviceID         string         `json:"deviceId"`
	Token            string         `json:"token"`
	DeviceProfile    DeviceProfile  `json:"deviceProfile"`
	InitializeResult map[string]any `json:"initializeResult,omitempty"`
}

type Ready struct {
	Type       string `json:"type"`
	DeviceID   string `json:"deviceId"`
	Generation int    `json:"generation"`
}

type Request struct {
	Type      string  `json:"type"`
	RequestID string  `json:"requestId"`
	Payload   JSONRPC `json:"payload"`
}

type Response struct {
	Type      string  `json:"type"`
	RequestID string  `json:"requestId"`
	Payload   JSONRPC `json:"payload"`
}

type RPCError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

type JSONRPC struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *RPCError       `json:"error,omitempty"`
}


type Tool struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	InputSchema map[string]any `json:"inputSchema"`
}

type Content struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

type ToolResult struct {
	Content           []Content      `json:"content,omitempty"`
	StructuredContent map[string]any `json:"structuredContent,omitempty"`
	IsError           bool           `json:"isError,omitempty"`
}
