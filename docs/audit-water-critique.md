# 水面系统锐评（2026-10-04）

> **审计对象**：3D 预览「水面（water）」能力簇——`frontend/src/preview-3d/caps/water-{capability,params,reflect,body-strategies,menu,state}.ts`
> ＋ `state/env-state-schema.ts` 的 water 组 ＋ 量具 `scripts/probe-water-wave.ts` ＋ 知识卡 `docs/knowledge/water.md`。
> **方法**：主模型亲自通读全部 6 个源文件；另派**两路子代理独立只读审计**（渲染正确性/性能视角、参数模型/交互语义视角），
> 主模型对两路报告的最强断言逐条实地抽查（本轮**驳回/修正 2 条**，见 §三）；上游事实读 three 0.186.1 源码逐字取证
> （`examples/jsm/objects/Reflector.js`、`src/core/RenderTarget.js`、`src/renderers/WebGLRenderer.js`）；
> 数值命题复跑探针（`node scripts/probe-water-wave.ts --json`）＋ 两段独立复算。对外可见结论一律给「文件:行号 + 原文片段」。
> **与既有文档的关系**：ADR-255 / 257 / 271 / 272 / 283 / 286 / 297 / 319 已解决前几轮大病；
> `docs/audit-env-review.md` §5/§6 的 S5-x / W-x 与本报告**不重复**，只在「§四 旧项对账」逐条复核闭环状态。
> **时效**：结论以 2026-10-04 的源码树为准（HEAD `7214b629c`）。
> **覆盖口径（必须声明）**：本轮**未跑** `pre-push-gate` / `vitest` / `vite build` / `typecheck`，只做静态通读 + 探针复跑 + 独立复算；
> 结论限定在「读到的机制」层面，**不可外推为「水面无风险」**。测试面判断来自通读用例名与关键用例正文，不是执行结果。
>
> **实施状态（2026-10-04 同日处置，用户「尝试吧」授权的最小组合）**：
> **P0-1 已修**——`water-state.ts|WAVE_DEGENERATE_WA`（单一事实源）+ shader 波场退化门（`if (wa <= …) { continue; }`）
> + 探针 `buildWaves` 与处方档同门 + `scan` 空波守卫。探针实测：`--amp 0` / `--level 0` 从 NaN 变为
> 「峰谷差 0.000 m、标定 0.000°」= 平面水 + 正确法线（静水态真正可达）。
> **P1-3 已修**——三条恒真守卫转数值断言：aa 惰性自证（segments=64 时六波 λ/spacing 最小 6.70 ≥ 6）、
> 「通道不是死代码」反证（segments=32 时 aa < 1、边界恰在 57/58 之间）、Σσk 域内恒等/域外夹住（choppiness=2）；
> 两条 `toContain` 字符断言被数值用例取代。
> **P2-5 已修**——知识卡两条陷阱订正（注入检测六锚点已修、1‰ 下界假不变量）+ 新增退化门陷阱与
> 「守卫得是真守卫」不变量 + `scene-capability.ts` 默认值注释（0.01 → 0.15）+ ADR-319 遗留项归口指针。
> **本轮验证**：`water-capability.test.ts` **123 例全绿**（含新增 5 例）；`vite build` 通过；
> `check-biome --files`（4 个前端文件）通过；`probe-water-wave.ts` 默认档无回归；e2e 新增 S7 静水端点场景
> （`water-wave-evidence.spec.ts`；**本机未跑通**——`page.waitForLoadState("networkidle")` 60s 超时，
> 既有六场景用例同因失败（`webServer` 能起、页面 load 事件已触发，但 networkidle 不达成），
> 属环境/既有 spec 敏感点，**非本轮改动**；截图未进仓）。⚠️ **全量 `typecheck` 与 `scripts/tsc` 当前各报 2 条错误，均属并行会话的在途改动，
> 与本轮无关**：`frontend/src/preview-3d/adapters/ysm-adapter.ts`（临时诊断块 `t.image?.naturalWidth`，标注「诊断后删除」）、
> `scripts/check-adr-health.ts` / `scripts/new-adr.ts`（ADR 归档迁移在途）；**本轮改动的 5 个文件在两处 tsc 输出里均零错误**。
> **P1-1 已修（第二轮，用户「继续」授权）**——`steep` 在自交 clamp 之前乘基准反归一
> `water-state.ts|WAVE_STEEP_SIZE_REF/uSize`（基准 = schema `waterSize` 默认 80，同值守卫在测试内）。
> 探针 ④ 段域宽扫描：修复前水平摆动 ∝ size（10→300 差约 30 倍），修复后 `size ≥ 80` 六档恒 **0.650 m**、
> `size ≤ 40` 递减（自交上界接管 = 物理约束，非公式漂移）；默认档观感零变化。
> **探针补齐「最大水平位移」指标**（原先这一维不进输出列，正是 P1-1 漏网的原因），并新增
> 「探针与源码同源核查」用例（P2-4 的机器守卫：探针手抄的五个共享常量与 `water-state.ts` 字面一致，改一侧忘另一侧即红）。
> **P1-4 已修**——新增 `caps/water-migrations.ts`（纯函数，范式对齐 `environment-migrations.ts`）+
> 存档版本戳 `WATER_SCHEMA_VERSION_KEY`：只有「无版本戳 ∧ 水位严格等于旧默认 0.01」才迁到现默认；
> 带戳新档永不迁移（0.01 往返恒等）。
> **本轮验证（第二轮）**：`water-capability.test.ts` **132 例全绿**（P1-1 / P1-4 / 同源核查共新增 9 例）；
> `vite build` ✓；`npm run typecheck` **零错误**；`check-biome --files` ✓；`doctor --docs` **22/22 PASS**；
> 探针默认档无回归（aa 全 1、峰谷差 0.116）、`--amp 0` 全 0（无 NaN）。
> **P2-2 / P3-1 / P3-2 已修（第三轮，用户「继续」授权清内部项）**——
> **P2-2**：`WaterBodyStrategy` 新增 `hasWallCeiling` 能力旗标（与 `wetnessGated` / `supportsVolumeOptics` /
> `supportsRoundness` 并列），三处按形态 id 现判与构造期 `forPool` 兼职全部收编；`buildMaterial` 的
> `{ forPool, hasWallCeiling }` 两维刻意不合并（未来 ocean 可能「有体积光学但无壁」）；守卫 = 旗标断言 +
> **源码扫描闸**（水源码内不得出现按 id 现判 pool 的模式——注释里写该字面量也会被闸住）。
> **P3-1**：删 `disposeWater` 里读 `material.transmissionRenderTarget` 的死分支（r186 该属性不存在，
> 真身在 renderer 侧 `renderState.state.transmissionRenderTarget[camera.id]`）**及其自证式测试**
> （原用例自己伪造字段、再断言被释放）。
> **P3-2**：`disposeReflector` 补几何具名释放（官方 `Reflector.dispose()` 只放 RT + 材质）、
> `camera.updateMatrixWorld()` 的「防镜像滞后一帧」注释订正为事实（该行只保证矩阵不落后于属性，
> 消除不了跨帧输入滞后——那需要把 RT 渲染移到相机输入之后）。
> **本轮验证（第三轮）**：`water-capability.test.ts` **132 例全绿**（条数不变：删 1 条自证式用例、
> 加 1 条源码扫描闸，另在两条既有用例内补断言）；`npm run typecheck` **零错误**；`check-biome --files` ✓。
> **P2-4 已深化（第四轮）**：同源守卫从「常量字面」推进到「**表达式指纹**成对核查」——D2 锚点
> （`pow(1.19, fi)·4/sizeSafe` ↔ `(TWO_PI·1.19**i·4)/sizeSafe`）、D1 振幅分配（`0.26·pow(0.82,fi)` ↔
> `0.26·0.82**i`）、P1-1 反归一、ADR-257 §6.4 的「位移 /sizeSafe ↔ 法线 ×sizeSafe」成对换算，共四组
> 指纹逐对断言；并配**反证**（`replaceAll` 篡改数字即失配）自证指纹不是恒真断言。
> **P1-2 / P2-1 / P2-3 已修（第五轮，用户「修吧」授权）**——
> **P1-2**：给 slider 臂补 **hint 槽位**（动态 `getHint` 优先、静态 `hintKey` 回退，与 toggle/button 同范式；
> `getHint` 由 button 专属提升为通用通道），浪高滑杆即时显示**钳后实际生效值**（如「实际生效 0.15 m」）。
> 实现时撞到并修掉一个真坑：`onChange` 里 `updateDisplay` **早于** `setValue`，而 hint 读 cap 状态 ⇒ 只在其
> 中刷会**滞后一步**，故在 `setValue` 之后补 `refreshHint()`（numeric 路径同）。顺带让 light-controls 等
> 既有的 slider `hintKey`（原先无渲染出口的死字段）复活。
> **P2-1**：可见性收归**单门** `waterEnabled`（原实现与 film 的 `wetness > 0` 相与 ⇒ master 开关在 wetness=0
> 时撒谎）；film 下 **`waterOpacity` 滑杆隐藏**（该形态的「水膜多明显」由 wetness/浓度独占）⇒ 一形态一旋钮，
> 消「两旋钮一个自由度」；旗标 `wetnessGated` → **`wetnessScalesOpacity`**（命名诚实化）。过程中又抓到一条
> **假绿断言**：旧用例「film wetness=0 → 不可见」在 `waterEnabled` 默认 false 下**恒真**（从未开水），
> 已改为显式开水 + 断言「可见 + alpha 0」。
> **P2-3**：`ensureReflector` 显式 `multisample: 0`（three 上游默认 4×）——实付显存降到 1/4
> （512 档 ≈ 2 MB、2048 档 ≈ 33 MB），行为断言 = `getRenderTarget().samples === 0`；schema 与知识卡同步标价。
> **本轮验证（第五轮）**：`src/preview-3d` + `src/locales` **165 文件 / 3070 用例全绿**；
> `npm run typecheck` 零错误；`check-biome` ✓。
> **至此 12 条全部处置完毕**（P0-1 / P1-1..4 / P2-1..5 / P3-1..2）；唯一保留登记的是「`gerstner()` 每顶点算两次」
> （非阻塞，升级 three 时一并议）。

