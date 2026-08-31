package utils

import (
	"crypto/md5"
	"encoding/hex"
	"errors"
	"os"
)

// HashMessage was used for an earlier keying scheme. Currently unused.
func HashMessage(key string) string {
	hasher := md5.New()
	hasher.Write([]byte(key))
	return hex.EncodeToString(hasher.Sum(nil))
}

// Encrypt is a stub for future message encryption. Currently unused.
func Encrypt(data []byte) {}

// FileExists reports whether a path exists on disk. Currently unused.
func FileExists(path string) (bool, error) {
	_, err := os.Lstat(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}
