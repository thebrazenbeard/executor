//go:build linux

package storage

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"sort"
	"strings"
	"time"

	"golang.org/x/sys/unix"
)

func kindFromMode(mode uint32) string {
	switch mode & unix.S_IFMT {
	case unix.S_IFREG:
		return "file"
	case unix.S_IFDIR:
		return "directory"
	case unix.S_IFLNK:
		return "symlink"
	default:
		return "other"
	}
}

func metaFromStat(name string, st *unix.Stat_t) FileMeta {
	return FileMeta{
		Name: name,
		Kind: kindFromMode(st.Mode),
		Size: st.Size,
		Mode: st.Mode & 0o7777,
		ModTime: time.Unix(st.Mtim.Sec, st.Mtim.Nsec).UTC(),
	}
}

func (m *Manager) openDir(rootID, rel string, writable bool) (int, error) {
	root, err := m.root(rootID, writable)
	if err != nil {
		return -1, err
	}
	if rel == "" {
		return dupDir(root.fd)
	}
	parts, err := splitRelative(rel)
	if err != nil {
		return -1, err
	}
	return walkDir(root.fd, parts)
}

func (m *Manager) List(rootID, rel string) ([]Entry, error) {
	fd, err := m.openDir(rootID, rel, false)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), "executor-list")
	if file == nil {
		_ = unix.Close(fd)
		return nil, errors.New("open directory handle")
	}
	defer file.Close()

	names, err := file.Readdirnames(-1)
	if err != nil {
		return nil, err
	}
	sort.Strings(names)
	out := make([]Entry, 0, len(names))
	for _, name := range names {
		if strings.HasPrefix(name, "@") {
			continue
		}
		var st unix.Stat_t
		if err := unix.Fstatat(fd, name, &st, unix.AT_SYMLINK_NOFOLLOW); err != nil {
			return nil, err
		}
		out = append(out, metaFromStat(name, &st))
	}
	return out, nil
}

func (m *Manager) Stat(rootID, rel string) (FileMeta, error) {
	root, err := m.root(rootID, false)
	if err != nil {
		return FileMeta{}, err
	}
	parts, err := splitRelative(rel)
	if err != nil {
		return FileMeta{}, err
	}
	parentFD, err := walkDir(root.fd, parts[:len(parts)-1])
	if err != nil {
		return FileMeta{}, err
	}
	defer unix.Close(parentFD)
	var st unix.Stat_t
	leaf := parts[len(parts)-1]
	if err := unix.Fstatat(parentFD, leaf, &st, unix.AT_SYMLINK_NOFOLLOW); err != nil {
		return FileMeta{}, err
	}
	return metaFromStat(leaf, &st), nil
}

func (m *Manager) Read(rootID, rel string, offset int64, length int) ([]byte, FileMeta, error) {
	if offset < 0 {
		return nil, FileMeta{}, errors.New("offset must be non-negative")
	}
	if length <= 0 {
		length = MaxTransferBytes
	}
	if length > MaxTransferBytes {
		return nil, FileMeta{}, fmt.Errorf("length exceeds %d-byte transfer limit", MaxTransferBytes)
	}

	file, err := m.OpenRead(rootID, rel)
	if err != nil {
		return nil, FileMeta{}, err
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return nil, FileMeta{}, err
	}
	if !info.Mode().IsRegular() {
		return nil, FileMeta{}, errors.New("path is not a regular file")
	}
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		return nil, FileMeta{}, err
	}

	buf := make([]byte, length)
	n, readErr := io.ReadFull(file, buf)
	if readErr != nil && readErr != io.EOF && readErr != io.ErrUnexpectedEOF {
		return nil, FileMeta{}, readErr
	}
	buf = buf[:n]
	return buf, FileMeta{
		Name: info.Name(),
		Kind: "file",
		Size: info.Size(),
		Mode: uint32(info.Mode().Perm()),
		ModTime: info.ModTime().UTC(),
	}, nil
}

func statAt(parentFD int, leaf string) (*unix.Stat_t, error) {
	var st unix.Stat_t
	if err := unix.Fstatat(parentFD, leaf, &st, unix.AT_SYMLINK_NOFOLLOW); err != nil {
		return nil, err
	}
	return &st, nil
}

func rejectExistingSymlink(parentFD int, leaf string) error {
	st, err := statAt(parentFD, leaf)
	if err != nil {
		if errors.Is(err, unix.ENOENT) {
			return nil
		}
		return err
	}
	if st.Mode&unix.S_IFMT == unix.S_IFLNK {
		return errors.New("final symlink is not allowed")
	}
	if st.Mode&unix.S_IFMT == unix.S_IFDIR {
		return errors.New("target is a directory")
	}
	return nil
}

func writeAllFD(fd int, data []byte) error {
	for len(data) > 0 {
		n, err := unix.Write(fd, data)
		if err != nil {
			return err
		}
		if n <= 0 {
			return io.ErrShortWrite
		}
		data = data[n:]
	}
	return nil
}

