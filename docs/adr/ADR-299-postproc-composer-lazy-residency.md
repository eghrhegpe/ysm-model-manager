# ADR-299：后处理 composer 惰性常驻——生命周期与每帧参与解耦（修订 ADR-250 §2.2）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-24
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/caps/postprocessing-capability.ts, frontend/src/preview-3d/infra/render-host.ts, frontend/src/preview-3d/infra/postproc-cost-probe.ts, frontend/src/preview-3d/state/env-state-schema.ts, ADR-250, ADR-196`

---

## 1. 背景（Context）

ADR-250 §2.2 把 composer 的生命周期从**模型轴**移到**会话轴**（构造即建、dispose 才拆），
根治了「换模型 → 门禁翻转 → 整组 GPU 资源重建」这一缓存失效病。方向正确，但落地时
**「生命周期常驻」被实现成了「每帧都走 composer」**：

- `needComposer()` 退化为 `return this.composer !== null`（构造即建 ⇒ 恒真）；
- `render()` 因此恒返回 `true`，`render-host.ts` 那句
  `if (!rendered) infra.renderer.render(...)` 的直渲兜底成为死代码；
- 而 `ppEnabled` 的 schema 默认值是 **`false`**（`env-state-schema.ts`）。

即：**默认关闭后处理的会话，一辈子不启用，却每帧都付一次离屏渲染 + MSAA resolve + 全屏 blit，
并常驻一对 HalfFloat MSAA×4 读写缓冲。**

ADR-250 §2.2 自述的代价是「常驻显存」，缓解语焉不详；它换来的是**低频**事件（换模型）不重建，
付出的是**每帧**成本——性价比倒挂，需要实测裁定。

## 2. 实测（ADR-250 §2.2 代价量化）

用 `postproc-cost-probe.ts`（本仓 3D 侧探针，A/B 每帧交替采帧、GPU 主指标走
`EXT_disjoint_timer_query_webgl2` 的 `TIME_ELAPSED`）在真机取样：

| 口径 | GPU ms/帧 |
|---|---|
| 直渲基线（`renderer.render`，无 composer） | 1.96 |
| 关闭后处理但走 composer | 3.02 |
| 开启后处理（默认参数） | 3.48 |

- **常驻税 = 1.05 ms/帧，+53.7%**（阈值判据：>0.5ms 或 >5% → 双双超线）。
- **管线比载荷贵 5 倍**：开启态全部成本 1.26ms，其中真实效果（默认参数下
  bloom/ssao/ssr 全关）只占 0.21ms，其余 1.05ms 是 composer 管线自身的过路费。
- **1.05ms 是下界**：取样画布 948×610 ≈ 578k px @DPR1。成本主体是 MSAA resolve 与
  HalfFloat 全屏 blit 的带宽，近似随像素数线性放大——1080p 全屏约 3.8ms/帧，DPR2 再翻 4 倍。
- 常驻显存：读写双缓冲 35.3MB（同尺寸）；1080p@DPR1 约 126.7MB，DPR2 约 506MB。
- CPU 提交时间一栏**反直觉**（composer 0.80 vs direct 3.20），是驱动异步 + vsync 排队污染，
  **不可用于归因**——这条反过来印证了探针「只信 GPU 时间」的设计：只测 CPU 等于什么都没测。

## 3. 决策（Decision）

把两件事**拆开**，各自按自己的轴管理：

| | 轴 | 规则 |
|---|---|---|
| composer **生命周期** | 会话轴（沿用 ADR-250 §2.2） | **首次启用**才建；建后不随启用意图/换模型销毁（仅 `dispose()` 才拆） |
| composer **每帧是否参与** | 启用意图轴（本 ADR 新增） | `needComposer() === composer !== null && enabled`；关闭态 `render()` 返回 `false`，交回 render-host 直渲 |

落地三点（`postprocessing-capability.ts`）：

1. **构造期不再无条件建**：`if (this.enabled) this.buildComposer(false)`。
   覆盖「存档恢复 / 调用方显式传 `enabled=true`」的初始态；默认会话零分配。
2. **唯一惰性创建点** = `applyEnabledSideEffects()`：
   `if (this.enabled && !this.composer) this.buildComposer(false)`。
   `syncReflector=false`——reflector 抑制由本函数末尾那次 `applyReflectorSync()` 统一落地，
   避免「buildComposer 内一次 + 此处一次」的重复触发。
3. **尺寸凭据**：新增 `lastW / lastH / lastPixelRatio`，`setSize` / `setPixelRatio`
   **无条件记录**（原先被 `if (this.composer)` 整块包住，惰性化后关闭态的 resize 会丢）。
   创建时优先取凭据，无凭据才回落 `renderer.getSize()` 与 `previewPixelRatio(devicePixelRatio)`
   ——否则自适应降档（`render-host` 的 `sampleAdaptivePixelRatio`）之后才启用，会按
   devicePixelRatio 建出与 renderer 实际像素比不符的缓冲。

`render()` 内原先的 `on &&` 旁路判断随 `needComposer` 的收紧而成为恒真，已删；
pass 的 `enabled` 直接由 `envState` 子开关决定。

## 4. 备选方案与理由

| 备选 | 否决理由 |
|---|---|
| 只做「关闭态旁路」（保留构造即建） | 省下每帧 1.05ms，但 35.3MB 读写缓冲仍常驻——默认关闭的用户依然白付显存 |
| 关闭即 `disposeComposer()` | 回到 ADR-250 要根治的病：启用意图随模型类型翻转 ⇒ 反复重建整组 GPU 资源 |
| 延迟到首帧再建 | 与「首次启用才建」相比无额外收益，且首帧无条件付费 |
| 保留现状（不动） | 实测 1.05ms/帧 + 53.7%，超阈值；管线成本是载荷的 5 倍 |

## 5. 代价与残留

- **首次启用有一次构建尖峰**（若干 RT + pass 的一次性分配，几十 ms 量级）。
  可接受：它是用户主动点开关触发的动作，有心理预期；且换来了该会话此后的零抖动。
- **启用过一次再关闭的用户，35.3MB 仍常驻**。这是「建后不销毁」的对价，
  用一次性的显存换「启停/换模型零重建」，符合 ADR-250 §2.2 的原始取舍。
  真正零成本的是**从未启用**的会话——即默认路径上的绝大多数。
- **未在此 ADR 处理**：`setSize` 中手写同步 `ssrPass.setSize(width, height)` 传的是**逻辑**尺寸，
  会覆盖 `composer.setSize` 刚设好的物理尺寸（DPR>1 时 SSR 的 RT 掉分辨率）；
  另 `bloomPass.resolution` 是死代码（`UnrealBloomPass.setSize` 不读该字段）。
  属独立缺陷，另案处理。

## 6. 验证

- `postprocessing-capability.test.ts`：4 处旧断言按新语义改写
  （关闭态不建 / 关闭态 `render()` 返回 false / 建后启停往返零重建 / pass 旁路改由子开关驱动），
  并新增 1 条**尺寸凭据契约测试**（关闭态 `setSize(800,600)` + `setPixelRatio(2)`
  → 惰性创建的 composer 缓冲必须是 1600×1200，而非回落 devicePixelRatio）。
- `preview-3d` 全量 vitest 160 文件通过；typecheck、biome、check-layering、check-path-hygiene 通过。
- 真机复核：改后应能在关闭态把 `ysmPostprocProbe()` 的两臂差值压到噪声量级
  （关闭态已不走 composer，A/B 两臂路径趋同）。
