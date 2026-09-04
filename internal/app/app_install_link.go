// ========== 链接模式（install 域，App 侧委托） ==========
// 链接模式状态与逻辑已垂直切分至 internal/app/install（ADR-179 P1）。
// 本文件仅保留 Wails 绑定委托，转发至 install.Manager（签名不变，前端零改动）。
package app

func (a *App) SetLinkMode(mode string) error { return a.install.SetLinkMode(mode) }
func (a *App) getLinkMode() string           { return a.install.GetLinkMode() }
func (a *App) GetLinkMode() string           { return a.install.GetLinkMode() }
