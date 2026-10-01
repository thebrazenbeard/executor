//go:build linux

package storage

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"strings"

	"golang.org/x/sys/unix"
)

func checkDestination(parentFD int, leaf string, overwrite bool) error {
	st, err := statAt(parentFD, leaf)
	if err != nil {
		if errors.Is(err, unix.ENOENT) { return nil }
		return err
	}
	switch st.Mode & unix.S_IFMT {
	case unix.S_IFLNK:
		return errors.New("destination symlink is not allowed")
	case unix.S_IFDIR:
		return errors.New("destination is a directory")
	}
	if !overwrite { return errors.New("destination already exists") }
	return nil
}

func streamFile(dstFD int, src *os.File) (int64, error) {
	buf := make([]byte, StreamingBufferBytes)
	var total int64
	for {
		n, readErr := src.Read(buf)
		if n > 0 {
			if err := writeAllFD(dstFD, buf[:n]); err != nil { return total, err }
			total += int64(n)
		}
		if readErr == io.EOF { return total, nil }
		if readErr != nil { return total, readErr }
	}
}

func (m *Manager) copyRegular(srcRoot, srcRel, dstRoot, dstRel string, overwrite bool) (FileMeta, error) {
	src, err := m.OpenRead(srcRoot, srcRel)
	if err != nil { return FileMeta{}, err }
	defer src.Close()
	info, err := src.Stat()
	if err != nil { return FileMeta{}, err }
	if !info.Mode().IsRegular() { return FileMeta{}, errors.New("copy source is not a regular file") }

	parent, leaf, err := m.OpenParent(dstRoot, dstRel)
	if err != nil { return FileMeta{}, err }
	defer parent.Close()
	if err := checkDestination(parent.fd, leaf, overwrite); err != nil { return FileMeta{}, err }

	var random [8]byte
	if _, err := randRead(random[:]); err != nil { return FileMeta{}, err }
	tmp := ".executor-copy-" + encodeHex(random[:])
	fd, err := unix.Openat(parent.fd, tmp, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0o600)
	if err != nil { return FileMeta{}, err }
	cleanup := true
	defer func() {
		if fd >= 0 { _ = unix.Close(fd) }
		if cleanup { _ = unix.Unlinkat(parent.fd, tmp, 0) }
	}()

	written, err := streamFile(fd, src)
	if err != nil { return FileMeta{}, err }
	if written != info.Size() { return FileMeta{}, fmt.Errorf("copy size mismatch: wrote %d expected %d", written, info.Size()) }
	if err := unix.Fsync(fd); err != nil { return FileMeta{}, err }
	if err := unix.Close(fd); err != nil { fd = -1; return FileMeta{}, err }
	fd = -1

	if err := unix.Renameat(parent.fd, tmp, parent.fd, leaf); err != nil { return FileMeta{}, err }
	cleanup = false
	_ = unix.Fsync(parent.fd)
	st, err := statAt(parent.fd, leaf)
	if err != nil { return FileMeta{}, err }
	return metaFromStat(leaf, st), nil
}

func (m *Manager) Copy(srcRoot, srcRel, dstRoot, dstRel string, overwrite bool) (FileMeta, error) {
	meta, err := m.Stat(srcRoot, srcRel)
	if err != nil { return FileMeta{}, err }
	if meta.Kind == "symlink" { return FileMeta{}, errors.New("copy source symlink is not allowed") }
	if meta.Kind != "file" { return FileMeta{}, errors.New("V1 copy supports regular files only") }
	return m.copyRegular(srcRoot, srcRel, dstRoot, dstRel, overwrite)
}

func (m *Manager) Move(srcRoot, srcRel, dstRoot, dstRel string, overwrite bool) (MoveResult, error) {
	meta, err := m.Stat(srcRoot, srcRel)
	if err != nil { return MoveResult{}, err }
	if meta.Kind == "symlink" { return MoveResult{}, errors.New("move source symlink is not allowed") }

	if srcRoot == dstRoot {
		srcParent, srcLeaf, err := m.OpenParent(srcRoot, srcRel)
		if err != nil { return MoveResult{}, err }
		defer srcParent.Close()
		dstParent, dstLeaf, err := m.OpenParent(dstRoot, dstRel)
		if err != nil { return MoveResult{}, err }
		defer dstParent.Close()
		if err := checkDestination(dstParent.fd, dstLeaf, overwrite); err != nil { return MoveResult{}, err }
		if err := unix.Renameat(srcParent.fd, srcLeaf, dstParent.fd, dstLeaf); err != nil { return MoveResult{}, err }
		_ = unix.Fsync(srcParent.fd)
		_ = unix.Fsync(dstParent.fd)
		moved, err := m.Stat(dstRoot, dstRel)
		if err != nil { return MoveResult{}, err }
		return MoveResult{Meta:moved,Atomic:true}, nil
	}

	if meta.Kind != "file" { return MoveResult{}, errors.New("V1 cross-root move supports regular files only") }
	copied, err := m.copyRegular(srcRoot, srcRel, dstRoot, dstRel, overwrite)
	if err != nil { return MoveResult{}, err }
	if copied.Size != meta.Size {
		_ = m.Delete(dstRoot, dstRel, false)
		return MoveResult{}, errors.New("cross-root move verification failed")
	}
	if err := m.Delete(srcRoot, srcRel, false); err != nil {
		return MoveResult{}, fmt.Errorf("destination copied but source delete failed: %w", err)
	}
	return MoveResult{Meta:copied,Atomic:false}, nil
}

