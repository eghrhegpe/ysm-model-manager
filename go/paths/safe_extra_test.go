// ===== HasTraversal / ResolveOrKeep 补测 =====
// R18 审核修复链（e8bf1467/af8240c3）收敛了 5 种手写 Contains("../") 检查为
// HasTraversal 单一入口、新增 ResolveOrKeep 缓存复用——变更行此前零覆盖。
package paths

import (
	"path/filepath"
	"testing"
)

func TestHasTraversal(t *testing.T) {
	cases := []struct {
		name string
		p    string
		want bool
	}{
		{"空串", "", false},
		{"纯文件名", "model.ysm", false},
		{"子路径合法", "sub/model.ysm", false},
		{"单段 ..", "..", true},
		{"前缀 ../", "../x", true},
		{"前缀反斜杠 ..\\", `..\x`, true},
		{"后缀 /..", "a/..", true},
		{"后缀反斜杠 \\..", `a\..`, true},
		{"中间段 /../", "a/../b", true},
		{"中间段反斜杠 \\..\\", `a\..\b`, true},
		{"..foo 合法段不误判", "..foo/bar", false},
		{"foo.. 合法段不误判", "foo..", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := HasTraversal(c.p); got != c.want {
				t.Errorf("HasTraversal(%q) = %v, want %v", c.p, got, c.want)
			}
		})
	}
}

func TestResolveOrKeep(t *testing.T) {
	dir := t.TempDir()
	// 存在的目录 → EvalSymlinks 成功，解析为真实路径（非空）
	if got := ResolveOrKeep(dir); got == "" {
		t.Fatal("存在路径应解析非空")
	}
	// 不存在的路径 → 保留原样（EvalSymlinks 失败不 panic 不改写）
	missing := filepath.Join(dir, "does-not-exist")
	if got := ResolveOrKeep(missing); got != missing {
		t.Errorf("不存在路径应保留原样, got %q want %q", got, missing)
	}
}
