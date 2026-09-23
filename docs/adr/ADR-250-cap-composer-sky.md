# ADR-250：后处理门禁降参——模型类别不写 cap 参数、composer 常驻、曝光属主归 sky

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/caps/postprocessing-capability.ts, frontend/src/preview-3d/caps/postprocessing-state.ts, frontend/src/preview-3d/caps/sky-capability.ts, frontend/src/preview-3d/adapters/shared-infra.ts, frontend/src/preview-3d/state/preview-state.ts, frontend/src/preview-3d/state/env-state-schema.ts, ADR-196, ADR-247, ADR-126`

---

## 1. 背景（Context）

对「后处理跟着模型走」（`POSTPROC_PRESETS` per-type 门禁）做定点核查后，确认这不是一个
「设计好但落地有回归」的机制，而是**一个被误命名的机制**——它的名字、注释、实际效力三者互不相符，
且它的真实效力落在了一个与本功能无关的渲染器字段上。

本 ADR 的全部结论均经源码逐条核实，证据见 §4；核心发现如下。

### 1.1 `POSTPROC_PRESETS` 不是「预设」，是六个开关

`postprocessing-state.ts` 的 `POSTPROC_PRESETS` 六个条目（`default` 连键都没有）：

```ts
default: {},
ysm: { enabled: false },  vrm: { enabled: true },  mmd: { enabled: true },
litematic: { enabled: false },  resourcepack: { enabled: false },  "mmd-scene": { enabled: false },
```

**唯一的键是 `enabled`，且它在 `PostprocessingParams` 中属 `Exclude<..., "enabled">` 之外**——
即它不是后处理参数，是能力级挂载开关。`MODEL_DEFAULTS` 中 postprocessing 段是**注释而非数据**
（`// postprocessing (POSTPROC_PRESETS.mmd = {enabled: true})`）。

故所谓「模型类别后处理预设」在**参数轴上的内容是空的**：不存在任何 per-type 的
`ppBloomStrength` / `ppExposure` / `ppToneMapping` 覆盖。§1.4 将说明，这一「空」本身是缺陷
而非设计。

### 1.2 模型类别确实伸进了 cap 内部，且这是门禁的唯一实现方式

`applyPostProcDefaults(modelType)` 读 `POSTPROC_PRESETS` 写 `this.perTypeGate`，
由 `syncEffectiveEnabled()` 与 `perfMaster` 相与得出生效开关。即模型类别（业务概念）
**直接写 cap 私有字段**，cap 的挂载与否由模型格式决定。

这构成一处职责越界：模型类别（adapter 语境）与渲染能力（cap 语境）本应正交——Three.js
渲染器及适配器对色调的处理是自洽的，模型格式不携带「是否需要 ACES + Bloom」这一信息。
把二者绑定，等于**替不存在色调差异性的维度制造特例**。

### 1.3 composer 重建被绑在最易变的轴上

`perTypeGate` 翻转 → `syncEffectiveEnabled()` → `disposeComposer()` + `buildComposer()`，
而 `buildComposer()` 首行即 `disposeComposer()`。一次重建涉及：

```
EffectComposer + RenderPass + OutputPass
+ UnrealBloomPass（多级 mip 的 WebGLRenderTarget）
+ SSAOPass / SSRPass（各带若干全屏 RenderTarget）
```

`applyPostProcDefaults` 在**每次模型装配**时调用（`shared-infra.ts` 装配链），且紧接其后
`applyPerfPreset(getPerfPreset())` 又调一次 `setMasterEnabled`（总闸）。于是「切模型」这一
最高频动作，直接映射为「一整组 GPU 资源 dispose + 重新 allocate」。缓存被设计成绑定在
最易变的轴上——这是配置缓存失效的结构性来源。

### 1.4 「亮瞎」的真因：`enabled` 的真实效力是抢占 `renderer.toneMappingExposure`

亮度轴无 per-type 值（§1.1），故「MMD 亮瞎」不可能来自亮度补偿过头。实测属主链：