---

## 一、总判

**骨架健康，且是仓内文档化程度最高的子系统之一；本轮读出的是「端点」与「自我验证闭环」两处的漏洞。**

正面证据（本轮实地核验，非转述）：

| 维度 | 结论 | 取证 |
|---|---|---|
| 轴拆分 | 类型 / 声明 / 渲染 / 策略四轴分离，`water-state.ts` 零 THREE | `water-state.ts:1-21` |
| 参数接线完备性 | 分派表 `Record<WaterParamKey, …>` 编译期强制表态；21 键 = schema 键集（契约测试锁定） | `water-params.ts:100-208`、`water-capability.test.ts:1413` |
| 结构参数零重建 | film/pool 的 size / 池深 / 壁厚全走 `transformLinks`，几何一律单位化 | `water-body-strategies.ts:114-138` |
| 形态差异收口 | cap 里 `mode ===` 判别已清零；构造期与运行期共用同一形态旗标 | `water-body-strategies.ts:140-170` |
| 值域单一事实源 | setter 不再 clamp；滑杆值域取 `getParamRange`（schema） | `water-capability.ts:668-673`、`water-menu.ts:106-118` |
| 倒影纪律 | 逐帧现读 + 载体不入场景 + 渲期隐藏水根 + RT 线性空间换算 | `water-reflect.ts:106-145` |
| 旧项闭环 | W-1（空 folder 死头）/ W-3（键集同步）/ W-5（注入守卫）已闭环 | `render.ts:182-192`、`water-capability.ts:374-385` |

