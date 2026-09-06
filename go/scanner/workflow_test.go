package scanner

import (
	"strings"
	"testing"

	"ysm-model-manager/go/types/registry"
)

// TestGenerateIndexWorkflow_ExtListMatchesRegistry 锁定 CI workflow 与注册表口径：
// workflow 内嵌 Go 脚本的扩展名过滤必须覆盖 registry.AllExts() 全集（.json 单独
// 走 ysm.json 白名单路径）——原手抄清单是注册表之外的第三份平行实现，注册表
// 新增扩展后 CI 重生成索引会静默漏收新类型（code_review 2026-09-06 #4）。
func TestGenerateIndexWorkflow_ExtListMatchesRegistry(t *testing.T) {
	wf := buildGenerateIndexWorkflow()
	for _, ext := range registry.AllExts() {
		if ext == ".json" {
			continue // .json 仅放行 ysm.json，单独判定路径
		}
		if !strings.Contains(wf, `"`+ext+`"`) {
			t.Errorf("workflow 缺注册表扩展 %s——CI 索引会漏收该类型", ext)
		}
	}
	// 禁用后缀恢复与 ysm.json 白名单逻辑必须仍在（防注入清单时顺手删了判定链）
	if !strings.Contains(wf, ".disabled") || !strings.Contains(wf, ".ban") {
		t.Error("workflow 缺 .disabled/.ban 恢复逻辑")
	}
	if !strings.Contains(wf, `"ysm.json"`) {
		t.Error("workflow 缺 ysm.json 白名单")
	}
	// .github 排除口径必须与 Go 侧扫描一致
	if !strings.Contains(wf, ".github") {
		t.Error("workflow 缺 .github 目录排除")
	}
}
