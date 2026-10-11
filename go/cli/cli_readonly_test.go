package cli

import (
	"sort"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

// 语义分级（锐评 2026-10-11 收口）：GetAllowedCommands 只暴露只读命令（fail-closed），
// mutating 命令（移动/删除/写缓存/写配置/写标签/安装）不得出现在前端可调列表里——
// 否则进程内桥（ADR-199）与 GUI 同驻派生缓存，一调就绕过绑定层的失效/标签跟随。
func TestGetAllowedCommands_OnlyReadOnly(t *testing.T) {
	for _, name := range GetAllowedCommands() {
		cmd, exists := GetCommand(name)
		testutil.Equal(t, exists, true, "GetAllowedCommands 返回了未注册命令 %q", name)
		if !cmd.ReadOnly {
			t.Errorf("暴露给前端的命令 %q 必须 ReadOnly=true（mutating 不应暴露）", name)
		}
	}
}

// 抽检已知 mutating 命令必须被排除在暴露列表之外（派生防漂移：一旦被误标 RO 即红）。
func TestGetAllowedCommands_ExcludesKnownMutating(t *testing.T) {
	allowed := make(map[string]bool, len(GetAllowedCommands()))
	for _, n := range GetAllowedCommands() {
		allowed[n] = true
	}
	// 这些命令会改动模型仓库/缓存/配置/标签，必须保持 mutating（不出现在暴露列表）。
	mutating := []string{"move", "copy", "rename", "toggle", "install", "dedup",
		"recycle", "cache-clear", "config", "tags", "avatar", "instance",
		"download", "link-mode", "creator", "workshop"}
	for _, name := range mutating {
		testutil.Equal(t, IsCommandAllowed(name), true, "前置：%q 应已注册（本断言才有效）", name)
		if allowed[name] {
			t.Errorf("mutating 命令 %q 不得暴露给前端桥（应保持零值 ReadOnly=false）", name)
		}
		if IsReadOnlyCommand(name) {
			t.Errorf("IsReadOnlyCommand(%q) 应为 false（mutating）", name)
		}
	}
}

// RO 子集非空且排序稳定（前端动态名单依赖确定性）。
func TestGetAllowedCommands_NonEmptyAndSorted(t *testing.T) {
	got := GetAllowedCommands()
	testutil.Equal(t, len(got) > 0, true, "只读子集不应为空（否则前端 CLI 桥全锁死）")
	want := append([]string(nil), got...)
	sort.Strings(want)
	for i := range got {
		testutil.Equal(t, got[i], want[i], "GetAllowedCommands 应有序，got[%d]=%q want %q", i, got[i], want[i])
	}
}

// 规格列表与命令列表同源且全部 ReadOnly=true（防 ReadOnly 字段漏填）。
func TestGetAllowedCommandSpecs_ReadOnlyConsistent(t *testing.T) {
	cmds := GetAllowedCommands()
	specs := GetAllowedCommandSpecs()
	testutil.Equal(t, len(specs), len(cmds), "规格与命令数应一致: cmds=%d specs=%d", len(cmds), len(specs))
	seen := map[string]bool{}
	for _, s := range specs {
		if !s.ReadOnly {
			t.Errorf("暴露命令 %q 的 CommandSpec.ReadOnly 应为 true", s.Name)
		}
		if seen[s.Name] {
			t.Errorf("规格重复命令 %q", s.Name)
		}
		seen[s.Name] = true
	}
}
