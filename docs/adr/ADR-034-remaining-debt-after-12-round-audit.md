# ADR-034：12 轮审计后的剩余技术债盘点与处置方向

- **状态**：已采纳（Accepted）
- **日期**：2026-08-04
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-002 项目健康评估 / ADR-003 逻辑下沉 / ADR-011 路径分隔符 / ADR-012 Binding 调用一致性 / ADR-023 测试体系 / audit-summary-2026-08-04.md

---

## 1. 背景（Context）

12 轮审计（audit-summary-2026-08-04.md）已闭环：13 模块 / 16 commits / P1×4 P2×14 P3×17 全修复，
四件套（go build+test / tsc / vitest / doctor）全绿。app_install.go 下沉有并行 AI 在跟。

本 ADR 盘点审计线封顶后**剩余的技术债**，并为每一项给出处置方向与优先级，
作为下一阶段工作的决策真相源。调查覆盖 4 个方向：
前端大文件、Go 测试盲区、治理违规（ADR-011/012）、契约测试覆盖。

---

## 2. 决策（Decision）

### 2.1 方向一：前端大文件拆分（🔴 最高）

**现状**：前端 >500 行文件 13 个，其中 `site-view.ts`（1,314 行）是唯一 RED 级，
`index.ts`（1,032）、`content-css.ts`（919）、`import-queue.ts`（843）紧随。

**处置**：优先拆 `site-view.ts`（前端唯一 RED，ADR-002 §3.2 点名）。
按 AGENTS.md §4.2 拆为 5 文件：主入口编排壳（~120）+ render（~280）+ events（~420）
+ edit（~260）+ drag（~230）。关键设计：共享闭包变量提为显式 `SiteViewState`，
事件绑定返回 cleanup 聚合，render 纯函数化可单测。

**优先级**：P1。RED 单点、零撞车（社区模块独立，下沉 AI 在后端）。

### 2.2 方向二：Go 测试盲区补单测（🟡 中）

**现状**：24 个 Go 包，21 个有测试，**3 个零测试**：

| 包 | 文件数 | 总行数 | 说明 |
|----|--------|--------|------|
| `go/litematic` | 6 | 4,889 | 自动生成数据 + 解析器，核心业务 |
| `go/logs` | 1 | 121 | 日志工具，薄 |
| `go/version` | 1 | 6 | 版本号常量，极薄 |

**处置**：
- `go/version`（6 行）：1 个单测断言版本常量格式即可，5 分钟闭环
- `go/logs`（121 行）：补 NewLogger / Add / Format 三函数单测
- `go/litematic`（4,889 行）：`block_ids_data.go`（3,477 行）是自动生成数据豁免；
  剩余 ~1,400 行解析器（`litematic.go` / `block.go` 等）需补解析正确性单测，
  工作量中等，建议独立 P2 任务

**优先级**：P2。version/logs 快速闭环，litematic 单列。

### 2.3 方向三：治理违规收尾（🟢 低，多为已合规）

**ADR-011 路径分隔符**：状态「已采纳，违规未修复」。实测前端反斜杠自拼违规 **0 处**，
`split(/[/\\]/)` 等跨平台写法已普及。**结论：ADR-011 治理已生效**，
建议将状态注释更新为「已采纳，违规已清零」或直接关闭遗留标记。

**ADR-012 Binding 调用一致性**：状态「已采纳，当前不一致，未修复」。实测：
- `getApp()` 调用点 **119 处**（合规，治理红线 §3.2）
- 直接 `from .../bindings/.../internal/app/app.js` **7 处**（违规）

**处置**：7 处违规改为 `getApp()`，10 分钟闭环。
涉及文件：`app-sidebar/loader.ts`、`app-tree/{bus-handlers,events,instance-actions,loader}.ts`、
`utils/model3d-loader.ts`、`utils/screenshot-renderer.ts`。

**优先级**：P3。量小、机械、易闭环。

### 2.4 方向四：契约测试扩充（🟡 中）

