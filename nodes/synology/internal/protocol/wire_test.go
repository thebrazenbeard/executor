package protocol

import (
	"encoding/json"
	"testing"
)

func TestSynologyHelloShape(t *testing.T) {
	hello := Hello{
		Type: "hello",
		DeviceID: "DS216",
		Token: "device-token",
		DeviceProfile: DeviceProfile{
			Kind: "synology-storage",
			Platform: "linux",
			Arch: "armv7",
			PackageArch: "armada38x",
			NodeVersion: "0.1.0",
			ExecutionCapacity: 2,
		},
		InitializeResult: map[string]any{
			"protocolVersion": "2025-06-18",
		},
	}
	data, err := json.Marshal(hello)
	if err != nil { t.Fatal(err) }
	var got map[string]any
	if err := json.Unmarshal(data, &got); err != nil { t.Fatal(err) }
	if got["type"] != "hello" || got["deviceId"] != "DS216" {
		t.Fatalf("unexpected hello: %s", data)
	}
	profile := got["deviceProfile"].(map[string]any)
	if profile["kind"] != "synology-storage" || profile["packageArch"] != "armada38x" || profile["executionCapacity"] != float64(2) {
		t.Fatalf("unexpected profile: %#v", profile)
	}
}

func TestReadyCarriesServerGeneration(t *testing.T) {
	var ready Ready
	if err := json.Unmarshal([]byte(`{"type":"ready","deviceId":"DS216","generation":7}`), &ready); err != nil {
		t.Fatal(err)
	}
	if ready.Generation != 7 || ready.DeviceID != "DS216" {
		t.Fatalf("unexpected ready: %+v", ready)
	}
}

func TestJSONRPCPreservesRawParamsAndResult(t *testing.T) {
	raw := []byte(`{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"storage.stat","arguments":{"rootId":"media","path":"x"}}}`)
	var rpc JSONRPC
	if err := json.Unmarshal(raw, &rpc); err != nil { t.Fatal(err) }
	if rpc.JSONRPC != "2.0" || rpc.Method != "tools/call" || rpc.ID == nil || len(rpc.Params) == 0 {
		t.Fatalf("unexpected rpc: %+v", rpc)
	}
}