ADR-319（当天落地）刚治掉三个**数值级真缺陷**（波幅写死失控 / 泡沫恒不可达 / 频谱锚点错配），
「先建量具、再落数值断言」的手法在仓内属上乘。本报告的 12 条发现全部是**它之后**剩下的第二层问题：

> **一句话总判**：水面把「可采样性」（λ 锚定域宽）归一到家了，但**「端点」没人守**（浪高/水位归零即 Inf×0 出 NaN）、
> **「物理量」没对齐**（垂直振幅绝对米制 vs 波长相对域宽 ⇒ 波陡随域宽漂 30 倍）、
> **「守卫的真实性」没校验**（三条恒真计算被两条字符断言保护成假绿）——**量具与断言共同把「不变」误当成了「正确」**。

---

## 二、确认缺陷

### P0-1 ｜ 浪高或水位拖到 0 ⇒ `Inf × 0` ⇒ 顶点 NaN：ADR-319 宣称的「静水态」实际是「水没了」

**本轮唯一一条用户可直接触发的渲染破损，且它是 ADR-319 D1 自己引入的。**

`water-capability.ts:250-267`：

```glsl
float amp = uWaveHeight * 0.26 * pow(0.82, fi);
...
float aa = max(smoothstep(2.0, 6.0, waveLen / spacing), 0.001);
amp *= aa;
float speed = sqrt(9.8 * freq);
float wa = freq * amp;
float steep = clamp(uChoppiness * 0.8 / (wa * float(GERSTNER_COUNT)), 0.0, 0.8 / (wa * float(GERSTNER_COUNT)));
...
disp.x += steep * amp * dir.x * c / sizeSafe;
...
nrm.z -= steep * wa * s;
```

触发路径（三条都是**合法**用户操作/schema 值域内的组合）：

1. `waterWaveHeight = 0`（`range.min = 0`，`env-state-schema.ts:291-296`）；
2. `waterLevel = 0`（`range.min = 0`，`:245-250`）——`effectiveWaveHeight` 下钳把预算算成 0；
3. pool 下 `waterLevel ≥ waterPoolHeight`（预算 = `max(0, depth−level)` = 0，`water-params.ts:55-60`）。

链条：`uWaveHeight = 0 ⇒ amp ≡ 0 ⇒ wa = freq·0 = 0 ⇒ 0.8/(wa·6) = +∞ ⇒ steep = clamp(chop·∞, 0, ∞) = +∞`
⇒ `steep * amp = ∞ × 0`、`steep * wa = ∞ × 0` ⇒ **NaN**。
独立复算（同一组表达式，JS/IEEE 754）：

```
steep= Infinity  disp.x= NaN  nrm.z= NaN
```

- `transformed.x/y += NaN` ⇒ 顶点裁剪坐标 NaN ⇒ 主流 GPU **丢弃含 NaN 的图元** ⇒ 水面整块消失；
- `objectNormal = NaN` ⇒ 解析法线同毁；`nrm = normalize(NaN)` 传播到 `vWaveSlope_wave`，倒影 uv 扰动同毁。

即：用户把「浪高」拖到 0 想得到静水，得到的是**水消失**——与 `ADR-319 §3`「静水态可达」的宣称相反。
（GLSL ES 规范对除零结果未定义，主流实现按 IEEE 给 ±Inf ⇒ 本路径为高概率；**仍建议以 e2e 截图实证**
：现成的 `frontend/e2e-web/water-wave-evidence.spec.ts` 加一档「浪高 0 / 水位 0」即可。）

**顺带一条假不变量**：`water-capability.ts:236-237` 的注释「1‰ 下界保 wa 恒 > 0——steep 项含 1/wa，恰零会炸 Inf×0 = NaN」——
该下界加在 `aa` 上（`:254`），而 `amp = uWaveHeight·…·aa`：**`uWaveHeight = 0` 时 `aa` 再怎么兜底也救不了 `amp = 0`**。
知识卡 `docs/knowledge/water.md:76` 同样写着「1‰ 下界防 wa 除零 NaN」——**两份文档都在为一条不成立的守卫背书**。

**修复方向**：`float wa = freq * amp;` 之后按波跳过（`if (wa <= 1e-6) continue;`），或让 `uWaveHeight = 0` 时
CPU 侧直接下发「无波」状态并短路 shader 波场；同时把两处「1‰ 下界保 wa > 0」的注释改成事实。

---

### P1-1 ｜ 尺度只归一了一半：垂直振幅绝对米制 × 波长 ∝ 域宽 ⇒ 大水面被「横向揉皱」

D2 把波长锚到域宽，D1 把振幅留成绝对米制，二者叠加的后果被探针的指标集漏掉了。由 `:243-267` 化简：

```
steep·amp = 0.8·choppiness·amp / (wa·6) = 0.8·choppiness / (freq·6) ∝ sizeSafe    // amp 被约掉了
世界水平位移 = steep·amp（局部 ÷sizeSafe ×modelScale=size 相消）
世界垂直位移 = amp
```

⇒ **垂直起伏与 `waterSize` 无关；水平摆动与 `waterSize` 成正比、与 `uWaveHeight` 无关。**

独立复算（复刻同款公式，六波矢量和扫一周期取最大；`choppiness=0.5`、`waveHeight=0.06`、`segments=64`）：

