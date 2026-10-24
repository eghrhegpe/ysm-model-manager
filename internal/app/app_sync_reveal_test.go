package app

import (
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/internal/testutil"
)

// TestConflictLocalPath 冲突文件路径解析 + 越界守卫（2026-10-14）。
//
// 立因：`RevealConflictFile` 的 relPath 现由前端递入，属**不可信输入**——守卫若失守，
// 用户点一下「在资源管理器中显示」就能把资源管理器带到整合包目录之外（甚至给
// `RevealInExplorer` 喂任意路径）。守卫与 `ResolveConflict` 同款（paths.RelInside）。
//
// 为什么这样测：端到端调 `RevealConflictFile` 会真的拉起 explorer.exe，测试不能靠启动
// 资源管理器来验证一条路径拼接——故解析+守卫抽为纯函数 `conflictLocalPath`。
func TestConflictLocalPath(t *testing.T) {
	t.Parallel()
	root := t.TempDir()

	t.Run("正常相对路径 → 拼到根内", func(t *testing.T) {
		got, err := conflictLocalPath(root, "a/模型.ysm")
		testutil.NoError(t, err, "合法路径不应报错")
		want := filepath.Join(root, "a", "模型.ysm")
		if got != want {
			t.Errorf("解析结果 %q，期望 %q", got, want)
		}
	})

	t.Run("前后空白被裁剪（前端属性传递可能带空白）", func(t *testing.T) {
		got, err := conflictLocalPath(root, "  a/b.png \t")
		testutil.NoError(t, err, "裁剪后应合法")
		if got != filepath.Join(root, "a", "b.png") {
			t.Errorf("解析结果 %q 未按裁剪后的相对路径拼接", got)
		}
	})

	t.Run("空路径 → 报错，不返回根目录本身", func(t *testing.T) {
		// 空路径若被当作合法，Join(root,"") = root → 资源管理器会打开整个整合包目录，
		// 看起来「成功」实则定位到了错误位置（诚实性：宁可报错）
		for _, in := range []string{"", "   "} {
			if got, err := conflictLocalPath(root, in); err == nil {
				t.Errorf("输入 %q 应报错，实际返回 %q", in, got)
			}
		}
	})

	t.Run("越界路径（.. 穿透）→ 拒绝并指明越界", func(t *testing.T) {
		for _, in := range []string{"../escape.ysm", "a/../../escape.ysm", "..\\escape.ysm"} {
			_, err := conflictLocalPath(root, in)
			if err == nil {
				t.Errorf("输入 %q 应被越界守卫拒绝", in)
				continue
			}
			if !strings.Contains(err.Error(), "冲突路径越界") {
				t.Errorf("输入 %q 的错误应指明越界，实际: %v", in, err)
			}
		}
	})

	t.Run("绝对路径输入被 Join 归一进根内（不逃逸，但也不接受其原意）", func(t *testing.T) {
		// filepath.Join(root, "/etc/passwd") 在 Windows/Unix 都归一为 root 下的子路径：
		// 不会逃出根（安全），但也**不**等于调用方给的字面绝对路径——此断言钉住这一事实，
		// 防有人「顺手」把 Join 改成直接返回入参（那才会真的逃逸）。
		got, err := conflictLocalPath(root, "/etc/passwd")
		testutil.NoError(t, err, "归一后应落在根内、不报错")
		rel, relErr := filepath.Rel(root, got)
		if relErr != nil || strings.HasPrefix(rel, "..") {
			t.Errorf("绝对路径输入逃出了根: %q", got)
		}
	})
}
