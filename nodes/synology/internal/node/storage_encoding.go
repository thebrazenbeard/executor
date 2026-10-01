package node

import "github.com/thebrazenbeard/executor/nodes/synology/internal/storage"

func normalizedEncoding(encoding string) string {
	if encoding == "" { return "utf8" }
	return encoding
}

func storageEncode(data []byte, encoding string) (string,error) {
	return storage.EncodeData(data,normalizedEncoding(encoding))
}

func storageDecode(data, encoding string) ([]byte,error) {
	return storage.DecodeData(data,normalizedEncoding(encoding))
}
