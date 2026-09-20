# ADR-272：waterSize 放开 UI 入口 + pool 尺寸零重建（sizeLinks）

- **状态**：✅ 已采纳
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-19
- **决策人**：Jieling（人类首席架构师）、AI 代理（deepseek）
- **相关**：`frontend/src/preview-3d/caps/water-body-strategies.ts`（`WaterSizeLink` / `POOL_WALLS` / `applySizeLinks`）、`water-menu.ts`（`ground-water-size`）、`water-capability.ts`（`setWaterSize` / `getWaterSize`）；`frontend/src/locales/{zh-CN,en,ja}.ts`；修正 **ADR-255 §2.2 / §3**；收口 **ADR-257 §6.3** 遗留；延续 ADR-271（微细节法线 GPU 化）、ADR-196（envState 单一事实源）、ADR-195（cap 直产菜单节点）

---

## 1. 背景（Context）

ADR-257 §6.3 登记了两条彼此咬合的遗留，指向同一件事：**`waterSize` 是一个用户不可达的字段**。

1. **无 UI 入口**：全仓唯一写入点是 `loadState` 的存档恢复（+ 测试直写）。即 ADR-255 §2.2「尺寸 uniform 驱动、不重建几何」的收益，服务的是一条用户到不了的路径。
2. **放开入口的两道卡点**：
   - **卡点 A（ADR-255 §2.2 原话）**：`waterSize` 变更触发 `rebuildWaterContainer` 全量重建几何 + 法线缓存——「桌面拖 size slider 必卡顿」。ADR-255 §2.2 对此的处置是 **pool 走全量重建、判为「低频接受」**，理由是该字段只可能来自存档。
   - **卡点 B（ADR-257 §6.3）**：film 改 size 会同步触发 `getNormalMap()` 全量重算 256²（65536 像素 × 每像素 3 个 `Vector2` + 3 次 `cos`）并阻塞主线程。
   - → 卡点 B 已由 **ADR-271** 收口（CPU 贴图链路整体移除，微细节法线改 fragment 程序化）。

**卡点 A 的前提已被本次任务本身推翻**：ADR-255 §2.2 的「低频接受」建立在「只有存档会改 size」之上；而放开 UI 入口正是要让用户拖动它——**拖动是高频事件（pointermove 级别连续写值，见 `DragSliderController.onChange`）**，于是「低频接受」的原假设不再成立，pool 的每次变更都会走一轮 `disposeWater`（10 个 geometry + 5 个材质 + transmission RT）+ `build`（10 个 mesh 全部重建）。先开入口再谈性能，等于把一个已知卡顿送进用户手里。

## 2. 决策（Decision）

### 2.1 pool 的尺寸语义固化为 build 期数据（`sizeLinks`），尺寸不再进几何

延续 ADR-257 §6.1 已确立的「**build 期预捕获、运行期查表**」思路（那次是 `parts` 治 mesh-name 字符串寻址），本次把它延伸到尺寸：

- `WaterBody` 新增 `sizeLinks: readonly WaterSizeLink[]`，形态在 `build()` 期把自己「哪些件随尺寸怎么变」固化成数据：
  - `square` —— 平面件等比铺满 `size × size`（film 水膜 / pool 顶面 / pool 池底）；
  - `wall` —— 立面件沿法向轴平移 + **单轴**缩放（pool 四壁）：水平轴随 size 变化、y 轴不动，故**壁高与壁厚保持绝对值**，不被尺寸缩放连带变形。
- 执行器 `applySizeLinks(body, size)` 只有一个（尺寸语义已由数据描述，动作本身与形态无关）；`WaterBodyStrategy.applySize(body, size)` 契约与签名**不变**（ADR-257 §2.3 的「解释权下沉到 strategy」依旧成立，strategy 只是从「写死几何」换成「产出数据」）。
- pool 几何改为**单位宽**（`PlaneGeometry(1, h)` × `scale.x = size`；池底 `PlaneGeometry(1,1)` × `scale.set(size,size,1)`）；四壁布局收敛为单一事实源 `POOL_WALLS`（`axis` / `sign` / `rotY`），build 与 applySize 共用，消灭原先预计算 `pos` / `outerPos` 向量的重复表达。
- `poolStrategy.needsRebuild` 移除 `waterSize`；`waterPoolHeight` / `waterPoolWallThickness` **保留重建**（墙高烘焙进壁几何的 y 尺寸、壁厚进外壁偏移与外壁加高，非本次范围）。

