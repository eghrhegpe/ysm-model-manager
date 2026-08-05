# ADR-040：架构规模治理——前端大文件拆分与 internal 下沉收口

- **状态**：✅ 已采纳
- **日期**：2026-08-06
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-002 项目健康评估 / ADR-034 12 轮审计技术债 / ADR-003 逻辑下沉`

---

## 1. 背景（Context）

十余轮功能审核（子代理按知识卡审代码 + P1/P2/P3 修复清零）完成后，架构层的**规模治理**
问题浮出水面：功能性债务（bug/竞态/资源泄漏）已清，但结构性债务仍在累积。实测数据：

| 层 | 问题文件 | 行数 | 问题 |
|----|---------|------|------|
| 前端 | `app-content/index.ts` | **1,028** | 唯一超千行 RED，页面编排/设置/社区职责混杂 |
| 前端 | `content-css.ts` | 920 | Shadow DOM 样式，体量偏大 |
| 前端 | `settings/community.ts` | 916 | 社区设置页单体 |
| 前端 | `import-queue.ts` / `skeleton.ts` 等 | 863 / 829 | 业务与 UI 混合，9 个 >500 行文件 |
| Go | `internal/app/app_install.go` | 765 | internal 层应薄（ADR-003），超 700 行说明下沉不彻底 |
| Go | `internal/app/cli.go` | 728 | 同上 |
| Go | `go/sync/sync.go` | 727 | 可拆 relink/status/hash 子文件 |
| 知识卡 | `internal/app` 21 个绑定文件 | — | 仅 1 张总览卡，import-executor/dnd-shared 无独立卡 |

ADR-002 已点名 site-view（JS 时代 1,268 行），ADR-034 §2.1 给出拆分为 5 文件蓝图；
本轮新增事实：TS 化后 `app-content/index.ts` 成为新的超千行 RED，且 internal 层
下沉未收口。

---

## 2. 决策（Decision）

### 2.1 前端大文件拆分（🔴 最高优先）

**决策**：按 AGENTS.md §4.2 三层规范（index/data/render/events/tpl）增量拆分，
**不推倒重来、不引入重型框架**（维持 ADR-014 约束）。

| 文件 | 拆分方向 | 优先级 |
|------|---------|--------|
| `app-content/index.ts`（1,028） | 主入口壳 + render + settings 子模块（settings 已部分独立） | P1 |
| `settings/community.ts`（916） | 按 ADR-034 §2.1 site-view 蓝图拆 render/events/data | P1 |
| `import-queue.ts`（863） | 表单编辑/队列/拖拽三块拆 render/events | P2 |
| `skeleton.ts` / `wasm.ts` / `litematic-3d.ts` | 预览系拆分（render 纯函数化） | P2 |

**红线**：拆分后每文件 ≤400 行；事件绑定返回 cleanup 聚合；render 纯函数化可单测；
拆完跑 tsc + vitest + check-redlines。

### 2.2 internal 层下沉收口（🟠 中）

**决策**：`internal/app` 保持薄 wrapper，业务逻辑继续下沉 `go/` 包：

| 文件 | 处置 | 优先级 |
|------|------|--------|
| `app_install.go`（765） | 下沉至 `go/installer/`（ADR-002 P1 延续，并行 AI 在跟） | P1 |
| `cli.go`（728） | 保留 CLI 编排，解析/执行逻辑抽 `go/` 或子文件 | P2 |
| `go/sync/sync.go`（727） | 拆 `sync_relink.go`/`sync_status.go`/`hash.go` 子文件 | P3 |

**验收**：internal/app 无文件超 500 行；`go build ./go/...` 全绿。

### 2.3 知识卡覆盖补盲（🟢 低）

**决策**：不为凑数加卡；仅补两处索引：
- `wails_bindings` 卡内补 `internal/app` 21 个绑定文件目录索引（薄 wrapper 不必独立卡）
- import-executor / dnd-shared 若后续改动频繁，拆「拖拽与导入执行器」独立卡

---

## 3. 后果（Consequences）

### 正面

- 规模治理透明化：RED 大文件清单 + 下沉方向落盘，避免重复调研
- 拆分后 render 纯函数化可单测，质量防线前移
- 与项目「通用化、统一、复用」偏好一致：增量拆分、零推倒重来

### 负面

- 拆分是 3-4 轮机械大改写，建议独立 commit、拆前先提交当前状态
- internal 下沉涉及 Wails Binding 签名，需同步回归 `npm run generate:bindings`（-ts 红线）

### 已知遗留

- ADR-009 编号空缺（历史占号，登记表已报 ⚠️，不影响）
- 知识卡 `dbgWarn` 文档漂移（声明但源码不存在）属 P2 具体缺陷，另走修复不占本 ADR

---

## 4. 数据溯源

| 来源 | 数据 | 结果 |
|------|------|------|
| `wc -l` 前端 | app-content/index.ts 1,028 / content-css 920 / community 916 / import-queue 863 / skeleton 829 | §2.1 拆分清单 |
| `wc -l` Go | app_install 765 / cli 728 / sync 727 / threejs spec 637 | §2.2 下沉清单 |
| 子代理候选卡审核 | wails_bindings 21 绑定文件仅 1 张总览卡 | §2.3 补索引 |
| ADR-034 §2.1 | site-view 拆分蓝图（index/render/events/edit/drag） | 复用拆分方法论 |

<!-- 文件名: architecture-scale-governance.md → 实际文件 ADR-040-architecture-scale-governance.md -->
