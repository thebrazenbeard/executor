package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeConfig(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestLoadValidConfig(t *testing.T) {
	path := writeConfig(t, `{
		"executorUrl":"https://executor.example",
		"deviceId":"DS216",
		"deviceTokenFile":"/var/packages/ExecutorNode/home/device.token",
		"roots":[{"id":"media","path":"/volume1/media","mode":"rw"}]
	}`)
	cfg, err := Load(path)
	if err != nil { t.Fatal(err) }
	if cfg.ExecutorURL != "https://executor.example" || cfg.DeviceID != "DS216" {
		t.Fatalf("unexpected config: %+v", cfg)
	}
	if len(cfg.Roots) != 1 || cfg.Roots[0].ID != "media" {
		t.Fatalf("unexpected roots: %+v", cfg.Roots)
	}
}

func TestLoadRejectsUnsafeOrAmbiguousConfig(t *testing.T) {
	cases := []struct{name, body, want string}{
		{"http", `{"executorUrl":"http://executor.example","deviceId":"DS216","deviceTokenFile":"/tmp/token","roots":[]}`, "https"},
		{"blank device", `{"executorUrl":"https://executor.example","deviceId":"","deviceTokenFile":"/tmp/token","roots":[]}`, "deviceId"},
		{"volume root", `{"executorUrl":"https://executor.example","deviceId":"DS216","deviceTokenFile":"/tmp/token","roots":[{"id":"bad","path":"/volume1","mode":"rw"}]}`, "/volume1"},
		{"duplicate roots", `{"executorUrl":"https://executor.example","deviceId":"DS216","deviceTokenFile":"/tmp/token","roots":[{"id":"same","path":"/volume1/a","mode":"rw"},{"id":"same","path":"/volume1/b","mode":"rw"}]}`, "duplicate"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Load(writeConfig(t, tc.body))
			if err == nil || !strings.Contains(strings.ToLower(err.Error()), strings.ToLower(tc.want)) {
				t.Fatalf("expected error containing %q, got %v", tc.want, err)
			}
		})
	}
}

func TestLoadTokenRejectsGroupOrWorldReadableSecret(t *testing.T) {
	path := filepath.Join(t.TempDir(), "device.token")
	if err := os.WriteFile(path, []byte("super-secret\n"), 0644); err != nil { t.Fatal(err) }
	if _, err := LoadToken(path); err == nil {
		t.Fatal("expected insecure token mode to be rejected")
	}
	if err := os.Chmod(path, 0600); err != nil { t.Fatal(err) }
	token, err := LoadToken(path)
	if err != nil { t.Fatal(err) }
	if token != "super-secret" { t.Fatalf("unexpected token %q", token) }
}
