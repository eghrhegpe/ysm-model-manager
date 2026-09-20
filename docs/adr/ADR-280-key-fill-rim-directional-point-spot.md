# ADR-280：灯光类型切换：三灯统一实例（key/fill/rim 各可 directional/point/spot）

- **状态**：📝 提议中（Proposed）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-20
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：
  - `frontend/src/preview-3d/caps/light-capability.ts`（核心：三灯统一实例化 + 类型切换）
  - `frontend/src/preview-3d/caps/light-presets.ts`（`LightInstanceParams`）
  - `frontend/src/preview-3d/caps/light-controls.ts`（顶栏三灯选择 + 统一设置条）
  - `frontend/src/preview-3d/caps/light-cone.ts`（`VolumetricCone` 驱动源改为任意 spot 灯）
  - `frontend/src/preview-3d/state/env-state-schema.ts`（`light{Key,Fill,Rim}Type` + 每灯 spot 参数）
  - `frontend/src/preview-3d/caps/light-persist.ts`（旧存档迁移）
  - `frontend/src/preview-3d/caps/shadow-capability.ts`（`getLights()` 适配）
  - `frontend/src/preview-3d/screenshot/screenshot-render.ts`、`screenshot-lights.ts`（截图按 type 建灯 + 同一灯位公式）
  - 知识卡 `docs/knowledge/volumetric_cone.md`、`docs/knowledge/preview_env_state.md`
  - 对标参照 `MikuMikuAR/frontend/src/scene/render/lighting-stage.ts`（Babylon `StageLightState.type` 切换）

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

重构前的灯光子系统是**四盏灯、两套并行参数体系**：

- 三盏固定为 `THREE.DirectionalLight` 的经典三点布光（key/fill/rim），参数为
  `{enabled, color, intensity, azimuth, elevation}`。
- 外加**一盏独立 `THREE.SpotLight`**（第四盏），参数为
  `{enabled, color, intensity, angle, penumbra, distance, decay}`。
- 体积光锥（`VolumetricCone`）硬绑定那盏独立聚光灯。

由此产生三个结构性缺陷：

1. **能力不对称**：只有第四盏灯能当聚光灯。用户想让主灯变成聚光灯，做不到——因为
   key/fill/rim 的 schema 里根本没有 `angle`/`penumbra` 字段。
2. **N×M 重复**：要让三盏灯都能当聚光灯，朴素做法是给每盏灯复制一份 spot 参数
   （`lightKeyAngle`/`lightFillAngle`/`lightRimAngle`…），菜单也要为每盏灯复制一份
   滑块组——三盏灯 × 两套参数 = 六份同构代码。
3. **UI 割裂**：key/fill/rim 各有自己的折叠区与滑块组，聚光灯又是另一张卡；用户想
   「把轮廓灯改成聚光灯」时，需要在两个互不相干的面板间来回对照。

对照 `MikuMikuAR` 的 `lighting-stage.ts`：它把灯光类型做成 `StageLightState.type`
（`'spot' | 'point' | 'directional'`），切换时 `dispose` 旧灯 + 重建新灯，**参数结构
与类型解耦**——不管什么类型都用同一套 `{pos, target, color, intensity}`。这印证了
「统一实例 + type 字段」比「每类型一套参数字段」更简洁。

用户裁定：**破坏性重构可接受**（旧存档不做长期兼容，只做一次性迁移）；每盏
`type==='spot'` 的灯都应能驱动体积光；顶栏三灯按钮切换编辑对象，共用同一条设置栏。

## 2. 决策（Decision）

### D1：消灭「第四盏独立聚光灯」，改为**三盏统一灯光实例**

`LightParams` 从「三盏方向灯 + 一盏聚光灯」改为三个同构的 `LightInstanceParams`：

```ts
type LightType = "directional" | "point" | "spot";
interface LightInstanceParams {
  type: LightType;
  enabled: boolean;
  color: number;
  intensity: number;
  azimuth: number;   // 定位：轴心 target + 该方向 × targetHeight（三类型共用）
  elevation: number;
  angle: number;     // spot 锥角半角（directional 时忽略）
  penumbra: number;  // spot 半影（directional 时忽略）
  distance: number;  // spot/point 衰减距离（directional 时忽略）
  decay: number;     // spot/point 衰减指数（directional 时忽略）
}

interface LightParams {
  key: LightInstanceParams;
  fill: LightInstanceParams;
  rim: LightInstanceParams;
  ambient: AmbientLightParams;
  volumetric: VolumetricParams;
}
```

`spotlight` 分组整体删除；`SpotlightParams` 类型删除（`DirectionalLightParams` 保留为
`LightInstanceParams` 的 `@deprecated` 别名，减少外部 import 破坏面）。

