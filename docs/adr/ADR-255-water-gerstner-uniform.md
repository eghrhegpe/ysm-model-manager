# ADR-255：水面波浪 uniform 化 + Gerstner 升级

- **状态**：✅ 已采纳
- **日期**：2026-09-16
- **决策人**：Jieling（人类首席架构师）、AI 代理（deepseek）
- **相关**：`frontend/src/preview-3d/caps/water-capability.ts` / `water-menu.ts` / `water-state.ts`；`frontend/src/preview-3d/state/env-state-schema.ts`；`frontend/src/preview-3d/shader-patches/patch-guard.ts`；参考行业 three.js WaterThreeJS（analytic Gerstner spectrum + SSR）/ Unity HDRP Water（Gerstner+FFT 混合）/ Crest / Stylized Water 3（Planar/SSR/Probe 反射路线对比）；ADR-196（envState 单一事实源）、ADR-195（cap 直产菜单节点）

---

## 1. 背景（Context）

`WaterCapability` 当前波浪是 `buildWaveWaterMaterial` 内 `onBeforeCompile` 注入的 **3×`sin` 固定顶点位移**（`water-capability.ts:140-155`）：波峰波谷同形、无水平位移、无碎波泡沫，视觉上限明显（即"伪水"）。性能上两点被锐评：

- **`waterSize` 变更触发 `rebuildWaterContainer` 全量重建几何 + 法线缓存**（`:353`），桌面拖 size slider 必卡顿。
- **pool 模式用 `MeshPhysicalMaterial` 的 `transmission`** 每帧额外 RT 采样，弱机有成本且 `transparent:true`+`depthWrite:false` 易出排序瑕疵。

行业主流（three.js / Unity / Crest）已是 **Gerstner 余摆线**：顶点同时水平+垂直位移（trochoidal），波峰尖波谷平；解析法线（GPU Gems 1 ch.1，无需法线贴图/有限差分）；Jacobian 行列式负值 → 碎波泡沫种子；O(N) 顶点着色器、单 pass，手机可 60fps。尺寸/波长/振幅全走 uniform，几何只建一次。

## 2. 决策（Decision）

### 2.1 波浪 sin → Gerstner（改造 B）

复用现有 `onBeforeCompile` 注入点（`:115-189`）重写：

- **vertex**：注入 `gerstner()` 求和——对每个波 `i` 计算水平+垂直位移；陡度 `Q = choppiness / (k·A·N)`，hardcode 钳制 `ΣA·k < 0.8` 防自交（波峰变 cusp 后自穿插）。方向/相位由 wave index 的 hash 播种，`freq *= 1.19, amp *= 0.82` 几何级数，约 6 波。
- **解析法线**：每个波累加偏导，按 GPU Gems 公式 `N = normalize((-ΣDx·WA·c, 1 - ΣQ·WA·s, -ΣDz·WA·c))`，在 `#include <beginnormal_vertex>` 后覆盖 `objectNormal`，PBR 光照自动采用波浪法线（不另写法线注入）。
- **泡沫**：Jacobian `J = (1+jxx)(1+jzz) - jxz²`，`J < 0` → `smoothstep` 碎波泡沫 varying；fragment 在 `#include <dithering_fragment>` 后 `mix` 白沫。
- **复用 `uTime`/`waterTime`**（`:373` `update` 累加 `dt*waveSpeed`），不新建时间驱动。

### 2.2 尺寸 uniform 驱动、不重建几何（改造 A）

- **film 几何改单位平面** `PlaneGeometry(1, 1, 64, 64)` + `mesh.scale.set(size, size, 1)`；shader 用 `uSize` 把局部 `±0.5` 映射到世界尺寸算波频/法线。
- **`waterSize` 变更分派**：film 走 `scale`（不重建几何、法线缓存在 applyChangedParams 重取）；pool 的 `waterSize` 变更走**全量 `rebuildWaterContainer`**（顶/底/壁一并重建——needsRebuild 条件为 `waterSize && mode===pool`，顶面不经 scale 路径，与 §3 已知遗留一致，低频接受）。
- `registerEnvCallback` 的 `needsRebuild` 中 `waterSize` 改为**仅 `mode==="pool"` 触发重建**（`:74` 附近）。

### 2.3 解析法线为主，CPU 法线贴图降级微细节

