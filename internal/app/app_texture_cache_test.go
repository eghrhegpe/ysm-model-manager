package app

import (
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/texture_cache"
	"ysm-model-manager/go/types"
	"ysm-model-manager/internal/testutil"
)

// 审计 R18/R22 后发现的契约缺陷测试：
// HasCachedTextures 批量查询时 err 分支必须写入 key=false（而非静默缺失），
// 并记录日志——不能吞错（Go AGENTS「错误不要丢」），否则前端把出错当"未缓存"且无留痕。

func TestHasCachedTextures_CachedHitAndMiss(t *testing.T) {
	old := texture_cache.CacheDir
	defer func() { texture_cache.CacheDir = old }()

	dir := t.TempDir()
	texture_cache.CacheDir = func() string { return dir }

	// 命中 hash：手动放一个 KTX2 文件（须为合法 SHA256 hex，否则命中绑定层 key 守卫）
	hitHash := "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
	if err := os.WriteFile(filepath.Join(dir, hitHash+".ktx2"), []byte("data"), 0o644); err != nil {
		testutil.NoError(t, err)
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

// 审计第三轮 D6：SaveCachedTexture 是写绑定，hash 为前端可控输入。
// 修复前 hash 直传 texture_cache.CachePath 拼 `filepath.Join(dir, hash+".ktx2")`，
// `..\..\evil` 经 Clean 折叠到缓存目录之外，且 WriteCached 会先 MkdirAll 建中间目录
// 再 WriteFileAtomic 落盘——真写越界（不只是读越界）。
// 本测试的关键断言是**越界文件不存在**，而非仅断言返回 error。
func TestSaveCachedTexture_TraversalHashRejected(t *testing.T) {
	parent := t.TempDir()
	cacheDir := filepath.Join(parent, "YSM-Model-Manager", "texture_cache")
	old := texture_cache.CacheDir
	defer func() { texture_cache.CacheDir = old }()
	texture_cache.CacheDir = func() string { return cacheDir }

	app := &App{}
	data := base64.StdEncoding.EncodeToString([]byte("fake-ktx2"))

	for _, evil := range []string{"..\\..\\evil", "../../evil", "C:/Users/x/evil"} {
		err := app.SaveCachedTexture(evil, data)
		if err == nil {
			t.Fatalf("SaveCachedTexture(%q) 应拒绝非法缓存 key", evil)
		}
		var ae types.AppError
		if !errors.As(err, &ae) || ae.Code != types.ErrInvalidPath {
			t.Errorf("SaveCachedTexture(%q) 应返回 AppError{INVALID_PATH}，实得 %T: %v", evil, err, err)
		}
		// 关键：越界路径绝不能被创建（MkdirAll + WriteFileAtomic 的靶点）。
		// 断言用「stat 必须报错」而非 ErrNotExist——非纯相对段的 key（如 `C:/...`）
		// 经 filepath.Join 会产出不合法路径，stat 报语法错而非 NotExist。
		target := filepath.Join(cacheDir, evil+".ktx2")
		if _, statErr := os.Stat(target); statErr == nil {
			t.Errorf("越界文件不应存在 %s", target)
		}
	}
}

func TestGetCachedTextureByHash_InvalidKey(t *testing.T) {
	app := &App{}
	_, err := app.GetCachedTextureByHash("../../etc/passwd")
	var ae types.AppError
	if !errors.As(err, &ae) || ae.Code != types.ErrInvalidPath {
		t.Fatalf("非法 key 应返回 AppError{INVALID_PATH}，实得 %T: %v", err, err)
	}
}

func TestHasCachedTexture_InvalidKey(t *testing.T) {
	app := &App{}
	ok, err := app.HasCachedTexture("..\\..\\sneaky")
	if ok {
		t.Fatal("非法 key 不得误报命中")
	}
	var ae types.AppError
	if !errors.As(err, &ae) || ae.Code != types.ErrInvalidPath {
		t.Fatalf("非法 key 应返回 AppError{INVALID_PATH}，实得 %T: %v", err, err)
	}
}

// 批量版沿用既有契约：非法 key 写 key=false + 留日志，不整批失败。
func TestHasCachedTextures_InvalidKeyWritesFalse(t *testing.T) {
	old := texture_cache.CacheDir
	defer func() { texture_cache.CacheDir = old }()
	texture_cache.CacheDir = func() string { return t.TempDir() }

	app := &App{}
	bad := "..\\..\\bulk"
	result := app.HasCachedTextures([]string{bad, "nope"})
	if result[bad] {
		t.Fatal("非法 key 不得误报命中")
	}
	if _, present := result[bad]; !present {
		t.Fatal("非法 key 也必须写入 key=false（不得静默缺失）")
	}
}
