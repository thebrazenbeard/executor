package change

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"
)

type fakeAdapter struct {
	target     string
	mu         sync.Mutex
	state      map[string]any
	applyCount int
	blockApply chan struct{}
	after      func()
}

func (f *fakeAdapter) Target() string { return f.target }
func (f *fakeAdapter) ReadCurrent(_ context.Context, _ json.RawMessage) (map[string]any, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[string]any{}
	for k, v := range f.state {
		out[k] = v
	}
	return out, nil
}
func (f *fakeAdapter) Describe(current map[string]any, _ json.RawMessage) (ProposalDescription, error) {
	return ProposalDescription{Proposed: map[string]any{"action": "change"}, SideEffects: []string{"test effect"}, Recovery: "test recovery"}, nil
}
func (f *fakeAdapter) Apply(_ context.Context, _ json.RawMessage) (ApplyOutcome, error) {
	if f.blockApply != nil {
		<-f.blockApply
	}
	f.mu.Lock()
	f.applyCount++
	f.state = map[string]any{"value": "changed"}
	f.mu.Unlock()
	return ApplyOutcome{AfterResponse: f.after}, nil
}
func (f *fakeAdapter) ReadBack(ctx context.Context, args json.RawMessage) (map[string]any, error) {
	return f.ReadCurrent(ctx, args)
}

func TestPrepareApplyBindsGenerationParametersCurrentnessAndReadback(t *testing.T) {
	now := time.Unix(1000, 0)
	engine := NewEngine(5*time.Minute, WithClock(func() time.Time { return now }))
	adapter := &fakeAdapter{target: "test.change", state: map[string]any{"value": "before"}}

	proposal, err := engine.Prepare(context.Background(), 7, adapter, json.RawMessage(`{"b":2,"a":1}`))
	if err != nil {
		t.Fatal(err)
	}
	if proposal.ChangeID == "" || proposal.Target != "test.change" || proposal.Generation != 7 {
		t.Fatalf("proposal=%+v", proposal)
	}
	if proposal.ExpiresAt.Sub(now) != 5*time.Minute {
		t.Fatalf("expires=%v", proposal.ExpiresAt)
	}
	if proposal.ParametersHash == "" {
		t.Fatal("missing parameters hash")
	}
	if proposal.Current["value"] != "before" || proposal.Proposed["action"] != "change" {
		t.Fatalf("proposal=%+v", proposal)
	}

	result, err := engine.Apply(context.Background(), 7, proposal.ChangeID)
	if err != nil {
		t.Fatal(err)
	}
	if result.Observed["value"] != "changed" || !result.Verified {
		t.Fatalf("result=%+v", result)
	}
	if adapter.applyCount != 1 {
		t.Fatalf("applyCount=%d", adapter.applyCount)
	}

	if _, err := engine.Apply(context.Background(), 7, proposal.ChangeID); !errors.Is(err, ErrProposalUsed) {
		t.Fatalf("second apply err=%v", err)
	}
}

