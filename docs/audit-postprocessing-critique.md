# 后处理系统锐评（2026-10-04）

> **实施状态（2026-10-04 更新）**：**P1-1 / P1-2 / P1-3 / P2-1 / P2-4 / P2-5 已修复并验证**。
> 未修：**P2-2**（曝光总开关门——属产品决策，改动会动亮度基线，留给用户拍板）、**P2-3**（多会话
> `envState` 单例，ADR-196 固有成本，属"记录"而非"待修"）、**P2-6**（疑似，未复现）、
> **P3-1 / P3-2 / P3-4**（死代码与注释/测试清理，零风险但未纳入本轮）。
> 本轮验证：`src/preview-3d` 165 文件 / 3025 用例、全仓 444 文件 / 7190 用例、
> `vite build` + `typecheck` + `check-biome` + `doctor --docs` 全绿。
> 知识卡已同步：`docs/knowledge/preview_env_state.md`「锐评修复 2026-10」段。

> 审计对象：3D 预览「后处理（postprocessing）」能力簇。
> 方法：主模型亲自读源码 + three 0.186.1 上游源码取证；对外可见结论逐条给「文件:行号 + 原文片段」。
> 基线：`postprocessing-capability.test.ts` + `postproc-cost-probe.test.ts` 共 114 用例全绿。
> 与既有 ADR 的关系：ADR-247（联动/抑制态/门禁）、ADR-250（启用意图入 schema）、ADR-299（composer 惰性常驻）已解决前几轮大病；本报告**只记存量问题与本次新发现**，不重复历史结论。

---

## 一、总判

**这是一套健康度偏高的子系统，不是烂摊子。** 前几轮锐评（ADR-247/250/299）把「开关撒谎」「一枚字段三重语义」「每帧白付管线过路费」三类大病都治了，且治得干净：本轮自查未发现骨架级病症。

具体证据（本次实测）：

| 维度 | 结论 | 取证 |
|---|---|---|
| 参数可达性 | **满分，21=21=21=21** | schema 21 个 `pp*` 键 = 菜单 21 个节点 = saveState 21 键 = loadState 21 键，无死参数、无孤儿控件、无存档不对称 |
| 启用意图真值源 | **已单源** | `postprocessing-capability.ts:138-140` `get enabled()` 读 `envState.ppEnabled`，cap 不再持有独立字段 |
| SSR 活跃判定 | **已单源** | `isSsrRenderActive()`（`env-state.ts`），pp 与 water 两处共用，无第三份手抄 |
| 抑制态归属 | **语义正确** | `postprocessing-capability.ts:428-455` 两态字段（suppressing/prevEnabled）能回答「借条在谁手上」 |
| 联动手册 | **已合规** | `syncBloomPass:506-537` 读浓度意图而非可见性，且带 `Number.isFinite` 守卫（ADR-247 R2） |
| 测试基线 | **114 绿** | 本次实跑确认 |

所以下面的问题都是**局部手术级**，不是推倒重来级。

---

## 二、确认缺陷

### P1-1 ｜ SSR 缓冲被逻辑尺寸覆盖，DPR>1 时白白掉到 1× 分辨率

**这是本次最实的一条，而且 ADR-299 §5 早已点名、却至今未修。**

`postprocessing-capability.ts:579-592`：

```ts
setSize(width: number, height: number): void {
  this.lastW = width;
  this.lastH = height;
  if (this.composer) {
    this.composer.setSize(width, height);          // ← ① 内部已按物理尺寸 resize 所有 pass
    if (this.bloomPass) this.bloomPass.resolution = new THREE.Vector2(width, height);
    if (this.ssrPass) {
      this.ssrPass.width = width;
      this.ssrPass.height = height;
      this.ssrPass.setSize(width, height);         // ← ② 用逻辑尺寸再覆盖一遍
    }
  }
}
```

关键在于 three 0.186.1 的 `EffectComposer.setSize` 到底做了什么（`frontend/node_modules/.pnpm/three@0.186.1/node_modules/three/examples/jsm/postprocessing/EffectComposer.js`）：

```js
setSize( width, height ) {
  this._width = width;
  this._height = height;
  const effectiveWidth = this._width * this._pixelRatio;      // ← 已乘像素比
  const effectiveHeight = this._height * this._pixelRatio;
  this.renderTarget1.setSize( effectiveWidth, effectiveHeight );
  this.renderTarget2.setSize( effectiveWidth, effectiveHeight );
  for ( let i = 0; i < this.passes.length; i ++ ) {
    this.passes[ i ].setSize( effectiveWidth, effectiveHeight );  // ← 给 ssrPass 传的是物理尺寸
  }
}
```

