# 水面系统锐评（2026-10-04）

> **审计对象**：3D 预览「水面（water）」能力簇——`frontend/src/preview-3d/caps/water-{capability,params,reflect,body-strategies,menu,state,shader,migrations}.ts`
> ＋ `state/env-state-schema.ts` 的 water 组 ＋ 量具 `scripts/probe-water-wave.ts` ＋ 知识卡 `docs/knowledge/water.md`。
> **方法**：主模型亲自通读全部源文件；另派**两路子代理独立只读审计**，主模型对最强断言逐条实地抽查
> （**驳回/修正 2 条**，见 §三）；上游事实读 three 0.186.1 源码逐字取证；数值命题复跑探针 + 独立复算。
> **与既有文档的关系**：ADR-255/257/271/272/283/286/297/319 已解决前几轮大病；
> `docs/audit-env-review.md` §5/§6 的 S5-x / W-x 与本报告**不重复**，只在 §四 逐条复核闭环状态。
> **覆盖口径**：本轮**未跑** `pre-push-gate`，只做静态通读 + 探针复跑 + 独立复算；
> 结论限定在「读到的机制」层面，**不可外推为「水面无风险」**。

## 处置状态（2026-10-05 收敛核对）

> 逐条对**当前源码树**核实。过程叙事与逐轮验证明细已删（git 历史可查）。

| 条目 | 状态 | 现源码锚点 |
|---|---|---|
| P0-1 静水态 `Inf×0` → NaN | ✅ 已修 | `water-state.ts\|WAVE_DEGENERATE_WA` + `water-shader.ts` 退化门 |
| P1-1 尺度只归一了一半 | ✅ 已修 | `water-shader.ts\|steepScale`（`WAVE_STEEP_SIZE_REF/uSize`，早于自交 clamp） |
| P1-2 浪高滑杆 85% 死区 | ✅ 已修 | `water-menu.ts` wave-height `getHint` 显示钳后生效值 |
| P1-3 三条恒真守卫 | ✅ 已修 | 转数值断言 + 反证（原两条 `toContain` 字符断言已删） |
| P1-4 存量存档吃掉默认抬升 | ✅ 已修 | 新建 `caps/water-migrations.ts` + `WATER_SCHEMA_VERSION_KEY` |
| P2-1 ①②③④ 跨字段耦合 | ✅ 已修 | 单门 `waterEnabled` / `waterOpacity` 隐藏 / water-level `getHint` |
| **P2-1 ⑤ 未启用态口径不一致** | **❌ 未修** | `env.ts\|envCapSubNodes` 仍只剔除 master 节点——**见 §五 未决项** |
| P2-2 `strategy.id === "pool"` 裸判 | ✅ 已修 | `hasWallCeiling` 旗标 + 源码扫描闸 |
| P2-3 倒影成本计价失配 | ✅ 已修 | `water-reflect.ts\|multisample: 0`（上游默认 4× ⇒ 显存降 1/4） |
| P2-4 量具是平行手抄实现 | ✅ 已修 | 常量字面 + **表达式指纹**成对核查（配 `replaceAll` 篡改反证） |
| P2-5 文档/注释 drift | ✅ ①②④已修 | ③ 兼容层退役时钟仍无守卫——**见 §五 未决项** |
| P3-1 `transmissionRenderTarget` 死代码 | ✅ 已修 | 死分支 + 自证式用例均已删 |
| P3-2 倒影释放注释不实 | ✅ 已修 | `disposeReflector` 补 `geometry?.dispose()`；注释订正 |
| §七 X-1~X-8 横向外推 | ✅ 全部已处置 | 见 §七（**X-2 等编号有源码注释硬引用，勿改**） |
| §九 五笔账 ①~⑤ | ✅ 全部落地 | 见 §九（**账⑤ 被 ADR-322 引用，勿改**） |

**⚠️ 状态订正（2026-10-05）**：本报告原称「至此 **12 条全部处置完毕**」——
经收敛核对，**P2-1⑤（未启用态口径统一）源码未动**，故实为 **11 条已修 + 1 条未修**。
该条在 §二 P2-1 第 5 项与 §五 处置顺序第 6 条均有描述，但文首汇总行误记为全清。

**测试基线**：`water-capability.test.ts` **140 例**全绿（收敛时实测）。

---

## 一、总判

**骨架健康，且是仓内文档化程度最高的子系统之一；本轮读出的是「端点」与「自我验证闭环」两处的漏洞。**

正面证据（本轮实地核验，非转述）：

| 维度 | 结论 | 取证 |
|---|---|---|
| 轴拆分 | 类型 / 声明 / 渲染 / 策略四轴分离，`water-state.ts` 零 THREE | `water-state.ts` |
| 参数接线完备性 | 分派表 `Record<WaterParamKey, …>` 编译期强制表态；21 键 = schema 键集（契约测试锁定） | `water-params.ts`、`water-capability.test.ts` |
| 结构参数零重建 | film/pool 的 size / 池深 / 壁厚全走 `transformLinks`，几何一律单位化 | `water-body-strategies.ts` |
| 形态差异收口 | cap 里 `mode ===` 判别已清零；构造期与运行期共用同一形态旗标 | `water-body-strategies.ts` |
| 值域单一事实源 | setter 不再 clamp；滑杆值域取 `getParamRange`（schema） | `water-capability.ts`、`water-menu.ts` |
| 倒影纪律 | 逐帧现读 + 载体不入场景 + 渲期隐藏水根 + RT 线性空间换算 | `water-reflect.ts` |
| 旧项闭环 | W-1（空 folder 死头）/ W-3（键集同步）/ W-5（注入守卫）已闭环 | `render.ts`、`water-capability.ts` |