**现状**：`tests/` 共 8 件，守护范围集中在 JSON schema（config/creators/resource/workshop）、
HTML 完整性、脚本输出。**Go Wails Binding 契约零覆盖**——前端调 Go 函数的参数/返回类型
无静态守护，Binding 签名变更只能靠人肉测。

**处置**：新增 `tests/test_binding_contract.mjs`，扫描 `bindings/` 生成 TS 类型导出清单，
断言关键 Binding（Download/Install/Scan/Sync 等）的参数个数与返回类型与前端调用点一致。
对齐 ADR-023 L1 契约层，守护跨层接口。

**优先级**：P2。跨层守护空白，但需先确认 `bindings/` 生成机制。

### 2.5 方向五：非 Windows 跨平台兼容性（🟠 P1-P2 分层）

**现状**：项目默认 Windows 部署，但 Go 侧已做部分跨平台分支，
前端几乎无平台假设（`navigator.platform` / `process.platform` 调用 **0 处**）。
摸排发现 4 类问题，按阻断程度分层：

**P1 阻断级（非 Windows 无法运行）**：

1. `internal/app/wasm_decoder.go:28-29` — 硬编码开发者本机路径
   `"C:\\Users\\zhujieling11\\emsdk\\node\\22.16.0_64bit\\bin\\node.exe"`，
   仅作为 candidates 兜底，但路径本身在任何其他机器/平台上都不存在。
   实际查找链是「硬编码路径 → `exec.LookPath("node")` → `LookPath("node.exe")`」，
   Linux/macOS 上 `LookPath("node")` 即可命中。**结论：不阻断，但应删除硬编码路径**。

2. `go/ysm/cli.go:13-22` — `FindCLI` 全程拼 `YSMParser.exe`，
   仅在最后 `exec.LookPath("YSMParser")` 兜底无 `.exe` 后缀。
   Linux/macOS 上若 CLI 文件名带 `.exe` 后缀也能找到（LookPath 不关心后缀），
   但 `filepath.Join(dir, "YSMParser.exe")` 在非 Windows 上是合法但怪异的文件名。
   **结论：不阻断，但应按 `runtime.GOOS` 选择后缀**。

3. `go/updater/update.go:254-256` — `InstallUpdate` 明确拒绝非 Windows：
   `if runtime.GOOS != "windows" { return fmt.Errorf("自动更新当前仅支持 Windows 平台") }`。
   `assetPattern()` 对非 Windows 返回 `.tar.gz` 占位。
   **结论：自动更新是设计上的 Windows-only，非阻断，但需文档明确**。

**P2 功能缺失级（非 Windows 可运行但功能退化）**：

4. `internal/app/app_config.go:397-410` — Minecraft 启动器路径扫描硬编码 Windows 环境变量：
   `LOCALAPPDATA` / `ProgramFiles` / `ProgramFiles(x86)` / `ProgramData`，
   以及硬编码盘符 `"D:\\Games", "E:\\Game"` 等。
   Linux/macOS 上这些环境变量为空，启动器扫描失效。
   **处置**：按 `runtime.GOOS` 分支，Linux 用 `~/.local/share/PrismLauncher`、
   macOS 用 `~/Library/Application Support/PrismLauncher` 等 XDG/Apple 标准路径。

5. `go/recycle/recycle.go:129` 与 `go/installer/installer.go:383,446` —
   `runtime.GOOS == "windows"` 分支调用 `syscall.CreateFile` / `GetFileInformationByHandle`。
   Unix 分支用 `os.FileInfo.Sys().Nlink()`。**结论：已正确分平台，不阻断**。

6. `go/logs/logs.go` / `go/tags/tags.go` — 注释提及 `%APPDATA%`，
   但实际用 `os.UserConfigDir()`（跨平台）。**结论：注释漂移，改注释即可**。

**前端侧**：

7. `frontend/js/widgets/app-content/tpl.ts:333` — UI 文案硬编码
   `%APPDATA%\YSM-Model-Manager\ysm_config.json`。非 Windows 上路径不同。
   **处置**：路径从 Go 端取（已有 binding），UI 不硬编码。

