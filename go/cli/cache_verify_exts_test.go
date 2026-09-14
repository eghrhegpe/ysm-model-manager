// ===== cache-verify 贴图口径收敛测试 =====
package cli

import (
	"bytes"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/internal/app"
)

// TestCacheVerify_ExtSetMatchesRegistry 钉住「cache-verify 扫描口径 = 缓存生产口径」。
//
// 背景：贴图扩展名单一事实源是 registry.IsTextureExt（.png/.jpg/.jpeg/.tga），
// 它决定 go/ysm 处理模型时哪些文件算「贴图」→ 进而决定哪些会产生 KTX2 缓存。
// 而 cache-verify 曾自带一份更宽的 cacheVerifyExts（多出 .bmp/.dds）——
// 那两个格式**不参与缓存生产管线**，扫到它们必然永远报 miss：
// 用户看到「贴图未缓存」会白重编码一遍，实际是口径错配导致的假 miss。
//
// 注：analyze-mmd 的 textureExts（含 .ktx2）是**资产盘点**语义（含已压缩产物），
// 与「原始贴图识别」不同，故不在此收敛——勿一并改掉。
func TestCacheVerify_ExtSetMatchesRegistry(t *testing.T) {
	withTempCache(t)
	dir := t.TempDir()

	// 单一事实源内的格式：应被识别为贴图（此处均未按内容缓存 → 全是 miss）
	testutil.WriteTestFileBytes(t, filepath.Join(dir, "a.png"), bytes.Repeat([]byte{0x89, 0x50}, 8))
	testutil.WriteTestFileBytes(t, filepath.Join(dir, "b.jpg"), bytes.Repeat([]byte{0xFF, 0xD8}, 8))
	testutil.WriteTestFileBytes(t, filepath.Join(dir, "c.jpeg"), bytes.Repeat([]byte{0xFF, 0xE0}, 8))
	testutil.WriteTestFileBytes(t, filepath.Join(dir, "d.tga"), bytes.Repeat([]byte{0x00, 0x01}, 8))
	// 非贴图形态：不应被计入贴图总数（否则恒报 miss，误导用户）
	testutil.WriteTestFileBytes(t, filepath.Join(dir, "e.bmp"), bytes.Repeat([]byte{0x42, 0x4D}, 8))
	testutil.WriteTestFileBytes(t, filepath.Join(dir, "f.dds"), bytes.Repeat([]byte{0x44, 0x44}, 8))
	testutil.WriteTestFileBytes(t, filepath.Join(dir, "g.txt"), []byte("not a texture"))

	out := captureOutput(t, func() {
		if err := runCacheVerify(&CmdContext{App: &app.App{}, Args: []string{"--dir", dir}}); err != nil {
			t.Fatalf("runCacheVerify 应成功, got %v", err)
		}
	})

	// 贴图总数应为 4（4 个受支持格式），而非 6
	if !strings.Contains(out, "贴图总数: 4") {
		t.Errorf("贴图总数应为 4（.bmp/.dds 不在缓存生产口径内）, got:\n%s", out)
	}
}
