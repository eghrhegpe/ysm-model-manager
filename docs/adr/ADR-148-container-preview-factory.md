# ADR-148：preview-3d 容器类适配器统一工厂(方案 C)决策方向

- **状态**：✅ 已采纳（Accepted）— 但**触发条件已被 §5 复核证伪**，当前为「记录但不实施」态；是否降级为 ❌ 已取代待决策层裁决
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-01
- **复核**：2026-09-02（§5 复核勘误：maid 定性不成立、触发条件重定义、消费者穷举）
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

> ⚠️ **本节结论已于 2026-09-02 复核推翻，见 §5。** 保留原文以存史：maid 确实漏列于初版（这点成立），但「抽象同构」的定性错误——maid 的枚举在外部详情面板，壳层 `createMaid3D` 无 enumerate 段；411 行亦非壳层成本（232 行为面板渲染）。有效口径以 §5 为准。

**maid 是第三个 1:N 消费者（本 ADR 初版漏列）**（2026-09-01 复核补正）：车万女仆 Bedrock 模型包虽是 1 个 zip，内部含 N 个子模型，链路为「Go `AnalyzeBedrockModel` 聚合返回 `subModels`（含 `sourcePath`）→ 壳层渲染角色清单 → 选中 `selSubIdx` → 取 `sel.sourcePath` → Go `AnalyzeBedrockModelEntry(path, subPath)` 单模型解析」（`maid-3d.ts:334-361,283,298`）。这与 pack 的「`ListPackModels` 枚举 → 选 entry → `ReadPackEntry`」**抽象同构**，同属「enumerate → select → re-fetch」，仅是枚举源不同（pack/litematic 枚举 zip entry 路径，maid 枚举 Go 解析出的语义子模型）。其 411 行体量居壳层之首，且注释明写「createMaid3D 内部拿不到 subModels 清单」（`maid-3d.ts:46-47`）——正是枚举逻辑外置导致的信息断裂，与 pack/litematic 同病。

另发现边界瑕疵（P3，已随本 ADR 配套修复）：`mmd-adapter.ts:594,737` 两处 `await import("../../backend/app.ts")` 运行时穿透 ADR-072——litematic 是 `import type`（零运行时）、pack 是纯依赖注入（零 backend），唯独 mmd 打了洞。已改为 `MmdDataPort` 壳层注入（`mmd-data-port.ts` 实现 `getCachedTextureByHash?` / `hasCachedTextures?` 两可选方法），适配器 0 backend import 全格式达成。

## 2. 决策（Decision）

**采用「容器适配器工厂」方向（方案 C）**：在 `preview-3d/adapters/` 落 `makeContainerPreview({ id, listEntries, filter, makeBuildCall })`——把 pack/litematic 的「先枚举，再挑一个」抽成共享工厂，Go 调用仍由壳层以纯函数注入（守 ADR-072 0 backend import）。

理由：

1. **换抽象点而非加壳**：pack/litematic/maid 都塞不进「统一渲染工厂」，但**三者能塞进「容器工厂」**——共同点不是渲染，是「枚举 → 过滤 → 选首个」。方案 A（抽 resolver）只砍 ~40 行重复、混合格式派发仍留壳；方案 C 让三者壳层共享同一段寻址样板。
2. **契约零冲突**：不动 `PreviewAdapter.build(ctx, path)` 单路径契约，`switch-preview.ts` 的 `build.bind` 等 core 消费方零牵连（方案 B「升维 build 契约为 PreviewTarget」虽治本但动 core、全格式回归，成本高，暂不采纳）。
3. **后续 1:N 类型白嫖**：新增容器类资源类型时直接复用工厂，不再复制「枚举→挑一」样板。
4. **顺手收敛 mmd 动态 import 洞**（本 ADR 配套已修，见 §1 末尾）。

**落地时机**：初版定「等第三个 1:N 类型出现时再实施」，2026-09-01 复核一度确认 **maid 即第三个消费者、触发条件已满足**（见 §1）。

⚠️ **2026-09-02 二次复核推翻上述结论**：maid 与 pack/litematic 不同构（壳层无 enumerate 段），623 行系将 maid 的 232 行详情面板渲染误计为壳层成本；真实可抽象公共段约 43 行，且消费者已穷举（§5.4）不存在第四个「壳入口自枚举」容器类型。**触发条件重定义为：「第二个以上壳入口自枚举的 1:N 容器类型出现，且差异轴 ≤ 1」——该条件在当前类型体系下不满足。**