即：① 已经正确地把 `ssrPass.setSize(物理宽, 物理高)` 调过一遍；② 紧接着用**逻辑尺寸**盖回去。

`SSRPass.setSize` 拿这个值做什么（同目录 `SSRPass.js`）：

```js
setSize( width, height ) {
  this.width = width;
  this.height = height;
  ...
  this.beautyRenderTarget.setSize( width, height );   // ← 承载整场渲染的 RT
  this.normalRenderTarget.setSize( width, height );
  ...
  this.ssrMaterial.uniforms[ 'resolution' ].value.set( effectiveWidth, effectiveHeight );
}
```

而 `SSRPass.render` 第一件事就是 `renderer.setRenderTarget( this.beautyRenderTarget )` 整场重渲。

**结论**：DPR=2、容器 800×600 时，SSR 的 beauty 缓冲实际是 **800×600 而非 1600×1200** —— SSR 的整场重渲被降到了 1/4 像素量。

**因果链**：`render()` 每帧都调 `syncSSRPass()`，但 `setSize` 只在 resize/像素比变更时走（`render-host.ts:303-315`、`input-and-animation.ts:199-210`）。由于 `render-host` 在每次像素比变更后**无条件**补一发 `setSize`（`render-host.ts:312-315`），所以这不是「窗口一 resize 就坏」的瞬态，而是**触发后持续保持**的状态。

**用户可感知后果**：
- DPR ≥ 1.25 的机器上，SSR 反射（以及 `ssr-only` 模式下的整个反射）分辨率低于主画面，反射边缘发虚。
- 更隐蔽的一面：**这不是性能优化，是纯损失**——SSR 的 compute 成本（光线步进）按 `effectiveWidth/Height` 的 uniform 走，缓冲小了但步进开销没省，画面糊了钱没少花。
- 反直觉点：**像素比越高（高分屏），SSR 相对越糊**，因为 1× 与 DPR× 的差距被拉大。

**为什么一直没被测出来**：`postprocessing-capability.test.ts:1112-1123` 那条用例是这样断言的：

```ts
expect(() => cap.setSize(256, 128)).not.toThrow();
expect(ssr.width).toBe(256);
```

`SSRPass.setSize:688-689` **无条件**回写 `this.width = width`，所以该断言**能**区分两种实现：现实现（传 256 逻辑量）→ 256 通过；**修复实现（传 512 物理量）→ 断言立刻变红**。

> ⚠️ **更正**：我初稿把这条断言判为「恒真、无法区分」，**这是错的**。它的真实性质是**反向锁定**——把**错误的那一侧**锁成了期望值。这比恒真更危险：修复 P1-1 时它必然变红，容易被误判成「修复引入了回归」而回滚。**修复方案必须包含该断言的同步更新**（改为断言 `beautyRenderTarget.width`，并显式覆盖 DPR=2 场景）。

`postprocessing-capability.ts:313-317、350-351、389-390` 全部走 `composer.passes.splice(...)` **直插数组**，绕过了 `EffectComposer.addPass`/`insertPass`。而这两者（`EffectComposer.js:149-154`、`:162-167`）是**唯一**会调 `pass.setSize(_width * _pixelRatio, ...)` 的地方：

```js
addPass( pass ) {
  this.passes.push( pass );
  pass.setSize( this._width * this._pixelRatio, this._height * this._pixelRatio );
}
insertPass( pass, index ) {
  this.passes.splice( index, 0, pass );
  pass.setSize( this._width * this._pixelRatio, this._height * this._pixelRatio );
}
```

且 `Pass` 基类的 `setSize` 是**空实现**（`Pass.js:74` `setSize( /* width, height */ ) {}`）。**故 SSRPass 自构造起就从未被正确初始化过**——不只是「被覆盖」，是「从没对过」。这使本条从「resize 时才坏」升级为「一直坏」，机制比表面所见更本质。

**修复方向**：改用 `composer.addPass/insertPass` 替代 `splice`（这样插入即自动获得物理尺寸），并删除 `:586-590` 的手写覆盖，信任 composer 级联。

### P2-1（修正）｜ 尺寸凭据与 pass 构造尺寸双源

`postprocessing-capability.ts:286-320` 的 `createComposerBase` 用 host 下发的凭据建 composer：

