package app

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
	"ysm-model-manager/internal/testutil"
)

// Build3DSpecFromGeometryJSON：Android 等无 Node 环境的 .ysm 3D 兜底通道
// （前端 WASM 解码出 geometry JSON → 本 binding 复用 threejs.BuildMulti 构建 spec）
func TestBuild3DSpecFromGeometryJSON(t *testing.T) {
	a := &App{}
	// 空输入 → error（got 为 nil）
	got, err := a.Build3DSpecFromGeometryJSON("")
	testutil.NotNil(t, err, "空输入应返回 error")
	testutil.Nil(t, got, "空输入应返回 nil spec")
	// 非法 JSON → ParseBedrockGeometry 返回 nil → 空 spec（无 models）。
	// 旧契约返回 "{}"（不可用信号）；新契约下仍无 models，但非 error。
	// 原断言仅以 got 判 pass/fail（err 只进失败消息）——err 置 _，不新增 err 契约。
	got, _ = a.Build3DSpecFromGeometryJSON("not json")
	testutil.NotNil(t, got, "非法 JSON 应返回非 nil spec") // 前置守卫：got 非 nil 才解引用 .Models
	testutil.Equal(t, len(got.Models), 0, "非法 JSON 应返回空 spec（无 models）")

	const geo = `{
  "format_version": "1.12.0",
  "minecraft:geometry": [{
    "description": { "identifier": "geometry.test", "texture_width": 64, "texture_height": 32 },
    "bones": [{ "name": "bone1", "pivot": [0, 0, 0], "cubes": [{ "origin": [-4, 0, -4], "size": [8, 8, 8] }] }]
  }]
}`
	got, err = a.Build3DSpecFromGeometryJSON(geo)
	testutil.NoError(t, err, "合法 geometry 不应报错")
	testutil.NotNil(t, got, "合法 geometry 应构建出 spec，got nil")
	testutil.Equal(t, len(got.Models) == 0, false, "spec.models 为空")
	testutil.Equal(t, len(got.Models[0].MeshGroups) == 0, false, "spec.models[0].MeshGroups 为空（cube 未生成顶点）")
}

