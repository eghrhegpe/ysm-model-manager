# ADR-271：水面微细节法线 GPU 化（移除 CPU DataTexture 链路）

- **状态**：✅ 已采纳
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-19
- **决策人**：Jieling（人类首席架构师）、AI 代理（deepseek）
- **相关**：`frontend/src/preview-3d/caps/water-capability.ts` / `water-body-strategies.ts`；修正 ADR-255 §2.3（“CPU 法线贴图保留作微细节层”）；收口 ADR-257 §6.3 遗留；延续 ADR-196（envState 单一事实源）

---

## 1. 背景（Context）

ADR-255 §2.3 定下「解析法线为主，CPU 法线贴图降级微细节」：Gerstner 解析法线覆盖 `objectNormal`，
而 `generateNormalMap` 产出的 256² `DataTexture` 保留为法线贴图槽里的微细节层（`normalScale` 控强度）。

这条分工在 ADR-255 的语境下是合理的（主波浪法线不再依赖贴图），但它留下了一条**同步阻塞的 CPU 链路**：

- `getNormalMap()` 的缓存键是 `waterSize`——尺寸一变（`applySize`）或容器重建（pool 结构字段），
  就整块重算 256²：65536 像素 × 每像素 3 个 `Vector2`、3 次 `cos`、一次归一化与量化。
- 该重算发生在**主线程**、在用户拖滑块的同一帧里。

### 1.1 一个互为死锁的登记

ADR-257 §6.3 当时登记了两条遗留，二者恰好构成死锁：

| 登记项 | 内容 |
|---|---|
| A | `waterSize` 在 UI **无入口**（全仓唯一写入点是 `loadState`） |
| B | 放开 size 入口前**须先解决法线重算**（否则拖滑块必掉帧） |

于是：size 没入口，是因为放开会让 CPU 法线重算被高频触发；而 A 之所以能被容忍，
又是因为 B 尚未解决。ADR-255 改造 A 的「size 零重建」优化，实际服务的是**用户不可达的路径**。

### 1.2 实证：这条链路的真实成本

改动前 `water-capability.test.ts` 单文件 **58 例耗时 13.57s**。测试里每个 `WaterCapability`
实例构造时都会生成一次 256² 贴图，累积出的耗时即该链路的直接度量（同机同轮，见 §3 对照）。

---

## 2. 决策（Decision）

### 2.1 微细节法线改为 fragment 程序化

在 `#include <normal_fragment_maps>` **之后**注入：

- 取世界水平坐标 `dp = vWorldPos_wave.xz * 2.0`（×2 复刻原贴图的世界映射：覆盖 `[-uSize, uSize]`）；
- 求三组方向正弦沟槽的偏导（方向与相位参数**逐项同源于** `generateNormalMap`：`0.08/0.8`、`0.05/1.1`、`0.03/1.6`）；
- 组装世界空间切向扰动 `detailWorld = vec3(-dhdx, 0.0, -dhdz) * uDetailStrength`；
- 经 `viewMatrix` 送入视图空间后叠加：`normal = normalize(normal + (viewMatrix * vec4(detailWorld, 0.0)).xyz)`。

**搬迁只换执行位置，不换谱线**——这是观感连续的前提。

### 2.2 为何必须在 fragment（而非 vertex）

水面是单位平面 × `scale(uSize, uSize, 1)`、网格 64×64，默认 `waterSize = 80` →
每格约 1.25 世界单位；而最细一组沟槽频率 `1.6` → 波长 `2π/1.6 ≈ 3.9` 世界单位，
**每波长仅约 3 个顶点**。放到 vertex 必然是欠采样走样（高光抖动、细节丢失）。
只有逐像素求值才承担得起这层频率——这正是原实现用 256² 贴图（每像素 0.625 世界单位）的理由，
故搬迁的目标位置是 fragment，不是 vertex。

### 2.3 强度 uniform 化

`uDetailStrength` 取代 `normalScale` 槽位：`onBeforeCompile` 期取 `envState.waterNormalStrength` 为初值，
运行期由 `applyChangedParams` 的就地分派同步（与 `uChoppiness` 同模式）——无贴图重建、无 `needsUpdate`。

### 2.4 严格删除 CPU 链路（不留零消费者残骸）

按项目不变量「零消费者字段即时删除」：`getNormalMap` / `generateNormalMap` / `normalMapCache` /
`normalMapCacheSize` / `safeDispose` import 全数退场；`WaterBuildContext.getNormalMap` 移除；
`applySize` 签名收敛为 `(body, size)`——形态装配不再需要任何法线交付。

### 2.5 守卫同步

`onBeforeCompile` 的注入检测新增 `detailOk`（`normal = normalize(normal +` 落地检查）。
贴图链路既已删除，该锚点失配即等于**静默丢细节**，故必须显式告警。