```ts
const w = this.lastW > 0 ? this.lastW : Math.max(logicalSize.x, 1);
const h = this.lastH > 0 ? this.lastH : Math.max(logicalSize.y, 1);
```

但紧随其后的 `attachSSAOPass`（`:324-326`）与 `attachSSRAndBloomPasses`（`:339-341`）却改从 renderer 现取：

```ts
const logicalSize = this.renderer.getSize(new THREE.Vector2());
const w = Math.max(logicalSize.x, 1);
const h = Math.max(logicalSize.y, 1);
```

**同一份 `buildComposer` 内两套尺寸源**。二者的分叉条件真实存在：惰性常驻下 composer 可能在会话中段才建，而 `lastW/lastH` 是 host 下发值、`renderer.getSize()` 是当前值，二者在「容器尺寸已变但尚未下发」的窗口内会不一致。

这条本身后果轻微（首帧后即被 `setSize` 对齐），但它是 **P1-1 的同源病根**：只要还有第二套尺寸源，"哪个是对的"就持续可争议。**修复方向**：统一取 `lastW/lastH`（有凭据时），把「host 下发值 = 唯一事实源」写死在这一个函数里。

### P3-1 ｜ `bloomPass.resolution` 是死代码

`postprocessing-capability.ts:585`：

```ts
if (this.bloomPass) this.bloomPass.resolution = new THREE.Vector2(width, height);
```

three 0.186.1 的 `UnrealBloomPass.setSize(width, height)` 只用来算 `resx/resy` 并 resize 各 RT 与 `invSize` uniform，**从不读 `this.resolution`**（构造器读一次用于初始建 RT，此后无人消费）。故这行是**纯写入、零效果**的死代码，且每次 resize 都白白 new 一个 Vector2。

**修复方向**：删除。

### P3-2 ｜ 陈旧注释与已删概念残留，误导后来者

- `postprocessing-state.ts:107-108` 注释写「注意：enabled 不入 schema，由 this.enabled 单独携带」——**与事实相反**：`env-state-schema.ts:463` 已有 `ppEnabled`（ADR-250 正是把它入 schema），且 cap 也不再持有 `this.enabled` 字段（`:138-140` 是读 envState 的 getter）。该注释同时否定 ADR-250 的两条核心决策。
- `postprocessing-capability.ts:23` 写「构造只留 scene/renderer/camera/caps（enabled 形参保留仅为兼容…）」，与 `:158-160` 实际仍接受 `enabled` 形参一致，但 `:172-174` 的 `setEnvState` 调用点未说明"仅显式传入时生效"——而这恰是 ADR-299 §3 第 1 点（构造期按启用意图建 composer）的**上游前提**，值得点明。

**为什么值得单列**：本仓刚在 `context-menu.md` 立过规矩——「源码注释不写死行号」，理由就是注释会静默漂移。这里是同族病：**注释与已确立的决策相反**，比行号漂移更有害，因为它会把下一个读代码的人引向被 ADR 明确否决的设计。

### P3-3 ｜ `render()` 每帧重写 pass.enabled，与 onEnvChanged 职责重叠

`render():566-568` 每帧写三个 pass 的 `enabled`，而 `onEnvChanged:214-216` 在 `ppBloomEnabled` 变更时也写 `bloomPass.enabled`。

**经核实这不是缺陷**：`render()` 的写入是「每帧从状态层拉取」的**兜底一致性**，成本是三次布尔赋值（可忽略），且能防住 onEnvChanged 的漏网路径。`ppSsaoEnabled`/`ppReflectionMode` 走 rebuild 路径（`:208-211`），行为自洽。记录在此仅为免下次评审重复排查。

### P1-2 ｜ `dispose()` 不复位会话级字段，配合实例复用短路 -> 换模型默认值永久失效

`postprocessing-capability.ts:859-871` 的 `dispose()` 收尾只做四件事：还原 reflector 抑制、`unsubscribeEnv()`、`disposeComposer()`、`restoreOutputSettings()`。**三个尺寸凭据（`:118-120` `lastW/lastH/lastPixelRatio`）与 `isStateLoaded`（`:152`）都不复位。**

单看这里无害——cap 由 `sceneCapabilityRegistry.dispose()` 销毁、下次 `createAll` 建新实例。但 `scene-capability-registry.ts:86-95` 有一条**同宿主复用短路**：

