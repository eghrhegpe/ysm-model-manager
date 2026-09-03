package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

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
// # GUI→CLI 参数链路（#5 短期文档注释，中期收敛为 ParamSpec 元数据）
//
//	frontend cli-bridge.executeCLI → buildArgsMap（Record<string,string|number|boolean>）
//	→ Wails map[string]interface{}（JSON 序列化过桥，数值一律 float64）
//	→ 本函数转 []string → os/exec 子进程 <exe> --cli <args> --json
//	→ go/cli ParseCommandArgs 剥离全局参数（--files-root/--json）
//	→ 各命令内部 flag.FlagSet 解析（go/cli/registry.go 注册）
//
// # 参数转换损耗点（新增命令参数必须同步核对）
//
//   - string: 空串丢弃——无法传显式空值（如需传空串语义，改走 ParamSpec 白名单）
//   - float64: 0 丢弃——无法传 0（0 与「未传」同义，flag 层也无法区分）
//   - bool: false 丢弃——无法传显式 false（仅 true 会产出 --flag）
//   - 其他类型（nil / int / map / slice）：静默跳过 + stderr 告警，防参数丢失
//   - filesRoot: 特殊键名 → --files-root（必填，缺省回退 GetYSMRepoRoot()）
//   - Go map 遍历无序 → 参数顺序不确定；仅 flag 语义命令安全，位置参数命令不可走此桥
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

	// 添加命令参数（#5：转换损耗语义见函数头注释——空串/0/false 丢弃）
	for k, v := range args {
		if k == "filesRoot" {
			continue
		}
		switch val := v.(type) {
		// param: <key> → --<key> <val> (string, 空串丢弃)
		case string:
			if val != "" {
				cmdArgs = append(cmdArgs, "--"+k, val)
			}
		// param: <key> → --<key> <val> (number, 0 丢弃；JSON 数值恒 float64，整数转 %d 防精度漂移)
		case float64:
			if val != 0 {
				if val == float64(int64(val)) {
					cmdArgs = append(cmdArgs, "--"+k, fmt.Sprintf("%d", int64(val)))
				} else {
					cmdArgs = append(cmdArgs, "--"+k, fmt.Sprintf("%g", val))
				}
			}
		// param: <key> → --<key> (bool, false 丢弃——仅 true 产出开关)
		case bool:
			if val {
				cmdArgs = append(cmdArgs, "--"+k)
			}
		default:
			// 不支持的类型（nil, int, map 等）静默跳过，防止前端参数丢失
			fmt.Fprintf(os.Stderr, "[WARN] ExecuteCLI: 跳过不支持的参数类型 %T (key=%s)\n", v, k)
		}
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
