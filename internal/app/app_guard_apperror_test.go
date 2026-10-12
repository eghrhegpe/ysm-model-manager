// ===== 3D 债务第三轮 D4 回归护栏：路径守卫拒绝必须返回结构化 AppError =====
// 审计第三轮发现 9 处守卫拒绝用裸 fmt.Errorf("路径超出仓库目录")，前端 friendlyError
// 因此走「含中文消息直接透传」旁路，CODE_KEYS 白名单永不命中——en/ja 界面必然显示中文，
// 且前端无法按 Code 分支渲染（D1 的 3D 侧成因）。
// 仓内契约早已在 resource_bindings_test.go 断言过（FindDuplicateFiles 的守卫错误须为
// AppError{INVALID_PATH}），本表把 9 个漏网点逐一锁死，防止回潮。
package app

import (
	"errors"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

// assertInvalidPath 断言守卫错误是结构化 AppError{Code: INVALID_PATH}
func assertInvalidPath(t *testing.T, op string, err error) {
	t.Helper()
	if err == nil {
		t.Fatalf("%s: 根外路径应被守卫拒绝返回 error", op)
	}
	var ae types.AppError
	if !errors.As(err, &ae) {
		t.Fatalf("%s: 守卫错误应为 AppError（friendlyError 可映射 i18n），实得 %T: %v", op, err, err)
	}
	if ae.Code != types.ErrInvalidPath {
		t.Errorf("%s: AppError.Code = %q，期望 %q", op, ae.Code, types.ErrInvalidPath)
	}
	if ae.Operation == "" {
		t.Errorf("%s: AppError.Operation 不应为空（供用户侧定位操作）", op)
	}
}

func TestPathGuards_ReturnAppError(t *testing.T) {
	a, _ := guardedApp(t)
	// 三个独立 temp 目录：互不重叠，确保任何一段都不是另一个的子路径
	outsideFile := filepath.Join(t.TempDir(), "outside.ysm")
	outsideDir := filepath.Join(t.TempDir(), "outside-dir")
	outsideDir2 := filepath.Join(t.TempDir(), "outside-dir2")

	cases := []struct {
		op  string
		err error
	}{
		// app_files.go：isPathInRoot 口径
		{"RenameDir", a.RenameDir(outsideDir, "renamed")},
		{"RenameFile", a.RenameFile(outsideFile, "renamed.ysm")},
		// RemoveDir 守卫先于 IO，根外路径直接拒绝（目标本就不存在，无副作用）
		{"RemoveDir", a.RemoveDir(outsideDir2)},
		// 下列为 isPathInRootOrSelf 口径
		{"GetModel3DSpec", func() error { _, e := a.GetModel3DSpec(outsideFile); return e }()},
		{"GenerateRepoIndex", func() error { _, e := a.GenerateRepoIndex(outsideDir); return e }()},
		{"GetModelTags", func() error { _, e := a.GetModelTags(outsideFile); return e }()},
		{"SetModelTags", a.SetModelTags(outsideFile, []string{"t"})},
		{"GetCachedTexture", func() error { _, e := a.GetCachedTexture(outsideFile); return e }()},
		// resource_bindings.go：DeleteResourcePack 目录型分支的 rel 前缀守卫
		{"DeleteResourcePack", a.DeleteResourcePack(filepath.Join(t.TempDir(), "sub", "model"), "maid-model")},
	}

	for _, c := range cases {
		assertInvalidPath(t, c.op, c.err)
	}
}
