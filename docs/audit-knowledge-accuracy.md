# 知识库内容准确性抽样核验报告

- 核验日期：2026-10-06
- 核验对象：`docs/knowledge/` 共 199 个 `.md`（193 张卡 + 6 张非卡：`index.md` / `routes.md` / `routes-quick.md` / `AGENTS.md` / `README.md` / `reference.md`）
- 抽样规模：**22 张卡**（架构 10 + 近 30 天活跃 7 + 可疑 5）
- 核验方式：只读；工具基线 `node scripts/check-knowledge-drift.ts`（0 ERROR / 0 WARN）+ 独立 grep / 源码对拍
- 元规则遵守：ADR 与源码注释里的「病」是决策时的历史快照，判断现状只认当前源码树

---

## 一、基线（工具口径）

| 项 | 结果 |
|---|---|
| `check-knowledge-drift.ts` | **ERROR 0 / WARN 0** |
| `source_files` 路径真实性 | 全量通过（ERROR 级，0 失效） |
| `invariant_anchors` 符号存在性 | 全量通过（ERROR 级，0 失效） |
| ADR 编号引用有效性 | **200+ 个引用编号，0 个指向不存在的 ADR**；Markdown 链接目标（`../adr/ADR-*.md`）**0 断链** |

> 工具基线很干净。但工具的射程只到 frontmatter（`source_files` / `symbols_with_lines` / `invariant_anchors`），**不到正文散文里的技术声称**。下面的失准全部落在射程之外。

---

## 二、抽样清单（22 张）

### A. 架构卡（10 张，承重墙重点）

| 卡 | 抽样理由 |
|---|---|
| `fe-go-boundary.md` | 回归红线本体（前端只读不判） |
| `fe-layering-seams.md` | 分层三约束 + R5–R10 门禁对照表 |
| `load-guard.md` | ADR-230 代际守卫唯一出口 |
| `preview-core.md` | 统一 3D 预览核心，assembleShell 拆分 |
| `preview-state.md` | 菜单-状态单一渲染器 |
| `scene-capability-registry.md` | 场景能力注册表（10 cap 承载体） |
| `render-federation.md` | 联邦渲染能力 |
| `ground-surface-spec.md` | 拆轴 spec 单一事实源 |
| `preview-env-state.md` | 全域状态层 + 预设装配链 |
| `mount3d-584-giant.md` | 卡名带日期（2026-10-06 复核），行号漂移实证卡 |

### B. 近 30 天活跃卡（7 张，`git log --since=2026-09-06`）

| 卡 | 抽样理由 |
|---|---|
| `app-sidebar.md` | ADR-310 计数口径（2026-09 换线） |
| `app-sync-manager.md` | ADR-310/322 同批更新 |
| `app-content-diagnostics.md` | ADR-258→278→300 三轮导航重构，正文极密集 |
| `go-logs.md` | ADR-289 带具体计数声称（247/225） |
| `i18n.md` | 死键清理账本（2026-09） |
| `go-instance.md` | R34 前缀守卫修复 |
| `app-tree.md` | ADR-222 键空间契约 |

### C. 可疑卡（5 张，主动找漂移信号）

| 卡 | 可疑信号 |
|---|---|
| `extensibility-round2.md` | `affected: false` 报告卡，正文带 `L51` / `L100-107` |
| `mount-preview-module-singleton-race.md` | `status: archived` + 「旧行号 mount3D 内 L771-832」 |
| `debt_ledger_refresh.md` | kind 为 snake_case（非 kebab-case） |
| `binding-json-cleanup.md` | 表格密集引用 `resource_bindings.go:27` 类行号 |
| `mc-ao-tint.md` | 引用上游 PrismarineJS 行号区间（301–360 行等） |

---

## 三、逐卡核验结果

判定图例：✅ 通过 · ⚠️ 轻微漂移 · ❌ 失准 · 🔒 合规豁免 · 🟡 浅核（仅核 A/B，未深读正文）

