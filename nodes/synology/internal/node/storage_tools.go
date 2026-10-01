package node

import (
	"encoding/json"
	"fmt"

	"github.com/thebrazenbeard/executor/nodes/synology/internal/protocol"
)

func objectSchema(properties map[string]any, required ...string) map[string]any {
	schema := map[string]any{"type":"object","properties":properties,"additionalProperties":false}
	if len(required) > 0 { schema["required"] = required }
	return schema
}

func (h *Handler) tools() []protocol.Tool {
	tools := []protocol.Tool{}
	if h.storage == nil { return tools }
	tools = append(tools,
		protocol.Tool{Name:"storage.list_roots",Description:"List configured Synology storage roots and effective access.",InputSchema:objectSchema(map[string]any{})},
		protocol.Tool{Name:"storage.list",Description:"List one directory inside a configured storage root.",InputSchema:objectSchema(map[string]any{
			"rootId":map[string]any{"type":"string"},"path":map[string]any{"type":"string"},
		},"rootId")},
		protocol.Tool{Name:"storage.stat",Description:"Inspect one path without following a final symlink.",InputSchema:objectSchema(map[string]any{
			"rootId":map[string]any{"type":"string"},"path":map[string]any{"type":"string"},
		},"rootId","path")},
		protocol.Tool{Name:"storage.read",Description:"Read at most 512 KiB from a regular file.",InputSchema:objectSchema(map[string]any{
			"rootId":map[string]any{"type":"string"},"path":map[string]any{"type":"string"},
			"offset":map[string]any{"type":"integer","minimum":0},
			"length":map[string]any{"type":"integer","minimum":1,"maximum":524288},
			"encoding":map[string]any{"type":"string","enum":[]string{"utf8","base64"}},
		},"rootId","path")},
		protocol.Tool{Name:"storage.write",Description:"Atomically replace one file with at most 512 KiB.",InputSchema:objectSchema(map[string]any{
			"rootId":map[string]any{"type":"string"},"path":map[string]any{"type":"string"},
			"data":map[string]any{"type":"string"},"encoding":map[string]any{"type":"string","enum":[]string{"utf8","base64"}},
		},"rootId","path","data")},
		protocol.Tool{Name:"storage.append",Description:"Append at most 512 KiB to one file; append is non-atomic.",InputSchema:objectSchema(map[string]any{
			"rootId":map[string]any{"type":"string"},"path":map[string]any{"type":"string"},
			"data":map[string]any{"type":"string"},"encoding":map[string]any{"type":"string","enum":[]string{"utf8","base64"}},
		},"rootId","path","data")},
		protocol.Tool{Name:"storage.mkdir",Description:"Create a directory inside a configured root.",InputSchema:objectSchema(map[string]any{
			"rootId":map[string]any{"type":"string"},"path":map[string]any{"type":"string"},
			"recursive":map[string]any{"type":"boolean"},
		},"rootId","path")},
		protocol.Tool{Name:"storage.delete",Description:"Delete a file or directory inside a configured root.",InputSchema:objectSchema(map[string]any{
			"rootId":map[string]any{"type":"string"},"path":map[string]any{"type":"string"},
			"recursive":map[string]any{"type":"boolean"},
		},"rootId","path")},
		protocol.Tool{Name:"storage.copy",Description:"Stream-copy a regular file between configured roots.",InputSchema:objectSchema(map[string]any{
			"sourceRootId":map[string]any{"type":"string"},"sourcePath":map[string]any{"type":"string"},
			"destinationRootId":map[string]any{"type":"string"},"destinationPath":map[string]any{"type":"string"},
			"overwrite":map[string]any{"type":"boolean"},
		},"sourceRootId","sourcePath","destinationRootId","destinationPath")},
		protocol.Tool{Name:"storage.move",Description:"Move a path; same-root rename is atomic, cross-root regular-file move is copy-verify-delete.",InputSchema:objectSchema(map[string]any{
			"sourceRootId":map[string]any{"type":"string"},"sourcePath":map[string]any{"type":"string"},
			"destinationRootId":map[string]any{"type":"string"},"destinationPath":map[string]any{"type":"string"},
			"overwrite":map[string]any{"type":"boolean"},
		},"sourceRootId","sourcePath","destinationRootId","destinationPath")},
		protocol.Tool{Name:"storage.hash",Description:"Compute SHA-256 for a regular file.",InputSchema:objectSchema(map[string]any{
			"rootId":map[string]any{"type":"string"},"path":map[string]any{"type":"string"},
		},"rootId","path")},
		protocol.Tool{Name:"storage.search",Description:"Literal name or content search without following symlinks.",InputSchema:objectSchema(map[string]any{
			"rootId":map[string]any{"type":"string"},"path":map[string]any{"type":"string"},
			"kind":map[string]any{"type":"string","enum":[]string{"name","content"}},"query":map[string]any{"type":"string"},
			"limit":map[string]any{"type":"integer","minimum":1,"maximum":1000},
		},"rootId","kind","query")},
		protocol.Tool{Name:"storage.space",Description:"Report filesystem capacity for a configured root.",InputSchema:objectSchema(map[string]any{
			"rootId":map[string]any{"type":"string"},
		},"rootId")},
	)
	return tools
}

