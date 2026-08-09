package logs

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
)

// Logger 导入日志管理器
type Logger struct {
	mu   sync.Mutex
	logs []types.ImportLog
	path string
}

// NewLogger 创建日志管理器
// 使用系统标准的应用配置目录（Windows: %APPDATA%, Linux: ~/.config, macOS: ~/Library/Application Support）
func NewLogger() *Logger {
	cfgDir, err := os.UserConfigDir()
	if err != nil {
		log.Printf("[logs] 获取用户配置目录失败: %v, 降级使用当前目录", err)
		cfgDir = "."
	}
	dir := filepath.Join(cfgDir, "YSM-Model-Manager")
	if err := os.MkdirAll(dir, 0755); err != nil {
		log.Printf("[logs] 创建配置目录失败: %v, 降级使用当前目录", err)
		dir = "."
	}
	path := filepath.Join(dir, "ysm-import-logs.json")
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
		// P2 修复：损坏 JSON 备份 .corrupt 再置空（对齐 go/tags 已修模式），
		// 防止损坏现场被下次 save 覆盖、旧数据不可溯
		log.Printf("[logs] 解析日志文件失败: %v, 备份为 .corrupt 后创建新日志", err)
		corrupt := l.path + ".corrupt"
		if renErr := os.Rename(l.path, corrupt); renErr != nil {
			log.Printf("[logs] 备份损坏日志失败: %v", renErr)
		}
		l.logs = []types.ImportLog{}
	}
	if l.logs == nil {
		l.logs = []types.ImportLog{}
	}
	// P4 修复：合法但超 500 条的旧文件 load 后也裁到上限（与写入路径口径一致）
	if len(l.logs) > 500 {
		l.logs = l.logs[len(l.logs)-500:]
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
	// ADR-044 策略 A：落盘统一走 fsutil.WriteFileAtomic（CreateTemp + rename 原子替换）——
	// 原固定 `l.path + ".tmp"` 路径并发写时互相覆盖，且崩溃/断电留半截 JSON
	// 下次 load 解析失败全部历史丢失；CreateTemp 唯一临时文件消除竞争（对齐 go/tags 已修模式）
	if err := fsutil.WriteFileAtomic(l.path, data); err != nil {
		log.Printf("[logs] 写入日志文件失败: %v", err)
	}
}

// Add 添加一条导入日志（兼容旧调用）
func (l *Logger) Add(modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {
	l.addOp("import", modelName, sourcePath, targetDir, fileSize, status, errMsg)
}

// AddOp 添加一条指定操作类型的日志
func (l *Logger) AddOp(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {
	l.addOp(op, modelName, sourcePath, targetDir, fileSize, status, errMsg)
}

func (l *Logger) addOp(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {
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
		Operation:  op,
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
