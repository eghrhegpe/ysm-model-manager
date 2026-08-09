# ADR-046：全平台化可行性调查（对照 MikuMikuAR）

- **状态**：✅ 已采纳（P1 桌面三平台 + P2 Android 主体已实施，P3 iOS 待立项）
- **日期**：2026-08-09
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-034,ADR-029,ADR-033`

---

## 1. 背景（Context）

本项目原目标平台仅 Windows（`Taskfile.yml` 仅 include `common` + `windows`，注释自认「本项目当前目标平台为 Windows」）。用户提出调查**全平台化可行性**，参考同仓库体系下已完成六平台构建 + Android 真机适配的姊妹项目 **MikuMikuAR**（`C:\Users\zhujieling11\MikuMikuAR`）。

调查动机：确认 ysm-model-manager 是否可低成本复制 MikuMikuAR 的跨平台路径，识别真正的阻碍点，为后续立项（桌面三平台 / Android / iOS）提供决策依据。

### 两项目技术栈对比（勘察结论）

| 维度 | ysm-model-manager | MikuMikuAR（参考基准） |
|------|-------------------|------------------------|
| 桌面壳 | Wails v3 alpha2.105（Go 1.25 + WebView2） | Wails v3（同版本体系，ADR-011 因 Android 需求迁 v3） |
| 构建管线 | 原仅 include `windows`；现已补 darwin/linux/android（P1/P2） | **6 平台 includes**：common/windows/darwin/linux/ios/android，各平台 build/ 目录齐全（gradle 工程、pbxproj、nfpm、mime） |
| 绑定 | `wails3 generate bindings -clean=true -ts -i`（.ts + vite 重定向） | 同款 `-ts -d frontend/bindings` 自动生成 + FNV-1a ID 契约测试 |
| 前端架构 | Web Components + Shadow DOM，**零平台守卫**（无 isAndroid），路径统一正斜杠 | 原生 DOM（无 Web Components），**53 处 `isAndroid` 守卫**，小步迭代策略 |
| Go 平台隔离 | **已有雏形**：`hidewindow`(avatar+fileops)/`isCrossDevice`/`isHardLink`/`link`(windows/unix)/`updater`/`app_config` 均有 build tag 平台双文件（`_windows/_other`，link 用 `_windows/_unix`）；P2 新增 PathManager + screen 平台拆分 | PathManager 接口 + build tags 平台实现（`pathmgr_desktop.go`/`pathmgr_android.go`）、FileAccessor 抽象（10 处 `os.*` 收拢） |
| 3D | Three.js + 内嵌 YSMParser WASM（WebView 内解码，无 exe sidecar） | Babylon.js + babylon-mmd + WASM Bullet 物理 |
| 更新 | 自更新**仅 Windows**（.exe 替换 + ysm-updater-helper.exe） | 未作重点 |
| 文件访问 | `os.*` 直读 + HTTP 文件服务器（127.0.0.1） | 同款 + Android 端 `readFileBytes`+Blob URL（ADR-017 A0-01 根治） |

## 2. 决策（Decision）

**结论：全平台化高可行，且阻力低于预期。** MikuMikuAR 已把全路径（Windows/macOS/Linux/Android/iOS 六平台构建 + Android 真机适配）完整趟过一遍，ysM 与其技术栈同源，可按同一套路低成本复制。

> **置信度分级（2026-08-09 实施后回看）**：P1 桌面三平台**已落地**（Taskfile + darwin/linux build 目录 + explorer 平台分支）；P2 Android 主体**已落地**（工程资产 + PathManager + 存储授权 + 系统事件链路 + 目录选择平台分支），唯一遗留风险（WASM SharedArrayBuffer）经审计**解除**；P3 iOS 待立项（生态最不成熟）。

### 阻碍点分级（2026-08-09 实施后回看）

#### 🟢 低阻（已全部解决，补丁级）

| 阻碍点 | ysm 现状（实施前 → 后） | 解法 |
|--------|----------|------|
| 构建管线缺失 | 只支持 Windows → 已补 darwin/linux/android build 目录 + Taskfile includes + CI 矩阵 | `wails3 generate`/模板 + 搬运 MikuMikuAR 发版脚本 |
| explorer 专属命令 | `RevealInExplorer`(app_files.go)、`OpenFolder`(app_scan.go) 硬编码 `explorer` → 已平台分支 | Windows `explorer` / macOS `open` / Linux `xdg-open` |
| 回收站语义 | `isHardLink`(nlink>1)、跨卷 errno 判断已有 `_other` 实现 | 已就绪，无需改动 |
| 安装器系统目录保护 | `c:\windows` 等已有 `runtime.GOOS` 分支 | 已就绪 |
| 自动更新 | 明确拒绝非 Windows | 维持 Windows-only（现状即安全失败，ADR-033 已明确） |
| 前端 | 无平台守卫 = 平台无关（Web Components 是 Web 标准，Android/WKWebView/WebKitGTK 均支持） | 零改动，实际未动 |

#### 🟠 中阻（Android 专属，已实施；两处方案经实证修正）

| 阻碍点 | 实施结论（含修正） |
|--------|-------------------|
| 路径/存储根 | ✅ PathManager 抽象（build tags：desktop/android 两实现，`pathmgr_*.go`） |
| 文件选择 | ⚠️ **方案修正**：原计划 Wails v3 Dialog SAF（`CanChooseDirectories(true)`）——实测官方 `dialogs_android.go` **明确拒绝 Android 目录选择**（SAF 返回 content:// URI 而非文件系统路径，Go `os.*` 不可读；MikuMikuAR ADR-194 亦废弃 SAF）。改为**授权 + 路径输入**：前端 `pickDirectory()` 桌面走 Dialog、Android 走「授权检查 → modalPrompt 输入绝对路径」 |
| 外部存储授权 | ✅ `MANAGE_EXTERNAL_STORAGE` 权限 + 授权弹窗（`requestStoragePermission`）+ `storage:permissionGranted` 事件 → 前端重扫库 |
| 系统事件 | ✅ Java 端转发 `android:back`（双击退出）/`ScreenLocked`/`NetworkChanged` 等，前端 android-events.ts 消费 |
| 触屏交互 | ✅ 官方模板自带 Pointer Events 统一鼠标/触屏（无需额外改造） |
| prompt/confirm | ✅ 审计通过：前端零残留（仅 modal.ts 注释），已统一 `modalPrompt/modalConfirm/modalSelect` |

#### 🔴 高阻（审计解除，无需降级）

**YSMParser WASM 在 Android WebView 的可用性**——MikuMikuAR 的实证教训（ADR-133）：Android WebView `crossOriginIsolated` 恒为 false，**依赖 SharedArrayBuffer 的多线程 WASM 在 Android 直接不可用**。MikuMikuAR 为此把物理降级为 SPR 单线程。已审计：

1. ✅ **YSMParser WASM 依赖审计（2026-08-09）**：二进制 memory 段为 defined memory（flags=1 非共享，min=259/max=32768），glue `YSMParser.js` 零 `SharedArrayBuffer`/`Atomics` 引用——**单线程纯计算，Android WebView 可直接运行，无需 WASM 降级**。审计方法：node 解析 wasm 段结构（LEB128）+ glue 源码 grep。
2. WebView2 → Android WebView 的渲染性能差距（低端机初始化慢，MikuMikuAR 用 `isAndroid` 守卫降级质量）——留待真机验证，非阻塞。

### 建议路径（三阶段，每阶段独立可交付；2026-08-09 回看）

| 阶段 | 范围 | 工作量 | 状态（2026-08-09） |
|------|------|--------|----------|
| **P1 桌面三平台** | 补 darwin/linux build 目录 + explorer/updater 平台分支；前端零改动 | 低（约 1-2 天） | ✅ **已实施**（`Taskfile.yml` includes + `build/darwin|linux/Taskfile.yml` + `cmd/build-darwin.sh|build-linux.sh` + `RevealInExplorer`/`OpenFolder` 平台分支 + hideWindow 抽象 + `screen_*.go` 拆分） |
| **P2 Android** | PathManager 抽象 + 存储授权 + 系统事件 + 目录选择平台分支 + WASM 审计 | 中 | ✅ **主体已实施**（`build/android/` 官方模板 + `cmd/build-android.ps1` + PathManager + `MANAGE_EXTERNAL_STORAGE` 授权链路 + `android-events.ts` + `pickDirectory()` 平台分支 + WASM 审计解除）；SAF 目录选择方案经实测修正（见 §2 中阻） |
| **P3 iOS** | pbxproj + 签名 + App Store 流程 | 高 | ⏸ 待立项（Wails v3 支持但生态最不成熟） |

**顺带红利（已兑现）**：ysm 的 Go 侧平台隔离基础比 MikuMikuAR 起步时更好（6 组 `_windows/_other` 双文件已在），P1 阶段几乎未动 Go 业务代码。

## 3. 后果（Consequences）

**正面**
- 桌面三平台（Windows/macOS/Linux）成本极低，前端零改动，扩用户面。✅ 已实现
- Go 侧平台隔离基础已有（6 组 build tag 双文件），P1 几乎不动 Go 业务代码。✅ 已兑现
- 绑定链路（-ts + vite 重定向）与 MikuMikuAR 同款，前端契约不变。
- **WASM 审计解除最大风险**：YSMParser 单线程，Android 无需降级（推翻 ADR-133 式悲观假设）。

**负面**
- ~~P2 Android 依赖 WASM 降级方案，3D 渲染质量在低端机可能打折~~ → **已解除**（审计确认单线程无共享内存，无需降级；真机性能留待验证）。
- 多平台意味着 CI/发版矩阵扩大，维护面上升（updater 等 Windows 专属功能需平台守卫）。
- Android 目录选择体验受限：Wails 官方不支持目录对话框 + SAF 不可用（content:// URI），退化为「手动输入绝对路径」——移动端体验是妥协项。
- iOS 生态不成熟 + 签名/商店流程成本高，优先级应排最后（待立项）。

**已知遗留**
- 自动更新维持 Windows-only（ADR-033 已明确拒绝非 Windows，需跨平台需求信号再立项）。
- ✅ 前端 `prompt()`/`confirm()` 残留审计（2026-08-09）：全前端仅命中 `modal.ts:93` 注释；已统一走 `modalPrompt/modalConfirm/modalSelect`（ADR-014 治理成果），**Android WebView 对话框兼容无需改动**。
- ✅ YSMParser WASM 的 SharedArrayBuffer 依赖审计（2026-08-09）：单线程无共享内存（见 §2 高阻），Android 直接可用。
- ✅ P2 Android 主体已实施（工程资产/PathManager/存储授权/系统事件/目录选择平台分支）；**剩余**：真机验证授权流程、WASM 渲染性能、Android 专属 Java 定制深化。

## 4. 数据溯源

| 来源 | 结论 |
|------|------|
| ysm `Taskfile.yml` / `build/`（勘察时） | 仅 include windows；build/darwin/ 仅含 icons.icns 占位、无构建配置 |
| ysm `Taskfile.yml` / `build/`（实施后） | 已 include windows/darwin/linux/android；各平台 build/ 目录含 Taskfile.yml + 工程资产（gradle/Info.plist） |
| ysm `main.go` + `docs/architecture.md` §1/§2 | Wails v3 alpha2.105 + Go 1.25 + WebView2；单一 Service |
| ysm grep `go:build`（go/ + internal/） | 6 组 `_windows/_other` 双文件已存在（hidewindow/isCrossDevice/isHardLink/link/updater/app_config）+ P2 新增 pathmgr/screen 平台拆分 |
| ysm `internal/app/app_files.go`、`app_scan.go` | `exec.Command("explorer", ...)` 硬编码 → 已平台分支（explorer/open/xdg-open） |
| ysm `go/updater/update.go` | `runtime.GOOS != "windows"` 明确拒绝自动更新（维持 Windows-only） |
| ysm `frontend/src` grep | 零 isAndroid/platform 守卫；路径统一 `replace(/\\/g, "/")`；`prompt(/confirm(` 仅命中 modal.ts 注释 |
| ysm `frontend/public/wasm/YSMParser.wasm`（node 解析 memory 段） | defined memory flags=1 非共享、min=259/max=32768 → **单线程** |
| ysm `frontend/public/wasm/YSMParser.js`（grep） | 零 `SharedArrayBuffer`/`Atomics` 引用 |
| Wails v3 源码 `pkg/application/dialogs_android.go:121` | **官方明确拒绝 Android 目录选择**（SAF 返回 content:// URI 而非文件系统路径）→ 目录选择改「授权+路径输入」 |
| MikuMikuAR `Taskfile.yml` + `build/` | 6 平台 includes + 各平台 build/ 目录（gradle/pbxproj/nfpm/mime） |
| MikuMikuAR `docs/adr/adr-011` | 为 Android 需求迁 Wails v3（决策演进） |
| MikuMikuAR `docs/adr/adr-017` | Android 适配主体完成（SAF/cleartext/事件总线/readFileBytes+Blob URL） |
| MikuMikuAR `docs/adr/adr-018` | PathManager build-tags 平台抽象 |
| MikuMikuAR `docs/adr/adr-133` | Android `crossOriginIsolated` 恒 false，MPR 多线程不可用 |
| MikuMikuAR `docs/adr/adr-194` | SAF 目录选择废弃（content:// URI Go 不可读），改授权直读 |

<!-- 文件名: cross-platform-feasibility.md → 实际文件 ADR-046-cross-platform-feasibility.md -->