// TestReadFileBytes_MultiRootGuard：路径守卫须放行兄弟类型根（VrcRoot 等），
// 拒绝 ysm 根外路径——修复「ReadFileBytes 返回空」（VRM 预览失败，2026-08-16）。
// 守卫口径与 ScanModelEntries 对齐：扫描能列出的文件就能读。
func TestReadFileBytes_MultiRootGuard(t *testing.T) {
	base := t.TempDir()
	vrcRoot := filepath.Join(base, "vrchat")
	if err := os.MkdirAll(vrcRoot, 0o755); err != nil {
		testutil.NoError(t, err)
	}
	content := []byte("vrm-bytes")
	vrmPath := filepath.Join(vrcRoot, "avatar.vrm")
	if err := os.WriteFile(vrmPath, content, 0o644); err != nil {
		testutil.NoError(t, err)
	}

	cfg := types.AppConfig{FilesRoot: filepath.Join(base, "ysm"), VrcRoot: vrcRoot}
	a := repoApp(t, cfg)

	// 1. 兄弟类型根（VrcRoot）内文件可读（修复目标）
	testutil.Equal(t, string(a.ReadFileBytes(vrmPath)), "vrm-bytes", "VrcRoot 内文件应可读")
	// 2. ysm 根内文件仍可读（回归：既有行为不破坏）
	ysmRoot := filepath.Join(cfg.FilesRoot, registry.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(ysmRoot, 0o755); err != nil {
		testutil.NoError(t, err)
	}
	ysmPath := filepath.Join(ysmRoot, "a.ysm")
	if err := os.WriteFile(ysmPath, content, 0o644); err != nil {
		testutil.NoError(t, err)
	}
	testutil.Equal(t, string(a.ReadFileBytes(ysmPath)), "vrm-bytes", "ysm 根内文件应可读")
	// 3. 根外路径仍拒绝（守卫未放松）
	outside := filepath.Join(base, "..", "outside.ysm")
	testutil.Nil(t, a.ReadFileBytes(outside), "根外路径应拒绝（nil）")
	// 4. 不存在的文件返回 nil（不抛错，与既有契约一致）
	testutil.Nil(t, a.ReadFileBytes(filepath.Join(vrcRoot, "missing.vrm")), "不存在文件应返回 nil")
}

// ===== ReadFileBytesBatch 并发优化测试 =====

// TestReadFileBytesBatch_SmallBatchSequential: <= 4 文件走顺序路径
func TestReadFileBytesBatch_SmallBatchSequential(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	if err := os.MkdirAll(ysmRoot, 0o755); err != nil {
		testutil.NoError(t, err)
	}
	paths := make([]string, 4)
	for i := range 4 {
		p := filepath.Join(ysmRoot, fmt.Sprintf("file_%d.bin", i))
		if err := os.WriteFile(p, []byte(fmt.Sprintf("data_%d", i)), 0o644); err != nil {
			testutil.NoError(t, err)
		}
		paths[i] = p
	}
	a := repoApp(t, types.AppConfig{FilesRoot: base})
	result := a.ReadFileBytesBatch(paths)
	testutil.Equal(t, len(result), 4, "期望 4 个文件")
	for _, p := range paths {
		if result[p] == nil {
			t.Errorf("文件 %s 应存在于结果中", p)
		}
	}
}

// TestReadFileBytesBatch_LargeBatchConcurrent: > 4 文件走并发路径
func TestReadFileBytesBatch_LargeBatchConcurrent(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	if err := os.MkdirAll(ysmRoot, 0o755); err != nil {
		testutil.NoError(t, err)
	}
	const n = 16
	paths := make([]string, n)
	for i := range n {
		p := filepath.Join(ysmRoot, fmt.Sprintf("file_%d.bin", i))
		if err := os.WriteFile(p, []byte(fmt.Sprintf("data_%d", i)), 0o644); err != nil {
			testutil.NoError(t, err)
		}
		paths[i] = p
	}
	a := repoApp(t, types.AppConfig{FilesRoot: base})
	result := a.ReadFileBytesBatch(paths)
	testutil.Equal(t, len(result), n, "期望 %d 个文件", n)
	for _, p := range paths {
		if result[p] == nil {
			t.Errorf("文件 %s 应存在于结果中", p)
		}
	}
}

// TestReadFileBytesBatch_PathGuardConcurrent: 并发路径下路径守卫仍有效
func TestReadFileBytesBatch_PathGuardConcurrent(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	if err := os.MkdirAll(ysmRoot, 0o755); err != nil {
		testutil.NoError(t, err)
	}
	validPaths := make([]string, 10)
	for i := range 10 {
		p := filepath.Join(ysmRoot, fmt.Sprintf("valid_%d.bin", i))
		os.WriteFile(p, []byte("ok"), 0o644)
		validPaths[i] = p
	}
	// 混入 3 个非法路径（独立切片，不覆写 validPaths 的底层数组）
	paths := make([]string, 0, len(validPaths)+3)
	paths = append(paths, validPaths...)
	paths = append(paths,
		filepath.Join(base, "..", "outside.bin"),
		"",
		filepath.Join(base, "nonexistent", "dir", "file.bin"),
	)
	a := repoApp(t, types.AppConfig{FilesRoot: base})
	result := a.ReadFileBytesBatch(paths)
	// 仅合法路径应出现在结果中
	testutil.Equal(t, len(result), 10, "期望 10 个合法文件")
	for _, p := range validPaths {
		if result[p] == nil {
			t.Errorf("合法文件 %s 应存在", p)
		}
	}
}

// TestReadFileBytesBatch_EmptyInput: 空输入返回空 map
func TestReadFileBytesBatch_EmptyInput(t *testing.T) {
	a := repoApp(t, types.AppConfig{FilesRoot: t.TempDir()})
	result := a.ReadFileBytesBatch(nil)
	testutil.Equal(t, len(result), 0, "空输入应返回空 map")
}

// TestReadFileBytesBatch_ConcurrentPartialFail: 并发路径下部分文件不存在不影响其他
func TestReadFileBytesBatch_ConcurrentPartialFail(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	if err := os.MkdirAll(ysmRoot, 0o755); err != nil {
		testutil.NoError(t, err)
	}
	// 创建 10 个合法文件 + 5 个不存在的路径
	paths := make([]string, 15)
	for i := range 10 {
		p := filepath.Join(ysmRoot, fmt.Sprintf("exists_%d.bin", i))
		os.WriteFile(p, []byte("data"), 0o644)
		paths[i] = p
	}
	for i := 10; i < 15; i++ {
		paths[i] = filepath.Join(ysmRoot, fmt.Sprintf("missing_%d.bin", i))
	}
	a := repoApp(t, types.AppConfig{FilesRoot: base})
	result := a.ReadFileBytesBatch(paths)
	testutil.Equal(t, len(result), 10, "期望 10 个存在的文件")
}

// TestReadFileBytesBatch_Boundary4Sequential: 恰好 4 个文件 → 走顺序路径
func TestReadFileBytesBatch_Boundary4Sequential(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	os.MkdirAll(ysmRoot, 0o755)
	paths := make([]string, 4)
	for i := range 4 {
		p := filepath.Join(ysmRoot, fmt.Sprintf("b4_%d.bin", i))
		os.WriteFile(p, []byte(fmt.Sprintf("content_%d", i)), 0o644)
		paths[i] = p
	}
	a := repoApp(t, types.AppConfig{FilesRoot: base})
	result := a.ReadFileBytesBatch(paths)
	testutil.Equal(t, len(result), 4, "4 文件应全读")
	// 验证返回内容正确性
	for i, p := range paths {
		expected := fmt.Sprintf("content_%d", i)
		if string(result[p]) != expected {
			t.Errorf("文件 %s 内容不匹配: got %q, want %q", p, result[p], expected)
		}
	}
}

// TestReadFileBytesBatch_Boundary5Concurrent: 恰好 5 个文件 → 走并发路径
func TestReadFileBytesBatch_Boundary5Concurrent(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	os.MkdirAll(ysmRoot, 0o755)
	paths := make([]string, 5)
	for i := range 5 {
		p := filepath.Join(ysmRoot, fmt.Sprintf("b5_%d.bin", i))
		os.WriteFile(p, []byte(fmt.Sprintf("content_%d", i)), 0o644)
		paths[i] = p
	}
	a := repoApp(t, types.AppConfig{FilesRoot: base})
	result := a.ReadFileBytesBatch(paths)
	testutil.Equal(t, len(result), 5, "5 文件应全读")
	for i, p := range paths {
		expected := fmt.Sprintf("content_%d", i)
		if string(result[p]) != expected {
			t.Errorf("文件 %s 内容不匹配: got %q, want %q", p, result[p], expected)
		}
	}
}

// TestReadFileBytesBatch_SequentialPartialFail: 顺序路径下部分文件不存在
func TestReadFileBytesBatch_SequentialPartialFail(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	os.MkdirAll(ysmRoot, 0o755)
	// 3 个存在 + 1 个不存在（总共 4 个，走顺序路径）
	paths := make([]string, 4)
	for i := range 3 {
		p := filepath.Join(ysmRoot, fmt.Sprintf("seq_exists_%d.bin", i))
		os.WriteFile(p, []byte(fmt.Sprintf("seq_data_%d", i)), 0o644)
		paths[i] = p
	}
	paths[3] = filepath.Join(ysmRoot, "seq_missing.bin")

	a := repoApp(t, types.AppConfig{FilesRoot: base})
	result := a.ReadFileBytesBatch(paths)
	testutil.Equal(t, len(result), 3, "期望 3 个存在的文件")
	// 验证存在的文件内容正确
	for i := range 3 {
		p := paths[i]
		expected := fmt.Sprintf("seq_data_%d", i)
		if string(result[p]) != expected {
			t.Errorf("文件 %s 内容不匹配", p)
		}
	}
	// 不存在的文件不应出现在结果中
	if _, exists := result[paths[3]]; exists {
		t.Errorf("不存在的文件不应出现在结果中")
	}
}

// TestReadFileBytesBatch_ContentCorrectness: 并发路径返回内容精确校验
func TestReadFileBytesBatch_ContentCorrectness(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	os.MkdirAll(ysmRoot, 0o755)
	const n = 8
	paths := make([]string, n)
	for i := range n {
		p := filepath.Join(ysmRoot, fmt.Sprintf("verify_%d.bin", i))
		content := []byte(fmt.Sprintf("unique_payload_%03d", i))
		os.WriteFile(p, content, 0o644)
		paths[i] = p
	}
	a := repoApp(t, types.AppConfig{FilesRoot: base})
	result := a.ReadFileBytesBatch(paths)

	for i, p := range paths {
		expected := fmt.Sprintf("unique_payload_%03d", i)
		got := string(result[p])
		if got != expected {
			t.Errorf("文件 %s 内容不匹配: got %q, want %q", p, got, expected)
		}
	}
}

// TestReadFileBytesBatchWithMeta_SymlinkEscapeRejected 钉住越权读防御契约：
// 仓库根内指向根外的符号链接不得被读取（isPathInRootOrSelf 的 Lstat+EvalSymlinks
// 复核是唯一拦截点——os.ReadFile 本身跟随 symlink，复核不命中即越权读出任意文件）。
// 守卫现收敛于调用方循环入口（readFileWithHashUnchecked 函数名即契约，不内置守卫）。
// 切片 C（ADR-331-d1）：条目不再 continue 静默丢弃——越权路径填 ErrorCode=INVALID_PATH
// 且 Data=nil（结构化错误通道），与成功条目同 key 保留；本测试锁定
// 「越权路径读不出任何字节」这一不变量，防守卫被旁路。
func TestReadFileBytesBatchWithMeta_SymlinkEscapeRejected(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	if err := os.MkdirAll(ysmRoot, 0o755); err != nil {
		testutil.NoError(t, err)
	}
	// 10 个合法文件（≥5 保并发分支）
	paths := make([]string, 10)
	for i := range 10 {
		p := filepath.Join(ysmRoot, fmt.Sprintf("ok_%d.bin", i))
		if err := os.WriteFile(p, []byte("ok"), 0o644); err != nil {
			testutil.NoError(t, err)
		}
		paths[i] = p
	}
	// 根**外** secret 目录（base 的兄弟，不在 FilesRoot 下）+ 根内 symlink 指向它
	outside := filepath.Join(t.TempDir(), "secret")
	if err := os.MkdirAll(outside, 0o755); err != nil {
		testutil.NoError(t, err)
	}
	secret := filepath.Join(outside, "secret.txt")
	if err := os.WriteFile(secret, []byte("top-secret"), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	link := filepath.Join(base, "ysm", "link")
	if err := os.Symlink(outside, link); err != nil {
		// Windows 无特权账户创建 symlink 会失败——按惯例跳过（特权环境仍真跑）
		t.Skipf("创建符号链接失败（Windows 无特权环境）: %v", err)
	}
	linkPath := filepath.Join(link, "secret.txt")
	paths = append(paths, linkPath)

	a := repoApp(t, types.AppConfig{FilesRoot: base})
	result := a.ReadFileBytesBatchWithMeta(paths)

	// 合法 10 个全在且读到字节
	if len(result) != 11 {
		t.Errorf("期望 11 个条目（10 成功 + 1 结构化错误）, got %d", len(result))
	}
	// symlink 指向根外：不得读出任何字节——条目保留但 Data=nil、ErrorCode 标越权
	entry, exists := result[linkPath]
	testutil.Equal(t, exists, true, "越权条目必须保留在 result（结构化错误通道，ADR-331-d1）") // 前置守卫：存在才比对 Data
	if len(entry.Data) != 0 {
		t.Error("根内 symlink 指向根外文件不得被读取（越权读防御回归）")
	}
	if entry.ErrorCode != string(types.ErrInvalidPath) {
		t.Errorf("越权条目 ErrorCode 应为 INVALID_PATH, got %q", entry.ErrorCode)
	}
}

// TestReadFileBytesBatchWithMeta_StructuredErrorFields 钉住切片 C（ADR-331-d1）的
// 结构化错误字段：越权路径、文件不存在、超限分别映射 INVALID_PATH / IO_ERROR /
// FILE_TOO_LARGE，且 Data=nil、Hash=""、条目保留（不再静默 continue）。
func TestReadFileBytesBatchWithMeta_StructuredErrorFields(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	if err := os.MkdirAll(ysmRoot, 0o755); err != nil {
		testutil.NoError(t, err)
	}

	valid := filepath.Join(ysmRoot, "ok.bin")
	if err := os.WriteFile(valid, []byte("ok"), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	// 越权：仓库根外路径（FilesRoot 之外）
	outside := filepath.Join(t.TempDir(), "secret.txt")
	if err := os.WriteFile(outside, []byte("top-secret"), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	// 不存在：仓库根内但不存在的路径
	missing := filepath.Join(ysmRoot, "nope.bin")

	a := repoApp(t, types.AppConfig{FilesRoot: base})
	// ≤4 条目走顺序分支
	result := a.ReadFileBytesBatchWithMeta([]string{valid, outside, missing})
	for _, p := range []string{valid, outside, missing} {
		e, ok := result[p]
		testutil.Equal(t, ok, true, "条目 %s 必须保留在 result（ADR-331-d1）", p) // 前置守卫：存在才比对字段
		if e.ErrorCode == "" && len(e.Data) == 0 {
			t.Errorf("条目 %s 成功但无数据", p)
		}
	}
	if v := result[valid]; v.ErrorCode != "" || len(v.Data) == 0 {
		t.Errorf("合法文件应无错误且有数据, got err=%q data=%d", v.ErrorCode, len(v.Data))
	}
	if v := result[outside]; v.ErrorCode != string(types.ErrInvalidPath) {
		t.Errorf("越权路径应 INVALID_PATH, got %q", v.ErrorCode)
	}
	if v := result[missing]; v.ErrorCode != string(types.ErrIO) {
		t.Errorf("不存在文件应 IO_ERROR, got %q", v.ErrorCode)
	}

	// 并发分支（≥5 条目）同契约
	paths := []string{valid, outside, missing}
	for i := 0; i < 6; i++ {
		p := filepath.Join(ysmRoot, fmt.Sprintf("c_%d.bin", i))
		if err := os.WriteFile(p, []byte("ok"), 0o644); err != nil {
			testutil.NoError(t, err)
		}
		paths = append(paths, p)
	}
	// 超限：并发分支内放一个超限文件——registry.MaxReadLimit 是 50MB，构造太大不划算；
	// 直接验证并发分支下的越权 + 不存在映射（超限映射已在 readFileWithHashUnchecked 单测覆盖）
	result2 := a.ReadFileBytesBatchWithMeta(paths)
	if v := result2[outside]; v.ErrorCode != string(types.ErrInvalidPath) {
		t.Errorf("并发分支越权路径应 INVALID_PATH, got %q", v.ErrorCode)
	}
	if v := result2[missing]; v.ErrorCode != string(types.ErrIO) {
		t.Errorf("并发分支不存在文件应 IO_ERROR, got %q", v.ErrorCode)
	}
	if len(result2) != len(paths) {
		t.Errorf("并发分支应保留全部条目, got %d, want %d", len(result2), len(paths))
	}
}
