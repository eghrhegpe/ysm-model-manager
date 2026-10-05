# 环境系统审查台账（活文档）

> **本文件是台账，不是历史日志。** 只记「当前仍有效的结论」与「什么已被推翻」，
> 逐轮验证明细与一次性数据不入此。
>
> **分工**：逐轮审计过程见 git 历史；**概念骨架**（成员边界 / 开关语义 / 真值源）见本文件 §5；
> **状态层现状**见知识卡 `preview-env-state.md`。
> 现状判断一律以**当前源码树 + 知识卡**为准——本文件是索引，不是事实源。
>
> 收敛于 2026-10-05：原 1624 行 / 24 章跨轮追加日志 → 本表。**§13 缺陷总报告已删**
> （其台账被后续章全面覆盖且 8 处以上状态过期、4 类活动级缺陷整类缺失——保留只会误导）。
> 同日并入原 `audit-env-design-critique.md`（设计层审，0 外部消费者）→ 本文件 §5。

---

## §1 仍挂账的活项

> 这些是**仍未修**的项。修掉一项删一行；新增挂账须同时在此登记。

### UX（低优先级）

| 编号 | 位置 | 问题 | 建议 |
|---|---|---|---|
| S1-2 | `sky-menu.ts` | sky 总开关关掉后，子视图控件仍可盲调（无置灰/提示） | 加「能力已关」提示或置灰 |
| S1-3 | `cap-controls.ts` timeline 渐变 | 色带硬编码 5 色，与实际天空（turbidity/云量）脱节 | 按当前参数微调，或至少标 6/12/18 刻度线 |
| S3-1 | `ground-menu.ts` | 地面/网格双 toggle 平铺，暗示二者独立 | 网格 toggle 视觉降级 |
| S3-2 | `ground-menu.ts` | texture 选完要滚 5 个控件才见选图按钮 | 按钮紧跟 mat-source |
| S3-3 | `ground-menu.ts` | canvas-style 下拉实为预设，且 custom 不可逆 | 标签改「材质预设」+ 切走前确认 |
| S3-4 / S5-1 / S5-3 | 各 cap menu | 空/稀疏 folder | folder 按可见子项自动显隐 |
| **S5-2** | `env-state-schema.ts` `waterWetness` | **wetness=0 水面消失无提示**（无 min 下界） | min 域抬升 或 hint「0=无水面」。**ADR-305 明言「账挂本文件」** |
| S7-1 | `env.ts` vs `environment-menu.ts` | 一级 select（氛围包）vs 子视图 thumb（纯贴图）预设语义分裂：**两条 set 路径分叉** | 文案分界或统一走 `applyPreset` |
| S7-2 | `environment-menu.ts` | histogram 无语境说明 | 加 hint |
| S7-3 | `environment-capability.ts` `getCustomHdrThumbnail` | 每次渲染重算缩略图（CPU 降采样 + toDataURL，**无缓存字段**） | cap 实例缓存 dataURL，贴图变更失效 |
| S9-1 | `env-state-schema.ts` `fogNear`/`fogFar` | 两轴**独立无交叉约束**，near>far 可达 | clamp 或 hint |
| S11-1/S11-2 | `reflector-menu.ts` | `resolution`/`size` 是**结构键**，滑杆逐帧 set = 逐帧全量重建 RT（**无 `onCommit`**） | 改 onCommit 提交 |

### 接线 / 性能

