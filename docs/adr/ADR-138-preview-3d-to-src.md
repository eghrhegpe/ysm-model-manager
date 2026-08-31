# ADR-138：preview-3d 上提 src/preview-3d（去 features 中间层）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-08-31
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-129-preview-3d-domain-root.md, frontend/AGENTS.md, docs/review/knowledge-ref-analysis.md`

---

## 1. 背景（Context）

### 1.1 引用深度分析暴露前端最深路径集中于 preview-3d

`docs/review/knowledge-ref-analysis.md`（analyze-knowledge-refs.mjs 产出）量化了全库引用深度：

- 深度 ≥5 的引用路径共 **72 个**，其中 **40 个**集中在 `features/preview-3d`（其余 views 16、utils 13、core 3）。
- 单文件被最多卡引用：`features/preview-3d/adapters/mount-preview-core.ts`（6 卡）、`caps/ground-capability.ts`（5 卡）——**审核牵动面最大的点全部落在 preview-3d**。
- 该模块被 20+ 张知识卡 `source_files` 引用，是「改一处牵动多卡」的高耦合中心。

### 1.2 ADR-129 已确立 preview-3d 为领域根，但物理路径仍深一层

ADR-129（utils/3d → features/preview-3d 升格）只把领域根从 `utils/3d` 上提到 `features/preview-3d`，保留了 `features/` 中间层。`frontend/AGENTS.md` 规约「新业务模块放 features/」针对的是**新模块**；对已成体系的领域根（198+ 文件 4.6 万行、8 个子目录、被 20+ 卡引用的第一大类），`features/` 这层没有承载额外语义——`features/` 下其余模块（community、dnd、recycle-bin 等）与 preview-3d 体量差一个数量级，把两者平铺在 `features/` 会继续放大「看不懂分类体系」的困惑。

### 1.3 体量倒挂与可访问性

`features/preview-3d` 236 文件 / 8 子目录，是 `features/` 下唯一 4.6 万行级领域模块；其内部文件路径如 `frontend/src/features/preview-3d/adapters/mount-preview-core.ts` 深达 5 层，与 `frontend/src/views/`、`frontend/src/core/`、`frontend/src/backend/` 等顶层平行目录的可访问性不一致。

## 2. 决策（Decision）

**把 `features/preview-3d` 整体上提为 `src/preview-3d`（去掉 `features/` 中间层），纯物理移动 + 相对引用重写，不改变任何业务逻辑。** 这是 ADR-129 归属正名路线的延续：领域根升格已定名，本 ADR 只再消一层中间目录。

- 目标结构：`frontend/src/features/preview-3d/` → `frontend/src/preview-3d/`（8 个子目录原样随迁：adapters / caps / decoder / menu / perception / state / vendor/{babylon-mmd,fbx}）。
- **不引入新机制**：沿用相对 import，无 alias；worker 的 `new URL("./xx", import.meta.url)` 相对当前文件，整目录移动后相对关系不变。
- **不改变业务逻辑**：渲染 / 状态 / 适配器实现一行不改，由既有 vitest + 契约测试守行为。

### 2.1 执行五步（分步决策，非实施进度）

| 步 | 内容 | 风险 |
|----|------|------|
| **① 移动目录** | `git mv features/preview-3d src/preview-3d` | 低：纯移动 |
| **② 批量重写相对引用** | 外部 97 条（45 文件）+ 内部跳出 123 条（`../../../` → `../../` 深度减一） | 中：需脚本精确匹配 import 语句 |
| **③ 同步配置锚点** | vitest.config.ts 7 处、scripts/tests 37 处（check-adr-drift / check-menu-health / perf/vitest-env-switch / port-align / verify-adr-042 等）、deadcode-baseline.json 62 条 | 中：漏一处门禁红 |
| **④ 更新知识卡** | 38 张卡 `source_files` 批量 `features/preview-3d` → `preview-3d` | 低：机械替换 |
| **⑤ 全量验证** | `npx vite build` + `npm run typecheck` + `node scripts/doctor.mjs` 清零 | 验收门 |

### 2.2 关键约束

- 每步独立可回退：移动/重写失败 `git checkout` 单目录即回。
- 不留双轨：上提一刀切完，不保留 `features/preview-3d` 并存期。
- 一次 path-scoped 提交：手写文件（脚本/ADR/知识卡）路径限定，`docs/` 生成物由 pre-commit GEN 自动同步。
- 提交前跑 `check-knowledge-drift.mjs --affected` 验证卡面同步。

## 3. 后果（Consequences）

### 正面

- 路径深度 5 → 4，`src/preview-3d` 与 `src/core` / `src/views` / `src/backend` 顶层平行，可访问性一致。
- 引用重灾区 40 个 ≥5 层路径全部减一层，后续审核范围划定更直观。
- 消除 `features/` 下「4.6 万行领域根 vs 百行小模块」平铺的体量倒挂。

### 负面

- 一次性改动面约 **220 处 import 重写 + 106 处配置/脚本/基线锚点 + 38 张知识卡**——需严格按 2.1 五步执行并用 doctor 兜底。
- 全仓 `features/preview-3d` 字面串（含注释/文档）在移动后语义失效，需一并清理或更新（comments 内路径不改逻辑，但会误导后来者）。

### 已知遗留

- `views/app-preview` 领域逻辑归属（ADR-129 §2.4 第四刀候选）不在本 ADR 范围，上提不解决该撕裂。
- 死代码基线 62 条路径随上提更新，**deadcode 口径以新路径为准**，历史提交里的旧路径不追溯。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `scripts/analyze-knowledge-refs.mjs --json` | 深度 ≥5 引用 72 个；preview-3d 占 40 个 |
| `tmp/audit-preview3d-refs.mjs`（引用审计） | 外部 import 97 条 / 45 文件；内部跳出 123 条（utils 70/ui 17/core 16/...） |
| vitest.config.ts / scripts / tests grep | 锚点 7 + 37 处；deadcode-baseline 62 条 |
| 知识卡 grep | 38 张 `source_files` 含 `features/preview-3d` |