`generateNormalMap`（`:584`）**保留**作滚动微细节法线层（`normalScale` 控制强度），主波浪法线改 Gerstner 解析（注入 `objectNormal`），两者叠加不破坏现有 `setNormalStrength→normalScale` 断言（测试 L84-86）与 `getNormalMap` size 缓存断言（测试 L532）。

### 2.4 新增 `waterChoppiness` 字段（ADR-196 单一事实源）

`env-state-schema.ts` 的 `water` 组加 `waterChoppiness`（默认 `0.5`，范围 `0-1`）作 Gerstner 陡度旋钮；`WaterCapability` 加 `setChoppiness`/`getChoppiness`，`water-menu.ts` 在 look 组加 slider，`saveState`/`loadState` 双轨兼容（与既有 `water*` 键同处理）。

## 3. 后果（Consequences）

### 正面
- 波峰尖、波谷平、有碎波泡沫——像真水（治"伪水"视觉上限）。
- `waterSize` 拖动零卡顿（uniform/scale，不重建几何与法线缓存）。
- 仍单 pass、vertex 算 Gerstner（6 波），桌面帧预算安全；泡沫仅 fragment 一次 `mix`。
- 不碰 transmission/反射/FFT，不抢模型预览主帧预算（模型预览器定位正确的克制）。

### 负面
- 注入符号从 `float wave(` 改名 `vec3 gerstner(`，须同步 `water-capability.ts` 的 `vertexOk` 检测（`shader.vertexShader.includes("vec3 gerstner(")`），否则 shader-patch 守卫误告警。
- pool 模式 `waterSize` 变更仍全量重建（顶/底/壁一并 rebuildWaterContainer，底/壁几何耦合 thickness），属接受项（低频拖动）。

### 风险
- three `REVISION` 守卫范围 `[185,189]`（`:123`）：本次只改注入内容、不依赖锚点变更，锚点稳定则守卫通过；升级 three 后须重跑水面 shader 测试审计。
- 总陡度 `ΣA·k` 必须 hardcode `< 0.8`，否则波面自交。

### 已知遗留
- pool `transmission` RT 成本 / 透明排序（改造 C）未纳入本次，列为可选后续。
- 未引入 Planar/SSR 反射（对模型预览器收益低、抢帧预算），与行业"互补叠加"路线在本项目刻意取舍。

### 补记（2026-09-18）：解析法线**当时未落地**，本次才补齐
- 事实核对：本 ADR 采纳时，§2.1/§2.3 承诺的「解析法线覆盖 `objectNormal`」**并未实现**——代码内注释
  自认为遗留项（"解析法线注入 objectNormal 为 ADR-255 遗留项"），实际只交付了顶点位移 + Jacobian 泡沫，
  而 `gerstner()` 里为算泡沫累加的三个偏导（jxx/jzz/jxz）没有一处在法线上。
- 后果（静默的视觉债）：波峰位移是真的、明暗是假的。光照法线仍来自 256² CPU 法线贴图，
  与 Gerstner 波形无关 → 波峰高光与波峰错位；改 `choppiness` 时位移变化而高光不变。
- 本次收口：`gerstner()` 增设 `out vec3 nrm`，按 GPU Gems 1 ch.1 三项偏导累加
  （`nrm.x -= dir.x·wa·c` / `nrm.y -= dir.y·wa·c` / `nrm.z -= steep·wa·s`，终值 `nrm.z += 1.0` 后归一化），
  于 `#include <beginnormal_vertex>` 之后注入 `objectNormal = ysmWaveNormal`（物体空间，局部 z 即高度轴）。
  至此本文档 §2.3「解析法线为主，CPU 法线贴图降级微细节」与实现一致。
- 守卫同步：注入检测新增 `normalOk`（`objectNormal = ysmWaveNormal` 落地检查），三处锚点任一失配即告警。


## 4. 数据溯源

- 用户需求"three 水面设计如何 / 行业内如何解决"→ 网页搜索行业实践（three.js WaterThreeJS Gerstner spectrum + SSR / Unity HDRP Gerstner+FFT / Crest Planar+SSR+Probe / Stylized Water 3 反射路线对比 / 移动端 Tier 分级）→ 锐评定位 YSM 为模型预览器，"伪水"可接受、真正要命是两块工程债 → 出方案拍板 A+B → TDD 改造（同步测试 L263/L265/L532 契约）。