| 编号 | 位置 | 问题 |
|---|---|---|
| S2-3 | `sky-capability.ts` `assertRevisionRange` | shader 锚点/版本号硬编码——守卫已到位，属**可控**硬编码 |
| S2-5 | `env.ts` 预设 select 的 `get` | 每次求值调 `sceneCapabilityRegistry.getById("environment")`（逐字复核仍在 `select.get` 内） |
| S2-6 | `slide-menu.ts` `refresh` | N cap 订阅 → N 次 `renderTop` **无 rAF 合批**（与 §2/§13 同源，均判不修） |
| S2-7 | sky 持久化接缝 | 设计判断，维持 |
| E-1 | `environment-capability.ts` `applyEnvIntensity` | 滑杆逐帧 → `mat.needsUpdate = true`；`syncMeshIntensity` 已存在但**回调仍传 `[this.scene]`**，「复用 roots」未落地 |
| E-2 | `buildEnvironment` | 同 spec 重写也全量 PMREM 重建（仅 sky 通路有同引用短路） |
| E-5 | — | 观察项，维持 |
| **G-2 / G-7** | `ground-capability.ts` 回调 | 回调仍对**任意 ground 键四连**（含 `refreshSurface` 无条件构造完整 spec）。**§18 处置「保留单出口、不改架构」既未落地也未否决——唯一活挂账** |
| G-3 | `env-state-schema.ts` | `groundSize` default 80 与 `waterSize` default 80 的对齐**靠命名巧合，无机制断言** |
| R-1 | `reflector-capability.ts` `setClipBias` | schema 键 + 持久化齐全，但 `reflector-menu.ts` **无 UI 出口** |
| L-2 / L-4 / L-5 | §20 登记 | 水面三项：一名三拍改名成本 > 收益 / L-4（= S5-2、S5-3）维持 / L-5 观察项 |
| — | `ground-capability.ts` 私有 `enabled` | 「僵尸门」：无 UI 写口、生产恒 `true`。**无行为收益，可随手清**；`56300e506` 查证背书，定性维持 |

## §2 已被推翻的判定清单

> **本表是防重蹈的核心资产。** 后人若照抄下列旧判词即会重犯。
> ⚠️ = 推翻**未被文档自标**，由 2026-10-05 收敛核查补记。

| # | 被推翻的判定 | 推翻者 | 依据（可核对） |
|---|---|---|---|
| 1 | **G-1**「注释宣称已补菜单出口，但菜单实际未露出」 | §15 自我更正 | `ground-menu.ts` 四控件齐全且已拼入 `buildGroundNodes`；有回归锁。**成因：工具输出中段被裁剪 → 采样偏差致假病** |
| 2 | S3-5（同 G-1 的「未露出」） | 同上 | 同上 |
| 3 | **W-1**「water film 空组头是实锤 UX 坑」 | §17 核验撤销 | `render.ts` 全隐组不建空组头 + 回归锁。「**未读渲染层全文就下的待核清单**」 |
| 4 | ⚠️ **§17 的「W-5 维持 4 锚点、原建议撤回」** | 后续提交（未文档化） | `water-shader.ts` 现为 **6 锚点**（已加 `dispOk`/`reflOk`）。**§17 的核验结论本身已被超越** |
| 5 | ⚠️ **S1-5**「godRays 正午无反应，面板无任何提示」 | 源码证伪 | `sky-menu.ts` 有 `hintKey: "preview.skyGodRaysHint"`，三语言包均已填 |
| 6 | **S2-2 前提**「envSky 在 skyEnvironment=false 时没挂 scene，是死 mesh」 | ADR-292 | `sky-capability.ts` `envScene.add(this.envSky)` **恒挂载**——envSky 是常驻烘焙载体 |
| 7 | ⚠️ **E-3 的修复形态**「回退写 `envPreset=studio` 改 source」 | ADR-292 D5 | 该回退**已整体移除**（「键值一个都不动」）。§14 描述的修复已被架构收口取代 |
| 8 | **R-2**「`enabled` × `reflectorEnabled` 双键并存漂移」 | §22 收口 | `reflector-capability.ts` 单门 `if (!envState.reflectorEnabled) return;` |
| 9 | **§19.1**「A 类无活动漏洞，reflector/shadow 的 manual 恢复被兜住，为格式债」 | §21.4 修订 | 错在「把『暂无症状』当『已合规』」 |
| 10 | **§19.1 表**「reflector / shadow = ❌ 未修（潜伏 latent）」 | 自身 2026-10 复核 | 两 cap **早已全程 auto-model**——**文档「病」≠ 当前状态的典型陷阱** |
| 11 | **§19.3**「reflector 是唯一带历史病灶的，被 AND 语义 + 不变量测试兜住」 | §22 推翻 | ① 首启无存档即背离（私有门 `?? true` vs schema 默认 `false` **方向相反**）② 冲突有证据可判。§19.3 只看了「私有门是否存在」 |
| 12 | ⚠️ **§19.3**「environment = 原教旨形态，非漏网（ADR-196 刀5 红线有意保留）」 | `88926c810` 第四度收口 | schema 新增 `envEnabled` + 回调分支。**错因：援引的红线已被 ADR-250 推翻——一份已作废的判据被持续豁免，使 env 连躲三度收口** |
| 13 | **§19.5**「没有任何证据表明存在第 2 个与 G-6 同级的活动缺陷」 | §21.4 证伪 | shadow 幽灵键即第 2 个。证伪法 =「逐 schema 键计生产消费者数」 |
| 14 | **§21**「reflector 待拍板（默认关 vs 默认开）」+「两键恒同步故无症状」 | §22 推翻 | 「恒同步」只覆盖**有存档**路径，漏了**无存档首启**；默认值冲突**实为伪问题** |
| 15 | `reflection-chain-invariants.test.ts` 把 AND 关系固化为不变式 | §22 修正 | **不变式测试会成为病灶的掩体**（给它发了备案） |
| 16 | ⚠️ 知识卡 `preview-menu.md` 把 `ground-visible` 归为「能力主开关」 | `88926c810` 契约校准 | 现明确「语义按 cap 而异」：**ground 报可见性**，非能力级 |
| 17 | **§13 系统级结论 4**「scene.environment 三权打架，建议抽全局资源协调器」 | ADR-292 | `envSource` 单选（preset/sky/custom）**结构性保证**互斥，非运行期判定 |
| 18 | **§13 整表的多条状态标注** | §18~§23 + `88926c810` | **8 处以上状态过期、4 类活动级缺陷整类缺失**（shadow/reflector/sky 幽灵键 + env 私有门）⇒ **§13 已删** |
| 19 | 知识卡旧版「fog F-2 / env E-2 / ground / light L-1 四路**同口径**」 | §21 F-2 | 「文档先于代码」漂移——ground 当时实为 manual。已改述为「按**声明**而非按**实施**成立」 |
| 20 | ⚠️ **§18** clearCustomTexture 的修法描述（「先 setEnvState 再 refreshSurface 双刷」） | 后续收口 | 现实现为「先摘私有态，仅 texture 态才写 envState」；目标值 `"canvas"` → `"solid"` |

