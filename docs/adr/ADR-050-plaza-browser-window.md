# ADR-050：模型广场 · 浏览器窗口（Wails 第二窗口）

- **状态**：❌ 已取代（Phase 1 反向代理实现已验证不可行：Wails v3 WebView2 多窗口反代理注入下载拦截在 Windows 环境下反复踩坑，决策废弃 Phase 2/3）
- **日期**：2026-08-11
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **关联**：ADR-003（下载策略）、ADR-049（网页版桥接）、MikuMikuAR ADR-075/087（模型广场基础架构+浏览器体验增强）

---

> **本 ADR 已取代**：Phase 1 反向代理架构验证后判定不可行（Wails v3 WebView2 反代理注入下载拦截工程复杂度超预期），Phase 2/3 废弃。核心结论「站点兼容性问题真实存在」仍有效，但解决方案转向其他路径（保留 iframe + 用户手动「在新标签打开」）。

## 1. 背景（Context）

当前创意工坊页用 sandboxed `<iframe>` 直连外站，`X-Frame-Options: deny` 的站点（如 bowlroll.net）会白屏。曾有 `proxy.go` 反向代理（已删于 `502d3ca7`），但当初放弃是因为「拦截内嵌下载过于复杂」。

用户需求：搭建纯浏览器 Wails 第二窗口，能兼容大多数网站。参考 MikuMikuAR 的三模式切换（ADR-075/087），先实现核心浏览器能力，下载拦截后续迭代。

---

## 2. 决策（Decision）

采用 **Wails v3 多窗口 + Go 反向代理** 方案，分两阶段实施。

### 2.1 架构概览

```
主窗口（YSM 模型管理器）
  └─ 点击站点 → NavigatePlazaWindow(url)
       ├─ Go StartProxy(url) → 127.0.0.1:PORT
       └─ plazaWin.SetURL(proxyURL) → 预热 WebView2 窗口显示

反向代理（proxy.go）
  ├─ 剥离 X-Frame-Options + CSP frame-ancestors
  ├─ 改写相对 URL / 重定向 Location
  ├─ Cookie 中继（内存 jar）
  ├─ SSRF 防护（逐连接重解析 + 拦截私网）
  └─ /__plaza_dl__ + /__plaza_url__ 端点（Phase 2）
```

### 2.2 三模式路由

| 模式 | 流量路径 | 适用站点 | 登录态 |
|------|---------|---------|--------|
| A · 代理内嵌 | Go 反代 → WebView2 窗口 | bowlroll、booth、nicovideo 等展示站 | Cookie 中继 |
| B · 直连窗口 | NavigatePlazaWindow(direct=true) → 真实域名 | 模之屋(aplaybox.com)等 SPA | 共享浏览器 Cookie |
| C · 系统浏览器 | OpenInBrowser → 系统默认浏览器 | 需登录的强 SPA | 保留 |

Phase 1 仅实现 A 模式（代理窗口），B/C 模式复用现有 `OpenInBrowser`。

### 2.3 预热单实例窗口

复用 MikuMikuAR ADR-075 的预热模式：
- `ServiceStartup` 时创建隐藏 WebView2 窗口（`about:blank`，`Hidden: true`）
- `RegisterHook(WindowClosing)` 拦截关闭 → `Cancel() + Hide()`，窗口复用不销毁
- 用户点击站点 → `SetURL(proxyURL) + Show()`，冷启动 1-3s → ~200ms

### 2.4 反向代理（从 MikuMikuAR 适配）

从 MikuMikuAR `proxy.go`（961 行）精简适配，保留核心能力：

| 能力 | 保留 | 说明 |
|------|------|------|
| SSRF 防护 | ✅ | `plazaSSRFGuard` 逐连接重解析 + 拦截私网 |
| X-Frame-Options 剥离 | ✅ | `ModifyResponse` 删除 |
| CSP frame-ancestors 剥离 | ✅ | `ModifyResponse` 删除 |
| 相对 URL 改写 | ✅ | `Director` 中改写 |
| Location 重定向改写 | ✅ | `ModifyResponse` 中改写 |
| Cookie 中继 | ✅ | 内存 jar，per-session |
| WebSocket 代理 | ✅ | `proxyWebSocket` hijack 双向拷贝 |
| User-Agent 伪装 | ✅ | Chrome UA |
| 下载拦截 `/__plaza_dl__` | Phase 2 | 注入脚本 + fetch 回传 |
| URL 追踪 `/__plaza_url__` | Phase 2 | 导航事件上报 |
| 下载进度事件 | Phase 2 | `progressReader` + Emit |

