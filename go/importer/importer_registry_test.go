package importer

import (
	"testing"

	"ysm-model-manager/go/types"
)

// TestAllRegistryTypesHaveHandler 契约测试：resource_types.json 是导入策略的事实源，
// 每种非豁免类型必须在 init() 中有对应的 Register 调用。
//
// 设计意图：
//   - 加新 rtype 到 JSON 时，若忘记补 Register，本测试立即失败——
//     而非像过去那样静默断链（fbx 案例：JSON 有、策略无，ImportByType 报「未找到导入策略」）。
//   - 豁免列表必须附理由，reviewer 可质疑每条豁免是否仍成立。
//   - isDir=true 的类型（目录型）注册 DirectoryCopy，isDir=false 注册 SimpleCopy——
//     类型不匹配不会导致 ImportByType 返回 nil（两种 Handler 接口相同），
//     但会破坏「策略与类型特征一致」的隐性契约，故也一并检查。
func TestAllRegistryTypesHaveHandler(t *testing.T) {
	reg := types.LoadRegistry()

	// 豁免表：id → 豁免理由。新增豁免需附上可审计的理由。
	// 若某类类型确实不需要导入策略（如仅用于扫描/同步的纯容器类型），在此声明。
	exempt := map[string]string{}

	for _, rt := range reg.ResourceTypes {
		if _, ok := exempt[rt.ID]; ok {
			continue
		}
		if Get(rt.ID) == nil {
			t.Errorf("类型 %q 在 resource_types.json 中但无导入策略（调用 importer.Register）— 豁免理由: %q", rt.ID, exempt[rt.ID])
		}
	}
}

// TestHandlerKindMatchesIsDir 契约测试：导入策略种类与资源类型的 isDir 特征一致。
//   - isDir=true  → DirectoryCopy（批量文件夹导入）
//   - isDir=false → SimpleCopy（单文件导入）
//
// 类型不匹配不会让 ImportByType 返回 nil（接口相同），但会导致语义错位：
// 对文件型类型用 DirectoryCopy，用户传单个 .fbx 文件时会被误当成目录处理。
func TestHandlerKindMatchesIsDir(t *testing.T) {
	reg := types.LoadRegistry()

	for _, rt := range reg.ResourceTypes {
		h := Get(rt.ID)
		if h == nil {
			continue // 已由 TestAllRegistryTypesHaveHandler 覆盖
		}
		wantDir := rt.IsDir
		gotDir := false
		switch h.(type) {
		case *DirectoryCopyImporter:
			gotDir = true
		case *SimpleCopyImporter:
			gotDir = false
		}
		if gotDir != wantDir {
			t.Errorf("类型 %q: isDir=%v 但 Handler 种类 mismatch（DirectoryCopy=%v, SimpleCopy=%v）",
				rt.ID, wantDir, gotDir, !gotDir)
		}
	}
}
