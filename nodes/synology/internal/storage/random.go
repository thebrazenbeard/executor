package storage

import (
	"crypto/rand"
	"encoding/hex"
)

func randRead(p []byte) (int, error) { return rand.Read(p) }
func encodeHex(p []byte) string { return hex.EncodeToString(p) }