### 元教训（贯穿全部 20 条）

1. **文档里的「病」是决策时快照，≠ 当前状态**（#6、#10 皆此类）。
2. **判「私有门是否病灶」须三问**：① 有无 UI 写口 ② 私有默认值与 schema 默认值是否一致
   ③ 零消费者扫描是否命中——**缺一即误判**（§19.3 只问①、§21 问①③、§22 才问全）。
3. **判据被推翻时必须回扫所有援引过它的文档**——否则旧判据会在别处继续免责（#12 根因）。
4. **「未读全文就挂的待核清单」会异化为「实锤」**（#1、#3 皆因输出裁剪/未读全文件）。

## §3 观察项的最终结论

| 项 | 结论 |
|---|---|
| W-1 空组头 | **撤销**：渲染层已实现「全隐组不建空组头」 |
| W-2 RT dispose 竞态 | **风险接受区**：仅在「材质已脱离渲染流」的销毁时序内调用；残留风险（同帧重复 dispose）属 three 侧 API 契约 |
| W-3 `getPresetKeys("water")` 契约 | **已落地**：`WATER_PARAM_APPLIER_KEYS` 字面量 + 运行时锁 + 类型派生双保险 |
| W-5 shader 锚点 | **已扩到 6 锚点**（见 §2 #4） |
| reflector SSR 互斥 | **通道完整**：`applyReflectorSync` 经 `getTypedCap` + `isSsrRenderActive` 单源判定，有 `reflection-chain-invariants.test.ts` 专锁 |
| S2-3/E-5/R-1 | shader 锚点/版本号/白名单硬编码：守卫已到位，属可控 |

## §4 已修缺陷索引（编号锚点，供外部引用）

> ADR-292 与 ADR-305 按编号引用本文件的缺陷记录，故编号必须保留。
> 逐条修复过程见 git 历史与对应 ADR；此处只留**编号 → 一句话 → 状态**。

