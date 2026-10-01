package node

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/thebrazenbeard/executor/nodes/synology/internal/protocol"
)

func (h *Handler) adminTools() []protocol.Tool {
	tools:=[]protocol.Tool{}
	empty := objectSchema(map[string]any{})
	if h.admin!=nil {
		tools=append(tools,
			protocol.Tool{Name:"admin.system_info",Description:"Read DSM/kernel identity and node-health system metrics.",InputSchema:empty},
			protocol.Tool{Name:"admin.storage_info",Description:"Read mounted DSM storage volume information.",InputSchema:empty},
			protocol.Tool{Name:"admin.network_info",Description:"Read DSM network interface state.",InputSchema:empty},
			protocol.Tool{Name:"admin.package_status",Description:"Read installed DSM package metadata available to ExecutorNode.",InputSchema:empty},
			protocol.Tool{Name:"admin.user_group_info",Description:"Read DSM user/group identities without password data.",InputSchema:empty},
			protocol.Tool{Name:"admin.shared_folder_info",Description:"Read visible DSM shared-folder paths without changing permissions.",InputSchema:empty},
			protocol.Tool{Name:"admin.update_info",Description:"Read installed/default DSM version information.",InputSchema:empty},
			protocol.Tool{Name:"admin.executor_status",Description:"Read ExecutorNode version, profile, and configured storage-root access.",InputSchema:empty},
		)
	}
	if h.changes!=nil {
		tools=append(tools,
			protocol.Tool{Name:"admin.prepare_change",Description:"Prepare an immutable, expiring DSM/Executor change proposal for explicit user approval.",InputSchema:objectSchema(map[string]any{
				"target":map[string]any{"type":"string"},
				"parameters":map[string]any{"type":"object"},
			},"target")},
			protocol.Tool{Name:"admin.apply_change",Description:"Apply one previously prepared change ID after explicit user approval.",InputSchema:objectSchema(map[string]any{
				"changeId":map[string]any{"type":"string"},
			},"changeId")},
		)
	}
	return tools
}

func (h *Handler) callAdminTool(id json.RawMessage, name string, raw json.RawMessage) DispatchResult {
	if name=="admin.prepare_change" {
		var args struct {
			Target string `json:"target"`
			Parameters json.RawMessage `json:"parameters"`
		}
		if err:=decodeArgs(raw,&args);err!=nil{return toolError(id,err)}
		adapter,ok:=h.changes.Adapter(args.Target)
		if !ok{return toolError(id,fmt.Errorf("unsupported change target %q",args.Target))}
		generation:=0;if h.generation!=nil{generation=h.generation()}
		proposal,err:=h.changes.Prepare(context.Background(),generation,adapter,args.Parameters)
		if err!=nil{return toolError(id,err)}
		return toolResult(id,map[string]any{"proposal":proposal})
	}
	if name=="admin.apply_change" {
		var args struct{ChangeID string `json:"changeId"`}
		if err:=decodeArgs(raw,&args);err!=nil{return toolError(id,err)}
		generation:=0;if h.generation!=nil{generation=h.generation()}
		applied,err:=h.changes.Apply(context.Background(),generation,args.ChangeID)
		if err!=nil{return toolError(id,err)}
		out:=toolResult(id,map[string]any{"changeId":applied.ChangeID,"target":applied.Target,"observed":applied.Observed,"verified":applied.Verified})
		out.AfterResponse=applied.AfterResponse
		return out
	}
	if h.admin==nil{return rpcError(id,-32601,"unknown tool: "+name)}
	var args struct{}
	if err:=decodeArgs(raw,&args); err!=nil { return toolError(id,err) }
	switch name {
	case "admin.system_info":
		value,err:=h.admin.SystemInfo(); if err!=nil{return toolError(id,err)}
		return toolResult(id,map[string]any{"system":value})
	case "admin.storage_info":
		value,err:=h.admin.StorageInfo(); if err!=nil{return toolError(id,err)}
		return toolResult(id,map[string]any{"storage":value})
	case "admin.network_info":
		value,err:=h.admin.NetworkInfo(); if err!=nil{return toolError(id,err)}
		return toolResult(id,map[string]any{"network":value})
	case "admin.package_status":
		value,err:=h.admin.PackageStatus(); if err!=nil{return toolError(id,err)}
		return toolResult(id,map[string]any{"packages":value.Packages})
	case "admin.user_group_info":
		value,err:=h.admin.UserGroupInfo(); if err!=nil{return toolError(id,err)}
		return toolResult(id,map[string]any{"users":value.Users,"groups":value.Groups})
	case "admin.shared_folder_info":
		value,err:=h.admin.SharedFolderInfo(); if err!=nil{return toolError(id,err)}
		return toolResult(id,map[string]any{"shares":value.Shares})
	case "admin.update_info":
		value,err:=h.admin.UpdateInfo(); if err!=nil{return toolError(id,err)}
		return toolResult(id,map[string]any{"update":value})
	case "admin.executor_status":
		status:=map[string]any{
			"version":h.version,
			"deviceProfile":map[string]any{
				"kind":"synology-storage","platform":"linux","arch":"armv7","packageArch":"armada38x","executionCapacity":2,
			},
		}
		if h.storage!=nil { status["roots"]=h.storage.Roots() }
		return toolResult(id,status)
	default:
		return rpcError(id,-32601,"unknown tool: "+name)
	}
}