func (m *Manager) Write(rootID, rel string, data []byte) (FileMeta, error) {
	if len(data) > MaxTransferBytes {
		return FileMeta{}, fmt.Errorf("write exceeds %d-byte transfer limit", MaxTransferBytes)
	}
	parent, leaf, err := m.OpenParent(rootID, rel)
	if err != nil {
		return FileMeta{}, err
	}
	defer parent.Close()
	if err := rejectExistingSymlink(parent.fd, leaf); err != nil {
		return FileMeta{}, err
	}

	var random [8]byte
	if _, err := randRead(random[:]); err != nil {
		return FileMeta{}, err
	}
	tmp := ".executor-write-" + encodeHex(random[:])
	fd, err := unix.Openat(parent.fd, tmp, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0o600)
	if err != nil {
		return FileMeta{}, err
	}
	cleanup := true
	defer func() {
		if fd >= 0 {
			_ = unix.Close(fd)
		}
		if cleanup {
			_ = unix.Unlinkat(parent.fd, tmp, 0)
		}
	}()

	if err := writeAllFD(fd, data); err != nil {
		return FileMeta{}, err
	}
	if err := unix.Fsync(fd); err != nil {
		return FileMeta{}, err
	}
	if err := unix.Close(fd); err != nil {
		fd = -1
		return FileMeta{}, err
	}
	fd = -1
	if err := unix.Renameat(parent.fd, tmp, parent.fd, leaf); err != nil {
		return FileMeta{}, err
	}
	cleanup = false
	_ = unix.Fsync(parent.fd)

	st, err := statAt(parent.fd, leaf)
	if err != nil {
		return FileMeta{}, err
	}
	return metaFromStat(leaf, st), nil
}

func (m *Manager) Append(rootID, rel string, data []byte) error {
	if len(data) > MaxTransferBytes {
		return fmt.Errorf("append exceeds %d-byte transfer limit", MaxTransferBytes)
	}
	parent, leaf, err := m.OpenParent(rootID, rel)
	if err != nil {
		return err
	}
	defer parent.Close()
	if err := rejectExistingSymlink(parent.fd, leaf); err != nil {
		return err
	}
	fd, err := unix.Openat(parent.fd, leaf, unix.O_WRONLY|unix.O_APPEND|unix.O_CREAT|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0o600)
	if err != nil {
		return err
	}
	defer unix.Close(fd)
	if err := writeAllFD(fd, data); err != nil {
		return err
	}
	return unix.Fsync(fd)
}

func (m *Manager) Mkdir(rootID, rel string, recursive bool) error {
	root, err := m.root(rootID, true)
	if err != nil {
		return err
	}
	parts, err := splitRelative(rel)
	if err != nil {
		return err
	}
	if !recursive {
		parentFD, err := walkDir(root.fd, parts[:len(parts)-1])
		if err != nil {
			return err
		}
		defer unix.Close(parentFD)
		return unix.Mkdirat(parentFD, parts[len(parts)-1], 0o700)
	}

	current, err := dupDir(root.fd)
	if err != nil {
		return err
	}
	defer func() { _ = unix.Close(current) }()
	for _, component := range parts {
		next, openErr := unix.Openat(current, component, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
		if openErr != nil {
			if !errors.Is(openErr, unix.ENOENT) {
				return openErr
			}
			if err := unix.Mkdirat(current, component, 0o700); err != nil && !errors.Is(err, unix.EEXIST) {
				return err
			}
			next, openErr = unix.Openat(current, component, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
			if openErr != nil {
				return openErr
			}
		}
		_ = unix.Close(current)
		current = next
	}
	return nil
}

func removeAt(parentFD int, name string, recursive bool) error {
	var st unix.Stat_t
	if err := unix.Fstatat(parentFD, name, &st, unix.AT_SYMLINK_NOFOLLOW); err != nil {
		return err
	}
	if st.Mode&unix.S_IFMT != unix.S_IFDIR {
		return unix.Unlinkat(parentFD, name, 0)
	}
	if !recursive {
		return unix.Unlinkat(parentFD, name, unix.AT_REMOVEDIR)
	}

	fd, err := unix.Openat(parentFD, name, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
	if err != nil {
		return err
	}
	dir := os.NewFile(uintptr(fd), name)
	if dir == nil {
		_ = unix.Close(fd)
		return errors.New("open directory for recursive delete")
	}
	names, err := dir.Readdirnames(-1)
	if err != nil {
		_ = dir.Close()
		return err
	}
	for _, child := range names {
		if child == "." || child == ".." {
			continue
		}
		if err := removeAt(fd, child, true); err != nil {
			_ = dir.Close()
			return err
		}
	}
	if err := dir.Close(); err != nil {
		return err
	}
	return unix.Unlinkat(parentFD, name, unix.AT_REMOVEDIR)
}

func (m *Manager) Delete(rootID, rel string, recursive bool) error {
	parent, leaf, err := m.OpenParent(rootID, rel)
	if err != nil {
		return err
	}
	defer parent.Close()
	return removeAt(parent.fd, leaf, recursive)
}

func EncodeData(data []byte, encoding string) (string, error) {
	switch encoding {
	case "", "utf8":
		return string(data), nil
	case "base64":
		return base64.StdEncoding.EncodeToString(data), nil
	default:
		return "", fmt.Errorf("unsupported encoding %q", encoding)
	}
}

func DecodeData(data, encoding string) ([]byte, error) {
	switch encoding {
	case "", "utf8":
		return []byte(data), nil
	case "base64":
		return base64.StdEncoding.DecodeString(data)
	default:
		return nil, fmt.Errorf("unsupported encoding %q", encoding)
	}
}

func cleanDisplayPath(rel string) string {
	if rel == "" {
		return ""
	}
	return path.Clean(rel)
}