```ts
const last = this.lastCtx;
if (
  this.instances.length > 0 &&
  last &&
  last.scene === ctx.scene &&
  last.renderer === ctx.renderer &&
  last.camera === ctx.camera
) {
  return [...this.instances];   // ← 旧实例原样复用，不 dispose 不重建
}
```

该短路的本意是省掉「sky/water/reflector 的 render target 反复建拆」（注释 `:41-45` 自陈），但后处理 cap 被它连带复用后，两个字段的语义就翻转了：

- `isStateLoaded === true`（上个会话的存档残留）→ `applyModelPreset:668` 的 `if (this.isStateLoaded) return;` 让**本会话的模型默认预设永久失效**——切 YSM/VRM/MMD 都不再改变后处理开关。
- `lastW/lastH/lastPixelRatio` 是上个会话的尺寸 → 若本会话未下发过 resize 就启用后处理，composer 会按**上个会话的容器尺寸**建缓冲。

**为什么难发现**：它需要「复挂同一 renderer + 本会话无新存档」两个条件同时成立，而测试用 `resetEnvState()` + 新建 cap，永远走不到复用分支。

**修复方向**：`dispose()` 复位 `isStateLoaded = false` 与三凭据（低成本、根本性）；或在 `createAll` 复用前对 cap 发一个「会话开始」通知。**注意**：不能简单删掉复用短路——它对 sky/water 的 RT 收益是真的，应让后处理 cap 自己声明"复用时需复位"。

### P1-3 ｜ 总开关关闭时，SSAO / 反射模式控件静默 no-op

`postprocessing-capability.ts:207-211`：

```ts
if (changed.has("ppSsaoEnabled") || changed.has("ppReflectionMode")) {
  if (this.composer) this.buildComposer();
  return;                      // ← composer 为 null 时，什么都不做
}
```

`ppEnabled=false` 的会话里（含**从未开过后处理的绝大多数默认会话**），`composer` 恒为 `null`（惰性创建，`:621` 是唯一建点）。此时用户拨 `pp-ssao-enabled`、拖 `pp-ssao-radius`、切反射模式，代码路径直接 `return` —— **零反馈、零提示**，直到某次开启总开关才由 `applyEnabledSideEffects:621` 建 composer 并读取。

**用户可感知后果**：「我明明把 SSAO 打开了，画面毫无变化」——这是 ADR-246/247 反复讨伐的「开关撒谎」的**同族变体**：不是显示假，而是**关闭态下控件没有生效通道**。

**修复方向**（择一）：
- 关闭态在菜单把这些子控件置灰 + 一句「需先开启后处理」提示（最省事、最诚实）；
- 或沿用既有 `applyEnabledSideEffects` 惰性创建思路：这两个键变更时若 `!composer` 且意图已开，就一并触发创建（需评估是否违背「未启用不分配」的 ADR-299 初衷——**不推荐**，等于把默认路径的零成本重新打开）。

### P2-2 ｜ `ppExposure` 不受总开关约束，且 sky 停用时成为死参数

`sky-capability.ts:518` 的有效曝光 = `envState.skyExposure * envState.ppExposure`，**不读 `ppEnabled`**。故 `ppEnabled=false`（后处理已关）时拖 `pp-exposure` 滑块，全局亮度照变。反向：sky cap 缺席或停用时无人读取该键，而菜单控件仍可调。

属主裁定（曝光归 sky）本身是 ADR-250 §2.3 的正确答案，**这条不是"属主错了"，是"归属缺一个总开关门"**。

### P2-3 ｜ 多会话共享 `envState`，参数交叉污染

`env-state.ts` 的 `envState` 是**模块级可变单例**，而 `mount-session.ts` 明确「cooperate 多会话共享同一 scene/caps」。两个预览会话并存时，A 会话开 `ppEnabled`/改 SSAO，B 会话同步变（两个 cap 实例都订阅 `postprocessing` 组并各自落地）。

属 ADR-196 单例设计的固有代价、非本 cap 引入，但本 cap 未做会话隔离。**建议**：至少写进知识卡作为已知语义，避免下次被当新缺陷重复排查。

### P3-4 ｜ 测试层三处真实性缺陷

**（a）空洞断言（P2）**：`postprocessing-capability.test.ts:1146-1159` 的用例名含 "exposure"，并断言 `expect(renderer.toneMappingExposure).toBe(0.4)`（`:1157`）。但本 cap 自 ADR-250 起**已删除 exposure 的写路径**（曝光归 sky），`toneMappingExposure` 从未被写入 → 该断言**恒真**，通过不证明任何还原逻辑。用例名同样镜像的是 ADR-250 之前的旧架构。

