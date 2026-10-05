# 后处理系统锐评（2026-10-04）

> **审计对象**：3D 预览「后处理（postprocessing）」能力簇——`frontend/src/preview-3d/caps/postprocessing-{capability,menu,state}.ts`
> ＋ `state/env-state-schema.ts` 的 pp 组 ＋ 量具 `postproc-cost-probe.test.ts` ＋ 知识卡 `docs/knowledge/preview-env-state.md`。
> **方法**：主模型亲自通读源码 + three 0.186.1 上游源码取证（`EffectComposer.js` / `SSRPass.js` / `UnrealBloomPass.js` / `Pass.js`）；
> 对外可见结论逐条给「文件 + 符号」取证，不照抄 ADR 自述。
> **基线**：`postprocessing-capability.test.ts` + `postproc-cost-probe.test.ts` 共 114 用例全绿；`src/preview-3d` 165 文件 / 3029 用例、
> `vite build` + `typecheck` + `check-biome` 全绿（收敛时实测）。
> **与既有 ADR 的关系**：ADR-247（联动/抑制态/门禁）、ADR-250（启用意图入 schema）、ADR-299（composer 惰性常驻）已解决前几轮大病；
> 本报告**只记存量问题与本次新发现**，不重复历史结论。
> **覆盖口径**：结论限定在「读到的机制」层面，**不可外推为「后处理无风险」**。

## 处置状态（2026-10-05 收敛核对）

> 逐条对**当前源码树**核实，过程叙事与逐轮验证明细已删（git 历史可查）。
> **本节含两处审计自我更正**（保留痕迹以备审计）——见表中「更正」两行。

| 条目 | 状态 | 说明 / 现源码锚点 |
|---|---|---|
| P1-1 SSR 缓冲被逻辑尺寸覆盖 | ✅ 已修 | `postprocessing-capability.ts\|setSize` **只记凭据**，交给 composer 驱动，不再手写 `ssrPass.setSize`（逻辑量）二次覆盖 |
| P1-2 `dispose()` 不复位会话级字段 | ✅ 已修 | 补复位 `isStateLoaded` + 三凭据（`lastW` / `lastH` / `lastPixelRatio`）——复用短路下模型默认重新生效 |
| P1-3 总开关关闭时子控件静默 no-op | ✅ 已修 | `postprocessing-menu.ts\|disabledWhenOff` 20 处灰化 + `capability` 的 `subscribe→menu.refresh` 通知链 |
| P2-1 尺寸凭据与 pass 构造尺寸双源 | ✅ 已修 | 抽 `postprocessing-capability.ts\|passSizes` 单源（凭据优先，为空才回落 renderer 现值），`attachSSAOPass` / `attachSSRAndBloomPasses` 共用 |
| P2-2 `ppExposure` 不受总开关约束 | ✅ 已修 | 曝光滑杆受 `ppEnabled` 门控——关掉后处理时其面板滑杆不再改变画面亮度 |
| P2-4 上游 `SSRPass.dispose` 漏释放 `ssrMaterial` | ✅ 已修 | `ppReflectionMode` **不重建 composer**，改切 `ssrPass.enabled` 与参数（顺带消掉 P1-1 的重建面） |
| P2-5 跨会话像素比凭据陈旧 | ✅ 已修 | 与 P1-2 同源，`dispose()` 复位 `lastPixelRatio` |
| **P2-3 多会话共享 `envState` 交叉污染** | **📝 记录，非待修** | ADR-196 单例设计固有代价，本 cap 未做会话隔离——**原样保留，见下** |
| **P2-6 归还判定 sky 停用期错归风险** | **⚠️ 疑似未复现** | 需 sky 停用 + 残留写入的真实时序，本轮测试未能复现——**原样保留，见下** |
| P3-1 `bloomPass.resolution` 死代码 | ✅ 已修 | 该行已删 |
| P3-2 陈旧注释与已删概念残留 | ✅ 已清理（部分） | `postprocessing-state.ts` 措辞已订正；`three r185` 版本标签已订正为实装 0.186.1——**其余 `r185` 提及经核为历史记录，有意保留原文，见下** |
| P3-3 `render()` 每帧重写 `pass.enabled` | ✅ 经核非缺陷 | 属兜底一致性，保留并登记（见 §三） |
| P3-4 测试层三处真实性缺陷 | ✅ 三处已修 | (a)(b)(c) 均修；**(a) 的修法与初判不同**——见下「更正」 |
| **更正①** P3-4a「死断言」的解读 | 🔄 初判修正 | `toneMappingExposure` 那条断言确实恒真，但**恒真的原因是设计正确**：本 cap 按 ADR-250 §2.3 **根本没有 exposure 写权**（属主归 sky），故无从「改动」、也无从「归还」。**试图「强化」成「归还构造期快照」的改法会转红**——那不是缺陷暴露，而是**断言写错了契约**（本轮实测撞上此红并回退）。正确修法 = 钉死属主契约：中途被他人改动后 dispose **不得回写**（回写即属主争夺复发 = 「MMD 亮瞎 1.8×」的根因） |
| **更正②** F-1（`isSsrRenderActive()` 注释与实现不符） | ❌ 撤回 | 经复核**不成立**——`applyReflectorSync` 现文**确实调用** `isSsrRenderActive()` 单源判定（该函数内「[锐评 F-1] 判定收编 state/env-state」注释），与 `water-capability\|reflectionActive` 同源。本报告原列的「待补」条目予以撤回 |