| waterSize | 最大世界水平位移 | 垂直总振幅 Σamp | 波陡（水平/垂直） |
|---|---|---|---|
| 10 m | **0.036 m** | 0.060 m | 0.6× |
| 80 m（默认） | **0.291 m** | 0.060 m | 4.8× |
| 300 m | **1.091 m** | 0.060 m | **18.2×** |

300 m 水面上顶点被水平推 **1.09 m**，而垂直只起伏 **6 cm**：不是「大浪」，是**一块被横向拉扯的水膜**。
同一浪高滑杆值在 size=10 与 size=300 下语义完全不同。

**为什么没人发现**：① 探针 `scan()` 只统计 `heightAt`（垂直）与 `jacobianAt`（**局部**无量纲量，随 size 自相似），
`horizAt`（`probe-water-wave.ts:130-140`）只被法线标定借用，**从未进入尺寸域扫描的输出列**（`:499-513`、`589-591`）；
② 测试反向把它钉成不变量——`water-capability.test.ts:2159`「D2 浪高是用户量、与尺寸解耦：改 waterSize 不漂移 uWaveHeight」。
**这就是仓库自己批判过的「用选择性指标给结论背书」**：「size 全域指标不变」只在「你恰好测了的那几维」成立。

**同一病在细节层的表现**：微细节法线的三组沟槽频率恒为世界米制（`water-capability.ts:323-334`：`dp = vWorldPos_wave.xz * 2.0`，
`cos(dot(dp,dd)·0.8/1.1/1.6)` ⇒ 沟槽恒在 3.9–7.9 m），而主谱已随域宽归一：
`size=10` 时最粗沟槽比整个水面还长（细节近乎不存在），`size=300` 时与主谱差一个数量级、成为孤立高频带。**细节层没跟上 D2**。

**修复方向**（三选一，推荐 B/C）：A) 振幅也锚定域宽（丢「米」语义）；
**B) 把 Gerstner 的 Q 归一到 `1/(k_i·A_i·N)`，让水平位移 ∝ 浪高而非 ∝ 域宽**（尺寸只决定「看到几个波」）；
C) 最小改动：`0.8·choppiness` 改为 `0.8·choppiness·(sizeRef/uSize)`。
配套：探针尺寸域扫描补「最大水平位移 / 波陡」两列；细节频率按 `sizeRef/uSize` 归一。

---

### P1-2 ｜ 浪高滑杆 **85% 的行程是死区**，且没有任何出口告诉用户

由 P1 引用的钳制（`water-params.ts:55-60`）在默认参数下的算术后果：

- `waterLevel=0.15`、`waterPoolHeight=0.3` ⇒ pool 预算 = `min(0.15, 0.3−0.15)` = **0.15**；
- `waterWaveHeight.range = [0, 1]`（`env-state-schema.ts:291-296`）；
- ⇒ 滑杆 **0.15 → 1.00 的整段（85%）对画面零影响**，面板照显用户拖到的 `1.00 m`。

测试把这个行为写在注释里（`water-capability.test.ts:2162`：`cap.setWaveHeight(0.3); // 钳后 0.15`）——
它是「钳制生效」的证据，不是「用户知情」的证据。菜单节点只有一个裸 slider（`water-menu.ts:213-221`）：无 hint、无实际生效值、无动态上界。
ADR-319 的收益是「拉到上限也不越壁」，代价是**用户以为自己控制着一个 1 m 的量，实际可控区只有 15%**。

**修复方向**：滑杆按形态动态收窄 `max`（预算已有现成函数），或挂 `hintKey` 显示「实际生效 X m」
（`hintKey` 是菜单节点通用字段，`node-validation.test.ts:123` 可证）。

---

### P1-3 ｜ 三条「每帧计算、永不触发」的计算仍在，且被两条字符断言保护成假绿

ADR-319 D3 的判词是「**每帧计算、永不触发不是实现，是债**」——据此整条删掉泡沫通道。同族的债还剩三条：

**① `aa` 淡出恒为 1**（`water-capability.ts:253-255`）：D2 之后 `waveLen/spacing = segments/(4·1.19^i)`，**与 uSize 无关**；
`segments=64` 时 i=0..5 得 16 / 13.45 / 11.30 / 9.49 / 7.98 / **6.70** ⇒ 全部 ≥ 6 ⇒ `smoothstep` 恒 1、`max(…, 0.001)` 恒不触发、`amp *= aa` 恒等。
探针实测印证（`--json` 的 `current.waves[*].aa` **六条全为 1**）。要让它生效须把 `WATER_WAVE_SEGMENTS` 压到 ≤57，
而 `water-state.ts:20` 的注释恰好把这条「保险」当活功能描述：「调小 = 抗锯齿提前介入」——**没有任何守卫拦这条改动**。

**② `steep` 的 clamp 恒等**（`:258`）：`clamp(uChoppiness·K, 0, K)`，`K = 0.8/(wa·6)`，而 schema `waterChoppiness.range=[0,1]`
（`env-state-schema.ts:282-287`）⇒ 被钳值恒 ∈ [0, K] ⇒ **上下界永不触及**；它想防的自交（`Σσ·k ≤ 0.8`）在 choppiness ≤ 1 时本就不会发生。
（注：P0-1 的 `wa = 0` 会让它从「恒不触发」变成「触发成 +∞」——同一条式子的两面。）

