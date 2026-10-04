# 地面系统设计探索（Ground Design Probe）

> 子代理提交 · 探索性提案，**未落地、未提交生产代码**。
> 任务来源：鲸鱼架构师（主 agent）完成地面系统几处收口（默认地面开箱即有实体承接面 `groundSourceKind="solid"`、地面自证 e2e+`window.ysmGroundProbe()`）后，要求发散探索「地面还能怎么设计得更好」。
> 红线遵守：前端只读不判 / import 只从具体文件进 / 不改架构 / ADR 只记方向不记进度 / 不 commit。
> 所有实验性代码均在 `artifacts/ground-design-probe/`，**绝不进入 `frontend/src/`**。

---

## 0. 现状速写（已核实，附实证截图）

三层结构（`frontend/src/preview-3d/caps/ground-capability.ts`）：

| 层 | 对象 | y | 显隐判据 |
|----|------|---|---------|
| ① 参考网格 | `GridHelper`（`ysm-ground`，y=0） | 0 | `enabled && groundVisible && groundGridVisible`（`updateGridVisible()`） |
| ② 表面承接面 | `Mesh`（`ysm-ground-surface`，y=0.005） | `GROUND_LAYER_OFFSETS.groundSurface` | `enabled && groundVisible && sourceKind!=="none"`（`updateSurfaceVisible()`） |
| ③ 叠加层 | `Mesh`（`ysm-ground-overlay`，y=0.007） | `GROUND_LAYER_OFFSETS.groundOverlay` | `enabled && groundVisible`（style≠none 时） |

来源轴 `groundSourceKind`（default `solid`，2026-10 收口） × 材质轴 `groundCanvasStyle` × 装饰轴 `groundOverlay`，由 `ground-surface-spec.ts` 的 `buildGroundSurfaceSpec` 单一事实源驱动；配色单一事实源 = `GROUND_MATERIAL_PRESETS`（ADR-254）；默认值单一事实源 = `DEFAULT_GROUND_SURFACE_PARAMS`，被 `env-state-schema.ts` 引用（不变量 5）。

**实证结论（读图回看 e2e 真实截图）**——这是本次探索最重要的起点：

- `frontend/e2e-web/_shots/3d-ground-default.png`（默认 `solid`）：肉眼看到的地面是**蓝灰色**，不是暖棕 `0x9a8b78`。原因是**水面默认开启**（`waterEnabled=true`，蓝色 `0x335577` @ 不透明度 0.25，y=0.01）叠加在表面之上，且表面网格线在半透明水膜下仍透出（z=0.005 与 z=0.01 之间无 depthWrite 差异导致线可见）。
- 网格线**一路延伸到天边并硬切**（地平线处无淡出），远处形成明显的几何边缘。
- `3d-ground-none.png`（切到 none）显示：关掉表面后只剩网格线 + 依然蓝灰的水膜；「自证」有效，但默认视图里水面喧宾夺主。

> ⚠️ **关键洞察**：当前「地面视觉」由三层 + 默认水面共同决定，**默认承接面色 `0x9a8b78` 在默认视角下基本不可见**。任何只调表面配色的提案，若不同时处理「水面覆盖 + 网格地平线硬切」，收益都会被淹没。因此提案 B（地平线淡出）和「默认水面是否该喧宾夺主」是 P0 级配套问题。

实验性视觉产物（用真实像素生成器 `surface-pixels/*` 渲染，非凭空想象）：
- `artifacts/ground-design-probe/_shots/sheet-baseline.png`：plain / marble / sand / grass 现有预设并排
- `artifacts/ground-design-probe/_shots/sheet-prototype.png`：plain 默认 / 暖棕微噪点 / 中性灰微噪点 / checker 叠层
- `artifacts/ground-design-probe/_shots/mock-horizon-fade.png`：网格地平线淡出概念图
- `artifacts/ground-design-probe/_shots/mock-grounding.png`：接地阴影 + 微弱环境反射概念图

---

## 1. 默认地面的视觉语言（暖棕纯色 vs 微纹理/中性/哑光）

**现状**：`DEFAULT_GROUND_SURFACE_PARAMS.matColor = 0x9a8b78`（暖棕，与 `plain` 预设同色）；`solid`/`plain` 在 `generateSurfacePixels` 走 `generatePlainPixels`（`surface-pixels/plain.ts`）——**均匀纯色**，无任何纹理。roughness 默认 0.85、metalness 0（哑光）。