**审计自我纠错的方法论产出**（上表两行更正的共性）：
**① 一条断言恒真，先问「它是不是本来就不该被写」——「无写权」是设计结论，不是缺陷证据；把无写权当成「还原逻辑没覆盖」去补强，等于给别人的属主写一条越权断言，必然转红且红得有理。**
**② 被证伪的指控要显式撤回并留痕，不能静默删除——撤回本身是给下一轮读者的「此路已探」路标。**

---

## 一、总判

**这是一套健康度偏高的子系统，不是烂摊子。** 前几轮锐评（ADR-247/250/299）把「开关撒谎」「一枚字段三重语义」「每帧白付管线过路费」三类大病都治了，且治得干净：本轮自查未发现骨架级病症。

具体证据（本次实测）：

| 维度 | 结论 | 取证 |
|---|---|---|
| 参数可达性 | **满分，21=21=21=21** | schema 21 个 `pp*` 键 = 菜单 21 个节点 = saveState 21 键 = loadState 21 键，无死参数、无孤儿控件、无存档不对称 |
| 启用意图真值源 | **已单源** | `postprocessing-capability.ts` `get enabled()` 读 `envState.ppEnabled`，cap 不再持有独立字段 |
| SSR 活跃判定 | **已单源** | `isSsrRenderActive()`（`env-state.ts`），pp 与 water 两处共用，无第三份手抄 |
| 抑制态归属 | **语义正确** | `postprocessing-capability.ts` 两态字段（suppressing/prevEnabled）能回答「借条在谁手上」 |
| 联动手册 | **已合规** | `syncBloomPass:506-537` 读浓度意图而非可见性，且带 `Number.isFinite` 守卫（ADR-247 R2） |
| 测试基线 | **114 绿** | 本次实跑确认 |

所以下面的问题都是**局部手术级**，不是推倒重来级。

---

## 二、确认缺陷

> **本节口径（2026-10-05 收敛）**：每条压成「**病症 / 触发 / 现源码锚点 / ⚠️ 元教训**」四段；
> TS·JS 代码块、逐步推导链、上游逐行引文、逐轮修复叙事与行号引用已删（修复均已落地，实现见源码与 git 历史）。
> **仍标未修的第 P2-3 / P2-6 条为活挂账，原样保留。**

### P1-1 ｜ SSR 缓冲被逻辑尺寸覆盖，DPR>1 时白白掉到 1× 分辨率

- **病症**：`setSize` 在 `composer.setSize(width, height)`（内部已按**物理尺寸** resize 所有 pass）之后，又用**逻辑尺寸**对 `ssrPass` 二次覆盖一遍
  ⇒ DPR=2、容器 800×600 时，SSR 的 beauty 缓冲实际是 **800×600 而非 1600×1200**，SSR 的整场重渲被降到 1/4 像素量。
- **更本质的一层**：pass 经 `composer.passes.splice(...)` **直插数组**，绕过了 `EffectComposer.addPass`/`insertPass`——
  而这两者是**唯一**会调 `pass.setSize(_width * _pixelRatio, ...)` 的地方，且 `Pass` 基类的 `setSize` 是**空实现**
  ⇒ **SSRPass 自构造起就从未被正确初始化过**：不只是「被覆盖」，是「从没对过」。本条因此从「resize 时才坏」升级为「一直坏」。
- **触发/持续性**：`render()` 每帧调同步，而 `setSize` 只在 resize / 像素比变更时走；`render-host` 在每次像素比变更后**无条件**补一发 `setSize`
  ⇒ 不是「窗口一 resize 就坏」的瞬态，而是**触发后持续保持**的状态。
- **用户可感知后果**：DPR ≥ 1.25 的机器上 SSR 反射（及 `ssr-only` 模式下的整个反射）分辨率低于主画面，边缘发虚。
  更隐蔽的一面——**这不是性能优化，是纯损失**：SSR 的 compute 成本（光线步进）按 uniform 的 `effectiveWidth/Height` 走，
  缓冲小了但步进开销没省，**画面糊了钱没少花**。反直觉点：**像素比越高（高分屏），SSR 相对越糊**。
