// ===== 整合包卡片拖拽导入 binding 契约测试（先入仓库再推送）=====
// 覆盖：文件夹整组 / 单文件两条链路的仓库落盘 + 实例落地（copy 模式）、
// 未知实例/未配置 mcRoot 的先验证后写入语义、FILE_EXISTS 不覆盖、
// 导入成功后扫描缓存失效。
package app

import (
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/logs"
	"ysm-model-manager/go/scanner"
	"ysm-model-manager/go/types"
)

var b64 = func(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }

// packApp 构造「仓库 + 单个 vanilla 布局实例」的 App：
// FilesRoot = base（ysm 根 = FilesRoot/{group}/{storageSubDir}，ADR-092 两层路由），
// McRoot = base/mc，实例 TestInst = McRoot/versions/TestInst。
// 返回 (app, ysm 仓库根, 实例 ysm custom 目录)。
func packApp(t *testing.T) (*App, string, string) {
	t.Helper()
	base := t.TempDir()
	// mcRoot 命名 .minecraft：installer 的 ContainsMinecraftMarker 守卫要求路径含该段
	mcRoot := filepath.Join(base, ".minecraft")
	instVer := filepath.Join(mcRoot, "versions", "TestInst")
	if err := os.MkdirAll(instVer, 0o755); err != nil {
		t.Fatal(err)
	}
	customDir := filepath.Join(instVer, types.SubDirMap("ysm"))
	a := repoApp(t, types.AppConfig{
		FilesRoot:        base,
		ResourcepackRoot: filepath.Join(base, "resourcepacks"),
		ShaderpackRoot:   filepath.Join(base, "shaderpacks"),
		SchematicRoot:    filepath.Join(base, "schematics"),
		MmdRoot:          filepath.Join(base, "mmd"),
		VrcRoot:          filepath.Join(base, "vrc"),
		McRoot:           mcRoot,
	})
	a.logger = logs.NewLogger(t.TempDir()) // repoApp 不带 logger，推送记账路径需要
	ysmRoot := filepath.Join(base, types.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(ysmRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	return a, ysmRoot, customDir
}

func assertFileExists(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("文件应存在: %s (%v)", path, err)
	}
}

func assertFileAbsent(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("文件不应存在: %s", path)
	}
}

func TestImportFolderAndPushToInstance_CopyMode(t *testing.T) {
	a, ysmRoot, customDir := packApp(t)
	items := []types.ImportFileItem{
		{RelPath: "ysm.json", Base64: b64(`{"formatVersion":"test"}`)},
		{RelPath: "tex/face.png", Base64: b64("png-bytes")},
	}

	if err := a.ImportFolderAndPushToInstance("狐狸", "", items, "TestInst"); err != nil {
		t.Fatalf("导入+推送失败: %v", err)
	}

	// 仓库落盘（内容推断 ysm 类型 → ysm 根）
	assertFileExists(t, filepath.Join(ysmRoot, "狐狸", "ysm.json"))
	assertFileExists(t, filepath.Join(ysmRoot, "狐狸", "tex", "face.png"))
	// 实例落地（LinkMode 空 = copy），相对目录结构还原
	assertFileExists(t, filepath.Join(customDir, "狐狸", "ysm.json"))
	assertFileExists(t, filepath.Join(customDir, "狐狸", "tex", "face.png"))

	// 内容一致（copy 语义）
	got, err := os.ReadFile(filepath.Join(customDir, "狐狸", "ysm.json"))
	if err != nil || string(got) != `{"formatVersion":"test"}` {
		t.Fatalf("实例文件内容不一致: %s (%v)", got, err)
	}
}

func TestImportFileAndPushToInstance_CopyMode(t *testing.T) {
	a, ysmRoot, customDir := packApp(t)

	if err := a.ImportFileAndPushToInstance("model.ysm", b64("ysm-data"), "TestInst"); err != nil {
		t.Fatalf("导入+推送失败: %v", err)
	}

	assertFileExists(t, filepath.Join(ysmRoot, "model.ysm"))
	assertFileExists(t, filepath.Join(customDir, "model.ysm"))
	got, err := os.ReadFile(filepath.Join(customDir, "model.ysm"))
	if err != nil || string(got) != "ysm-data" {
		t.Fatalf("实例文件内容不一致: %s (%v)", got, err)
	}
}

func TestImportAndPush_UnknownInstance_NoImport(t *testing.T) {
	a, ysmRoot, _ := packApp(t)
	// 先验证实例存在再写入仓库：未知实例不得留下仓库残档
	err := a.ImportFolderAndPushToInstance("狐狸", "", []types.ImportFileItem{
		{RelPath: "ysm.json", Base64: b64("{}")},
	}, "NoSuchInst")
	if err == nil || !strings.Contains(err.Error(), "未找到整合包") {
		t.Fatalf("应报「未找到整合包」, got %v", err)
	}
	assertFileAbsent(t, filepath.Join(ysmRoot, "狐狸"))

	err = a.ImportFileAndPushToInstance("m.ysm", b64("x"), "NoSuchInst")
	if err == nil || !strings.Contains(err.Error(), "未找到整合包") {
		t.Fatalf("应报「未找到整合包」, got %v", err)
	}
	assertFileAbsent(t, filepath.Join(ysmRoot, "m.ysm"))
}