**③ 保护它们的是字符断言**：`water-capability.test.ts:415`「gerstner 按每波长顶点数淡出波幅」只断言
`toContain("float aa = max(smoothstep(2.0, 6.0, waveLen / spacing), 0.001);")`；`:438`「aa 带 1‰ 下界」只断言 `toContain("max(smoothstep(2.0, 6.0,")`。
两条用例的名字都在宣称「淡出在保护我们」，断言对「aa 是否为 1」零分辨力——**测试名与断言合谋**。
尤刺眼的是：ADR-319 D4 明文要求「波形命题用数值断言，不用字符串断言」，这两条正是 D4 钦点要淘汰的形态，**却没被淘汰**。

**修复方向**：三条二选一——删（把「采样密度由 `WATER_WAVE_SEGMENTS=64` 保证」写成常量注释 + 一条「segments ≥ 58」的数值不变量），
或留但转数值断言（用同源公式算 `aa`，断言 segments=64 时恒 1 / segments=32 时 < 1）；clamp 同法（补「choppiness > 1 被钳到 Σ=0.8」用例，当前域内不可达）。

---

### P1-4 ｜ 存量存档吃掉 D1 的默认抬升：老用户升级后浪**仍然死平**

`loadState` 的兜底只覆盖「**没有** level 键的 pool 旧档」（`water-capability.ts:832-841`），而 ADR-257 之后、
ADR-319 之前保存的存档**是带 `waterLevel=0.01`（当时的默认值）的**：

- `saveState` 遍历 `getPresetKeys("water")` ⇒ 恒写 `waterLevel`（`:746-750`）；
- `loadState` 走 `restoreBySchema(w, getPresetKeys("water"))`（`:811`）⇒ `clampFieldValue` 只做 `range [0,5]` 钳制 ⇒ **0.01 原样恢复**；
- ⇒ 预算 = `min(0.01, …)` = 0.01 ⇒ 浪高 0.06 被钳到 0.01 ⇒ **ADC-319 之前用户看到的「浪死平」原样保留**。

`scene-capability.ts:259-261` 的 `persistState` **无版本字段**，也没有「值等于旧默认 ⇒ 迁移」的判据。
于是 ADR-319 的观感收益只覆盖「新装 / 清过档」的用户，存量用户升级后画面不变（甚至可能以为修复没生效）。

**修复方向**：存档接版本号（或一次性迁移：`waterLevel === 0.01 且非用户显式改动` ⇒ 0.15）；
若判定为「不该追溯改用户值」，至少要在发布说明里写明**需要手动把水位抬起来**。

---

### P2-1 ｜ 参数模型的跨字段耦合全是静默的（乘积双写 / 开关撒谎 / 无约束 / 无出口）

五条同族，合并：

1. **film 下「水膜浓度」与「不透明度」只有 1 个自由度**——`water-params.ts:104-121` 两个 applier 都写同一乘积
   `opacity·wetness` 到 `material.opacity` 与 `uBaseOpacity`（构建期同式：`water-capability.ts:163`）。
   `(0.5, 0.5)` 与 `(0.25, 1.0)` 观感完全相同（仅 wetness=0 的门控差异）⇒ **两个旋钮一个自由度**，用户无法判断该转哪根。
2. **`waterEnabled=true` + film `waterWetness=0` ⇒ 开关撒谎**——`water-capability.ts:455-459`
   `visible = waterEnabled && (wetnessGated ? waterWetness > 0 : true)`：把「水膜浓度」拖到 0，一级行 `headerToggle`
   （读 `envState.waterEnabled`，`env.ts:206-218`）**仍显示 ON**，场景里却没有水——与 fog / shadow / reflector 已收口的
   「master toggle 显示 ON 而对象恒不存在」是**同族病**。`docs/audit-env-review.md` §5 的 S5-2 早已点名（建议 min 0.05+ 或 hint），
   **至今未闭环**（`env-state-schema.ts:251-256` 的 `range.min` 仍是 0，菜单无 hint）。
3. **`waterLevel` × `waterPoolHeight` 无任何跨字段约束**——range 各自独立（level `[0,5]`、poolHeight `[0.01,5]`）。
   pool 下 level > poolHeight ⇒ 水面浮在池壁之上（`water-body-strategies.ts:330-332` 只写 `top.position.y = level`），
   同时预算归零 ⇒ 浪高恒 0（`water-capability.test.ts:2204-2207` 反把这个归零锁成了期望）。
4. **水面贴地**：level 可拖到 0，而地面承接面在 `y = 0.005`（`scene-capability.ts:194-196`）⇒ 低于 5 mm 的水膜与地面 z-fighting
   （ADR-319 修复前的 s1 截图正是这个画面，当时来自默认值；现在它变成用户可选项）。
5. **未启用态不一致**：`waterEnabled` 关闭时二级面板参数仍全量可见可调（`env.ts:145` 的 `envCapSubNodes` 只剔除 master 节点），
   而同一棵树里 reflect 组四从控会随主开消失（`water-menu.ts:249-283`）——**两套口径**，用户会以为关掉水面后参数仍在起作用。

**修复方向**：wetness 与 opacity 合并为「水体浓度」（或 wetness 只当门控、不参与乘积）；
master 与 wetness 关系显式化（wetness=0 ⇒ 开关显示 OFF，或滑杆最小域抬升 + hint）；
pool 下 level 上界动态取 `poolHeight`；level 下界按承接面抬高（或 hint）；未启用态统一（补门或补一句「水面未启用」）。

---

### P2-2 ｜ 三处 `strategy.id === "pool"` 绕过自家策略表的自述纪律

`water-params.ts:10` 自述「形态门控（wetnessGated / supportsVolumeOptics / 空 targets 数组）一律查 strategy，不写 mode 分支」，
但同文件三处（`:172`、`:191`、`:197`）写的是：

```ts
effectiveWaveHeight(ctx.strategy.id === "pool")
```

