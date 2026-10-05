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

// GetLogChannelHealth 返回日志通道自身的健康状态（ADR-322 D1）
//
// 元失败的观测面：内存态 logger / 落盘失败此前只留 log.Printf（进只在内存的
// runtime 环、重启即失），前端无从知晓「日志其实没在落盘」。诊断页据此渲染常驻
// 红条，启动期据此弹一次 toast。
// 口径与 go/tags 内存态显式返回错误（tags.go「P1 修复」注释）同源：不是让日志
// 阻塞主流程，而是让「不阻塞」这件事本身可被看见。
func (a *App) GetLogChannelHealth() types.LogChannelHealth {
	return a.logger.Health()
}

// ClearRuntimeLogs 清空运行时日志缓冲
func (a *App) ClearRuntimeLogs() {
	a.runtimeLogs.Clear()
}
