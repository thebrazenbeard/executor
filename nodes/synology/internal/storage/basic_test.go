package storage

import (
	"bytes"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

func newWritableManager(t *testing.T) (*Manager, string) {
	t.Helper()
	root := t.TempDir()
	m, err := NewManager([]RootConfig{{ID: "media", Path: root, Mode: "rw"}})
	if err != nil { t.Fatal(err) }
	t.Cleanup(func(){ _ = m.Close() })
	return m, root
}

func TestBasicStorageListStatReadWriteAppendMkdirDelete(t *testing.T) {
	m, root := newWritableManager(t)

	if err := m.Mkdir("media", "docs/sub", true); err != nil { t.Fatal(err) }
	meta, err := m.Write("media", "docs/sub/note.txt", []byte("hello"))
	if err != nil { t.Fatal(err) }
	if meta.Size != 5 || meta.Kind != "file" { t.Fatalf("write meta=%+v", meta) }

	if err := m.Append("media", "docs/sub/note.txt", []byte(" world")); err != nil { t.Fatal(err) }
	data, meta, err := m.Read("media", "docs/sub/note.txt", 0, MaxTransferBytes)
	if err != nil { t.Fatal(err) }
	if string(data) != "hello world" || meta.Size != 11 { t.Fatalf("read=%q meta=%+v", data, meta) }

	stat, err := m.Stat("media", "docs/sub/note.txt")
	if err != nil { t.Fatal(err) }
	if stat.Kind != "file" || stat.Size != 11 { t.Fatalf("stat=%+v", stat) }

	entries, err := m.List("media", "docs/sub")
	if err != nil { t.Fatal(err) }
	if len(entries) != 1 || entries[0].Name != "note.txt" { t.Fatalf("entries=%+v", entries) }

	rootEntries, err := m.List("media", "")
	if err != nil { t.Fatal(err) }
	if len(rootEntries) != 1 || rootEntries[0].Name != "docs" { t.Fatalf("root entries=%+v", rootEntries) }

	if err := m.Delete("media", "docs", false); err == nil {
		t.Fatal("non-recursive delete unexpectedly removed non-empty directory")
	}
	if err := m.Delete("media", "docs", true); err != nil { t.Fatal(err) }
	if _, err := os.Stat(filepath.Join(root, "docs")); !os.IsNotExist(err) {
		t.Fatalf("docs still exists: %v", err)
	}
}

func TestWriteAtomicallyReplacesAndRejectsFinalSymlink(t *testing.T) {
	m, root := newWritableManager(t)
	if err := os.WriteFile(filepath.Join(root, "file.txt"), []byte("old"), 0600); err != nil { t.Fatal(err) }
	if _, err := m.Write("media", "file.txt", []byte("new")); err != nil { t.Fatal(err) }
	got, err := os.ReadFile(filepath.Join(root, "file.txt"))
	if err != nil { t.Fatal(err) }
	if string(got) != "new" { t.Fatalf("got %q", got) }

	outside := filepath.Join(t.TempDir(), "outside.txt")
	if err := os.WriteFile(outside, []byte("secret"), 0600); err != nil { t.Fatal(err) }
	if err := os.Symlink(outside, filepath.Join(root, "link.txt")); err != nil { t.Fatal(err) }
	if _, err := m.Write("media", "link.txt", []byte("overwrite")); err == nil {
		t.Fatal("write followed/replaced a final symlink")
	}
	still, err := os.ReadFile(outside)
	if err != nil { t.Fatal(err) }
	if string(still) != "secret" { t.Fatalf("outside changed to %q", still) }
}

func TestBasicTransfersAreBounded(t *testing.T) {
	m, _ := newWritableManager(t)
	tooLarge := bytes.Repeat([]byte("x"), MaxTransferBytes+1)
	if _, err := m.Write("media", "huge.bin", tooLarge); err == nil { t.Fatal("oversized write accepted") }
	if err := m.Append("media", "huge.bin", tooLarge); err == nil { t.Fatal("oversized append accepted") }

	payload := bytes.Repeat([]byte("z"), MaxTransferBytes)
	if _, err := m.Write("media", "chunk.bin", payload); err != nil { t.Fatal(err) }
	if _, _, err := m.Read("media", "chunk.bin", 0, MaxTransferBytes+1); err == nil {
		t.Fatal("oversized read accepted")
	}
	data, _, err := m.Read("media", "chunk.bin", 0, MaxTransferBytes)
	if err != nil { t.Fatal(err) }
	if len(data) != MaxTransferBytes { t.Fatalf("len=%d", len(data)) }
}

func TestBasicOperationsRejectReadOnlyAndSymlinkTraversal(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "dir"), 0700); err != nil { t.Fatal(err) }
	if err := os.Symlink(outside, filepath.Join(root, "dir", "escape")); err != nil { t.Fatal(err) }
	m, err := NewManager([]RootConfig{{ID:"media",Path:root,Mode:"ro"}})
	if err != nil { t.Fatal(err) }
	defer m.Close()

	if _, err := m.Write("media", "new.txt", []byte("x")); err == nil { t.Fatal("write allowed on read-only root") }
	if err := m.Mkdir("media", "newdir", false); err == nil { t.Fatal("mkdir allowed on read-only root") }
	if err := m.Delete("media", "dir", true); err == nil { t.Fatal("delete allowed on read-only root") }
	if _, _, err := m.Read("media", "dir/escape/secret.txt", 0, 64); err == nil {
		t.Fatal("read followed nested symlink")
	}
}

func TestEncodeDecodeTransferData(t *testing.T) {
	raw := []byte{0,1,2,250,255}
	encoded, err := EncodeData(raw, "base64")
	if err != nil { t.Fatal(err) }
	if encoded != base64.StdEncoding.EncodeToString(raw) { t.Fatalf("encoded=%q", encoded) }
	decoded, err := DecodeData(encoded, "base64")
	if err != nil { t.Fatal(err) }
	if !bytes.Equal(decoded, raw) { t.Fatalf("decoded=%v", decoded) }
	if _, err := DecodeData("x", "bogus"); err == nil { t.Fatal("unknown encoding accepted") }
}
