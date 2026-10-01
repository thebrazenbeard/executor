package admin

import (
	"context"
	"encoding/json"
	"errors"
	"os"

	"github.com/thebrazenbeard/executor/nodes/synology/internal/change"
)

type selfActionAdapter struct {
	target string
	describe change.ProposalDescription
	apply func()(func(),error)
}

func(a *selfActionAdapter)Target()string{return a.target}
func(a *selfActionAdapter)ReadCurrent(context.Context,json.RawMessage)(map[string]any,error){
	return map[string]any{"pid":os.Getpid(),"state":"running"},nil
}
func(a *selfActionAdapter)Describe(map[string]any,json.RawMessage)(change.ProposalDescription,error){return a.describe,nil}
func(a *selfActionAdapter)Apply(context.Context,json.RawMessage)(change.ApplyOutcome,error){
	if a.apply==nil{return change.ApplyOutcome{},errors.New("action is unavailable")}
	after,err:=a.apply();if err!=nil{return change.ApplyOutcome{},err}
	return change.ApplyOutcome{AfterResponse:after},nil
}
func(a *selfActionAdapter)ReadBack(context.Context,json.RawMessage)(map[string]any,error){
	return map[string]any{"pid":os.Getpid(),"scheduled":true},nil
}

func NewReconnectAdapter(requestReconnect func()) change.Adapter {
	return &selfActionAdapter{
		target:"executor.reconnect",
		describe:change.ProposalDescription{
			Proposed:map[string]any{"action":"reconnect"},
			SideEffects:[]string{"ExecutorNode device WebSocket disconnects and reconnects; device generation changes."},
			Recovery:"ExecutorNode automatically retries the outbound device connection.",
		},
		apply:func()(func(),error){
			if requestReconnect==nil{return nil,errors.New("reconnect callback unavailable")}
			return func(){requestReconnect()},nil
		},
	}
}

func NewRestartAdapter(coordinator *RestartCoordinator) change.Adapter {
	return &selfActionAdapter{
		target:"executor.restart",
		describe:change.ProposalDescription{
			Proposed:map[string]any{"action":"restart"},
			SideEffects:[]string{"A same-user replacement ExecutorNode process starts and takes over the device connection."},
			Recovery:"If the replacement cannot start or connect, the current process remains active and the replacement is terminated.",
		},
		apply:func()(func(),error){
			if coordinator==nil{return nil,errors.New("restart coordinator unavailable")}
			return coordinator.Prepare()
		},
	}
}
