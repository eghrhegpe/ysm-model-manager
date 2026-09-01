# ADR-152：gen-stage 并发卷带根除——快照变化 ∩ 非并行 dirty 判定（实证验收）

- **状态**：✅ 已采纳
- **实施状态**：已落地（2026-09-01）
- **日期**：2026-09-01
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`scripts/_lib/gen-stage.ts`, `.githooks/pre-commit`, `scripts/_lib/commit-temp-index.ts`
- **继承**：ADR-151（临时索引白名单提交机制），本 ADR 补全其并发卷带防护的最后一环

---

## 1. 背景（Context）

ADR-151 用「临时索引白名单提交」堵住了主 index 暂存窗口（add→commit 期间并行裸 commit 卷走他人已暂存文件），实证 `b4d23b78` 后修复。

但仍有盲点：**pre-commit 钩子的 snap_docs 快照 diff 判定本身在并发下失效**。

`snap_docs()` 用「mtime/size 变化」判定 gen 产物——单会话成立，并发失效：并行会话手改的卡恰在快照窗口内被 touch，被误判为 gen 产物 stage 进 index，进而被 `--only` 路径限定提交卷带。

**实证**：`e96b47e3` 提交期间，并行会话的 `fbx-cli-pipeline.md` / `frontend_test_audit.md` 恰好在 snap_docs 窗口内被 touch → 误判 gen 产物 → stage 进 index → 被 `--only` 提交卷带（两文件均不在 paths 白名单内）。

## 2. 决策（Decision）

### 2.1 gen-stage 判定下沉

将 stage 清单判定从 pre-commit 内联逻辑下沉到独立模块 `scripts/_lib/gen-stage.ts`（单一事实源，契约测试守护）：

```
stage = 快照变化文件 − 并行 dirty 文件
```

具体规则：
- **dirty = `git status --porcelain` 中 docs/locales/completions 下有改动的文件**
  - M/MM/A/D/R 等全部排除——并行会话的暂存或未暂存工作一律不碰
- **`??` 未跟踪文件**：
  - gen 前已存在（snap_before 含它）→ 并行新建，排除
  - gen 前不存在（snap_before 不含）→ gen 本次新建产物，保留
- **补全型 gen（h1/symbols/adr/tests）改写的卡**：gen 前是干净的 → 正常入库

### 2.2 双入口设计

- **TS 侧**：`import { parsePorcelain, computeStageList }`（契约测试直接测判定逻辑）
- **CLI（sh 侧消费）**：`node scripts/_lib/gen-stage.ts <snap_before> [snap_after]`
  - 自身重新遍历快照（不再依赖 find/awk 脆弱管道）
  - 输出 stage 清单逐行

### 2.3 pre-commit 调用点更新

`.githooks/pre-commit` 第 87 行：
```sh
node scripts/_lib/gen-stage.ts "$GEN_SNAP" > /tmp/ysm_gen_to_stage.txt 2>/dev/null
```
替代原 `find/diff/awk` 管道，stage 清单由 gen-stage.ts 统一判定。

## 3. 后果（Consequences）

### 正面

- **并发卷带从机制上根除**：snap_docs 误判并行手改文件的问题消失——stage = 快照变化 ∩ 非并行 dirty，并行 dirty 文件被过滤
- **双隔离架构完整**：
  1. 临时索引（commit-temp-index.ts）：隔离主 index，防止 add→commit 窗口卷带
  2. gen-stage 判定（gen-stage.ts）：隔离并行 dirty，防止 snap_docs 误判
- **实证验收**：`b659efae` 提交门禁 19/19 PASS、`outOfScope=[]`、`interleaved=false`、并行会话的 2 个文件未被卷带——端到端验证通过

### 负面

- `gen-stage.ts` 是新增模块，需持续维护（契约测试守护）
- CLI 模式重遍历快照（node 遍历 vs find -printf），Windows 下性能略降（可接受）

### 已知遗留

- gen-stage.ts 的 `snapBeforePaths` 参数由 pre-commit 传入（`readSnap(GEN_SNAP).keys()`）；若快照文件损坏，`before` 默认为空集 → `??` 文件全部保留（偏保守，安全）
- 契约测试覆盖 8 用例（见 `tests/test_gen_stage.ts`），边缘场景（重命名、quotepath）已在 `parsePorcelain` 处理

## 4. 数据溯源

- **问题**：`e96b47e3` 卷带并行会话的 `fbx-cli-pipeline.md` / `frontend_test_audit.md`
- **诊断**：snap_docs 快照窗口内并行会话 touch 文件 → mtime 变化 → 误判 gen 产物
- **修复**：`gen-stage.ts` 判定收紧（快照变化 ∩ 非并行 dirty）+ pre-commit 调用点更新
- **验收**：`b659efae` 门禁 19/19 PASS、outOfScope=`[]`、interleaved=false、并行会话文件未触碰
