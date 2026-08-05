# ADR-039：两轮功能审核后的遗留决策项与处置方向

- **状态**：✅ 已采纳
- **日期**：2026-08-06
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-008 事件注册模式 / ADR-029 WASM 内嵌 / ADR-034 技术债盘点`

---

## 1. 背景（Context）

两轮功能审核（5 个 explore 子代理按知识卡 → source_files → 源码路径，依 AGENTS.md 五维
+ 致命陷阱清单）覆盖 69 张知识卡对应的约 50 个功能模块。首轮修复 5 项（P1×1 P2×4）：
litematic `extractBits` 越界 panic、`sync:download:missing` 并发守卫、batch-rename
`closeDlg` 单例槽位、两处 `customElements.define` 守卫、installer 文本分类过宽。
次轮修复 5 项（P2×4 P3×1）：geometry modelOrder 排序、import-queue/recycle-bin
事件监听配对、dnd promise 链兜底、context-menu Esc 关闭。两轮共 10 项全修复、验证全绿。

本轮盘点**剩余的待决策事项**（非单纯修复，需先定方向再动手），作为下一阶段决策真相源。

---

## 2. 决策（Decision）

### 2.1 WASM 间接 eval 的安全边界（🔴 待审计，先决策后动手）

**现状**：`ysm-parser.ts:81-89` 通过 `window.Module = { wasmBinary, ... }` +
`(0, eval)(patchedGlue)` 间接 eval 执行 WASM 胶水代码。`*-data.js` 为自动生成内嵌文件
（可信链），但 eval 路径无 CSP 白名单保护，若胶水代码被篡改则存在 RCE 面。

**决策**：`✅ 已采纳`——**保留 WASM 主路径，但补齐两道防护后再认定安全**：
1. 评估 WebView2 CSP（`wails3 build` 配置或运行时 `Content-Security-Policy`），
   确认可对内嵌脚本设 `script-src 'self'` 级别限制；
2. 若 CSP 不可行，退而改用 `<script>` 注入或 Web Worker 沙箱承载胶水代码，
   消除 `eval` 调用点（需回归 ADR-029 解码优先级链）。

**不决策项**：不因该面回退 WASM 路径（ADR-029 已定 WASM 为主、Go CLI 为最终回退）。

### 2.2 community 下载队列 Events.On 的生命周期豁免（🟠 确认豁免 or 补 Off）

**现状**：`download-queue.ts:155-232` 模块顶层 `Events.On` 注册一组后端事件，
`_registered` 布尔守卫防重复注册（符合 ADR-008/陷阱 #7），但**无 `Events.Off` 退出路径**
——app 终身携带 4 组 listener。

**决策**：`✅ 已采纳`——**认定为 app 级单例豁免（生命周期 = 应用生命周期）**：
- `download-queue` 是社区页常驻单例（模块加载一次、`_registered` 防重），
  与 `registerErrorDiary` / `matchMedia` 监听同类豁免；
- 在模块头部注释显式标注豁免理由，禁止未来在非 app 级模块复制此模式；
- 若未来社区页支持卸载/热重载，再补 `Events.Off` 退出路径。

### 2.3 renderDisplayName 转义契约确认（🟢 验证性，非改动）

**现状**：`recycle-bin.ts` 行内 `renderDisplayName(name)` 输出未显式包 `esc`，
审核标记为「需确认该函数是否内部转义」。

**决策**：`✅ 已采纳`——**以源码为准完成验证**：`utils/dom/display.ts` 的
`renderDisplayName` 若内部已 `esc`，则调用方无需再包，向知识卡补充契约说明；
若未转义，调用方统一补 `esc`（对齐 ADR-005 R8 未转义拼接红线）。

---

## 3. 后果（Consequences）

### 正面

- 三项遗留均有明确处置方向，下一会话可直接按 §2 落地，无需重新调研
- 事件豁免边界文档化，防止「存在即豁免」蔓延到普通组件

### 负面

- §2.1 依赖 WebView2 CSP 能力确认，若 CSP 不可行需评估 Worker 迁移成本
- §2.3 为验证性工作，结论可能是不改动（仅文档），产出以知识卡更新为主

### 已知遗留

- ADR-009 编号空缺（历史占号缺失，登记表已报 ⚠️，不影响本 ADR）
- `ysmgit` 相关 AI 并行任务在跟进 app_install.go 下沉（ADR-034 延续）

---

## 4. 数据溯源

| 来源 | 数据 | 结果 |
|------|------|------|
| 5 子代理审核（首轮） | P1×1 P2×4 修复，4 commit | 42d1839 / baceeb5 |
| 5 子代理审核（次轮） | P2×4 P3×1 修复，2 commit | 89af7c7 / 0b70e54 |
| `ysm-parser.ts:81-89` | `(0, eval)(patchedGlue)` 间接 eval | §2.1 CSP/沙箱二选一 |
| `download-queue.ts:155-232` | `Events.On` 无 `Events.Off`，`_registered` 守卫 | §2.2 app 级单例豁免 |
| `recycle-bin.ts` + `utils/dom/display.ts` | `renderDisplayName` 内转义未确认 | §2.3 验证后补契约 |

<!-- 文件名: audit-remaining-decisions.md → 实际文件 ADR-039-audit-remaining-decisions.md -->
