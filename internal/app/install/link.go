// ========== 链接模式（install 域） ==========
// 从 app_install_link.go 垂直切分而来（ADR-179 P1：拆解 internal/app 扁平巨型包）。
// 状态（linkMode + linkModeMu）与逻辑整体迁入；SetLinkMode 经 ConfigDeps 闭包读写 App 配置，
// 依赖单向（install 不反向 import internal/app，守铁律②）。
package install

import (
	"fmt"
	"strings"
)

// IsValidLinkMode 链接模式白名单（install 域唯一事实源，ADR-296 D6）：
// SetLinkMode 硬校验、loadAppConfig 加载软校验、App.SaveAppConfig 写盘前净化共用，
// 替代此前散落各调用方的 `mode != "symlink" && mode != "hardlink" && mode != "copy"` 内联表。
func IsValidLinkMode(mode string) bool {
	switch mode {
	case "symlink", "hardlink", "copy":
		return true
	}
	return false
}

// SanitizeLinkMode 写盘前净化（ADR-296 D6，软校验不 reject；返回值恒为合法值或 ""）：
// 合法 mode 原样通过；mode 空串=「未传该参」→ 回落 fallback；mode 非法（手改
// config.json / 脏调用方）→ 回落 fallback；fallback 也脏 → ""（= 未设置，默认 copy 语义）。
// 不在入口 fail-closed 的原因：App.SaveAppConfig 五参版有多个只想改 mcRoot/theme
// 的调用点会原样回写 linkMode，硬拒会让历史脏值连累无关字段保存（核实子代理 B 项结论）。
// 注意：调用方**不得**再套 orDefault——`orDefault(SanitizeLinkMode(x, old), old)` 在
// x、old 双脏时会被外层 orDefault 用脏 old 反洗（对抗审查 ④），Sanitize 自身已消化兜底。
func SanitizeLinkMode(mode, fallback string) string {
	if IsValidLinkMode(mode) {
		return mode
	}
	if IsValidLinkMode(fallback) {
		return fallback
	}
	return ""
}

// SetLinkMode 设置链接模式（symlink/hardlink/copy），校验后持久化并同步内存快照。
func (m *Manager) SetLinkMode(mode string) error {
	if m == nil {
		return fmt.Errorf("install manager 未初始化")
	}
	mode = strings.TrimSpace(mode)
	if !IsValidLinkMode(mode) {
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
