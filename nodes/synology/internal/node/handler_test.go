package node

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/thebrazenbeard/executor/nodes/synology/internal/protocol"
)

func rpc(method string, id string, params string) protocol.JSONRPC {
	msg := protocol.JSONRPC{JSONRPC: "2.0", Method: method}
	if id != "" { msg.ID = json.RawMessage(id) }
	if params != "" { msg.Params = json.RawMessage(params) }
	return msg
}

func TestHandlerInitializeAndPing(t *testing.T) {
	h := NewHandler("0.1.0")
	initResult, err := h.Handle(context.Background(), rpc("initialize", "1", `{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}`))
	if err != nil { t.Fatal(err) }
	if initResult.AfterResponse != nil { t.Fatal("initialize must not schedule an after-response action") }
	var initBody map[string]any
	if err := json.Unmarshal(initResult.Result.Result, &initBody); err != nil { t.Fatal(err) }
	if initBody["protocolVersion"] != "2025-06-18" { t.Fatalf("unexpected initialize result: %#v", initBody) }
	serverInfo := initBody["serverInfo"].(map[string]any)
	if serverInfo["name"] != "executor-synology-node" || serverInfo["version"] != "0.1.0" {
		t.Fatalf("unexpected serverInfo: %#v", serverInfo)
	}

	ping, err := h.Handle(context.Background(), rpc("ping", "2", ""))
	if err != nil { t.Fatal(err) }
	if ping.Result.Error != nil || string(ping.Result.Result) != "{}" {
		t.Fatalf("unexpected ping: %+v", ping.Result)
	}
}

func TestHandlerListsToolsAndRejectsUnknownTool(t *testing.T) {
	h := NewHandler("0.1.0")
	listed, err := h.Handle(context.Background(), rpc("tools/list", "3", ""))
	if err != nil { t.Fatal(err) }
	var body struct { Tools []protocol.Tool `json:"tools"` }
	if err := json.Unmarshal(listed.Result.Result, &body); err != nil { t.Fatal(err) }
	if len(body.Tools) != 0 { t.Fatalf("expected no registered tools yet, got %#v", body.Tools) }

	called, err := h.Handle(context.Background(), rpc("tools/call", "4", `{"name":"does.not.exist","arguments":{}}`))
	if err != nil { t.Fatal(err) }
	if called.Result.Error == nil || called.Result.Error.Code != -32601 {
		t.Fatalf("expected method-not-found tool error, got %+v", called.Result)
	}
}

func TestInitializedNotificationProducesNoRPCResponse(t *testing.T) {
	h := NewHandler("0.1.0")
	result, err := h.Handle(context.Background(), rpc("notifications/initialized", "", "{}"))
	if err != nil { t.Fatal(err) }
	if !result.NoResponse { t.Fatalf("notification must be marked no-response: %+v", result) }
}
