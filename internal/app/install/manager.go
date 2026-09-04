// ========== install 域 Manager ==========
// ADR-179 垂直切分：App 持有 *Manager，转发 Wails 绑定方法以保签名不变。
// 子包禁止反向 import internal/app（依赖单向）；跨域服务经 deps 闭包注入（守铁律②）。
package install

import (
	"sync"

	"ysm-model-manager/go/types"
)

// ConfigDeps install 域对 App 配置读写的单向依赖（避免反向 import internal/app，守 ADR-179 铁律②）。
// 用闭包注入而非接口：App.saveConfig 为私有方法，闭包可在 app 包内合法转发。
type ConfigDeps struct {
	LoadAppConfig func() types.AppConfig
	SaveAppConfig func(cfg types.AppConfig) error
}

// Manager 聚合 install 域状态。
// P0 收编下载队列；P1 迁入 linkMode（含内存快照与持久化同步）。
type Manager struct {
	Queue *DownloadQueue
	// linkMode 内存快照：持久化落盘后由 App 经 SyncLinkMode 同步（原 app.go 字段，ADR-179 迁入）
	linkMode   string
	linkModeMu sync.RWMutex
	deps       ConfigDeps
}

// NewManager 构造 install 域 manager（下载队列由 App 注入已构造好的 Queue，回调已注入）。
func NewManager(queue *DownloadQueue, deps ConfigDeps) *Manager {
	return &Manager{Queue: queue, deps: deps}
}

// SyncLinkMode 保存配置成功后同步内存快照（App 侧 SaveAppConfig/loadAppConfig 调用，
// 避免安装/同步读点用旧链接模式直到重启——原技术债 #4 修复路径）。
func (m *Manager) SyncLinkMode(mode string) {
	if m == nil {
		return
	}
	m.linkModeMu.Lock()
	m.linkMode = mode
	m.linkModeMu.Unlock()
}