「波峰不越壁」是形态**能力**，却用 id 字符串现判。新增形态（ocean / 大水面）时 `id === "pool"` 为 false ⇒ 静默按 film 处理（**无上钳**），
浪漫过容器而编译器一言不发。修复方向：`WaterBodyStrategy` 加 `hasWallCeiling: boolean`（与既有三旗标并列），调用点改传旗标。

---

### P2-3 ｜ 倒影的成本计价与门控双失配

1. **默认 4× MSAA 未计价**：`ensureReflector` 只传 `clipBias / textureWidth / textureHeight`（`water-reflect.ts:78-82`），
   而 three 上游默认 `multisample = 4`（`Reflector.js:83`）＋ `type: HalfFloatType`（`:101`）。
   512 默认档 ≈ 8 MB，2048 档 ≈ **134 MB**（4.19 M px × 8 B × 4 samples，未计 resolve），
   而 schema 注释只按「分辨率档位」说明成本（`env-state-schema.ts:335-342`）。
2. **强度归零仍付整场重渲**：`reflectionActive`（`water-reflect.ts:52-56`）只看 开关 / SSR / 宿主，**不看 `waterReflectionStrength`**；
   而 shader 侧 `if (uReflStrength > 0.0)` 整块跳过（`water-capability.ts:356`）。
   schema 注释自知这一点（`:328`「0 等于关混合但保留 RT」）——语义自洽，但用户把强度拖到 0 仍在每帧付一次整场渲染。

**修复方向**：显式 `multisample: 0`（水 shader 采样的是分辨率受限的 RT，4× MSAA 的边际收益低）；`reflectionActive` 顺带判 `strength > 0`。

---

### P2-4 ｜ 量具是 shader 的「平行手抄实现」，且退出码恒 0——它的数据正在为决策背书

`probe-water-wave.ts:5-6` 自述「用 JS 逐式复刻 …注入的 `gerstner()`」，`:60-106` 手抄了 `freq / amp / aa / wa / steep` 全部表达式——
与 shader 里的模板串是**两份独立副本**。这正是本仓对双份实现下过的判词（「同一协议只保留一份实现」）在量具层的复发：
**shader 改了而探针忘记同步，探针就会用旧公式为「新 shader 是对的」出具数据背书**。
现有一致性手段只有 §①「标定」（解析法线 vs 几何法线夹角），能感知**部分**漂移，但不是公式同源守卫；
而 ADR-319 §4 与知识卡都在引用探针读数（「尺度无关性由数据背书，不是推理」）。**P1-1 正是这条风险的实例**：
指标集漏了水平位移，结论就只覆盖了它测过的维。

**修复方向**：波常数表达式收敛为单一来源（TS 常量表生成 GLSL 片段；或由探针 import shader 侧导出串并正则提取），
加契约测试「shader 注入串含探针同款 freq/amp 表达式」（与 `WATER_UNIFORM_NAMES` 双向对账同范式）。

---

### P2-5 ｜ 文档 / 注释 drift（三处，可立即闭环）

1. **注入检测已修，两处文档仍写「待议」**：`docs/knowledge/water.md:53` 与 `ADR-319 §4` 记载「只查 5 个符号……begin_vertex 位移注入无锚点……
   `fragOk` 查的 `uRoundness`……」；而 `water-capability.ts:374-385` 现为**六锚点**，且注释自带修复编号（`[锐评 P1-2]` / `[锐评 P2-1]`）：
   `dispOk = …includes("transformed.z += gdisp.z;")`、`fragOk = …includes("uniform sampler2D uReflTex;")`。
   `git log -S "dispOk"` / `-S "uniform sampler2D uReflTex;"` 均只命中 `7214b629c`——**下一轮读者会去修一个已修好的东西**。
2. **默认值注释过期**：`scene-capability.ts:191-192` 仍写「`envState.waterLevel`（默认同为 0.01）」，schema 默认已是 0.15。
3. **兼容层退役时钟只活在知识卡**：`water.md:62` 宣布别名表「只减不增、不得新增别名」并有退役判定，
   而 `water-capability.ts:812-831` 的别名表**零守卫零测试**——加别名不会红，时钟无人执行。
4. **假不变量**：`water-capability.ts:236-237` 与 `water.md:76` 的「1‰ 下界保 wa 恒 > 0」（见 P0-1）。

---

### P3-1 ｜ `transmissionRenderTarget` 死代码 + 一条自证式测试

`water-capability.ts:426-433` 的 `disposeWater` 逐材质读 `asPhysical?.transmissionRenderTarget` 并释放。
three 0.186.1 的 `MeshPhysicalMaterial` **没有这个属性**（grep `src/materials/MeshPhysicalMaterial.js` 零命中）；
真实 transmission RT 住在 `renderer` 侧：`WebGLRenderer.js:2012` `currentRenderState.state.transmissionRenderTarget[camera.id]`，
由 renderer 按相机持有与清理。⇒ 生产路径该分支**永不触发**。
而测试把它「救活」了：`water-capability.test.ts:1038-1046` 手工 `mat.transmissionRenderTarget = {…}` 再断言被释放——
**测试自己伪造输入、实现读输入、测试断言输出**，与被测的真实世界无关（自证式测试）。
风险不在泄漏（renderer 管着），而在**注释与测试共同制造「我们已具名管理 transmission RT」的错觉**。

**修复方向**：删该分支与对应用例（或改成断言「材质 dispose 后 renderer 侧 RT 由 three 自管」的说明性用例）。

---

### P3-2 ｜ 倒影释放注释不实 + `camera.updateMatrixWorld()` 的时序理由不成立