| 编号 | 缺陷 | 状态 |
|---|---|---|
| **S1-4** | sky 子视图 `sky-env` toggle 语义漂移（实为「天空 IBL」却标「环境贴图映射」），与 EnvironmentCapability 抢写 `scene.environment` | ✅ 已修（ADR-292 三批次，架构级收口：env 独占槽位 + 来源单选，sky 降为烘焙数据源） |
| **E-3** | custom 预设回退写 `envPreset=studio` 用 `source:"manual"`，打穿 lastWriteSource 守卫 | ✅ 已修（且该回退路径已随 ADR-292 D5 整体移除） |
| **E-4** | `scene.environment` 三权打架：env cap `dispose` 无条件还原 `prevEnvironment`，sky cap 有 ownership 守卫 | ✅ 已修（判定下沉 `environment-ownership.ts|envOwnsSceneEnvironment` 纯函数单源） |
| **S2-4** | `skyScale` 死键：schema 有键、回调无分支、无 UI 控件 | ✅ 已修（摘键提常量 `SKY_SCALE`，有回归锁） |
| **F-2**(fog) | `loadState` 逐字段 `setEnvState(manual)` 且无挂起，恢复打 manual 级别 | ✅ 已修（`suspendEnvCallbacks` + `try/finally resume` + 6 键全 `auto-model`） |
| **G-4** | ground `saveState` 手抄字段清单（water 侧已 schema 驱动） | ✅ 已修（`getPresetKeys("ground")` 派生 + round-trip 契约锁） |
| **G-5** | ground 贴图失败 toast 内嵌 emoji + 未键化 | ✅ 已修（`t("preview.groundMatLoadFailed", { name })`） |
| **G-6** | ground 中间件缺 `sourceKindChanged` 分支 | ✅ 已修 |
| **G-8** | ground 存档 round-trip 缺契约锁 | ✅ 已修 |
| **G-9** | `clearCustomTexture` 双刷 | ✅ 已修（现为「先摘私有态，仅 texture 态才写 envState」，目标值 `"solid"`） |
| ~~G-1~~ / ~~S3-5~~ | ~~注释宣称补齐菜单出口但实际未露出~~ | ❌ **误判，已撤销**（见 §2 #1） |
| W-5 | ~~shader 6 处 replace 仅检 4 锚点~~ | ✅ 已扩到 6 锚点（见 §2 #4） |

## §5 设计层审：概念骨架（2026-10-05）

> 与 §1~§4（逐面板**检查项**）分工不同：本节只审「环境」的**概念骨架**是否自洽——
> 成员边界 / 开关语义 / 真值源。原独立报告 `audit-env-design-critique.md` 已并入此处（该文件归档）。

**总判**：状态层骨架是全仓最干净的部分；`scene.environment` ownership 协议经独立复核判
「**对称、完整，无缺口**」。**病灶在「能力总开关」一个概念的三处裂缝**（同源）：

| # | 裂缝 | 定级 | 状态 |
|---|---|---|---|
| F-1 | `EnvironmentCapability` 私有 `enabled` 未收口——6 兄弟过河五个，它留对岸 | 🔴 | ✅ 已收口（第四例，提交 `88926c810`） |
| F-2 | `getMasterNodeId()` 契约被绑错：ground 报的是**可见性**不是能力级 | 🔴 | ✅ 措辞已校准 |
| F-4 | `getEnvPlacement()` 缺席 = 永久排除：`shadow` 与 fog/water/reflector **schema 同族**却被划在环境面板外；`light` 同理 | 🟡 | ⏳ **待拍板**（产品决策：改用户可见信息架构） |
| F-3 | `opts.enabled` 绕过统一写入入口（registry ctx 无该字段 ⇒ 生产恒 `undefined`，只在测试生效） | 🟡 | ⏳ 随 ADR（sky 先例亦保留该参数，故本轮照抄） |
| F-5 | `env.test.ts` 用早已不适用的 sky 当「不报 master id」反例（实为手搓 fake cap，**有效契约测试**，仅命名误导） | 🟢 | 可随手清 |

**更值得立 ADR 的不是某一条**：「环境」至今**没有一份受守护的概念模型**——成员边界、
开关语义、真值源全靠 `env.ts` 收集逻辑 + 各 cap 自觉声明**隐式**约定，故同一根因会以
三种形态各自复发。**实测**：`env.test.ts` 的 `ENV_CAP_CLASSES` 是硬编码 6 元素数组，
给 shadow 加 `getEnvPlacement()` 即会显示（无需改守护测试，但须同步该数组）——**边界靠硬编码列表维持**。

### F-1 证据（静态探针实测，非读注释推断）

| 检查项 | `environment` | `ground` | `sky`（已收口样板） |
|---|---|---|---|
| 私有 `enabled` 字段 | **YES** | YES | **no** ✅ |
| `saveState` 落 `enabled` | **YES** | no | no |
| schema 有对应键 | **no** | （`groundVisible`） | `skyEnabled` |
| 有 UI 写口 | **YES** | no | YES（走 schema 键） |