| 写者 | 写入值 | 位置 |
|------|--------|------|
| `SkyCapability.apply()` | `renderer.toneMappingExposure = envState.skyExposure` | `sky-capability.ts\|apply` |
| `PostprocessingCapability.applyToneMapping()` | `renderer.toneMappingExposure = envState.ppExposure` | `postprocessing-capability.ts\|applyToneMapping` |

`skyExposure` 是 per-type 的（default `0.5` / ysm `0.6` / vrm `0.55` / mmd `0.55`），
`ppExposure` 全局 `1.0`。后处理开启即由 postproc 夺走 exposure 属主：

- **YSM**：门禁 `false` → 后处理关 → exposure 停在 `skyExposure`（`0.6`）→ 观感正常
- **MMD**：门禁 `true` → 后处理开 → exposure 被抬到 `ppExposure`（`1.0`）→ **约 1.8× 亮**

**同一根因解释全部三个现象**：症状「YSM 没有后处理」与「PMX 亮瞎」是同一个门禁的两个方向
（躲过 / 挨了 exposure 抢占）；症状「缓存失效」是门禁翻转的必然后果（§1.3）。

`postprocessing-capability.ts` 的注释已记录过这个 1.8~2× 跳变（见
`postprocessing-capability.ts\|restoreOutputSettings` 的文档注释），但被归因为「切档位时
忘了归还曝光」，修法是补 `restoreOutputSettings()`。**切模型时的同一跳变在「门禁翻 true」
路径上被当成了预期行为**，因而从未进入视野。

### 1.5 `enabled` 的三重语义是本 ADR 要终结的根源

`postprocessing-state.ts` 注释自述：

> 亮度参数一律继承 envState 默认值，**不按类型分别调**：同一光影包 → 同一观感，
> 消除「YSM/车万女仆爆亮、MMD/VRM 无反应」的不对称（材质差异不应由 per-type 亮度补偿）

口径明确拒绝用 per-type 补偿材质差异以消除不对称，但 `enabled` 恰恰制造了**最大的一处
不对称**——开/关后处理 = `skyExposure`(0.55) 与 `ppExposure`(1.0) 之间的 1.8× 曝光差。
**它声称要消除的不对称，正由它自己制造。**

同时，`enabled` 一枚字段承载了三重语义：能力级挂载（ADR-196 红线：不入 schema）、
模型类别偏好（ADR-196 删掉的 `params.enabled` 即此物）、性能档位总闸。ADR-196 删除
`params.enabled` 后语义被挤进 `this.enabled`；ADR-247 D3 造出 `perTypeGate` 把它捞回，
并自述「恢复为显式字段」——**`perTypeGate` 实为 `params.enabled` 改名复活**。

### 1.6 ADR-247 D3 的播种值使门禁在构造后即失真

ADR-247 D3 记录：「构造参数 `enabled` 同时作为门禁初值（`perTypeGate = this.enabled`），
以保证构造后『生效 = 总闸 && 门禁』立即自洽」。但核实 `scene-capability-registry.ts`：

```ts
sceneCapabilityRegistry.add("postprocessing", (ctx) => new PostprocessingCapability(ctx));
```

**构造从未传入 `enabled`**，故 `this.enabled === false`，`perTypeGate` 播种为 `false`。
ADR-247 称此举是为避免「`setMasterEnabled` 因门禁初值 false 而无声失效」，
但播种值本身即 `false`——该注释与实际不符。

真正的时序是：装配链在 `cap.apply()` 之后调 `applyPostProcDefaults(modelType)`，
由预设覆盖门禁。故门禁在构造后至装配前恒为 `false`；`POSTPROC_PRESETS.default = {}` 不写门禁，
**任何六个预设之外的模型类型，门禁永久停在 `false`**。这正是 ADR-247 R1（阻断级回归）
的成因——R1 被当作实现疏漏修复（`loadState` 补写门禁），但其**根因是「一枚字段三重语义 +
播种值与注释不符」，补写只治了其中一条写路径**。

---

## 2. 决策（Decision）

采用**门禁降参 + composer 常驻 + 曝光属主归 sky**：模型类别不再写 cap 私有字段，
后处理启用与否退回统一状态层的一个参数；composer 生命周期与「换模型」解耦；
`toneMappingExposure` 由 sky 独占。

