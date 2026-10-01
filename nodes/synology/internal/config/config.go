package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type RootConfig struct {
	ID   string `json:"id"`
	Path string `json:"path"`
	Mode string `json:"mode"`
}

type Config struct {
	ExecutorURL     string       `json:"executorUrl"`
	DeviceID        string       `json:"deviceId"`
	DeviceTokenFile string       `json:"deviceTokenFile"`
	Roots           []RootConfig `json:"roots"`
}

var (
	deviceIDPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)
	volumePathPattern = regexp.MustCompile(`^/volume[1-9][0-9]*/[^/]+(?:/.*)?$`)
)

func Load(path string) (Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Config{}, fmt.Errorf("read config: %w", err)
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Config{}, fmt.Errorf("parse config: %w", err)
	}
	if err := validate(cfg); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func validate(cfg Config) error {
	u, err := url.Parse(cfg.ExecutorURL)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
		return errors.New("executorUrl must be an https URL without embedded credentials")
	}
	if !deviceIDPattern.MatchString(cfg.DeviceID) {
		return errors.New("deviceId must match [A-Za-z0-9._:-] and be 1-128 characters")
	}
	if strings.TrimSpace(cfg.DeviceTokenFile) == "" {
		return errors.New("deviceTokenFile is required")
	}

	seen := make(map[string]struct{}, len(cfg.Roots))
	for _, root := range cfg.Roots {
		if root.ID == "" || len(root.ID) > 128 {
			return errors.New("root id must be 1-128 characters")
		}
		if _, exists := seen[root.ID]; exists {
			return fmt.Errorf("duplicate root id %q", root.ID)
		}
		seen[root.ID] = struct{}{}

		clean := filepath.Clean(root.Path)
		if !filepath.IsAbs(clean) || !volumePathPattern.MatchString(clean) {
			return fmt.Errorf("root %q path %q must name a share below /volumeN, not /volume1 itself", root.ID, root.Path)
		}
		parts := strings.Split(strings.TrimPrefix(clean, "/"), "/")
		if len(parts) < 2 || strings.HasPrefix(parts[1], "@") {
			return fmt.Errorf("root %q cannot target a DSM internal @ directory", root.ID)
		}
		if root.Mode != "rw" && root.Mode != "ro" {
			return fmt.Errorf("root %q mode must be rw or ro", root.ID)
		}
	}
	return nil
}

func LoadToken(path string) (string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("stat device token: %w", err)
	}
	if !info.Mode().IsRegular() {
		return "", errors.New("device token must be a regular file")
	}
	if info.Mode().Perm()&0o077 != 0 {
		return "", fmt.Errorf("device token permissions %04o are too broad; group/world access must be zero", info.Mode().Perm())
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read device token: %w", err)
	}
	token := strings.TrimSpace(string(data))
	if token == "" {
		return "", errors.New("device token is empty")
	}
	return token, nil
}