1. `water-reflect.ts:93` 注释「弃倒影载体（RT + 材质 + 几何具名释放）」，实现只 `state.reflector?.dispose()`；
   three 上游 `Reflector.js:270-275` 只释放 `renderTarget` 与 `material`，**不释放构造期传入的 `new PlaneGeometry(1,1)`**
   （`water-reflect.ts:78` 每次重建新建）。实际风险很小（载体不入场景、几何从未被渲染 ⇒ 无 GPU 泄漏，仅 JS 堆对象），
   但「注释承诺 > 实现」是本仓最重视的一类漂移，且出口只有一个函数、改起来一行。
2. `renderReflection` 里 `camera.updateMatrixWorld()`（`water-reflect.ts:128`）注释称「controls 更新在上一帧尾，官方读 camera.matrixWorld 前须刷新（否则镜像滞后一帧抖动）」——
   而 `render-host.ts:243` 的 `c.update?.(dt)`（倒影在这里渲）**早于** `:247` 的 WASD 相机输入与 `:259` 的 perFrame 回调：
   此刻相机里还是上一帧写入的状态，刷新矩阵改变不了「倒影相机比主渲染晚一帧输入」这一事实。
   即注释宣称的收益不存在（每帧多一次矩阵合成，无害但无用）。

**修复方向**：注释改「RT + 材质」（并补 geometry 的具名释放，若在意堆对象）；
倒影驱动若要真正消除一帧滞后，需把 RT 渲染移到相机输入之后（结构性调整，另议）。

---

## 三、被驳回 / 修正的两条（子代理断言，主模型复算推翻）

| 断言 | 出处 | 仲裁 |
|---|---|---|
| 「微细节法线在大水面会屏幕空间走样/闪烁」 | 本轮主模型初判（渲染视角子代理**证伪**） | **降级**：最高空间频率 2×1.6 = 3.2 rad·m⁻¹ ⇒ λ≈2 m；1080p/fov45° 下像素足迹过 1 m 需 ≈1.4 km 机位 ⇒ 近观/俯视下走样不成立。**保留**「与主谱尺度基准分裂」的语义断裂（已并入 P1-1）；掠射远处的足迹拉伸本轮未实证，记为待验证。 |
| 「`gerstner()` 每顶点算两次是纯浪费」 | 知识卡 pitfall + ADR-319 §4 遗留② | **维持原判但降级**：确为两次调用（`water-capability.ts:283` 与 `:293`，形参 `gWaveNormalUnused` 自证），可合成一次；但两条 chunk 之间无 chunk 改 `position` 的前提需在升级 three 时重验，故仍按「非阻塞、升级时一并议」处理。 |

---

## 四、旧项对账（不重复报，只核闭环）

| 旧项 | 位置 | 本轮核验 |
|---|---|---|
| S5-1 空 folder 死头 / S6-4 W-1 | `audit-env-review.md` §5/§6 | **已闭环**：`render.ts:182-192`、`253-256` 渲染前按 visibleWhen 预筛，「全隐组不留空卡壳」 |
| S5-2 wetness=0 水面消失、用户以为坏 | §5 | **未闭环**，已升级为 P2-1②（「开关撒谎」同族） |
| S5-3 波纹组单控件独占一组 | §5 | **已闭环**：现为 wave-speed + wave-height 两控件 |
| W-3 分派表键集与 schema 不同步 | §6 | **已闭环**：`water-capability.test.ts:1413` |
| W-5 注入守卫只检 4 符号 | §6 | **已闭环**（现 6 锚点），但文档滞后 ⇒ P2-5① |
| W-2 transmissionRenderTarget 手动释放时序 | §6 | **仲裁为新发现**：该属性在 r186 材质上不存在 ⇒ 死代码（P3-1） |
| 圆角裁剪假设水面恒在原点 | 知识卡 | 已有测试钉子（`water-capability.test.ts:2217-2241`）；仍属「未来移动水面即静默裁隐形」的钝刀，维持登记 |

---

## 五、建议处置顺序

1. **P0-1（NaN）**：唯一的用户可触发破损，且打脸 ADR-319 的宣称——先加 `wa` 门 + e2e 端点取证。
2. **P2-5（文档）**：零风险，顺手把两处 drift 与两处假不变量注释订正。
3. **P1-3（守卫真实性）**：三条恒真计算删或转数值断言，顺手淘汰两条字符断言；工作量小、收益是「守卫不再撒谎」。
4. **P1-4（存档）**：需要一次产品决策（是否追溯迁移旧默认值），决策后在 `loadState` 落一步。
5. **P1-1 + P2-4（波陡归一 + 量具同源）**：先扩探针指标（水平位移/波陡）与同源守卫，再动 shader——否则改完无法证伪。
6. **P1-2 + P2-1（参数语义）**：滑杆动态上界/生效值出口、wetness×opacity 合并、master 与 wetness 关系、level×poolHeight 约束。
   其中 wetness×opacity 合并需产品决策，宜单独一轮。
7. **P2-2 / P2-3 / P3-1 / P3-2**：随手可清（策略旗标、multisample/门控、死代码与自证测试、注释与时序）。

---

## 六、本轮取证记录

- **源码通读**：`water-capability.ts`(860) / `water-params.ts`(267) / `water-reflect.ts`(166) / `water-body-strategies.ts`(363) /
  `water-menu.ts`(287) / `water-state.ts`(21)；抽查消费面 `env.ts`、`render.ts`、`scene-capability.ts`、`infra/render-host.ts`、`env-state-schema.ts`。
- **子代理**：两路独立只读审计（渲染正确性/性能、参数模型/交互语义），最强断言由主模型逐条抽查，**驳回 1 条、维持降级 1 条**（§三）。
- **上游取证**：`three@0.186.1/examples/jsm/objects/Reflector.js:83,101,270-275`（multisample 默认 4 / HalfFloatType / dispose 实释物）、
  `three@0.186.1/src/core/RenderTarget.js:365-398`（`setSize` 内部 `this.dispose()`）、
  `three@0.186.1/src/renderers/WebGLRenderer.js:2012`（transmission RT 真身位置）。