**四条后果**：① 开关状态不入单一事实源（不参与守卫/派发，预设与模型默认看不见它）；
② `saveState` 落无前缀 `enabled` 幽灵键（`persistState` 直接 `JSON.stringify` → 真进 localStorage）；
③ `isEnabled()` 兼作**跨 cap 协议**（light 让位系数、sky 槽位去留都读它），既非单一事实源又承担协议角色；
④ **无守卫**——`environment-capability.test.ts` 有 30+ 条 save/load 测试，零条断言该幽灵键，
而 sky 有专门的 `expect("enabled" in cap).toBe(false)` 防僵尸门守卫。

⚠️ **跨代承重（改此处必读）**：`migrateEnvSource` 判据①读 `envEnabled === false` 作
「用户关掉整个环境贴图功能」的**唯一证据**（迁 `envSource="sky"` 的强信号）。
回填断了 → 升级用户的 `false` 永久失传 → 画面从天空 IBL 静默掉回 env 预设。
守卫 = 两条迁移回归（仍迁 sky ／ `true` 不得被放大误迁）。

### 为何连躲三度收口（判据盲区，值得记）

知识卡旧版把 env 判为「原教旨形态，非漏网」，依据 `ADR-196` 刀5 的「能力级 enabled 不入 schema 红线」
——而**同一张卡的下一条已宣告该红线被 `ADR-250` 判定为误判并推翻**。即 env **被一份自己已作废的判据持续豁免**。
（`ADR-250 §2.1`：「门禁…被误判为『能力级挂载』。但实际上『是否显示后处理效果』是**用户对可见效果的偏好**」——
「是否使用环境贴图」与之同构。）
**判据盲区**：前三轮扫「**找双键**」，而 env 是「**单键缺失**」（schema 无该键，无可计数）
⇒ 须补扫「**私有门 + UI 写口 + 落盘，但 schema 无对应键**」这一形态。

### 两次「假绿灯」自查（方法论）

补写守卫测试时**两次变异验证均不转红**：①「关态误释放 sky 纹理」——设想风险在新分支**不可达**
（`disposeEnvironment` 只 dispose `backgroundSrcTex`，`skySourcedTex` 仅作排除集成员）⇒ 断言恒真，**删除**；
②「early return 防回潮」——`structural` 不含 `envEnabled` 时 fall-through **恰好良性** ⇒ 纯行为断言
无法捕获该 return，**如实降级为「行为快照」**并注明「不宣称有测试保护」。

## §6 系统级定性（仍有效）

1. **状态层是全系统最干净的部分**——`envState` 单例 + `setEnvState` 中央写入 +
   `lastWriteSource` 守卫 + schema 值域钳制；6 cap 统一收口、组过滤派发、单一事实源。
   缺陷集中在**守卫来源纪律**（程序化写入误用 `manual` 级别）与**私有门未收编**，不在骨架。
2. **渲染层重建成本不对称**：sky PMREM / reflector RT / environment PMREM 三处
   「结构键即全重建」，滑杆逐帧写入未做提交收口（`onCommit` 钩子已存在但仅 pixel-ratio 在用）。
   统一口径：**结构键走 onCommit、参数字段走 oninput**。
3. **「能力总开关」概念的收编序列已完成**（fog → water → shadow → reflector → sky → **environment**），
   六例同法；余 `ground` 僵尸门（无行为收益）。详见知识卡 `preview-env-state.md`。

## §6 审计轮次索引

| 轮次 | 主题 | 落点 |
|---|---|---|
| 2026-09 初轮 | 6 面板 UI + 接线全扫 | §1~§12（结论已并入本表） |
| 2026-09-22/23 | shadow → reflector → sky 三度收口 | §21~§23 |
| 2026-10-04 | 地面重审 | §18~§19（G-6/G-8/G-9 已修，G-7 挂账） |
| **2026-10-05** | **env 第四度收口 + master 契约校准** | 提交 `88926c810`、`099f1b0b3`；概念骨架审见 §5 |

**未覆盖/待办**：概念骨架层的 `F-4`（shadow/light 是否属「环境」）属产品决策，见本文件 **§5 的 F-4 行**。
