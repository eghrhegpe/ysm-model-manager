// ===== app_avatar.go ADR-343 单点重构后的分支单测（scanner.ExtractAuthor + ForBrowse）=====
// 重构后作者解析走 scanner.ExtractAuthor 单点、条目源改 ScanModelEntriesForBrowse
// （浏览投影，免全库哈希税）。本文件锁各分支执行：空作者 continue / IsTypeModelFile
// 命中与跳过 / 同作者 ModTime 取最新 / Debug 提取命中与未命中。
package app

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"ysm-model-manager/go/avatar"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
	"ysm-model-manager/internal/testutil"
)

// redirectAvatarCache 头像缓存重定向到临时目录（防写穿真实用户缓存，同既有测试口径）。
func redirectAvatarCache(t *testing.T) {
	t.Helper()
	oldCacheDir := avatar.CacheDir
	tmpCache := t.TempDir()
	avatar.CacheDir = func() string { return tmpCache }
	t.Cleanup(func() { avatar.CacheDir = oldCacheDir })
}

// TestBatchExtractCreatorAvatars_ExtractAuthorBranches 批量提取作者解析分支矩阵：
//   - "noprefix.ysm"：无 [作者] 前缀 → ExtractAuthor 返回空 → continue；
//   - "[作者A]" 三件套（显式 ModTime 控制新旧）：首个进 seen（!ok 分支）、
//     更新者覆盖（e.ModTime > cur 命中）、更旧者不覆盖（不命中）；
//   - "[作者B]off.ysm.disabled"：禁用后缀不在 ysm 扩展集 → IsTypeModelFile 跳过分支。
//
// 头像数据源为假模型（无内嵌头像、缓存预写仅覆盖命中路径），result 键断言走缓存命中。
func TestBatchExtractCreatorAvatars_ExtractAuthorBranches(t *testing.T) {
	redirectAvatarCache(t)

	base := t.TempDir()
	root := filepath.Join(base, registry.GroupStorageRoot("ysm"))
	testutil.NoError(t, os.MkdirAll(root, 0o755), "fixture 建根失败")
	files := []string{
		"noprefix.ysm",          // 空作者 continue
		"[作者A]new1.ysm",         // 扫描序第一（字典序 new1 < new2 < old）
		"[作者A]new2.ysm",         // ModTime 更新 → 覆盖
		"[作者A]old.ysm",          // ModTime 更旧 → 不覆盖
		"[作者B]off.ysm.disabled", // 非活跃 ysm 模型 → 跳过
	}
	for _, f := range files {
		testutil.NoError(t, os.WriteFile(filepath.Join(root, f), []byte("x"), 0o644), "fixture 写入失败 %s", f)
	}
	// 显式 ModTime（扫描序按路径字典序 new1 → new2 → old）：
	// new1(now-3h) 进 seen（!ok）→ new2(now-1h) 更新命中覆盖分支 → old(now-2h) 不命中不覆盖
	new1 := time.Now().Add(-3 * time.Hour)
	new2 := time.Now().Add(-1 * time.Hour)
	old := time.Now().Add(-2 * time.Hour)
	testutil.NoError(t, os.Chtimes(filepath.Join(root, "[作者A]new1.ysm"), new1, new1), "Chtimes 失败")
	testutil.NoError(t, os.Chtimes(filepath.Join(root, "[作者A]new2.ysm"), new2, new2), "Chtimes 失败")
	testutil.NoError(t, os.Chtimes(filepath.Join(root, "[作者A]old.ysm"), old, old), "Chtimes 失败")

	// 作者A 预写缓存头像 → result 命中缓存键（ExtractAuthor trim/解析口径联动验证）
	avatar.SaveAvatarData("作者A", []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10}, "image/jpeg")

	a := scanApp(t, types.AppConfig{FilesRoot: base})
	result, err := a.BatchExtractCreatorAvatars()
	testutil.NoError(t, err)
	testutil.Equal(t, result["作者A"] != "", true, "作者A 应进 result（缓存命中 data URI）: %v", result)
	_, hasB := result["作者B"]
	testutil.Equal(t, hasB, false, "IsTypeModelFile 跳过分支：作者B 不应进 result: %v", result)
	testutil.Equal(t, len(result), 1, "仅 作者A 命中缓存: %v", result)
}

// TestDebugExtractCreatorAvatar_HitAndMiss 调试版提取命中/未命中分支：
// 命中 → found_path 落 info；假模型无内嵌头像 → status=extract_failed 留痕。
// 未命中 → status=no_model_file_found 且无 found_path 键。
func TestDebugExtractCreatorAvatar_HitAndMiss(t *testing.T) {
	redirectAvatarCache(t)

	base := t.TempDir()
	root := filepath.Join(base, registry.GroupStorageRoot("ysm"))
	testutil.NoError(t, os.MkdirAll(root, 0o755), "fixture 建根失败")
	testutil.NoError(t, os.WriteFile(filepath.Join(root, "[作者A]m.ysm"), []byte("x"), 0o644), "fixture 写模型失败")
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	hit := a.DebugExtractCreatorAvatar("作者A")
	testutil.Equal(t, hit["found_path"] != "", true, "命中作者应带 found_path: %v", hit)
	testutil.Equal(t, hit["status"], "extract_failed", "假模型无内嵌头像应落 extract_failed 留痕")

	miss := a.DebugExtractCreatorAvatar("不存在作者")
	_, hasPath := miss["found_path"]
	testutil.Equal(t, hasPath, false, "未命中不应带 found_path 键: %v", miss)
	testutil.Equal(t, miss["status"], "no_model_file_found", "未命中应落 no_model_file_found")
}
