package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/thebrazenbeard/executor/nodes/synology/internal/bridge"
	"github.com/thebrazenbeard/executor/nodes/synology/internal/config"
	"github.com/thebrazenbeard/executor/nodes/synology/internal/node"
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
	cfg, err := config.Load(configPath)
	if err != nil {
		return err
	}
	token, err := config.LoadToken(cfg.DeviceTokenFile)
	if err != nil {
		return err
	}
	client, err := bridge.NewClient(bridge.ClientConfig{
		ServiceURL: cfg.ExecutorURL,
		DeviceID: cfg.DeviceID,
		Token: token,
		NodeVersion: version,
	})
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return client.Run(ctx, node.NewHandler(version))
}