ADR-319（当天落地）刚治掉三个**数值级真缺陷**（波幅写死失控 / 泡沫恒不可达 / 频谱锚点错配），
「先建量具、再落数值断言」的手法在仓内属上乘。本报告的 12 条发现全部是**它之后**剩下的第二层问题：

> **一句话总判**：水面把「可采样性」（λ 锚定域宽）归一到家了，但**「端点」没人守**（浪高/水位归零即 Inf×0 出 NaN）、
> **「物理量」没对齐**（垂直振幅绝对米制 vs 波长相对域宽 ⇒ 波陡随域宽漂 30 倍）、
> **「守卫的真实性」没校验**（三条恒真计算被两条字符断言保护成假绿）——**量具与断言共同把「不变」误当成了「正确」**。

---

## 二、确认缺陷

> **本节口径（2026-10-05 收敛）**：每条压成「**病症 / 触发 / 现源码锚点 / 元教训**」四段；
> GLSL·JS 代码、逐步推导链、独立复算输出、逐轮修复叙事与行号引用已删（修复均已落地，实现见源码与 git 历史）。
> 仍标「**未修**」的第 5 项 / 第 ③ 项为活挂账，**原样保留**。

### P0-1 ｜ 浪高或水位拖到 0 ⇒ `Inf × 0` ⇒ 顶点 NaN：ADR-319 宣称的「静水态」实际是「水没了」

- **病症**：浪高或水位归零 ⇒ 陡度式 `0.8/(wa·N)` 得 +∞，`steep·amp` 与 `steep·wa` 双双变 `∞×0 = NaN`；
  顶点裁剪坐标与解析法线一起被污染 ⇒ 主流 GPU 丢弃含 NaN 的图元 ⇒ 水面整块消失，倒影 uv 扰动同毁。
  ADR-319 D1 自己引入，也是本轮唯一一条用户可直接触发的渲染破损。
- **触发**（三条都在合法值域内）：`waterWaveHeight=0`（`waterWaveHeight.range.min`）；`waterLevel=0`；
  pool 下 `waterLevel ≥ waterPoolHeight`（二者经 `effectiveWaveHeight` 把预算算成 0）。
- **现源码锚点**：`water-state.ts|WAVE_DEGENERATE_WA`（退化门常量）；`water-shader.ts`（波循环内 `wa <= WAVE_DEGENERATE_WA` 整波跳过）；
  `water-params.ts|effectiveWaveHeight`（归零侧）。e2e 端点取证已补：`frontend/e2e-web/water-wave-evidence.spec.ts` S7。
- ⚠️ **元教训 —— 假不变量**：旧注释与知识卡都写「1‰ 下界保 `wa > 0`——steep 项含 1/wa，恰零会炸 Inf×0」，
  但该下界加在 `aa` 上，而 `amp = uWaveHeight·…·aa`：**`uWaveHeight = 0` 时 `aa` 兜底到天上也救不了 `amp = 0`**。
  一份文档 + 一处注释**同时为一条不成立的守卫背书**——「有下界」≠「下界守住了目标量」。**守卫必须对着它声称保护的那个量写判据。**

---

### P1-1 ｜ 尺度只归一了一半：垂直振幅绝对米制 × 波长 ∝ 域宽 ⇒ 大水面被「横向揉皱」

- **病症**：D2 把波长锚到域宽、D1 把振幅留成绝对米制，二者叠加后 `steep·amp ∝ sizeSafe`（`amp` 被约掉）：
  **垂直起伏与 `waterSize` 无关，水平摆动却与 `waterSize` 成正比、与 `uWaveHeight` 无关**。
  实测最大水平位移 10 m 档 0.036 m / 80 m 档 0.291 m / 300 m 档 1.091 m，而垂直总振幅恒 0.060 m
  ⇒ 300 m 水面上顶点被水平推 1.09 m 而只起伏 6 cm，不是「大浪」而是**一块被横向拉扯的水膜**；同一浪高滑杆值在不同尺寸下语义完全不同。
- **触发**：调 `waterSize`（任意尺寸档），或在大尺寸下拖浪高滑杆。
- **现源码锚点**：`water-state.ts|WAVE_STEEP_SIZE_REF`（基准域宽＝schema `waterSize` 默认值）；`water-shader.ts|steepScale`
  （`WAVE_STEEP_SIZE_REF/uSize` 反归一，且**乘在自交 clamp 之前**）；细节层跟随态：`water-shader.ts|detailFreqScale`。
- ⚠️ **元教训 —— 探针指标集选择性偏差**：探针 `scan()` 只统计垂直 `heightAt` 与**局部**无量纲 `jacobianAt`（随 size 自相似），
  水平位移 `horizAt` 只被法线标定借用、**从未进入尺寸域扫描的输出列** ⇒ 结论只覆盖「你恰好测了的那几维」。
  「size 全域指标不变」由此成立，缺陷由此漏网。**扫描的指标集本身要随结论的可推广范围一起审。**
- ⚠️ **元教训 —— 测试把缺陷侧锁成期望**：`water-capability.test.ts` 有「D2 浪高是用户量、与尺寸解耦：改 waterSize 不漂移 `uWaveHeight`」的用例——
  它把「振幅绝对米制」这个病侧直接写成不变量，于是修复前全绿、修复方向被测试挡在门外。**断言的是「现状」还是「应有」要分清。**

---

### P1-2 ｜ 浪高滑杆 85% 的行程是死区，且没有任何出口告诉用户

- **病症**：默认档 pool 预算 = `min(0.15, 0.3−0.15)` = 0.15，而 `waterWaveHeight.range = [0, 1]`
  ⇒ 滑杆 **0.15 → 1.00 整段（85%）对画面零影响**，面板仍照显用户拖到的 `1.00 m`。
  ADR-319 的收益是「拉到上限也不越壁」，代价是用户以为自己控制着一个 1 m 的量、实际可控区只有 15%。