**设计动机**：
- 纯色块在大平面上极易暴露「无限平面」的廉价感；轻微 micro-variation 能让模型「落地」而非「浮在纯色卡纸上」。
- 但默认承接面**必须**不抢模型焦点（中性、低对比、低饱和），且要能被一眼认作「地面」（暖中性棕是安全的「接地」色，纯灰偏冷、纯白偏棚拍）。

**原型思路（已渲染验证）**：在 `generatePlainPixels` 的同口径下叠加一层**无缝微噪声**（复用 `surface-pixels/noise.ts` 的 `tiledFbm`，4D 环面无缝，避免平铺接缝——与现有 marble/sand/grass 同一基建）。幅度 ±5~8 / 255，频率高（24 周期/贴图），人眼几乎不觉察但破坏了「纯色塑料感」。

```ts
// 概念片段（非 src 代码；提案落地时在 generatePlainPixels 内加第二个可选分支）
// 复用 noise.ts 的 tiledFbm —— 零新增依赖、零接缝风险
const n = tiledFbm(u, v, 24, 24, 0, 3) - 0.5;     // [-0.5, 0.5]
const d = Math.round(n * 2 * amp);                 // ±amp
r = clamp255(baseR + d); /* g,b 同理 */
```

候选承接色（保持 ADR-254 单一事实源纪律——只改 `DEFAULT_GROUND_SURFACE_PARAMS.matColor` 与 `GROUND_MATERIAL_PRESETS.plain.matColor`，**不新增色值来源**）：

| 候选 | 16 进制 | 取向 | 验证图 |
|------|--------|------|--------|
| 现状 | `0x9a8b78` | 暖棕，偏「土」 | `tile-plain-default.png` |
| 暖棕+微噪 | `0x9a8b78` ±7 | 保留暖棕认知，去塑料感 | `tile-plain-micronoise.png` |
| 中性哑光灰 | `0x8a8a8c` ±7 | 更「摄影棚/通用承接」，绝对不抢色 | `tile-plain-grey-micronoise.png` |
| 深暖中性 | `0x786c60` ±8 | 更哑、更退后，模型更跳 | `tile-plain-deep-micronoise.png` |

**tradeoff**：
- 微噪点增加极轻的每帧无关成本（只在 surface 重建时算一次 512² ×3 次 tiledFbm，与现有 noise 材质同量级，非热路径）；但**会改变 `generateSurfacePixels` 对 solid/plain 的输出**——须同步更新 `ground-surface-spec.test.ts` 中 plain/solid 的像素断言（知识卡不变量 1 已要求 spec 单源，测试锁死是必要的）。
- 单一事实源纪律：噪点幅度/频率应作为 `DEFAULT_GROUND_SURFACE_PARAMS` 的新字段（如 `matMicroNoise`），而非硬编码进 `plain.ts`，否则破坏「参数单一事实源」。

**建议优先级：P1**（低风险、可逆、显著去廉价感；但须配合提案 B 才完整生效）。

---

## 2. 三层视觉协调（网格强度 / 地平线淡出）

**现状**：
- 网格层在 y=0，表面层 y=0.005，叠加层 y=0.007（`scene-capability.ts|GROUND_LAYER_OFFSETS`）。默认 `groundDivisions=60`、`groundSize=80`、`groundColorGrid=0x2a2a3a`（深蓝灰）、`groundColorCenter=0x555577`。
- 截图实证：网格线**延伸到地平线硬切**，且无远处淡出；默认视角下网格线因水面半透明而「浮在蓝膜上」。
- 网格颜色对比：深蓝灰线 vs 蓝灰水膜 = 低对比但明显；在纯表面（关水面）时线与暖棕面对比也偏弱。

**设计动机**：
- 「网格切到天边」是 3D 预览常见的「未收口」观感；远处应淡出（距离雾/horizon fade），让地面自然融入背景，避免生硬几何边。
- 网格默认强度应略降，作为「锚点」而非「主视觉」。

**原型思路（已渲染验证）**：`mock-horizon-fade.png` 展示了两层淡出——
1. **表面/网格随距离向地平线雾色过渡**（地面远色 → 天际雾色插值），消除硬边；
2. **网格线 alpha 随距离衰减**（近处 ~200，远处 ~60）。