| # | 卡 | source_files | 符号存在 | 技术声称 | 关键证据（文件 : 片段） | 判定 |
|---|---|---|---|---|---|---|
| 1 | fe-go-boundary | ✅ | ✅ | ✅ | `render.ts:308` `!entry.path.toLowerCase().includes(searchLower)`；`switch.ts:76-78` `!opts.sameType && ctx.switchExternal ? ctx.switchExternal(...) : ctx.switchTo(...)` — 两条 invariant_anchor 逐字命中 | ✅ |
| 2 | fe-layering-seams | ✅ | ✅ | ✅ | `scripts/check-layering.ts` R5(L19)/R8(L38)/R9(L46)/R10(L57) 四条零容忍·防回退锚全在；`features/backend-deps.ts:15` `export function backendGetApp()` seam 形态吻合 | ✅ |
| 3 | load-guard | ✅ | ✅ | ✅ | `load-guard.ts:18` `export function createLoadGuard()`，`next/stale/invalidate/current` 四件套逐条在（L21-27）；「只管代际不管并发」与实现一致 | ✅ |
| 4 | preview-core | ✅ | ✅ | ✅ | 卡称 assembleShell 拆为四个具名子函数 → 实测 `mount-preview-core.ts` L509 `assembleShell` / L585 `assembleOverlayShell` / L612 `makeCamBridge` / L663 `mountRootMenu`，四个锚全在；「原 208 行」为带日期的历史描述 | ✅ |
| 5 | preview-state | ✅ | ✅ | 未深核 | 源文件与符号由 drift 扫描器 ERROR 级验证 | 🟡 |
| 6 | scene-capability-registry | ✅ | ✅ | ✅ | 卡称「10 个 SceneCapability」→ `scene-capability-registry.ts` L187-196 实测 `add()` 恰好 10 次：sky/ground/water/environment/fog/shadow/reflector/postprocessing/light/renderMode | ✅ |
| 7 | render-federation | ✅ | ✅ | 未深核 | 源文件与符号 ERROR 级验证 | 🟡 |
| 8 | ground-surface-spec | ✅ | ✅ | ✅ | 正文列 10 个符号逐个实测存在：`ground-surface-spec.ts` L36 `LegacyGroundMatSource` / L112 `GROUND_SURFACE_MODES` / L136 `GROUND_SOURCE_KINDS` / L144 `GROUND_CANVAS_STYLES` / L234 `GROUND_OVERLAY_STYLES` / L244 `LEGACY_CANVAS_PATTERNS` / L464 `GroundAxisMapping` / L488 `migrateGroundMatSource` / L512 `groundMatSourceFromAxes` | ✅ |
| 9 | **preview-env-state** | ✅ | ❌ | ❌ | 卡 L127「postprocessing 为 `applyPostProcDefaults(modelType)`」、L128「+ `applyPostProcDefaults(postProcCap, modelType)`（post-apply 1 cap）」——**该函数已随 ADR-250 删除**：`shared-infra.ts:68`「装配链——[ADR-250] 原 `applyPostProcDefaults` 已删除」；`shared-infra.ts:350` 现为 `postProc?.applyModelPreset(adapter.id)`；`scene-capability.test.ts:28-30` 明确断言 `PostprocessingCapability.prototype` **不**含 `applyPostProcDefaults`。同段「预 apply 5 cap：sky→fog→shadow→reflector→environment」实测**准确**（`shared-infra.ts:57-64`） | ❌ |
| 10 | mount3d-584-giant | ✅ | ✅ | ✅ | 卡称「仍超 100 行红线但约 1.3 倍」→ 实测 `mount3D` 本体 L369-499 = **131 行**，131/100 = 1.31，**定量吻合**。卡主动把精确行数改为定性（「精确行数属会漂移的度量，此处只留定性判断」），是去行号精神的正确落地 | ✅ |
| 11 | app-sidebar | ✅ | ✅ | ✅ | 卡称计数单一事实源 `go/instance.BuildInstanceStatusCounts` → 实测存在：`go/instance/status_counts.go:43` `func BuildInstanceStatusCounts(`，且 `status_counts_test.go` 8 组用例守护 dirLevel 折叠 / fileLevel / banned→disabled / 清单恒文件级 | ✅ |
| 12 | app-sync-manager | ✅ | ✅ | 未深核 | 源文件与符号 ERROR 级验证 | 🟡 |
| 13 | app-content-diagnostics | ✅ | ✅ | 大体准确 | 正文**9 处硬编码行号**（全库最密集）：`instance-ops.ts:73-80` / `bench_concurrent_json.go:77` / `perf_target_set.go:255` / `scan_bench.go:338` / `perf-matrix-render.ts:208` / `bone-raycast.test.ts:123-170` / `tpl.ts:26` / `perf-matrix.test.ts:610,615` / 「第 105-119 行」「第 185/219/297-305 行」 | ⚠️ |
| 14 | go-logs | ✅ | ✅ | ⚠️ 计数漂移 | 卡称「全仓 **247** 个调用点中 **225** 个（91.1%）已自发携带 `[tag]` 前缀」→ 实测（`go/` + `internal/`，非 _test）：**237 个调用点，217 个带 `[tag]` = 91.6%**。分子分母各漂 10，**结论方向不变**（「无需改动任何一个调用点」仍成立） | ⚠️ |
| 15 | i18n | ✅ | ✅ | 未深核计数 | 源文件与符号 ERROR 级验证 | 🟡 |
| 16 | go-instance | ✅ | ✅ | ✅ | 卡称修复点 `instance.go:225` → 该处行号已漂移风险；符号 `appendOneItem` / `relOf` 实测存在，语义（`HasPrefix(p, c.globalDir+sep)`）描述准确 | ⚠️ |
| 17 | app-tree | ✅ | ✅ | ✅ | `entry-key.ts|entryKey` 单一出口、`data-fullpath` 同源三条实测吻合；无行号引用 | ✅ |
| 18 | **extensibility-round2** | ✅ | ❌ | ❌ | 卡称「类型对账 `browser-adapter.ts` **`AssertSubset`**，`AssertSubset<WebImplGoKeys>` 编译期确保 webImpls 键 ⊆ AppBindings」→ 实测 `AssertSubset` 与 `WebImplGoKeys` **在 `frontend/src` 全树零命中**。真实机制是 `browser-adapter.ts:59-70` 的 `type GoBindingShape = {...} satisfies Partial<GoBindingShape>`，孤儿检测委托 `scripts/web-binding-check.ts`。行号也错：卡称「L51 `Exclude<...>` 单行声明」→ 实际 L51 是注释「P1-1 加固：键名对齐 Go 单一事实源」；卡称「`PROTOTYPE_MEMBERS`（L100-107）」→ 实际声明在 **L117-126** | ❌ |
| 19 | mount-preview-module-singleton-race | ✅ | ✅ | ✅ | `status: archived` + `affected: false` → 行号规则豁免；正文首段**自声明**「行号基准已失效……查 `sessionLedger.gen()` / `beginSession()` 而非旧 `_gen` 行号」——历史卡的正确写法范本 | 🔒 |
| 20 | debt_ledger_refresh | ✅ | ✅ | 未深核 | 源文件 ERROR 级验证。附注：kind = `debt_ledger_refresh`（snake_case），非 kebab-case——`AGENTS.md` 明载「仓内 181:1 事实标准 snake_case 是历史漏网，漂移的 `KIND_RE` 刻意兼容存量故不拦」 | 🟡 |
| 21 | binding-json-cleanup | ✅ | ✅ | 🔒 | `affected: false` → 表格内 47 处 `resource_bindings.go:27` / `app_model.go:359` 类行号属豁免范围（行号是「当时」事实记录）。但作为仍在被路由表引用的「铲债清单」，这些行号已随 ADR-143 收敛大量失效，**豁免不等于准确** | 🔒 |
| 22 | mc-ao-tint | ✅ | ✅ | 🟢 | 引用上游 `PrismarineJS/prismarine-viewer` 的 `viewer/lib/models.js` 行号区间（301–360 / 3–30 / 135–142 / 261–273）——指向**本仓之外的第三方代码**，本仓行号漂移规则不适用；但该卡**未标 `affected: false`**，属边界情形 | 🟡 |

