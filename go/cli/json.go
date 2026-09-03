package cli

import (
	"encoding/json"
	"errors"
	"fmt"
	"runtime"
	"sort"
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
func NewJsonError(command string, err error, durationMs float64) *JsonResponse {
	resp := &JsonResponse{
		Status:  "error",
		Command: command,
		Timing:  &TimingInfo{TotalMs: durationMs},
		Meta:    &MetaInfo{Platform: runtime.GOOS},
	}

	var errParam *ErrParam
	var errRuntime *ErrRuntime
	switch {
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
		return fmt.Sprintf(`{"status":"error","error":{"code":"marshal_error","message":"%s"}}`, err.Error())
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
