package main

import (
	"context"
	"errors"
	"path/filepath"
	"reflect"
	"testing"
)

type recordedCall struct {
	script string
	args   []string
}

func TestStatusReadsControlPlaneAndActivation(t *testing.T) {
	var calls []recordedCall
	runner := func(_ context.Context, script string, args ...string) ([]byte, error) {
		calls = append(calls, recordedCall{script: filepath.Base(script), args: append([]string(nil), args...)})
		switch filepath.Base(script) {
		case "Get-ExecutorControlPlaneStatus.ps1":
			return []byte(`{"running":true,"connected_devices":1,"tunnel_ready":true,"execution_capacity_per_device":8,"upstream_context_capacity":64}`), nil
		case "Get-ExecutorChatGPTActivationStatus.ps1":
			return []byte(`{"ready_for_chatgpt_activation":true,"mcp_session_verified":true,"tunnel_metadata_verified":true}`), nil
		default:
			return nil, errors.New("unexpected script")
		}
	}

	app := newApp(`C:\Runtime`, `C:\Runtime\Agent\scripts`, runner)
	got, err := app.Status()
	if err != nil { t.Fatal(err) }
	if !got.Running || !got.ChatGPTReady || got.ConnectedDevices != 1 { t.Fatalf("status=%+v", got) }
	if got.ExecutionLanes != 8 || got.LogicLanes != 64 { t.Fatalf("lanes=%+v", got) }
	if len(calls) != 2 { t.Fatalf("calls=%v", calls) }
}

func TestRepairMCPSessionUsesOnlyNarrowRestartThenRefreshes(t *testing.T) {
	var calls []recordedCall
	runner := func(_ context.Context, script string, args ...string) ([]byte, error) {
		name := filepath.Base(script)
		calls = append(calls, recordedCall{script: name, args: append([]string(nil), args...)})
		switch name {
		case "Restart-ExecutorControlPlane.ps1":
			return []byte("EXECUTOR CONTROL PLANE READY"), nil
		case "Get-ExecutorControlPlaneStatus.ps1":
			return []byte(`{"running":true,"connected_devices":1,"tunnel_ready":true,"execution_capacity_per_device":8,"upstream_context_capacity":64}`), nil
		case "Get-ExecutorChatGPTActivationStatus.ps1":
			return []byte(`{"ready_for_chatgpt_activation":true,"mcp_session_verified":true,"tunnel_metadata_verified":true}`), nil
		default:
			return nil, errors.New("unexpected script")
		}
	}

	app := newApp(`C:\Runtime`, `C:\Runtime\Agent\scripts`, runner)
	got, err := app.RepairMCPSession()
	if err != nil { t.Fatal(err) }
	if !got.ChatGPTReady { t.Fatalf("status=%+v", got) }
	want := []string{"Restart-ExecutorControlPlane.ps1", "Get-ExecutorControlPlaneStatus.ps1", "Get-ExecutorChatGPTActivationStatus.ps1"}
	var names []string
	for _, call := range calls { names = append(names, call.script) }
	if !reflect.DeepEqual(names, want) { t.Fatalf("calls=%v want=%v", names, want) }
	for _, call := range calls {
		if call.script == "Restart-ExecutorControlPlane.ps1" && !reflect.DeepEqual(call.args, []string{"-RuntimeRoot", `C:\Runtime`}) {
			t.Fatalf("restart args=%v", call.args)
		}
	}
}

func TestRepairMCPSessionSurfacesRestartFailure(t *testing.T) {
	runner := func(_ context.Context, script string, _ ...string) ([]byte, error) {
		if filepath.Base(script) == "Restart-ExecutorControlPlane.ps1" { return nil, errors.New("restart failed") }
		return nil, errors.New("status should not run")
	}
	app := newApp(`C:\Runtime`, `C:\Runtime\Agent\scripts`, runner)
	if _, err := app.RepairMCPSession(); err == nil { t.Fatal("expected restart failure") }
}