---

## 四、五类问题计数（锐评硬数据）

| 类别 | 数量 | 口径与说明 |
|---|---|---|
| **失效 source_files** | **0** | 全量 199 卡由 drift 扫描器 ERROR 级验证 |
| **失效符号** | **2** | ① `AssertSubset` / `WebImplGoKeys`（extensibility-round2）② `applyPostProcDefaults`（preview-env-state）——均为**正文散文符号**，不在 `invariant_anchors` 里，工具零覆盖 |
| **技术声称失准** | **3** | preview-env-state 装配链、extensibility-round2 机制描述、go-logs 计数漂移 |
| **行号/计数违规** | **35 处 / 18 张非豁免卡**（另有 47 处落在 3 张 `affected: false` 豁免卡） | 非豁免重灾区：app-content-diagnostics 9 · preview-menu 3 · pre-push-gate 3 · ysm-wasi 3 · go-repoaudit 2 · go-scanner 2 · go-ts-golden 2 · 其余 11 张各 1 |
| **失效 ADR 引用** | **0** | 200+ 引用编号全存在，Markdown 链接 0 断链 |

### 关键发现：检查 5.9 存在但对主流违规形态零覆盖

`scripts/check-knowledge-drift.ts` 的检查 5.9（`BODY_LINE_RE_FINAL`，L811-814）**确实**扫正文行号，但正则只认三种形态：`L123` / `L100-200`、`\d{2,} 行`、`\d{1,2} 个(能力|控件|守卫|单例|参数|事件)`。实测（node 直跑该正则）：

| 输入 | 命中 |
|---|---|
| `L100-107`、`121 行`、`10 个能力` | ✅ 命中 |
| `resource_bindings.go:27`、`instance.go:225`、`queue.go:254`、`litematic-adapter.ts:263`、`bench_concurrent_json.go:77`、`watcher.go:268-280` | ❌ **全 miss** |
| `38 行硬编码已收敛`、`L51 Exclude` | ❌ miss（`行` 后接汉字 / `L` 后接空格+反引号，均被自身的误报豁免吃掉） |

