# ADR-306：VMD morph 重定向到 VRM expression（表情通道）

- **状态**：✅ 已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-24
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/adapters/vrm/vmd-retarget.ts; frontend/src/preview-3d/adapters/vrm/vmd-expression-map.ts; frontend/src/preview-3d/adapters/vrm/vrm-adapter.ts; frontend/src/preview-3d/adapters/shared/perception/blink.ts; 依赖 @pixiv/three-vrm-core 的 VRMExpressionManager（getExpressionTrackName / setValue / update）; ADR-243（VMD→VRM 身体重定向，本 ADR 是其 §2.9 遗留项的收口）; ADR-081（语义骨骼层 §2.5 morph 语义未建立的遗留）`

---

## 1. 背景（Context）

### 1.1 ADR-243 落地后的留白

ADR-243 收口了身体 FK 重定向，但把表情整体划出范围（§2.9「表情：另开决策」）。落点在代码里是三处显式丢弃：

- `vmd-retarget.ts` `createGhostMesh` 里 `morphTargetDictionary = {}`——让上游 `buildMorphAnimation` 全部跳过（不加空对象上游会直接 TypeError，见 ADR-243 §3.4 哨兵②）；
- `rewriteVmdTracks` 里 `.morphTargetInfluences[*]` 轨道计 `droppedTracks`；
- `droppedTracks` 报告字段把 morph 与未映射骨混在同一个计数里。

结果是「跳舞面瘫」：身体动作完整，脸上一个表情都没有。而 VMD 动作普遍带表情帧（`まばたき`/`あいうえお`/`笑い`），舞蹈表演的一半信息量在脸上。

### 1.2 讽刺：通路两侧都是现成的

- VMD 侧：上游 `buildMorphAnimation` 早就解析并产出了 `.morphTargetInfluences[N]` 的 NumberKeyframeTrack（`@moeru/three-mmd` `dist/index.js:4074-4095`），只是被幽灵网格的空 morph 表挡住；
- VRM 侧：`VRMExpressionManager` 现成，眨眼感知层（`blink.ts`）每天都在经 `setValue(name, weight)` 驱动同一套表情。

缺的只是一张**名字翻译表**和一条**摘轨改道**规则——与 ADR-243 §2.8 对足 IK 做的是同一形状的工程。

### 1.3 官方路径旁证

`@pixiv/three-vrm-animation` 的 `createVRMAnimationClip` 对表情的处理就是「把 NumberKeyframeTrack 改名绑到 `expressionManager.getExpressionTrackName(name)`（即 `VRMExpression_<name>.weight`）后塞进 clip」，由 AnimationMixer 统一驱动、`vrm.update()` 内的 `expressionManager.update()` 消费。**表情轨道与骨骼轨道同管道、同 mixer、同 update 时序**——不需要独立驱动器。

### 1.4 命名鸿沟

VMD 的 morph 名是**模型作者自定义**的日文名（`まばたき`/`ウィンク`/`笑い`/`真顔`/`あ`…），VRM 的 expression 名是标准 preset（`blink`/`happy`/`aa`…）。与 ADR-081 的骨骼候选名表同构的问题：**候选顺序即优先级，首个命中胜出**。区别在于 morph 名变体无穷（作者自由命名），映射表只能覆盖主流约定，覆盖不了的是常态而非异常。

---

## 2. 决策（Decision）

在 ADR-243 的重定向管线里加一段**表情通道**，与足 IK 摘轨同构：

```
VMD morphKeyFrames
  ↓ 上游 buildMorphAnimation（幽灵网格 morph 表不再置空，改填「可映射子集」）
.morphTargetInfluences[N] NumberKeyframeTrack
  ↓ 表情轨道改道（本决策）：.morphTargetInfluences[N] → VRMExpression_<preset>.weight
AnimationMixer 统一驱动（与骨骼轨道同 clip）
  ↓ vrm.update() 内 expressionManager.update() 消费
