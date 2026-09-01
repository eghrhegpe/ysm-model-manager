package cli

import (
	"fmt"
	"os"
)

// CmdContext 统一命令执行上下文
type CmdContext struct {
	App       AppService
	FilesRoot string
	Args      []string
}

// CliCommand 命令注册结构
type CliCommand struct {
	Name        string
	Category    string
	Description string
	Run         func(ctx *CmdContext) error
}

// 命令分类常量
const (
	CatModel    = "模型管理"
	CatPerf     = "性能诊断"
	CatCache    = "缓存管理"
	CatResource = "资源仓库"
	CatConfig   = "配置"
	CatOther    = "其他"
)

var cliCommands = map[string]CliCommand{}

// RegisterCommand 注册一个 CLI 子命令（默认归入 CatOther）
// 重复注册会输出警告并跳过，不再 panic（init() 阶段 panic 无法 recover）
func RegisterCommand(name, description string, run func(ctx *CmdContext) error) {
	RegisterCommandC(name, CatOther, description, run)
}

// RegisterCommandC 注册带分类的 CLI 子命令
func RegisterCommandC(name, category, description string, run func(ctx *CmdContext) error) {
	if _, exists := cliCommands[name]; exists {
		fmt.Fprintf(os.Stderr, "[WARN] CLI 命令 %q 重复注册，跳过\n", name)
		return
	}
	cliCommands[name] = CliCommand{
		Name:        name,
		Category:    category,
		Description: description,
		Run:         run,
	}
}

// GetCommand 获取已注册的命令
func GetCommand(name string) (CliCommand, bool) {
	cmd, exists := cliCommands[name]
	return cmd, exists
}

// GetAllCommands 获取所有已注册命令
func GetAllCommands() []CliCommand {
	var cmds []CliCommand
	for _, cmd := range cliCommands {
		cmds = append(cmds, cmd)
	}
	return cmds
}

// DispatchCommand 分发命令执行
func DispatchCommand(a AppService, saveConfigFn func(filesRoot, rpRoot, mcRoot, linkMode, theme string) error, filesRoot string, commandArgs []string, requireFilesRoot bool) error {
	if len(commandArgs) == 0 {
		return nil
	}

	cmdName := commandArgs[0]

	if len(commandArgs) > 1 && (commandArgs[1] == "--help" || commandArgs[1] == "-h") {
		printCommandHelp(cmdName)
		return nil
	}

	cmd, exists := cliCommands[cmdName]
	if !exists {
		return &ErrParam{CmdName: cmdName,
			Err: fmt.Errorf("未知命令: %s", cmdName)}
	}

	if requireFilesRoot && filesRoot == "" {
		return &ErrParam{CmdName: cmdName,
			Err: fmt.Errorf("--files-root 参数不能为空")}
	}

	if filesRoot != "" {
		// audit（#4 CLI 写穿）：--files-root 是一次性会话参数——原实现经 saveConfigFn
		// （a.SaveAppConfig）落盘真实用户配置，临时路径的一次性操作会永久改写 GUI
		// 仓库根（静默污染）。改为仅覆写内存会话配置：本次命令内 LoadAppConfig 可见，
		// 磁盘零副作用（不建存储目录、不重启 watcher——CLI 本就无 watcher）。
		// saveConfigFn 形参保留签兼容（GUI 桥传 a.SaveAppConfig），CLI 路径不再调用。
		a.SetSessionFilesRoot(filesRoot)
	}

	ctx := &CmdContext{App: a, FilesRoot: filesRoot, Args: commandArgs[1:]}
	if err := cmd.Run(ctx); err != nil {
		return err
	}

	return nil
}