- **现源码锚点**：`postprocessing-capability.ts|setSize`（**只**记凭据并交给 composer 驱动，注释显式禁止手写 `ssrPass.setSize`）；
  `|passSizes`；`|attachSSAOPass` / `|attachSSRAndBloomPasses`（改走 `composer.addPass`/`insertPass`，注释点明「插入即正确」的不变量）。
- ⚠️ **元教训 —— 绕过框架的同步点，等于放弃框架给你的初始化**：`addPass`/`insertPass` 不只是「往数组里塞」，
  它是**尺寸同步的唯一入口**；`splice` 直插看着等价，实则把 pass 永远留在构造期的逻辑尺寸上。
  **凡「框架提供 add/insert 却手写数组操作」处，先问：这个 API 除了登记，还替我做了什么？**
- ⚠️ **元教训 —— 错误的优化方向会掩盖真损失**：这条表面像「多重写一次尺寸」，实际是**画质净损失**（糊了且钱没少花）。
  「看起来像性能取舍」的缺陷容易被当成 deliberate tradeoff 而跳过复核——**性能类改动必须同时问「省了什么」和「糊了什么」。**

---

### P2-1 ｜ 尺寸凭据与 pass 构造尺寸双源

- **病症**：同一份 `createComposerBase` 内**两套尺寸源**——composer 用 host 下发的凭据（`lastW/lastH`，为空才回落逻辑尺寸），
  紧随其后的 `attachSSAOPass` / `attachSSRAndBloomPasses` 却改从 `renderer.getSize()` **现取**。
- **触发**：惰性常驻下 composer 可能在会话中段才建，而 `lastW/lastH` 是 host 下发值、`renderer.getSize()` 是当前值——
  二者在「容器尺寸已变但尚未下发」的窗口内会不一致。后果轻微（首帧后即被 `setSize` 对齐）。
- **为何仍要记**：它是 **P1-1 的同源病根**——只要还有第二套尺寸源，「哪个是对的」就持续可争议。
- **现源码锚点**：`postprocessing-capability.ts|passSizes`（单源：凭据优先、为空才回落 `renderer.getSize`），
  `|attachSSAOPass` / `|attachSSRAndBloomPasses` 共用之；`|createComposerBase`。
- ⚠️ **元教训 —— 「事实源」必须收敛到一个函数，而不是一个约定**：两处各自「取合理的尺寸」不会报错，
  但会让正确性变成**可争议项**，于是真缺陷（P1-1）能在旁边安然存活。
  **同一函数内出现第二个同类取值点时，就地收口成单一取值函数，别靠注释约定「应该用哪个」。**

---

### P3-1 ｜ `bloomPass.resolution` 是死代码

- **病症**：`setSize` 内 `this.bloomPass.resolution = new THREE.Vector2(width, height)` 是**纯写入、零效果**——
  three 0.186.1 的 `UnrealBloomPass.setSize(width, height)` 只用来算 `resx/resy` 并 resize 各 RT 与 `invSize` uniform，
  **从不读 `this.resolution`**（构造器读一次用于初始建 RT，此后无人消费）；且每次 resize 都白白 `new` 一个 Vector2。
- **触发**：永不触发（死代码）。危险点在「读者会以为这行在配置 bloom 分辨率」。
- **现源码锚点**：该行已删。
- ⚠️ **元教训 —— 「写了一个字段」不等于「配置了那个东西」**：判断一行赋值是否有效，唯一依据是**消费者**（`grep` 该字段的读点），
  不是它的名字多像配置项。**上游字段名是最强的误导源——名字描述意图，读点才描述事实。**

---

### P3-2 ｜ 陈旧注释与已删概念残留，误导后来者 ｜ ✅ 已清理（部分）

> **状态（2026-10-04）**：本条两处已修——`postprocessing-state.ts` 的「enabled 不入 schema」已改写为
> 准确表述（`ppEnabled` **确在** schema；被 `Exclude` 掉的是 **params 结构体上的同名键**，
> 历史措辞把「params 无此字段」误表述成「schema 无此键」）；`postprocessing-capability.ts` 的
> `three r185` 版本标签已订正为实装 0.186.1（并注明该构造器签名自 r185 起未变、结论不受影响）。
> **其余 `r185` 提及经核为「当时读源码核实」的历史记录**（如「r185 起 X 变化」「r185 老锚点已随 r186
> 重构失配」），改成新版本号反而篡改历史事实，**有意保留原文**。

