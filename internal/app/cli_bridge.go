package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"sort"
	"strings"
	"time"
)

// ===== ADR-173 ParamSpec 注入（A1：规格单一事实源在 go/cli 注册表，经 main.go 薄转换注入）=====

// ParamSpecDTO / CommandSpecDTO 是 go/cli ParamSpec/CommandSpec 的 app 侧镜像：
// internal/app 不依赖 go/cli（ADR-145 架构：两侧互不 import，main 装配），
// 字段名与 go/cli 对齐，漂移由 main.go 转换函数编译期拦截。
type ParamSpecDTO struct {
	Key        string // flag 键名（不含 -- 前缀）
	Type       string // "string" / "number" / "bool"
	AllowEmpty bool   // true=显式空值（空串/0/false）允许跨桥
}

type CommandSpecDTO struct {
	Name   string
	Params []ParamSpecDTO
}

// SetAllowedCommandSpecs 注入命令参数规格（main.go 从 cli.GetAllowedCommandSpecs() 转换后调用）
// 与 SetAllowedCommands 独立 once：测试/旧装配只注入名单 → 规格为空 → ExecuteCLI 走 legacy 降级
func (a *App) SetAllowedCommandSpecs(specs []CommandSpecDTO) {
	a.allowedSpecsOnce.Do(func() {
		a.allowedSpecs = make(map[string][]ParamSpecDTO, len(specs))
		for _, s := range specs {
			a.allowedSpecs[s.Name] = s.Params
		}
	})
}

// SetAllowedCommands 注入可用 CLI 命令列表（由 main.go 调用 cli.GetAllowedCommands() 提供）
// 避免 app→cli 循环依赖：命令注册表单一事实来源在 go/cli，前端可见列表经此注入
func (a *App) SetAllowedCommands(cmds []string) {
	a.allowedCommandsOnce.Do(func() {
		a.allowedCommands = append([]string(nil), cmds...)
		a.allowedCommandSet = make(map[string]bool, len(cmds))
		for _, c := range cmds {
			a.allowedCommandSet[c] = true
		}
	})
}

// isCommandExposedToFrontend 检查命令是否在前端可见白名单内（区别于 go/cli 的
// IsCommandAllowed=注册表存在；本方法是 main.go 注入的安全白名单，评审 #12 改名防撞名异义）
func (a *App) isCommandExposedToFrontend(command string) bool {
	return a.allowedCommandSet[command]
}

// ExecuteCLI 执行 CLI 命令并返回 JSON 响应（Wails 绑定）
//
// # GUI→CLI 参数链路（ADR-173 落地后：规格单一事实源在 go/cli 注册表，本注释不再承担契约）
//
//	frontend cli-bridge.executeCLI → buildArgsMap（Record<string,string|number|boolean>）
//	→ Wails map[string]interface{}（JSON 序列化过桥，数值一律 float64）
//	→ 本函数转 []string → os/exec 子进程 <exe> --cli <args> --json
//	→ go/cli ParseCommandArgs 剥离全局参数（--files-root/--json）
//	→ 各命令内部 flag.FlagSet 解析（go/cli/registry.go 注册）
//
// # 序列化规则（ADR-173 A2，详版见 buildCLIArgs）
//
//   - 已登记 ParamSpec 的命令：按规格声明序输出；AllowEmpty=true 的参数可传显式空值
//     （空串 → --key=，0 → --key 0，false → --key=false）；规格外键告警 + legacy 追加。
//   - 未登记命令：legacy 规则（空串/0/false 丢弃）——与 flag 默认一致，行为零回归。
//   - filesRoot: 特殊键名 → --files-root（必填，缺省回退 GetYSMRepoRoot()）
func (a *App) ExecuteCLI(command string, args map[string]interface{}) string {
	start := time.Now()

	// 1. 检查命令是否在可用列表中
	if !a.isCommandExposedToFrontend(command) {
		elapsed := float64(time.Since(start).Milliseconds())
		resp, err := makeJsonResponse("not_supported", command, nil, map[string]string{
			"code":    "platform_not_supported",
			"message": fmt.Sprintf("当前平台不支持命令 [%s]: 该命令未开放给前端调用", command),
		}, elapsed)
		if err != nil {
			return fmt.Sprintf(`{"status":"not_supported","command":%q,"error":{"code":"json_failed","message":%q}}`, command, err.Error())
		}
		return resp
	}

	// 2. 构建参数数组
	var cmdArgs []string

	// 添加 files-root
	filesRoot := ""
	if fr, ok := args["filesRoot"].(string); ok {
		filesRoot = fr
	}
	if filesRoot == "" {
		filesRoot = a.GetYSMRepoRoot()
	}
	if filesRoot != "" {
		cmdArgs = append(cmdArgs, "--files-root", filesRoot)
	}

	cmdArgs = append(cmdArgs, command)

	// 添加命令参数（ADR-173：已登记 ParamSpec 的命令按规格声明序序列化，
	// 未登记命令走 legacy 规则降级——行为与 ADR-173 前完全等价）
	cmdArgs, warnings := buildCLIArgs(command, cmdArgs, args, a.allowedSpecs[command])
	for _, w := range warnings {
		fmt.Fprintf(os.Stderr, "[WARN] ExecuteCLI: %s\n", w)
	}

	// 3. 执行命令并捕获输出
	// 子进程加 --json：RunCLI 的 jsonMode 分支输出统一 JsonResponse 协议（成功/失败均为 JSON）
	cmdArgs = append(cmdArgs, "--json")
	output, execErr := executeCLICommand(cmdArgs)

	// 4. 透传子进程 JSON 响应（协议由 go/cli/json.go 定义，前端统一消费）
	// execErr 非空时仅透传合法 JSON 响应，防止异常部分输出掩盖真实错误
	if output != "" && (execErr == nil || isValidJsonResponse(output)) {
		return output
	}

	// 兜底：子进程无 stdout 输出（异常路径），构造错误响应
	elapsed := float64(time.Since(start).Milliseconds())
	errCode := "unknown_error"
	errMsg := "命令执行失败"
	if execErr != nil {
		errMsg = execErr.Error()
		// 根据退出码判断错误类型
		exitCode := getExitCode(execErr)
		if exitCode == 2 {
			errCode = "param_error"
		} else if exitCode == 1 {
			errCode = "runtime_error"
		}
	}
	resp, err := makeJsonResponse("error", command, nil, map[string]string{
		"code":    errCode,
		"message": errMsg,
	}, elapsed)
	if err != nil {
		return fmt.Sprintf(`{"status":"error","command":%q,"error":{"code":"json_failed","message":%q}}`, command, err.Error())
	}
	return resp
}

