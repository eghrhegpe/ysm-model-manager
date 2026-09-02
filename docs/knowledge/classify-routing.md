---
kind: classify-routing
name: 分类路由与回归护栏
tier: architecture
adr:
  - ADR-093
category: go
source_files:
  - go/packs/classify.go
  - go/types/resource.go
  - resource_types.json
tests:
  - go/packs/classify_test.go
  - go/packs/model_file_test.go
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - 整合包分类、路由、location 路由
  - zipentry 指纹、蓝图 / 投影 / vrm / pmx
  - last-wins / priority 裁决
quick_risk_lines:
  - 资源整合包分类必须走 go/packs/classify.go 的 ClassifyResource，前端禁止手写分类逻辑
pitfalls:
  - 前端手写分类 → 与 Go classify 判定不一致、last-wins 裁决丢失；必须交 Go 分类
  - 新增资源类型未更新 priority → 冲突时优先级错乱；必须经 classify.go 的 priority 表

use_when:
  - 整合包分类
  - 路由
  - zipentry 指纹
  - 蓝图
  - 回归
  - last-wins
invariant_anchors:
  - go/packs/classify.go|ClassifyResource
  - go/packs/classify.go|DetectByEntries
  - go/types/resource.go|validateRegistrySchema
status: active
---

# 分类路由与回归护栏

## 概览

整合包分类的「路由不变量 + 回归护栏」设计备忘录。核心结论：**location 路由只在「同文件夹 = 同类型」时成立；一旦出现「同文件夹多类型」，必须降级到内容指纹（zipentry/ysm/mcmeta/shader），且各容器型需显式 `priority` 消除注册序兜底**。

本卡记录三件事：(1) 真实仓库中类型共置的实证（决定路由为何必须这么设计）；(2) 既往回归根因与收敛（commit `bc95fbb4` + 护栏 `634fb63f`）；(3) 护栏设计（golden / isolation / order + schema 守卫 4/5）。

## 真实共置实证（来源：测试仓 `D:\YSM管理器测试文件夹`）

| 共置对 | 注册表事实 | 分类含义 |
|--------|-----------|---------|
| **蓝图 / 投影**（blueprint / litematic） | 二者 `instanceDir` 同为 `schematics`、`detector=zipentry`、共享 `.zip`；`storageSubDir` 分别为 `schematics` / `litematics` | 部署到实例后**共置同一 `schematics/` 目录**；location 对两者都指向 `schematics`，无法区分，必须靠 `zipentry` 指纹（`.nbt` suffix vs `.litematic` suffix）裁决。测试仓现状：`minecraft-mod/schematics/` 含 `*.nbt`（蓝图），`minecraft-mod/litematics/` 暂空 |
| **vrm / pmx（角色方向）** | `EntityPlayer`（id）已声明 `extensions=[.pmx,.pmd,.vrm,.zip]`、`storageSubDir=PMX`、`variants` 含 `.vrm→preview vrm`；`vrm` **不是独立类型** | `mmd/PMX/橘雪莉.vrm` 是同类型内**多扩展共置**：location（suffix `PMX`）+ 扩展名认同即可正确判为 `EntityPlayer`（variant `.vrm`→preview `vrm`）。⚠️ **切勿为 vrm 建独立资源类型**——那会制造重复类型、才是真回归 |

要点：蓝图/投影是「**跨类型**同文件夹」（schematics/ 下混 .nbt 与 .litematic），必须靠指纹；vrm/pmx 是「**同类型**多扩展」（EntityPlayer 内部），location 路由即可。二者共同划定了分类器的责任边界。

## 既往回归根因（已收敛）

| # | 根因 | 现场 | 现状 |
|---|------|------|------|
| 1 | 三套编排各自为政 | `repoaudit.Audit` / `packs.DetectResourceType` / `importer.DetectZipType` 三套独立链路，一处修到不了另一处 | `packs`→`ClassifyResource`、`importer`→`packs.DetectByEntries`（commit `bc95fbb4` 收敛至 types，ADR-144 下沉至 packs）；`repoaudit.Classify` 仍自有实现（**有意保留**：审计口径遇未知容器标 `container`，与导入口径 content-fingerprint 语义不同） |
| 2 | 共享扩展名 last-wins | `extToTypeID[e]=rt.ID` 覆盖写，`.zip` 被 15 类型声明 → 落注册表末位 | `repoaudit.initExtMap` 改收单声明者，多/零声明者 → `"other"`；`ClassifyResource` 兜底仅 `container`/`other`，禁裸扩展名 last-wins |
| 3 | 无结果不变量守卫 | 仅 fmt 诊断、schema 检查，无「包 X 必须判为 Y」「加类型 Z 不得改 X」断言 | 见下方护栏设计（commit `634fb63f`） |