- **触发**：pool 形态下拖浪高滑杆超出水位/池深预算。
- **现源码锚点**：`water-capability.ts|getEffectiveWaveHeight`（钳后生效值）；`water-menu.ts|buildWaterNodes` 的 wave-height 节点 `getHint`
  （显示钳后生效值，未钳制时返回空串以免与主值并列噪声）；动态 hint 通道 `menu/render/cap-controls.ts`。
- ⚠️ **元教训 —— 「钳制生效」≠「用户知情」**：测试注释 `cap.setWaveHeight(0.3); // 钳后 0.15` 只证明钳制在工作，
  对用户能否感知零分辨力。**静默钳制必须配出口（hint / 动态上界），否则 UI 显示值与生效值分叉。**

---

### P1-3 ｜ 三条「每帧计算、永不触发」的计算仍在，且被两条字符断言保护成假绿

- **病症**：ADR-319 D3 判词「每帧计算、永不触发不是实现，是债」，据此删掉泡沫通道，但同族还剩三条——
  ① `aa` 淡出恒为 1（D2 后 `waveLen/spacing = segments/(4·1.19^i)` 与 uSize 无关，`segments=64` 时六波最小 6.70 ≥ 6 ⇒ `smoothstep` 恒 1）；
  ② `steep` 的 clamp 恒等（schema `waterChoppiness.range=[0,1]` ⇒ 被钳值恒落在 [0, K] 内，上下界永不触及，想防的自交在域内本不会发生）。
- **触发**：无需触发——它们**永远不触发**。①要生效须把 `WATER_WAVE_SEGMENTS` 压到 ≤57，而 `water-state.ts` 注释把这条「保险」当活功能描述（「调小 = 抗锯齿提前介入」），**无守卫拦这条改动**。
- **现源码锚点**：`water-state.ts|WATER_WAVE_SEGMENTS`、`|WAVE_STEEP_SUM_LIMIT`（均已写成常量 + 数值判据：惰性说明 + 越界夹住的反证）；
  `water-shader.ts` 的 `aa` 与 `steep` 项；用例见 `water-capability.test.ts`「波场守卫的真实性」describe。
- ⚠️ **元教训 —— 假绿断言 / 测试名与断言合谋**：原两条用例名宣称「gerstner 按每波长顶点数淡出波幅」「aa 带 1‰ 下界」，
  断言却只是 `toContain(<整行源码字符串>)`——**对「aa 是否为 1」零分辨力**，把「不变」误当成了「正确」；
  ADR-319 D4 明文要求波形命题用数值断言、这两条正是钦点要淘汰的形态，却没被淘汰。
  **字符断言 ≈ 给源码拍快照：改注释/格式化会红，改语义反而可能绿。数值命题必须用数值断言（含域外反证）。**

---

### P1-4 ｜ 存量存档吃掉 D1 的默认抬升：老用户升级后浪仍然死平

- **病症**：`loadState` 旧兜底只覆盖「**没有** level 键的 pool 旧档」，而 ADR-257 之后、ADR-319 之前保存的存档
  **带当时的默认值 `waterLevel=0.01`**，经 `restoreBySchema` 的 `range [0,5]` 钳制原样恢复 ⇒ 预算 0.01 ⇒ 浪高被钳到 0.01
  ⇒ 升级前用户看到的「浪死平」原样保留。ADR-319 的观感收益只覆盖「新装 / 清过档」用户。
- **触发**：用 ADR-319 之前的存档启动（存量用户默认命中）。
- **现源码锚点**：`water-migrations.ts|WATER_SCHEMA_VERSION_KEY`（版本戳，不入 schema、不参与 `restoreBySchema`）、
  `|migrateLegacyWaterLevel`、`|LEGACY_DEFAULT_WATER_LEVEL`；消费点 `water-capability.ts|saveState` / `|loadState`。
- ⚠️ **元教训 —— 「默认值变更」是一次隐式迁移**：改默认值只惠及新档，存量档里**旧默认值已被写成显式值，无法与用户手改区分**。
  故改默认必须同轮立判据（版本戳 / 「值恰等于旧默认」启发式），否则收益静默折半。**凡改默认值，先问「存档里已经有它了怎么办」。**

---

### P2-1 ｜ 参数模型的跨字段耦合全是静默的（乘积双写 / 开关撒谎 / 无约束 / 无出口）

五条同族，合并：

1. ① **film 下「水膜浓度」与「不透明度」只有 1 个自由度**：两个 applier 都写同一乘积 `opacity·wetness` 到 `material.opacity` 与 `uBaseOpacity`
   ⇒ `(0.5, 0.5)` 与 `(0.25, 1.0)` 观感完全相同，**两个旋钮一个自由度**，用户无法判断该转哪根。
   现锚点：`water-state.ts|FILM_WETNESS_ALPHA_BASE`（film alpha 改由本值 × wetness 独占，刻意不读 `waterOpacity`）；
   `water-menu.ts` film 下隐藏 `waterOpacity`。
2. ② **`waterEnabled=true` + film `waterWetness=0` ⇒ 开关撒谎**：一级行 `headerToggle` 读 `envState.waterEnabled` **仍显示 ON**，场景里却没有水——
   与 fog / shadow / reflector 已收口的「master toggle 显示 ON 而对象恒不存在」是同族病；`audit-env-review.md` §5 的 S5-2 早已点名，此前长期未闭环。
   现锚点：`water-capability.ts` 可见性**单门**只认 `waterEnabled`；旗标 `wetnessGated` 改名 `waterScalesOpacity` 语义跟随，
   见 `water-body-strategies.ts|wetnessScalesOpacity`。
