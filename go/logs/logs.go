package logs

import (
	"encoding/json"
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
func NewLogger() *Logger {
	exe, _ := os.Executable()
	path := filepath.Join(filepath.Dir(exe), "ysm-import-logs.json")
	l := &Logger{path: path}
	l.load()
	return l
}

func (l *Logger) load() {
	data, err := os.ReadFile(l.path)
	if err != nil {
		l.logs = []types.ImportLog{}
		return
	}
	_ = json.Unmarshal(data, &l.logs)
	if l.logs == nil {
		l.logs = []types.ImportLog{}
	}
}

func (l *Logger) save() {
	data, _ := json.MarshalIndent(l.logs, "", "  ")
	_ = os.WriteFile(l.path, data, 0644)
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