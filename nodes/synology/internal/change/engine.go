package change

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"
)

var (
	ErrProposalUsed    = errors.New("proposal already used")
	ErrStaleProposal   = errors.New("proposal generation is stale")
	ErrProposalExpired = errors.New("proposal expired")
	ErrStateChanged    = errors.New("target state changed after preparation")
)

type Option func(*Engine)
func WithClock(now func()time.Time) Option { return func(e *Engine){ e.now=now } }

type record struct {
	proposal Proposal
	adapter Adapter
	args json.RawMessage
	currentHash string
	used bool
}

type Engine struct {
	mu sync.Mutex
	ttl time.Duration
	now func()time.Time
	pending map[string]*record
	adapters map[string]Adapter
}

func NewEngine(ttl time.Duration, options ...Option)*Engine{
	if ttl<=0 { ttl=5*time.Minute }
	e:=&Engine{ttl:ttl,now:time.Now,pending:map[string]*record{},adapters:map[string]Adapter{}}
	for _,option:=range options{if option!=nil{option(e)}}
	return e
}

func(e *Engine)Register(adapter Adapter){
	if adapter==nil{return}
	e.mu.Lock();defer e.mu.Unlock()
	e.adapters[adapter.Target()]=adapter
}

func(e *Engine)Adapter(target string)(Adapter,bool){
	e.mu.Lock();defer e.mu.Unlock()
	a,ok:=e.adapters[target];return a,ok
}

func normalizeJSON(raw json.RawMessage)(json.RawMessage,error){
	if len(raw)==0||string(raw)=="null"{raw=[]byte("{}")}
	var value any
	if err:=json.Unmarshal(raw,&value);err!=nil{return nil,fmt.Errorf("invalid parameters: %w",err)}
	return json.Marshal(value)
}

func hashJSON(value any)(string,error){
	raw,err:=json.Marshal(value);if err!=nil{return "",err}
	sum:=sha256.Sum256(raw);return hex.EncodeToString(sum[:]),nil
}

func newChangeID()(string,error){
	var value [16]byte
	if _,err:=rand.Read(value[:]);err!=nil{return "",err}
	return hex.EncodeToString(value[:]),nil
}

func(e *Engine)Prepare(ctx context.Context,generation int,adapter Adapter,args json.RawMessage)(Proposal,error){
	if generation<=0{return Proposal{},errors.New("device generation is not ready")}
	if adapter==nil{return Proposal{},errors.New("change adapter is required")}
	normalized,err:=normalizeJSON(args);if err!=nil{return Proposal{},err}
	var normalizedMap any
	if err:=json.Unmarshal(normalized,&normalizedMap);err!=nil{return Proposal{},err}
	parametersHash,err:=hashJSON(normalizedMap);if err!=nil{return Proposal{},err}
	current,err:=adapter.ReadCurrent(ctx,normalized);if err!=nil{return Proposal{},err}
	currentHash,err:=hashJSON(current);if err!=nil{return Proposal{},err}
	description,err:=adapter.Describe(current,normalized);if err!=nil{return Proposal{},err}
	changeID,err:=newChangeID();if err!=nil{return Proposal{},err}
	proposal:=Proposal{
		ChangeID:changeID,Target:adapter.Target(),Current:current,Proposed:description.Proposed,
		SideEffects:description.SideEffects,Recovery:description.Recovery,
		ExpiresAt:e.now().Add(e.ttl),Generation:generation,ParametersHash:parametersHash,
	}
	e.mu.Lock()
	e.pending[changeID]=&record{proposal:proposal,adapter:adapter,args:append(json.RawMessage(nil),normalized...),currentHash:currentHash}
	e.mu.Unlock()
	return proposal,nil
}

func(e *Engine)Apply(ctx context.Context,generation int,changeID string)(ApplyResult,error){
	e.mu.Lock()
	rec:=e.pending[changeID]
	if rec==nil||rec.used{e.mu.Unlock();return ApplyResult{},ErrProposalUsed}
	if generation!=rec.proposal.Generation{
		rec.used=true;e.mu.Unlock();return ApplyResult{},ErrStaleProposal
	}
	if !e.now().Before(rec.proposal.ExpiresAt){
		rec.used=true;e.mu.Unlock();return ApplyResult{},ErrProposalExpired
	}
	rec.used=true
	e.mu.Unlock()

	current,err:=rec.adapter.ReadCurrent(ctx,rec.args);if err!=nil{return ApplyResult{},err}
	currentHash,err:=hashJSON(current);if err!=nil{return ApplyResult{},err}
	if currentHash!=rec.currentHash{return ApplyResult{},ErrStateChanged}

	outcome,err:=rec.adapter.Apply(ctx,rec.args);if err!=nil{return ApplyResult{},err}
	observed,err:=rec.adapter.ReadBack(ctx,rec.args);if err!=nil{return ApplyResult{},err}
	return ApplyResult{
		ChangeID:rec.proposal.ChangeID,Target:rec.proposal.Target,Observed:observed,Verified:true,AfterResponse:outcome.AfterResponse,
	},nil
}