3. ③ **`waterLevel` × `waterPoolHeight` 无任何跨字段约束**：range 各自独立（level `[0,5]`、poolHeight `[0.01,5]`），
   pool 下 level > poolHeight ⇒ 水面浮在池壁之上，同时预算归零 ⇒ 浪高恒 0。
   现锚点：`water-menu.ts|buildWaterNodes` 的 water-level 节点 `getHint`（仅 pool 且超壁时提示超出量，未超出返回空串）。
4. ④ **水面贴地**：level 可拖到 0，而地面承接面在 `y = 0.005` ⇒ 低于 5 mm 的水膜与地面 z-fighting
   （ADR-319 修复前的 s1 截图正是这个画面，当时来自默认值；现在它变成用户可选项）。
   现锚点：`scene-capability.ts|GROUND_LAYER_OFFSETS`（层间序关系仍靠人肉登记，见 `audit-ground-review.md` 第 4 项）。
5. ⑤ **未启用态不一致（❌ 未修）**：`waterEnabled` 关闭时二级面板参数仍全量可见可调（`env.ts|envCapSubNodes` 只剔除 master 节点），
   而同一棵树里 reflect 组四从控会随主开消失（`water-menu.ts|buildWaterNodes` 的 reflect 组 `visibleWhen`）——**两套口径**，
   用户会以为关掉水面后参数仍在起作用。**此项源码未动，仍是活挂账**（文首处置状态表已订正为「11 条已修 + 1 条未修」）。
- ⚠️ **元教训 —— 「两个参数是否重叠」有可操作判据**：问「能否构造两组不同取值而画面完全一致」（`(0.5,0.5)` vs `(0.25,1.0)` 即实锤）。
- ⚠️ **元教训 —— 改默认值会让老断言变成恒真**：旧用例「film wetness=0 → 不可见」在 `waterEnabled` 默认 false 下**恒真**（水面从未开过）。
  **改默认值时须回扫本 cap 全部断言**，否则一批「假绿」静默诞生。

---

### P2-2 ｜ 三处 `strategy.id === "pool"` 绕过自家策略表的自述纪律

- **病症**：`water-params.ts` 自述「形态门控（wetnessGated / supportsVolumeOptics / 空 targets 数组）一律查 strategy，不写 mode 分支」，
  同文件却有三处按 `strategy.id === "pool"` 现判。「波峰不越壁」是形态**能力**，用 id 字符串现判后，
  新增形态（ocean / 大水面）时 `id === "pool"` 为 false ⇒ **静默按 film 处理（无上钳），浪漫过容器而编译器一言不发**。
- **触发**：注册一个非 pool 的新水面形态（无需改任何既有代码，缺陷自动生效）。
- **现源码锚点**：`water-body-strategies.ts|WaterBodyStrategy.hasWallCeiling`（与既有三旗标并列）、
  `|WaterBuildContext.buildMaterial`（`{ forPool, hasWallCeiling }` 两维刻意不合并）；消费点 `water-params.ts|effectiveWaveHeight(hasWallCeiling)`、
  `water-shader.ts` 波高上钳。守卫 = 旗标断言 + **源码扫描闸**（水源码文本内不得出现按 id 现判 pool 的模式）。
- ⚠️ **元教训 —— 能力用旗标、不用身份用字符串**：`id` 是身份（新增成员即失效），`hasWallCeiling` 是能力（契约，编译器强制每个新形态表态）。
  **凡「按类型名 if/else」处，问一句「这个判据会不会被下个新成员静默绕过」。**

---

### P2-3 ｜ 倒影的成本计价与门控双失配

- **病症**：① 倒影 RT 未计价三项成本——`ensureReflector` 只传 `clipBias / textureWidth / textureHeight`，
  而 three 上游 Reflector 默认 `multisample = 4` + `HalfFloatType`（2048 档 ≈ 134 MB），schema 注释却只按「分辨率档位」说明成本；
  ② 强度归零仍付整场重渲——`reflectionActive` 只看开关 / SSR / 宿主、**不看 `waterReflectionStrength`**，而 shader 侧强度为 0 时整块跳过。
- **触发**：① 开倒影即命中；② 把倒影强度拖到 0（用户以为已关，仍每帧整场重渲染）。
- **现源码锚点**：`water-reflect.ts|ensureReflector`（显式 `multisample: 0`）、`|reflectionActive`（`strength <= 0` 即 return false，拉回无需重建）；
  schema 注释 `env-state-schema.ts` 已同步为「0 = 关混合**且停渲**」。
- ⚠️ **元教训 —— 上游默认值是隐式成本**：只显式传自己关心的参数，等于把上游的默认值（4× MSAA）当免费。
  **凡是「新建上游对象只传部分参数」，要清点未传参数的默认值代价**；**门控条件要与消费侧的真实用度一致**（消费侧跳过 ≠ 生产成本归零）。

---

### P2-4 ｜ 量具是 shader 的「平行手抄实现」——它的数据正在为决策背书

- **病症**：探针自述「用 JS 逐式复刻注入的 `gerstner()`」，手抄了 `freq / amp / aa / wa / steep` 全部表达式，
  与 shader 模板串是**两份独立副本**：**shader 改了而探针忘记同步，探针就会用旧公式为「新 shader 是对的」出具数据背书**。
  现有一致性手段只有「标定」（解析法线 vs 几何法线夹角），能感知部分漂移，不是公式同源守卫；
  而 ADR-319 与知识卡都在引用探针读数（「尺度无关性由数据背书，不是推理」）。**P1-1 正是这条风险的实例**。
- **触发**：改 shader 波场表达式而不同步探针（无需任何人犯错，纯粹靠自觉）。
- **现源码锚点**：`water-state.ts|WAVE_DEGENERATE_WA` / `|WAVE_STEEP_SIZE_REF` / `|WAVE_STEEP_SUM_LIMIT`（常量单一事实源，
  shader 注入串内插、探针同门）；`probe-water-wave.ts|buildWaves`（同门注释）；契约测试「常量同值 + 表达式指纹成对核查」（配 `replaceAll` 篡改反证）。
