package cli

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"

	"ysm-model-manager/go/fsutil"
)

// exitCode 退出码常量
const (
	ExitSuccess    = 0
	ExitParamErr   = 2
	ExitRuntimeErr = 1
)

// ErrParam 参数错误（exit code 2）
type ErrParam struct {
	CmdName string
	Err     error
}

func (e *ErrParam) Error() string {
	if e.CmdName != "" {
		return fmt.Sprintf("参数错误 [%s]: %v", e.CmdName, e.Err)
	}
	return fmt.Sprintf("参数错误: %v", e.Err)
}

func (e *ErrParam) Unwrap() error { return e.Err }

// ErrRuntime 运行时业务错误（exit code 1）
type ErrRuntime struct {
	CmdName string
	Err     error
}

func (e *ErrRuntime) Error() string {
	if e.CmdName != "" {
		return fmt.Sprintf("运行时错误 [%s]: %v", e.CmdName, e.Err)
	}
	return fmt.Sprintf("运行时错误: %v", e.Err)
}

func (e *ErrRuntime) Unwrap() error { return e.Err }

// ExitCodeOf 根据错误类型返回退出码
func ExitCodeOf(err error) int {
	var pe *ErrParam
	if errors.As(err, &pe) {
		return ExitParamErr
	}
	return ExitRuntimeErr
}

// PrintError 输出错误到 stderr
func PrintError(err error) {
	if err == nil {
		return
	}
	fmt.Fprintf(os.Stderr, "❌ %v\n", err)
}

// ParseCommandArgs 从参数中提取 files-root、--json 开关和命令参数
// 返回: filesRoot, jsonMode, commandArgs（不含全局参数的剩余参数）
func ParseCommandArgs(args []string) (filesRoot string, jsonMode bool, commandArgs []string) {
	for i := 0; i < len(args); i++ {
		if args[i] == "--files-root" && i+1 < len(args) {
			filesRoot = args[i+1]
			i++
		} else if strings.HasPrefix(args[i], "--files-root=") {
			filesRoot = strings.TrimPrefix(args[i], "--files-root=")
		} else if args[i] == "--json" {
			jsonMode = true
		} else {
			commandArgs = append(commandArgs, args[i])
		}
	}
	return
}

// newCmdFlagSet 创建统一配置的 FlagSet（ContinueOnError + 静默输出）
func newCmdFlagSet(name string) *flag.FlagSet {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	return fs
}

// newParamErrf 创建参数错误（exit code 2）
func newParamErrf(format string, args ...any) error {
	return &ErrParam{Err: fmt.Errorf(format, args...)}
}

// newRuntimeErrf 创建运行时错误（exit code 1）
func newRuntimeErrf(format string, args ...any) error {
	return &ErrRuntime{Err: fmt.Errorf(format, args...)}
}

// parseFlags 解析命令 flags（自动剥离 --files-root 全局参数）
// 返回提取的 filesRoot 和解析错误（*ErrParam）或 nil
func parseFlags(fs *flag.FlagSet, args []string) (filesRoot string, err error) {
	var filtered []string
	skipNext := false
	for i, arg := range args {
		if skipNext {
			skipNext = false
			continue
		}
		if arg == "--files-root" {
			if i+1 < len(args) {
				filesRoot = args[i+1]
				skipNext = true
			}
			continue
		}
		if strings.HasPrefix(arg, "--files-root=") {
			filesRoot = strings.TrimPrefix(arg, "--files-root=")
			continue
		}
		filtered = append(filtered, arg)
	}
	if err2 := fs.Parse(filtered); err2 != nil {
		return filesRoot, &ErrParam{Err: err2}
	}
	return filesRoot, nil
}

// isPowerOf2 检查是否为 2 的幂
func isPowerOf2(n int) bool {
	return n > 0 && (n&(n-1)) == 0
}

// formatSize 格式化文件大小——委托至 fsutil.FormatSize（单一事实来源）。
func formatSize(bytes int64) string { return fsutil.FormatSize(bytes) }

// ========== 输出捕获工具 ==========

// captureStdout 捕获 stdout 输出
// 返回缓冲区和恢复函数（幂等：可安全调用多次）
func captureStdout() (*outputBuffer, func()) {
	orig := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		// Pipe 创建失败，返回一个空 buffer 和空恢复函数（不捕获输出）
		fmt.Fprintf(os.Stderr, "[WARN] captureStdout: os.Pipe 失败: %v\n", err)
		done := make(chan struct{})
		close(done) // 确保 String() 不阻塞
		return &outputBuffer{done: done}, func() {}
	}
	os.Stdout = w

	buf := &outputBuffer{done: make(chan struct{})}
	go func() {
		buf.readFrom(r)
	}()

	var once sync.Once
	return buf, func() {
		once.Do(func() {
			w.Close()
			os.Stdout = orig
		})
	}
}

// outputBuffer 输出缓冲区
type outputBuffer struct {
	data []byte
	done chan struct{}
}

func (b *outputBuffer) readFrom(r *os.File) {
	defer r.Close() // 读端退出即关闭，防止每次 --json 捕获泄漏一个 fd（评审 #2）
	buf := make([]byte, 4096)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			b.data = append(b.data, buf[:n]...)
		}
		if err != nil {
			break
		}
	}
	close(b.done)
}

func (b *outputBuffer) String() string {
	if b.done != nil {
		<-b.done
	}
	return string(b.data)
}

// splitLines 将字符串按行分割（跳过空行，首尾一致）
func splitLines(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			line := s[start:i]
			if len(line) > 0 {
				lines = append(lines, line)
			}
			start = i + 1
		}
	}
	if start < len(s) {
		line := s[start:]
		if len(line) > 0 {
			lines = append(lines, line)
		}
	}
	return lines
}