### 2.1 门禁降为 envState 参数

新增 `ppEnabled`（`env-state-schema.ts`，`group: "postprocessing"`），承载「后处理是否启用」
这一用户意图，与其余后处理参数同处一层。

**理由**：ADR-196 已确立「唯一真值在 envState 单例」；门禁之所以一度无家可归，是因它被
误判为「能力级挂载」。但实际上「是否显示后处理效果」是**用户对可见效果的偏好**，
与「cap 是否构造」是两件事——后者是会话生命周期，前者是状态。归入 envState 后：

- 模型类别若确有默认偏好，写的是**参数**而非 cap 私有字段（§2.4）
- `setEnvState` 是唯一写入口，写路径对账从「四条手工同步」收敛为「一条状态流」
- `this.enabled` 退回纯派生量（`composer 是否存在`），不再被四路写入

`this.enabled` 保留为该派生量的读法（`isEnabled()` 语义不变），但**不再是独立真值源**。

### 2.2 composer 常驻，启停走 pass 旁路而非销毁

> ⚠️ **本节的「关闭态走 composer 旁路」已被 ADR-299 修订**：
> 实测关闭态走 composer 每帧多耗 1.05ms GPU（+53.7%）并常驻 35.3MB 读写缓冲
> （`ppEnabled` 默认 `false`，即默认路径上的绝大多数会话白付费）。
> 现改为**惰性常驻**：首次启用才建、建后不销毁（本节的生命周期结论保留），
> 但关闭态 `render()` 返回 `false` 交回直渲——生命周期与每帧参与解耦。
> 「换模型不重建 GPU 资源」的收益不变。详见 ADR-299。

后处理关闭时**不销毁 composer**，改为旁路：`needComposer()` 恒真（composer 一旦建立即常驻），
关闭态经 `renderPass`/各 pass 的 `enabled` 与 `composer` 使用标记切换，`render()` 返回 true
且直接走 `renderPass`（等价于原 `renderer.render`）。

**理由**：症状「配置缓存失效」的根源是「换模型 → 门禁翻转 → 整组 GPU 资源重建」。
把 composer 生命周期从**模型轴**移到**会话轴**（挂载时建、dispose 时拆），换模型即与
GPU 资源分配解耦。`bloomPass.enabled` 旁路已在用（`syncBloomPass`），扩到 SSAO/SSR 是同一范式
的推广，非新机制。

**代价与缓解**：常驻 composer 持有若干 RenderTarget 的常驻显存。缓解是旁路时
`composer.setSize` 保持现状、不额外分配；确需极致省显存时由 `disposeComposer()` 在
**会话级**（非模型级）触发，即申请与释放仍在同一量级，只是不再随模型切换抖动。

### 2.3 曝光属主归 sky，postproc 退出 `toneMappingExposure`

`PostprocessingCapability` **不再写 `renderer.toneMappingExposure`**：`applyToneMapping()`
收敛为只写 `toneMapping` + `outputColorSpace`；`restoreOutputSettings()` 相应缩为
「只归还 `toneMapping` / `outputColorSpace`，exposure 不碰」。

`ppExposure` **降为 sky 曝光的乘法系数**：有效曝光 = `skyExposure × ppExposure`，
由 sky 侧统一写入 `renderer.toneMappingExposure`（`ppExposure` 默认 `1.0`，故默认行为与原
`skyExposure` 一致）。保留用户对该参数的调节能力，且 postproc 不再持有渲染器字段。

**已决策**（2026-09-16，人类首席架构师）：采乘法系数方案，不退役该参数。

**理由**：`renderer.toneMappingExposure` 是**渲染器级单值**，被两个 cap 并写（§1.4）。
ADR-247 D2 已确立「借走一个能力，事后归还」必须能回答「借条在谁手上」——exposure 同理，
且**并发持有是无解的**（不像 reflector 可串行压制）。sky 对曝光有**物理理由**
（天空为场景定基调、`skyExposure` 本就是 per-type 的），postproc 没有（它只管 ACES 转换与
bloom）。故按「谁有理由谁持有」定属主。

### 2.4 删除 `POSTPROC_PRESETS`；模型类别不写 cap 参数

