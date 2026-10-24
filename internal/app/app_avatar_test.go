// ===== app_avatar.go 薄壳级单测（R20 审核 P2-1 修复验证）=====
// 覆盖：BatchExtractCreatorAvatars 缓存命中路径的 MIME 一致性（JPEG 嗅探）。
package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/avatar"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
	"ysm-model-manager/internal/testutil"
)

// TestBatchExtractCreatorAvatars_CachedMime JPEG 头像缓存命中时，
// BatchExtractCreatorAvatars 必须返回 image/jpeg 而非硬编码 image/png
// （与 CachedCreatorAvatar 口径一致——R20 审核 P2-1：同缓存文件两条 binding
// 返回不同 MIME，导出 data URI 给外部工具时 type 不匹配）。
func TestBatchExtractCreatorAvatars_CachedMime(t *testing.T) {
	oldCacheDir := avatar.CacheDir
	tmpCache := t.TempDir()
	avatar.CacheDir = func() string { return tmpCache }
	t.Cleanup(func() { avatar.CacheDir = oldCacheDir })

	// 临时仓库根：ysm/[testuser]model.ysm 走真实扫描
	base := t.TempDir()
	root := filepath.Join(base, registry.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(root, "[testuser]model.ysm"), []byte("x"), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	// 预写 JPEG 魔数头像到缓存（safe name "testuser" → testuser.png）
	jpegBytes := []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10}
	avatar.SaveAvatarData("testuser", jpegBytes, "image/jpeg")

	result, err := a.BatchExtractCreatorAvatars()
	testutil.NoError(t, err)
	got := result["testuser"]
	if !strings.HasPrefix(got, "data:image/jpeg;base64,") {
		t.Fatalf("JPEG 头像应嗅探为 image/jpeg, 得到 %q", got)
	}
}

// TestCreatorAuthorKeyTrimCohesion `[作者]` 解析单点判据锁（锐评 2026-10-16）：
// 含空格作者名 "[ 张三 ]m.ysm"，作者列表侧（ListModelAuthors→scanner.ExtractAuthor）
// 与头像 map 侧（BatchExtractCreatorAvatars）必须产出**同一个键** "张三"。
// 病灶实证：原 app_avatar 手抄解析判据并自行 TrimSpace，而 scanner 侧不 trim——
// 作者列表显示 " 张三 "、按名查头像 map 恒 miss（头像永不显示）。同一事实两份
// 手抄必然漂移的反面教材，修复方式 = 两侧共用 scanner.ExtractAuthor 单点。
func TestCreatorAuthorKeyTrimCohesion(t *testing.T) {
	oldCacheDir := avatar.CacheDir
	tmpCache := t.TempDir()
	avatar.CacheDir = func() string { return tmpCache }
	t.Cleanup(func() { avatar.CacheDir = oldCacheDir })

	base := t.TempDir()
	root := filepath.Join(base, registry.GroupStorageRoot("ysm"))
	testutil.NoError(t, os.MkdirAll(root, 0o755))
	testutil.NoError(t, os.WriteFile(filepath.Join(root, "[ 张三 ]m.ysm"), []byte("x"), 0o644))
	// 头像按 trim 后名字预写入缓存（前端展示/查询都用该键）
	avatar.SaveAvatarData("张三", []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10}, "image/jpeg")

	a := scanApp(t, types.AppConfig{FilesRoot: base})

	authors := a.ListModelAuthors()
	testutil.Equal(t, len(authors), 1, "作者列表应唯一且键已 trim：got %+v", authors)
	testutil.Equal(t, authors[0].Name, "张三", "作者列表应唯一且键已 trim：got %+v", authors)
	result, err := a.BatchExtractCreatorAvatars()
	testutil.NoError(t, err)
	uri := result["张三"]
	testutil.Equal(t, uri != "", true, "头像 map 键须与作者列表同源（trim 后 \"张三\"），got %v", result)
}