func toolResult(id json.RawMessage, value map[string]any) DispatchResult {
	raw, _ := json.Marshal(value)
	return result(id, protocol.ToolResult{
		Content: []protocol.Content{{Type:"text",Text:string(raw)}},
		StructuredContent:value,
	})
}

func toolError(id json.RawMessage, err error) DispatchResult {
	value := map[string]any{"error":err.Error()}
	raw, _ := json.Marshal(value)
	return result(id, protocol.ToolResult{
		Content: []protocol.Content{{Type:"text",Text:string(raw)}},
		StructuredContent:value,
		IsError:true,
	})
}

func decodeArgs(raw json.RawMessage, out any) error {
	if len(raw) == 0 || string(raw) == "null" { raw = []byte("{}") }
	if err := json.Unmarshal(raw, out); err != nil { return fmt.Errorf("invalid arguments: %w", err) }
	return nil
}

func (h *Handler) callStorageTool(id json.RawMessage, name string, raw json.RawMessage) DispatchResult {
	switch name {
	case "storage.list_roots":
		var args struct{}
		if err := decodeArgs(raw,&args); err != nil { return toolError(id,err) }
		return toolResult(id,map[string]any{"roots":h.storage.Roots()})

	case "storage.list":
		var args struct{ RootID string `json:"rootId"`; Path string `json:"path"` }
		if err := decodeArgs(raw,&args); err != nil { return toolError(id,err) }
		entries, err := h.storage.List(args.RootID,args.Path)
		if err != nil { return toolError(id,err) }
		return toolResult(id,map[string]any{"entries":entries})

	case "storage.stat":
		var args struct{ RootID string `json:"rootId"`; Path string `json:"path"` }
		if err := decodeArgs(raw,&args); err != nil { return toolError(id,err) }
		meta, err := h.storage.Stat(args.RootID,args.Path)
		if err != nil { return toolError(id,err) }
		return toolResult(id,map[string]any{"meta":meta})

	case "storage.read":
		var args struct {
			RootID string `json:"rootId"`
			Path string `json:"path"`
			Offset int64 `json:"offset"`
			Length int `json:"length"`
			Encoding string `json:"encoding"`
		}
		if err := decodeArgs(raw,&args); err != nil { return toolError(id,err) }
		data, meta, err := h.storage.Read(args.RootID,args.Path,args.Offset,args.Length)
		if err != nil { return toolError(id,err) }
		encoded, err := storageEncode(data,args.Encoding)
		if err != nil { return toolError(id,err) }
		return toolResult(id,map[string]any{"data":encoded,"encoding":normalizedEncoding(args.Encoding),"meta":meta})

	case "storage.write":
		var args struct{ RootID, Path, Data, Encoding string; }
		var wire struct {
			RootID string `json:"rootId"`; Path string `json:"path"`; Data string `json:"data"`; Encoding string `json:"encoding"`
		}
		_ = args
		if err := decodeArgs(raw,&wire); err != nil { return toolError(id,err) }
		data, err := storageDecode(wire.Data,wire.Encoding)
		if err != nil { return toolError(id,err) }
		meta, err := h.storage.Write(wire.RootID,wire.Path,data)
		if err != nil { return toolError(id,err) }
		return toolResult(id,map[string]any{"meta":meta,"atomic":true})

	case "storage.append":
		var args struct {
			RootID string `json:"rootId"`; Path string `json:"path"`; Data string `json:"data"`; Encoding string `json:"encoding"`
		}
		if err := decodeArgs(raw,&args); err != nil { return toolError(id,err) }
		data, err := storageDecode(args.Data,args.Encoding)
		if err != nil { return toolError(id,err) }
		if err := h.storage.Append(args.RootID,args.Path,data); err != nil { return toolError(id,err) }
		meta, err := h.storage.Stat(args.RootID,args.Path)
		if err != nil { return toolError(id,err) }
		return toolResult(id,map[string]any{"meta":meta,"atomic":false})

	case "storage.mkdir":
		var args struct { RootID string `json:"rootId"`; Path string `json:"path"`; Recursive bool `json:"recursive"` }
		if err := decodeArgs(raw,&args); err != nil { return toolError(id,err) }
		if err := h.storage.Mkdir(args.RootID,args.Path,args.Recursive); err != nil { return toolError(id,err) }
		meta, err := h.storage.Stat(args.RootID,args.Path)
		if err != nil { return toolError(id,err) }
		return toolResult(id,map[string]any{"meta":meta})

	case "storage.delete":
		var args struct { RootID string `json:"rootId"`; Path string `json:"path"`; Recursive bool `json:"recursive"` }
		if err := decodeArgs(raw,&args); err != nil { return toolError(id,err) }
		if err := h.storage.Delete(args.RootID,args.Path,args.Recursive); err != nil { return toolError(id,err) }
		return toolResult(id,map[string]any{"deleted":true})

	case "storage.copy":
		var args struct {
			SourceRootID string `json:"sourceRootId"`; SourcePath string `json:"sourcePath"`
			DestinationRootID string `json:"destinationRootId"`; DestinationPath string `json:"destinationPath"`
			Overwrite bool `json:"overwrite"`
		}
		if err := decodeArgs(raw,&args); err != nil { return toolError(id,err) }
		meta, err := h.storage.Copy(args.SourceRootID,args.SourcePath,args.DestinationRootID,args.DestinationPath,args.Overwrite)
		if err != nil { return toolError(id,err) }
		return toolResult(id,map[string]any{"meta":meta})

	case "storage.move":
		var args struct {
			SourceRootID string `json:"sourceRootId"`; SourcePath string `json:"sourcePath"`
			DestinationRootID string `json:"destinationRootId"`; DestinationPath string `json:"destinationPath"`
			Overwrite bool `json:"overwrite"`
		}
		if err := decodeArgs(raw,&args); err != nil { return toolError(id,err) }
		moved, err := h.storage.Move(args.SourceRootID,args.SourcePath,args.DestinationRootID,args.DestinationPath,args.Overwrite)
		if err != nil { return toolError(id,err) }
		return toolResult(id,map[string]any{"meta":moved.Meta,"atomic":moved.Atomic})

	case "storage.hash":
		var args struct { RootID string `json:"rootId"`; Path string `json:"path"` }
		if err := decodeArgs(raw,&args); err != nil { return toolError(id,err) }
		sum, err := h.storage.Hash(args.RootID,args.Path)
		if err != nil { return toolError(id,err) }
		return toolResult(id,map[string]any{"algorithm":"sha256","hash":sum})

	case "storage.search":
		var args struct {
			RootID string `json:"rootId"`; Path string `json:"path"`; Kind string `json:"kind"`; Query string `json:"query"`; Limit int `json:"limit"`
		}
		if err := decodeArgs(raw,&args); err != nil { return toolError(id,err) }
		matches, err := h.storage.Search(args.RootID,args.Path,args.Kind,args.Query,args.Limit)
		if err != nil { return toolError(id,err) }
		return toolResult(id,map[string]any{"matches":matches})

	case "storage.space":
		var args struct { RootID string `json:"rootId"` }
		if err := decodeArgs(raw,&args); err != nil { return toolError(id,err) }
		space, err := h.storage.Space(args.RootID)
		if err != nil { return toolError(id,err) }
		return toolResult(id,map[string]any{"space":space})

	default:
		return rpcError(id,-32601,"unknown tool: "+name)
	}
}
