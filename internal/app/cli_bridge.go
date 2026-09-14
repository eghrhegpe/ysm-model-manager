package app

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"sort"
	"time"
)

// ===== ADR-173 ParamSpec 注入（A1：规格单一事实源在 go/cli 注册表，经 main.go 薄转换注入）=====

// ParamSpecDTO / CommandSpecDTO 是 go/cli ParamSpec/CommandSpec 的 app 侧镜像：
// 字段名与 go/cli 对齐，漂移由 main.go 转换函数编译期拦截。
// （ADR-199 经依赖注入复用 go/cli.RunCLIInProcess：执行器由 main.go 注入，
// internal/app 仍不 import go/cli，保持 ADR-145「两侧互不 import，main 装配」；
// 原 executeCLICommand 的 os/exec 自 fork 已彻底移除。）
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
		// 先在局部构造完成再一次性赋值：原实现先 make map 再逐个填充，
		// 若注入发生在并发读已可达的时点，读方可能观察到「半填充」的 map。
		// Once.Do 返回后才为其他 goroutine 建立 happens-before，此处提前赋值无额外收益，
		// 但一次性赋值让「字段可见即完整」成为显式不变量。
		cmdsCopy := append([]string(nil), cmds...)
		set := make(map[string]bool, len(cmds))
		for _, c := range cmds {
			set[c] = true
		}
		a.allowedCommands = cmdsCopy
		a.allowedCommandSet = set
	})
}

// isCommandExposedToFrontend 检查命令是否在前端可见白名单内（区别于 go/cli 的
// IsCommandAllowed=注册表存在；本方法是 main.go 注入的安全白名单，改名防撞名异义）
func (a *App) isCommandExposedToFrontend(command string) bool {
	return a.allowedCommandSet[command]
}

// CLIInProcessRunner 进程内直调 CLI 的执行器（ADR-199）。
// 签名以 internal/app 自有类型 *App 入参，避免本包直接 import go/cli；
// main.go 注入时把 *App 当作 cli.AppService 透传给 cli.RunCLIInProcess。
type CLIInProcessRunner func(a *App, parent context.Context, args []string) (string, error)

// SetCLIInProcessRunner 注入进程内 CLI 执行器（main.go 在装配期调用，
// 把 cli.RunCLIInProcess 包一层 *App→cli.AppService 的适配后传入）。
// 未注入时 ExecuteCLI 不再退化到 os/exec 自 fork，而是返回显式错误响应。
func (a *App) SetCLIInProcessRunner(runner CLIInProcessRunner) {
	a.cliInProcessRunner = runner
}

// ExecuteCLI 执行 CLI 命令并返回 JSON 响应（Wails 绑定）
//
// # GUI→CLI 参数链路（ADR-173 + ADR-199 落地后：规格单一事实源在 go/cli 注册表，本注释不再承担契约）
//
//	frontend cli-bridge.executeCLI → buildArgsMap（Record<string,string|number|boolean>）
//	→ Wails map[string]interface{}（JSON 序列化过桥，数值一律 float64）
//	→ 本函数转 []string → cli.RunCLIInProcess(a, appCtx, args) 进程内直调（ADR-199，零自 fork）
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

	// 3. 进程内直调执行命令（ADR-199：替代 os/exec 自 fork，零冷启动税、零孤儿进程）
	// 命令恒带 --json：注入的 runner 复用 go/cli 的 JsonResponse 协议（成功/失败均为 JSON）
	cmdArgs = append(cmdArgs, "--json")
	parent := context.Background()
	if a.appCtx != nil {
		parent = a.appCtx
	}

	if a.cliInProcessRunner == nil {
		// 装配期未注入执行器：显式报错，绝不退化到 os/exec 自 fork（ADR-199 红线）
		elapsed := float64(time.Since(start).Milliseconds())
		resp, err := makeJsonResponse("error", command, nil, map[string]string{
			"code":    "cli_runner_unset",
			"message": "CLI 进程内执行器未注入（main.go 装配缺失）",
		}, elapsed)
		if err != nil {
			return fmt.Sprintf(`{"status":"error","command":%q,"error":{"code":"json_failed","message":%q}}`, command, err.Error())
		}
		return resp
	}
	output, execErr := a.cliInProcessRunner(a, parent, cmdArgs)

	// 4. 透传 JSON 响应（runner 恒返回合规 JsonResponse，成功/失败均为合法 JSON）
	//    仅在极端空输出路径下兜底，避免前端收到空串无法解析。
	if output != "" {
		return output
	}
	elapsed := float64(time.Since(start).Milliseconds())
	errMsg := "命令无输出"
	if execErr != nil {
		errMsg = execErr.Error()
	}
	resp, err := makeJsonResponse("error", command, nil, map[string]string{
		"code":    "empty_output",
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

// GetAllowedCLICommands 返回可用 CLI 命令列表
// 列表由 main.go 从 cli 注册表注入（SetAllowedCommands），新增命令自动可见
func (a *App) GetAllowedCLICommands() string {
	// 读路径纯只读：原实现在 nil 时回写 `a.allowedCommands = []string{}`——
	// 与绑定线程/CLI 线程的并发读构成 data race（仅未注入时触发，但路径真实存在）。
	// nil 与空切片序列化结果同为 `[]`，直接返回即可，无需回写。
	if a.allowedCommands == nil {
		return "[]"
	}
	result, err := json.Marshal(a.allowedCommands)
	if err != nil {
		return "[]" // 空数组兜底，前端至少拿到合法 JSON
	}
	return string(result)
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