// buildCLIArgs 把 GUI 参数 map 序列化为 CLI []string（纯函数，ADR-173 A2 可测核心）
//
// 路径选择：
//   - specs 非空（命令已登记 ParamSpec）：按规格声明序输出已知键；
//     AllowEmpty=true 时显式空值（空串/0/false）以 flag 可接受形态产出
//     （--key= / --key 0 / --key=false），实现「未传 vs 传了空值」可区分；
//     AllowEmpty=false 维持「空值=未传」现状语义；规格外键与类型不符键：
//     告警 + legacy 规则尾部追加，不静默丢参（渐进期保行为等价，后续波可收紧为显式拒绝）。
//   - specs 为空（未登记）：legacy 规则——空串/0/false 丢弃（与 flag 默认一致）。
//
// filesRoot 为全局参数，由调用方先行处理，不进入规格。
// 返回值第二项为告警列表（统一由调用方打印，格式 [WARN] ExecuteCLI: ...）。
func buildCLIArgs(command string, base []string, args map[string]interface{}, specs []ParamSpecDTO) ([]string, []string) {
	if len(specs) == 0 {
		return buildLegacyArgs(base, args)
	}

	var warnings []string
	known := make(map[string]bool, len(specs))
	for _, spec := range specs {
		known[spec.Key] = true
		v, present := args[spec.Key]
		if !present {
			continue
		}
		switch spec.Type {
		case "string":
			s, ok := v.(string)
			if !ok {
				warnings = append(warnings, fmt.Sprintf("参数 --%s 期望 string，实际 %T（已跳过）", spec.Key, v))
				continue
			}
			if s != "" {
				base = append(base, "--"+spec.Key, s)
			} else if spec.AllowEmpty {
				// 显式空串：--key=（flag 空串形态）
				base = append(base, "--"+spec.Key+"=")
			}
		case "number":
			f, ok := v.(float64)
			if !ok {
				warnings = append(warnings, fmt.Sprintf("参数 --%s 期望 number，实际 %T（已跳过）", spec.Key, v))
				continue
			}
			if f != 0 {
				base = append(base, "--"+spec.Key, formatCLINumber(f))
			} else if spec.AllowEmpty {
				// 显式 0：--key 0
				base = append(base, "--"+spec.Key, "0")
			}
		case "bool":
			b, ok := v.(bool)
			if !ok {
				warnings = append(warnings, fmt.Sprintf("参数 --%s 期望 bool，实际 %T（已跳过）", spec.Key, v))
				continue
			}
			if b {
				base = append(base, "--"+spec.Key)
			} else if spec.AllowEmpty {
				// 显式 false：--key=false（flag bool 可解析形态）
				base = append(base, "--"+spec.Key+"=false")
			}
		default:
			warnings = append(warnings, fmt.Sprintf("规格类型 %q 未知（key=%s，已跳过）", spec.Type, spec.Key))
		}
	}

	// 规格外键（含拼写错误）：告警 + legacy 规则尾部追加——渐进期不丢参
	var unknown []string
	for k := range args {
		if k == "filesRoot" || known[k] {
			continue
		}
		unknown = append(unknown, k)
	}
	if len(unknown) > 0 {
		sort.Strings(unknown) // 未知键是异常路径，排序保证输出稳定可测
		for _, k := range unknown {
			warnings = append(warnings, fmt.Sprintf("参数 --%s 不在命令 [%s] 的 ParamSpec 规格内，按 legacy 规则追加", k, command))
			base = appendLegacyKey(base, k, args[k], &warnings)
		}
	}
	return base, warnings
}

