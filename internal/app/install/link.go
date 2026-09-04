// ========== 链接模式（install 域） ==========
// 从 app_install_link.go 垂直切分而来（ADR-179 P1：拆解 internal/app 扁平巨型包）。
// 状态（linkMode + linkModeMu）与逻辑整体迁入；SetLinkMode 经 ConfigDeps 闭包读写 App 配置，
// 依赖单向（install 不反向 import internal/app，守铁律②）。
package install

import (
	"fmt"
	"strings"
)

// SetLinkMode 设置链接模式（symlink/hardlink/copy），校验后持久化并同步内存快照。
func (m *Manager) SetLinkMode(mode string) error {
	if m == nil {
		return fmt.Errorf("install manager 未初始化")
	}
	mode = strings.TrimSpace(mode)
	if mode != "symlink" && mode != "hardlink" && mode != "copy" {
		return fmt.Errorf("无效的链接模式: %s", mode)
	}
	cfg := m.deps.LoadAppConfig()
	if cfg.LinkMode == mode {
		return nil
	}
	cfg.LinkMode = mode
	if err := m.deps.SaveAppConfig(cfg); err != nil {
		return err
	}
	m.linkModeMu.Lock()
	m.linkMode = mode
	m.linkModeMu.Unlock()
	return nil
}

// getLinkMode 带锁读取 LinkMode（P1 修复：SetLinkMode/SaveAppConfig 与各安装/同步读点
// 并发访问，无锁读写存在数据竞争）。
func (m *Manager) getLinkMode() string {
	if m == nil {
		return ""
	}
	m.linkModeMu.RLock()
	defer m.linkModeMu.RUnlock()
	return m.linkMode
}

// GetLinkMode 公开读取（Wails 绑定）。
func (m *Manager) GetLinkMode() string {
	return m.getLinkMode()
}
