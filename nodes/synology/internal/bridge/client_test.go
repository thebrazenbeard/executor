package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/thebrazenbeard/executor/nodes/synology/internal/node"
	"github.com/thebrazenbeard/executor/nodes/synology/internal/protocol"
)

var upgrader = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}

func TestClientHelloGenerationAndRequestRoundTrip(t *testing.T) {
	helloCh := make(chan protocol.Hello, 1)
	responseCh := make(chan protocol.Response, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil { t.Errorf("upgrade: %v", err); return }
		defer conn.Close()

		var hello protocol.Hello
		if err := conn.ReadJSON(&hello); err != nil { t.Errorf("hello: %v", err); return }
		helloCh <- hello
		if err := conn.WriteJSON(protocol.Ready{Type:"ready", DeviceID:"DS216", Generation:5}); err != nil { t.Errorf("ready: %v", err); return }
		if err := conn.WriteJSON(protocol.Request{
			Type:"request", RequestID:"req-1",
			Payload: protocol.JSONRPC{JSONRPC:"2.0", ID:json.RawMessage("1"), Method:"ping"},
		}); err != nil { t.Errorf("request: %v", err); return }
		var response protocol.Response
		if err := conn.ReadJSON(&response); err != nil { t.Errorf("response: %v", err); return }
		responseCh <- response
	}))
	defer server.Close()

	client, err := NewClient(ClientConfig{
		ServiceURL: server.URL,
		DeviceID: "DS216",
		Token: "device-token",
		NodeVersion: "0.1.0",
		ReconnectMin: 5*time.Millisecond,
		ReconnectMax: 20*time.Millisecond,
	})
	if err != nil { t.Fatal(err) }
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func(){ done <- client.Run(ctx, node.NewHandler("0.1.0")) }()

	select {
	case hello := <-helloCh:
		if hello.Token != "device-token" { t.Fatal("hello token mismatch") }
		p := hello.DeviceProfile
		if p.Kind!="synology-storage" || p.Platform!="linux" || p.Arch!="armv7" || p.PackageArch!="armada38x" || p.ExecutionCapacity!=2 {
			t.Fatalf("unexpected profile: %+v", p)
		}
	case <-time.After(2*time.Second):
		t.Fatal("hello timeout")
	}

	select {
	case response := <-responseCh:
		if response.RequestID!="req-1" || response.Payload.Error!=nil || string(response.Payload.Result)!="{}" {
			t.Fatalf("unexpected response: %+v", response)
		}
	case <-time.After(2*time.Second):
		t.Fatal("response timeout")
	}
	if client.Generation()!=5 { t.Fatalf("generation=%d want 5", client.Generation()) }
	cancel()
	select {
	case err := <-done:
		if err != nil && !errors.Is(err, context.Canceled) { t.Fatalf("Run returned %v", err) }
	case <-time.After(2*time.Second):
		t.Fatal("Run did not stop on context cancellation")
	}
}

func TestClientReconnectsToNewGenerationWithoutReplayingOldRequests(t *testing.T) {
	var connections atomic.Int32
	secondReady := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil { t.Errorf("upgrade: %v", err); return }
		defer conn.Close()
		var hello protocol.Hello
		if err := conn.ReadJSON(&hello); err != nil { return }
		n := connections.Add(1)
		if n == 1 {
			_ = conn.WriteJSON(protocol.Ready{Type:"ready",DeviceID:"DS216",Generation:1})
			_ = conn.WriteJSON(protocol.Request{
				Type:"request",RequestID:"do-not-replay",
				Payload:protocol.JSONRPC{JSONRPC:"2.0",ID:json.RawMessage("9"),Method:"tools/call",Params:json.RawMessage(`{"name":"unknown","arguments":{}}`)},
			})
			_ = conn.Close()
			return
		}
		_ = conn.WriteJSON(protocol.Ready{Type:"ready",DeviceID:"DS216",Generation:2})
		close(secondReady)
		_ = conn.SetReadDeadline(time.Now().Add(100*time.Millisecond))
		var unexpected protocol.Response
		if err := conn.ReadJSON(&unexpected); err == nil {
			t.Errorf("replayed response/request state onto replacement connection: %+v", unexpected)
		}
		<-r.Context().Done()
	}))
	defer server.Close()

	client, err := NewClient(ClientConfig{ServiceURL:server.URL,DeviceID:"DS216",Token:"token",NodeVersion:"0.1.0",ReconnectMin:5*time.Millisecond,ReconnectMax:20*time.Millisecond})
	if err != nil { t.Fatal(err) }
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func(){ done <- client.Run(ctx, node.NewHandler("0.1.0")) }()
	select {
	case <-secondReady:
	case <-time.After(2*time.Second): t.Fatal("reconnect timeout")
	}
	for deadline := time.Now().Add(2*time.Second); client.Generation()!=2 && time.Now().Before(deadline); {
		time.Sleep(5*time.Millisecond)
	}
	if client.Generation()!=2 { t.Fatalf("generation=%d want 2", client.Generation()) }
	cancel()
	select {
	case <-done:
	case <-time.After(2*time.Second): t.Fatal("Run did not stop")
	}
}


func TestClientOnReadyCallbackAndExplicitReconnect(t *testing.T) {
	var connections atomic.Int32
	readyEvents:=make(chan int,4)
	server:=httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
		conn,err:=upgrader.Upgrade(w,r,nil);if err!=nil{return}
		defer conn.Close()
		var hello protocol.Hello
		if err:=conn.ReadJSON(&hello);err!=nil{return}
		n:=int(connections.Add(1))
		if err:=conn.WriteJSON(protocol.Ready{Type:"ready",DeviceID:"DS216",Generation:n});err!=nil{return}
		for{
			if _,_,err:=conn.ReadMessage();err!=nil{return}
		}
	}))
	defer server.Close()
	client,err:=NewClient(ClientConfig{
		ServiceURL:server.URL,DeviceID:"DS216",Token:"token",NodeVersion:"0.1.0",
		ReconnectMin:5*time.Millisecond,ReconnectMax:20*time.Millisecond,
		OnReady:func(generation int){readyEvents<-generation},
	})
	if err!=nil{t.Fatal(err)}
	ctx,cancel:=context.WithCancel(context.Background());defer cancel()
	done:=make(chan error,1);go func(){done<-client.Run(ctx,node.NewHandler("0.1.0"))}()
	select{case g:=<-readyEvents:if g!=1{t.Fatalf("first generation=%d",g)};case<-time.After(2*time.Second):t.Fatal("first ready timeout")}
	client.RequestReconnect()
	select{case g:=<-readyEvents:if g!=2{t.Fatalf("second generation=%d",g)};case<-time.After(2*time.Second):t.Fatal("reconnect ready timeout")}
	cancel()
	select{case<-done:case<-time.After(2*time.Second):t.Fatal("client did not stop")}
}