**（b）测试隔离依赖（P2）**：`:639` 那个 describe **没有** `beforeEach(() => localStorage.clear())`（对比 `:246`/`:283` 两个 describe 都有），改为在用例末尾手工 `clear()`（`:721/733/737/746`）。**任一中途断言失败则 clear 不执行** → 污染后续用例，产生顺序依赖。

**（c）弱断言（P3）**：`:958` `expect(renderer.toneMappingExposure).not.toBe(1.8)` 只断言「不等于 1.8」，任何非 1.8 的值（含错误值）都能通过；同组 `:443`/`:523` 用的是 `toBeCloseTo` 强断言，此处口径不一致。

三处均无用户可见后果，但会**削弱这批测试作为回归锁的可信度**——尤其 (a) 会让「exposure 还原」这一已不存在的职责看起来仍被覆盖。

### P2-4 ｜ 上游客源缺陷：`SSRPass.dispose` 漏释放 `ssrMaterial`，反复切反射模式累积泄漏

three 0.186.1 的 `SSRPass.dispose`（`SSRPass.js:491-518`）释放了 7 个 RT + **6 个** material（normalMaterial / metalnessOnMaterial / metalnessOffMaterial / blurMaterial / blurMaterial2 / copyMaterial / depthRenderMaterial）+ fsQuad，**唯独漏掉 `ssrMaterial`**——而它正是持有 `defines`（含 `MAX_STEP`）与全部 uniforms 的 ShaderMaterial（构造于 `SSRPass.js:354`）。

本仓 `onEnvChanged:208-211` 把 `ppReflectionMode` 变更处理为 `buildComposer()` **全量重建**，每次重建都 `new SSRPass(...)` → 新 `ssrMaterial`，旧的那个随 dispose 链永久留下。

**用户可感知后果**：反复切换反射模式（envmap-only ↔ envmap+ssr ↔ ssr-only）会累积未释放的 ShaderMaterial 与着色器程序，表现为显存缓慢增长。

**修复方向**：本 cap 无法修 three 内部，但可从根上绕开——`ppReflectionMode` 变化时**不重建 composer**，改为切 `ssrPass.enabled` 与参数（`render():567` 已在做 `ssrPass.enabled = envState.ppReflectionMode !== "envmap-only"`，说明"不重建"在技术上可行）。这同时消除了本条与 P1-1 的重建面。

### P2-5 ｜ 跨会话像素比凭据陈旧（ADR-299 尺寸凭据引入的新残留）

`shared-infra.ts:275/283` 在 mount 时把 renderer 像素比复位（`previewPixelRatio(devicePixelRatio)`）——这正是为了治「自适应降档把 renderer 钉在低档、关预览再开仍停低分辨率」（注释 `:279-282` 自陈该病史）。**但它没有同步通知 postprocessing cap**，而 cap 的 `lastPixelRatio` 是跨会话残留的（见 P1-2，`dispose()` 不复位）。

**触发链**：会话 A 自适应降到 0.75 → `cap.lastPixelRatio = 0.75` → 关预览 → 会话 B 重开，renderer 已复位到 1.5，但 cap 仍是 0.75 → 若 B 会话首次启用后处理，`createComposerBase:293-294` **优先取凭据 0.75** 建缓冲 → composer 分辨率只有 renderer 的一半，画面糊。仅当 `render-host` 恰好在 B 会话再次降档触发 `setPixelRatio`（`:315`）时才被纠正。

**这是 ADR-299 §3「尺寸凭据」引入的新残留**——凭据机制本身没错，错在**凭据没有会话边界**。修复方向与 P1-2 同源：`dispose()` 复位 `lastPixelRatio`（最省），或 mount 时同步下发一次。

### P2-6 ｜ 归还判定在 sky 停用期存在错归风险（低概率）

`restoreOutputSettings:494` 用「renderer 当前值 === 本 cap 想写的值」判定归属。若 sky 曾写入过 toneMapping 但此刻**未启用**（`skyOwns` 守卫 `:490` 只在 sky 启用时生效），该判定会把 sky 的残留值误判为「本 cap 持有」并打回构造期快照。

标注为**疑似**：需要 sky 停用 + 残留写入的真实时序才能触发，本次未能在测试中复现。

---

## 三、经核实**不是**缺陷（免下次重复排查）