- **病症①**：注释写「注意：enabled 不入 schema，由 `this.enabled` 单独携带」——**与事实相反**：schema 已有 `ppEnabled`（ADR-250 正是把它入 schema），
  且 cap 也不再持有 `this.enabled` 字段（现为读 envState 的 getter）。该注释同时否定 ADR-250 的两条核心决策。
  **现源码锚点**：`postprocessing-state.ts|PP_PARAMS_TO_ENV` 的文档注释（已改写为「排除的是 **params 结构体上的同名键**，不是 schema 里没有 `ppEnabled`」）。
- **病症②**：构造注释写「构造只留 scene/renderer/camera/caps（enabled 形参保留仅为兼容…）」，与实际仍接受 `enabled` 形参一致，
  但 `setEnvState` 调用点未说明「**仅显式传入时生效**」——而这恰是 ADR-299 §3 第 1 点（构造期按启用意图建 composer）的**上游前提**，值得点明。
- **触发**：无（静态漂移）。风险是下一位读者按注释去「保持」一个与 ADR 相反的设计。
- ⚠️ **元教训 —— 注释与决策相反，比行号漂移更有害**：行号漂移只是失去指针，**反事实注释会把下一个读代码的人引向被 ADR 明确否决的设计**。
  本仓刚在 `context-menu.md` 立过「源码注释不写死行号」的规矩，这是同族病的另一半：**注释的「结论」同样会静默漂移，改决策时必须同步改注释。**
- ⚠️ **元教训 —— 版本号订正 ≠ 一律替换**：只有**当前仍生效的技术论断**里的陈旧版本号才该订正；
  形如「r185 起 X 变化」「r185 老锚点已随 r186 重构失配」是**当时读源码核实的考古记录**，改它反而篡改历史事实。**区分「陈旧标签」与「历史证据」。**

---

### P3-3 ｜ `render()` 每帧重写 `pass.enabled`，与 `onEnvChanged` 职责重叠

- **病症**：`render()` 每帧写三个 pass 的 `enabled`，而 `onEnvChanged` 在 `ppBloomEnabled` 变更时也写 `bloomPass.enabled`——表面像职责重叠。
- **触发**：无（不触发即为设计意图）。
- **裁定：经核实这不是缺陷**——`render()` 的写入是「每帧从状态层拉取」的**兜底一致性**，成本是三次布尔赋值（可忽略），
  且能防住 `onEnvChanged` 的漏网路径。`ppSsaoEnabled` / `ppReflectionMode` 走 rebuild 路径，行为自洽。
- **现源码锚点**：`postprocessing-capability.ts|render`（每帧同步 `enabled`）、`|onEnvChanged`。
- ⚠️ **元教训 —— 「每帧重算」不必然是浪费，要问它是兜底还是重复**：判据是「它能否防住另一条路径的漏网」。
  能，则是**幂等兜底**（保留并登记）；不能，则是纯重复（删）。**别用「有两条写路径」当缺陷证据，要用「第二条是否覆盖第一条的盲区」。**
  本条记录在此仅为免下次评审重复排查。

---

### P1-2 ｜ `dispose()` 不复位会话级字段，配合实例复用短路 ⇒ 换模型默认值永久失效

- **病症**：`dispose()` 收尾只做四件事（还原 reflector 抑制 / `unsubscribeEnv()` / `disposeComposer()` / `restoreOutputSettings()`），
  **三个尺寸凭据（`lastW` / `lastH` / `lastPixelRatio`）与 `isStateLoaded` 都不复位**。
  单看无害（cap 由 `sceneCapabilityRegistry.dispose()` 销毁、下次 `createAll` 建新实例），但 `scene-capability-registry.ts` 有一条
  **同宿主复用短路**——scene/renderer/camera 三者相同即 `return [...this.instances]`，**旧实例原样复用，不 dispose 不重建**。
  该短路本意是省掉「sky/water/reflector 的 render target 反复建拆」，后处理 cap 被连带复用后，两字段语义翻转：
  `isStateLoaded === true`（上个会话的存档残留）⇒ `applyModelPreset` 的早退守卫让**本会话的模型默认预设永久失效**（切 YSM/VRM/MMD 都不再改变后处理开关）；
  `lastW/lastH/lastPixelRatio` 是上个会话的尺寸 ⇒ 若本会话未下发过 resize 就启用后处理，composer 会按**上个会话的容器尺寸**建缓冲。
- **触发**：需「复挂同一 renderer + 本会话无新存档」两条件同时成立。
- **为何难发现**：测试用 `resetEnvState()` + 新建 cap，**永远走不到复用分支**。
- **现源码锚点**：`postprocessing-capability.ts|dispose`（补复位 `isStateLoaded = false` 与三凭据）；
  根因登记在 `scene-capability-registry.ts` 的复用短路——**不能简单删掉它**（对 sky/water 的 RT 收益是真的），
  故改为让后处理 cap 自己声明「复用时需复位」。
