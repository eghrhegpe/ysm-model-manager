# ADR-192：go/types 上帝包拆分：registry 域独立子包 + types 门面别名渐进迁移

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-05
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-179（internal/app 垂直切分同构先例）、docs/knowledge/go_design_critique.md（锐评刀⑥）、go/types/

---

## 1. 背景（Context）

2026-09-05 Go 端锐评刀⑥立项时实测（`docs/knowledge/go_design_critique.md` 记 1715 行，本次复核 1867）：

- `go/types` 非测试代码 **1867 行 / 8 文件**（含测试 4860 行），被 **77 个非测试 .go 文件** import，横跨 25 个包目录（internal/app 43、go/sync 17、go/scanner 11、go/threejs 9、go/cli 8……）。
- 包内实为**至少 6 个不相关域**：注册表加载（resource.go 614 行，有状态：SetRegistryPath/bundledJSON/sync）、注册表派生判定（extensions.go 442 行）、UI DTO + 错误体系（types.go 278）、应用配置结构（config.go 160）、bedrock/ysm metadata 结构（bedrock.go 104）、纹理/定位/实例探测小工具（~270）。
- **底线健康**：包是纯叶子（仅依赖标准库，零环风险）；moving 域与 DTO 域经 grep 实证零符号交叉（仅注释提及）。

风险：任何新行为（日志、fs 助手）都受限于此包"必须零依赖"的处境；新人找一个类型要在 6 个域里翻。

## 2. 决策（Decision）

**第一刀：注册表域（resource.go + extensions.go + location.go + findinst.go + texture.go 及其 15 个测试文件）拆到 `go/types/registry` 子包；`go/types` 保留纯 DTO（types.go / config.go / bedrock.go）并以门面别名承接旧路径消费。**

### 2.1 门面策略——与 ADR-179 的差异

ADR-179 选"委托先行 + 逐文件改 import"，因 internal/app 内部自洽可控制。本包不同：77 个消费文件横跨 25 个包且**并行会话活跃**，机械改 import 的 diff 冲突面不可控。故本 ADR 选**门面别名**：

- 类型：`type ResourceType = registry.ResourceType` 等全量 type alias（类型同一性保持，方法集零差异）；
- 函数：同签名 wrapper（如 `func LoadRegistry() *ResourceTypeRegistry { return registry.LoadRegistry() }`），标注 `// Deprecated: 直接 import go/types/registry`；
- 常量/变量：const alias 直接对等；`DisableSuffixes` 为 init 时切片头拷贝，registry 侧永不重赋值（实证仅 range 读），语义等价。

收益：Go 侧 77 文件**零改动**，冲突面归零；旧路径新代码禁入（Deprecated），存量渐进迁移，门面最终可删。

### 2.2 测试归属

17/18 个测试文件属 registry 域，随迁（`package types` → `package registry`，同包裸名引用天然成立；两处 `package types_test` 外部测试改 import）。`config_test.go` 与 `TestStatusToLevel` 留守。TestMain 的嵌入基线注入（等价根包 embed.go 生产态注入）随迁至 registry。

### 2.3 前端绑定面（本次实证的关键约束）

Wails 绑定以包路径为命名空间。前端从 `bindings/ysm-model-manager/go/types` 仅 import 5 个类型（ModelEntry / WorkshopCreator / WorkshopPresetSearch / WorkshopSite / YsmMetadata），**全部属留守 DTO 域** → registry 迁出后前端绑定 import 路径**零变化**；迁出类型在绑定树生成 `go/types/registry/models.ts`，前端无消费者。前端 `utils/types-re-export.ts` 垫层收口（31 文件深路径）降级为后续卫生项，不作为本刀前置。

### 2.4 铁律

1. **依赖单向**：`go/types/registry` 禁止 import `go/types`（DTO 不回流）；`go/types` 门面单向引用 registry。
2. **绑定签名不变**：留守 DTO 字段/类型名不动，`generate:bindings -ts` 后 `go/types/models.ts` 仅减少迁出类型，前端 import 面 diff 为零。
3. **有状态注入点不变**：SetBundledRegistryJSON / SetRegistryPath 门面同名承接（embed.go、testutil、repoaudit、cli_test 消费方零改动）。
4. **后续第二刀（另立项）**：DTO 是否进一步拆分、77 文件存量 import 迁移与门面退役，待第一刀稳定后评估。

## 3. 后果（Consequences）

**正面**：go/types 从 1867 行收敛为 ~540 行纯 DTO 包（名副其实的 types）；registry 域获得独立演进空间（可引入日志/IO 助手）；Go 77 文件与前端 21 文件改动面均归零，并行会话零冲突。

**负面**：门面是过渡性样板（~150 行 alias/wrapper），存在被永久滞留的风险——以 Deprecated 标注 + 知识卡记录退役条件对冲；`DisableSuffixes` 切片头拷贝是唯一语义近似点（已实证等价）。

**已知遗留**：前端深路径 import 收口（21 文件直接 import，另 11 处注释引用）、存量 import 渐进迁移（可在各包自然迭代时顺手做）。

## 4. 数据溯源

- 实测：`wc -l go/types/*.go`（1867 非测试 / 4860 含测试）；grep import 分布（77 文件 / 25 包）；moving↔staying 符号交叉 = 0；前端绑定 import 面（5 类型全属留守域）。
- 来源：docs/knowledge/go_design_critique.md 刀⑥记录（1715 行）、go/types/ 源码、frontend/bindings/ysm-model-manager/go/types/models.ts、frontend/src/utils/types-re-export.ts。
- 结果：本 ADR + go/types/registry 子包落地。
