//go:build windows && rust_backend

package rustbridge

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

//go:embed bin/ysm_model_manager_wails_bridge.dll
var bridgeDLL []byte

func materializeDLL() (string, error) {
	digest := sha256.Sum256(bridgeDLL)
	version := hex.EncodeToString(digest[:8])
	cacheRoot, err := os.UserCacheDir()
	if err != nil {
		return "", fmt.Errorf("locate user cache for Rust scanner: %w", err)
	}
	dir := filepath.Join(cacheRoot, "YSM-Model-Manager", "rust", version)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("create Rust scanner cache: %w", err)
	}
	dllPath := filepath.Join(dir, "ysm_model_manager_wails_bridge.dll")
	if existing, err := os.ReadFile(dllPath); err == nil {
		if sha256.Sum256(existing) != digest {
			return "", errors.New("cached Rust scanner DLL checksum mismatch")
		}
		return dllPath, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("verify cached Rust scanner DLL: %w", err)
	}

	tmp, err := os.CreateTemp(dir, "bridge-*.tmp")
	if err != nil {
		return "", fmt.Errorf("create Rust scanner temporary file: %w", err)
	}
	tmpPath := tmp.Name()
	// R32 P2-1 + code_review P2：临时文件权限。
	// os.MkdirAll(dir, 0o700) 已限制目录本身为用户私有，
	// 临时文件继承目录 ACL，其它用户不可读——这是 Windows 上
	// 真正的隔离机制。os.Chmod 在 Windows 上只切换
	// FILE_ATTRIBUTE_READONLY，不处理 Unix 权限位，故不调用。
	removeTemp := true
	defer func() {
		if removeTemp {
			_ = os.Remove(tmpPath)
		}
	}()
	if _, err := tmp.Write(bridgeDLL); err != nil {
		_ = tmp.Close()
		return "", fmt.Errorf("write Rust scanner DLL: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return "", fmt.Errorf("flush Rust scanner DLL: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return "", fmt.Errorf("close Rust scanner DLL: %w", err)
	}
	if err := os.Rename(tmpPath, dllPath); err != nil {
		if existing, readErr := os.ReadFile(dllPath); readErr == nil && sha256.Sum256(existing) == digest {
			return dllPath, nil
		}
		return "", fmt.Errorf("install Rust scanner DLL: %w", err)
	}
	removeTemp = false
	return dllPath, nil
}
