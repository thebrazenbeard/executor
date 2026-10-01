package change

import (
	"context"
	"encoding/json"
	"time"
)

type ProposalDescription struct {
	Proposed    map[string]any `json:"proposed"`
	SideEffects []string       `json:"sideEffects,omitempty"`
	Recovery    string         `json:"recovery,omitempty"`
}

type ApplyOutcome struct {
	AfterResponse func() `json:"-"`
}

type Adapter interface {
	Target() string
	ReadCurrent(context.Context, json.RawMessage) (map[string]any, error)
	Describe(map[string]any, json.RawMessage) (ProposalDescription, error)
	Apply(context.Context, json.RawMessage) (ApplyOutcome, error)
	ReadBack(context.Context, json.RawMessage) (map[string]any, error)
}

type Proposal struct {
	ChangeID       string         `json:"changeId"`
	Target         string         `json:"target"`
	Current        map[string]any `json:"current"`
	Proposed       map[string]any `json:"proposed"`
	SideEffects    []string       `json:"sideEffects,omitempty"`
	Recovery       string         `json:"recovery,omitempty"`
	ExpiresAt      time.Time      `json:"expiresAt"`
	Generation     int            `json:"generation"`
	ParametersHash string         `json:"parametersHash"`
}

type ApplyResult struct {
	ChangeID            string         `json:"changeId"`
	Target              string         `json:"target"`
	Observed            map[string]any `json:"observed"`
	Verified            bool           `json:"verified"`
	PendingVerification bool           `json:"pendingVerification"`
	AfterResponse       func()         `json:"-"`
}