本 ADR 只记决策方向，不排期实施；方案 C 当前处于「记录但不实施」态，是否降级为已废弃待决策层裁决（见 §5.5）。

## 3. 后果（Consequences）

**正面**
- pack/litematic/maid 三个壳层共享「枚举→过滤→选首个」样板，收敛一处（maid 411 行居首，收益最大）；
- 后续 1:N 容器类型（含混合格式派发）直接复用，无需复制仪式代码；
- 全格式适配器 0 backend import（mmd 洞已修），ADR-072 口径统一。

**负面 / 风险**
- 多一层抽象；「为抽象而抽象」的顾虑**未解除**（§5 复核：maid 不构成第三个同构消费者，可抽象公共段约 43 行而非 623 行）。边界须收紧——工厂只抽「枚举→挑一」公共段，**不得**把各类型的格式派发也泛化（见下条）；
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
| `maid-3d.ts:334-361`（Go `AnalyzeBedrockModel` 聚合出 subModels）、`:283`（`subPath = sel?.sourcePath`）、`:298`（`subModelIdx`）、`:46-47`（「内部拿不到 subModels 清单」）、`:122`（dp-submodels 交互式角色清单） | ⚠️ **本行结论已被 §5 复核推翻**（2026-09-02）：maid 与 pack **不同构**（壳层无 enumerate 段，枚举在外部详情面板），且 411 行非壳层成本（232 行为面板渲染）。实测寻址段仅 `:280-288` 约 9 行。详见 §5.1 / §5.2 |

## 5. 复核勘误（2026-09-02）

> 本节为事后复核，用于纠正初版事实错误。**原 §1「maid = 第三个 1:N 消费者」的定性不成立**，触发条件的数字依据随之失效。原段落保留以存史，新增本节为当前有效口径。

### 5.1 勘误一：maid 不在壳层枚举，与 pack/litematic 不同构

初版称 maid「enumerate → select → re-fetch 与 pack 抽象同构」。核查源码后不成立：

- `createMaid3D`（`maid-3d.ts:54-85`）**不执行任何枚举**。它接收 `opts.subPath` / `opts.subModelIdx`，由调用方推导后传入（接口注释自陈「createMaid3D 内部拿不到 subModels 清单」）。
- 枚举发生在**外部**：`showMaidPreview`（`maid-3d.ts:313-411`）调 Go `AnalyzeBedrockModel` 出 `subModels` → 详情面板渲染角色清单（`:185-199`）→ 用户交互选中 → `dpToggle3D`（`:252-306`）取 `subs[selSubIdx].sourcePath`。
- 即：pack/litematic 是「**壳入口自枚举**」（enumerate → filter → select first → mount），maid 是「**外部选择型**」（panel state → derive subPath → mount）。**maid 在壳层没有 enumerate 段**，与初版所述相反。

### 5.2 勘误二：411 行不等于壳层成本

`maid-3d.ts` 411 行的实测构成：

| 行段 | 行数 | 性质 | 与寻址相关性 |
|------|------|------|-------------|
| 1-28 | 28 | imports / 顶部注释 | 无关 |
| 29-36 | 8 | `openMaidFullscreen` | 无关 |
| 37-48 | 12 | `MaidOpenOptions` 接口 | 承载寻址参数 |
| 49-87 | 39 | `createMaid3D`（3D 挂载入口） | 无关（只收结果） |
| 88-124 | 37 | `cleanupMaid3D` / `invalidateMaidPreview` | 无关 |
| 125-251 | 127 | `toStatsCardModel` + `dpRenderDetail/SubList/Panel` | **无关（详情面板 HTML 渲染）** |
| 252-306 | 55 | `dpToggle3D`（3D 开关 / guard / android-back） | **仅 280-288 约 9 行是寻址推导** |
| 307-411 | 105 | `showMaidPreview`（面板主流程） | **无关（面板流程）** |

**真实寻址段约 9 行**（`maid-3d.ts:280-288`：`sel` 取值 → `sourcePath` → `texSlot` 夹取），且被面板状态 `selSubIdx` 与业务细节（texSlot 钳位）包住。用文件总行数 411 充当「壳层成本」，等于把 232 行面板渲染（125-251 + 307-411）计入抽象收益。

pack 的真实寻址段为 `pack-3d.ts:42-50` 约 9 行；litematic 为 `litematic-3d.ts:80-88`（枚举函数）+ `:94-108`（容器分支）约 25 行。**三者可抽象公共段合计约 43 行，不是 623 行。**

### 5.3 勘误三：强行纳入 maid 会使工厂参数膨胀