func TestImportAndPush_NoMcRoot_Rejected(t *testing.T) {
	base := t.TempDir()
	a := repoApp(t, types.AppConfig{FilesRoot: base})

	err := a.ImportFileAndPushToInstance("m.ysm", b64("x"), "TestInst")
	if err == nil || !strings.Contains(err.Error(), "请先设置游戏根目录") {
		t.Fatalf("应报「请先设置游戏根目录」, got %v", err)
	}
	assertFileAbsent(t, filepath.Join(base, types.GroupStorageRoot("ysm"), "m.ysm"))
}

func TestImportAndPush_FileExists_NoOverwrite(t *testing.T) {
	a, _, customDir := packApp(t)
	if err := a.ImportFileAndPushToInstance("model.ysm", b64("first"), "TestInst"); err != nil {
		t.Fatalf("首次导入+推送失败: %v", err)
	}

	// 二次导入同名文件：FILE_EXISTS，不覆盖仓库与实例
	if err := a.ImportFileAndPushToInstance("model.ysm", b64("second"), "TestInst"); err == nil {
		t.Fatal("重复导入应报 FILE_EXISTS")
	} else if !strings.Contains(err.Error(), "已存在") {
		t.Fatalf("应报「文件已存在」, got %v", err)
	}
	got, err := os.ReadFile(filepath.Join(customDir, "model.ysm"))
	if err != nil || string(got) != "first" {
		t.Fatalf("实例文件不得被覆盖: %s (%v)", got, err)
	}
}

func TestImportFileAndPushToInstance_BareYsmJsonRejected(t *testing.T) {
	// 光杆 ysm.json 无 geometry/纹理，推送侧会触发 InstallDir(父目录)——
	// 单文件命中即父目录=仓库根 → 整仓落地灾难。binding 层前置拒绝（前端同款提示）。
	a, ysmRoot, customDir := packApp(t)
	err := a.ImportFileAndPushToInstance("ysm.json", b64("{}"), "TestInst")
	if err == nil {
		t.Fatal("光杆 ysm.json 单文件应被拒绝")
	}
	assertFileAbsent(t, filepath.Join(ysmRoot, "ysm.json"))
	assertFileAbsent(t, filepath.Join(customDir, "ysm.json"))
}

func TestImportFileAndPushToInstance_RootLevelModelRejected(t *testing.T) {
	// 根级 .pmx/.pmd 单文件会触发推送侧 InstallDir(父目录) → 仓库根整仓落地；
	// 前置到落盘前拒绝，不留下「入仓成功但推送必败」的仓库残档（与 ysm.json 同口径）。
	// 断言两点（review 14f3b7e4）：
	//  1) 错误码必须是入口前置检查的 ErrUnsupportedType——若只断言 err!=nil，入口检查被删后
	//     推送兜底（ErrInvalidPath）仍会返错，测试假绿（旧兜底拦在入仓之后，残档已留下）；
	//  2) 无残留断言必须查 .pmx/.pmd 的真实落点根（GetRepoRoot("mmd")，与 importer 类型路由
	//     同源），查 ysmRoot 是查错地方（MMD 模型不会落到 ysm 根）。
	a, _, customDir := packApp(t)
	mmdRoot, err := a.GetRepoRoot("mmd")
	if err != nil {
		t.Fatalf("GetRepoRoot(mmd) 失败: %v", err)
	}
	for _, name := range []string{"char.pmx", "char.pmd"} {
		err := a.ImportFileAndPushToInstance(name, b64("mmd-bytes"), "TestInst")
		if err == nil {
			t.Fatalf("根级单文件 %s 应被拒绝", name)
		}
		var ae types.AppError
		if !errors.As(err, &ae) || ae.Code != types.ErrUnsupportedType {
			t.Fatalf("%s 应报 ErrUnsupportedType（入口前置检查），实际: %v", name, err)
		}
		assertFileAbsent(t, filepath.Join(mmdRoot, name))
		assertFileAbsent(t, filepath.Join(customDir, name))
	}
}

func TestPushRepoPathToInstance_RootLevelYsmJsonBackstop(t *testing.T) {
	// R23 P2：pushRepoPathToInstance 兜底防线——原 IsYsmEntryJSON(repoPath) 传全路径
	// 恒 false 防线失效；修复后根级 ysm.json（filepath.Dir == 仓库根）必须被拒绝
	// （ErrInvalidPath），防止未来调用方绕过前置拦截触发 InstallDir(父目录) 整仓落地。
	a, ysmRoot, _ := packApp(t)
	err := a.pushRepoPathToInstance("ysm", "TestInst", filepath.Join(ysmRoot, "ysm.json"))
	var ae types.AppError
	if !errors.As(err, &ae) || ae.Code != types.ErrInvalidPath {
		t.Fatalf("根级 ysm.json 兜底应拒绝 (ErrInvalidPath), got: %v", err)
	}
}

func TestImportFolderAndPushToInstance_InvalidatesScanCache(t *testing.T) {
	a, ysmRoot, _ := packApp(t)
	// 暖缓存：二次扫描命中 30s scanCache
	scanner.ScanEntriesWithHit(ysmRoot)
	if _, hit := scanner.ScanEntriesWithHit(ysmRoot); !hit {
		t.Fatal("暖缓存后二次扫描应命中")
	}

	items := []types.ImportFileItem{{RelPath: "ysm.json", Base64: b64("{}")}}
	if err := a.ImportFolderAndPushToInstance("狐狸", "", items, "TestInst"); err != nil {
		t.Fatalf("导入+推送失败: %v", err)
	}

	if _, hit := scanner.ScanEntriesWithHit(ysmRoot); hit {
		t.Fatal("导入成功后扫描缓存应已失效")
	}
}
