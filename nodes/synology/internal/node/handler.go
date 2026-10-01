package node

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/thebrazenbeard/executor/nodes/synology/internal/admin"
	"github.com/thebrazenbeard/executor/nodes/synology/internal/change"
	"github.com/thebrazenbeard/executor/nodes/synology/internal/protocol"
	"github.com/thebrazenbeard/executor/nodes/synology/internal/storage"
)

type DispatchResult struct {
	Result        protocol.JSONRPC
	AfterResponse func()
	NoResponse    bool
}

type Option func(*Handler)

func WithStorage(manager *storage.Manager) Option {
	return func(h *Handler) { h.storage = manager }
}

func WithAdmin(reader *admin.Reader) Option {
	return func(h *Handler) { h.admin = reader }
}

func WithChanges(engine *change.Engine) Option {
	return func(h *Handler) { h.changes = engine }
}

func WithGenerationProvider(provider func() int) Option {
	return func(h *Handler) { h.generation = provider }
}

type Handler struct {
	version    string
	storage    *storage.Manager
	admin      *admin.Reader
	changes    *change.Engine
	generation func() int
}

func NewHandler(version string, options ...Option) *Handler {
	h := &Handler{version: version}
	for _, option := range options {
		if option != nil { option(h) }
	}
	return h
}

func (h *Handler) InitializeResult(protocolVersion string) map[string]any {
	if protocolVersion == "" {
		protocolVersion = "2025-06-18"
	}
	return map[string]any{
		"protocolVersion": protocolVersion,
		"capabilities": map[string]any{"tools": map[string]any{}},
		"serverInfo": map[string]any{"name": "executor-synology-node", "version": h.version},
	}
}

func result(id json.RawMessage, value any) DispatchResult {
	data, _ := json.Marshal(value)
	return DispatchResult{Result: protocol.JSONRPC{JSONRPC: "2.0", ID: id, Result: data}}
}

func rpcError(id json.RawMessage, code int, message string) DispatchResult {
	return DispatchResult{Result: protocol.JSONRPC{
		JSONRPC: "2.0",
		ID:      id,
		Error:   &protocol.RPCError{Code: code, Message: message},
	}}
}

func (h *Handler) Handle(_ context.Context, request protocol.JSONRPC) (DispatchResult, error) {
	switch request.Method {
	case "notifications/initialized":
		return DispatchResult{NoResponse: true}, nil
	case "initialize":
		var params struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		_ = json.Unmarshal(request.Params, &params)
		if params.ProtocolVersion == "" {
			params.ProtocolVersion = "2025-06-18"
		}
		return result(request.ID, h.InitializeResult(params.ProtocolVersion)), nil
	case "ping":
		return result(request.ID, map[string]any{}), nil
	case "tools/list":
		return result(request.ID, map[string]any{"tools": h.tools()}), nil
	case "tools/call":
		var params struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(request.Params, &params); err != nil {
			return rpcError(request.ID, -32602, "invalid tool arguments"), nil
		}
		if strings.HasPrefix(params.Name, "storage.") && h.storage != nil {
			return h.callStorageTool(request.ID, params.Name, params.Arguments), nil
		}
		if strings.HasPrefix(params.Name, "admin.") && (h.admin != nil || h.changes != nil) {
			return h.callAdminTool(request.ID, params.Name, params.Arguments), nil
		}
		return rpcError(request.ID, -32601, "unknown tool: "+params.Name), nil
	default:
		return rpcError(request.ID, -32601, "method not found"), nil
	}
}