- ⚠️ **元教训 —— 生命周期钩子漏复位 = 跨会话状态泄漏**：`dispose()` 的契约是「回到未初始化」，
  **只做了「释放资源」而没做「清空状态」就是半个 dispose**。凡有实例复用/缓存短路的系统，
  必须逐字段核对「哪些字段描述的是**本次会话**」——它们全属 dispose 必须清空的集合。
- ⚠️ **元教训 —— 测试构造方式决定盲区**：全部用例都走「新建 cap」的路径时，复用分支就是**测试无法到达的代码**。
  **存在复用/缓存分支的系统，须有专门「复用后行为」用例；否则该分支的缺陷在测试上是不可见的。**

---

### P1-3 ｜ 总开关关闭时，SSAO / 反射模式控件静默 no-op

- **病症**：`ppSsaoEnabled` / `ppReflectionMode` 变更时，若 `composer` 为 null 则直接 `return`——**什么都不做**。
  `ppEnabled=false` 的会话里（含**从未开过后处理的绝大多数默认会话**），`composer` 恒为 `null`（惰性创建，唯一建点），
  此时用户拨 SSAO 开关、拖 SSAO 半径、切反射模式，代码路径直接 `return`——**零反馈、零提示**，
  直到某次开启总开关才建 composer 并读取。
- **触发**：任何「后处理未开启」的默认会话（即绝大多数）。
- **用户可感知后果**：「我明明把 SSAO 打开了，画面毫无变化」——这是 ADR-246/247 反复讨伐的「开关撒谎」的**同族变体**：
  不是显示假，而是**关闭态下控件没有生效通道**。
- **现源码锚点**：`postprocessing-menu.ts|disabledWhenOff` 作为 20 处子控件的统一灰化判据（最省事、最诚实的修法）；
  `postprocessing-capability.ts|subscribe`（补 `subscribe → menu.refresh` 通知链——`disabled` 是渲染期求值，缺此链则灰化态滞后）。
  未采用「变更时惰性触发创建」方案：那等于把默认路径的零成本重新打开，违背 ADR-299「未启用不分配」初衷。
- ⚠️ **元教训 —— 惰性创建的代价是「关闭态没有生效通道」**：惰性化省掉的是分配，**赔上的是「设置是否已生效」的可观测性**。
  凡惰性创建的资源，其消费者必须在关闭态给出**明确信号**（灰化 / 提示 / 状态行），否则用户无从区分「没生效」与「没效果」。
- ⚠️ **元教训 —— 渲染期求值的 UI 状态必须配订阅链**：`disabled: () => …` 是渲染期求值，
  若状态翻转不触发重渲染，灰化态就会**滞后于真实状态**——「修了灰化」不等于「灰化会及时更新」。二者是两条独立缺陷。

---

### P2-2 ｜ `ppExposure` 不受总开关约束，且 sky 停用时成为死参数

- **病症**：有效曝光 = `envState.skyExposure * envState.ppExposure`，**不读 `ppEnabled`**——
  故 `ppEnabled=false`（后处理已关）时拖 `pp-exposure` 滑块，全局亮度照变。
  反向：sky cap 缺席或停用时无人读取该键，而菜单控件仍可调。
- **触发**：关闭总开关后拖曝光滑杆（用户以为后处理已关，画面亮度仍随之改变）。
- **现源码锚点**：曝光滑杆受 `ppEnabled` 门控。
- ⚠️ **元教训 —— 属主正确 ≠ 门控完整**：属主裁定（曝光归 sky）本身是 ADR-250 §2.3 的正确答案，
  **这条不是「属主错了」，是「归属缺一个总开关门」**。参数被别的 cap 消费，不等于它可以豁免本 cap 的启用门。
  **跨 cap 共面板的参数，要分别核对「谁写」「谁读」「谁门控」三件事——三者常常不在同一个 cap 里。**

---

### P2-3 ｜ 多会话共享 `envState`，参数交叉污染

`env-state.ts` 的 `envState` 是**模块级可变单例**，而 `mount-session.ts` 明确「cooperate 多会话共享同一 scene/caps」。两个预览会话并存时，A 会话开 `ppEnabled`/改 SSAO，B 会话同步变（两个 cap 实例都订阅 `postprocessing` 组并各自落地）。

属 ADR-196 单例设计的固有代价、非本 cap 引入，但本 cap 未做会话隔离。**建议**：至少写进知识卡作为已知语义，避免下次被当新缺陷重复排查。

---