func TestProposalExpiresAndRejectsWrongGeneration(t *testing.T) {
	now := time.Unix(1000, 0)
	engine := NewEngine(5*time.Minute, WithClock(func() time.Time { return now }))
	adapter := &fakeAdapter{target: "test.change", state: map[string]any{"value": "before"}}
	p, err := engine.Prepare(context.Background(), 3, adapter, json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := engine.Apply(context.Background(), 4, p.ChangeID); !errors.Is(err, ErrStaleProposal) {
		t.Fatalf("generation err=%v", err)
	}

	p, err = engine.Prepare(context.Background(), 3, adapter, json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(5*time.Minute + time.Nanosecond)
	if _, err := engine.Apply(context.Background(), 3, p.ChangeID); !errors.Is(err, ErrProposalExpired) {
		t.Fatalf("expiry err=%v", err)
	}
}

func TestApplyRejectsStateDriftBeforeMutation(t *testing.T) {
	engine := NewEngine(5 * time.Minute)
	adapter := &fakeAdapter{target: "test.change", state: map[string]any{"value": "before"}}
	p, err := engine.Prepare(context.Background(), 1, adapter, json.RawMessage(`{"x":1}`))
	if err != nil {
		t.Fatal(err)
	}
	adapter.state = map[string]any{"value": "drifted"}
	if _, err := engine.Apply(context.Background(), 1, p.ChangeID); !errors.Is(err, ErrStateChanged) {
		t.Fatalf("err=%v", err)
	}
	if adapter.applyCount != 0 {
		t.Fatalf("mutation occurred after drift")
	}
}

func TestConcurrentDoubleApplyRunsAdapterOnce(t *testing.T) {
	engine := NewEngine(5 * time.Minute)
	gate := make(chan struct{})
	adapter := &fakeAdapter{target: "test.change", state: map[string]any{"value": "before"}, blockApply: gate}
	p, err := engine.Prepare(context.Background(), 1, adapter, json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}

	results := make(chan error, 2)
	go func() { _, err := engine.Apply(context.Background(), 1, p.ChangeID); results <- err }()
	time.Sleep(20 * time.Millisecond)
	go func() { _, err := engine.Apply(context.Background(), 1, p.ChangeID); results <- err }()
	time.Sleep(20 * time.Millisecond)
	close(gate)
	e1, e2 := <-results, <-results
	if (e1 == nil) == (e2 == nil) {
		t.Fatalf("expected one success/one rejection: %v %v", e1, e2)
	}
	var rejected error
	if e1 != nil {
		rejected = e1
	} else {
		rejected = e2
	}
	if !errors.Is(rejected, ErrProposalUsed) {
		t.Fatalf("rejected=%v", rejected)
	}
	if adapter.applyCount != 1 {
		t.Fatalf("applyCount=%d", adapter.applyCount)
	}
}

func TestApplyCarriesAfterResponseWithoutRunningIt(t *testing.T) {
	called := 0
	engine := NewEngine(5 * time.Minute)
	adapter := &fakeAdapter{target: "executor.restart", state: map[string]any{"pid": 1}, after: func() { called++ }}
	p, err := engine.Prepare(context.Background(), 9, adapter, json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	result, err := engine.Apply(context.Background(), 9, p.ChangeID)
	if err != nil {
		t.Fatal(err)
	}
	if result.AfterResponse == nil {
		t.Fatal("missing AfterResponse")
	}
	if result.Verified {
		t.Fatal("deferred restart was reported verified before AfterResponse")
	}
	if !result.PendingVerification {
		t.Fatal("deferred restart did not report pending verification")
	}
	if called != 0 {
		t.Fatal("AfterResponse ran before bridge response")
	}
	result.AfterResponse()
	if called != 1 {
		t.Fatalf("called=%d", called)
	}
}

func TestPendingProposalRegistryIsBoundedAndExpiredEntriesArePruned(t *testing.T) {
	now := time.Unix(1000, 0)
	engine := NewEngine(5*time.Minute, WithClock(func() time.Time { return now }))
	adapter := &fakeAdapter{target: "test.change", state: map[string]any{"value": "before"}}

	for i := 0; i < maxPendingProposals; i++ {
		if _, err := engine.Prepare(context.Background(), 1, adapter, json.RawMessage(`{}`)); err != nil {
			t.Fatalf("prepare %d: %v", i, err)
		}
	}
	if _, err := engine.Prepare(context.Background(), 1, adapter, json.RawMessage(`{}`)); !errors.Is(err, ErrTooManyPendingProposals) {
		t.Fatalf("overflow err=%v", err)
	}

	now = now.Add(5*time.Minute + time.Nanosecond)
	if _, err := engine.Prepare(context.Background(), 1, adapter, json.RawMessage(`{}`)); err != nil {
		t.Fatalf("prepare after expiry pruning: %v", err)
	}
}