8. `frontend/js/widgets/app-content/community/settings.ts:384` —
   UI 文案 `"ProgramFiles · Games · %APPDATA% · EXE 同目录"`，同上。

**构建侧**：

9. `cmd/build-release.ps1` / `scripts/release.ps1` — 全 PowerShell 脚本，
   无 bash/Makefile 等价物。非 Windows 构建需手写 `wails build`。
   **处置**：补 `build-release.sh` bash 等价脚本，或用 `go-task` 跨平台任务运行器。

10. `go:embed ysm-updater-helper.exe` — 内嵌 Windows helper 二进制。
    非 Windows 上 `//go:embed` 编译时找不到文件会报错。
    **处置**：用 `//go:build windows` 构建标签隔离 helper embed，
    或为非 Windows 提供 stub。

**优先级**：P1 阻断级（wasm_decoder 硬编码路径删除、cli.go 后缀分支），
P2 功能缺失级（app_config 启动器路径跨平台、构建脚本 bash 等价、updater helper 构建标签）。

**跨平台兼容性目标**：**理论可编译 + 可启动 + 核心功能可用**，
不承诺非 Windows 正式发布（updater/launcher 扫描等功能退化可接受）。

---

## 3. 后果（Consequences）

### 正面

- **剩余债透明化**：4 方向硬数据落盘，下一阶段工作有明确决策依据
- **ADR-011/012 可收尾**：实测违规已清零（011）或仅 7 处（012），治理闭环在望
- **测试盲区量化**：3 包零测试，version/logs 可快速闭环，litematic 单列 P2

### 负面

- **本 ADR 是盘点非修复**：真正的工作量在 P1-P3 任务中，需后续会话落地
- **方向四依赖 bindings 机制确认**：若 `bindings/` 是 Wails 自动生成，
  契约测试需匹配生成时机，复杂度可能上升

### 已知遗留

- `site-view.ts` 拆分（方向一）是 3-4 轮机械大改写，建议单独 commit
- `go/litematic` 4,889 行单测覆盖（方向二）工作量中等，建议独立任务
- ADR-011 状态注释更新（方向三）需手动改 ADR 文件

---

## 4. 数据溯源

| 来源 | 数据 | 结果 |
|------|------|------|
| `wc -l` 前端 | 13 个 >500 行文件，`site-view.ts` 1,314 行唯一 RED | 方向一优先拆 site-view |
| `list_symbols` site-view | 15 符号，`renderSiteView` 横跨 135–1314（1,179 行） | 上帝函数确认 |
| Go 包测试扫描 | 24 包 / 21 有测试 / 3 零测试（litematic 4,889 / logs 121 / version 6） | 方向二盲区量化 |
| `grep '\\\\'` 前端 | ADR-011 反斜杠自拼违规 0 处 | 011 治理已生效 |
| `grep getApp()` vs `from bindings` | 119 处合规 vs 7 处违规 | 012 仅 7 处待改 |
| `ls tests/*.mjs` | 8 件契约测试，Go Binding 契约零覆盖 | 方向四跨层守护空白 |
| `grep runtime.GOOS` | 6 处平台分支（installer/recycle/updater/cli/config/logs） | 方向五 Go 侧已部分跨平台 |
| `grep -rn "%APPDATA%\|LOCALAPPDATA\|ProgramFiles"` | app_config 硬编码 Windows 环境变量 + 盘符 | 方向五 P2 启动器扫描跨平台 |
| `internal/app/wasm_decoder.go:28-29` | 硬编码开发者本机 node.exe 路径 | 方向五 P1 应删除 |
| `grep navigator.platform\|process.platform` 前端 | 0 处平台判断 | 方向五前端零平台假设，跨平台基础好 |
| audit-summary-2026-08-04.md | 12 轮审计 P1×4/P2×14/P3×17 全修复 | 审计线封顶，本 ADR 接力 |

<!-- 文件名: remaining-debt-after-12-round-audit.md → 实际文件 ADR-034-remaining-debt-after-12-round-audit.md -->
