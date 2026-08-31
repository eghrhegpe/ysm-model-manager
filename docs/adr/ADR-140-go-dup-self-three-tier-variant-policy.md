# ADR-140：Go 重复代码治理：文件内自重复三层判定与变体层不强制合并

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-08-31
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`scripts/jscpd-go.mjs`（Go 端 jscpd 门禁 + 独立 baseline）、`tmp/jscpd-self-exact.mjs`（字节级自重复核验）、`go/fileops/fileops.go`（`opPrologue`）、`go/tags/tags.go`（`prepareWrite`）、`docs/adr/ADR-139-platform-shim-dedup.md`（平台 shim 收敛）

---

## 1. 背景（Context）

`scripts/jscpd-go.mjs` 门禁当前基线 167 个唯一文件对（重复率 4.5%，313 个 `.go` 文件）。
用户提出两选一：「开 Batch C 直接抽领域脚手架」or「先起 ADR 把平台 shim 收敛范围钉死」。

前几轮已落地：平台 shim 合并（`rust_backend_*` 四文件 → `go/scanner/rust_backend.go`，根因修复 android/linux 构建标签撞车）、`importer.sanitizeImportPaths`、`fsutil.walkFilesStream`、`cli.cliPrologue` 抽取 → 基线 173 → 167。

本轮继续吃「文件内自重复」时，发现**原始 jscpd 报告的指标与「可安全抽取的重复」之间存在系统性落差**，必须先把判定标准钉死，否则 Batch C 会越抽越险。

## 2. 决策（Decision）

### 2.1 经验证的三层事实（非凭记忆）

用 `tmp/jscpd-self-exact.mjs`（对 jscpd 报告逐文件内自重复对做**字节级精确比对**，不是 jscpd 的 fuzzy「clone」标签）重新扫描：

- jscpd 报告 **327 处文件内自重复对**；其中 **仅 19 处字节级逐字相同（EXACT）**。
- 其余 **308 处为近相似（NEAR）**——首行即不同、或末尾一两行不同，属**语义变体**，强制合并会改行为。
- 19 处 EXACT 中再分辨 extractability：
  - **EXACT + 自包含语句序列** → 可零风险抽取（如 `go/fileops/fileops.go` 230-236 纯 `checkNotSelfNested+MkdirAll+Join`）。
  - **EXACT + 控制流残片**（开 `for`/`if` 头，循环体在外） → **不可直接抽 helper**，须函数级重构（如 `go/sync/sync_dirlevel.go` 121-126、`go/geometry/archive.go` 427-435，是 `patternFind`/`patternFindMemo`、`collectGeoAnim*` 的同源近重复头部）。
  - **EXACT + 锁/defer 绑定调用方生命周期** → 须用「解锁闭包」模式抽取（如 `go/tags/tags.go` 136-143 含 `s.mu.Lock(); defer s.mu.Unlock()`）。

### 2.2 安全抽取四准则（落地 Checklist）

仅当全部满足才动手，否则归入变体层 / L3：

1. **C1 字节精确**：两段经 `jscpd-self-exact.mjs` 逐字符相等（jscpd 的「clone」标签含近相似，不足为凭）。
2. **C2 自包含**：是完整语句序列，非 mid-for / mid-if 残片。
3. **C3 无调用方生命周期绑定**：含 `Lock/defer Unlock` 时，helper 内部加锁并返回 `func()` 解锁闭包，调用点 `unlock, err := h(...); if err != nil { return err }; defer unlock()`（4 行）。
4. **C4 阈值收敛**：抽取后调用点 ≤4 行（低于 jscpd 默认 `min-lines=5` 不计入），**或** 该文件所有自重复清空使 `file#file` 对消失。

> 关键度量澄清：门禁按**唯一文件对**计数；`file#file` 自重复对只有当该文件**全部**自重复清空才消失；≤4 行重复不计入。故「抽 helper」未必降对，需看是否满足 C4。

### 2.3 范围裁决

- **🔴 变体层（308 处 NEAR）不强制合并** —— 强制合并 = 改语义，属回归红线。
- **🟡 平台 shim** —— 已在 ADR-139 收敛（根因合并 + 标签守卫）。
- **🟡 领域脚手架** —— **仅** = 满足 C1–C4 的字节精确自包含块；盲抽 Batch C 对剩余债务**基本不适用**。
- **结论**：原问题「Batch C vs ADR」的答案是 **先钉 ADR（本 ADR）+ 仅做满足准则的安全抽取**；Batch C 式盲抽会引入风险且不降对。

### 2.4 本轮已落地（示范）

- `go/fileops/fileops.go`：抽 `opPrologue(a,b,emptyMsg)` 统一 `opMu.Lock + TrimSpace + 空值校验`，替换 3 处自重复（Rename*/Move*/Copy*）→ 调用点 4 行。
- `go/tags/tags.go`：抽 `prepareWrite` 返回解锁闭包，替换 2 处 `checkModelPath+load+Lock/defer`（C3 模式）→ 调用点 4 行。
- 基线 167 → **166**（0 新增对，无回归；`go test ./go/...` 全 31 包绿，仅 `importer.TestDetectZipTypeFromBase64Tail` 偶发 flakes——系 `types.LoadRegistry()` 全局态被同包其他测试污染，与本次改动无关，已 `git stash` 验证无改亦偶发）。

## 3. 后果（Consequences）

- **正面**：把「可安全抽取的重复」与「jscpd 报告数」解耦，治理从拍脑袋变可验证；避免 308 处变体被盲抽破坏。
- **负面 / 已知遗留**：门禁净降缓慢（173→166，约 4%）——因真实可抽块稀少，这是**健康信号**而非停滞。
- **L3 候选（刻意重构，非盲抽）**：`sync_dirlevel.go` 的 `patternFind`/`patternFindMemo` 头部近重复、`archive.go` 的 `collectGeoAnimEntries`/`collectAnimEntriesOnly` 头部近重复——须函数级统一，单独立项，不在本 ADR 的「安全抽取」范畴。

## 4. 数据溯源

- 来源：`node scripts/jscpd-go.mjs`（313 文件 / 166 对）→ `tmp/jscpd-self-exact.mjs`（327 自重复对：19 EXACT / 308 NEAR）→ 逐文件 `git stash` 回退验证 `importer` flakes 与改动无关。
- 结果：采纳「变体层不强制合并 + 四准则安全抽取」策略；基线冻结 166；本 ADR 与 `go-dup-governance` skill 同步沉淀方法论。

<!-- 文件名: go-dup-self-three-tier-variant-policy.md → 实际文件 ADR-140-go-dup-self-three-tier-variant-policy.md -->
