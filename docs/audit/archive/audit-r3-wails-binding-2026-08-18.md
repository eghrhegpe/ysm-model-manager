# R3 审核报告：Wails Binding 层（internal/app）

**审核日期**：2026-08-18
**审核范围**：`internal/app/` 全部 45 个 Go 文件（~8200 行）
**审核维度**：输入校验、权限边界、SSRF 防护、并发安全、错误传播

---

## 进度统计

| 指标 | 数值 |
|------|------|
| 审核文件数 | 45 |
| 发现问题总数 | 8 |
| P1（严重） | 0 |
| P2（一般） | 1 |
| P3（建议） | 2 |
| 良好实践（亮点） | 5 |
| 待决策 | 0 |

---

## P2 问题（一般）

### P2-1: SSRF 代理剥离安全响应头

| 项目 | 内容 |
|------|------|
| 文件:行号 | `internal/app/proxy.go:304-308` + `317-319` |
| 问题描述 | ReverseProxy 的 `Director` 和 `ModifyResponse` 中剥离了 `X-Frame-Options`、`Content-Security-Policy`、`X-XSS-Protection` 三个安全响应头。虽然这是为了在 WebView 内嵌第三方站点的技术必要（否则同域策略会阻止加载），但这也意味着所有通过代理访问的外部站点都失去了这些防护。 |
| 风险 | 如果代理被误用或目标站点被攻击者控制，可能导致 clickjacking 或 XSS 放大。当前是「设计决策」而非漏洞，但需在文档中明确说明。 |
| 修复建议 | 添加注释说明剥离原因（WebView 内嵌兼容性），并在 ADR 或 docs/ 中记录此安全权衡。可选增强：对 `frame-ancestors` CSP 指令做最小化剥离（仅删除同站点限制部分，保留其他）。 |

---

## P3 问题（建议）

### P3-1: ToggleResourcePack TOCTOU 竞态

| 项目 | 内容 |
|------|------|
| 文件:行号 | `internal/app/resource_bindings.go:296` |
| 问题描述 | `os.Stat(dst)` 判断目标不存在后执行 `os.Rename(src, dst)`，两者之间未加锁。并发调用时两个请求可能同时通过 Stat 检查，导致后者静默覆盖前者。 |
| 风险 | 低：ToggleResourcePack 通常由用户手动触发，并发概率极低；且覆盖结果是「取最后操作」而非数据损坏。 |
| 修复建议 | 对齐 `fileops.opMu` 写操作互斥锁模式，或将 `os.Stat + os.Rename` 合并为原子操作（Go 1.16+ 的 `os.Rename` 在目标已存在时返回 error，可据此判断）。 |

### P3-2: configFunc 全局变量无锁访问

| 项目 | 内容 |
|------|------|
| 文件:行号 | `go/fileops/fileops.go:24-29`、`go/scanner/scanner.go`（同模式）、`go/download/download.go`（同模式） |
| 问题描述 | `configFunc` 是包级全局变量，`SetConfigFunc` 在 `ServiceStartup` 中写入，后续 `previewReadLimit()` 等函数读取。虽然写入发生在启动期单线程，但如果未来有热重载配置场景，缺少读写锁保护。 |
| 风险 | 极低：当前架构下 `configFunc` 仅在启动期设置一次，后续只读。 |
| 修复建议 | 暂时保持现状；如未来引入配置热重载，改为 `sync.RWMutex` 保护。 |

> ✅ **已处置**（`89df39ba`，ADR-091 D12）：四包各自的 `configFunc`/`SetConfigFunc` 已删除，收敛到 `go/config` 统一单持有点（`atomic.Pointer[Provider]`，internal/app 经 `config.Set(a.LoadAppConfig)` 注入，各 helper 读 `config.Get()`）。Store/Load 原子无并发读写竞争，且 `go/config` 含 `-race` 后台测试。本记录为历史审计快照，代码侧符号 `configFunc` 已不存在，重扫命中即过期。

---

## 良好实践（亮点）

| # | 实践 | 文件 | 说明 |
|---|------|------|------|
| 1 | **路径守卫全覆盖** | `app_files.go`, `app_scan.go`, `app_model.go` | 所有公开绑定方法（`CreateDir`, `RenameDir`, `RemoveDir`, `RenameFile`, `ScanModelEntries`, `ListFileNames`, `ListAllFilePaths`, `CheckFileExists`, `ReadFileBytes`）均通过 `isPathInRootOrSelf` 或 `isPathInRoot` 守卫，防路径穿越。 |
| 2 | **SSRF 防护** | `proxy.go:94-115` | `ssrfGuardDial` 在 dial 阶段解析 DNS 并校验 IP，拦截私网/保留地址；`isBlockedHost` 预检 + `isBlockedIP` 兜底。 |
| 3 | **子进程超时护栏** | `wasm_decoder.go:27-33` | `.ysm` WASM 解码子进程有 60s 超时 + 输出大小限制（200MB），防解压炸弹和死循环。 |
| 4 | **临时文件隔离** | `wasm_decoder.go:117-121` | `os.MkdirTemp` 创建隔离 tmpdir，`defer os.RemoveAll` 自动清理；胶水代码和 WASM 二进制写入隔离目录。 |
| 5 | **截图文件名守卫** | `app_model.go:255` | `filepath.Base(clean) != clean` 拒绝含路径穿越的文件名，仅允许纯文件名。 |

---

## 与路径分组优化的交集提醒

R2 审核已识别 `go/paths/safe.go` 的 `IsInside` 语义。**R3 的 `isPathInRootOrSelf` 是路径守卫的第二道防线**，与 `go/paths` 的 `IsInside` 互为补充：
- `go/paths.IsInside`：底层字符串比较，不解析符号链接
- `isPathInRootOrSelf`：上层语义守卫，多根遍历 + 盘符隔离

路径分组优化若改变 `FilesRoot` 的子目录结构，`isPathInRootOrSelf` 无需改动（其逻辑基于 `cfg.FilesRoot` 动态推导），但需验证 `specificRoot` 的反射驱动路径（`resource_bindings.go:224-241`）仍能正确匹配新分组。

---

## 结论

R3 审核结论：**Go 后端 Binding 层安全性优秀**，路径守卫、SSRF 防护、子进程护栏均已到位。未发现 P1 阻断性问题。P2-1 是设计权衡需文档化，P3 为低优先级改进项。

**整体代码库安全态势（R1+R2+R3）**：
- R1（3D 引擎）：P1×2 ✅ 已修复，P2×6 ✅ 已修复
- R2（Go 路径层）：P1×0，P2×3（非阻断），P3×2
- R3（Wails Binding）：P1×0，P2×1（需文档化），P3×2

下一步建议：进入 **R6 安全横切扫描**（全仓 XSS/注入/CSP 静态分析）或 **R4 前端视图层审核**。