| 疑点 | 裁定与理由 |
|---|---|
| `getParams().enabled` 是否属冗余旧概念 | **否**。`PostprocessingParams.enabled` 是兼容层字段（供 menu/测试读），真值源是 envState；`postprocessing-state.ts:103` 的 `satisfies Record<Exclude<keyof PostprocessingParams, "enabled">, FieldKind>` 已用类型把它排除在持久化表外，属**有意设计** |
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

## 四、建议处置顺序

| 序 | 项 | 理由 |
|---|---|---|
| 1 | **P1-1**（SSR 尺寸覆盖 + `splice` 绕过同步） | 唯一有可见画质损失（整帧分辨率腰斩）且持续每帧生效；ADR-299 §5 已挂账未修，属欠账 |
| 2 | **P1-2 / P2-5**（会话级字段复位 + 凭据陈旧） | 同一根因（`dispose()` 不复位），一起改；影响「换模型默认值失效」与「新会话分辨率糊」 |
| 3 | **P1-3**（关闭态子控件无反馈） | 用户可感知的「我开了没反应」；修法在菜单层，独立可做 |
| 4 | **P2-4**（改 `ppReflectionMode` 不重建 composer） | 一并消掉 `ssrMaterial` 泄漏 **与** P1-1 的重建面，是结构性收益 |
| 5 | **P2-1 / P2-2 / P2-3 / P2-6** | 尺寸源收口、曝光总开关门、多会话语义、归还错归 |
| 6 | **P3-1 / P3-2 / P3-3**（死代码 + 反事实注释 + 测试真实性） | 零风险清理，顺手做 |
| 7 | 同步知识卡 + 纠版本号 | `preview_env_state.md` 的 ADR-299 段落补「§5 两项已闭环」；ADR 注释/源码注释将 three 写作 **r185** 而实际是 **0.186.1**，属文档漂移，一并订正 |
| 8 | 补测试 | P1-1 的回归锁必须断言**物理量**（`beautyRenderTarget.width`），并**同步改写 `:1117` 那条反向锁定的断言**；P1-2 补「复用实例后 `applyModelPreset` 仍生效」用例 |

**验收标准**：DPR=2、容器 800×600 场景下，`ssrPass.beautyRenderTarget.width === 1600`；`vite build` + `typecheck` + biome + 后处理全量 vitest 绿。

**⚠️ 实施提醒**：修 P1-1 时 `postprocessing-capability.test.ts:1117` 的 `expect(ssr.width).toBe(256)` **必然变红**——那是**预期的**（它锁的是缺陷侧），不要误判成「修复引入回归」而回滚。

---

## 五、方法论说明

- 结论只认当前源码树与 three **0.186.1** 上游源码；ADR 正文里的「病」是决策时的历史快照，已在总判中逐条查证「是否已治」再下结论。
- P1-1/P3-1 与 ADR-299 §5 自述的「未在此 ADR 处理」吻合，但**本报告独立复核了上游源码**（`EffectComposer.js` 的 `setSize`/`addPass` 实现与调用顺序、`SSRPass.js` 的 RT 用途与 dispose 清单、`UnrealBloomPass.js` 的 `resolution` 消费者、`Pass.js` 的基类空实现），不是照抄 ADR 自述。
- **本报告含两处自我更正**（保留痕迹以备审计）：
  1. 初稿称 `ssrPass.setSize` 是「覆盖 composer 刚设好的物理尺寸」——机制描述不完整；**更本质的根因**是 `passes.splice` 直插绕过了 `addPass`/`insertPass` 这唯一的尺寸同步点，SSRPass 自构造起就未被正确初始化。
  2. 初稿称 `test:1117` 的断言「恒真、无法区分两种实现」——**这是错的**。`SSRPass.setSize` 无条件回写入参，该断言**能**区分（256 vs 512），它锁的是**缺陷侧**，属「反向锁定」。
- 已剔除的过度指控：`getParams().enabled` 冗余、tone mapping 撒谎、SSAO 白构造、`applyModelPreset` 覆盖用户值、结构重建泄漏、splice 索引错序、SSR 链首方向——均经源码核实不成立，列在 §三 备查。
- 本报告仅覆盖**后处理子系统内部**。跨系统交互（如 render-host 的整体渲染循环、sky/water 的曝光与反射协同）只在与本子系统缺陷直接相关处点出（P2-2 / P2-5 / P2-6），未做全链路审计。
