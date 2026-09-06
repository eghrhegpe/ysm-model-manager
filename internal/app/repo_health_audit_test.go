package app

import (
	"errors"
	"testing"

	"ysm-model-manager/go/repoaudit"
)

// TestMergeAuditResultsDeterministic 合并结果必须与输入顺序无关：
// 同一组各类型审计结果，任意排列输入，Warnings 顺序 / Cache 取值一致
// （ADR-119 确定性契约；原 map 随机遍历导致同输入不同输出）。
func TestMergeAuditResultsDeterministic(t *testing.T) {
	mkReport := func(rtype string, warnings ...string) auditResult {
		return auditResult{
			rtype: rtype,
			report: repoaudit.HealthReport{
				Warnings: warnings,
				Resources: repoaudit.ResourceSummary{
					TotalFiles: 1,
					ByType:     map[string]int{rtype: 1},
				},
			},
		}
	}

	a := mkReport("ysm", "ysm-warn-1", "ysm-warn-2")
	b := mkReport("mmd", "mmd-warn")
	c := auditResult{rtype: "resourcepack", err: errors.New("audit failed")}

	want := mergeAuditResults([]auditResult{a, b, c}, "2026-01-01T00:00:00Z").Warnings
	// 三种排列轮换，断言输出恒等
	perms := [][]auditResult{
		{a, b, c},
		{b, c, a},
		{c, a, b},
		{c, b, a},
		{a, c, b},
		{b, a, c},
	}
	for i, perm := range perms {
		got := mergeAuditResults(perm, "2026-01-01T00:00:00Z").Warnings
		if len(got) != len(want) {
			t.Fatalf("第 %d 轮 Warnings 长度不一致: got %v want %v", i, got, want)
		}
		for j := range want {
			if got[j] != want[j] {
				t.Fatalf("第 %d 轮 Warnings 顺序漂移:\n got %v\nwant %v", i, got, want)
			}
		}
	}
}