- ⚠️ **元教训 —— 双份实现是「平行手抄」**：同一协议只保留一份实现；若不得不两份，须有**公式同源守卫**（常量表生成 + 表达式指纹双向对账），
  而不是靠「看完记得同步」。**量具本身也要有回归测试，否则它是权威的假象。**

---

### P2-5 ｜ 文档 / 注释 drift

1. ① **注入检测已修、两处文档仍写「待议」**：`docs/knowledge/water.md` 与 `ADR-319 §4` 记载「只查 5 个符号……begin_vertex 位移注入无锚点……`fragOk` 查的 `uRoundness`」；
   而 `water-capability.ts` 现为**六锚点**（`dispOk` 查 `transformed.z += gdisp.z;`、`fragOk` 查 `uniform sampler2D uReflTex;`）。
   现源码锚点：`water-capability.ts` 六锚点巡检块。
   ⚠️ **元教训 —— 文档滞后会把下轮读者引向已修好的东西**（`git log -S` 已能一眼证实修复时刻），
   而**修复编号写进源码注释**是低成本的对账锚点。
2. ② **默认值注释过期**：`scene-capability.ts|GROUND_LAYER_OFFSETS` 注释仍写「`envState.waterLevel`（默认同为 0.01）」，schema 默认早已是 0.15。
3. ③ **兼容层退役时钟无守卫（❌ 未修）**：知识卡宣布旧别名表「只减不增、不得新增别名」并有退役判定，
   而 `water-capability.ts|loadState` 的别名表**零守卫零测试**——加别名不会红，时钟无人执行。**此项源码未动，仍是活挂账。**
4. ④ ⚠️ **假不变量**（与 P0-1 同源）：两处「1‰ 下界保 `wa` 恒 > 0」的注释与知识卡表述，**为一条不成立的守卫背书**——
   现已订正为「1‰ 下界只保证 `aa` 非零，不保证 `wa > 0`，除零防线是退化门」（见 `water-state.ts|WAVE_AA_MIN_VERTS` 注）。
   **教训：自称的守卫要在被它保护的那条式子旁写清「它保护的不是这个」。**

---

### P3-1 ｜ `transmissionRenderTarget` 死代码 + 一条自证式测试

- **病症**：`disposeWater` 逐材质读 `asPhysical?.transmissionRenderTarget` 并释放，而 three 0.186.1 的 `MeshPhysicalMaterial`
  **没有这个属性**（上游 grep 零命中）；真实 transmission RT 住在 renderer 侧、由 renderer 按相机持有与清理
  ⇒ 生产路径该分支**永不触发**。风险不在泄漏（renderer 管着），而在**注释与测试共同制造「我们已具名管理 transmission RT」的错觉**。
- **触发**：永不触发（死代码）。危险点在「读者与修改者会以为这里有契约」。
- **现源码锚点**：该分支与对应用例**均已删**，`water-capability.ts` 原处留说明性注释。
- ⚠️ **元教训 —— 自证式测试**：原用例手工 `mat.transmissionRenderTarget = {…}` 再断言它被释放——
  **测试自己伪造输入、实现读输入、测试断言输出**，与被测的真实世界无关，却把覆盖率与信心一并买走。
  **测试的输入必须来自真实生产路径（或显式声明为桩），否则它只证明「实现读得懂自己造的假数据」。**

---

### P3-2 ｜ 倒影释放注释不实 + `camera.updateMatrixWorld()` 的时序理由不成立

- **病症**：① 注释承诺「弃倒影载体（RT + 材质 + 几何具名释放）」，实现只 `state.reflector?.dispose()`，
  而 three 上游 Reflector 只释放 `renderTarget` 与 `material`、**不释放构造期传入的 `PlaneGeometry`**（每次重建新建）
  ——「注释承诺 > 实现」是本仓最重视的一类漂移；
  ② `renderReflection` 里的 `camera.updateMatrixWorld()` 注释称「不刷新则镜像滞后一帧抖动」，但倒影渲染发生在
  `c.update?.(dt)` 处，**早于**同帧的 WASD 相机输入与 perFrame 回调 ⇒ 此刻相机里本就是上一帧的状态，
  刷新矩阵改变不了「倒影相机比主渲染晚一帧输入」这一事实：**注释宣称的收益不存在**（每帧多一次矩阵合成，无害但无用）。
- **触发**：无（静态漂移）。风险是下一位读者按注释去「保持」一个不存在的时序契约。
- **现源码锚点**：`water-reflect.ts|disposeReflector`（补 `geometry?.dispose()`，注释订正为实际释放物）；
  时序项若要真消除一帧滞后，需把 RT 渲染移到相机输入之后（结构性调整，另议）。
- ⚠️ **元教训 —— 注释里的「为什么」必须可验证**：时序类注释尤其易腐——写下理由时要连带写下**它依赖的调用顺序**，
  否则调用顺序一变，注释就从「解释」变成「障眼」。**先证伪注释的因果，再决定是否保留那行代码。**

---

## 三、被驳回 / 修正的两条（子代理断言，主模型复算推翻）

