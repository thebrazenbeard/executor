package node

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/thebrazenbeard/executor/nodes/synology/internal/protocol"
	"github.com/thebrazenbeard/executor/nodes/synology/internal/storage"
)

func rpcRequest(id, method string, params any) protocol.JSONRPC {
	rawID, _ := json.Marshal(id)
	rawParams, _ := json.Marshal(params)
	return protocol.JSONRPC{JSONRPC:"2.0", ID:rawID, Method:method, Params:rawParams}
}

func decodeToolResult(t *testing.T, dispatched DispatchResult) protocol.ToolResult {
	t.Helper()
	if dispatched.Result.Error != nil { t.Fatalf("rpc error: %+v", dispatched.Result.Error) }
	var result protocol.ToolResult
	if err := json.Unmarshal(dispatched.Result.Result, &result); err != nil { t.Fatal(err) }
	return result
}

func TestStorageToolsAreListedAndCallable(t *testing.T) {
	root := t.TempDir()
	m, err := storage.NewManager([]storage.RootConfig{{ID:"media",Path:root,Mode:"rw"}})
	if err != nil { t.Fatal(err) }
	defer m.Close()
	h := NewHandler("0.1.0", WithStorage(m))

	listed, err := h.Handle(context.Background(), rpcRequest("1", "tools/list", map[string]any{}))
	if err != nil { t.Fatal(err) }
	var body struct{ Tools []protocol.Tool `json:"tools"` }
	if err := json.Unmarshal(listed.Result.Result, &body); err != nil { t.Fatal(err) }
	want := map[string]bool{
		"storage.list_roots":true,"storage.list":true,"storage.stat":true,"storage.read":true,
		"storage.write":true,"storage.append":true,"storage.mkdir":true,"storage.delete":true,
	}
	for _, tool := range body.Tools { delete(want, tool.Name) }
	if len(want) != 0 { t.Fatalf("missing tools: %+v", want) }

	write, err := h.Handle(context.Background(), rpcRequest("2", "tools/call", map[string]any{
		"name":"storage.write",
		"arguments":map[string]any{"rootId":"media","path":"hello.txt","data":"hello","encoding":"utf8"},
	}))
	if err != nil { t.Fatal(err) }
	writeResult := decodeToolResult(t, write)
	if writeResult.IsError { t.Fatalf("write error: %+v", writeResult) }

	read, err := h.Handle(context.Background(), rpcRequest("3", "tools/call", map[string]any{
		"name":"storage.read",
		"arguments":map[string]any{"rootId":"media","path":"hello.txt","encoding":"utf8"},
	}))
	if err != nil { t.Fatal(err) }
	readResult := decodeToolResult(t, read)
	if readResult.StructuredContent["data"] != "hello" { t.Fatalf("read=%+v", readResult.StructuredContent) }

	roots, err := h.Handle(context.Background(), rpcRequest("4", "tools/call", map[string]any{
		"name":"storage.list_roots","arguments":map[string]any{},
	}))
	if err != nil { t.Fatal(err) }
	rootsResult := decodeToolResult(t, roots)
	if rootsResult.IsError { t.Fatalf("roots error: %+v", rootsResult) }
}

func TestStorageToolErrorsAreToolErrorsNotBridgeFailures(t *testing.T) {
	root := t.TempDir()
	m, err := storage.NewManager([]storage.RootConfig{{ID:"media",Path:root,Mode:"rw"}})
	if err != nil { t.Fatal(err) }
	defer m.Close()
	h := NewHandler("0.1.0", WithStorage(m))

	got, err := h.Handle(context.Background(), rpcRequest("1", "tools/call", map[string]any{
		"name":"storage.read","arguments":map[string]any{"rootId":"media","path":"missing.txt"},
	}))
	if err != nil { t.Fatal(err) }
	result := decodeToolResult(t, got)
	if !result.IsError { t.Fatalf("expected MCP tool error: %+v", result) }
}
