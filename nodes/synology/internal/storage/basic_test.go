package storage

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func newWritableManager(t *testing.T) (*Manager, string) {
	t.Helper()
	root := t.TempDir()
	m, err := NewManager([]RootConfig{{ID:"media", Path:root, Mode:"rw"}})
	if err != nil { t.Fatal(err) }
	t.Cleanup(func(){ _ = m.Close() })
	return m, root
}

func TestBasicListStatAndBoundedRead(t *testing.T) {
	m, root := newWritableManager(t)
	if err := os.Mkdir(filepath.Join(root, "dir"), 0700); err != nil { t.Fatal(err) }
	payload := bytes.Repeat([]byte("x"), MaxChunk+128)
	if err := os.WriteFile(filepath.Join(root, "dir", "big.bin"), payload, 0600); err != nil { t.Fatal(err) }

	entries, err := m.List("media", "dir")
	if err != nil { t.Fatal(err) }
	if len(entries)!=1 || entries[0].Name!="big.bin" || entries[0].Type!="file" {
		t.Fatalf("unexpected entries: %+v", entries)
	}

	info, err := m.Stat("media", "dir/big.bin")
	if err != nil { t.Fatal(err) }
	if info.Type!="file" || info.Size!=int64(len(payload)) { t.Fatalf("unexpected stat: %+v", info) }

	chunk, err := m.Read("media", "dir/big.bin", 10, MaxChunk)
	if err != nil { t.Fatal(err) }
	if len(chunk)!=MaxChunk { t.Fatalf("read len=%d want %d", len(chunk), MaxChunk) }
	if _, err := m.Read("media", "dir/big.bin", 0, MaxChunk+1); err == nil {
		t.Fatal("expected oversized read to fail")
	}
}

func TestWriteAtomicallyReplacesWithoutOversizedPartialMutation(t *testing.T) {
	m, root := newWritableManager(t)
	target := filepath.Join(root, "file.txt")
	if err := os.WriteFile(target, []byte("old"), 0600); err != nil { t.Fatal(err) }

	result, err := m.Write("media", "file.txt", []byte("new-value"))
	if err != nil { t.Fatal(err) }
	if result.Size!=9 { t.Fatalf("unexpected result: %+v", result) }
	got, err := os.ReadFile(target)
	if err != nil { t.Fatal(err) }
	if string(got)!="new-value" { t.Fatalf("got %q", got) }

	if _, err := m.Write("media", "file.txt", bytes.Repeat([]byte("z"), MaxChunk+1)); err == nil {
		t.Fatal("expected oversized write to fail")
	}
	got, err = os.ReadFile(target)
	if err != nil { t.Fatal(err) }
	if string(got)!="new-value" { t.Fatalf("oversized failure mutated target: %q", got) }

	matches, err := filepath.Glob(filepath.Join(root, ".executor-write-*"))
	if err != nil { t.Fatal(err) }
	if len(matches)!=0 { t.Fatalf("temporary files leaked: %v", matches) }
}

func TestAppendMkdirAndDelete(t *testing.T) {
	m, root := newWritableManager(t)
	if err := m.Mkdir("media", "a/b", true); err != nil { t.Fatal(err) }
	if _, err := os.Stat(filepath.Join(root, "a", "b")); err != nil { t.Fatal(err) }

	if _, err := m.Append("media", "a/b/log.txt", []byte("one")); err != nil { t.Fatal(err) }
	if _, err := m.Append("media", "a/b/log.txt", []byte("-two")); err != nil { t.Fatal(err) }
	got, err := os.ReadFile(filepath.Join(root, "a", "b", "log.txt"))
	if err != nil { t.Fatal(err) }
	if string(got)!="one-two" { t.Fatalf("append got %q", got) }

	if err := m.Delete("media", "a", false); err == nil {
		t.Fatal("non-recursive delete should reject non-empty directory")
	}
	if err := m.Delete("media", "a", true); err != nil { t.Fatal(err) }
	if _, err := os.Stat(filepath.Join(root, "a")); !os.IsNotExist(err) {
		t.Fatalf("recursive delete did not remove tree: %v", err)
	}
}

func TestBasicMutationsRejectReadOnlyRootAndSymlink(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "target"), []byte("outside"), 0600); err != nil { t.Fatal(err) }
	if err := os.Symlink(filepath.Join(outside, "target"), filepath.Join(root, "link")); err != nil { t.Fatal(err) }
	m, err := NewManager([]RootConfig{
		{ID:"rw",Path:root,Mode:"rw"},
		{ID:"ro",Path:root,Mode:"ro"},
	})
	if err != nil { t.Fatal(err) }
	defer m.Close()

	if _, err := m.Write("ro", "blocked", []byte("x")); err == nil { t.Fatal("write to ro root succeeded") }
	if _, err := m.Append("rw", "link", []byte("x")); err == nil { t.Fatal("append followed symlink") }
	if err := m.Delete("rw", "link", false); err == nil { t.Fatal("delete accepted symlink") }
	got, err := os.ReadFile(filepath.Join(outside, "target"))
	if err != nil { t.Fatal(err) }
	if string(got)!="outside" { t.Fatalf("outside target changed: %q", got) }
}
