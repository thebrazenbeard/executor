package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"github.com/thebrazenbeard/executor/nodes/synology/internal/node"
	"github.com/thebrazenbeard/executor/nodes/synology/internal/protocol"
)

type ClientConfig struct {
	ServiceURL    string
	DeviceID      string
	Token         string
	NodeVersion   string
	ReconnectMin  time.Duration
	ReconnectMax  time.Duration
}

type Client struct {
	cfg        ClientConfig
	deviceURL  string
	generation atomic.Int64
	dialer     *websocket.Dialer
}

func NewClient(cfg ClientConfig) (*Client, error) {
	if cfg.DeviceID == "" || cfg.Token == "" {
		return nil, errors.New("device id and token are required")
	}
	u, err := url.Parse(cfg.ServiceURL)
	if err != nil || u.Host == "" {
		return nil, errors.New("invalid Executor service URL")
	}
	switch u.Scheme {
	case "https":
		u.Scheme = "wss"
	case "http":
		u.Scheme = "ws"
	default:
		return nil, errors.New("Executor service URL must use https or http")
	}
	if u.User != nil {
		return nil, errors.New("Executor service URL cannot contain credentials")
	}
	u.Path = "/device"
	u.RawQuery = ""
	u.Fragment = ""
	if cfg.ReconnectMin <= 0 { cfg.ReconnectMin = time.Second }
	if cfg.ReconnectMax <= 0 { cfg.ReconnectMax = 30 * time.Second }
	if cfg.ReconnectMax < cfg.ReconnectMin { cfg.ReconnectMax = cfg.ReconnectMin }
	return &Client{cfg: cfg, deviceURL: u.String(), dialer: websocket.DefaultDialer}, nil
}

func (c *Client) Generation() int {
	return int(c.generation.Load())
}

func (c *Client) Run(ctx context.Context, handler *node.Handler) error {
	delay := c.cfg.ReconnectMin
	for {
		if err := ctx.Err(); err != nil { return err }
		err := c.runOnce(ctx, handler)
		if ctx.Err() != nil { return ctx.Err() }
		_ = err
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
		if delay < c.cfg.ReconnectMax {
			delay *= 2
			if delay > c.cfg.ReconnectMax { delay = c.cfg.ReconnectMax }
		}
	}
}

func (c *Client) runOnce(ctx context.Context, handler *node.Handler) error {
	conn, response, err := c.dialer.DialContext(ctx, c.deviceURL, http.Header{})
	if response != nil && response.Body != nil { _ = response.Body.Close() }
	if err != nil { return fmt.Errorf("connect Executor device ingress: %w", err) }
	defer conn.Close()

	closeOnCancel := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			_ = conn.Close()
		case <-closeOnCancel:
		}
	}()
	defer close(closeOnCancel)

	hello := protocol.Hello{
		Type: "hello",
		DeviceID: c.cfg.DeviceID,
		Token: c.cfg.Token,
		DeviceProfile: protocol.DeviceProfile{
			Kind: "synology-storage",
			Platform: "linux",
			Arch: "armv7",
			PackageArch: "armada38x",
			NodeVersion: c.cfg.NodeVersion,
			ExecutionCapacity: 2,
		},
		InitializeResult: handler.InitializeResult("2025-06-18"),
	}
	if err := conn.WriteJSON(hello); err != nil { return fmt.Errorf("write hello: %w", err) }

	var writeMu sync.Mutex
	sem := make(chan struct{}, 2)
	var wg sync.WaitGroup
	defer wg.Wait()

	for {
		_, data, err := conn.ReadMessage()
		if err != nil { return err }
		var envelope struct{ Type string `json:"type"` }
		if err := json.Unmarshal(data, &envelope); err != nil { continue }
		switch envelope.Type {
		case "ready":
			var ready protocol.Ready
			if err := json.Unmarshal(data, &ready); err != nil { continue }
			if ready.DeviceID == c.cfg.DeviceID && ready.Generation > 0 {
				c.generation.Store(int64(ready.Generation))
			}
		case "request":
			var request protocol.Request
			if err := json.Unmarshal(data, &request); err != nil { continue }
			sem <- struct{}{}
			wg.Add(1)
			go func(req protocol.Request) {
				defer wg.Done()
				defer func(){ <-sem }()
				dispatched, err := handler.Handle(ctx, req.Payload)
				if err != nil {
					dispatched = node.DispatchResult{Result: protocol.JSONRPC{
						JSONRPC:"2.0", ID:req.Payload.ID,
						Error:&protocol.RPCError{Code:-32000, Message:err.Error()},
					}}
				}
				if dispatched.NoResponse { return }
				response := protocol.Response{Type:"response", RequestID:req.RequestID, Payload:dispatched.Result}
				writeMu.Lock()
				err = conn.WriteJSON(response)
				writeMu.Unlock()
				if err == nil && dispatched.AfterResponse != nil {
					dispatched.AfterResponse()
				}
			}(request)
		}
	}
}
