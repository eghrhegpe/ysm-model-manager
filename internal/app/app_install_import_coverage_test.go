// ===== DetectContainerType / importModelFile 守卫 / SaveCachedTexture 补测 =====
// R18 审核修复链变更行覆盖（9e0b72c2 尾部探针 + af8240c3/e8bf1467 base64 受限
// 解码统一）：App 侧包装层变更行此前 36.4%/0%，此处补齐三组。
package app

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"testing"

	"ysm-model-manager/go/texture_cache"
)

func buildZipB64T(t *testing.T, entries map[string]string) string {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for name, content := range entries {
		fw, err := w.Create(name)
		if err != nil {
			t.Fatalf("Create %s: %v", name, err)
		}
		if _, err := fw.Write([]byte(content)); err != nil {
			t.Fatalf("Write %s: %v", name, err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	return base64.StdEncoding.EncodeToString(buf.Bytes())
}

// TestDetectContainerType_TailProbeAndFallback 覆盖 DetectContainerType 尾部探针命中 /
// 整包兜底无特征 / 解码失败 → unknown 三态（9e0b72c2 audit #1 口径）。
func TestDetectContainerType_TailProbeAndFallback(t *testing.T) {
	a, _ := guardedApp(t)

	// 合法 zip（含 ysm.json）→ 尾部探针命中，返回非空类型
	okZip := buildZipB64T(t, map[string]string{"ysm.json": "{}", "model/body.ysm": "x"})
	if got := a.DetectContainerType(okZip); got == "" {
		t.Error("合法 zip 应探测出非空类型（尾部探针命中）")
	}

	// 有效 base64 但非 zip → 探针回退 → 整包兜底 → 无特征空串
	garbage := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0xAB}, 256))
	if got := a.DetectContainerType(garbage); got != "" {
		t.Errorf("非 zip 应返回空串, got %q", got)
	}

	// 非法 base64 → DecodeBase64Limited 失败 → unknown
	if got := a.DetectContainerType("not-base64!!"); got != "unknown" {
		t.Errorf("非法 base64 应返回 unknown, got %q", got)
	}
}

// TestImportModelFile_TraversalRejected 覆盖 importModelFileWithSubpath 透传
// 的路径穿越守卫（HasTraversal 收敛口径）：拒绝且不落盘。
// （原经已删除的 ImportModelFileTo 绑定壳，迁移至内部函数保持守卫覆盖）
func TestImportModelFile_TraversalRejected(t *testing.T) {
	a, _ := guardedApp(t)
	if err := a.importModelFileWithSubpath("../evil.ysm", "", base64.StdEncoding.EncodeToString([]byte("x")), false); err == nil {
		t.Error("路径穿越文件名应被拒绝")
	}
}

// TestSaveCachedTexture 覆盖 SaveCachedTexture 的 DecodeBase64Limited 变更行
// （af8240c3 统一受限解码口径）：合法 base64 写入成功、非法 base64 报错。
func TestSaveCachedTexture(t *testing.T) {
	orig := texture_cache.CacheDir
	texture_cache.CacheDir = func() string { return t.TempDir() }
	t.Cleanup(func() { texture_cache.CacheDir = orig })

	a, _ := guardedApp(t)
	if err := a.SaveCachedTexture("h1", base64.StdEncoding.EncodeToString([]byte("ktx2-data"))); err != nil {
		t.Fatalf("合法 base64 应写入成功: %v", err)
	}
	if err := a.SaveCachedTexture("h2", "not-base64!!"); err == nil {
		t.Error("非法 base64 应报错")
	}
}