### 2.2 放开 `ground-water-size` 滑块

- form 组新增 slider（与 `ground-water-level` 并列）：范围 `10–300 m`、`step 1`、**不带 `visibleWhen`**——理由同水位：两形态都零重建、且都受尺寸影响。
- `setWaterSize` / `getWaterSize` 落 envState（ADR-196 单一事实源）；入口钳 `≥1`，与 `loadState` 恢复同下界，shader 侧 `max(uSize, 0.001)` 再兜一层。
- 菜单节点走 `MenuNode` schema（`wSliderNode`），三语 i18n 键 `preview.groundWaterSize` 齐平。

### 2.3 顺带收口的既有勘误

- **「9 mesh」应为 10**：ADR-257 §1 / §3 与水面知识卡均称池体 9 个 mesh，实际是顶面 1 + 池底 1 + 4 组内外壁 8 = **10**（本次以测试实测钉死：`collectMeshes` 长度断言）。ADR-257 以 §6.5 勘误登记（本次改动正文无关数字，不改历史正文）。
- **菜单测试「13 项控件」标题长期失真**：该用例逐项断言了 13 个控件，但树内实际控件数与标题数字不对齐（漏了 `ground-water-level`）。本次改为「数量与树一致」——`countControls` 计算树内全部叶子控件数并断言，**数字漂移这一类问题从此先红**。

## 3. 后果（Consequences）

### 正面

- **`waterSize` 从死路径变成活控件**：ADR-257 §6.3 的两条遗留（无入口 / 前置卡点）至此全部收口。
- **pool 尺寸零重建**：拖动滑块只改 transform（10 件 mesh 的 scale / position），几何与材质句柄全程不动。测试以「10 件 mesh 与各自 geometry 同一性保持」为硬断言，而非只看结果尺寸。
- **顺带修掉同族的高频重建**：`waterSize` 是本次新开入口，但同一 `needsRebuild` 表驱动的 `ground-pool-height` / `ground-pool-wall-thickness` 两条**既有**滑块的拖动风暴仍是遗留（见下）。
- 尺寸语义可被新形态复用：新增形态只需产出自己的 `sizeLinks`，缩放/定位逻辑不必重写。

### 负面

- `WaterBody` 多一个必填字段（新形态必须正视「我的尺寸能不能就地更新」——本意即为强制思考点，非纯负担）。
- 池底与四壁的 UV 不再随尺寸拉伸（几何单位化后 `v` 恒为 0–1）——壁面无贴图（纯色 + transmission），**当前无观感影响**；若将来给池壁贴图，需按 `size` 重设 `texture.repeat`（与地面 `textureRepeat(meshSize, scale)` 同款做法）。

### 风险

- 壁高 / 壁厚是绝对量而尺寸走缩放：**只有 x（水平轴）被 scale**，y 轴恒不动。若将来把 `h` 也改成缩放表达，必须同款区分轴向，否则壁高会被 size 连带放大。

### 已知遗留

- **pool 的 `waterPoolHeight` / `waterPoolWallThickness` 拖动仍是全量重建**（两条既有滑块，`needsRebuild` 为 true）：与本次同族、同一张表的病灶，登记待办。修法与本次同构（把墙高改为 `scale.y`、壁厚改为外壁 offset 数据），但会动壁几何与 transmission `thickness` 的取值路径，超出「放开 size 入口」的范围，故未并入。→ **已由 §5.1 结清（2026-09）**：修法即此处预告的同构写法，池深与壁厚一并收进 `transformLinks`。
- 水面仍不参与阴影（无 `castShadow` / `receiveShadow`）；圆角裁剪隐含「水面恒在世界原点」的未登记假设（ADR-257 §6.3 补记外，本次亦未处理）。

## 4. 数据溯源