### P3-4 ｜ 测试层三处真实性缺陷 ｜ ✅ 三处已修（(a) 的解读见文首更正①）

> **状态（2026-10-04）**：(a)(b)(c) 均已修，且 **(a) 的修法与报告初判不同**——
> 详见文首处置状态表「更正①」：该断言恒真是**设计正确**所致（本 cap 无 exposure 写权），
> 强行"强化"成"归还快照"会误报红。最终改为钉死属主契约（中途被改 → dispose **不得回写**）。
> (b) 收归 describe 级 `beforeEach/afterEach` 隔离，删去 8 处手写副本；
> (c) 弱断言 `not.toBe(1.8)` 收紧为精确值 `toBe(1)`（本 cap 不写 → 必保持初值）。

- **（a）空洞断言（P2）**：用例名含 "exposure"，并断言 `renderer.toneMappingExposure` 等于某值。
  但本 cap 自 ADR-250 起**已删除 exposure 的写路径**（曝光归 sky），该字段从未被写入 ⇒ 断言**恒真**，通过不证明任何还原逻辑。
  用例名同样镜像的是 ADR-250 之前的旧架构。**修法**：转为钉死属主契约——中途被他人改动后 dispose **不得回写**。
- **（b）测试隔离依赖（P2）**：某 describe **没有** `beforeEach(() => localStorage.clear())`（对比另两个 describe 都有），
  改为在用例末尾手工 `clear()`。**任一中途断言失败则 clear 不执行** ⇒ 污染后续用例，产生顺序依赖。**修法**：收归 describe 级 `beforeEach/afterEach` 隔离。
- **（c）弱断言（P3）**：`expect(...).not.toBe(1.8)` 只断言「不等于 1.8」，任何非 1.8 的值（含错误值）都能通过；
  同组其余断言用的是 `toBeCloseTo` 强断言，此处口径不一致。**修法**：收紧为精确值 `toBe(1)`。
- **触发**：无（测试层，无用户可见后果），但会**削弱这批测试作为回归锁的可信度**——尤其 (a) 会让「exposure 还原」这一**已不存在的职责**看起来仍被覆盖。
- ⚠️ **元教训 —— 恒真断言要分「写错了」与「本来就不该写」两路排查**：同一句 `expect(x).toBe(v)` 恒真，
  可能是**断言没分辨力**（该删/该强），也可能是**被测对象根本不属本模块管**（该改成属主契约断言）。
  误判成前者去「强化」，会写出越权断言并必然转红。**先问「这个值该由谁写」，再问「这条断言能不能分辨实现」。**
- ⚠️ **元教训 —— 清理式收尾（手工 clear）不是隔离**：把 `beforeEach` 的清理挪到用例末尾，
  等于把「清理」交给了「断言全过」这个前提——**失败路径不清理**，于是缺陷从「局部错」升级为「污染后续用例的顺序依赖」。
  隔离必须落在**结构上**（describe 级 beforeEach/afterEach），不能落在**流程末尾**。
- ⚠️ **元教训 —— 断言口径要在同一组内保持一致**：同组混用 `toBeCloseTo` 与 `not.toBe` 时，
  弱断言不是「更宽松的同类」，而是**另一种东西**——它把「精确等于初值」的契约偷偷降级成「不是那个错误值」。**弱断言会伪装成强断言躺在强断言旁边。**

---

### P2-4 ｜ 上游客源缺陷：`SSRPass.dispose` 漏释放 `ssrMaterial`，反复切反射模式累积泄漏

- **病症**：three 0.186.1 的 `SSRPass.dispose` 释放了 7 个 RT + **6 个** material
  （normalMaterial / metalnessOnMaterial / metalnessOffMaterial / blurMaterial / blurMaterial2 / copyMaterial / depthRenderMaterial）+ fsQuad，
  **唯独漏掉 `ssrMaterial`**——而它正是持有 `defines`（含 `MAX_STEP`）与全部 uniforms 的 ShaderMaterial。
- **触发**：`onEnvChanged` 把 `ppReflectionMode` 变更处理为 `buildComposer()` **全量重建**，每次重建都 `new SSRPass(...)` → 新 `ssrMaterial`，
  旧的那个随 dispose 链永久留下。**反复切换反射模式**（envmap-only ↔ envmap+ssr ↔ ssr-only）会累积未释放的 ShaderMaterial 与着色器程序，
  表现为**显存缓慢增长**。
- **现源码锚点**：`postprocessing-capability.ts|onEnvChanged`（`ppReflectionMode` 变化**不重建 composer**，
  改为切 `ssrPass.enabled` 与参数——`render()` 每帧已按 `ppReflectionMode !== "envmap-only"` 同步 `enabled`，
  说明「不重建」技术上可行）；这同时消除了本条与 P1-1 的重建面。
