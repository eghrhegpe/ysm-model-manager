---
kind: adr
title: ADR-113：YSM 骨骼动画 Molang 求值器与欧拉序修复（L4）
status: ✅ 已采纳
date: 2026-08-22
author: AI proxy
related: ADR-100（YSM 骨骼动画播放 L1-L3）、ADR-042 §2.1（欧拉序裁决）
---

# ADR-113：YSM 骨骼动画 Molang 求值器与欧拉序修复（L4）

- **状态**：✅ 已采纳
- **日期**：2026-08-22
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-100`（YSM 骨骼动画播放 L1-L3）、`ADR-042`（欧拉序裁决）

## 1. Context

ADR-100 L1-L3 已落地 YSM 骨骼动画播放基础链路（解析→播放器→平滑过渡→全 clip 列表），
但存在两个关键缺口：

1. **Molang 表达式关键帧被丢弃**：`.animation.json` 中的字符串轴（如 `"query.anim_time * 90"`、
   `"math.sin(90)"`、`"q.anim_time > 1 ? 10 : -10"`）在 `parseBedrockAnimationJSON` 中标记
   `hasMolang=true`，但 `evaluateKeyframes` 对字符串走 `Number(item)` 路径得 NaN 后整帧丢弃。
2. **欧拉序 XYZ vs ZYX 不一致**：`ysm-animation-player.ts:113` 用
   `Euler(rx,ry,rz,'XYZ')` 构造目标四元数，而 `quaternion.ts`（spec 渲染层）和 Go
   `eulerToQuaternion` 早已是 **ZYX** 口径（ADR-042 §2.1 裁决），导致三轴非零旋转骨骼
   在动画播放时姿态错乱——俗称"角色乱飞"。

上游参考：
- **Blockbench**（GPL-3.0，只做公式对表）使用 `molangjs ^1.7.0`（MIT，作者 JannisX11 同属 Blockbench 团队）作为 Bedrock 动画的官方 Molang 求值引擎。
- **ModernYSM**（Java）自研 fork 的 Molang 引擎，加载期编译 AST、运行期纯树遍历。
- **YSMViewer**（C#）桌面端完整实现，浏览器端阉割（NaN 丢弃）。

## 2. Decision

### 2.1 Molang 求值器：源码内嵌策略

**采用源码内嵌**，将 `molangjs/src` + `molangjs/syntax` 按 MIT 许可保留原始版权头，
本地路径 import，彻底避开上游 npm 包 CJS/ESM 混用打包 bug
（package.json 含 `"type":"module"` 但 dist/molang.cjs.js 用 CJS module.exports，
Node 层报 `module is not defined`）。

不引入 npm 依赖，不修改上游包。

#### 设计要点

- **单例 parser**：`new Molang()` 全局复用，`cache_enabled` 默认开（400 条 LRU），
  表达式只解析一次，运行期纯求值——对齐 ModernYSM「加载期编译 AST / 运行期只 eval」原则。
- **未知变量 → 0**：`variableHandler = () => 0`，mod 扩展查询（ysm.*/按键/药效等）
  在预览器无宿主语境时优雅降级，不抛错（对齐 YSMViewer 回退口径）。
- **角度制**：`use_radians = false`（默认），三角函数按度数——Bedrock 格式约定。
- **安全底线**：molangjs 是真正的 DSL 解析器（词法/语法/AST），不是 `eval`——
  延续本项目「Molang 不解释执行任意 JS 表达式」的安全底线。
- **Infinity/NaN 守卫**：`compileMolang` 求值闭包与 `parseAxisItem` 常量折叠分支
  统一 `Number.isFinite` 检查，Infinity/NaN → 零占位，不穿透到渲染层。

#### 接口

```ts
// molang.ts
export type MolangFn = (animTime: number) => number;
export function compileMolang(expr: string): MolangFn | null;

// animation.ts 扩展
export interface Keyframe {
  time: number;
  post: Vec3;
  pre: Vec3;
  lerp: "linear" | "step";
  postMolang?: MolangAxes;  // L4 新增
  preMolang?: MolangAxes;   // L4 新增
}
```

### 2.2 欧拉序修复

**`ysm-animation-player.ts:113` 改 `Euler(rx,ry,rz,'XYZ')` → `Euler(rz,ry,rx,'ZYX')`**，
与 Blockbench `bedrock.js L648-882` 对齐。
spec 渲染层（`quaternion.ts`）无需改动（早已正确），仅播放器路径滞后；
修复后静态渲染与动态播放口径统一。

## 3. Consequences

### 正面
- 表达式关键帧（`query.anim_time`、`math.sin`、三元条件等）现在**真实驱动骨骼**，
  模型动画从"部分能动"升级到"完整 Bedrock 语义可播放"。
- 零新增 npm 依赖，内嵌源码 MIT 许可可商用，无传染性。
- 编译期静态分析可行（AST 结构固定），后续 L5 状态机可复用同一 parser 实例。
- 静态渲染与动态播放欧拉序口径统一，消除"乱飞"根因。

### 负面
- `molangjs` 源码目录（~46KB unpacked）进入仓库，体积增量有限但需随上游更新手动同步。
- `compileMolang` 是同步接口，`new Molang()` 失败时静默返回 null，调用方走零占位——
  不阻塞渲染，但调试时可能漏掉表达式错误。
- Blockbench 的 `molangjs` 是 1.7.0 版本，部分新表达式语法（如 `ctrl.*` 系列）
  尚未覆盖，仅支持 Bedrock 基岩版标准 Molang 子集。

### 已知遗留
- **不支持 `ctrl.*` / `ysm.*` 等游戏态查询**：`variableHandler` 统一返回 0，
  需要 Mod 运行时上下文才能正确求值的表达式会退化（预览器场景下可接受）。
- **不支持 `fn.*` 自定义函数**：模型包作者注册的函数在预览器中不可用。
- **未实现 `pre` 轴的 Molang 求值**：当前 `resolveFramePost` 只处理 `postMolang`，
  `preMolang` 字段保留但未使用（Bedrock 格式中 pre 通常等于 post，可延后支持）。

## 4. 文件清单

| 文件 | 说明 |
|------|------|
| `frontend/src/utils/animation/molang.ts` | Molang 求值器封装 |
| `frontend/src/utils/animation/molang.test.ts` | 7 项测试 |
| `frontend/src/utils/animation/molang-lib/*` | 内嵌 molangjs src + syntax（MIT） |
| `frontend/src/utils/animation/animation.ts` | Keyframe postMolang/preMolang、parseAxisItem、resolveFramePost |
| `frontend/src/utils/animation/animation.test.ts` | +6 项 Molang 关键帧测试 |
| `frontend/src/utils/3d/ysm-animation-player.ts` | XYZ→ZYX 欧拉序修复 |
| `frontend/src/utils/3d/ysm-animation-player.test.ts` | ZYX 证伪测试（与 XYZ 差角 >0.5 rad） |
| `frontend/src/utils/3d/spec-builder.test.ts` | 修正 combo 旋转测试期望值（对齐 ZYX 实测输出） |
| `frontend/test-setup.ts` | TextDecoder 兜底（happy-dom 不提供） |
| `docs/knowledge/animation-system.md` | "求值链路休眠"过时表述更正 |
| `docs/adr/ADR-100-ysm-bone-animation.md` | 补充 L4 章节 |