| 断言 | 出处 | 仲裁 |
|---|---|---|
| 「微细节法线在大水面会屏幕空间走样/闪烁」 | 本轮主模型初判（渲染视角子代理**证伪**） | **降级**：最高空间频率 2×1.6 = 3.2 rad·m⁻¹ ⇒ λ≈2 m；1080p/fov45° 下像素足迹过 1 m 需 ≈1.4 km 机位 ⇒ 近观/俯视下走样不成立。**保留**「与主谱尺度基准分裂」的语义断裂（已并入 P1-1）；掠射远处的足迹拉伸本轮未实证，记为待验证。 |
| 「`gerstner()` 每顶点算两次是纯浪费」 | 知识卡 pitfall + ADR-319 §4 遗留② | **维持原判但降级**：确为两次调用（`water-capability.ts` 与 `:293`，形参 `gWaveNormalUnused` 自证），可合成一次；但两条 chunk 之间无 chunk 改 `position` 的前提需在升级 three 时重验，故仍按「非阻塞、升级时一并议」处理。 |

---

## 四、旧项对账（不重复报，只核闭环）

| 旧项 | 位置 | 本轮核验 |
|---|---|---|
| S5-1 空 folder 死头 / S6-4 W-1 | `audit-env-review.md` §5/§6 | **已闭环**：`render.ts`、`253-256` 渲染前按 visibleWhen 预筛，「全隐组不留空卡壳」 |
| S5-2 wetness=0 水面消失、用户以为坏 | §5 | **未闭环**，已升级为 P2-1②（「开关撒谎」同族） |
| S5-3 波纹组单控件独占一组 | §5 | **已闭环**：现为 wave-speed + wave-height 两控件 |
| W-3 分派表键集与 schema 不同步 | §6 | **已闭环**：`water-capability.test.ts` |
| W-5 注入守卫只检 4 符号 | §6 | **已闭环**（现 6 锚点），但文档滞后 ⇒ P2-5① |
| W-2 transmissionRenderTarget 手动释放时序 | §6 | **仲裁为新发现**：该属性在 r186 材质上不存在 ⇒ 死代码（P3-1） |
| 圆角裁剪假设水面恒在原点 | 知识卡 | 已有测试钉子（`water-capability.test.ts`）；仍属「未来移动水面即静默裁隐形」的钝刀，维持登记 |

---

## 五、审计方法与边界声明

> 原「建议处置顺序」表已失效（七项全部处置完毕）故删除；原「§六 本轮取证记录」的过程明细一并归并至此。
> **编号说明**：§六 编号保留空缺——下文 §七/§八/§九 的原编号**不可改**，
> `ADR-322` 以「九章第⑤条」硬引用 §九 的账⑤。

- **源码通读**：`water-{capability,params,reflect,body-strategies,menu,state,shader,migrations}.ts`；
  抽查消费面 `env.ts`、`render.ts`、`scene-capability.ts`、`infra/render-host.ts`、`env-state-schema.ts`。
- **子代理**：两路独立只读审计（渲染正确性/性能、参数模型/交互语义），最强断言由主模型逐条抽查，
  **驳回 1 条、维持降级 1 条**（见 §三）。
- **上游取证**：`three@0.186.1` 的 `Reflector.js`（multisample 默认 4 / HalfFloatType / dispose 实释物）、
  `RenderTarget.js`（`setSize` 内部 `this.dispose()`）、`WebGLRenderer.js`（transmission RT 真身位置）。
- **量具复跑**：`node scripts/probe-water-wave.ts --json`（P1-3① 实测依据）。
- **独立复算**：① P1-1 同款公式扫一周期的最大世界水平位移；② P0-1 同款表达式在 `wa = 0` 时
  `steep = Infinity` / `disp.x = NaN`（IEEE 754）。
- **时间线**：`git log -S` 定位 `dispOk` / `uReflTex` 两符号的引入提交（P2-5① 漂移依据）。

**⚠️ 边界（不可外推）**：本轮**未跑** `pre-push-gate` / `vitest` / `vite build` / `typecheck`；
P0-1 的 GPU 实际行为**未做真机/e2e 实证**（GLSL ES 对除零未定义，主流实现按 IEEE 给 ±Inf）。
测试面判断来自通读用例名与正文，非执行结果。**以上均不可外推为「水面无风险」。**

---

## 七、横向外推：同族病复发清单（第二轮，2026-10-04 晚）

方法：把本报告 12 条提炼成「病症模式清单」，派独立子代理逐 cap 扫描。**发现 8 处同族复发**（含 1 处 P1），
全部附源码证据、可复核；本清单即下一轮工作队列。