- ⚠️ **元教训 —— 上游 dispose 要按「持有物清单」核对，不能按「它调了 dispose」放心**：
  上游的 `dispose` 是**手写清单**，漏项是常态（本条漏的恰是承载 defines 的核心材质）。
  **凡依赖上游释放的路径，反向清点「我 new 了什么」与「它 dispose 了什么」的差集。**
- ⚠️ **元教训 —— 无法修上游时，改调用模式比改上游更划算**：本 cap 改不了 three，
  但「切 `enabled` 而非重建实例」把**泄漏面与重建面一起消掉**。**遇到上游缺陷，先问「我是否根本不必触发那条路径」。**

---

### P2-5 ｜ 跨会话像素比凭据陈旧（ADR-299 尺寸凭据引入的新残留）

- **病症**：`shared-infra.ts` 在 mount 时把 renderer 像素比复位（`previewPixelRatio(devicePixelRatio)`），
  这正是为了治「自适应降档把 renderer 钉在低档、关预览再开仍停低分辨率」的病史——**但它没有同步通知 postprocessing cap**，
  而 cap 的 `lastPixelRatio` 是跨会话残留的（见 P1-2）。
- **触发链**：会话 A 自适应降到 0.75 → `cap.lastPixelRatio = 0.75` → 关预览 → 会话 B 重开，renderer 已复位到 1.5，
  但 cap 仍是 0.75 → 若 B 会话首次启用后处理，`createComposerBase` **优先取凭据 0.75** 建缓冲
  → composer 分辨率只有 renderer 的一半，**画面糊**。仅当 `render-host` 恰好在 B 会话再次降档触发 `setPixelRatio` 时才被纠正。
- **现源码锚点**：`postprocessing-capability.ts|dispose` 复位 `lastPixelRatio`（与 P1-2 同源，最省）。
- ⚠️ **元教训 —— 凭据机制本身没错，错在凭据没有会话边界**：
  缓存/凭据的失效条件必须是**显式的生命周期事件**（会话结束），不能寄望「恰好有人再下发一次」来纠正。
  **凡「记住上次的值以免重建」的设计，都要同时写下「这个记忆何时作废」。**

---

### P2-6 ｜ 归还判定在 sky 停用期存在错归风险（低概率）

`restoreOutputSettings:494` 用「renderer 当前值 === 本 cap 想写的值」判定归属。若 sky 曾写入过 toneMapping 但此刻**未启用**（`skyOwns` 守卫 `:490` 只在 sky 启用时生效），该判定会把 sky 的残留值误判为「本 cap 持有」并打回构造期快照。

标注为**疑似**：需要 sky 停用 + 残留写入的真实时序才能触发，本次未能在测试中复现。

---


## 三、经核实**不是**缺陷（免下次重复排查）

| 疑点 | 裁定与理由 |
|---|---|
| `getParams().enabled` 是否属冗余旧概念 | **否**。`PostprocessingParams.enabled` 是兼容层字段（供 menu/测试读），真值源是 envState；`postprocessing-state.ts` 的 `satisfies Record<Exclude<keyof PostprocessingParams, "enabled">, FieldKind>` 已用类型把它排除在持久化表外，属**有意设计** |
| `reinhard` 等 tone mapping 是否「开关撒谎」 | **否**。`ppToneMapping` 由本 cap 写 `renderer.toneMapping`；曝光归 sky（有效曝光 = skyExposure × ppExposure）是 ADR-250 §2.3 的**明确单一属主**裁定，非漏洞 |
| `ppExposure` 在本 cap 却有控件 | **否**。控件写 `envState.ppExposure`，由 sky 侧消费，属跨 cap 参数共面板，符合 envState 统一状态层设计 |
| SSAO 在 `ppSsaoEnabled=false` 时仍构造 | **否**。`attachSSAOPass:323` 有 early return；开启时才在 rebuild 路径构造 |
| `applyModelPreset` 每次挂载都覆盖用户开关 | **否**。`:668` 的 `isStateLoaded` 守卫 + `source: "auto-model"` 仲裁链完整（R-1 血案的结构性修复） |
| 抑制态在 `dispose()` 的还原 | **否**。`:859-871` 与 `applyReflectorSync` 同口径（仅当仍持有压制才还原） |
| `composer.passes.splice` 的插入索引是否会错序 | **否**。索引每次 `indexOf` 现算（`:334`/`:350`/`:389`），有/无 SSAO 两种情况分别得到 `Render→SSR→Bloom→Output` 与 `Render→SSR→SSAO→Bloom→Output`，与 `render()` 遍历及 `swapBuffers` 自洽 |
| SSR 忽略 readBuffer 导致链首修复方向是否搞错 | **否**。`SSRPass.render` 签名确实把 readBuffer 注释掉（`SSRPass.js:531`），「SSR 独占链首」的判断与修复方向正确 |
| SSR `needsSwap` 默认 true 是否多余 | **否**。它两次覆写同一 writeBuffer、从不读 readBuffer，swap 语义多余但不致命 |
| 结构变化重建是否泄漏 composer 缓冲 | **否**。`EffectComposer.dispose`（`EffectComposer.js:354-361`）会连同**外部传入**的 renderTarget1/2 一并释放，`createComposerBase` 自建 RT 被正确回收 |
| `RenderPass` 无 dispose 是否泄漏 | **否**。它不持有 GPU 资源，走 `Pass` 基类空实现（`Pass.js:100`）属正常 |
| tone mapping 是否双重后处理 | **否**。three 对非 screen 输出跳过 tone mapping，`OutputPass` 读取 renderer 设置编译进 shader defines 是**正确用法** |

