// ===== ImportModelFolderTo（拖拽导入上下文路由）测试 =====
// 上下文 rtype 来自前端当前树页面的根属性（树根本就派生自注册表路由配置）：
// 注册表校验通过 → 按该类型仓库根落盘；空串/未注册类型 → 回退 inferFolderType
// 内容推断（兼容导入页等无上下文入口）；内容明确归属其他单一类型时仅记
// OpLog 提醒不阻断——用户拖到哪页就落哪页的根。
// 例外：默认中性类型（ysm）上下文让位内容推断，整条走 ImportModelFolder 旧路。
package app

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

func folderItem(rel string) types.ImportFileItem {
	return types.ImportFileItem{RelPath: rel, Base64: ""} // 空内容即可：WriteModelFolder 只按扩展名白名单校验
}

func TestImportModelFolderTo_ContextTypeWins(t *testing.T) {
	base := t.TempDir()
	a := scanApp(t, types.AppConfig{FilesRoot: base})
	files := []types.ImportFileItem{folderItem("touhou_little_maid-1.0.0.zip")}
	if err := a.ImportModelFolderTo("多合一女仆包", "", "maid-model", files); err != nil {
		t.Fatalf("导入失败: %v", err)
	}
	want := filepath.Join(base, registry.GroupStorageRoot("maid-model"), "多合一女仆包")
	if _, err := os.Stat(want); err != nil {
		t.Fatalf("zip 歧义文件夹应落在上下文类型根 %s: %v", want, err)
	}
	legacy := filepath.Join(base, registry.GroupStorageRoot("ysm"), "多合一女仆包")
	if _, err := os.Stat(legacy); !os.IsNotExist(err) {
		t.Errorf("不应再回退落 ysm 根 %s", legacy)
	}
}

func TestImportModelFolderTo_EmptyContextFallsBackInference(t *testing.T) {
	base := t.TempDir()
	a := scanApp(t, types.AppConfig{FilesRoot: base})
	files := []types.ImportFileItem{folderItem("track.litematic")}
	if err := a.ImportModelFolderTo("MMD模型", "", "", files); err != nil {
		t.Fatalf("导入失败: %v", err)
	}
	want := filepath.Join(base, registry.GroupStorageRoot("litematic"), "MMD模型")
	if _, err := os.Stat(want); err != nil {
		t.Fatalf("空上下文应走内容推断落 litematic 根 %s: %v", want, err)
	}
}

func TestImportModelFolderTo_UnknownContextFallsBackInference(t *testing.T) {
	base := t.TempDir()
	a := scanApp(t, types.AppConfig{FilesRoot: base})
	files := []types.ImportFileItem{folderItem("pack.zip")} // zip 多类型歧义 → 推断兜底 ysm
	if err := a.ImportModelFolderTo("某资源包", "", "no-such-type", files); err != nil {
		t.Fatalf("未注册上下文类型应回退而非报错: %v", err)
	}
	want := filepath.Join(base, registry.GroupStorageRoot("ysm"), "某资源包")
	if _, err := os.Stat(want); err != nil {
		t.Fatalf("未注册类型应回退推断落 ysm 根 %s: %v", want, err)
	}
}

func TestImportModelFolderTo_MismatchWarnsButImports(t *testing.T) {
	base := t.TempDir()
	a := scanApp(t, types.AppConfig{FilesRoot: base})
	// litematic 明确归属 litematic 类型，与上下文 maid-model 错位：仍按上下文落盘（提醒非阻断）
	files := []types.ImportFileItem{folderItem("track.litematic")}
	if err := a.ImportModelFolderTo("错位模型", "", "maid-model", files); err != nil {
		t.Fatalf("内容错位不应阻断导入: %v", err)
	}
	want := filepath.Join(base, registry.GroupStorageRoot("maid-model"), "错位模型")
	if _, err := os.Stat(want); err != nil {
		t.Fatalf("错位时仍应落在上下文类型根 %s: %v", want, err)
	}
	// 提醒走 a.logger.AddOpLog 写环形日志（tempdir），不在此断言日志内容——语义由实现保证
}

func TestImportModelFolderTo_NeutralContextYieldsToInference(t *testing.T) {
	base := t.TempDir()
	a := scanApp(t, types.AppConfig{FilesRoot: base})
	// 默认页上下文 ysm + 内容明确归属 litematic：恢复 ADR-092 内容推断落位（审核 P3-4）
	files := []types.ImportFileItem{folderItem("track.litematic")}
	if err := a.ImportModelFolderTo("MMD模型", "", "ysm", files); err != nil {
		t.Fatalf("中性上下文让位推断导入失败: %v", err)
	}
	want := filepath.Join(base, registry.GroupStorageRoot("litematic"), "MMD模型")
	if _, err := os.Stat(want); err != nil {
		t.Fatalf("默认页应让位内容推断落 litematic 根 %s: %v", want, err)
	}
	neutral := filepath.Join(base, registry.GroupStorageRoot("ysm"), "MMD模型")
	if _, err := os.Stat(neutral); !os.IsNotExist(err) {
		t.Errorf("不应按中性上下文落 ysm 根 %s", neutral)
	}
}

func TestImportModelFolderTo_NeutralContextAmbiguousStaysFallback(t *testing.T) {
	base := t.TempDir()
	a := scanApp(t, types.AppConfig{FilesRoot: base})
	// 默认页上下文 ysm + zip 歧义：与旧兜底同源，落 ysm 根
	files := []types.ImportFileItem{folderItem("pack.zip")}
	if err := a.ImportModelFolderTo("某资源包", "", "ysm", files); err != nil {
		t.Fatalf("中性上下文歧义导入失败: %v", err)
	}
	want := filepath.Join(base, registry.GroupStorageRoot("ysm"), "某资源包")
	if _, err := os.Stat(want); err != nil {
		t.Fatalf("歧义内容在默认页应落 ysm 兜底根 %s: %v", want, err)
	}
}

func TestImportModelFolderTo_NeutralContextYsmJsonPriority(t *testing.T) {
	base := t.TempDir()
	a := scanApp(t, types.AppConfig{FilesRoot: base})
	// ysm.json 是 YSM 解压目录入口，优先级不应依赖 items 顺序（审核 P3-1）：
	// 单归属文件在 ysm.json 之前时，中性页委托旧路仍应落 ysm 根而非 litematic 根
	files := []types.ImportFileItem{
		folderItem("track.litematic"),
		folderItem("ysm.json"),
	}
	if err := a.ImportModelFolderTo("YSM包", "", "ysm", files); err != nil {
		t.Fatalf("中性上下文 ysm.json 优先导入失败: %v", err)
	}
	want := filepath.Join(base, registry.GroupStorageRoot("ysm"), "YSM包")
	if _, err := os.Stat(want); err != nil {
		t.Fatalf("ysm.json 非首位仍应落 ysm 根 %s: %v", want, err)
	}
	litematic := filepath.Join(base, registry.GroupStorageRoot("litematic"), "YSM包")
	if _, err := os.Stat(litematic); !os.IsNotExist(err) {
		t.Errorf("不应按 litematic 单归属落位 %s", litematic)
	}
}
