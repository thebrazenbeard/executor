//go:build linux

package storage

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path"
	"strings"

	"golang.org/x/sys/unix"
)

func closeFD(fd int) error {
	return unix.Close(fd)
}

func openAbsoluteDirNoFollow(abs string) (int, error) {
	clean := path.Clean(abs)
	if !strings.HasPrefix(clean, "/") {
		return -1, errors.New("root path must be absolute")
	}

	current, err := unix.Open("/", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
	if err != nil {
		return -1, err
	}
	if clean == "/" {
		return current, nil
	}

	for _, component := range strings.Split(strings.TrimPrefix(clean, "/"), "/") {
		if component == "" || component == "." || component == ".." {
			_ = unix.Close(current)
			return -1, fmt.Errorf("unsafe configured root component %q", component)
		}
		next, openErr := unix.Openat(current, component, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
		_ = unix.Close(current)
		if openErr != nil {
			return -1, openErr
		}
		current = next
	}
	return current, nil
}

func NewManager(configs []RootConfig) (*Manager, error) {
	m := &Manager{roots: make(map[string]*rootHandle, len(configs))}
	for _, cfg := range configs {
		if cfg.ID == "" {
			_ = m.Close()
			return nil, errors.New("root id is required")
		}
		if _, exists := m.roots[cfg.ID]; exists {
			_ = m.Close()
			return nil, fmt.Errorf("duplicate root id %q", cfg.ID)
		}
		if cfg.Mode != "rw" && cfg.Mode != "ro" {
			_ = m.Close()
			return nil, fmt.Errorf("root %q mode must be rw or ro", cfg.ID)
		}

		handle := &rootHandle{cfg: cfg, fd: -1, access: "unavailable"}
		fd, err := openAbsoluteDirNoFollow(cfg.Path)
		if err == nil {
			handle.fd = fd
			handle.access = "read-only"
			if cfg.Mode == "rw" && probeWritable(fd) {
				handle.access = "writable"
			}
		}
		m.roots[cfg.ID] = handle
	}
	return m, nil
}

func probeWritable(dirFD int) bool {
	var random [8]byte
	if _, err := rand.Read(random[:]); err != nil {
		return false
	}
	name := ".executor-write-probe-" + hex.EncodeToString(random[:])
	fd, err := unix.Openat(dirFD, name, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0o600)
	if err != nil {
		return false
	}
	_ = unix.Close(fd)
	_ = unix.Unlinkat(dirFD, name, 0)
	return true
}

func (m *Manager) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return nil
	}
	m.closed = true
	var first error
	for _, root := range m.roots {
		if root.fd >= 0 {
			if err := unix.Close(root.fd); err != nil && first == nil {
				first = err
			}
			root.fd = -1
		}
	}
	return first
}

func (m *Manager) Roots() []RootStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()
	statuses := make([]RootStatus, 0, len(m.roots))
	for _, root := range m.roots {
		statuses = append(statuses, RootStatus{
			ID: root.cfg.ID, Path: root.cfg.Path, Mode: root.cfg.Mode, Access: root.access,
		})
	}
	return statuses
}

func (m *Manager) root(id string, requireWritable bool) (*rootHandle, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.closed {
		return nil, errors.New("storage manager is closed")
	}
	root := m.roots[id]
	if root == nil {
		return nil, fmt.Errorf("unknown root %q", id)
	}
	if root.fd < 0 || root.access == "unavailable" {
		return nil, fmt.Errorf("root %q is unavailable", id)
	}
	if requireWritable && root.access != "writable" {
		return nil, fmt.Errorf("root %q is read-only", id)
	}
	return root, nil
}

func splitRelative(rel string) ([]string, error) {
	if rel == "" {
		return nil, errors.New("path is required")
	}
	if strings.IndexByte(rel, 0) >= 0 {
		return nil, errors.New("path contains NUL")
	}
	if strings.HasPrefix(rel, "/") || path.IsAbs(rel) {
		return nil, errors.New("absolute paths are not allowed")
	}
	raw := strings.Split(rel, "/")
	if len(raw) == 0 {
		return nil, errors.New("path is required")
	}
	for i, part := range raw {
		if part == "" || part == "." || part == ".." {
			return nil, fmt.Errorf("unsafe path component %q", part)
		}
		if i == 0 && strings.HasPrefix(part, "@") {
			return nil, errors.New("DSM internal @ paths are not allowed")
		}
	}
	return raw, nil
}

func dupDir(fd int) (int, error) {
	return unix.Openat(fd, ".", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
}

func walkDir(rootFD int, components []string) (int, error) {
	current, err := dupDir(rootFD)
	if err != nil {
		return -1, err
	}
	for _, component := range components {
		next, openErr := unix.Openat(current, component, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
		_ = unix.Close(current)
		if openErr != nil {
			return -1, openErr
		}
		current = next
	}
	return current, nil
}

func (m *Manager) OpenRead(rootID, rel string) (*os.File, error) {
	root, err := m.root(rootID, false)
	if err != nil {
		return nil, err
	}
	parts, err := splitRelative(rel)
	if err != nil {
		return nil, err
	}
	parentFD, err := walkDir(root.fd, parts[:len(parts)-1])
	if err != nil {
		return nil, err
	}
	defer unix.Close(parentFD)

	fd, err := unix.Openat(parentFD, parts[len(parts)-1], unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(fd), parts[len(parts)-1]), nil
}

func (m *Manager) OpenParent(rootID, rel string) (*ParentHandle, string, error) {
	root, err := m.root(rootID, true)
	if err != nil {
		return nil, "", err
	}
	parts, err := splitRelative(rel)
	if err != nil {
		return nil, "", err
	}
	parentFD, err := walkDir(root.fd, parts[:len(parts)-1])
	if err != nil {
		return nil, "", err
	}
	return &ParentHandle{fd: parentFD}, parts[len(parts)-1], nil
}