落地切入点（概念，非 src）：
- 网格线淡出：在 `createGridHelper` 后无法逐线改 alpha（GridHelper 是单材质两色）。可行方案：① 把网格改为 `LineSegments` 自建，按顶点距离写 `vertexColors` alpha（需 `transparent` + `vertexColors`）；② 或给网格材质加 `fog = true` 并让场景 `fog`（现默认 disabled，`fogEnabled=false`）在地面场景启用轻雾——但 fog 影响全场景，需评估模型可读性。
- 承接面远淡：表面是 `PlaneGeometry` 单色，无法逐像素淡出；需在水面/背景层做 horizon blend，或给 surface 材质加 `fog` 参与。

**tradeoff**：
- 自建 `LineSegments` 网格替代 `GridHelper` 是较大的重构（破坏 `syncGeometry` 的 `GridHelper` 重建逻辑、`groundColorCenter/Grid` 语义），与「收口」方向相反——**不建议在探索期做**。
- 更轻量：给 GridHelper 材质 `transparent=true` + 依赖场景 `fog`（仅地面场景轻开）实现远淡。但 fog 是全局，需确认不削弱模型阴影可读性（与 shadow cap 协作）。
- 应急最小改动：**默认降低 `groundDivisions`**（60→40）或降低网格线对比（`groundColorGrid` 向面色靠拢），先减轻「网格喧宾」——纯 schema/默认値改动，零架构风险。

**建议优先级：P0**（地平线硬切是默认视图最显眼的「未收口」瑕疵；且零成本的默认値/强度优化可立即上）。

---

## 3. 与模型的关系（阴影 grounding / roughness / 微反射）

**现状**（读 `shadow-capability.ts`）：默认 `shadowEnabled=true`，`applyMeshes()` 对所有 scene mesh `castShadow=receiveShadow=true`——**模型与地面 mesh 都接收阴影**。承接面材质 `MeshStandardMaterial` roughness 0.85 / metalness 0。
- 截图 `3d-ground-default.png`：模型脚下**有接触阴影**（darkening 可见），grounding 基本成立。
- roughness 0.85 偏哑，metalness 0——不「塑料」也不反光；但**完全无环境反射**，模型在地面没有「倒影/接地色」呼应，略显漂浮。

**设计动机**：
- 轻微 envmap 反射（低 strength）能让模型「坐」在地面上（脚边有微弱环境呼应），是产品级 3D 预览的常识手法（摄影棚 floor）。
- 当前 roughness 0.85 对「哑光承接」合理；若降到 ~0.6 并加极低 metalness + envMapIntensity，可获得「微润哑面」而非塑料。

**原型思路（已渲染验证）**：`mock-grounding.png` 展示了① 柔和接触阴影（椭圆模糊、脚下最深）② 模型下方微弱垂直 env 反射（低 alpha、向下渐隐）。

落地切入点（概念）：
- 接触阴影已是 shadow cap 的产出（无需新增）；重点在**默认 shadow 参数是否够「柔」**——`shadowType` 默认 `hard`（schema），建议默认 `soft`（PCFSoftShadowMap），接触更自然（纯 schema 默认値改动）。
- 微反射：surface 材质加 `envMapIntensity`（来自 `scene.environment`，现有 env cap 已烘焙环境图）。这是 `applyGroundSurfaceStructural/Appearance` 的新字段——需进 spec 不变量（外观参数单路径），改动面小但需测试。

**tradeoff**：
- `soft` 阴影默认会轻微增加 shadow map 成本（可忽略，默认已 2048）。
- envMapIntensity 反射若过强会与「中性承接」冲突（抢焦点）；建议默认极低（~0.15）且仅 `canvas/plain/solid` 生效。
- 不改 `metalness`（保持 0）以避塑料感。

**建议优先级：P1**（接触阴影已存在，核心是「默认 soft + 极低 env 反射」两项默认値/小字段优化；收益高、风险低）。

---

## 4. 交互 / 菜单层级（场景预设 vs 原语轴）

**现状**（`ground-menu.ts`，遵循 `MenuNode` schema）：平铺 `ground-visible` + `ground-grid-visible` toggle → `cap-group-ground-grid` folder（size/divisions/两色）→ `cap-group-ground-material` folder（`ground-mat-source` select [none|solid|canvas|texture] + `ground-mat-canvas-style` select [plain|marble|sand|grass|custom] + 各 color/slider）→ `cap-group-ground-overlay` folder（style + color/size/opacity）。

