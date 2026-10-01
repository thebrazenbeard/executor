package node

import (
	"encoding/json"

	"github.com/thebrazenbeard/executor/nodes/synology/internal/protocol"
)

func (h *Handler) adminTools() []protocol.Tool {
	if h.admin == nil { return nil }
	empty := objectSchema(map[string]any{})
	return []protocol.Tool{
		{Name:"admin.system_info",Description:"Read DSM/kernel identity and node-health system metrics.",InputSchema:empty},
		{Name:"admin.storage_info",Description:"Read mounted DSM storage volume information.",InputSchema:empty},
		{Name:"admin.network_info",Description:"Read DSM network interface state.",InputSchema:empty},
		{Name:"admin.package_status",Description:"Read installed DSM package metadata available to ExecutorNode.",InputSchema:empty},
		{Name:"admin.user_group_info",Description:"Read DSM user/group identities without password data.",InputSchema:empty},
		{Name:"admin.shared_folder_info",Description:"Read visible DSM shared-folder paths without changing permissions.",InputSchema:empty},
		{Name:"admin.update_info",Description:"Read installed/default DSM version information.",InputSchema:empty},
		{Name:"admin.executor_status",Description:"Read ExecutorNode version, profile, and configured storage-root access.",InputSchema:empty},
	}
}

func (h *Handler) callAdminTool(id json.RawMessage, name string, raw json.RawMessage) DispatchResult {
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
