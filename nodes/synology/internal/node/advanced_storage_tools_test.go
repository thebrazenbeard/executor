package node

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/thebrazenbeard/executor/nodes/synology/internal/storage"
)

func TestAdvancedStorageToolsAreListedAndCallable(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root,"source.txt"),[]byte("needle"),0600); err != nil { t.Fatal(err) }
	m, err := storage.NewManager([]storage.RootConfig{{ID:"media",Path:root,Mode:"rw"}})
	if err != nil { t.Fatal(err) }
	defer m.Close()
	h := NewHandler("0.1.0",WithStorage(m))

	listed, err := h.Handle(context.Background(),rpcRequest("1","tools/list",map[string]any{}))
	if err != nil { t.Fatal(err) }
	var toolBody struct{ Tools []struct{Name string `json:"name"`} `json:"tools"` }
	if err := json.Unmarshal(listed.Result.Result,&toolBody); err != nil { t.Fatal(err) }
	want := map[string]bool{"storage.copy":true,"storage.move":true,"storage.hash":true,"storage.search":true,"storage.space":true}
	for _, tool := range toolBody.Tools { delete(want,tool.Name) }
	if len(want)!=0 { t.Fatalf("missing advanced tools: %+v",want) }

	copyResult, err := h.Handle(context.Background(),rpcRequest("2","tools/call",map[string]any{
		"name":"storage.copy","arguments":map[string]any{"sourceRootId":"media","sourcePath":"source.txt","destinationRootId":"media","destinationPath":"copy.txt"},
	}))
	if err != nil { t.Fatal(err) }
	if decodeToolResult(t,copyResult).IsError { t.Fatal("copy returned tool error") }

	hashResult, err := h.Handle(context.Background(),rpcRequest("3","tools/call",map[string]any{
		"name":"storage.hash","arguments":map[string]any{"rootId":"media","path":"copy.txt"},
	}))
	if err != nil { t.Fatal(err) }
	if decodeToolResult(t,hashResult).StructuredContent["algorithm"]!="sha256" { t.Fatal("hash algorithm not reported") }
}
