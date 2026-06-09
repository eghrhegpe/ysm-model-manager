// modelscope — 分析模型文件（zip/ysm）中的骨骼结构
// 用法: go run cmd/modelscope/main.go <文件路径>
package main

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type BedrockGeo struct {
	FormatVersion string `json:"format_version"`
	Geometry      []struct {
		Description struct {
			Identifier   string  `json:"identifier"`
			TextureWidth float64 `json:"texture_width"`
		} `json:"description"`
		Bones []struct {
			Name     string         `json:"name"`
			Parent   string         `json:"parent,omitempty"`
			Pivot    [3]float64     `json:"pivot"`
			Rotation json.RawMessage `json:"rotation,omitempty"`
			Cubes    []json.RawMessage `json:"cubes,omitempty"`
		} `json:"bones"`
	} `json:"minecraft:geometry"`
}

func main() {
	if len(os.Args) < 2 {
		fmt.Println("用法: go run cmd/modelscope/main.go <文件路径>")
		return
	}
	path := os.Args[1]
	ext := strings.ToLower(filepath.Ext(path))

	switch ext {
	case ".zip":
		analyzeZip(path)
	case ".ysm":
		fmt.Println("[!] .ysm 文件需先解压。请解压后传入 geometry JSON 文件路径。")
	default:
		analyzeJSON(path)
	}
}

func analyzeZip(path string) {
	r, err := zip.OpenReader(path)
	if err != nil {
		fmt.Printf("[ERR] 打开 ZIP 失败: %v\n", err)
		return
	}
	defer r.Close()

	for _, f := range r.File {
		low := strings.ToLower(f.Name)
		if strings.HasSuffix(low, ".json") && !f.FileInfo().IsDir() &&
			!strings.Contains(low, "ysm.json") &&
			!strings.Contains(low, "animation") &&
			!strings.Contains(low, "controller") {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			buf, _ := io.ReadAll(rc)
			rc.Close()
			fmt.Printf("\n=== 📄 %s ===\n", f.Name)
			analyzeJSONBytes(buf)
		}
	}
}

func analyzeJSON(path string) {
	data, err := os.ReadFile(path)
	if err != nil {
		fmt.Printf("[ERR] 读取失败: %v\n", err)
		return
	}
	analyzeJSONBytes(data)
}

func analyzeJSONBytes(data []byte) {
	var geo BedrockGeo
	if err := json.Unmarshal(data, &geo); err != nil {
		fmt.Printf("  [ERR] 解析 JSON 失败: %v\n", err)
		return
	}
	if len(geo.Geometry) == 0 {
		fmt.Println("  [SKIP] 无 minecraft:geometry")
		return
	}
	g := geo.Geometry[0]
	fmt.Printf("  纹理: %.0fx%.0f\n", g.Description.TextureWidth, g.Description.TextureHeight)
	fmt.Printf("  骨骼数: %d\n", len(g.Bones))

	// 统计同名骨骼
	seen := map[string]int{}
	for _, b := range g.Bones {
		seen[b.Name]++
	}
	for name, count := range seen {
		if count > 1 {
			fmt.Printf("  ⚠️ 同名骨骼: %s (%d 次)\n", name, count)
		}
	}

	// 打印所有骨骼层级
	fmt.Println("  骨骼列表:")
	for _, b := range g.Bones {
		parent := b.Parent
		if parent == "" {
			parent = "(root)"
		}
		rot := ""
		if len(b.Rotation) > 0 && string(b.Rotation) != "[0,0,0]" && string(b.Rotation) != "[0,0,0]" {
			rot = fmt.Sprintf(" rot=%s", string(b.Rotation))
		}
		cubeN := 0
		if b.Cubes != nil {
			cubeN = len(b.Cubes)
		}
		fmt.Printf("    %-25s → %-15s pivot=[%.3f,%.3f,%.3f]%s cubes=%d\n",
			b.Name, parent, b.Pivot[0], b.Pivot[1], b.Pivot[2], rot, cubeN)
	}
	fmt.Println()
}
