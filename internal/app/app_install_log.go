// ========== 日志（拆分自 app_install.go）==========
// 从 app_install.go 拆分：日志相关函数
package app

import "ysm-model-manager/go/types"

// ========== 日志 ==========
func (a *App) AddImportLog(modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {
	a.logger.Add(modelName, sourcePath, targetDir, fileSize, status, errMsg)
}

func (a *App) AddOpLog(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {
	a.logger.AddOp(op, modelName, sourcePath, targetDir, fileSize, status, errMsg)
}

func (a *App) GetImportLogs() []types.ImportLog {
	return a.logger.GetAll()
}

func (a *App) ClearImportLogs() {
	a.logger.Clear()
}

// GetRuntimeLogs 获取运行时日志（watcher/sync 等标准库 log 输出）
func (a *App) GetRuntimeLogs() []types.RuntimeLog {
	return a.runtimeLogs.GetAll()
}

// GetLogCaps 返回两类日志环形缓冲的实时上限（诊断页检索窗口单源）。
// 2026-09 对接锐评⑤收尾：前端 DIAG_OP_WINDOW/DIAG_RUNTIME_WINDOW 手写镜像退役——
// Op 上限随 AppConfig.LogMaxEntries 可配置，镜像在用户调大缓冲时窗口失真
// （Go 环形缓冲存 1000 条、前端只检索 500，搜索静默漏后半）。
func (a *App) GetLogCaps() types.LogCaps {
	return types.LogCaps{Op: a.logger.Cap(), Runtime: a.runtimeLogs.Cap()}
}

// ClearRuntimeLogs 清空运行时日志缓冲
func (a *App) ClearRuntimeLogs() {
	a.runtimeLogs.Clear()
}
