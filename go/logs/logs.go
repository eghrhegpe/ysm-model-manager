package logs

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"
	"ysm-model-manager/go/types"
)

// Logger 导入日志管理器
type Logger struct {
	mu    sync.Mutex
	logs  []types.ImportLog
	path  string
}

// NewLogger 创建日志管理器
// 优先使用可执行文件所在目录存放日志；若两者均失败则用当前目录
func NewLogger() *Logger {
	exe, err := os.Executable()
	if err != nil {
		log.Printf("[logs] 获取可执行文件路径失败: %v, 使用当前目录", err)
		exe, err = os.Getwd()
		if err != nil {
			log.Printf("[logs] 获取当前工作目录也失败: %v, 使用 .", err)
			exe = "."
		}
	}
	path := filepath.Join(filepath.Dir(exe), "ysm-import-logs.json")
	l := &Logger{path: path}
	l.load()
	return l
}

func (l *Logger) load() {
	data, err := os.ReadFile(l.path)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("[logs] 读取日志文件失败: %v, 将创建新日志", err)
		}
		l.logs = []types.ImportLog{}
		return
	}
	if err := json.Unmarshal(data, &l.logs); err != nil {
		log.Printf("[logs] 解析日志文件失败: %v, 将创建新日志", err)
		l.logs = []types.ImportLog{}
	}
	if l.logs == nil {
		l.logs = []types.ImportLog{}
	}
}

// save 将日志写入磁盘。
// 注意：调用方必须已持有 l.mu 锁（由 Add / Clear 保证）。
func (l *Logger) save() {
	data, err := json.MarshalIndent(l.logs, "", "  ")
	if err != nil {
		log.Printf("[logs] 序列化日志失败: %v", err)
		return
	}
	// 确保日志目录存在
	if dir := filepath.Dir(l.path); dir != "" {
		if err := os.MkdirAll(dir, 0755); err != nil {
			log.Printf("[logs] 创建日志目录失败: %v", err)
			return
		}
	}
	if err := os.WriteFile(l.path, data, 0644); err != nil {
		log.Printf("[logs] 写入日志文件失败: %v", err)
	}
}

// Add 添加一条日志
func (l *Logger) Add(modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.logs = append(l.logs, types.ImportLog{
		ModelName:  modelName,
		SourcePath: sourcePath,
		TargetDir:  targetDir,
		FileSize:   fileSize,
		Status:     status,
		ErrorMsg:   errMsg,
		Timestamp:  time.Now().UnixMilli(),
	})
	if len(l.logs) > 500 {
		l.logs = l.logs[len(l.logs)-500:]
	}
	l.save()
}

// GetAll 获取所有日志
func (l *Logger) GetAll() []types.ImportLog {
	l.mu.Lock()
	defer l.mu.Unlock()
	cp := make([]types.ImportLog, len(l.logs))
	copy(cp, l.logs)
	return cp
}

// Clear 清空日志
func (l *Logger) Clear() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.logs = []types.ImportLog{}
	l.save()
}