删除该表与 `applyPostProcDefaults` 的 per-type 门禁写入。模型类别若未来确需默认偏好，
**只允许写 `ppEnabled` 参数**（经 `MODEL_DEFAULTS`，与其余五 cap 同构），
**禁止写 cap 私有字段、禁止在 cap 内建 per-type 分支**。

**理由**（本 ADR 的核心主张）：§1.1 已证该表在参数轴上是空的，其唯一内容是被误命名为「预设」
的挂载开关；§1.2 已证模型类别伸进 cap 内部属职责越界。删表不是删功能——「YSM 默认不开后处理」
这一意图若仍需要，由 `MODEL_DEFAULTS.ysm` 写 `ppEnabled: false` 表达，**与 sky/light/fog/shadow/
reflector/environment 六 cap 走同一条路**，且此时它是一句可被用户覆盖的默认值，而非一个
钉死在 cap 里的分支。

### 2.5 一并退役 `perTypeGate` / `perfMaster` / `syncEffectiveEnabled`

生效开关不再由二元相与得出：

- `perTypeGate` → 删除（模型类别偏好经 §2.4 落 `ppEnabled`）
- `perfMaster` → 删除（`render.bloom` 总闸语义经 §2.6 重新定义）
- `syncEffectiveEnabled()` → 删除（`ppEnabled` 变更即派发，无需「重算并落地副作用」这一层）

**理由**：§1.5 已证三重语义是全部回归的母体。ADR-247 R1 证明了每新增一枚需手工对账的字段，
就要与构造入参、`loadState`、`setEnabled`、`applyPostProcDefaults` 四条写路径逐一对齐，
且必然漏掉一条。消除字段本身比维护不变式更彻底。

### 2.6 `render.bloom` 总闸语义重新定义

`render.bloom` **退出 `PERF_PRESETS`**，档位不再管后处理开关。

**语义变化（已确认）**：原语义是「总闸 && 门禁」二元，低档位关后处理、高档位**不强制打开**
（尊重 per-type 门禁）。若降参后让 `render.bloom` 与 `pp-enabled` 写同一参数，则切性能档位会
覆盖用户的手动开关——即原设计刻意避免的越权。故直接**退表**：后处理是视觉项，
与 `wireframe`/`pmrem` 同类，而后者本就因「视觉项」被排除在档位表外
（见 `perf-presets.ts` 的范围注释），此次是把这条口径贯彻到 bloom 上，而非新例外。

**已决策**（2026-09-16，人类首席架构师）：采退表方案。`KNOWN_PATHS` 中的 `render.bloom`
同步退场（其消费方为档位表与面板绑定，退表后无消费者）；后处理开关唯一入口 = `pp-enabled` 控件。

---

## 3. 后果（Consequences）

### 正面

- **症状三（缓存失效）根治**：换模型不再触发 composer 重建，GPU 资源分配与模型轴解耦。
- **症状一/二（YSM 无后处理 / PMX 亮瞎）同源根治**：exposure 属主唯一，1.8× 跳变消失，
  后处理开与不开不再改变全局亮度基调。
- **写路径对账从四条收敛为一条**：`this.enabled` 不再被四路写入，ADR-247 R1 类「补一条漏一条」
  的回归模式从根上不成立。
- **模型类别与渲染能力解耦**：`applyPostProcDefaults` 及 `POSTPROC_PRESETS` 退场，
  cap 恢复为「状态 → Three.js」的纯适配器（回到 ADR-196 的既定定位）。
- **`perTypeGate` 的注释与实际不符（§1.6）随之消失**——不再有需要靠注释解释的播种时序。

### 负面 / 已知遗留

- **composer 常驻带来常驻显存**：关闭态仍持有 RenderTarget。缓解见 §2.2；若实测显存压力显著，
  回退方案是「会话级懒建 + 会话级销毁」，**仍不得回到模型级抖动**。
- **`render.bloom` 语义变化影响现有用户**：若采推荐方案，档位不再控制后处理开关，
  用户升级后「低档位自动关 bloom」的行为消失。须在发版说明中登记。
