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
	root := filepath.Join(base, types.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "[testuser]model.ysm"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	// 预写 JPEG 魔数头像到缓存（safe name "testuser" → testuser.png）
	jpegBytes := []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10}
	avatar.SaveAvatarData("testuser", jpegBytes, "image/jpeg")

	result, err := a.BatchExtractCreatorAvatars()
	if err != nil {
		t.Fatal(err)
	}
	got := result["testuser"]
	if !strings.HasPrefix(got, "data:image/jpeg;base64,") {
		t.Fatalf("JPEG 头像应嗅探为 image/jpeg, 得到 %q", got)
	}
}
