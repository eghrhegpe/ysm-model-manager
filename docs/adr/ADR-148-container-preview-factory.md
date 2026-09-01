# ADR-148：preview-3d 容器类适配器统一工厂(方案 C)决策方向

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-01
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/adapters/mount-preview-core.ts:134(PreviewAdapter.build 单路径契约);frontend/src/views/app-preview/pack-3d.ts;frontend/src/views/app-preview/litematic-3d.ts;frontend/src/preview-3d/adapters/mmd-adapter.ts:594,737(ADR-072 动态 import 洞,已修)`

---

## 1. 背景（Context）

五个 3D 预览类型（fbx/vrm/mmd/pack/litematic）渲染层早已统一——`PreviewAdapter` 契约 + `mount3D` 驱动 renderer/scene/controls，第 ③ 层五种格式零差异。但**壳层（视图层 createXxx3D）行数差异悬殊**：fbx 28 行 vs litematic 146 行。根因不在渲染层，而在**寻址层**：

- `PreviewAdapter.build(ctx, path: string)`（`mount-preview-core.ts:134`）只收**单个路径字符串**。
- 「1 文件 = 1 模型」类型（fbx/vrm/mmd）直接塞进这一格；「1 容器 = N 模型」类型（pack/litematic）必须在壳外先做一轮「**枚举 → 过滤 → 选首个**」，把容器内 entry 当 path 喂进去。
- 差异轴是**基数（1:1 vs 1:N）× 解析归属（JS loader vs Go RPC）**两个正交维度，不是渲染没统一。

证据：

| 类型 | 谁解析 | 基数 | 壳层行数 | loader? |
|------|--------|------|---------|---------|
| fbx | FBXLoader + 自研 fbx-parser | 1:1 | ~28 | ✅ |
| vrm | GLTFLoader + @pixiv/three-vrm | 1:1 | ~30 | ✅ |
| mmd | @moeru/three-mmd | 1:1 | ~35 | ✅ |
| pack | 自研 MC 模型解析，字节靠 Go `ReadPackEntry` 注入 | 1:N | ~66 | ❌ |
| litematic | Go 解析 NBT/schematic → `VoxelData`，前端拼 BufferGeometry | 1:N（混合格式） | ~146 | ❌ |
| maid | Go `AnalyzeBedrockModel` 出 subModels 清单 → `AnalyzeBedrockModelEntry(path, subPath)` 单模型解析 | 1:N（子模型） | ~411 | ❌ |

litematic 走 Go 是合理选择：NBT 是 gzip 二进制、体素量十万到百万级，Go 侧解析回传紧凑数据远划算于前端重写 NBT reader。代价是 ADR-072「adapter 0 backend import」逼着取数调用留在壳层。

**maid 是第三个 1:N 消费者（本 ADR 初版漏列）**（2026-09-01 复核补正）：车万女仆 Bedrock 模型包虽是 1 个 zip，内部含 N 个子模型，链路为「Go `AnalyzeBedrockModel` 聚合返回 `subModels`（含 `sourcePath`）→ 壳层渲染角色清单 → 选中 `selSubIdx` → 取 `sel.sourcePath` → Go `AnalyzeBedrockModelEntry(path, subPath)` 单模型解析」（`maid-3d.ts:334-361,283,298`）。这与 pack 的「`ListPackModels` 枚举 → 选 entry → `ReadPackEntry`」**抽象同构**，同属「enumerate → select → re-fetch」，仅是枚举源不同（pack/litematic 枚举 zip entry 路径，maid 枚举 Go 解析出的语义子模型）。其 411 行体量居壳层之首，且注释明写「createMaid3D 内部拿不到 subModels 清单」（`maid-3d.ts:46-47`）——正是枚举逻辑外置导致的信息断裂，与 pack/litematic 同病。

另发现边界瑕疵（P3，已随本 ADR 配套修复）：`mmd-adapter.ts:594,737` 两处 `await import("../../backend/app.ts")` 运行时穿透 ADR-072——litematic 是 `import type`（零运行时）、pack 是纯依赖注入（零 backend），唯独 mmd 打了洞。已改为 `MmdDataPort` 壳层注入（`mmd-data-port.ts` 实现 `getCachedTextureByHash?` / `hasCachedTextures?` 两可选方法），适配器 0 backend import 全格式达成。

## 2. 决策（Decision）

**采用「容器适配器工厂」方向（方案 C）**：在 `preview-3d/adapters/` 落 `makeContainerPreview({ id, listEntries, filter, makeBuildCall })`——把 pack/litematic 的「先枚举，再挑一个」抽成共享工厂，Go 调用仍由壳层以纯函数注入（守 ADR-072 0 backend import）。

理由：

1. **换抽象点而非加壳**：pack/litematic/maid 都塞不进「统一渲染工厂」，但**三者能塞进「容器工厂」**——共同点不是渲染，是「枚举 → 过滤 → 选首个」。方案 A（抽 resolver）只砍 ~40 行重复、混合格式派发仍留壳；方案 C 让三者壳层共享同一段寻址样板。
2. **契约零冲突**：不动 `PreviewAdapter.build(ctx, path)` 单路径契约，`switch-preview.ts` 的 `build.bind` 等 core 消费方零牵连（方案 B「升维 build 契约为 PreviewTarget」虽治本但动 core、全格式回归，成本高，暂不采纳）。
3. **后续 1:N 类型白嫖**：新增容器类资源类型时直接复用工厂，不再复制「枚举→挑一」样板。
4. **顺手收敛 mmd 动态 import 洞**（本 ADR 配套已修，见 §1 末尾）。

**落地时机**：初版定「等第三个 1:N 类型出现时再实施」，2026-09-01 复核确认 **maid 即第三个消费者，触发条件已满足**（见 §1）——三个消费者壳层合计约 623 行（66 + 146 + 411），抽象层收益不再是边际的。剩余唯一约束是这三个文件均为预览域热文件，架构级改动宜在无并行会话冲突时进行。本 ADR 只记决策方向，不排期实施。

## 3. 后果（Consequences）

**正面**
- pack/litematic/maid 三个壳层共享「枚举→过滤→选首个」样板，收敛一处（maid 411 行居首，收益最大）；
- 后续 1:N 容器类型（含混合格式派发）直接复用，无需复制仪式代码；
- 全格式适配器 0 backend import（mmd 洞已修），ADR-072 口径统一。

**负面 / 风险**
- 多一层抽象；「为抽象而抽象」的顾虑随 maid 入场（第三个消费者，411 行居首）而解除，但边界须收紧——工厂只抽「枚举→挑一」公共段，**不得**把各类型的格式派发也泛化（见下条）；
- 混合格式容器（litematic 的 `.nbt`/`.schematic` 混排、逐条目派生 ext）的派发逻辑是真逻辑，工厂只抽「枚举→挑一」公共段，**不得**把格式派发也强行泛化（那是 litematic 特有）。

**已知遗留**
- 方案 B（升维 `build(ctx, target)` 为 `PreviewTarget={path, container?, entry?}`）记录在案但不采纳：动 core 契约、牵连 switch-preview 的 build.bind、全格式回归，待容器工厂证明价值后再评估。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `mount-preview-core.ts:134` | `PreviewAdapter.build(ctx, path: string)` 单路径契约确认 |
| `pack-3d.ts:42-56` | `ListPackModels` 枚举 → `/block/`/`/item/` 过滤 → 选 initialEntry → entry 当 path；`makePackAdapter(deps, path, {modelEntries})` 闭包外挂 zipPath = 单路径契约被打补丁的痕迹 |
| `litematic-3d.ts:40-50,60-65,80-88` | 三 RPC 派发（GetNbt/GetSchematic/GetLitematic）+ 逐条目派生 ext + 容器枚举——混合格式派发是真逻辑，非样板 |
| `mmd-adapter.ts:594,737` | 两处 `await import("../../backend/app.ts")` 动态 import，ADR-072 口径不统一（P3）——已修 |
| `vrm-3d.ts:59-61` / `mmd-3d.ts:33-35` / `scene-3d.ts:38-40` / `pack-3d.ts:60-62` / `litematic-3d.ts:139-141` | 五个 `cleanupXxx3D()` 全是 `cleanupPreview()` 一行转发；`cleanupPreview()`（mount-preview-core.ts:196-215）本身全量格式无关——10 个别名函数是同一个函数的别名，新类型不再复制仪式代码（fbx-3d.ts:3-4 即复用派发） |
| `maid-3d.ts:334-361`（Go `AnalyzeBedrockModel` 聚合出 subModels）、`:283`（`subPath = sel?.sourcePath`）、`:298`（`subModelIdx`）、`:46-47`（「内部拿不到 subModels 清单」）、`:122`（dp-submodels 交互式角色清单） | maid = 第三个 1:N 消费者：enumerate → select → re-fetch 与 pack 抽象同构，仅枚举源不同（语义子模型 vs zip entry）；411 行居壳层之首 |

<!-- 文件名: container-preview-factory.md → 实际文件 ADR-148-container-preview-factory.md -->
