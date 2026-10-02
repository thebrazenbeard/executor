//go:build linux

package storage

import (
	"os"
	"path/filepath"
	"testing"
)

func TestConfiguredRootRejectsIntermediateSymlink(t *testing.T) {
	base := t.TempDir()
	outside := t.TempDir()
	if err := os.Mkdir(filepath.Join(outside, "share"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(base, "redirect")); err != nil {
		t.Fatal(err)
	}

	configured := filepath.Join(base, "redirect", "share")
	m, err := NewManager([]RootConfig{{ID: "media", Path: configured, Mode: "rw"}})
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()

	statuses := m.Roots()
	if len(statuses) != 1 {
		t.Fatalf("statuses=%+v", statuses)
	}
	if statuses[0].Access != "unavailable" {
		t.Fatalf("intermediate symlink root became %q; expected unavailable", statuses[0].Access)
	}
}
