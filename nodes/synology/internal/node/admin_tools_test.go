package node

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/thebrazenbeard/executor/nodes/synology/internal/admin"
)

func TestDSMReadToolsAreListedAndCallable(t *testing.T) {
	root:=t.TempDir()
	if err:=os.MkdirAll(filepath.Join(root,"etc"),0700); err!=nil { t.Fatal(err) }
	if err:=os.WriteFile(filepath.Join(root,"etc","VERSION"),[]byte("productversion=\"7.2.2\"\n"),0600); err!=nil { t.Fatal(err) }
	reader:=admin.NewReader(root)
	h:=NewHandler("0.1.0",WithAdmin(reader))

	listed,err:=h.Handle(context.Background(),rpcRequest("1","tools/list",map[string]any{}))
	if err!=nil { t.Fatal(err) }
	var body struct{ Tools []struct{Name string `json:"name"`} `json:"tools"` }
	if err:=json.Unmarshal(listed.Result.Result,&body); err!=nil { t.Fatal(err) }
	want:=map[string]bool{
		"admin.system_info":true,"admin.storage_info":true,"admin.network_info":true,
		"admin.package_status":true,"admin.user_group_info":true,"admin.shared_folder_info":true,
		"admin.update_info":true,"admin.executor_status":true,
	}
	for _,tool:=range body.Tools { delete(want,tool.Name) }
	if len(want)!=0 { t.Fatalf("missing admin tools: %+v",want) }

	got,err:=h.Handle(context.Background(),rpcRequest("2","tools/call",map[string]any{"name":"admin.system_info","arguments":map[string]any{}}))
	if err!=nil { t.Fatal(err) }
	result:=decodeToolResult(t,got)
	if result.IsError { t.Fatalf("system info error: %+v",result) }
	system:=result.StructuredContent["system"].(map[string]any)
	if system["hostname"]!=nil && system["hostname"]!="" { /* fixture hostname intentionally absent */ }

	status,err:=h.Handle(context.Background(),rpcRequest("3","tools/call",map[string]any{"name":"admin.executor_status","arguments":map[string]any{}}))
	if err!=nil { t.Fatal(err) }
	statusResult:=decodeToolResult(t,status)
	if statusResult.IsError { t.Fatalf("status error: %+v",statusResult) }
	if statusResult.StructuredContent["version"]!="0.1.0" { t.Fatalf("status=%+v",statusResult.StructuredContent) }
}
