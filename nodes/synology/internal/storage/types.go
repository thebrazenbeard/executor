package storage

import ("sync"
"time")

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


const MaxTransferBytes = 512 * 1024

type FileMeta struct {
	Name    string    `json:"name"`
	Kind    string    `json:"kind"`
	Size    int64     `json:"size"`
	Mode    uint32    `json:"mode"`
	ModTime time.Time `json:"modTime"`
}

type Entry = FileMeta


const StreamingBufferBytes = 1024 * 1024
const RecursiveContentSearchMaxBytes int64 = 16 * 1024 * 1024

type MoveResult struct {
	Meta   FileMeta `json:"meta"`
	Atomic bool     `json:"atomic"`
}

type SearchResult struct {
	Path string `json:"path"`
	Kind string `json:"kind"`
	Size int64  `json:"size"`
}

type SpaceInfo struct {
	TotalBytes     uint64 `json:"totalBytes"`
	FreeBytes      uint64 `json:"freeBytes"`
	AvailableBytes uint64 `json:"availableBytes"`
}