func (m *Manager) Hash(rootID, rel string) (string, error) {
	file, err := m.OpenRead(rootID, rel)
	if err != nil { return "", err }
	defer file.Close()
	info, err := file.Stat()
	if err != nil { return "", err }
	if !info.Mode().IsRegular() { return "", errors.New("hash target is not a regular file") }

	h := sha256.New()
	buf := make([]byte, StreamingBufferBytes)
	if _, err := io.CopyBuffer(h, file, buf); err != nil { return "", err }
	return hex.EncodeToString(h.Sum(nil)), nil
}

func (m *Manager) Space(rootID string) (SpaceInfo, error) {
	root, err := m.root(rootID, false)
	if err != nil { return SpaceInfo{}, err }
	var st unix.Statfs_t
	if err := unix.Fstatfs(root.fd, &st); err != nil { return SpaceInfo{}, err }
	blockSize := uint64(st.Bsize)
	return SpaceInfo{
		TotalBytes:uint64(st.Blocks)*blockSize,
		FreeBytes:uint64(st.Bfree)*blockSize,
		AvailableBytes:uint64(st.Bavail)*blockSize,
	}, nil
}

func contentContains(file *os.File, needle []byte) (bool, error) {
	if len(needle) == 0 { return false, errors.New("search query is required") }
	if len(needle) > MaxTransferBytes { return false, errors.New("search query is too large") }
	buf := make([]byte, StreamingBufferBytes)
	overlap := make([]byte, 0, len(needle)-1)
	for {
		n, err := file.Read(buf)
		if n > 0 {
			window := make([]byte, 0, len(overlap)+n)
			window = append(window, overlap...)
			window = append(window, buf[:n]...)
			if bytes.Contains(window, needle) { return true, nil }
			keep := len(needle)-1
			if keep > len(window) { keep = len(window) }
			overlap = append(overlap[:0], window[len(window)-keep:]...)
		}
		if err == io.EOF { return false, nil }
		if err != nil { return false, err }
	}
}

func (m *Manager) fileContains(rootID, rel, query string) (bool, error) {
	file, err := m.OpenRead(rootID, rel)
	if err != nil { return false, err }
	defer file.Close()
	return contentContains(file, []byte(query))
}

func normalizeSearchLimit(limit int) (int, error) {
	if limit <= 0 { return 100, nil }
	if limit > 1000 { return 0, errors.New("search limit cannot exceed 1000") }
	return limit, nil
}

func (m *Manager) Search(rootID, base, kind, query string, limit int) ([]SearchResult, error) {
	if query == "" { return nil, errors.New("search query is required") }
	limit, err := normalizeSearchLimit(limit)
	if err != nil { return nil, err }
	if kind != "name" && kind != "content" { return nil, errors.New("search kind must be name or content") }

	var out []SearchResult
	add := func(rel string, meta FileMeta) bool {
		out = append(out, SearchResult{Path:rel,Kind:meta.Kind,Size:meta.Size})
		return len(out) >= limit
	}

	if base != "" {
		meta, err := m.Stat(rootID, base)
		if err != nil { return nil, err }
		if meta.Kind == "symlink" { return nil, errors.New("search base symlink is not allowed") }
		if meta.Kind == "file" {
			if kind == "name" {
				if strings.Contains(strings.ToLower(path.Base(base)), strings.ToLower(query)) { add(base,meta) }
			} else {
				ok, err := m.fileContains(rootID,base,query)
				if err != nil { return nil, err }
				if ok { add(base,meta) }
			}
			return out,nil
		}
		if meta.Kind != "directory" { return nil, errors.New("search base must be a file or directory") }
	}

	var walk func(string) error
	walk = func(rel string) error {
		entries, err := m.List(rootID,rel)
		if err != nil { return err }
		for _, entry := range entries {
			child := entry.Name
			if rel != "" { child = path.Join(rel,entry.Name) }
			if entry.Kind == "symlink" { continue }
			switch kind {
			case "name":
				if strings.Contains(strings.ToLower(entry.Name),strings.ToLower(query)) {
					if add(child,entry) { return nil }
				}
			case "content":
				if entry.Kind == "file" && entry.Size <= RecursiveContentSearchMaxBytes {
					ok, err := m.fileContains(rootID,child,query)
					if err != nil { return err }
					if ok && add(child,entry) { return nil }
				}
			}
			if entry.Kind == "directory" && len(out) < limit {
				if err := walk(child); err != nil { return err }
			}
			if len(out) >= limit { return nil }
		}
		return nil
	}
	if err := walk(base); err != nil { return nil, err }
	return out,nil
}
