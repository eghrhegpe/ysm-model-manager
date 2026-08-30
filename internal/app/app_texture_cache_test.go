package app

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/texture_cache"
)

// 审计 R18/R22 后发现的契约缺陷测试：
// HasCachedTextures 批量查询时 err 分支必须写入 key=false（而非静默缺失），
// 并记录日志——不能吞错（Go AGENTS「错误不要丢」），否则前端把出错当"未缓存"且无留痕。

func TestHasCachedTextures_CachedHitAndMiss(t *testing.T) {
	old := texture_cache.CacheDir
	defer func() { texture_cache.CacheDir = old }()

	dir := t.TempDir()
	texture_cache.CacheDir = func() string { return dir }

	// 命中 hash：手动放一个 KTX2 文件
	hitHash := "existshash"
	if err := os.WriteFile(filepath.Join(dir, hitHash+".ktx2"), []byte("data"), 0o644); err != nil {
		t.Fatal(err)
	}

	app := &App{}
	result := app.HasCachedTextures([]string{hitHash, "nope"})
	if !result[hitHash] {
		t.Fatalf("已缓存 hash %q 应返回 true，得到 %v", hitHash, result[hitHash])
	}
	if result["nope"] {
		t.Fatal("未命中 hash 应返回 false")
	}
	// 两个 hash 都必须出现在结果里（map 完整，不静默丢 key）
	if _, ok := result["nope"]; !ok {
		t.Fatal("未命中 hash 也应写入 key=false（map 必须包含所有查询的 hash）")
	}
}

// TestHasCachedTextures_CheckErrorWritesFalse
// 检查出错（含 NUL 的 hash → os.Stat 报非 IsNotExist 错误：POSIX EINVAL /
// Windows "invalid argument"）时，该 hash 必须显式写 false 而非静默缺失——
// 修复前 err 分支 `if err == nil` 跳过写入，前端读缺失 key 得 undefined，
// 错误被完全吞掉；修复后必须写 key=false 并留日志。
// 注意：不能用「CacheDir 指向普通文件」触发——Windows 下 os.Stat("文件/child")
// 返回 ERROR_PATH_NOT_FOUND（IsNotExist=true）走「未命中」分支，无法命中 err 分支。
func TestHasCachedTextures_CheckErrorWritesFalse(t *testing.T) {
	old := texture_cache.CacheDir
	defer func() { texture_cache.CacheDir = old }()

	dir := t.TempDir()
	texture_cache.CacheDir = func() string { return dir }

	app := &App{}
	result := app.HasCachedTextures([]string{"h\x00ash"})
	// 关键断言：err 分支也必须写入该 key（值 false = 视为未命中，前端安全回退）
	if _, ok := result["h\x00ash"]; !ok {
		t.Fatal("检查出错时该 hash 必须写入 key=false（修复前静默缺失，错误被吞）")
	}
	if result["h\x00ash"] {
		t.Fatal("检查出错时该 hash 应返回 false，不得误报命中")
	}
}
