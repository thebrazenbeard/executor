package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()
	if err := wails.Run(&options.App{
		Title: "Executor Desktop",
		Width: 1040,
		Height: 720,
		MinWidth: 760,
		MinHeight: 520,
		AssetServer: &assetserver.Options{Assets: assets},
		Bind: []interface{}{app},
	}); err != nil {
		log.Fatal(err)
	}
}
