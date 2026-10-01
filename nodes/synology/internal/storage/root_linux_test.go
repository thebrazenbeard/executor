package storage

import (
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/unix"
)

func TestManagerRejectsTraversalAbsoluteInternalAndSymlinkEscapes(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "safe.txt"), []byte("ok"), 0600); err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("secret"), 0600); err != nil { t.Fatal(err) }
	if err := os.Symlink(outside, filepath.Join(root, "link")); err != nil { t.Fatal(err) }
	if err := os.Symlink(filepath.Join(outside, "secret.txt"), filepath.Join(root, "final-link")); err != nil { t.Fatal(err) }

	m, err := NewManager([]RootConfig{{ID:"media",Path:root,Mode:"rw"}})
	if err != nil { t.Fatal(err) }
	defer m.Close()

	f, err := m.OpenRead("media", "safe.txt")
	if err != nil { t.Fatal(err) }
	_ = f.Close()

	for _, rel := range []string{"../secret.txt", "/etc/passwd", "@appstore/pkg", "link/secret.txt", "final-link"} {
		t.Run(rel, func(t *testing.T) {
			if f, err := m.OpenRead("media", rel); err == nil {
				_ = f.Close()
				t.Fatalf("expected %q to be rejected", rel)
			}
		})
	}
}

func TestOpenParentIsBoundToOpenedDirectoryAcrossPathSwap(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "a"), 0700); err != nil { t.Fatal(err) }

	m, err := NewManager([]RootConfig{{ID:"media",Path:root,Mode:"rw"}})
	if err != nil { t.Fatal(err) }
	defer m.Close()

	parent, leaf, err := m.OpenParent("media", "a/new.txt")
	if err != nil { t.Fatal(err) }
	defer parent.Close()
	if leaf != "new.txt" { t.Fatalf("leaf=%q", leaf) }

	if err := os.Rename(filepath.Join(root, "a"), filepath.Join(root, "a-old")); err != nil { t.Fatal(err) }
	if err := os.Symlink(outside, filepath.Join(root, "a")); err != nil { t.Fatal(err) }

	fd, err := unix.Openat(parent.fd, leaf, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0600)
	if err != nil { t.Fatal(err) }
	if _, err := unix.Write(fd, []byte("bound")); err != nil { _ = unix.Close(fd); t.Fatal(err) }
	if err := unix.Close(fd); err != nil { t.Fatal(err) }

	if _, err := os.Stat(filepath.Join(root, "a-old", "new.txt")); err != nil {
		t.Fatalf("file did not land in descriptor-bound directory: %v", err)
	}
	if _, err := os.Stat(filepath.Join(outside, "new.txt")); !os.IsNotExist(err) {
		t.Fatalf("path swap escaped root, outside stat err=%v", err)
	}
}

func TestRootAccessStatesAreIndependent(t *testing.T) {
	writable := t.TempDir()
	readOnly := t.TempDir()
	if err := os.Chmod(readOnly, 0500); err != nil { t.Fatal(err) }
	unavailable := filepath.Join(t.TempDir(), "missing")

	m, err := NewManager([]RootConfig{
		{ID:"write",Path:writable,Mode:"rw"},
		{ID:"read",Path:readOnly,Mode:"rw"},
		{ID:"forced-ro",Path:writable,Mode:"ro"},
		{ID:"missing",Path:unavailable,Mode:"rw"},
	})
	if err != nil { t.Fatal(err) }
	defer m.Close()

	got := map[string]string{}
	for _, status := range m.Roots() { got[status.ID] = status.Access }
	if got["write"]!="writable" { t.Fatalf("write access=%q", got["write"]) }
	if got["read"]!="read-only" { t.Fatalf("read access=%q", got["read"]) }
	if got["forced-ro"]!="read-only" { t.Fatalf("forced-ro access=%q", got["forced-ro"]) }
	if got["missing"]!="unavailable" { t.Fatalf("missing access=%q", got["missing"]) }

	if parent, _, err := m.OpenParent("read", "blocked.txt"); err == nil {
		_ = parent.Close()
		t.Fatal("read-only root unexpectedly allowed mutation parent")
	}
}

func TestManagerRejectsDuplicateRootIDs(t *testing.T) {
	root := t.TempDir()
	if _, err := NewManager([]RootConfig{{ID:"dup",Path:root,Mode:"rw"},{ID:"dup",Path:root,Mode:"rw"}}); err == nil {
		t.Fatal("expected duplicate root ID rejection")
	}
}