---

## 3. 后果（Consequences）

### 正面

- **ADR-257 §6.3 的死锁被解除**：改 `waterSize` 不再有任何 CPU 重算，
  「放开 size UI 入口」的前置条件（原 B 项）就此消除。
- **实测加速**：`water-capability.test.ts` 由 58 例 / **13.57s** → 59 例 / **1.29s**（同机、同轮次、增量断言）。
- 微细节不再受 256² 分辨率与双线性插值的限制——解析式求值，频率精细度只受屏幕像素约束。
- 少一张常驻纹理与一次上传，显存与纹理槽位占用下降。

### 负面 / 代价

- **per-pixel 计算换 per-pixel 采样**：fragment 每像素多 3 次 `cos` + 1 次 `mat4 × vec4`。
  代价是实的，但省掉了 CPU 侧整链与贴图上传——在模型预览器的定位下这笔交换成立。
- **与原贴图不可能逐像素一致**：贴图是离散采样 + 双线性插值，解析式是连续函数。
  同谱线、同强度，视觉连续，但不保证逐像素相同。若日后需要严格等价，得回到贴图路线（不推荐）。
- 三个方向向量与振幅**硬编码在 GLSL**，不再能由 TS 侧数据结构驱动（可配置性下降一档）。

### 已知遗留

- `waterSize` 仍是**无 UI 入口**：本 ADR 只解除前置条件 B，**未**新增滑块（原 A 项仍待做）。
  → **已收口（ADR-272，2026-09-19）**：`ground-water-size` 滑块落地。原本「A 与 B 必须一起做」的
  另一半（pool 尺寸全量重建）也在同一次收口（`sizeLinks` 零重建），两条卡点至此全消。
- ADR-257 §6.4 顺带记录的「振幅钳制抹平几何级数」（`amp = min(0.6·0.82^i/freq, 0.5)` 使 wave0–4 全顶到 0.5）
  **本次未动**——改钳制会动波形观感，仍维持「仅登记」的既有结论。
- ADR-257 §6.3 记录的「圆角裁剪隐含水面恒在世界原点」（`max(|worldX|, |worldZ|)` 对比 `uHalfSize`）
  同样未动，本 ADR 不扩大范围。

### 兼容性

- 公开 API（`setNormalStrength` / `getNormalStrength` / 菜单节点 `ground-normal-strength`）**零变更**，
  存档键 `waterNormalStrength` 不变，用户存档无损。
- 仅内部结构变化：`WaterBuildContext` 缺一个成员、`applySize` 少一个参数。

---

## 4. 验证（Verification）

- `water-capability.test.ts` **59 例全绿**（含新增 2 例、改写 4 例）。
- 新增/改写断言：
  1. `uDetailStrength` 编译期初值与运行期就地同步；
  2. `normal_fragment_maps` 锚点顺序（注入必须在 `normal` 产出之后）；
  3. 三组沟槽参数逐项在场（防搬迁中悄悄改谱）；
  4. 缺 `normal_fragment_maps` 锚点 → 告警（静默失效防线）；
  5. 材质 `normalMap` 恒为 `null`，且 `getNormalMap` / `generateNormalMap` 已从 cap 上消失（反向证据）；
  6. `dispose` 幂等且实例上无 `normalMapCache` / `normalMapCacheSize` 字段。
- 门禁：`npm run typecheck` ✅ · `npx vite build` ✅ · `node scripts/check-biome.ts --files <改动文件>` ✅。

---

## 5. 备选方案（Alternatives Considered）

| 方案 | 为何否决 |
|---|---|
| **保留贴图，仅把生成降采样 / 分块** | 治标。重算仍占主线程，只是变小；§6.3 的死锁照旧存在。 |
| **把微细节法线放 vertex 程序化** | 欠采样（§2.2）：64×64 网格对 3.9 世界单位的波长只有约 3 个顶点，细节必走样。 |
| **预生成贴图一次、size 变更只调 UV 重复次数** | `waterSize` 的世界语义本就靠 UV 缩放表达，但贴图分辨率固定 → 放大后细节糊成块，且仍需处理重建时的贴图复用，收益不抵复杂度。 |
| **引入可配置的 GLSL 参数表（TS → shader 注入常量）** | 当前只有一组谱线、无第二个消费者，属凭空建模（YAGNI）。若日后要出「湖面/海面/冰面」谱线预设，再评估。 |

---

## 6. 数据溯源

用户提问「当前项目的 three 的水面设计如何」→ AI 代码审查（`grep` + 读 `water-capability.ts` /
`water-body-strategies.ts` / ADR-255 / ADR-257）→ 定位 §6.3 死锁与 §6.4 遗留 →
用户指令「尝试」授权实施 → TDD 改造（先改测试契约再改实现）→ 门禁全绿 + 耗时实证 → 本文档。