- **量具复跑**：`node scripts/probe-water-wave.ts --json` → `current.waves[*].aa` 六条**全部 = 1**（P1-3① 实测依据）。
- **独立复算①**（P1-1）：复刻同款公式，六波矢量和扫一周期取最大世界水平位移 → 10 m: 0.036 / 80 m: 0.291 / 300 m: 1.091（m）。
- **独立复算②**（P0-1）：复刻同款表达式，`wa = 0` 时 `steep = Infinity`、`disp.x = NaN`、`nrm.z = NaN`（IEEE 754）。
- **时间线**：`git log -S "dispOk"` / `-S "uniform sampler2D uReflTex;"` → 均命中 `7214b629c`（P2-5① 漂移依据）。
- **未做**：`vitest` / `vite build` / `typecheck` / `pre-push-gate` 未跑；P0-1 的 GPU 实际行为未做真机/e2e 实证（规范对除零未定义），
  测试面结论来自通读用例，不是执行结果。**以上均不可外推为「水面无风险」。**

---

## 七、横向外推：同族病复发清单（第二轮，2026-10-04 晚）

方法：把本报告 12 条提炼成「病症模式清单」，派独立子代理逐 cap 扫描。**发现 8 处同族复发**（含 1 处 P1），
全部附源码证据、可复核；本清单即下一轮工作队列。

| # | 子系统 | 病症模式 | 证据 | 判定 | 状态 |
|---|---|---|---|---|---|
| X-1 | render-mode | **部分撤销只还原第一个材质**：`coveredProps` 是全局 `Set<属性名>`，首个材质 `delete` 后其余材质 `has()` 为 false ⇒ 多 mesh 时残留覆盖（开线框 + X 光后关线框，只有一个 mesh 回退） | `render-mode-capability.ts:89` / `:140-143` | **P1（画面直接错）** | **已修**：账本改按 `uuid:key` 记账 + 两条多材质用例 |
| X-2 | fog | `fogNear`×`fogFar` 无跨字段约束 ⇒ near > far 落入 GLSL `smoothstep(edge0 ≥ edge1)` 未定义域，且无测试覆盖 | `env-state-schema.ts:411,417` / `fog-capability.ts:102-103` | P2 | **已修**：消费点 `normalizeFogRange`（far ≥ near+1）+ 两条用例；**「显示值 ≠ 生效值」的 far 滑杆 hint 出口登记未接**（免与并行会话在改的 3 个 locale 文件冲突） |
| X-3 | light | 环境光 ×0.5 让位判据读 sky **自宣退役**的 `skyEnvironment`（真供图者已是 `envSource`）⇒ IBL 在场却不让位（双间接光过亮）；ambient 滑杆无 hint 出口 | `light-capability.ts:847-849` vs `sky-capability.ts:354`、`light-controls.ts:360-364` | P2 | 待修 |
| X-4 | sky | `skyElevation`/`skyAzimuth` 幽灵键：构造读入 → `apply()` 内 `syncSunFromTime()` 覆盖，且 `saveState` 不落 / `loadState` 不恢复 ⇒ `setSun()` 效果活不过一次 apply | `sky-capability.ts:274-275,489,801-803,944-955` | P2 | 待修 |
| X-5 | shadow | 四档白名单只装在 `setMapSize`，`loadState` 恢复侧裸奔且 schema 无 `range` ⇒ 脏档值原样进 `mapSize.set()`，脱离 UI 可达域 | `shadow-capability.ts:412` vs `:522`、`env-state-schema.ts:431` | P2 | 待修 |
| X-6 | 跨 cap | 未启用态口径不统一：pp 有 `disabledWhenOff`（20 处子控件灰化 + title），fog / shadow / reflector 三个 menu **零 `disabled:`** | `postprocessing-menu.ts:52-54` | P2 | 待修 |
| X-7 | sun-beams | 恒真守卫（同本报告 P1-3②）：过门后 `(20-e)/20 ∈ (0, 0.99995)`，`min/max` 两极永不触及 | `sun-beams.ts:28-29` | P3 | 待修 |
| X-8 | ground / reflector | 零散：ground 私有 `enabled` 与 schema 键双门（旧档 `enabled=false` 时面板 ON 而地面不出现，待验证）；reflector 注入返回值被丢弃、锚点失配仅 warn 而参数照写 | `ground-capability.ts:347-348,483`；`reflector-capability.ts:119,140` | P3 | 待修 |

**未发现同族病**（A/B/C 三类已扫）：postprocessing、environment、render-mode-menu、sky-menu、fog-menu、
shadow-menu、light-controls/light-params、ground-menu/ground-surface-spec。

**子代理建议的前三优先级**：X-1（唯一画面错）→ X-2（两行 + 一条测试）→ X-3（判据一行 + 复用新 hint 通道）。

## 八、第二轮回归审计（水面自身）与处置

要点：**本轮五提交的改动自身带出 3 条新问题**（film 耦合未摘净 / 可见性单门解锁倒影重渲 / 迁移判据用 `===`），
主模型复核后**全部已修**；1 条已由主模型自查收窄（slider 静态 `hintKey` 转「登记未接」）；
1 条属语义权衡，**登记 + 量具化**（尖度轴 Σσk ∝ 1/size，探针新增「Σσk 域宽扫描」行）。
子代理同时**证伪 4 项**（跳变量级突变、版本戳污染 cap、`samples === 0` 恒真、i18n 时机），
并确认 `level` 旧别名会绕过迁移但属良性（别名期无 0.01 默认值）。详见文首「第二轮锐评（增量）」段。
