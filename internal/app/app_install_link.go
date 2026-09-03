// ========== 链接模式（拆分自 app_install.go）==========
// 从 app_install.go 拆分：链接模式相关函数
package app

import (
	"fmt"
	"strings"
)

// ========== 链接模式 ==========
func (a *App) SetLinkMode(mode string) error {
	mode = strings.TrimSpace(mode)
	if mode != "symlink" && mode != "hardlink" && mode != "copy" {
		return fmt.Errorf("无效的链接模式: %s", mode)
	}
	cfg := a.LoadAppConfig()
	if cfg.LinkMode == mode {
		return nil
	}
	cfg.LinkMode = mode
	if err := a.saveConfig(cfg); err != nil {
		return err
	}
	a.linkModeMu.Lock()
	a.linkMode = mode
	a.linkModeMu.Unlock()
	return nil
}

// getLinkMode 带锁读取 LinkMode（P1 修复：SetLinkMode/SaveAppConfig 与
// 各安装/同步读点并发访问，无锁读写存在数据竞争）
func (a *App) getLinkMode() string {
	a.linkModeMu.RLock()
	defer a.linkModeMu.RUnlock()
	return a.linkMode
}

func (a *App) GetLinkMode() string {
	return a.getLinkMode()
}
