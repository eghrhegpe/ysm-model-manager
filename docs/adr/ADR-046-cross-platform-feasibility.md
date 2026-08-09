# ADR-046：全平台化可行性调查（对照 MikuMikuAR）

- **状态**：✅ 已采纳
- **日期**：2026-08-09
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-034,ADR-029,ADR-033`

---

## 1. 背景（Context）

本项目当前目标平台仅 Windows（`Taskfile.yml` 仅 include `common` + `windows`，注释自认「本项目当前目标平台为 Windows」；build/darwin/ 仅有图标占位（icons.icns），无 Taskfile 构建配置）。用户提出调查**全平台化可行性**，参考同仓库体系下已完成六平台构建 + Android 真机适配的姊妹项目 **MikuMikuAR**（`C:\Users\zhujieling11\MikuMikuAR`）。

调查动机：确认 ysm-model-manager 是否可低成本复制 MikuMikuAR 的跨平台路径，识别真正的阻碍点，为后续立项（桌面三平台 / Android / iOS）提供决策依据。

### 两项目技术栈对比（勘察结论）

| 维度 | ysm-model-manager | MikuMikuAR（参考基准） |
|------|-------------------|------------------------|
| 桌面壳 | Wails v3 alpha2.105（Go 1.25 + WebView2） | Wails v3（同版本体系，ADR-011 因 Android 需求迁 v3） |
| 构建管线 | **Taskfile 仅 include `windows`**；build/darwin/ 仅有图标占位（icons.icns），无 Taskfile 构建配置 | **6 平台 includes**：common/windows/darwin/linux/ios/android，各平台 build/ 目录齐全（gradle 工程、pbxproj、nfpm、mime） |
| 绑定 | `wails3 generate bindings -clean=true -ts -i`（.ts + vite 重定向） | 同款 `-ts -d frontend/bindings` 自动生成 + FNV-1a ID 契约测试 |
| 前端架构 | Web Components + Shadow DOM，**零平台守卫**（无 isAndroid），路径统一正斜杠 | 原生 DOM（无 Web Components），**53 处 `isAndroid` 守卫**，小步迭代策略 |
| Go 平台隔离 | **已有雏形**：`hidewindow`(avatar+fileops)/`isCrossDevice`/`isHardLink`/`link`(windows/unix)/`updater`/`app_config` 均有 build tag 平台双文件（`_windows/_other`，link 用 `_windows/_unix`） | PathManager 接口 + build tags 平台实现（`pathmgr_desktop.go`/`pathmgr_android.go`）、FileAccessor 抽象（10 处 `os.*` 收拢） |
| 3D | Three.js + 内嵌 YSMParser WASM（WebView 内解码，无 exe sidecar） | Babylon.js + babylon-mmd + WASM Bullet 物理 |
| 更新 | 自更新**仅 Windows**（.exe 替换 + ysm-updater-helper.exe） | 未作重点 |
| 文件访问 | `os.*` 直读 + HTTP 文件服务器（127.0.0.1） | 同款 + Android 端 `readFileBytes`+Blob URL（ADR-017 A0-01 根治） |

## 2. 决策（Decision）

**结论：全平台化高可行，且阻力低于预期。** MikuMikuAR 已把全路径（Windows/macOS/Linux/Android/iOS 六平台构建 + Android 真机适配）完整趟过一遍，ysM 与其技术栈同源，可按同一套路低成本复制。

> **置信度分级**：P1 桌面三平台为**确定可行**（不依赖 WASM，前端零改动）；P2 Android 为**高可行但条件成立**——须先通过 YSMParser WASM 的 SharedArrayBuffer 依赖审计（🔴 红线前置），未过审则 Android 路径需降级方案。

### 阻碍点分级

#### 🟢 低阻（补丁级，照抄 MikuMikuAR 即有解）

| 阻碍点 | ysm 现状 | 解法 |
|--------|----------|------|
| 构建管线缺失 | 只支持 Windows | `wails3 generate`/模板补 darwin/linux/android/ios 的 build/ 目录 + Taskfile includes（MikuMikuAR 已示范） |
| explorer 专属命令 | `RevealInExplorer`(app_files.go:93)、`OpenFolder`(app_scan.go:292) 硬编码 `explorer` | 平台分支：Windows `explorer` / macOS `open` / Linux `xdg-open`，套用既有 `app_config_other.go` 模式 |
| 回收站语义 | `isHardLink`(nlink>1)、跨卷 errno 判断已有 `_other` 实现 | 已就绪，无需改动 |
| 安装器系统目录保护 | `c:\windows` 等已有 `runtime.GOOS` 分支 | 已就绪 |
| 自动更新 | 明确拒绝非 Windows | 可保留 Windows-only（现状即安全失败，ADR-033 已明确），后续再扩展 |
| 前端 | 无平台守卫 = 平台无关（Web Components 是 Web 标准，Android/WKWebView/WebKitGTK 均支持） | 零改动预期 |

#### 🟠 中阻（Android 专属，需移植 MikuMikuAR 成熟方案）

| 阻碍点 | 解法（照抄 ADR-017/018） |
|--------|--------------------------|
| 路径/存储根 | PathManager 抽象（build tags：desktop/android 两实现） |
| 文件选择 | Wails v3 Dialog SAF（`CanChooseDirectories(true)`），无自建桥 |
| 外部存储授权 | AndroidManifest `usesCleartextTraffic` + 权限事件总线（`storage:permissionGranted`） |
| 系统事件 | Java 端转发 `android:back`/`ScreenLocked`/`NetworkChanged` 等，前端消费 |
| 触屏交互 | Pointer Events 统一鼠标/触屏 |
| prompt/confirm | 需 grep ysm 前端是否有 `prompt()`/`confirm()` 残留（MikuMikuAR 曾改 ~20 处），有则换 Wails Dialog/自定义模态 |

#### 🔴 高阻（唯一真正的技术风险）

**YSMParser WASM 在 Android WebView 的可用性**——MikuMikuAR 的实证教训（ADR-133）：Android WebView `crossOriginIsolated` 恒为 false，**依赖 SharedArrayBuffer 的多线程 WASM 在 Android 直接不可用**。MikuMikuAR 为此把物理降级为 SPR 单线程。需验证：

1. YSMParser WASM 是否依赖 `SharedArrayBuffer` / `Atomics`（若仅单线程解码则无碍）；
2. WebView2 → Android WebView 的渲染性能差距（低端机初始化慢，MikuMikuAR 用 `isAndroid` 守卫降级质量）。

### 建议路径（三阶段，每阶段独立可交付）

| 阶段 | 范围 | 工作量 | 前置条件 |
|------|------|--------|----------|
| **P1 桌面三平台** | 补 darwin/linux build 目录 + explorer/updater 平台分支；前端零改动 | 低（约 1-2 天） | 需 macOS/Linux 构建机验证（或 Docker 交叉编译，Taskfile 已有 setup:docker） |
| **P2 Android** | PathManager 抽象 + SAF 选择器 + 事件总线 + 权限处理 + WASM 降级方案 | 中（照 ADR-017 是数天到数周的量级） | **先做 YSMParser WASM 依赖审计**（红线前置）；NDK/CGO 构建链 |
| **P3 iOS** | pbxproj + 签名 + App Store 流程 | 高，通常最后做 | Wails v3 支持但生态最不成熟 |

**顺带红利**：ysm 的 Go 侧平台隔离基础比 MikuMikuAR 起步时更好（6 组 `_windows/_other` 双文件已在），P1 阶段甚至可能不动 Go 业务代码。

## 3. 后果（Consequences）

**正面**
- 桌面三平台（Windows/macOS/Linux）成本极低，前端零改动预期，扩用户面。
- Go 侧平台隔离基础已有（6 组 build tag 双文件），P1 甚至可能不动 Go 业务代码。
- 绑定链路（-ts + vite 重定向）与 MikuMikuAR 同款，前端契约不变。

**负面**
- P2 Android 依赖 WASM 降级方案，3D 渲染质量在低端机可能打折（MikuMikuAR 同款取舍）。
- 多平台意味着 CI/发版矩阵扩大，维护面上升（updater/launcher 等 Windows 专属功能需平台守卫）。
- iOS 生态不成熟 + 签名/商店流程成本高，优先级应排最后。

**已知遗留**
- 自动更新维持 Windows-only（ADR-033 已明确拒绝非 Windows，需跨平台需求信号再立项）。
- 前端 `prompt()`/`confirm()` 残留未审计（P2 Android 前置项）。
- YSMParser WASM 的 SharedArrayBuffer 依赖未审计（P2 红线前置项）。

## 4. 数据溯源

| 来源 | 结论 |
|------|------|
| ysm `Taskfile.yml` / `build/` | Taskfile 仅 include windows；build/darwin/ 仅含 icons.icns 占位、无构建配置（build/ 脚手架已入仓，见 .gitignore） |
| ysm `main.go` + `docs/architecture.md` §1/§2 | Wails v3 alpha2.105 + Go 1.25 + WebView2；单一 Service |
| ysm grep `go:build`（go/ + internal/） | 6 组 `_windows/_other` 双文件已存在（hidewindow/isCrossDevice/isHardLink/link/updater/app_config） |
| ysm `internal/app/app_files.go`(~88)、`app_scan.go`(~304) | `exec.Command("explorer", ...)` 硬编码 |
| ysm `go/updater/update.go:265` | `runtime.GOOS != "windows"` 明确拒绝自动更新 |
| ysm `frontend/src` grep | 零 isAndroid/platform 守卫；路径统一 `replace(/\\/g, "/")` |
| MikuMikuAR `Taskfile.yml` + `build/` | 6 平台 includes + 各平台 build/ 目录（gradle/pbxproj/nfpm/mime） |
| MikuMikuAR `docs/adr/adr-011` | 为 Android 需求迁 Wails v3（决策演进） |
| MikuMikuAR `docs/adr/adr-017` | Android 适配主体完成（SAF/cleartext/事件总线/readFileBytes+Blob URL） |
| MikuMikuAR `docs/adr/adr-018` | PathManager build-tags 平台抽象 |
| MikuMikuAR `docs/adr/adr-133` | Android `crossOriginIsolated` 恒 false，MPR 多线程不可用 |

<!-- 文件名: cross-platform-feasibility.md → 实际文件 ADR-046-cross-platform-feasibility.md -->
