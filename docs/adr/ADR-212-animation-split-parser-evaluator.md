# ADR-212：animation.ts 瘦身——求值器拆出，解析器原位保留

- **状态**：✅ 已采纳
- **日期**：2026-09-14
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-100`（YSM 骨骼动画 L1-L4）、`ADR-113`（Molang 求值器 L4）、`ADR-213`（molang 工厂化）
- **串行依赖**：与 ADR-213 同一 PR 实施（213 要改的 `parseAxisItem` 等函数正是本 ADR 要保留在 animation.ts 的同一批）

---

## 1. 背景（Context）

`frontend/src/utils/animation/animation.ts` 当前 **730 行**，承载两类职责：

| 职责 | 行数占比 | 消费者 |
|------|---------|--------|
| JSON 解析 → AnimationClip | ~400 行（`parseBedrockAnimationJSON` + 5 个子函数） | ysm-adapter、loader、wasm-decode、model2d/* |
| Clip 求值 → 骨骼变换 | ~190 行（`evaluateKeyframes` / `evaluateClip` / `executeTimeline` / `sampleCatmullRom` / `findKeyframeLowerIndex` / `resolveFramePost` / `ysmAnimClipLabels` / `evaluateTimeline`） | ysm-animation-player（唯一生产消费者） |

两类职责在代码上**零交织**：解析段 1–539 行 / 求值段 540–730 行。`foldMolangConstant` 仅被解析侧 `parseAxisItem` 调用，拆分边界天然清晰。

**症状**：
- 新开发者打开文件，第一眼看到的是 5 个子函数签名而非「解析 → 求值」两条主链
- 修改 `sampleCatmullRom` 的插值逻辑需要通读整个文件才能确认不影响解析分支
- 测试文件 `animation.test.ts` 中 Parser 与 Evaluator 用例交织

## 2. 决策（Decision）

### 2.1 拆分方向：只抽 evaluator，parser 原位保留

**不采用三文件方案**（parser + evaluator + re-export shim），原因：
- 反桶契约 #1 明文「不新增以 re-export 为主体的聚合文件」——纯 `export *` 桶正是红线
- 全量迁移 12 个 import 消费方的工作量 > 直接改 1 个生产消费者

**做法**：求值器搬出，解析器留在 `animation.ts`（原位瘦身）：

```
frontend/src/utils/animation/
├── animation.ts              ← 解析器 + 类型定义（~530 行，瘦身 ~190 行）
├── animation-evaluator.ts    ← 求值器（~190 行，新建）
└── animation-controller.ts   ← 不动
```

**`animation-evaluator.ts`**（~190 行）：
- `evaluateKeyframes(keyframes, t)` — 单通道求值
- `evaluateClip(clip, time)` — 整 clip 求值
- `executeTimeline(timeline, prevTime, currentTime)` — timeline 事件
- `sampleCatmullRom` / `findKeyframeLowerIndex` / `resolveFramePost` — 内部工具
- `ysmAnimClipLabels(fileBase, clips)` — 播放列表标签
- 从 `animation.ts` 导入类型（`Keyframe` / `Vec3` / `AnimationClip` 等）

**`animation.ts`**（~530 行）：
- 保留 `parseBedrockAnimationJSON` + 5 个子函数 + `foldMolangConstant` / `parseAxisItem` / `parseKeyValue` / `extractKeyframe` / `parseChannel` / `convertRotationKeyframes` / `hasMolangInChannelData`
- 保留全部类型定义（`Vec3` / `Keyframe` / `AnimationClip` / `BoneChannels` / `BoneTransform` / `TimelineEvent` / `MolangAxes`）
- 删除求值器代码（~190 行）+ 对应的热路径注释

### 2.2 生产消费者迁移（唯一）

`preview-3d/ysm-animation-player.ts` 是唯一生产消费者（`evaluateClip` / `executeTimeline`），将其 import 从 `animation.ts` 改为 `animation-evaluator.ts`。

其余消费方（loader、wasm-decode、model2d/*、real-data-fuzz.test.ts）消费的是 `AnimationClip` 类型定义，保留在 `animation.ts` 不动——无需改 import。

### 2.3 与 ADR-213 合并实施

ADR-213 要给 `parseAxisItem` / `parseKeyValue` / `extractKeyframe` / `parseChannel` 加 `parser` 参数——这四个函数正是本 ADR 要保留在 `animation.ts` 的同一批。**同片代码改两遍 = 冲突 + 回归风险**，故合并到同一 PR。

## 3. 后果（Consequences）

### 正面
- 单文件行数从 730 → ~530，求值器独立 ~190 行，符合单一职责
- 测试文件可拆为 `animation.test.ts`（解析） + `animation-evaluator.test.ts`（求值），用例聚焦
- 零 shim、零新桶、只改 1 个生产消费者——反桶契约不碰
- 后续 L5（动画混合 / 状态机增强）在 evaluator 层加，不污染解析层

### 负面
- `animation.ts` 仍 ~530 行，不是极致瘦身——但解析器内聚性足够，再拆边际收益递减
- 类型定义保留在 `animation.ts`，evaluator 需跨文件导入——1 行 import

### 风险
- `foldMolangConstant` 是热路径函数，保留原位——无性能影响

## 4. 实施计划

| 步骤 | 文件 | 内容 |
|------|------|------|
| 1 | `animation-evaluator.ts`（新建） | 搬入求值器代码 + 从 animation.ts 导入类型 |
| 2 | `animation.ts`（改写） | 删除求值器代码，保留解析器 + 类型定义 |
| 3 | `preview-3d/ysm-animation-player.ts` | import 改为 `@/utils/animation/animation-evaluator.ts` |
| 4 | `animation.test.ts`（拆分） | 拆为 `animation.test.ts`（解析） + `animation-evaluator.test.ts`（求值） |
| 5 | 合并 ADR-213 改动 | 给 `parseAxisItem` 等加 `parser` 参数（同一 PR） |
| 6 | 验证 | `npx vite build && npm run typecheck && npx vitest` |
| 7 | 提交 | `animation 拆分 + molang 工厂化同一 PR` |

## 5. 数据溯源

- 当前文件：`frontend/src/utils/animation/animation.ts`
- 测试文件：`frontend/src/utils/animation/animation.test.ts`
- 求值器唯一生产消费者：`frontend/src/preview-3d/ysm-animation-player.ts`（`evaluateClip` / `executeTimeline`）
- 解析器生产消费者：`frontend/src/preview-3d/adapters/ysm-adapter.ts`（`parseBedrockAnimationJSON`）
- 类型消费者：`frontend/src/views/app-preview/loader.ts`、`frontend/src/preview-3d/decoder/wasm-decode.ts`、`frontend/src/preview-3d/model2d/*`（`AnimationClip` 类型）、`frontend/src/utils/animation/animation-controller.ts`（`AnimationClip` 类型）
- 测试消费者：`frontend/src/utils/animation/animation.test.ts`、`frontend/src/utils/animation/real-data-fuzz.test.ts`、`frontend/src/preview-3d/ysm-animation-player.test.ts`
