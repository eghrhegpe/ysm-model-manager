// ===== go/ysm ExtractYsmSummary 主函数测试（补 0% 覆盖）=====
// 覆盖 4 个分支：YSGP 加密格式 / 裸 ysm.json / ZIP 含 ysm.json / ZIP 无 ysm.json 降级。
package ysm

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

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

// ADR-033 截断探测边界回归——裸 ysm.json 超过 50MB 应拒绝解析
func TestExtractYsmSummary_PlainJSONOverLimit(t *testing.T) {
	path := filepath.Join(t.TempDir(), "model.json")
	// 50MB+1：触发 summary.go 的裸 json 上限守卫
	if err := os.WriteFile(path, bytes.Repeat([]byte{' '}, (50<<20)+1), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := ExtractYsmSummary(path); err == nil {
		t.Fatal("裸 ysm.json 超过 50MB 应拒绝解析，实际返回 nil 错误")
	}
}

// ZIP 内 ysm.json 超过 50MB 应拒绝（limit+1 探测）
func TestExtractYsmSummary_ZipYsmJSONOverLimit(t *testing.T) {
	// 构造大字符串触发 zip 分支 50MB 上限
	big := bytes.Repeat([]byte{' '}, (50<<20)+1)
	path := testutil.WriteZipFile(t, "model.ysm", map[string]string{"ysm.json": string(big)})
	if _, err := ExtractYsmSummary(path); err == nil {
		t.Fatal("zip 内 ysm.json 超过 50MB 应拒绝解析，实际返回 nil 错误")
	}
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
	// 动画分组 + 配置菜单：裸 ysm.json（解压目录）分支应与 .zip 分支一致
	// （修复回归：原 .json 分支提前 return，不填充 AnimGroups/ConfigMenus）
	if len(summary.AnimGroups) == 0 {
		t.Fatalf("裸 ysm.json 应至少 1 个动画组, got %+v", summary.AnimGroups)
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
	if len(summary.ConfigMenus) != 1 || summary.ConfigMenus[0].ID != "btn1" {
		t.Errorf("ConfigMenus = %+v, want btn1", summary.ConfigMenus)
	}
}

func TestExtractYsmSummary_ZipWithYsmJSON(t *testing.T) {
	path := testutil.WriteZipFile(t, "model.ysm", map[string]string{
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
	path := testutil.WriteZipFile(t, "model.ysm", map[string]string{
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

// 裸 ysm.json 内容为非法 JSON → 必须返回结构化错误（summary.go L170-175），
// 不得静默降级为「文件名摘要」。
func TestExtractYsmSummary_PlainJSONInvalidContent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "model.json")
	if err := os.WriteFile(path, []byte("{not valid json"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := ExtractYsmSummary(path); err == nil {
		t.Fatal("非法 JSON 内容的裸 ysm.json 应返回错误，实际返回 nil 错误")
	}
}

// ZIP 内 ysm.json 内容为非法 JSON → 同样必须返回错误（summary.go L291-293）。
func TestExtractYsmSummary_ZipYsmJSONInvalidContent(t *testing.T) {
	path := testutil.WriteZipFile(t, "model.ysm", map[string]string{
		"ysm.json": "{not valid json",
	})
	if _, err := ExtractYsmSummary(path); err == nil {
		t.Fatal("zip 内 ysm.json 非法 JSON 应返回错误，实际返回 nil 错误")
	}
}

// ZIP 分支：properties 存在时从几何体文件提取纹理尺寸（summary.go L339-365）——
// geo/main.json 含 texture_width/height 时应写入 Stats.TexWidth/TexHeight。
func TestExtractYsmSummary_ZipTexSizeFromGeometry(t *testing.T) {
	ysmJSON := `{
	  "spec": 2,
	  "metadata": {"name": "tex模型"},
	  "properties": {"default_texture": "tex/default.png"},
	  "files": {"player": {"model": [{"path": "geo/main.json"}], "texture": [{"path": "tex/default.png"}]}}
	}`
	path := testutil.WriteZipFile(t, "model.ysm", map[string]string{
		"ysm.json":        ysmJSON,
		"geo/main.json":   `{"minecraft:geometry":[{"description":{"texture_width":128,"texture_height":64}}]}`,
		"tex/default.png": "png",
	})
	summary, err := ExtractYsmSummary(path)
	if err != nil {
		t.Fatalf("ZIP 分支不应报错: %v", err)
	}
	if summary.Stats.TexWidth != 128 || summary.Stats.TexHeight != 64 {
		t.Errorf("TexWidth/TexHeight = %d/%d, want 128/64", summary.Stats.TexWidth, summary.Stats.TexHeight)
	}
}

// ===== Name 兜底口径统一（护栏 #3）：metadata.name 为空时两分支一致回退到去扩展名文件名 =====

// noNameYsmJSON 构造 metadata.name 为空（省略字段）的 ysm.json，用于验证 Name 兜底。
func noNameYsmJSON() string {
	return `{
  "spec": 2,
  "metadata": {
    "tips": "没有名字的模型",
    "license": {"type": "CC0"},
    "authors": [{"name": "佚名"}]
  },
  "files": {
    "player": {
      "model": [{"path": "geo/main.json"}],
      "texture": [{"path": "tex/default.png"}]
    }
  }
}`
}

// 裸 ysm.json：metadata.name 为空时应回退到文件名（去扩展名）。
// 历史行为：裸 JSON 分支 L197-199 已有兜底。
func TestExtractYsmSummary_NameFallback_PlainJSON(t *testing.T) {
	const fileName = "no_name_model"
	path := filepath.Join(t.TempDir(), fileName+".json")
	if err := os.WriteFile(path, []byte(noNameYsmJSON()), 0644); err != nil {
		t.Fatal(err)
	}
	summary, err := ExtractYsmSummary(path)
	if err != nil {
		t.Fatalf("不应报错: %v", err)
	}
	if summary.Name != fileName {
		t.Errorf("Name = %q, want %q（metadata.name 空时回退到去扩展名文件名）", summary.Name, fileName)
	}
}

// ZIP：metadata.name 为空时应与裸 ysm.json 分支一致，回退到文件名（去扩展名）。
// 历史 bug：ZIP 分支 L325-327 补了兜底但需要验证重构后仍然生效，
// 且与裸 JSON 分支用同一段公共函数（populateMetadata 内部兜底，不在主流程分叉）。
func TestExtractYsmSummary_NameFallback_Zip(t *testing.T) {
	const fileName = "no_name_model"
	path := testutil.WriteZipFile(t, fileName+".ysm", map[string]string{
		"ysm.json":      noNameYsmJSON(),
		"geo/main.json": `{"minecraft:geometry": []}`,
	})
	summary, err := ExtractYsmSummary(path)
	if err != nil {
		t.Fatalf("不应报错: %v", err)
	}
	if summary.Name != fileName {
		t.Errorf("Name = %q, want %q（ZIP 分支 metadata.name 空时应与裸 JSON 一致回退文件名）", summary.Name, fileName)
	}
}