三者在抽象面上的差异是正交的，无法靠一个签名优雅覆盖：

| 差异轴 | pack | litematic | maid |
|--------|------|-----------|------|
| 枚举产物类型 | `string[]`（路径） | `string[]`（路径） | `BedrockSubModel[]`（语义对象） |
| 选择策略 | 自动选首个 | 自动选首个 | 用户交互选（`selSubIdx`） |
| 空结果行为 | 直接 return | 降级裸路径（`:109-112`） | 由面板态决定 |
| 附加派生 | 无 | `entryExtOf` + 三 RPC 派发 | `texSlot` 钳位 |

工厂签名将膨胀为 `makeContainerPreview({ listEntries, filter, select, deriveEntry, onEmpty })`——五个回调服务于约 43 行公共代码。这正是本 ADR §3 自我警示的「为抽象而抽象」。

### 5.4 消费者穷举：不存在第四个「壳入口自枚举」容器类型

全量核查 `resource_types.json`（15 个类型）与 `registerReRoute` 注册点（9 个）：

| 3D 壳层入口 | 服务 type id | 基数 | 寻址形态 |
|-------------|-------------|------|---------|
| `pack-3d.ts` | `resourcepack` | 1:N | 壳入口自枚举 ✅ |
| `litematic-3d.ts` | `litematic` + `blueprint` | 1:N（混合格式） | 壳入口自枚举 ✅ |
| `maid-3d.ts` | `maid-model` | 1:N | **外部选择型** ❌ |
| `fbx-3d.ts` / `vrm-3d.ts` / `mmd-3d.ts` / `scene-3d.ts` | `fbx` / `vrm` / `mmd` / `mmd-scene` | 1:1 | 不适用 |
| `ysm-3d.ts` | `ysm` | 1:1 | 不适用 |

`EntityPlayer` / `SceneModel` 虽声明 `.zip` 扩展名，但复用 `mmd-3d.ts` / `scene-3d.ts` 的 1:1 链路（zip 仅作「单模型 + 纹理依赖」打包，非 N 模型容器），不构成容器消费者。

**结论：可预见范围内不存在第四个「壳入口自枚举」的 1:N 容器类型。**

### 5.5 落地时机重定义

初版触发条件「第三个 1:N 类型出现时」语义过宽，导致 maid 被误计。重定义为：

> **当出现第二个以上「壳入口自枚举」的 1:N 容器类型，且其与 pack/litematic 的差异轴不超过 1 个时，实施方案 C。**

按 §5.4 的穷举结果，该条件在当前类型体系下**不满足**。方案 C 实质进入「记录但不实施」态。

处置建议（供决策层裁决，本 ADR 不自行变更状态字段）：

- **维持 ✅ 已采纳**：理由——决策方向本身（「1:N 容器寻址应共享样板」）无错，仅实施前提被证伪；保留可在新增容器类型时直接复用论证。
- **降级为 ❌ 已取代 / 🧊 已废弃**：理由——收益封顶约 43 行、消费者已穷举、触发条件在可预见范围内不可满足，保留「已采纳」会误导排期。

**当前处置**：状态字段维持「已采纳」，以本节勘误为有效口径；若后续确认不再新增 1:N 容器类型，建议按后者降级。

## 6. 复核数据溯源

| 来源 | 结果 |
|------|------|
| `resource_types.json`（15 类型） | `preview:"3d"` 共 8 个 type id；`EntityPlayer`/`SceneModel` 的 `.zip` 复用 mmd 1:1 链路，非 N 模型容器 |
| `registerReRoute` 全量注册点（9 处） | 壳层入口 8 个文件；仅 pack / litematic 为壳入口自枚举 |
| `maid-3d.ts:54-85` | `createMaid3D` 无枚举逻辑，仅接收 `opts.subPath` / `subModelIdx` |
| `maid-3d.ts:280-288` | 真实寻址段（`sel` → `sourcePath` → `texSlot` 钳位），约 9 行 |
| `maid-3d.ts:125-251,307-411` | 232 行详情面板渲染 / 主流程，与寻址无关 |
| `pack-3d.ts:42-50` | pack 寻址段约 9 行 |
| `litematic-3d.ts:80-88,94-108` | litematic 寻址段约 25 行（含 `entryExtOf` 派生与空容器降级分支） |
| `grep -rn "ADR-148" docs/knowledge/ frontend/src` | 零命中——本 ADR 无下游引用，勘误不产生连带影响 |

<!-- 文件名: container-preview-factory.md → 实际文件 ADR-148-container-preview-factory.md -->
