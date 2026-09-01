package app

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

// Build3DSpecFromGeometryJSON：Android 等无 Node 环境的 .ysm 3D 兜底通道
// （前端 WASM 解码出 geometry JSON → 本 binding 复用 threejs.BuildMulti 构建 spec）
func TestBuild3DSpecFromGeometryJSON(t *testing.T) {
	a := &App{}
	// 空输入 → error（got 为 nil）
	if got, err := a.Build3DSpecFromGeometryJSON(""); err == nil || got != nil {
		t.Fatalf("空输入应返回 error 且 got=nil，got %v err %v", got, err)
	}
	// 非法 JSON → ParseBedrockGeometry 返回 nil → 空 spec（无 models）。
	// 旧契约返回 "{}"（不可用信号）；新契约下仍无 models，但非 error。
	if got, err := a.Build3DSpecFromGeometryJSON("not json"); got == nil || len(got.Models) != 0 {
		t.Fatalf("非法 JSON 应返回空 spec，got %v err %v", got, err)
	}

	const geo = `{
  "format_version": "1.12.0",
  "minecraft:geometry": [{
    "description": { "identifier": "geometry.test", "texture_width": 64, "texture_height": 32 },
    "bones": [{ "name": "bone1", "pivot": [0, 0, 0], "cubes": [{ "origin": [-4, 0, -4], "size": [8, 8, 8] }] }]
  }]
}`
	got, err := a.Build3DSpecFromGeometryJSON(geo)
	if err != nil {
		t.Fatalf("合法 geometry 不应报错: %v", err)
	}
	if got == nil {
		t.Fatal("合法 geometry 应构建出 spec，got nil")
	}
	if len(got.Models) == 0 {
		t.Fatalf("spec.models 为空")
	}
	if len(got.Models[0].MeshGroups) == 0 {
		t.Fatalf("spec.models[0].MeshGroups 为空（cube 未生成顶点）")
	}
}

// TestReadFileBytes_MultiRootGuard：路径守卫须放行兄弟类型根（VrcRoot 等），
// 拒绝 ysm 根外路径——修复「ReadFileBytes 返回空」（VRM 预览失败，2026-08-16）。
// 守卫口径与 ScanModelEntries 对齐：扫描能列出的文件就能读。
func TestReadFileBytes_MultiRootGuard(t *testing.T) {
	base := t.TempDir()
	vrcRoot := filepath.Join(base, "vrchat")
	if err := os.MkdirAll(vrcRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	content := []byte("vrm-bytes")
	vrmPath := filepath.Join(vrcRoot, "avatar.vrm")
	if err := os.WriteFile(vrmPath, content, 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := types.AppConfig{FilesRoot: filepath.Join(base, "ysm"), VrcRoot: vrcRoot}
	a := repoApp(t, cfg)

	// 1. 兄弟类型根（VrcRoot）内文件可读（修复目标）
	if got := a.ReadFileBytes(vrmPath); string(got) != "vrm-bytes" {
		t.Fatalf("VrcRoot 内文件应可读，got %q", got)
	}
	// 2. ysm 根内文件仍可读（回归：既有行为不破坏）
	ysmRoot := filepath.Join(cfg.FilesRoot, types.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(ysmRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	ysmPath := filepath.Join(ysmRoot, "a.ysm")
	if err := os.WriteFile(ysmPath, content, 0o644); err != nil {
		t.Fatal(err)
	}
	if got := a.ReadFileBytes(ysmPath); string(got) != "vrm-bytes" {
		t.Fatalf("ysm 根内文件应可读，got %q", got)
	}
	// 3. 根外路径仍拒绝（守卫未放松）
	outside := filepath.Join(base, "..", "outside.ysm")
	if got := a.ReadFileBytes(outside); got != nil {
		t.Fatalf("根外路径应拒绝（nil），got %q", got)
	}
	// 4. 不存在的文件返回 nil（不抛错，与既有契约一致）
	if got := a.ReadFileBytes(filepath.Join(vrcRoot, "missing.vrm")); got != nil {
		t.Fatalf("不存在文件应返回 nil，got %q", got)
	}
}

// ===== ReadFileBytesBatch 并发优化测试 =====

// TestReadFileBytesBatch_SmallBatchSequential: <= 4 文件走顺序路径
func TestReadFileBytesBatch_SmallBatchSequential(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	if err := os.MkdirAll(ysmRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	paths := make([]string, 4)
	for i := range 4 {
		p := filepath.Join(ysmRoot, fmt.Sprintf("file_%d.bin", i))
		if err := os.WriteFile(p, []byte(fmt.Sprintf("data_%d", i)), 0o644); err != nil {
			t.Fatal(err)
		}
		paths[i] = p
	}
	a := repoApp(t, types.AppConfig{FilesRoot: base})
	result := a.ReadFileBytesBatch(paths)
	if len(result) != 4 {
		t.Fatalf("期望 4 个文件，got %d", len(result))
	}
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
		t.Fatal(err)
	}
	const n = 16
	paths := make([]string, n)
	for i := range n {
		p := filepath.Join(ysmRoot, fmt.Sprintf("file_%d.bin", i))
		if err := os.WriteFile(p, []byte(fmt.Sprintf("data_%d", i)), 0o644); err != nil {
			t.Fatal(err)
		}
		paths[i] = p
	}
	a := repoApp(t, types.AppConfig{FilesRoot: base})
	result := a.ReadFileBytesBatch(paths)
	if len(result) != n {
		t.Fatalf("期望 %d 个文件，got %d", n, len(result))
	}
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
		t.Fatal(err)
	}
	validPaths := make([]string, 10)
	for i := range 10 {
		p := filepath.Join(ysmRoot, fmt.Sprintf("valid_%d.bin", i))
		os.WriteFile(p, []byte("ok"), 0o644)
		validPaths[i] = p
	}
	// 混入 3 个非法路径
	paths := append(validPaths,
		filepath.Join(base, "..", "outside.bin"),
		"",
		filepath.Join(base, "nonexistent", "dir", "file.bin"),
	)
	a := repoApp(t, types.AppConfig{FilesRoot: base})
	result := a.ReadFileBytesBatch(paths)
	// 仅合法路径应出现在结果中
	if len(result) != 10 {
		t.Fatalf("期望 10 个合法文件，got %d", len(result))
	}
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
	if len(result) != 0 {
		t.Fatalf("空输入应返回空 map，got %d", len(result))
	}
}

// TestReadFileBytesBatch_ConcurrentPartialFail: 并发路径下部分文件不存在不影响其他
func TestReadFileBytesBatch_ConcurrentPartialFail(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	if err := os.MkdirAll(ysmRoot, 0o755); err != nil {
		t.Fatal(err)
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
	if len(result) != 10 {
		t.Fatalf("期望 10 个存在的文件，got %d", len(result))
	}
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
	if len(result) != 4 {
		t.Fatalf("4 文件应全读，got %d", len(result))
	}
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
	if len(result) != 5 {
		t.Fatalf("5 文件应全读，got %d", len(result))
	}
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
	if len(result) != 3 {
		t.Fatalf("期望 3 个存在的文件，got %d", len(result))
	}
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