表情生效
```

### 2.1 映射表独立成文件（`vmd-expression-map.ts`）

`Record<VrmPresetName, readonly string[]>` 形状，与 `vmd-retarget-map.ts` 同约定（候选顺序即优先级、精确匹配、首个命中胜出），但**不并入骨骼映射表**——morph 候选空间的变体密度和演进节奏与骨骼完全不同，混表会让两个本就庞大的表互相拖累。

v1 覆盖（preset → MMD 候选名，顺序即优先级）：

| VRM preset | MMD 候选名 |
|---|---|
| `aa` / `ih` / `ou` / `ee` / `oh` | `あ` / `い` / `う` / `え` / `お` |
| `blink` | `まばたき`（*ADR-309 D7 修正：`ウィンク`/`ウインク` 移除——MMD 配布里绝大多数是**单眼**，映双眼 blink 会两眼错闭；单眼 wink 归二期 `blinkLeft`/`blinkRight`*） |
| `happy` | `笑い`、`にこり`、`にっこり`、`笑顔` |
| `angry` | `怒り`、`怒り顔`（*ADR-309 D7 修正：`真顔` 移除——MMD 作者用 `真顔` 表示「清脸/恢复默认」，非生气；VRM preset 无对应物*） |
| `sad` | `悲しい`、`困る`、`困り顔`、`悲しい顔` |
| `relaxed` | `なごみ`、`雰囲気`、`照れ`（*ADR-309 D7 补正：`雰囲気` 原文即有，代码落地时漏收，已补回*） |
| `surprised` | `びっくり`、`驚き` |
| `neutral` | — （不映射：neutral 语义是「素颜基准」，驱动它会压掉其他表情） |

不映射的 preset 显式记原因（与骨骼表的 `VMD_RETARGET_UNMAPPED` 同法）。**blink 族特例**（*ADR-309 D7 修正*）：`ウィンク右`/`ウインク` 等单眼眨眼在 VRM 有 `blinkLeft`/`blinkRight`，v1 只映射双眼 `blink`（`まばたき`），单眼 wink 归二期已知遗留（MMD 单眼 wink 帧较少见，收益/复杂度比不划算；且无左右标注的 `ウィンク` 配布里多为单眼，映双眼 blink 反成视觉错误）。

### 2.2 摘轨改道在重定向器内完成（不改上游、不新建驱动器）

`buildVmdRetargetClip` 接受可选 `expressionManager` 窄接口（只要求 `getExpressionTrackName(name): string | null`——与 three-vrm-core 类型同名同形，鸭子类型即可，不必 import 类型本身）：

1. **幽灵网格 morph 表改为填「可映射子集」**：收集 VMD 实际驱动的 morph 名，查表情映射表得 preset，能解析出 trackName 的才填进 `morphTargetDictionary`（值随便，只用键做白名单）。不可映射的 morph 名继续被上游跳过，天然计入丢弃。
2. **`rewriteVmdTracks` 加一条改道规则**：`.morphTargetInfluences[N]` 轨道经上游写回的索引反查 morph 名（改道表 `morphIndexByTrack: Map<number, string>`），再经映射表拿到 `VRMExpression_<preset>.weight`，原地改 `track.name` 塞进 clip。
3. **不 `setValue` 不建驱动器**：轨道进 clip 后 AnimationMixer 自动驱动 `VRMExpression.weight`，`vrm.update()` 内 `expressionManager.update()` 消费——每帧顺序契约（ADR-243 §2.6）零改动。

⚠️ 与骨骼轨道同一条红线：**原地改 `track.name`，禁止重建 track**。morph 轨道虽走 `NumberKeyframeTrack`（上游 `buildMorphAnimation` 未经 `_createTrack`、无贝塞尔覆写），但原地改名的纪律保持统一——「重建轨道」这个动作在整个重定向器里没有合法实例。

### 2.3 感知层互斥（眨眼冲突）

VMD 表情帧里的 `まばたき` 与感知层眨眼（`blink.ts`）语义撞车。**决策：动画播放态（`animActive`）下感知层眨眼停用，表情权重完全交给 VMD 轨道**——与足 IK 的 `animActive` 互斥（ADR-243 §2.8.2）同一模式，不新增门控机制。实现上 `VRMExpression.overrideBlink` 的模型侧配置天然兜底（VRM 规范里 blink 表情会被 `blinkOverride` 拦截），本决策不依赖它，冲突消解靠互斥门控。

### 2.4 范围

**In**：VMD morph → VRM preset 表情映射表；morph 轨道摘轨改道进 clip；幽灵网格 morph 表填可映射子集；`animActive` 互斥下感知层眨眼停用。

**Out（明确不在本次）**：
- **自定义表情名**：VRM 模型带非 preset 自定义 expression 时，映射表不覆盖（preset 表是封闭集，自定义名要读模型才知道，收益小）；
- **单眼 wink**（`blinkLeft`/`blinkRight`）：MMD 单眼 wink 帧少见，归已知遗留（*ADR-309 D7 起 `ウィンク`/`ウインク` 亦不再映双眼 blink，单眼 wink 统一归二期*）；
- **MMD 侧 morph 面板联动**：MMD 适配器自己的 morph 通道不走本表；
- **口型感知层（lipSync）**：VMD 有口型帧时同样由轨道驱动，`animActive` 互斥已覆盖。

---

## 3. 后果（Consequences）

### 3.1 正面

- **舞蹈观感补全**：表情是 VMD 动作一半的表演信息量，本决策补上后 VRM 侧播放不再是「面瘫舞」；
- **零新驱动器**：轨道进 clip 由既有 AnimationMixer 驱动，每帧顺序契约零改动；
- **与 ADR-243 同构**：候选名表 + 摘轨改道，工程形状与足 IK 一致，可维护性同源；
- **映射表可独立演进**：morph 候选名变体独立成文件，扩表不动骨骼映射。

### 3.2 负面

- **morph 名变体覆盖不全**：作者自定义名（`にっこ2` 之类）映射不到，表情缺帧——这是命名鸿沟的格式级常态，映射表只能覆盖主流约定；
- **幽灵网格 morph 表从「空对象」变「子集」**：上游 `buildMorphAnimation` 的白名单语义从「全跳过」变「按表过滤」，ADR-243 §3.4 哨兵②的断言面要同步修订（从「morph 不进轨道」改为「可映射 morph 进轨道、不可映射的不进」）；
- **眨眼感知层在动画态停用**：非 VMD 驱动的表情帧间隙（morph 曲线为 0 时）眨眼不会自动补位，画面上看是「VMD 段落里不眨眼」——可接受，VMD 作者本就控制了全部表情。

### 3.3 已知遗留

- **单眼 wink**（`blinkLeft`/`blinkRight`）不映射；
- **非 preset 自定义 expression** 不映射；
- **morph 权重曲线无贝塞尔**：上游 `buildMorphAnimation` 直接 `NumberKeyframeTrack`（线性插值），表情切换在关键帧稀疏时会显生硬——上游行为，不在本决策改。

---

## 4. 数据溯源

| 来源 | 内容 | 落地 |
|---|---|---|
| ADR-243 §2.9 / §3.3 | 「表情：另开决策」的遗留登记 | §1.1 |
| ADR-243 锐评对账（2026-09-24 会话） | 「表情通道整体丢弃 = 跳舞面瘫；expressionManager 通路已在跑，抓手现成」——六刺之刺 1，属实 | §1.1 / §1.2 |
| `@moeru/three-mmd` `dist/index.js:4074-4095` | `buildMorphAnimation` 按 `morphTargetDictionary` 白名单产出 `.morphTargetInfluences[N]` 轨道 | §1.2 / §2.2 |
| `@pixiv/three-vrm-core` `VRMExpressionManager.getExpressionTrackName()` | 官方表情轨道名 = `VRMExpression_<name>.weight`；`setValue(name, weight)` 同源 | §1.3 / §2.2 |
| `@pixiv/three-vrm-animation` `createVRMAnimationClip` | 官方 .vrma 就是「表情 NumberKeyframeTrack 改名进 clip、mixer 统一驱动」 | §1.3 / §2.2 |
| `frontend/src/preview-3d/adapters/shared/perception/blink.ts` | 眨眼感知层经 `setValue("blink", w)` 驱动同一套表情（通路现成的实证） | §1.2 / §2.3 |
| VRMExpressionPresetName.d.ts | preset 封闭集：aa/ih/ou/ee/oh/blink/happy/angry/sad/relaxed/lookUp/surprised/lookDown/lookLeft/lookRight/blinkLeft/blinkRight/neutral | §2.1 |

<!-- 文件名: vmd-morph-vrm-expression.md → 实际文件 ADR-306-vmd-morph-vrm-expression.md -->
