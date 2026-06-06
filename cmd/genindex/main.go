package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type entry struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Size int64  `json:"size"`
	Hash string `json:"hash,omitempty"`
}

func main() {
	if len(os.Args) < 2 {
		fmt.Println("用法: genindex <仓库目录路径>")
		os.Exit(1)
	}
	repoPath := os.Args[1]
	info, err := os.Stat(repoPath)
	if err != nil || !info.IsDir() {
		fmt.Println("错误: 目录不存在:", repoPath)
		os.Exit(1)
	}

	var list []entry
	filepath.WalkDir(repoPath, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(p))
		if ext != ".ysm" && ext != ".zip" && ext != ".7z" {
			return nil
		}
		rel, _ := filepath.Rel(repoPath, p)
		rel = strings.ReplaceAll(rel, "\\", "/")
		fi, _ := d.Info()
		size := int64(0)
		if fi != nil {
			size = fi.Size()
		}
		// 计算 SHA256
		hashStr := ""
		if f, err := os.Open(p); err == nil {
			h := sha256.New()
			io.Copy(h, f)
			hashStr = fmt.Sprintf("%x", h.Sum(nil))
			f.Close()
		}
		list = append(list, entry{
			Name: d.Name(),
			Path: rel,
			Size: size,
			Hash: hashStr,
		})
		return nil
	})

	data, _ := json.MarshalIndent(list, "", "  ")
	indexPath := filepath.Join(repoPath, "index.json")
	os.WriteFile(indexPath, data, 0644)
	fmt.Printf("✅ 已生成 index.json，共 %d 个模型\n", len(list))
}
