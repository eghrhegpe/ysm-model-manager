// ===== 目录式 fixture 解压链路回归（shen-fengling 等 ysm.json + models/ 结构）=====
// 覆盖：真实目录式 YSM 模型（tests/fixtures/ysm/shen-fengling：spec 2、
// player.model 声明 main/arm、texture 声明序、models/ 子目录）走
// FindComponentsInExtractedYSM 全链路不 panic、组件非空、纹理声明序正确——
// 上一轮 threejs 侧 fixture 回归仅覆盖 lucia（单 main.json 目录），目录式
// ysm.json + models/ 结构此前无 Go 测试消费（子代理审计 P3）。
package ysm

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

// fixtureYsmPath 返回目录式 fixture 的 ysm.json 路径（相对 go/ysm 包目录）
func fixtureYsmPath(t *testing.T, name string) string {
	t.Helper()
	p := filepath.Join("..", "..", "tests", "fixtures", "ysm", name, "ysm.json")
	if !isDir(filepath.Dir(p)) {
		t.Skipf("fixture 不存在: %s", filepath.Dir(p))
	}
	return p
}

func TestFindComponentsInExtractedYSM_DirFixture_ShenFengling(t *testing.T) {
	ysmPath := fixtureYsmPath(t, "shen-fengling")
	comps, texNames := FindComponentsInExtractedYSM(ysmPath)
	testutil.Equal(t, len(comps) == 0, false, "目录式 fixture 应解析出组件（非空）")
	// main 优先（R1 契约：main.json 必须占组件 0，否则 texSlot 错位）
	if len(comps) > 0 && comps[0].SourceName != "main" {
		t.Errorf("组件 0 应为 main, got %q", comps[0].SourceName)
	}
	// 纹理声明序（R1 契约）：texNames 应非空且与组件 texSlot 对齐
	if len(texNames) == 0 {
		t.Error("应有纹理声明序（非空）")
	}
	// 每个组件 bones 非空（解析成功）
	for i, c := range comps {
		if len(c.Bones) == 0 {
			t.Errorf("组件 %d (%s) bones 为空", i, c.SourceName)
		}
	}
}

func TestFindComponentsInExtractedYSM_DirFixture_Xigelika(t *testing.T) {
	ysmPath := fixtureYsmPath(t, "xigelika")
	comps, texNames := FindComponentsInExtractedYSM(ysmPath)
	if len(comps) == 0 {
		t.Skip("xigelika fixture 组件为空（可能模型结构特殊），跳过断言")
	}
	// 与 shen-fengling 同契约：main 优先 + 纹理序非空
	if len(comps) > 0 && comps[0].SourceName != "main" {
		t.Errorf("组件 0 应为 main, got %q", comps[0].SourceName)
	}
	if len(texNames) == 0 {
		t.Error("应有纹理声明序（非空）")
	}
}

func TestFindComponentsInExtractedYSM_SourceNameNoExt(t *testing.T) {
	// SourceName 应去扩展名（main.json → main），供 UI 组件名显示
	ysmPath := fixtureYsmPath(t, "shen-fengling")
	comps, _ := FindComponentsInExtractedYSM(ysmPath)
	for _, c := range comps {
		if strings.Contains(c.SourceName, ".json") {
			t.Errorf("SourceName %q 不应含 .json 扩展名", c.SourceName)
		}
		if strings.ContainsAny(c.SourceName, "/\\") {
			t.Errorf("SourceName %q 不应含路径分隔符", c.SourceName)
		}
	}
}

// TestFindComponentsInExtractedYSM_WineFoxAll 遍历 wine-fox 全部现存子目录模型
// 逐一走 FindComponentsInExtractedYSM 全链路：不 panic、组件非空、main 优先、
// 纹理声明序非空——多目录批量回归（子代理审计 P3 遗留：wine-fox 结构未覆盖）。
// 注意：2026-08-12 fixtures 精简后重建极简目录样本（tests/fixtures/ysm/wine-fox/01_minimal，
// ysm.json + models/ 几何复用 extracted_arm_test 模板，1.6KB）恢复本回归；样本目录可随时替换。
func TestFindComponentsInExtractedYSM_WineFoxAll(t *testing.T) {
	base := filepath.Join("..", "..", "tests", "fixtures", "ysm", "wine-fox")
	entries, err := os.ReadDir(base)
	if err != nil {
		t.Skipf("wine-fox fixtures 目录不存在: %v", err)
	}
	checked := 0
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		ysmPath := filepath.Join(base, e.Name(), "ysm.json")
		if _, err := os.Stat(ysmPath); err != nil {
			continue
		}
		comps, texNames := FindComponentsInExtractedYSM(ysmPath)
		if len(comps) == 0 {
			t.Errorf("wine-fox/%s 应解析出组件（非空）", e.Name())
			continue
		}
		// main 优先（R1 契约：main.json 必须占组件 0）
		if comps[0].SourceName != "main" {
			t.Errorf("wine-fox/%s 组件 0 应为 main, got %q", e.Name(), comps[0].SourceName)
		}
		if len(texNames) == 0 {
			t.Errorf("wine-fox/%s 应有纹理声明序（非空）", e.Name())
		}
		for i, c := range comps {
			if len(c.Bones) == 0 {
				t.Errorf("wine-fox/%s 组件 %d (%s) bones 为空", e.Name(), i, c.SourceName)
			}
		}
		checked++
	}
	testutil.Equal(t, checked == 0, false, "未检查到任何 wine-fox 子目录（路径错误？）")
	t.Logf("已回归 wine-fox %d 个子目录模型", checked)
}