- 起点：ADR-257 §6.3 遗留清单 → 卡点 B 由 ADR-271 收口 → 本次处理卡点 A 与入口本身。
- 关键事实核对（**推翻既有决策的依据**）：ADR-255 §2.2 明文写「pool 的 `waterSize` 变更走全量 `rebuildWaterContainer`……低频接受」，该判断的前提是「无 UI 入口、只可能来自存档」；`water-menu.ts` 一旦挂上 slider，前提立刻失效。
- 实现形态的选择依据：ADR-257 §6.1 的「build 期预捕获」反证测试（「全树改名后仍能取出」）证明该思路在本文件已被验证过一轮，`sizeLinks` 是同一思路在尺寸轴上的复刻，而非新范式。
- 数字实证：`water-capability.test.ts` 池体 mesh 计数 = **10**（`collectMeshes`），与 ADR-257 §1/§3 及知识卡的「9」不符 → 顺带勘误。
- 验证：`water-capability.test.ts` 65 例全绿（原 59，新增 6）；`npm run typecheck` ✅；`npx vite build` ✅；`check-biome` ✅；`i18n-check` 三语 1485 键齐平 ✅。

## 5. 扩展（2026-09）：结构参数全轴零重建 + 三处接线收口

本节把 §2.1 的判例从「尺寸轴」推广到「结构参数全轴」，并顺带收口评审点名的三处接线债务。
**§2 的决策方向不变，只是其适用范围被自身判例证明可以更宽。**

### 5.1 池深 / 壁厚也进 transformLinks（几何不再烘焙任何结构参数）

§3「已知遗留」登记的 `waterPoolHeight` / `waterPoolWallThickness` 全量重建至此结清，修法与 §2.1 同构：

- 壁几何一律单位化（`PlaneGeometry(1, 1, 4, 4)`）：壁高走 `scale.y`、外壁加高 `scale.y = h + max(0.02, t×0.6)`、
  外壁外偏 `position[axis] = sign × (size/2 + t)`、壁件中线 `position.y = wallH/2`。
- `WaterSizeLink` → `WaterTransformLink`：`wall` 的 `offset: number`（build 期烘焙的绝对量）换成 `outer: boolean`——
  **外偏量在运行期由 `t` 现算**，不再是快照。
- 执行器 `applySizeLinks(body, size)` → `applyTransformLinks(body, size, poolHeight, wallThickness)`；
  契约 `applySize(body, size)` → `applyProfile(body, { size, poolHeight, wallThickness })`。
- **build 不再自己写一份初始变换**：pool 装配完 `body` 后直接调用同一执行器（单一推导，
  杜绝「build 与运行期各写一套」的漂移）；ADR-257 §6.1「形态差异在装配期固化」因此更彻底。
- `poolStrategy.needsRebuild` 恒 `false`；重建契约保留给真正需要换几何的形态（如未来 `ocean`）。
- 壁厚同时是池内壁的体积光学光程（`MeshPhysicalMaterial.thickness`），cap 在 `waterPoolWallThickness`
  变更时就地写材质——它不描述几何，不入 links。

### 5.2 三处接线债务收口（评审「一处参数六处接线」的第一批）

- **派发键类型化**：`EnvCallback.changed` 由 `Set<string>` 收为 `Set<EnvStateKey>`（schema 派生 `keyof EnvState`）；
  `changed.has("拼错")` 从此编译不过——派发层的字符串契约与 ADR-257 治过的 mesh-name 寻址同病，同一判例清理。
- **持久化派生化**：`saveState` 不再手抄 16 键，改为遍历 `getPresetKeys("water")`（dispatcher 早已在用的事实源）；
  新增 water 参数只需进 schema，写侧自动跟上。历史键名 `size` 由 `loadState` 双轨兼容，写侧统一 `waterSize`。
- **uniform 写入收口**：cap 内五处 `as unknown as { userData?: { shader?: … } }` 深挖合并为
  `setUniform(mat, name, value)` 单一出口（原先每处各写一遍，拼错 uniform 名即静默失效）。

### 5.3 代价与边界

- 壁面 UV 与 §3 同款（单位几何，`v` 恒 0–1）；壁面无贴图，无观感影响。
- `applyProfile` 每次变更只做 O(件数) 的标量赋值（pool 10 件），不含任何分配——
  拖池深 / 壁厚滑块不再产生几何与材质 churn。
- 仍存的接线债务：菜单 slider 的 min/max/step 与 setter 钳制值域仍是两份字面量
  （`POOL_ROUNDNESS_MAX` 一例有注释自辩）；`applyChangedParams` 仍是逐键 `if` 链。
  二者属「参数描述符化」范畴，需单独 ADR。
