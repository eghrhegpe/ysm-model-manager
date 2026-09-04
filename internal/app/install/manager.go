// ========== install 域 Manager ==========
// ADR-179 垂直切分：App 持有 *Manager，转发 Wails 绑定方法以保签名不变。
// 子包禁止反向 import internal/app（依赖单向）；跨域服务经 deps 接口注入（后续轮次）。
package install

// Manager 聚合 install 域状态。
// 首刀（P0）仅收编下载队列；后续轮次按计划迁入 linkMode / 日志 / 导入 / 回收 / 实例。
type Manager struct {
	Queue *DownloadQueue
}

// NewManager 构造 install 域 manager（下载队列由 App 注入已构造好的 Queue，回调已注入）。
func NewManager(queue *DownloadQueue) *Manager {
	return &Manager{Queue: queue}
}