| # | 子系统 | 病症模式 | 证据 | 判定 | 状态 |
|---|---|---|---|---|---|
| X-1 | render-mode | **部分撤销只还原第一个材质**：`coveredProps` 是全局 `Set<属性名>`，首个材质 `delete` 后其余材质 `has()` 为 false ⇒ 多 mesh 时残留覆盖（开线框 + X 光后关线框，只有一个 mesh 回退） | `render-mode-capability.ts` / `:140-143` | **P1（画面直接错）** | **已修**：账本改按 `uuid:key` 记账 + 两条多材质用例 |
| X-2 | fog | `fogNear`×`fogFar` 无跨字段约束 ⇒ near > far 落入 GLSL `smoothstep(edge0 ≥ edge1)` 未定义域，且无测试覆盖 | `env-state-schema.ts` / `fog-capability.ts` | P2 | **已修**：消费点 `normalizeFogRange`（far ≥ near+1）+ 两条用例；**「显示值 ≠ 生效值」的 far 滑杆 hint 出口登记未接**（免与并行会话在改的 3 个 locale 文件冲突） |
| X-3 | light | 环境光 ×0.5 让位判据读 sky **自宣退役**的 `skyEnvironment`（真供图者已是 `envSource`）⇒ IBL 在场却不让位（双间接光过亮）；ambient 滑杆无 hint 出口 | `light-capability.ts` vs `sky-capability.ts`、`light-controls.ts` | P2 | **已修**：判据换成**真供图者** `envCap.isEnabled()`（js `scene.environment` 唯一写者，与 D10 路由器同源）；**并补 `env.setEnabled` → `light.refreshAmbientFromSky` 通知**（判据换源后必需，否则翻转 env 漏刷）；双向用例（在场 ×0.5 / 缺席 ×1）。默认态行为不变（仅修 `skyEnvironment=false + env 启用` 的分裂组合）。**ambient 滑杆 hint 出口仍登记未接** |
| X-4 | sky | `skyElevation`/`skyAzimuth` 幽灵键：构造读入 → `apply()` 内 `syncSunFromTime()` 覆盖，且 `saveState` 不落 / `loadState` 不恢复 ⇒ `setSun()` 效果活不过一次 apply | `sky-capability.ts` | P2 | **已修（删）**：查实「无 UI ∧ 不持久化 ∧ 唯一写者 `setSun` 生产零消费者 ∧ apply 每次覆盖」⇒ 删两键 + `setSun` + 三个死分支，构造初值改走 `syncSunFromTime()`；曲线覆盖由新建 `sun-beams.test.ts` **直接**承担。副产物：原有一条测试的绿**依赖幽灵键默认值 10**（巧合），已按组合根真实时序补 `apply()` |
| X-5 | shadow | 四档白名单只装在 `setMapSize`，`loadState` 恢复侧裸奔且 schema 无 `range` ⇒ 脏档值原样进 `mapSize.set()`，脱离 UI 可达域 | `shadow-capability.ts` vs `:522`、`env-state-schema.ts` | P2 | **已修**：白名单抽成唯一守卫 `normalizeShadowMapSize`，setter 与恢复侧共用（各自 source 语义保留）+ 脏档恢复用例 |
| X-6 | 跨 cap | 未启用态口径不统一：pp 有 `disabledWhenOff`（20 处子控件灰化 + title），fog / shadow / reflector 三个 menu **零 `disabled:`** | `postprocessing-menu.ts` | P2 | **已收口（方案 C：立判据，不机械对齐）**：查证发现两处**真缺陷**藏在"口径不统一"之下——pp/shadow **都缺 `subscribe→menu.refresh` 链**，而 `disabled` 是渲染期求值 ⇒ 灰化态滞后（pp 的 20 处一直如此）；故：① 两 cap 各补 `listenerSet+subscribe+notify`（`ppEnabled`/`shadowEnabled` 翻转触发）+ 两条用例；② 判据入知识卡 `preview-menu-settings-state.md`——按「**关态是否 no-op**」三分（真 no-op ⇒ 灰化 / 模式不适用 ⇒ `visibleWhen` / **关态仍可预置 ⇒ 不灰化**，机械对齐会剥夺「先调后开」） |
| X-7 | sun-beams | 恒真守卫（同本报告 P1-3②）：过门后 `(20-e)/20 ∈ (0, 0.99995)`，`min/max` 两极永不触及 | `sun-beams.ts` | P3 | **已修**：角度窗口/容差抽常量 + 注释改事实（纵深防御）+ 新建 `sun-beams.test.ts` 数值判据（域内恒等 + 门外反证） |
| X-8 | ground / reflector | 零散：ground 私有 `enabled` 与 schema 键双门（旧档 `enabled=false` 时面板 ON 而地面不出现，待验证）；reflector 注入返回值被丢弃、锚点失配仅 warn 而参数照写 | `ground-capability.ts`；`reflector-capability.ts` | P3 | **reflector 已修**：接收注入结果，失配时不写 `uOpacity`（不再造「参数已设、渲染无 effect」的假象）。**ground 项驳回（主模型查证）**：私有门**无生产写口**（env master 绑 schema 键 `groundVisible`；场景组根视图 `panelNodeToRow` 只覆盖 camera/lighting/shadow/postproc）、`ground-migrations.ts` 不写它、且 `ground-capability.ts` 注释已**显式挂账**「真根治（enabled 收编 schema 键）另立 ADR」——属已知挂账，非新发现 |

**未发现同族病**（A/B/C 三类已扫）：postprocessing、environment、render-mode-menu、sky-menu、fog-menu、
shadow-menu、light-controls/light-params、ground-menu/ground-surface-spec。

**子代理建议的前三优先级**：X-1（唯一画面错）→ X-2（两行 + 一条测试）→ X-3（判据一行 + 复用新 hint 通道）。

## 八、第二轮回归审计（水面自身）与处置

要点：**本轮五提交的改动自身带出 3 条新问题**（film 耦合未摘净 / 可见性单门解锁倒影重渲 / 迁移判据用 `===`），
主模型复核后**全部已修**；1 条已由主模型自查收窄（slider 静态 `hintKey` 转「登记未接」）；
1 条属语义权衡，**登记 + 量具化**（尖度轴 Σσk ∝ 1/size，探针新增「Σσk 域宽扫描」行）。
子代理同时**证伪 4 项**（跳变量级突变、版本戳污染 cap、`samples === 0` 恒真、i18n 时机），
并确认 `level` 旧别名会绕过迁移但属良性（别名期无 0.01 默认值）。详见文首「第二轮锐评（增量）」段。

## 九、第三轮锐评（五笔账）与处置（2026-10-04 夜）

要点：主模型对第二轮后的现行源码再读一轮，**又发现 5 条未处置项（五笔账）**——其中 3 条是既往
「修复方向已写明、配套未落地」的挂账（P1-1 配套句 / P2-3 方向② / P2-1③ S5-2），2 条为本轮新锐评
（clarity 无条件重编、失败哲学不对称无文档）。用户「简单回顾提交历史后寻找解决方案吧」授权处置，
**五笔账全部落地**（提交 `20ec2906c`），并带出一条 three 源码语义的**重要订正**（needsUpdate 无 getter、
transmission setter 自带跨界 version++，见账④）。

### 五笔账清单与修复