### D2：类型切换 = dispose 旧对象 + 按 type 重建新对象

`LightCapability.syncLight(which, state)` 是唯一入口：

- `p.type !== 当前 Three 对象类型` → `disposeLight(which)`（dispose 灯 + helper，
  从场景摘除）→ `createLight(p)`（按 type 建 `DirectionalLight`/`PointLight`/`SpotLight`）
  → `applyLightParams`（spot 走衰减补偿）→ 重建对应 helper → 若能力启用则挂回场景。
- 类型相同 → `applyLightParams` 原地更新（不重建，避免拖滑块 GC 抖动）。

`getLightType(light)` 用 `instanceof SpotLight/PointLight` 反推当前类型（Three 对象本身
即类型的单一事实源，不额外维护影子字段）。

### D3：helper 按类型配套，与灯同生命周期

原来只有方向灯配 `DirectionalLightHelper`。现在每盏灯按当前 type 配对应 helper：

| 灯类型 | helper |
|--------|--------|
| `directional` | `THREE.DirectionalLightHelper` |
| `spot` | `THREE.SpotLightHelper` |
| `point` | `THREE.PointLightHelper` |

类型切换时与灯一起 dispose + 重建，显隐跟随 `enabled`。

### D4：体积光锥由「第一盏启用的 spot 灯」驱动

`getSpotLightForCone(): { light: SpotLight; which: LightKey } | null` 按 key→fill→rim
顺序找第一盏 `instanceof SpotLight && visible` 的灯。锥体的位置/朝向由该灯与其靶点
（共享 `spotTarget`，位于模型中心）算出。没有任何 spot 灯时锥体卸载。

`rebuildConeIfNeeded` 是唯一出入口，按变更字段三路分派：

- **几何变更**（`CONE_GEO_CHANGES`：任一灯的 `type`/`enabled`/`angle`/`penumbra`）→
  `cone.rebuild(...)`（dispose + 重建几何/材质）
- **位置变更**（`CONE_MOVE_CHANGES`：任一灯的 `azimuth`/`elevation`）→ `cone.syncPosition(...)`
- **uniform 变更**（`VOL_PARAM_CHANGES` + 颜色/强度/距离/衰减）→ `cone.updateUniforms(...)`

这条分派是 ADR-266「重建触发面收窄」的延续——旧实现任意 spot 字段变更都整组重建。

### D5：顶栏三灯按钮 + 统一设置条

菜单（`light-controls.ts`）从「三盏灯各一套平铺 toggle + 独立滑块组 + 聚光灯卡」改为：

1. `light-enabled` 能力总开关（不变）
2. `light-select`：**三灯按钮组**（`select` 控件，选项 = 主灯/补灯/轮廓灯），选择
   「当前编辑哪盏灯」；`refreshOnChange` 触发节点树重建
3. `cap-group-light-params` folder：**同一套设置条**读写当前选中的灯
   - 公共：`type`（select）/ `enabled` / `color` / `intensity` / `azimuth` / `elevation`
   - `type==='spot'` 追加：`angle` / `penumbra`
   - `type!=='directional'` 追加：`distance` / `decay`
4. `light-ambient` 环境光强度
5. `cap-group-spot-vol` 体积光卡（不变）

「编辑对象」选择态是**运行时态**（`LightCapability.activeLight`），不入 envState、
不持久化——它是 UI 焦点而非场景状态。

### D6：envState 字段扩展（破坏性）

`light{Key,Fill,Rim}Type`（enum，默认 `"directional"`）+
`light{Key,Fill,Rim}{Angle,Penumbra,Distance,Decay}`。

`lightSpot*` 七个字段**整体删除**。旧存档迁移在 `restoreLightParams`：检测到旧
`spotlight` 块且 `enabled` → 把 key 灯改写为 `type='spot'` 并搬运
angle/penumbra/distance/decay。

### D7：跨能力消费口从「按类型取灯」改为「取全部灯 + 自行分流」

- `getDirectionalLights(): DirectionalLight[]` + `getSpotLight(): SpotLight` **删除**
- 新增 `getLights(): THREE.Light[]`（三盏灯，类型不定）
- `ShadowCapability.collectLights()` 用 `instanceof` 自行分流到 dirs/spots
- 截图渲染（`screenshot-render.ts`）按 `d.type` 建对应 Three 对象，保持预览/截图同构

## 3. 后果（Consequences）

### 正面

- **能力对称**：三盏灯完全等价，任意一盏都能当聚光灯/点光源，消灭第四盏特殊灯。
- **参数单一事实源**：一套 `LightInstanceParams` 服务三盏灯，菜单一套设置条服务三处；
  消灭 N×M 的参数字段与滑块组复制。
