# ADR-178：PreviewScene 能力分层接口

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-04
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/adapters/mount-preview-core.ts (PreviewScene/PreviewAdapter), ysm/vrm/mmd/fbx/litematic/pack 六适配器, preview_core 知识卡`

---

## 1. 背景（Context）

`PreviewScene`（mount-preview-core.ts:120-144）是 3D 预览适配器的内容层契约，13 个字段中 **12 个可选**（仅 `dispose` 为硬契约）。消费方靠 `?.` 特性探测 + 运行时降级工作，类型系统无法静态表达「某格式支持什么能力」。

2026-09-03/04 五轮前端锐评（frontend_design_critique 快照）实证：

- 接口注释自述「缺字段 = 功能降级而非崩溃」——这是**鸭子类型伪装成协议**，13 字段契约实际是「至少实现 dispose 的任意对象」；
- 六个格式 adapter（ysm/vrm/mmd/fbx/litematic/pack）各自实现不同能力子集，但无一处用类型表达「我支持 update 但不支持 applyPose」；
- `?.` 特性探测散布在 mount-preview-core（perFrame=content.update ?? null）、unified-pick、screenshot 透传等消费方，能力判断是隐式约定而非显式声明；
- 每次新增格式 adapter 时，「哪些能力要实现」靠人肉对照旧 adapter，无编译期检查。

## 2. 决策（Decision）

将 `PreviewScene` 从「单接口 + 大量可选字段」改为 **能力分层接口 + 收窄消费**：

```
BaseScene            { dispose(): void }                    // 硬契约，所有 adapter 实现
├── UpdateableScene  { update(dt: number): void }           // 动态内容（动画/SpringBone/感知）
├── ScreenshotScene  { screenshot(): Promise<string|null> }  // 截图
├── CameraControlScene { resetCamera(); setRotationMode(); setSpeed() }
├── GroupedScene     { showModelGroup(i: number) }
├── BonePickScene    { onBoneSelect(info); boneMaps; onBonePick }
└── SemanticScene    { semanticBones }
```

消费方按需收窄：

```ts
// 消费方示例：帧循环只接受 UpdateableScene
function driveFrame(c: UpdateableScene | null, dt: number): void {
  c?.update(dt);  // 不再是「可能有也可能没有」的 13 选 1，而是明确的最小接口
}
```

### 原则

1. **dispose 保持唯一硬契约**：所有 adapter 必须实现；其余能力按「有就 implements、没有就不 implements」，与现状一致，但由类型系统表达而非注释约定；
2. **adapter 返回具体接口组合**：`build()` 返回类型从 `Promise<PreviewScene>` 改为 `Promise<PreviewScene>` 的字面值形态（对象字面量天然可被类型检查为满足哪些接口），内部仍可返回同一个对象——TS 结构类型让一个对象同时满足多个接口，**零运行时成本**；
3. **消费方收窄**：把 `content.update?.()` 类调用点改为显式收窄（`isUpdateable(content)` 类型守卫 或 直接参数类型），删除「能力判断靠注释」；
4. **不引入运行时能力注册表**：能力判断仍走 TS 结构类型（编译期），不加 `has('update')` 之类运行时探测——保持「零依赖框架」哲学；
5. **渐进落地**：新增 adapter 先按新接口写；存量 6 adapter 逐个迁移（每迁一个跑该格式测试）。

## 3. 后果（Consequences）

**正面**：
- 新增 adapter 时「实现哪些能力」由接口组合显式声明，编译期可查；
- 消费方不再 `?.` 链式探测，类型收窄消灭「静默缺能力降级」的隐式路径；
- 与现有「能渲染就能出统计」渐进能力哲学自洽（collectSceneStats 仍对任意 BaseScene 工作）。

**负面**：
- 6 个存量 adapter 需逐个迁移（每格式 ~30 分钟），消费方（mount-preview-core 帧循环/unified-pick/switch-preview）需同步收窄；
- 接口文件膨胀：单接口变 7 个小组件接口，需集中放置避免散落；
- `PreviewAdapter.build` 返回类型的字面值写法若用接口类型标注，TS 需 `satisfies` 或显式组合类型，写法上比现在啰嗦一档。

**已知遗留**：
- `PreviewAdapter`（adapter 侧契约）暂不动，仅动 `PreviewScene`（内容层契约）；
- `mount3D` 的 `opts` 巨型可选对象（Mount3DOptions 20+ 字段）是同类债，但依赖面更大，另行评估。

## 4. 数据溯源

锐评实证（2026-09-03 frontend_design_critique 快照 + 09-04 复查）：
- mount-preview-core.ts:120-144 PreviewScene 13 字段 12 可选（源码实读）；
- 帧循环 `perFrame=content.update ?? null`（mount-preview-core.ts:796）、screenshot 透传 `?.`（L891 注释）、unified-pick boneMaps 判定（scene-registry.ts）——`?.` 探测 5+ 处；
- 六 adapter 能力子集各异（vrm 有 update 无 applyPose；mmd 有 applyPose；litematic/pack 纯静态无 update）——结构类型可无损表达。

<!-- 文件名: previewscene-capability-interfaces.md → 实际文件 ADR-178-previewscene-capability-interfaces.md -->