> 旧债卡 `extensibility-index-reconciliation.md` Top #2「双入口检测器未合并单一入口」因此降为**部分闭环**：packs+importer 已统一于 `types` 分类器核心，repoaudit 未折叠（语义差异有意保留）。

## `packs.ClassifyResource` 三阶段（路由核心）

> 归属（ADR-144）：识别大脑（ClassifyResource / DetectByEntries / IsTypeModelFile / ClassContainer / ClassOther）随依赖 container 的识别逻辑从 `go/types` 下沉到 `go/packs`；`types` 回归纯类型/注册表/纯函数层。消费方（importer / instance / sync / internal-app）改调 `packs.` 前缀。`ExtBelongsToBy`（纯注册表查询）留 `types`，供 `packs.ClassifyExt` 与 types/resource.go 守卫共用，避免 types→packs 反向依赖。

1. **Phase 1 — location 路由**：按路径目录 suffix 匹配 `storageSubDir`/`instanceDir`，且要求扩展名认同 + `detector` 通过才返回（比旧 `TypeByLocation` 更严）。
2. **Phase 2 — 容器指纹 + Priority 裁决**：`zipentry`/`ysm`/`mcmeta`/`shader` detector 命中后，用 **`(priority desc, id asc)`** 双键裁决，消除注册表顺序依赖。
3. **Phase 3 — 兜底**：未命中指纹/ location 的容器 → `container`（诚实有信息量）；非容器未知 → `other`。**禁止裸扩展名 last-wins**。

ADR-069：importer 魔数路径（不真开容器、靠魔数嗅探）语义由 `types` 保留，合并时未抹除。

## 回归护栏设计（已落地，commit `634fb63f`）

| 护栏 | 载体 | 作用 |
|------|------|------|
| golden | `go/packs/testdata/classify-golden.json`（18 例）+ `TestClassifyGolden` | 每类型 + 雷区断言。`schematics/gear.zip`@仓库根 → `blueprint`（钉死 audit=`container`/导入=`blueprint` 分叉现行犯）；`random.zip`→`container`（反 last-wins） |
| isolation | `TestClassifyIsolation` | 移除任一类型后，其余语料分类不变（归 victim 的用例跳过）—— 从结构上证明新增类型不会连坐改掉旧类型 |
| order | `TestClassifyOrderIndependent` | shuffle 注册表顺序后语料稳定 —— 逼出「同 Priority 取注册序在前者」隐患，要求 `priority` 作唯一 tiebreak |
| schema 守卫 4 | `validateRegistrySchema` | 禁「仅共享扩展名且无指纹/无 location 锚点」的类型（灭 last-wins 回归源） |
| schema 守卫 5 | `validateRegistrySchema` | 共享 `.zip` 锚点碰撞的容器型（blueprint/litematic 同 `instanceDir=schematics`）必须显式 `priority`；已补 `blueprint`/`litematic` `priority=5` |

## 不变量

- location 路由仅在「同文件夹 = 同类型」成立；跨类型同文件夹必须降级内容指纹。
- `.zip` 等共享扩展名**绝不允许仅靠扩展名判型**，必须命中指纹或 location，否则归 `container`/`other`。
- 同 Priority 用 `(priority desc, id asc)` 双键裁决，分类与注册表顺序无关（`TestClassifyOrderIndependent` 即证）。
- `vrm` 属 `EntityPlayer` 的 variant，**非独立类型**；新增角色格式只需在 `EntityPlayer` 扩展集/`variants` 声明，不得另立类型。
- `MmdRoot` 被 9 个 MMD 子类型共享 `configField` 是常态，schema 守卫不硬化该 WARN。

## 相关

- [go_types](./go-types.md) — `types` 共享类型层（注册表加载、zipentry 契约 ADR-067）
- [resource_registry](./resource-registry.md) — `resource_types.json` 单一事实源
- [extensibility_index_reconciliation](./extensibility-index-reconciliation.md) — Top #2 双入口检测器（部分闭环）
- 测试：`go/packs/classify_test.go`、`go/packs/model_file_test.go`、`go/packs/testdata/classify-golden.json`、`go/types/registry_schema_guard_test.go`