**设计动机**：
- 当前组织是「**原语轴**」视角（来源轴/样式轴/装饰轴），对「设计感探索」不友好：用户想的是「摄影棚 / 自然地面 / 极简灰」这类**场景意图**，而非「sourceKind=canvas, canvasStyle=plain, 再调 roughness」。
- 但架构上三轴正交是已收口的强约束（ADR-249/252/254 矩阵单一事实源），**不能退回到单枚举**。所以提案是「在菜单顶部加一层『场景预设』快捷入口，底层仍驱动三轴」，而非推翻轴。

**原型思路（概念，未写代码）**：
- 在 `cap-group-ground-material` 顶部加一个 `select` 节点 `ground-scene-preset`，选项：`studio`（solid/中性灰微噪/soft shadow/低 env）/ `natural`（canvas/sand or grass）/ `minimal`（solid/深中性/关网格或极淡网格）/ `custom`（回退到逐轴手动）。
- 选中预设 = 一次性写入「来源轴 + 样式轴 + 若干外观字段」，与现有 `setMaterialPreset` 同构（同一事务写入，避免中间态），且不破坏矩阵——预设只是「多轴组合的一键派发」。
- 关键纪律：选预设后用户再手动调任意轴 → 中间件置 `custom`（复用现有 `registerEnvStateMiddleware` 的 manual 置位机制，不变量 11），菜单下拉显示「自定义」。**零新增纪律，纯复用**。

**tradeoff**：
- 增加菜单概念层，但可用 `visibleWhen` 折叠——选 `custom` 或某预设后才展开逐轴 folder，避免信息过载。
- 预设定义须进 `ground-surface-spec.ts`（配色单一事实源 ADR-254 同口径），新增 `GROUND_SCENE_PRESETS` 表，不污染 `GROUND_MATERIAL_PRESETS`。
- 须同步 `scripts/check-menu-test-layout.ts` 的布局基线（新增节点只增不减）。

**建议优先级：P2**（体验增益明确，但属「组织层」重构，需先有 P0/P1 的视觉底座再谈；且依赖三轴纪律不被破坏）。

---

## 5. 可探索的「设计增强」原型（已做 2-3 个）

| # | 原型 | 状态 | 验证物 |
|---|------|------|--------|
| A | 承接面微纹理（无缝 tiledFbm，±7） | ✅ 渲染验证 | `tile-plain-micronoise.png` / `tile-plain-grey-micronoise.png` / `tile-plain-deep-micronoise.png` |
| B | 网格地平线淡出 + 远处软融合 | ✅ 概念图验证 | `mock-horizon-fade.png` |
| C | 网格默认强度/对比优化（divisions 60→40 / 线色向面色靠拢） | 🧪 仅参数，未渲染 | —（纯 schema 默认値） |
| D | 接地阴影（soft 默认）+ 微弱 env 反射 | ✅ 概念图验证 | `mock-grounding.png` |
| E | checker/soft-grid 叠层作为「设计感」承接（替代纯色） | ✅ 渲染验证 | `tile-checker-overlay.png` |

**原型 E 备注**：`generateOverlayPixels` 已有 `checker`；把叠层 style 默认从 `none` 改为某种柔和透明格/棋盘，可在不碰表面层的情况下给默认视图「设计感」。但同样被水面覆盖问题（提案 B 配套）所制约——叠层 y=0.007 < 水面 0.01，仍会被蓝膜压住。

实验脚本（可复跑）：
- `artifacts/ground-design-probe/render-tiles.mjs` — 用真实 `surface-pixels/*` 生成器渲染候选承接色/材质。
- `artifacts/ground-design-probe/mock-3d.mjs` — 2D 概念图（地平线淡出 / 接地反射）。

---

## 6. 优先级汇总