- **删除 `POSTPROC_PRESETS` 后，「YSM 默认不开后处理」需经 `MODEL_DEFAULTS` 重建**：
  若不重建，YSM 将从「默认关」变为「默认跟随 `ppEnabled` 默认值」。**此项须显式决策**，
  不可静默丢失（§2.4 给出去向）。
- **`ppExposure` 的存废影响 UI 控件**（§2.3 备选路径会移除一个滑块），须同步 i18n 三语言包。
- **测试面较大**：`postprocessing-capability.test.ts` 与 `preview-state.test.ts` 中大量用例
  围绕 `setMasterEnabled` / 门禁语义编写（含 ADR-247 新增的 R1/R2 回归测试），
  需随实现同步重写而非删除——**其中「门禁 off→on 可恢复」系列用例保护的是已消失的机制，
  应转为「`ppEnabled` 写入即生效且可往返」的等价断言**。

### 明确不做

- **不引入 per-type 后处理亮度补偿**：§1.5 的口径（同一光影包同一观感）**维持不变**，
  本 ADR 只终结「用挂载开关补偿」这一自相矛盾的做法，不反向打开亮度补偿。
- **不改 Go**：`pp*` 均为 cap 自持久化的 `env.*` 探针/本地键，不落 Go 契约（同 ADR-249 §2.7）。
- **不动 `ppBloomEnabled` / SSAO / SSR 等其余参数轴**：本 ADR 只收口「启用与否」与「曝光属主」
  两处，不扩散到大范围参数重整。

---

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `postprocessing-state.ts\|POSTPROC_PRESETS` | 六个条目唯一键为 `enabled`，`default` 为 `{}`；参数轴上无 per-type 覆盖 |
| `postprocessing-state.ts\|PP_PARAMS_TO_ENV` | `enabled` 不在映射内（`Exclude<..., "enabled">`），确认其非参数而是挂载开关 |
| `state/model-defaults.ts`（postprocessing 段） | 七处均为注释而非数据，确认 `MODEL_DEFAULTS` 未携带后处理字段 |
| `postprocessing-capability.ts\|perTypeGate` / `perfMaster` / `syncEffectiveEnabled` | 生效开关 = `perfMaster && perTypeGate`；门禁由 `applyPostProcDefaults` 写 |
| `postprocessing-capability.ts\|buildComposer` / `disposeComposer` | `buildComposer` 首行即 `disposeComposer`；重建涉及 Bloom/SSAO/SSR 全部 RenderTarget |
| `shared-infra.ts\|applyPostProcDefaults` + 装配链 | 每次模型装配调用，其后紧接 `applyPerfPreset` 再调 `setMasterEnabled` |
| `scene-capability-registry.ts`（postprocessing 注册行） | 构造**未传 `enabled`** → `this.enabled` 默认 `false` → ADR-247 D3 播种门禁为 `false`，与其注释不符 |
| `postprocessing-capability.ts\|applyToneMapping` | 写 `renderer.toneMappingExposure = envState.ppExposure`（全局 1.0） |
| `sky-capability.ts\|apply` | 写 `renderer.toneMappingExposure = envState.skyExposure`（per-type 0.5~0.6）——与上者并写同一字段 |
| `env-state-schema.ts`（pp 段） | `ppExposure` 默认 `1.0`，`ppBloomStrength/Threshold` `0.6`，`ppBloomRadius` `0.5`；无 per-type 分岔 |
| `postprocessing-capability.ts\|restoreOutputSettings` 注释 | 已记录 1.8~2× 曝光跳变，但归因于「切档位忘了归还」，未覆盖「切模型门禁翻 true」同一路径 |
| `postprocessing-capability.ts\|loadState`（ADR-247 R1 修复处） | `enabled` 恢复分支补写 `perTypeGate`，确认 R1 系由「字段三重语义 + 播种失真」引发 |
| `perf-presets.ts`（范围注释 + `PERF_PRESETS`） | `render.bloom` 在三档位中分别 `false/true/true`；注释已确立「视觉项不进档位表」（wireframe/pmrem 据此排除） |

<!-- 文件名: cap-composer-sky.md → 实际文件 ADR-250-cap-composer-sky.md -->