- **UI 收敛**：用户在同一处选灯 + 调参，不再跨面板对照；类型专属参数按 type 条件展开，
  界面不塞入当前类型不适用的滑块。
- **体积光解耦**：锥体不再依赖特定一盏灯，「哪盏是聚光灯」是纯数据驱动。
- **对标 MikuMikuAR**：与其 `StageLightState.type` + dispose/rebuild 同思路，降低后续
  跨项目移植的认知成本。

### 负面 / 代价

- **破坏性**：`lightSpot*` schema 字段、`setSpotlight`、`getDirectionalLights`、
  `getSpotLight`、`SpotlightParams` 全部删除；旧存档仅一次性迁移（非双轨兼容）。
- **构造期行为变化**：三盏灯默认类型均为 `directional`，位置统一为
  `lightPosition(p) = target + lightDirToPosition(azimuth, elevation, targetHeight)`。
  - 半径用 **`targetHeight`**（switch-preview 设为 `max(maxDim*0.8, 6)`）而非固定值：spot/point
    是位置敏感光源，固定小半径会让大模型的光源陷在网格内部；且这样保留了旧独立
    聚光灯「距靶点 = targetHeight」的 candela 补偿距离语义。
  - **以 `target` 为基准而非原点**：`switch-preview.ts:509` 传的是模型 bbox 中心，非原点模型
    很常见；若按原点固定半径，光源会随模型中心平移而「跑飞」。directional 灯同步
    `light.target.position = this.target`，使方向恒等于方位角/仰角向量（不受 target 绝对位置影响）。
  - 旧独立聚光灯「正上方 `(x, y+targetHeight, z)`」的定位被方位角/仰角体系吸收：
    仰角 90° 即等价旧行为，但现在是三盏灯共用的统一入口。
- **阴影分流上浮**：`ShadowCapability` 需要自己按 `instanceof` 分流，跨能力契约从
  「按类型取」变为「取全部 + 自行判型」——调用方认知负担略增，但避免了 cap 为每个
  消费者预设形状。
- **`activeLight` 是 UI 态**：不入 envState 意味着不持久化（刷新后回到 key 灯），
  这是刻意的（焦点不是场景状态），但对「上次编辑哪盏灯」有记忆需求的用户是缺省损失。

### 已知遗留

- kebab-case 的 `light-{key}-type` 等节点 id 在切换编辑对象后会复用（id 前缀带槽位名，
  故不同槽位仍是不同 id）；若未来引入「同屏并排编辑三灯」需要重审 id 冲突。
- 多盏 spot 灯同时启用时，体积光锥只由**第一盏**驱动（key→fill→rim 优先），其余 spot
  灯无光柱。这是有意的（避免多锥叠加过曝），但未在 UI 明示。
- `DirectionalLightParams` 作为 deprecated 别名保留，属于过渡性债；待外部 import 全量
  迁移到 `LightInstanceParams` 后可删。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| 用户需求：「顶栏新增三灯各种预设的按钮，所有灯光均可使用按钮自由切换点光源到聚光灯类型，所有灯光均可复用相同的设置条」 | D1 + D5 的设计目标 |
| 用户裁定：「破坏没事，每个类型为聚光灯的灯其调整离不开体积光的渲染，点击切换到调整该灯数值，可可以适当选用灵活的菜单函数」 | D4（任意 spot 灯驱动体积光）+ D5（切灯调值）+ D6（破坏性） |
| 用户追问：「感觉这种思路会带来巨大的重复代码，你想清楚他们可能不再是三种灯光了，而是三种数组了」 | 否决「每盏灯复制一套 spot 参数字段」方案，确立统一 `LightInstanceParams` |
| `MikuMikuAR/frontend/src/scene/render/lighting-stage.ts`（`StageLightState.type` + `_createStageLight(type, state)` + 切换时 dispose/重建） | D2 的 switch-重建范式；helper 配色区分三灯的做法 |
| ADR-266（体积光锥重建触发面收窄） | D4 的三路分派（geo/move/uniform）延续 |
| ADR-177（`VolumetricCone` 拆出 `LightCapability`） | 锥体消费方从「单一 spotlight」改为「按需查找 spot 灯」，接口不变 |
| ADR-196（参数真值源迁 envState） | D6 字段扩展落在 envState；D5 的 `activeLight` 刻意**不**入 envState（UI 态） |
| ADR-246 D3（SpotLightHelper 可视化） | D3 从「仅聚光灯有 helper」扩展为「每类型都有 helper」 |

<!-- 文件名: key-fill-rim-directional-point-spot.md → 实际文件 ADR-280-key-fill-rim-directional-point-spot.md -->
