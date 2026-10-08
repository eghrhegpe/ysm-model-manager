package cli

import (
	"encoding/json"
	"errors"
	"fmt"
	"runtime"
	"sort"

	"ysm-model-manager/go/types"
)

// JsonResponse 统一 JSON 输出协议
type JsonResponse struct {
	Status  string      `json:"status"`          // success / error / not_supported
	Command string      `json:"command"`         // 命令名
	Data    interface{} `json:"data,omitempty"`  // 业务数据
	Error   *JsonError  `json:"error,omitempty"` // 错误信息
	Timing  *TimingInfo `json:"timing,omitempty"`
	Meta    *MetaInfo   `json:"meta,omitempty"`
}

// JsonError 错误详情
type JsonError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details string `json:"details,omitempty"`
}

// TimingInfo 耗时统计
type TimingInfo struct {
	TotalMs float64 `json:"total_ms"`
}

// MetaInfo 元信息
type MetaInfo struct {
	Platform string `json:"platform"`
}

// NewJsonSuccess 创建成功响应
func NewJsonSuccess(command string, data interface{}, durationMs float64) *JsonResponse {
	return &JsonResponse{
		Status:  "success",
		Command: command,
		Data:    data,
		Timing:  &TimingInfo{TotalMs: durationMs},
		Meta:    &MetaInfo{Platform: runtime.GOOS},
	}
}

// NewJsonError 创建错误响应
//
// ADR-051 单一事实来源：优先识别 types.AppError（结构化错误码），将其 Code
// 原样透传为 JsonError.Code，使前端 friendlyError 能按 Code 做 i18n 映射，
// 而非降级成 unknown_error 丢失结构化信息。仅当错误非 AppError 时，才回落到
// CLI 命令层自建的 ErrParam/ErrRuntime 分类（param_error/runtime_error），
// 其余未分类错误保持 unknown_error。
func NewJsonError(command string, err error, durationMs float64) *JsonResponse {
	resp := &JsonResponse{
		Status:  "error",
		Command: command,
		Timing:  &TimingInfo{TotalMs: durationMs},
		Meta:    &MetaInfo{Platform: runtime.GOOS},
	}

	var appErr types.AppError
	var errParam *ErrParam
	var errRuntime *ErrRuntime
	switch {
	case errors.As(err, &appErr):
		// 结构化错误码优先：直接透传 types.ErrorCode（如 INVALID_PATH），
		// 细节带 Reason/Suggestion 供前端友好化与排错。
		resp.Error = &JsonError{
			Code:    string(appErr.Code),
			Message: appErr.Error(),
			Details: appErr.Suggestion,
		}
	case errors.As(err, &errParam):
		resp.Error = &JsonError{
			Code:    "param_error",
			Message: errParam.Error(),
		}
	case errors.As(err, &errRuntime):
		resp.Error = &JsonError{
			Code:    "runtime_error",
			Message: errRuntime.Error(),
		}
	default:
		resp.Error = &JsonError{
			Code:    "unknown_error",
			Message: err.Error(),
		}
	}
	return resp
}

// NewJsonNotSupported 创建平台不支持响应
func NewJsonNotSupported(command string, reason string) *JsonResponse {
	return &JsonResponse{
		Status:  "not_supported",
		Command: command,
		Error: &JsonError{
			Code:    "platform_not_supported",
			Message: fmt.Sprintf("当前平台不支持命令 [%s]: %s", command, reason),
		},
		Meta: &MetaInfo{Platform: runtime.GOOS},
	}
}

// ToJson 将响应序列化为 JSON 字符串
func (r *JsonResponse) ToJson() string {
	data, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		// 兜底自身必须是合法 JSON：err.Error() 含引号/反斜杠/控制字符时，
		// fmt.Sprintf 直接拼接会产出破串，前端 JSON.parse 当场抛错——吞错
		// 修了一圈，兜底却仍是唯一一个手拼 JSON 的死角。用 json.Marshal 转义；
		// 转义再失败（理论上不可达）则退化为恒合法常量串。
		msg, mErr := json.Marshal(err.Error())
		if mErr != nil {
			return `{"status":"error","error":{"code":"marshal_error","message":"response marshal failed"}}`
		}
		return `{"status":"error","error":{"code":"marshal_error","message":` + string(msg) + `}}`
	}
	return string(data)
}

// IsCommandAllowed 检查命令是否已注册（自动派生自 cliCommands 注册表，无需手动白名单）
func IsCommandAllowed(command string) bool {
	_, exists := cliCommands[command]
	return exists
}

// GetAllowedCommands 返回所有已注册命令（自动派生自 cliCommands 注册表）
// 新增命令只需 RegisterCommand，无需手动同步白名单
func GetAllowedCommands() []string {
	names := make([]string, 0, len(cliCommands))
	for name := range cliCommands {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// CommandSpec 命令 + 参数规格（ADR-173 A1：供 main.go 装配注入 app 桥接层）
// 未登记规格的命令 Params 为 nil，app 侧对其走 legacy 降级序列化
type CommandSpec struct {
	Name   string
	Params []ParamSpec
}

// GetAllowedCommandSpecs 返回全部注册命令的名称 + 参数规格（声明序=桥序列化序）
// 与 GetAllowedCommands 同源派生，杜绝「名单与规格漂移」
func GetAllowedCommandSpecs() []CommandSpec {
	names := GetAllowedCommands()
	specs := make([]CommandSpec, 0, len(names))
	for _, name := range names {
		specs = append(specs, CommandSpec{Name: name, Params: cliCommands[name].Params})
	}
	return specs
}