// buildLegacyArgs ADR-173 前的历史序列化规则（未登记规格命令的降级路径）：
// 空串/0/false 丢弃（与 flag 默认值一致，语义无损）；仅 true 产出 bool 开关；
// 键排序输出——历史实现 map 遍历无序，排序是纯增益（行为超集，无回归）。
func buildLegacyArgs(base []string, args map[string]interface{}) ([]string, []string) {
	var warnings []string
	keys := make([]string, 0, len(args))
	for k := range args {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if k == "filesRoot" {
			continue
		}
		base = appendLegacyKey(base, k, args[k], &warnings)
	}
	return base, warnings
}

// appendLegacyKey 按 legacy 规则序列化单个键（规格路径与 legacy 路径共用）
func appendLegacyKey(base []string, k string, v interface{}, warnings *[]string) []string {
	switch val := v.(type) {
	case string:
		if val != "" {
			return append(base, "--"+k, val)
		}
	case float64:
		if val != 0 {
			return append(base, "--"+k, formatCLINumber(val))
		}
	case bool:
		if val {
			return append(base, "--"+k)
		}
	default:
		// 不支持的类型（nil, int, map 等）：告警防静默丢参
		*warnings = append(*warnings, fmt.Sprintf("跳过不支持的参数类型 %T（key=%s）", v, k))
	}
	return base
}

// formatCLINumber JSON 数值恒 float64：整数转 %d 防精度漂移，非整数 %g
func formatCLINumber(f float64) string {
	if f == float64(int64(f)) {
		return fmt.Sprintf("%d", int64(f))
	}
	return fmt.Sprintf("%g", f)
}

// isValidJsonResponse 判断字符串是否为含 status 字段的合法 JSON 响应
// 用于子进程异常退出时区分「完整 JSON 错误文档」与「部分/非 JSON 输出」
func isValidJsonResponse(s string) bool {

	var m map[string]interface{}
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		return false
	}
	_, ok := m["status"]
	return ok
}

// GetAllowedCLICommands 返回可用 CLI 命令列表
// 列表由 main.go 从 cli 注册表注入（SetAllowedCommands），新增命令自动可见
func (a *App) GetAllowedCLICommands() string {
	if a.allowedCommands == nil {
		a.allowedCommands = []string{}
	}
	result, err := json.Marshal(a.allowedCommands)
	if err != nil {
		return "[]" // 空数组兜底，前端至少拿到合法 JSON
	}
	return string(result)
}

// cliCommandTimeout CLI 子进程挂死兜底：正常命令远低于此，仅防 GUI 永久等待
// （评审 #3：原 exec.Command 无超时，子进程挂死则 GUI 桥永久阻塞）
const cliCommandTimeout = 5 * time.Minute

// executeCLICommand 执行 CLI 命令
// 通过 os/exec 调用自身二进制的 CLI 模式，避免循环依赖
// 返回 stdout 内容和错误（含退出码）
func executeCLICommand(args []string) (string, error) {
	// 获取当前可执行文件路径
	exePath, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("获取可执行文件路径失败: %w", err)
	}

	// 构建命令：<exe> --cli <args...>（CommandContext 带超时，子进程挂死即终止）
	cliArgs := append([]string{"--cli"}, args...)
	ctx, cancel := context.WithTimeout(context.Background(), cliCommandTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, exePath, cliArgs...)

	// 捕获 stdout 和 stderr
	var stdoutBuf, stderrBuf strings.Builder
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf

	err = cmd.Run()
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return stdoutBuf.String(), fmt.Errorf("命令执行超时（超过 %s 被终止）", cliCommandTimeout)
		}
		// 如果有 stderr，将其附加到错误信息
		if stderr := stderrBuf.String(); stderr != "" {
			return stdoutBuf.String(), fmt.Errorf("%s: %s", err.Error(), strings.TrimSpace(stderr))
		}
		return stdoutBuf.String(), err
	}

	return stdoutBuf.String(), nil
}

// getExitCode 从错误中提取退出码（errors.As 可穿透 %w 包装层，评审 #3）
func getExitCode(err error) int {
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return exitErr.ExitCode()
	}
	return -1
}

// makeJsonResponse 创建 JSON 响应（返回 error 而非静默吞错）
func makeJsonResponse(status, command string, data interface{}, errResp interface{}, elapsed float64) (string, error) {
	resp := map[string]interface{}{
		"status":  status,
		"command": command,
		"timing":  map[string]float64{"total_ms": elapsed},
		"meta":    map[string]string{"platform": runtime.GOOS},
	}
	if data != nil {
		resp["data"] = data
	}
	if errResp != nil {
		resp["error"] = errResp
	}
	result, err := json.Marshal(resp)
	if err != nil {
		return "", fmt.Errorf("JSON 序列化失败: %w", err)
	}
	return string(result), nil
}