| 优先级 | 方向 | 改动面 | 风险 | 前置依赖 |
|--------|------|--------|------|----------|
| **P0** | 网格地平线淡出 / 远处软融合（消除硬切） | 中（自建 LineSegments 或借 fog） | 中（重构） / 低（仅调默认强度） | 无 |
| **P0** | 默认水面喧宾夺主——评估默认 `waterEnabled` 或降低水膜不透明度/存在感 | 低（默认値） | 低 | 无（独立、立竿见影） |
| **P1** | 承接面微纹理（无缝 tiledFbm，±7） | 低（generatePlainPixels 分支 + 新默认字段） | 低（须同步像素测试） | 无 |
| **P1** | soft 阴影默认 + 极低 envMapIntensity 微反射 | 低（默认値 + 小字段） | 低 | 无 |
| **P2** | 菜单「场景预设」快捷层（studio/natural/minimal/custom） | 中（菜单 + 新预设表） | 低（复用中间件） | 三轴纪律不动 |
| **P2** | checker/soft-grid 叠层作为默认设计感承接 | 低 | 低 | 须先解水面覆盖 |

### 落地状态注记（2026-10-04 拍板批）

- **P0 水面喧宾夺主**：✅ 已落（默认 `waterEnabled=false`，schema 注释有收口记录）。
- **P0 网格地平线硬切（弱化版）**：✅ 已落（divisions 60→40 + 网格色暖中灰 0x8a8278/0x6a6258）。
- **参考网格默认翻转 `groundGridVisible true→false`（2026-10-04 用户拍板「有地面还花」）**：✅ 已落（`c2c6dd208`）——默认源翻 solid 后承接面已承担 y=0 锚点，开箱网格线沦为装饰叠加。效果：上文「网格切天边/喧宾夺主」诸论述仅在**手动开启网格**后成立（问题暴露概率大降），但不替代 P0 真·地平线淡出（硬切仍需架构项根治）。
- **P0 真·地平线距离淡出**：❌ **维持现状 = 已知未收口**（2026-10-04 取证：轻雾路线在 schema 默认雾参数 near=10/far=200 下单变量对照（`e2e-web/fog-horizon-evidence.spec.ts` → `_shots/fog-horizon/`，两图 sha 互异）**未消除平面边缘硬缝**（仅远带向雾色微亮，模型区域零影响）；按拍板纪律「不过关退维持现状、不靠调密度硬救」，真·淡出（自建 LineSegments 顶点 alpha / horizon blend）留作架构项。证据全文 → `docs/audit-ground-review.md`。
- **P1 soft 阴影默认**：✅ 已落（`shadowType` 默认 soft）。
- **P1 承接面微噪点 / 极低 envMapIntensity 微反射**：✅ 已落（2026-10-04 P1 批：`matMicroNoise` 默认 6 ±/255（plain 系生成器 tiledFbm 高频微细节）+ `matEnvMapIntensity` 默认 0.15（外观层原地路径）；两键进 schema/restoreFields，菜单暂不设控件——控件化属 P2 场景预设层的议题）。

---

## 7. 如果只做一件事，做哪个

**做 P0 的「默认水面喧宾夺主 + 网格地平线硬切」配套收口**——具体说：

1. **先评估默认 `waterEnabled` 是否该为真**（或把水膜不透明度/存在感降到「几乎不可见」）。当前默认视图 80% 的「地面观感」来自蓝灰水膜，而非 `0x9a8b78` 承接面——所有表面配色提案都被它淹没。这是**零架构、纯默认値**的改动，却决定了「地面自证」是否成立。
2. **网格远处淡出**（哪怕只是降低默认 `groundDivisions` 65→40 + 线色向面色靠拢的临时方案），消除「网格切天边」的未收口感。

理由：承接面默认配色（提案 1）和微纹理（提案 A）都只能在水面不再压制、网格不再硬切的前提下才显效。先解「上层覆盖 + 地平线硬切」两块 P0，再叠加 P1 的微纹理/微反射，地面视觉会一次性从「廉价未收口」跃升到「产品级」。菜单预设（P2）是锦上添花，可最后做。

> 注：以上均为**提案**，未改动任何 `frontend/src/` 文件、未提交。落地前需：
> - 不变量 5（默认値单一事实源）与 ADR-254（配色单源）纪律不被破坏；
> - 改 `generateSurfacePixels`/plain 像素须同步 `ground-surface-spec.test.ts`；
> - 新增菜单节点须过 `scripts/check-menu-test-layout.ts` 基线（只增不减）；
> - 改完同步知识卡 `docs/knowledge/ground_surface_spec.md`（不变量 17 地面自证若受影响须同步 e2e 与 getter）。