---

## 四、验收标准与陷阱（原处置顺序已完成，保留验收口径）

> **本节口径（2026-10-05 收敛）**：原「建议处置顺序」8 条**已全部处置完毕**（见文首处置状态表），
> 排序表与逐条理由已删。但其中两条是**跨轮次可复用的方法论**，与处置进度无关，**原样保留**——下一轮改这条链路时仍按此验收。

### 验收标准（量化口径）

- **验收标准**：DPR=2、容器 800×600 场景下，`ssrPass.beautyRenderTarget.width === 1600`；
  `vite build` + `typecheck` + biome + 后处理全量 vitest 绿。
- 要点：**回归锁必须断言物理量**（`beautyRenderTarget.width`，而非 `ssrPass.width` 这类回写入参的字段）——
  前者反映「整场重渲实际用了多大缓冲」，后者只反映「谁最后写了这个入参」，对 DPR 缺陷无分辨力。

### ⚠️ 陷阱：反向锁定（修 P1-1 时必红，勿回滚）

- **⚠️ 实施提醒**：修 P1-1 时 `postprocessing-capability.test.ts` 中 `expect(ssr.width).toBe(256)` 那条断言 **必然变红**——
  那是**预期的**（它锁的是**缺陷侧**），不要误判成「修复引入回归」而回滚。
- ⚠️ **元教训 —— 「反向锁定」是比恒真更危险的测试病**：恒真断言只是**没分辨力**（沉默的废物），
  反向锁定却是**把错误的那一侧钉成期望值**——它的「全绿」主动为缺陷背书，且在修复时**用一条红把你劝退**。
  分形：**看到「修完一条老断言红了」，先判它是「回归」还是「反向锁定」——判据 = 这条断言描述的是「应有」还是「现状」。**
  处置纪律：**修复方案必须包含该断言的同步改写**（并显式覆盖 DPR=2 场景），否则修复会被自己的测试挡在门外。

---

## 五、方法论说明

- 结论只认当前源码树与 three **0.186.1** 上游源码；ADR 正文里的「病」是决策时的历史快照，已在总判中逐条查证「是否已治」再下结论。
- P1-1/P3-1 与 ADR-299 §5 自述的「未在此 ADR 处理」吻合，但**本报告独立复核了上游源码**（`EffectComposer.js` 的 `setSize`/`addPass` 实现与调用顺序、`SSRPass.js` 的 RT 用途与 dispose 清单、`UnrealBloomPass.js` 的 `resolution` 消费者、`Pass.js` 的基类空实现），不是照抄 ADR 自述。
- **本报告含两处自我更正**（保留痕迹以备审计）：
  1. 初稿称 `ssrPass.setSize` 是「覆盖 composer 刚设好的物理尺寸」——机制描述不完整；**更本质的根因**是 `passes.splice` 直插绕过了 `addPass`/`insertPass` 这唯一的尺寸同步点，SSRPass 自构造起就未被正确初始化。
  2. 初稿称 `test:1117` 的断言「恒真、无法区分两种实现」——**这是错的**。`SSRPass.setSize` 无条件回写入参，该断言**能**区分（256 vs 512），它锁的是**缺陷侧**，属「反向锁定」。
- 已剔除的过度指控：`getParams().enabled` 冗余、tone mapping 撒谎、SSAO 白构造、`applyModelPreset` 覆盖用户值、结构重建泄漏、splice 索引错序、SSR 链首方向——均经源码核实不成立，列在 §三 备查。
- 本报告仅覆盖**后处理子系统内部**。跨系统交互（如 render-host 的整体渲染循环、sky/water 的曝光与反射协同）只在与本子系统缺陷直接相关处点出（P2-2 / P2-5 / P2-6），未做全链路审计。
