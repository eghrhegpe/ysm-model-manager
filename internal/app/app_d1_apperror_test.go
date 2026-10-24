// ===== D1 切片 A 回归护栏：3D 预览 / schematic / NBT 解析失败必须返回结构化 AppError =====
// 审计发现的 5 处裸 fmt.Errorf（中文错误）让前端 friendlyError 走「含中文消息直接透传」
// 旁路，CODE_KEYS 白名单永不命中——en/ja 界面必然显示中文，且前端无法按 Code 分支渲染。
// 本表把 D1 切片 A 的漏网点逐一锁死，防止回潮（范式沿用 app_guard_apperror_test.go 的
// errors.As + Code + Operation 三分断言）。
package app

import (
	"errors"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/internal/testutil"
)

// assertAppError 断言错误是结构化 AppError{期望 Code}，且 Operation 非空（供用户侧定位操作）
func assertAppError(t *testing.T, op string, want types.ErrorCode, err error) {
	t.Helper()
	testutil.NotNil(t, err, "%s: 应返回 error，实得 nil", op)
	var ae types.AppError
	testutil.Equal(t, errors.As(err, &ae), true, "%s: 错误应为 AppError（friendlyError 可映射 i18n），实得 %T: %v", op, err, err)
	if ae.Code != want {
		t.Errorf("%s: AppError.Code = %q，期望 %q", op, ae.Code, want)
	}
	if ae.Operation == "" {
		t.Errorf("%s: AppError.Operation 不应为空（供用户侧定位操作）", op)
	}
}

func TestD1SliceA_Bindings_ReturnAppError(t *testing.T) {
	a, _ := guardedApp(t)
	// 目录下的非法/空输入，让下游解析函数返回 nil（openGzRoot 失败）→ 走错误分支
	badFile := filepath.Join(t.TempDir(), "not-a-schematic.schem")

	cases := []struct {
		op   string
		want types.ErrorCode
		err  error
	}{
		// app_model.go：geometryJSON 为空 → ErrInvalidParam
		{"Build3DSpecFromGeometryJSON", types.ErrInvalidParam, func() error {
			_, e := a.Build3DSpecFromGeometryJSON("")
			return e
		}()},
		// resource_bindings.go：schematic / NBT 解析失败 → ErrDecodeFailed
		{"ReadSchematic", types.ErrDecodeFailed, func() error {
			_, e := a.ReadSchematic(badFile)
			return e
		}()},
		{"ReadNbtStructure", types.ErrDecodeFailed, func() error {
			_, e := a.ReadNbtStructure(badFile)
			return e
		}()},
	}

	for _, c := range cases {
		assertAppError(t, c.op, c.want, c.err)
	}
}

// decodeModel3DSpecErr 是 3D spec JSON 反序列化失败的统一构造点（app_model.go 三处
// GetModel3DSpec / Build3DSpecFromGeometryJSON 共用）。该分支依赖 threejs.Build 产物
// 形态，绑定层无法稳定触发非法 JSON，故对纯构造点做单测，锁死 Code/Operation 与
// WithCause 的 errors.Is 穿透链。
func TestD1SliceA_decodeModel3DSpecErr(t *testing.T) {
	cause := errors.New("boom")
	err := decodeModel3DSpecErr(cause)

	var ae types.AppError
	testutil.Equal(t, errors.As(err, &ae), true, "decodeModel3DSpecErr 应为 AppError，实得 %T: %v", err, err)
	if ae.Code != types.ErrDecodeFailed {
		t.Errorf("AppError.Code = %q，期望 %q", ae.Code, types.ErrDecodeFailed)
	}
	if ae.Operation == "" {
		t.Error("AppError.Operation 不应为空（供用户侧定位操作）")
	}
	if !errors.Is(err, cause) {
		t.Error("WithCause 未生效：errors.Is 无法穿透到底层 cause")
	}
}
