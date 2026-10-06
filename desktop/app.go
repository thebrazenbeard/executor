package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
)

type scriptRunner func(context.Context, string, ...string) ([]byte, error)

type DesktopStatus struct {
	Running            bool   `json:"running"`
	ChatGPTReady       bool   `json:"chatgpt_ready"`
	TunnelReady        bool   `json:"tunnel_ready"`
	MCPSessionVerified bool   `json:"mcp_session_verified"`
	ConnectedDevices   int    `json:"connected_devices"`
	ExecutionLanes     int    `json:"execution_lanes"`
	LogicLanes         int    `json:"logic_lanes"`
	RuntimeRoot        string `json:"runtime_root"`
	LogsPath           string `json:"logs_path"`
}

type controlPlaneStatus struct {
	Running            bool `json:"running"`
	TunnelReady        bool `json:"tunnel_ready"`
	MCPSessionVerified bool `json:"mcp_session_verified"`
	ConnectedDevices   int  `json:"connected_devices"`
	ExecutionLanes     int  `json:"execution_capacity_per_device"`
	LogicLanes         int  `json:"upstream_context_capacity"`
	MCPHealth          struct {
		ConnectedDevices int `json:"connectedDeviceCount"`
		ExecutionLanes   int `json:"executionCapacityPerDevice"`
		LogicLanes       int `json:"upstreamContextCapacity"`
	} `json:"mcp_health"`
}

type activationStatus struct {
	ReadyForChatGPTActivation bool `json:"ready_for_chatgpt_activation"`
	MCPSessionVerified        bool `json:"mcp_session_verified"`
	TunnelMetadataVerified    bool `json:"tunnel_metadata_verified"`
}

type App struct {
	runtimeRoot string
	scriptRoot  string
	run         scriptRunner
}

func defaultRuntimeRoot() string {
	if local := os.Getenv("LOCALAPPDATA"); local != "" {
		return filepath.Join(local, "Executor")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "AppData", "Local", "Executor")
}

func NewApp() *App {
	root := defaultRuntimeRoot()
	return newApp(root, filepath.Join(root, "Agent", "scripts"), runPowerShellScript)
}

func newApp(runtimeRoot, scriptRoot string, run scriptRunner) *App {
	return &App{runtimeRoot: runtimeRoot, scriptRoot: scriptRoot, run: run}
}

func runPowerShellScript(ctx context.Context, script string, args ...string) ([]byte, error) {
	commandArgs := []string{"-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script}
	commandArgs = append(commandArgs, args...)
	cmd := exec.CommandContext(ctx, "powershell.exe", commandArgs...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return out, errors.New(string(bytes.TrimSpace(out)))
	}
	return out, nil
}

func (a *App) readJSON(ctx context.Context, script string, target any) error {
	out, err := a.run(ctx, filepath.Join(a.scriptRoot, script), "-RuntimeRoot", a.runtimeRoot)
	if err != nil {
		return err
	}
	return json.Unmarshal(bytes.TrimSpace(out), target)
}

func (a *App) Status() (DesktopStatus, error) {
	ctx := context.Background()
	var control controlPlaneStatus
	if err := a.readJSON(ctx, "Get-ExecutorControlPlaneStatus.ps1", &control); err != nil {
		return DesktopStatus{}, err
	}
	var activation activationStatus
	if err := a.readJSON(ctx, "Get-ExecutorChatGPTActivationStatus.ps1", &activation); err != nil {
		return DesktopStatus{}, err
	}

	devices := control.MCPHealth.ConnectedDevices
	if devices == 0 {
		devices = control.ConnectedDevices
	}
	execution := control.MCPHealth.ExecutionLanes
	if execution == 0 {
		execution = control.ExecutionLanes
	}
	logic := control.MCPHealth.LogicLanes
	if logic == 0 {
		logic = control.LogicLanes
	}

	return DesktopStatus{
		Running:            control.Running,
		ChatGPTReady:       activation.ReadyForChatGPTActivation,
		TunnelReady:        control.TunnelReady,
		MCPSessionVerified: control.MCPSessionVerified && activation.MCPSessionVerified,
		ConnectedDevices:   devices,
		ExecutionLanes:     execution,
		LogicLanes:         logic,
		RuntimeRoot:        a.runtimeRoot,
		LogsPath:           filepath.Join(a.runtimeRoot, "logs"),
	}, nil
}

func (a *App) RepairMCPSession() (DesktopStatus, error) {
	ctx := context.Background()
	if _, err := a.run(ctx, filepath.Join(a.scriptRoot, "Restart-ExecutorControlPlane.ps1"), "-RuntimeRoot", a.runtimeRoot); err != nil {
		return DesktopStatus{}, err
	}
	return a.Status()
}
