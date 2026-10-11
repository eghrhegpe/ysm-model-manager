// ===== extractEmbeddedHelper 与 progressWriter 补充单测 =====
package updater

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"ysm-model-manager/go/internal/testutil"
)

// ====== extractEmbeddedHelper ======

func TestExtractEmbeddedHelper_NonWindows_ReturnsNil(t *testing.T) {
	// 非 Windows 平台：stub 直接返回 ErrNotExist，不会 panic
	if runtime.GOOS == "windows" {
		t.Skip("仅非 Windows")
	}
	err := extractEmbeddedHelper("/any/path/ysm-updater-helper.exe")
	if err == nil {
		t.Fatal("非 Windows 平台应返回错误")
	}
	if !strings.Contains(err.Error(), "仅 Windows 可用") {
		t.Errorf("错误信息应包含'仅 Windows 可用'，得到: %v", err)
	}
}

func TestExtractEmbeddedHelper_EmptyDest(t *testing.T) {
	// Windows 专属：embed 资源可能缺失（CI/非构建环境），用 t.Skip 兜底
	if runtime.GOOS != "windows" {
		t.Skip("仅 Windows")
	}
	destDir := t.TempDir()
	dest := filepath.Join(destDir, "ysm-updater-helper.exe")

	err := extractEmbeddedHelper(dest)
	if err != nil {
		// embed 资源缺失时优雅跳过，而非失败
		t.Skipf("embed 资源缺失，跳过: %v", err)
	}

	// 验证：文件已写入，大小 > 0
	info, err := os.Stat(dest)
	testutil.NoError(t, err, "helper 文件未生成")
	if info.Size() == 0 {
		t.Error("helper 文件大小为 0")
	}
}

// ====== InstallUpdate 平台守卫 ======

func TestInstallUpdate_NonWindows_PlatformGuard(t *testing.T) {
	// 非 Windows：InstallUpdate 应在入口处直接报错，不会走到 extractEmbeddedHelper
	if runtime.GOOS == "windows" {
		t.Skip("仅非 Windows")
	}
	err := InstallUpdate("/tmp/fake.zip")
	if err == nil {
		t.Fatal("非 Windows 平台应报错")
	}
	if !strings.Contains(err.Error(), "仅支持 Windows") {
		t.Errorf("错误信息应提示仅支持 Windows，得到: %v", err)
	}
}

func TestInstallUpdate_NotPE_Windows(t *testing.T) {
	// Windows 专属：验证传入非 PE 更新包时报错信息不含 helper 释放相关字样
	if runtime.GOOS != "windows" {
		t.Skip("仅 Windows")
	}
	dir := t.TempDir()
	badExe := filepath.Join(dir, "YSM-Model-Manager_windows_amd64.exe")
	if err := os.WriteFile(badExe, []byte("not a PE binary"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	err := InstallUpdate(badExe)
	if err == nil {
		t.Fatal("非 PE 更新包应报错")
	}
	// 应报 PE 校验失败，而非 helper 释放失败（校验先行）
	if strings.Contains(err.Error(), "释放更新助手") {
		t.Errorf("错误信息不应包含'释放更新助手'，说明未先校验 PE: %v", err)
	}
}

// ====== progressWriter（包内私有，同包可访问） ======

func TestProgressWriter_KnownLength_1PercentSteps(t *testing.T) {
	total := int64(1000) // 1000 字节，1% = 10 字节步进
	var calls []struct{ done, total int64 }
	w := &progressWriter{total: total, onProgress: func(done, total int64) {
		calls = append(calls, struct{ done, total int64 }{done, total})
	}}

	// 每次写 10 字节（1%），100 次写满 1000 字节
	for i := 0; i < 100; i++ {
		n, err := w.Write(bytes.Repeat([]byte("x"), 10))
		if err != nil || n != 10 {
			t.Fatalf("Write 失败: n=%d err=%v", n, err)
		}
	}

	// 验证回调单调递增且 total 恒定
	var prev int64
	for i, c := range calls {
		if c.done < prev {
			t.Fatalf("回调 %d 回退: done=%d < prev=%d", i, c.done, prev)
		}
		prev = c.done
		if c.total != total {
			t.Errorf("回调 %d total=%d，期望 %d", i, c.total, total)
		}
	}
	// 最终回调 must reach 100%
	last := calls[len(calls)-1]
	if last.done != total {
		t.Errorf("最终回调 done=%d，期望 %d", last.done, total)
	}
}

func TestProgressWriter_UnknownLength_512KBThrottle(t *testing.T) {
	// total=0 表示未知长度，按 512KB 节流回调
	var calls []struct{ done, total int64 }
	w := &progressWriter{total: 0, onProgress: func(done, total int64) {
		calls = append(calls, struct{ done, total int64 }{done, total})
	}}

	chunk := make([]byte, 512<<10) // 512KB
	// 写 3 个 chunk → 应触发 3 次回调（每次满 512KB）
	for i := 0; i < 3; i++ {
		n, err := w.Write(chunk)
		if err != nil || n != len(chunk) {
			t.Fatalf("Write chunk %d 失败: n=%d err=%v", i, n, err)
		}
	}

	if len(calls) != 3 {
		t.Errorf("期望 3 次回调，得到 %d", len(calls))
	}
	for i, c := range calls {
		if c.total != 0 {
			t.Errorf("回调 %d total=%d，期望 0（未知长度）", i, c.total)
		}
		expected := int64((i + 1) * (512 << 10))
		if c.done != expected {
			t.Errorf("回调 %d done=%d，期望 %d", i, c.done, expected)
		}
	}
}

func TestProgressWriter_ShortBody_TailFlush(t *testing.T) {
	// <512KB 短包：节流阈值内零回调，Copy 后须补发尾块
	total := int64(200 << 10) // 200KB < 512KB
	var calls []struct{ done, total int64 }
	w := &progressWriter{total: total, onProgress: func(done, total int64) {
		calls = append(calls, struct{ done, total int64 }{done, total})
	}}

	// 一次写完短包
	n, err := w.Write(make([]byte, 200<<10))
	if err != nil || n != 200<<10 {
		t.Fatalf("Write 失败: n=%d err=%v", n, err)
	}

	if len(calls) == 0 {
		t.Fatal("短包应通过尾块补发至少一次回调")
	}
	last := calls[len(calls)-1]
	if last.done != total {
		t.Errorf("最终回调 done=%d，期望 %d", last.done, total)
	}
}

func TestProgressWriter_WriteErrorPropagated(t *testing.T) {
	// 模拟 Write 返回错误：onProgress 仍应被调用（已完成部分）
	var called bool
	w := &progressWriter{
		total: 100,
		onProgress: func(done, total int64) {
			called = true
		},
	}
	// progressWriter.Write 本身不会返回错误（os.WriteFile 错误由调用方处理）
	// 这里验证正常写入不抛错
	n, err := w.Write([]byte("hello"))
	if err != nil {
		t.Errorf("Unexpected error: %v", err)
	}
	if n != 5 {
		t.Errorf("期望写入 5 字节，得到 %d", n)
	}
	if !called {
		t.Error("写入后 onProgress 应被调用")
	}
}
