// ===== go/ysm ExtractYsmSummary 主函数测试（补 0% 覆盖）=====
// 覆盖 4 个分支：YSGP 加密格式 / 裸 ysm.json / ZIP 含 ysm.json / ZIP 无 ysm.json 降级。
package ysm

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

// writeZip 构造内存 ZIP 写入磁盘，返回文件路径
func writeZip(t *testing.T, files map[string]string) string {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "model.ysm")
	if err := os.WriteFile(path, buf.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}
	return path
}

// minimalYsmJSON 构造最小可解析的 ysm.json 内容
func minimalYsmJSON() string {
	return `{
  "spec": 2,
  "metadata": {
    "name": "测试模型",
    "tips": "安装提示",
    "license": {"type": "MIT"},
    "authors": [{"name": "作者A", "role": "模型师", "contact": {"bilibili": "BV123"}}],
    "link": {"home": "https://example.com", "donate": "https://pay.example.com"}
  },
  "properties": {
    "default_texture": "tex/default.png",
    "height_scale": 1.2,
    "width_scale": 0.8,
    "extra_animation": {
      "#sit": "坐姿",
      "walk": "走路",
      "idle": "待机"
    },
    "extra_animation_classify": [
      {"id": "sit", "name": "坐姿组", "extra_animation": {"walk": "走路", "idle": "待机"}}
    ],
    "extra_animation_buttons": [
      {"id": "btn1", "name": "表情菜单", "config_forms": [{"type": "slider"}]}
    ]
  },
  "files": {
    "player": {
      "model": [{"path": "geo/main.json"}],
      "texture": [{"path": "tex/default.png"}]
    }
  }
}`
}

func TestExtractYsmSummary_YSGP(t *testing.T) {
	path := filepath.Join(t.TempDir(), "encrypted.ysm")
	// YSGP 魔数 + 文本头（见 isYSGP 判定）
	if err := os.WriteFile(path, []byte("YSGP\x00encrypted-binary"), 0644); err != nil {
		t.Fatal(err)
	}
	summary, err := ExtractYsmSummary(path)
	if err != nil {
		t.Fatalf("YSGP 分支不应报错: %v", err)
	}
	if summary.Format != "ysm" {
		t.Errorf("Format = %q, want ysm", summary.Format)
	}
	if summary.Spec != 2 {
		t.Errorf("Spec = %d, want 2", summary.Spec)
	}
	if summary.Name != "encrypted" {
		t.Errorf("Name = %q, want encrypted（去扩展名）", summary.Name)
	}
}

func TestExtractYsmSummary_PlainJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "model.json")
	if err := os.WriteFile(path, []byte(minimalYsmJSON()), 0644); err != nil {
		t.Fatal(err)
	}
	summary, err := ExtractYsmSummary(path)
	if err != nil {
		t.Fatalf("JSON 分支不应报错: %v", err)
	}
	if summary.Format != "ysm" {
		t.Errorf("Format = %q, want ysm", summary.Format)
	}
	if summary.Name != "测试模型" {
		t.Errorf("Name = %q, want 测试模型", summary.Name)
	}
	if summary.Tips != "安装提示" {
		t.Errorf("Tips = %q, want 安装提示", summary.Tips)
	}
	if summary.License != "MIT" {
		t.Errorf("License = %q, want MIT", summary.License)
	}
	if len(summary.Authors) != 1 || summary.Authors[0].Name != "作者A" {
		t.Errorf("Authors = %+v, want [作者A]", summary.Authors)
	}
	if summary.Authors[0].Bilibili != "BV123" {
		t.Errorf("Bilibili = %q, want BV123", summary.Authors[0].Bilibili)
	}
	if summary.Links.Home != "https://example.com" {
		t.Errorf("Links.Home = %q", summary.Links.Home)
	}
	if summary.Stats.Models != 1 || summary.Stats.Textures != 1 {
		t.Errorf("Stats = %+v, want Models=1 Textures=1", summary.Stats)
	}
}

func TestExtractYsmSummary_ZipWithYsmJSON(t *testing.T) {
	path := writeZip(t, map[string]string{
		"ysm.json":      minimalYsmJSON(),
		"geo/main.json": `{"minecraft:geometry": []}`,
	})
	summary, err := ExtractYsmSummary(path)
	if err != nil {
		t.Fatalf("ZIP 分支不应报错: %v", err)
	}
	if summary.Format != "ysm" {
		t.Errorf("Format = %q, want ysm", summary.Format)
	}
	if summary.Spec != 2 {
		t.Errorf("Spec = %d, want 2", summary.Spec)
	}
	if summary.Name != "测试模型" {
		t.Errorf("Name = %q, want 测试模型", summary.Name)
	}
	// 动画分类：walk/idle 归入坐姿组，loose 兜底不应有（walk/idle 已分类）
	if len(summary.AnimGroups) == 0 {
		t.Fatalf("应至少 1 个动画组, got %+v", summary.AnimGroups)
	}
	foundClassified := false
	for _, g := range summary.AnimGroups {
		if g.Name == "坐姿组" && len(g.Items) == 2 {
			foundClassified = true
		}
	}
	if !foundClassified {
		t.Errorf("应找到坐姿组（含 walk/idle 两项）, got %+v", summary.AnimGroups)
	}
	// 配置菜单
	if len(summary.ConfigMenus) != 1 || summary.ConfigMenus[0].ID != "btn1" {
		t.Errorf("ConfigMenus = %+v, want btn1", summary.ConfigMenus)
	}
	// 文件统计：files.player 有 model + texture
	if summary.Stats.Models != 1 || summary.Stats.Textures != 1 {
		t.Errorf("Stats = %+v, want Models=1 Textures=1", summary.Stats)
	}
}

func TestExtractYsmSummary_ZipFallbackNoYsmJSON(t *testing.T) {
	path := writeZip(t, map[string]string{
		"geo/main.json":            `{"minecraft:geometry": ["geom1"]}`,
		"anim/walk_animation.json": `{"animations": {}}`,
		"tex/a.png":                "png",
	})
	summary, err := ExtractYsmSummary(path)
	if err != nil {
		t.Fatalf("降级分支不应报错: %v", err)
	}
	if summary.Format != "zip" {
		t.Errorf("Format = %q, want zip（无 ysm.json 降级）", summary.Format)
	}
	// 降级扫描：1 几何 JSON + 1 动画 JSON + 1 纹理
	if summary.Stats.Models != 1 {
		t.Errorf("Models = %d, want 1", summary.Stats.Models)
	}
	if summary.Stats.Animations != 1 {
		t.Errorf("Animations = %d, want 1", summary.Stats.Animations)
	}
	if summary.Stats.Textures != 1 {
		t.Errorf("Textures = %d, want 1", summary.Stats.Textures)
	}
}

func TestExtractYsmSummary_NotExist(t *testing.T) {
	_, err := ExtractYsmSummary(filepath.Join(t.TempDir(), "nope.ysm"))
	if err == nil {
		t.Fatal("不存在的文件应报错")
	}
}
