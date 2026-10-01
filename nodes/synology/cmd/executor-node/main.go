package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/thebrazenbeard/executor/nodes/synology/internal/admin"
	"github.com/thebrazenbeard/executor/nodes/synology/internal/bridge"
	"github.com/thebrazenbeard/executor/nodes/synology/internal/config"
	"github.com/thebrazenbeard/executor/nodes/synology/internal/change"
	"github.com/thebrazenbeard/executor/nodes/synology/internal/node"
	"github.com/thebrazenbeard/executor/nodes/synology/internal/storage"
)

const version = "0.1.0"

func main() {
	defaultConfig := os.Getenv("EXECUTOR_NODE_CONFIG")
	if defaultConfig == "" {
		defaultConfig = "/var/packages/ExecutorNode/var/config.json"
	}
	configPath := flag.String("config", defaultConfig, "path to ExecutorNode configuration")
	flag.Parse()

	if err := run(*configPath); err != nil {
		fmt.Fprintln(os.Stderr, "ExecutorNode:", err)
		os.Exit(1)
	}
}

func run(configPath string) error {
	restartChild,_:=admin.LoadRestartChildBarrierFromEnv()
	cfg, err := config.Load(configPath)
	if err != nil {
		return err
	}
	token, err := config.LoadToken(cfg.DeviceTokenFile)
	if err != nil {
		return err
	}
	rootConfigs:=make([]storage.RootConfig,0,len(cfg.Roots))
	for _,root:=range cfg.Roots {
		rootConfigs=append(rootConfigs,storage.RootConfig{ID:root.ID,Path:root.Path,Mode:root.Mode})
	}
	storageManager,err:=storage.NewManager(rootConfigs)
	if err!=nil { return err }
	defer storageManager.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	client, err := bridge.NewClient(bridge.ClientConfig{
		ServiceURL: cfg.ExecutorURL,
		DeviceID: cfg.DeviceID,
		Token: token,
		NodeVersion: version,
		OnReady: func(generation int) {
			if restartChild!=nil { _ = restartChild.MarkConnected(generation) }
		},
	})
	if err != nil {
		return err
	}

	executable,err:=os.Executable()
	if err!=nil{return err}
	launcher:=admin.NewOSReplacementLauncher(admin.OSReplacementLauncherConfig{
		Executable:executable,
		Args:append([]string(nil),os.Args[1:]...),
		Env:os.Environ(),
		TempDir:os.TempDir(),
		PollInterval:20*time.Millisecond,
	})
	restartCoordinator:=admin.NewRestartCoordinator(launcher,stop,30*time.Second)
	changes:=change.NewEngine(5*time.Minute)
	changes.Register(admin.NewReconnectAdapter(client.RequestReconnect))
	changes.Register(admin.NewRestartAdapter(restartCoordinator))

	handler:=node.NewHandler(
		version,
		node.WithStorage(storageManager),
		node.WithAdmin(admin.NewReader("/")),
		node.WithChanges(changes),
		node.WithGenerationProvider(client.Generation),
	)

	if restartChild!=nil {
		barrierCtx,cancel:=context.WithTimeout(ctx,30*time.Second)
		err:=restartChild.SignalReadyAndWait(barrierCtx)
		cancel()
		if err!=nil{return err}
	}
	return client.Run(ctx,handler)
}
