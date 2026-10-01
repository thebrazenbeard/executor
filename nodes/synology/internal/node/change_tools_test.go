package node

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/thebrazenbeard/executor/nodes/synology/internal/change"
)

type nodeFakeAdapter struct{afterCount int}
func(a *nodeFakeAdapter)Target()string{return "executor.restart"}
func(a *nodeFakeAdapter)ReadCurrent(context.Context,json.RawMessage)(map[string]any,error){return map[string]any{"pid":1},nil}
func(a *nodeFakeAdapter)Describe(map[string]any,json.RawMessage)(change.ProposalDescription,error){return change.ProposalDescription{Proposed:map[string]any{"action":"restart"},SideEffects:[]string{"ExecutorNode reconnects"}},nil}
func(a *nodeFakeAdapter)Apply(context.Context,json.RawMessage)(change.ApplyOutcome,error){return change.ApplyOutcome{AfterResponse:func(){a.afterCount++}},nil}
func(a *nodeFakeAdapter)ReadBack(context.Context,json.RawMessage)(map[string]any,error){return map[string]any{"scheduled":true},nil}

func TestAdminChangeToolsPrepareThenApplyAtCurrentGeneration(t *testing.T){
	adapter:=&nodeFakeAdapter{}
	engine:=change.NewEngine(5*time.Minute)
	engine.Register(adapter)
	generation:=12
	h:=NewHandler("0.1.0",WithChanges(engine),WithGenerationProvider(func()int{return generation}))

	prepared,err:=h.Handle(context.Background(),rpcRequest("1","tools/call",map[string]any{
		"name":"admin.prepare_change","arguments":map[string]any{"target":"executor.restart","parameters":map[string]any{}},
	}))
	if err!=nil{t.Fatal(err)}
	pResult:=decodeToolResult(t,prepared)
	if pResult.IsError{t.Fatalf("prepare error: %+v",pResult)}
	proposal:=pResult.StructuredContent["proposal"].(map[string]any)
	changeID:=proposal["changeId"].(string)

	applied,err:=h.Handle(context.Background(),rpcRequest("2","tools/call",map[string]any{
		"name":"admin.apply_change","arguments":map[string]any{"changeId":changeID},
	}))
	if err!=nil{t.Fatal(err)}
	aResult:=decodeToolResult(t,applied)
	if aResult.IsError{t.Fatalf("apply error: %+v",aResult)}
	if applied.AfterResponse==nil{t.Fatal("restart AfterResponse was dropped")}
	if adapter.afterCount!=0{t.Fatal("restart ran before response")}
	applied.AfterResponse()
	if adapter.afterCount!=1{t.Fatalf("afterCount=%d",adapter.afterCount)}
}

func TestPreparedChangeIsStaleAfterReconnectGenerationChanges(t *testing.T){
	adapter:=&nodeFakeAdapter{}
	engine:=change.NewEngine(5*time.Minute);engine.Register(adapter)
	generation:=4
	h:=NewHandler("0.1.0",WithChanges(engine),WithGenerationProvider(func()int{return generation}))
	prepared,_:=h.Handle(context.Background(),rpcRequest("1","tools/call",map[string]any{
		"name":"admin.prepare_change","arguments":map[string]any{"target":"executor.restart","parameters":map[string]any{}},
	}))
	p:=decodeToolResult(t,prepared).StructuredContent["proposal"].(map[string]any)
	generation=5
	applied,_:=h.Handle(context.Background(),rpcRequest("2","tools/call",map[string]any{
		"name":"admin.apply_change","arguments":map[string]any{"changeId":p["changeId"]},
	}))
	if !decodeToolResult(t,applied).IsError{t.Fatal("stale proposal applied after generation change")}
}
