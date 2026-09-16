# ADR-254：地面材质预设化：材质名兑现配色 + 显式预设状态

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/caps/ground-surface-spec.ts`、`frontend/src/preview-3d/caps/ground-capability.ts`、`frontend/src/preview-3d/caps/ground-menu.ts`、`frontend/src/preview-3d/state/env-state.ts`、`frontend/src/preview-3d/state/env-state-schema.ts`、[ADR-249](ADR-249-ground-material-axis-split-layer-overlay.md)、[ADR-251](ADR-251-ground-material-family-completion.md)、[ADR-252](ADR-252-ground-canvas-style-material-only.md)
- **外部参照**：MikuMikuAR `frontend/src/scene/env/env-ground-presets.ts`（`GROUND_PRESETS` / `GROUND_PRESET_KEYS` / `buildGroundPresetEnvState`）、`_bridge/env-bridge.ts`（`resetGroundPresetOnManualEdit` middleware）、`docs/adr/adr-208-ground-preset-sourcekind.md`

---

## 1. 背景（Context）

### 1.1 用户提问暴露的名实不符

ADR-252 收敛材质轴后，用户追问：

> 切换到草地时，他会是绿色材质地面的吗？

核实（源码实证）：

- `DEFAULT_GROUND_SURFACE_PARAMS`：`matColor: 0x9a8b78`（暖灰棕）、`matColor2: 0x6b5d4c`（深棕）；
- `generateSurfacePixels` 的 grass 分支只在 `color ↔ color2` 之间做噪声插值（`freq=5*density*grain`、`contrast=0.95`）；
- `GroundCapability.setCanvasStyle` **只写 `groundCanvasStyle`，不碰颜色**。

**结论：选「草地」得到的是棕色斑块，不是绿色。**「大理石」同理是棕色纹路。

### 1.2 病根：一个参数同时承诺了两件事

`st.mode = "grass"` 承诺了「这是草地」（**语义/预设**），实际只输出「中频 + 高对比」（**纹理形状**）。颜色是正交参数，与形状不联动。

即材质名是**预设**语汇，实现却是**原语**语汇。名称撒谎，用户按名期待必落空。

### 1.3 两条出路与邻座实证

- **A 让名字兑现**：材质 = 预设包（形状 + 配色）。
- **B 让名字闭嘴**：材质名改为纹理形状名（均匀/细颗粒/斑驳），不承诺材质。

**邻座（MikuMikuAR）实证选 A**，且其做法解决了 A 的唯一痛点（覆写用户调色）：

| 邻座机制 | 作用 |
|---|---|
| `GroundPreset` 全量字段（含 `groundColor`/`groundLineColor`） | 预设 = 一次全量 patch，非单色覆盖 |
| `groundPreset: ... \| 'custom'` 显式状态字段 | 「当前处于哪个预设」是**可见事实**，菜单可打勾 |
| `GROUND_PRESET_KEYS` 精确白名单 | 判定「手改是否脱离预设」；**刻意排除**预设不管的字段 |
| `resetGroundPresetOnManualEdit` middleware（`pre-fase`） | 手改预设关心的字段且本次未显式带 `groundPreset` → 置 `'custom'` |

**关键教训（邻座注释原文）**：用**精确白名单而非前缀匹配**，「避免碰撞/无限/滚动/地形等预设不管的字段被改时误清预设标记（参照 `_WATER_KEYS` 精确清单教训）」。

**邻座的诚实**：其「草地」预设 `sourceKind: 'texture'`，直接用 `textures/grass.png` + 绿 tint `[0.3,0.5,0.25]`——**程序化做不好的就用贴图，不硬凑**。

### 1.4 被否决的方案：隐式守卫（A′）与撤销 toast

- **A′「仅当颜色未被手改过才套用」**：复用 `_writeSource` 脏标记。**否决**——`_writeSource` 追踪「谁写的」而非「用户是否想要」，导致**同一控件两种行为**且用户无从得知原因。隐式条件是交互设计里最贵的东西。
- **撤销 toast**：可用但劣——撤销是**时间维度**的补救（窗口过期即失效）；显式预设状态是**空间维度**的事实（永远挂在菜单上）。后者严格更好，且更可测。

---

## 2. 决策（Decision）

采用 **A（材质名兑现配色）**，并以**显式预设状态**（而非隐式守卫或撤销）解决覆写痛点。

### 2.1 `GROUND_MATERIAL_PRESETS` 预设表（单一事实源）

材质预设 = **形状（`canvasStyle`）+ 配色（`matColor`/`matColor2`）+ 颗粒参数** 的完整定义：

```ts
plain  素面    → matColor 暖灰棕系
marble 大理石  → 浅灰白底 + 中灰纹（非棕）
sand   沙子    → 沙黄系（高频低对比）
grass  草地    → 绿系（中频高对比）
```

预设表是**唯一**的配色事实源；菜单选项与 `setCanvasStyle` 均从它派生。

### 2.2 新增 `groundMaterialPreset` 显式状态字段

`groundMaterialPreset: 'plain' | 'marble' | 'sand' | 'grass' | 'custom'`

- 选材质 → 写入 `groundMaterialPreset: <该材质>` + 该预设的形状与配色（**一次事务**）。
- 手改预设关心的字段 → 由 middleware 置为 `'custom'`（见 §2.3）。
- **`groundCanvasStyle`（形状）与 `groundMaterialPreset`（配色出处）是两个字段**：`custom` 态下形状保留上一次所选，仅配色归属变为「用户自定义」。这与邻座 `groundPreset` / `groundStyle` 并存同构。

### 2.3 `GROUND_MATERIAL_PRESET_KEYS` 白名单 + middleware

引入最小 **envState 写入 middleware** 机制（邻座 `registerEnvStateMiddleware` 的等价物）：

```ts
registerEnvStateMiddleware((patch) => {
  if (patch.groundMaterialPreset !== undefined) return;      // 预设点击自带 → 不误清
  if (GROUND_MATERIAL_PRESET_KEYS.some((k) => patch[k] !== undefined)) {
    return { groundMaterialPreset: "custom" };
  }
});
```

- 白名单为**精确清单**（`as const satisfies readonly (keyof EnvState)[]`），**禁止前缀匹配**（邻座 `_WATER_KEYS` 教训）。
- 白名单与预设表写入的字段**一一对应**，断言测试锁定：预设写的字段必在白名单内，反之亦然。
- 改预设不管的字段（`groundSize`/`groundVisible`/`groundOverlay*`/`groundMatOpacity` 等）**不清预设**。

### 2.4 菜单：下拉值 = 预设状态

材质下拉的 `get/set` 改走 `groundMaterialPreset`；新增 `自定义` 项（`custom`）供 `custom` 态显示。手选 `custom` 为无操作（保留当前形状与配色）。

### 2.5 一并收口：`plain` 与 `solid` 的冗余（#b）

`canvasStyle=plain` 与 `sourceKind=solid` **视觉等价**（都是平坦 `matColor`）：前者生成均匀贴图，后者 `tex=null` 直出 color。

**决策**：`plain` 走 `tex = null` 路径，删除 `makeGeneratedTexture` 对 plain 的无谓调用。与 ADR-252 收口 grid/checker 重复同类——**同一输出不留两条实现路径**。

### 2.6 不做什么

- **不改 Go**（同 ADR-249 §2.7）。
- **不做 PBR 三件套**：邻座的木纹/金属带 albedo/roughness/normal 三贴图，本项目目标域是模型查看器地面，不值得。材质保持现有噪声实现，仅补正确配色。
- **不引入贴图资产（且不必须）**：⚠️ 见 §5 更正——「贴图 vs 程序化」并非本题分歧点，且我们的程序化路径**已产出平铺贴图**。
- **不合并旧网格层**（ADR-249 病例 C）：属独立收敛，本次仅登记（见 §3 已知遗留）。
- **不抽「纹理形状」为独立用户轴**：邻座亦未拆（其 `sourceKind` 是预设层判别式、不落 envState）。B 方案的内核（形状与原语可组合）**降级为内部实现细节**，保留为未来扩展空间，本次不移到 UI。

---

## 3. 后果（Consequences）

### 正面

- 材质名兑现：「草地」是绿的，「大理石」是灰白纹路——用户按名期待即所得。
- 覆写痛点被**显式状态**消解：手改后状态变 `custom`，菜单可见，用户知道「已脱离预设」。
- 无隐式条件：行为唯一且可预知（选材质每次都套，永远套）。
- 比撤销 toast 更长效、更可测（middleware 可用单测直接覆盖三条件）。
- 白名单与预设表有一致性断言，杜绝两处漂移。
- 顺带删除 `plain` 的冗余贴图路径。

### 负面 / 代价

- 切换材质会**覆写**用户已调的颜色——由 `custom` 状态显式暴露，而非静默。
- 新增一个状态字段与一个 middleware 机制（后者为通用基建，未来其他 cap 可复用）。
- 存档需新增字段默认值（旧存档 `groundMaterialPreset` 缺省 → 按 migrate 推断或置 `custom`，见知识卡）。

### 已知遗留

- 旧网格层（y=0）与表面层字段语义重叠（ADR-249 病例 C），**本次仅登记不收敛**。
- 程序化草/大理石**形状**仍是**各向同性噪声近似**，非草叶/脉络的真实结构——这是**生成器形状质量**问题，非「缺贴图资产」（见 §5 更正）。
- 噪声材质的 `density` 属 structural，拖动触发 512² × 3 次 `valueNoise` 重建（ADR-252 已登记的性能观察）。

---

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| 用户提问「切换到草地时，他会是绿色材质地面的吗」 | §1.1 名实不符定位 |
| `DEFAULT_GROUND_SURFACE_PARAMS` 色值 + grass 分支插值 + `setCanvasStyle` 只写样式 | §1.1 三处实证 |
| 用户分析：一个参数同时承诺语义与形状 | §1.2 病根 |
| 邻座 `env-ground-presets.ts`（`groundPreset`/`GROUND_PRESET_KEYS`/`buildGroundPresetEnvState`） | §1.3 机制蓝本 |
| 邻座 `env-bridge.ts:resetGroundPresetOnManualEdit` + `_WATER_KEYS` 教训注释 | §2.3 精确白名单（禁前缀匹配） |
| 邻座 grass 预设 = `textures/grass.png` + `[0.3,0.5,0.25]` | §5 更正：差异在**生成器形状质量**，非「有没有 PNG」 |
| 用户否决 A′「隐式守卫」与撤销 toast 的论证 | §1.4 被否方案 |
| `rebuildSurface` 中 plain 走 `makeGeneratedTexture`、solid 走 `tex=null` | §2.5 #b 冗余收口 |

---

## 5. 更正（用户复核）

本 ADR 初稿把「邻座用 `grass.png`」框定为「程序化做不好就投降/需引贴图资产」，**该框架错误**，用户复核指出：

> 隔壁的噪声图只是预先生成好的……总之 grass 是确保无限地面之类的也能用上噪点图，不一定真的要往项目放 png。

**正确认识**：

1. **贴图是「可无限平铺的载体」**，不是「程序化的替代品」。大平面/无限地面需要内容能无缝重复——这正是贴图（`RepeatWrapping` + `repeat`）解决的问题。
2. **我们的程序化路径已具备该能力**：`makeGeneratedTexture` 产出 512² `DataTexture` + `RepeatWrapping`，再由 `textureRepeat(meshSize, scale) = meshSize/TILE_WORLD_SIZE/scale` 驱动 `repeat`——地面尺寸变化时平铺密度自适应。**因此不需要 PNG。**
3. **颜色未被忽视**（核实）：邻座 `env-ground-spec.ts:170` 有 `color: state.groundColor`（颜色进 spec）；我们则把 `matColor`/`matColor2` **烘焙进生成像素**（材质 color 留白乘）。两边都应用颜色。
4. **真正的差距是生成器形状质量**：我们的 `grass` 是**各向同性**噪声（圆形斑块），草叶应呈**各向异性**（定向纤维）；`marble` 应呈**脉络**而非斑块。这属像素生成函数的形状建模，**与是否使用贴图资产无关**。

**影响**：§2.6「不引入贴图资产」一项**非必要**——它不是缺点的补偿措施。若未来提升形状质量，两条路均可：改噪声函数（保平铺、零资产），或改预生成/加载贴图（同为平铺载体）。本 ADR 不锁定。

---

## 6. 行业对标 + 形状质量落地（4cb5fa154 后续执行）

用户以 `unity` / `three` / `glsl` 关键词网页检索，确认 §5.4「两条路都开着」并给出形状质量的标准行业配方：

- **草（各向异性）**：游戏行业多不用平铺贴图做草（InstancedMesh + 贝塞尔草叶几何 + 风噪声），但本场景是地面 albedo 平铺贴图，对应手法为**各向异性坐标拉伸**（`noise(p.x*0.2, p.y)` 把斑块拉成纤维）或 **Gabor 噪声**（定向微细节）。
- **大理石（脉络）**：全网共识 `sin(x + k·fbm(p))`——正弦带被 fbm 湍流掰弯成脉络（domain warping，Inigo Quilez）。团块感源于缺这步。
- **平铺无缝**：生成的 `DataTexture` 若要真正无接缝，应采样 **4D 环面噪声** `(cos,sin,cos,sin)→4D noise`；且「无缝 ≠ 无重复」，需双变体混合/随机化/宏观叠加破重复。

### 6.1 落地：材质像素生成器拆分（caps/surface-pixels/）

原 `generateSurfacePixels` 在 `ground-surface-spec.ts` 内用 `switch(mode)` 把 marble 的 sin 带、sand/grass 的噪声块全塞一个函数；加各向异性/域扭曲会膨胀成意大利面。按项目「纯像素逻辑下沉独立文件」先例（env-pixels.ts / sun-beams.ts / light-cone.ts），拆分为：

- `surface-pixels/types.ts`：生成器输入/签名（去环依赖，不 import cap 文件）
- `surface-pixels/noise.ts`：`hash2` / `valueNoise` / `fbm`（octave 叠加，域扭曲用）
- `surface-pixels/{plain,marble,sand,grass}.ts`：各材质一个生成器（marble 用域扭曲，grass 用各向异性拉伸 `ANISO_X = 0.35`）
- `surface-pixels/index.ts`：`SURFACE_PIXEL_GENERATORS` 调度表
- `ground-surface-spec.ts`：`generateSurfacePixels` 退化为「structural → 查表分发」，spec/key/apply 不动

**不变量（已锁）**：`surfaceSpecKey` 只序列化 structural 字段，与像素算法无关 → 重构零无谓重建；`ground-surface-spec.test.ts` 37 用例全绿（含 Phase1 行为等价 + Phase2 形状增强）。零 three 运行时依赖，保留 node 单测。

**未做（留待）**：4D 环面无缝采样（治 `repeat` 接缝）、双变体破重复——属后续增强，不影响当前正确性。
<!-- 文件名: ground-material-preset-explicit-state.md → 实际文件 ADR-254-ground-material-preset-explicit-state.md -->
