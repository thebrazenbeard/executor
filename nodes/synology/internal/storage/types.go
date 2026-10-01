package storage

import "sync"

type RootConfig struct {
	ID   string
	Path string
	Mode string
}

type RootStatus struct {
	ID     string `json:"id"`
	Path   string `json:"path"`
	Mode   string `json:"mode"`
	Access string `json:"access"`
}

type rootHandle struct {
	cfg    RootConfig
	fd     int
	access string
}

type Manager struct {
	mu     sync.RWMutex
	roots  map[string]*rootHandle
	closed bool
}

type ParentHandle struct {
	fd int
}

func (h *ParentHandle) Close() error {
	if h == nil || h.fd < 0 {
		return nil
	}
	err := closeFD(h.fd)
	h.fd = -1
	return err
}
