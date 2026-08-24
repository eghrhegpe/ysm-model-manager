package ysmhub

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const tokenFileName = "ysmhub_oauth.json"

func TokenPath() (string, error) {
	root, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("resolve user config directory: %w", err)
	}
	if root == "" { return "", errors.New("user config directory is empty") }
	return filepath.Join(root, "YSM-Model-Manager", tokenFileName), nil
}

func LoadStoredToken() (*Token, error) {
	path, err := TokenPath()
	if err != nil { return nil, err }
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) { return nil, nil }
	if err != nil { return nil, fmt.Errorf("read stored YSM Hub token: %w", err) }
	var token Token
	if err := json.Unmarshal(data, &token); err != nil { return nil, fmt.Errorf("decode stored YSM Hub token: %w", err) }
	if token.AccessToken == "" { return nil, nil }
	return &token, nil
}

func SaveStoredToken(token Token) error {
	if token.AccessToken == "" { return errors.New("cannot store an empty YSM Hub access token") }
	path, err := TokenPath()
	if err != nil { return err }
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil { return fmt.Errorf("create token directory: %w", err) }
	data, err := json.MarshalIndent(token, "", "  ")
	if err != nil { return fmt.Errorf("encode stored YSM Hub token: %w", err) }
	tmp, err := os.CreateTemp(filepath.Dir(path), ".ysmhub-token-*")
	if err != nil { return fmt.Errorf("create token file: %w", err) }
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err := tmp.Chmod(0o600); err != nil { tmp.Close(); return err }
	if _, err := tmp.Write(data); err != nil { tmp.Close(); return fmt.Errorf("write token file: %w", err) }
	if err := tmp.Close(); err != nil { return err }
	if err := os.Rename(tmpPath, path); err != nil {
		if removeErr := os.Remove(path); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			return fmt.Errorf("replace token file: %w", err)
		}
		if retryErr := os.Rename(tmpPath, path); retryErr != nil { return fmt.Errorf("replace token file: %w", retryErr) }
	}
	return nil
}

func DeleteStoredToken() error {
	path, err := TokenPath()
	if err != nil { return err }
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("delete stored YSM Hub token: %w", err)
	}
	return nil
}