| # | 病症 | 证据（现状） | 归类 | 修复 |
|---|---|---|---|---|
| ① | 微细节沟槽频率**恒世界米制**，未按 sizeRef/uSize 归一——与主谱 D2（λ ∝ uSize）尺度基准分裂 | `water-capability.ts` fragment 细节块：`0.08 * cos(dot(dp, dd1) * 0.8)` 等三组频率参数 0.8/1.1/1.6 固定（λ 恒 3.9–7.9 m）；`git -S "0.08 * cos"` 仅命中 ADR-271 引入提交，从未归一 | P1-1 配套句 192 未落地 | **已修**：乘 `detailFreqScale = WAVE_STEEP_SIZE_REF / max(uHalfSize*2, 0.001)`（fragment 无 uSize 声明，经 uHalfSize=uSize/2 推导；`WAVE_STEEP_SIZE_REF` 内插自 `water-state.ts`，80m 基准档因子 = 1 观感零变化，与主谱反归一同一纪律）；dh1/dh2/dh3 与 dhdx/dhdz 偏导系数同乘（梯度与相位同谱防裂缝） |
| ② | `reflectionActive` 无 `strength > 0` 门：strength=0 时 uReflStrength 混合块跳过、RT 无人消费，却每帧仍付**整场重渲** | `water-reflect.ts`；`git -S "strength > 0" -- water-reflect.ts` 零输出；schema 注释自认「0 等于关混合但保留 RT」 | P2-3 修复方向②未实施 | **已修**：`if (envState.waterReflectionStrength <= 0) return false;`（全透明门之前插入）——归零即停渲 RT，拉回即恢复无需重建；schema 注释同步为「0 = 关混合 **且停渲**」 |
| ③ | pool 下 `level > poolHeight` 无约束、无 hint：预算归零 + 水面浮池壁，water-level 滑杆无 getHint（测试 2293 反把归零锁成期望） | `water-menu.ts`；`effectiveWaveHeight` 预算 = `min(waveHeight, max(0, poolHeight-level))` 归零 | P2-1③ / S5-2 未闭环 | **已修**：water-level 滑杆补 getHint——仅 pool 且 `level > wall` 时返回「水位超出池壁 {v} m」（`t("preview.waterLevelAboveWall")`，新增三语 locale key）；未超出返回 ""（沿 wave-height 纪律：只在钳制时提示，不打扰）；film 无上钳不受约束 |
| ④ | `waterClarity` applier 每次变更**无条件** `mat.needsUpdate = true`：surface+wallInner 两材质每 tick（滑杆 step 0.05 拖一发一次）整段重编 program | `water-params.ts` waterClarity applier；与同表 waterNormalStrength「无贴图重算、无 needsUpdate」自夸矛盾 | 本轮新锐评 | **已修（比预期更本质）**：查 three 0.186.1 源码——`Material.needsUpdate` 是**只有 setter（`if (value === true) this.version++`）无 getter** 的访问器（读恒 undefined，故测试不能读 needsUpdate 值，须读 `material.version`）；而 `MeshPhysicalMaterial.transmission` **setter 已自带跨界 version++**（`if (this._transmission > 0 !== value > 0) this.version++;`，仅 0↔非0 翻转 USE_TRANSMISSION define 时重编）——**纯透传赋值即得条件化语义，手动 needsUpdate 是重复劳动**（跨界时会与 setter 各 ++ 一次，实测 received 5 vs expected 4）。故删掉手动置位，只留 `mat.transmission = next` |
| ⑤ | 失败哲学不对称无文档：REVISION 断言失配 **throw**（cap 缺席）vs 六锚点注入失配仅 **warn** 保现场——代价不同，处理强度随之不同，但未成文 | `water-capability.ts+`（assertRevisionRange）vs `:414+`（六锚点巡检 warn） | 本轮新锐评 | **已修（文档化，不统一）**：REVISION 断言前补注释块——REVISION 失配=前提崩塌（chunk 结构未知、注入串全可能错位，warn+兜底=无法归因的坏画面）→ throw → cap 缺失显式可发现；六锚点失配=局部漂移（仅个别 chunk 标记动了，水面退化仍可用）→ warn 保现场供诊断。两失败模式代价不同故处理强度不同，勿「统一」 |

**配套测试**（`water-capability.test.ts` 132 → **140 例**）：
- 账①：微细节三组 cos 断言改为含 `* detailFreqScale)` 闭口 + 新增 dh1/dh2/dh3 偏导系数三段断言（`* dd1.x * 0.8 * detailFreqScale` 等）；
- 账②：strength=0 门用例——`waterReflectionEnabled(true)` 后 `update` 驱动 renderReflection 计数 0→1，`setWaterReflectionStrength(0)` 后 update 不再渲、拉回 0.9 恢复，uReflStrength uniform=0.9；
- 账③：getHint 用例——film → ""、pool 默认 0.15<0.3 → ""、setLevel(0.5) → 含 "0.20"、setLevel(0.3)（贴壁）→ ""；
- 账④：setClarity version 快照用例——0.6→0.8 非零区间 version 不变、0.8→0 跨界 +1、0→0.3 再跨界 +1、0.3→0.4 回归不变（**对齐 `sky-capability.test.ts` 既有纪律**：three needsUpdate 无 getter，用 version 观察重编触发）。

**验证**：`water-capability.test.ts` **140 例全绿**（含新增 8 例）；caps 全部 29 测试文件 1115 例全绿；
`vite build` ✓（先跑 `node scripts/generate-locale-json.ts` 同步三语 JSON）；`npm run typecheck` 零错误；
`biome check` ✓；探针复跑无回归（水平位移峰值 0.650、Σσk=0.400、越壁穿地 0%、六波全在窗口）。
提交 `20ec2906c`（12 文件 +121/−13，含 schema 注释、locale 三语 ts+json）。