**Phase 1 裁剪**：不注入下载拦截脚本，不实现 `/__plaza_dl__` 和 `/__plaza_url__`。代理仅做「剥离限制头 + 改写路径 + Cookie 中继」。

### 2.5 前端交互

主窗口创意工坊页增加「在窗口中打开」按钮：
- 站点卡片右键/长按 → 上下文菜单 →「在窗口中打开」
- 或站点 Tab 旁增加切换按钮（iframe ↔ 窗口）

前端调用 `NavigatePlazaWindow(url)` 打开第二窗口。

### 2.6 Go 新增绑定

| 方法 | 签名 | 说明 |
|------|------|------|
| `NavigatePlazaWindow` | `(url string, direct bool) error` | 导航预热窗口 |
| `ClosePlazaWindow` | `() error` | 隐藏窗口 + 停代理 |
| `PlazaGoBack` | `() error` | 历史后退 |
| `PlazaGoForward` | `() error` | 历史前进 |
| `PlazaReload` | `() error` | 刷新 |
| `PlazaZoomIn` | `() error` | 放大 |
| `PlazaZoomOut` | `() error` | 缩小 |
| `PlazaZoomReset` | `() error` | 缩放重置 |

---

## 3. 涉及文件

| 文件 | 改动 |
|------|------|
| `internal/app/plaza_window.go` | **新增**：预热窗口 + NavigatePlazaWindow + 导航控制 |
| `internal/app/proxy.go` | **新增**（从 MikuMikuAR 适配）：反向代理 + SSRF 防护 + Cookie 中继 |
| `internal/app/proxy_test.go` | **新增**：SSRF 防护 + 代理核心逻辑测试 |
| `internal/app/app.go` | 修改：App 结构体增加 `plazaWin` / `plazaWinMu` / `httpServers` 等字段；`ServiceStartup` 调 `prewarmPlazaWindow`；`ServiceShutdown` 清理 |
| `main.go` | 无改动（窗口创建在 ServiceStartup 内部） |
| `frontend/bindings/` | 自动生成（新增 Go 方法） |
| `frontend/src/views/app-content/index.ts` | 修改：workshop 页增加「窗口模式」按钮 |

---

## 4. 后果（Consequences）

### 正面
- bowlroll.net 等 `X-Frame-Options: deny` 站点可在窗口中正常浏览
- 预热窗口复用，打开延迟 ~200ms
- SSRF 防护 + Cookie 中继，安全性与 MikuMikuAR 对齐
- Phase 2 可渐进增加下载拦截、URL 追踪

### 负面
- 多窗口管理增加复杂度（窗口关闭/重开状态同步）
- 代理层增加内存开销（cookie jar + HTTP server）

### 已知遗留
- Phase 2：下载拦截（`/__plaza_dl__` + 注入脚本）
- Phase 2：URL 追踪（`/__plaza_url__` + 导航事件）
- Phase 3：Per-site 模式记忆
- B 模式（直连窗口）和 C 模式（系统浏览器）复用现有能力，无需额外开发

---

## 5. 数据溯源

| 来源 | 结果 |
|------|------|
| MikuMikuAR ADR-075 | 预热窗口模式、三模式路由架构 |
| MikuMikuAR ADR-087 | 代理桥接下载拦截、导航控制、URL 追踪 |
| MikuMikuAR `proxy.go` (961L) | 反向代理核心实现、SSRF 防护、Cookie 中继 |
| MikuMikuAR `plaza_window.go` (236L) | 预热窗口 + RegisterHook + 导航 API |
| 本项目 `502d3ca7`（已删 proxy.go） | 历史 SSRF 防护代码参考 |
| 本项目 `workshop_sites.json` (10 站) | 站点列表数据源 |