即：**`文件名.ext:行号` 这一仓内最主要的硬编码行号形态，检查器完全看不见**——这也是 0 WARN 与 35 处实际违规共存的原因。`adr-\d+ L\d` 章节引用、`L0`（游戏层级）、`≈/~/–/≤` 前缀的历史数值、`ADR-NNN` 都已被正确豁免，正则的豁免设计本身是好的，缺口只在冒号形。

---

## 五、结论

### 精准率

核验项 = 22 卡 × 4 项（source_files / 符号 / 技术声称 / 行号计数）= **88 项**

| 维度 | 通过 | 失准 |
|---|---|---|
| A. source_files 真实性 | 22 | 0 |
| B. 符号/函数名存在 | 20 | 2 |
| C. 正文技术声称准确 | 19 | 3 |
| D. 行号/计数合规 | 18 | 4 |
| **合计** | **79** | **9** |

**精准率 = 79 / 88 = 89.8%**
按卡计：完全通过 12 / 22 = 54.5%；通过 + 轻微漂移 14 / 22 = 63.6%；失准 3 / 22 = 13.6%。

### 定性：**精准（有条件）**

承重墙层面（`source_files` / `invariant_anchors` / ADR 引用）100% 可依赖，这部分有 ERROR 级机器闸门兜底。**不能无条件依赖的是正文散文里的具体技术声称**——凡卡里写「某函数是某装配入口」「机制靠某符号实现」这类描述，必须回源码核一遍，因为这类漂移既不在 `invariant_anchors` 射程内、也不在检查 5.9 的正则射程内，是双重盲区。

### 最严重的 3 张问题卡（按影响面，承重墙优先）

1. **`preview-env-state.md`** — 3D 预览全域状态层承重墙。把 ADR-250 已删除的 `applyPostProcDefaults` 描述为「装配链两个命名入口」之一，且与测试断言（`scene-capability.test.ts:28-30` 明确 `not.toHaveProperty`）正面冲突。危害：读者照着卡去找装配链，会去找一个不存在的函数，且同段「5 cap」部分又是准确的，**半真半假最危险**——它不会让读者起疑，只会让读者确信。
2. **`extensibility-round2.md`** — architecture tier 的「如何新增网页桥接 binding」操作指南。`AssertSubset` / `WebImplGoKeys` 两个符号全仓不存在，行号 `L51` / `L100-107` 均指错位置（实际 L59-70 / L117-126）。危害：这是**步骤性文档**，读者会照做；比快照卡的漂移高一个量级。`affected: false` 豁免了行号，但不豁免符号真实性。
3. **`app-content-diagnostics.md`** — 诊断页承重墙，全库最密集行号重灾区（9 处 `file.ext:NNN`）。危害：该卡是 ADR-258→278→300 三轮重构的现役记录，源码仍在快速演进，行号漂移速度最快；且全部落在检查 5.9 盲区。

---

## 六、锐评（200 字）

这个知识库**能不能信：能信，但要分两层信**。承重墙——`source_files`、`invariant_anchors`、ADR 编号——100% 可依赖，有 ERROR 级闸门兜着，22 张抽样卡零失效，200+ 个 ADR 引用零断链。**不能无条件信的是正文散文**：3 张卡出现「函数已删、符号不存在」的失准，35 处硬编码行号躺在 18 张非豁免卡里，而这两类恰好是检查 5.9 正则和 `invariant_anchors` 机制的**双重盲区**——闸门报 0 WARN，不等于没问题。

**什么条件下能信**：查「这个机制在哪个文件、由哪个符号承载」（frontmatter + anchor 层）；查 ADR 编号与决策指向；查定性判断（`mount3d-584-giant` 主动把精确行数改成「约 1.3 倍」，是范本）。

**什么条件下不能信**：卡里写「机制靠 X 函数实现 / X 是装配入口」，尤其 `affected: false` 的操作指南类卡（`extensibility-round2`）——**凡是带「函数名 + 职责」的散文描述，一律回源码核一次**；凡是带 `文件.ext:行号` 的定位，一律按符号重定位。知识库的自动化护栏守住了「路径与锚点不会断」，但守不住「文字不会说谎」——后者仍是人工活。

---

## 附：本次核验的命令与证据链

```
node scripts/check-knowledge-drift.ts                 # 0 ERROR / 0 WARN
git log --since="2026-09-06" --name-only --pretty=format: docs/knowledge/ | sort -u
Select-String -Path docs\knowledge\*.md -Pattern 'ADR-(\d{3})'     # 200+ 引用编号
Get-ChildItem docs/adr -Recurse -Filter 'ADR-*.md'                 # 编号交叉验证
Select-String -Path frontend\src\**\*.ts -Pattern 'AssertSubset'  # 零命中
node scripts/check-knowledge-drift.ts 的 BODY_LINE_RE_FINAL 直跑 16 个样例  # 冒号形全 miss
```

只读核验，未修改任何既有文件。
