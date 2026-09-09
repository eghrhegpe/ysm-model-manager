# ADR-213：molang.ts 全局单例全量迁移工厂模式

- **状态**：✅ 已采纳
- **日期**：2026-09-14
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-113`（Molang 求值器 L4）、`ADR-211`（clip 自带 MolangParser 实例替代全局单例）、`ADR-212`（animation 拆分）
- **串行依赖**：与 ADR-212 同一 PR 实施

---

## 1. 背景（Context）

`frontend/src/utils/animation/molang.ts` 当前存在**两套并行的 Molang 解析器生命周期**：

| 机制 | 接口 | 状态 |
|------|------|------|
| 模块级单例 `parser = new Molang()` | `compileMolang(expr)` | 标注 `@deprecated` 但仍被 `animation.ts` 的 `parseAxisItem` 调用 |
| 工厂 `createMolangParser()` | `{ compileMolang, setScope }` | ADR-211 引入，clip 自带实例时使用 |

**问题**：

1. **双生命周期维护**：ADR-211 引入工厂模式解决 clip 间作用域隔离，但模块级单例未删除。`animation.ts` 的 `parseClipTimeline` 使用工厂实例，而 `parseAxisItem` 中的 `compileMolang(item)` 仍走全局单例——同一解析链路内混用两套实例，`temp.` 变量作用域不一致。

2. **测试污染**：单例 `parser` 在测试间共享状态，`getMolangParser()` 导出供 spy 使用，测试执行顺序可能互相干扰。

3. **ADR-211 遗留未闭环**：ADR-211 计划「消费方全量迁移后移除单例」，但迁移未闭环——`parseAxisItem` 是最后一块未迁移的消费方。

**根因**：`compileMolang` 是同步函数，molangjs 在主线程跑，无真正的「并发踩踏」风险。真实收益是关闭 ADR-211 遗留、消灭双生命周期维护成本、测试隔离——这三条已足够立论。

## 2. 决策（Decision）

### 2.1 移除模块级单例

删除 `molang.ts` 中的：
- `const parser = new Molang()`
- `getMolangParser()` 导出
- 模块级 `compileMolang(expr)` 函数

### 2.2 工厂模式统一接口

保留并强化 `createMolangParser()` 工厂，作为**唯一**的 Molang 编译入口：

```ts
export interface MolangParser {
  compileMolang: (expr: string, scope?: Record<string, number> | null) => MolangFn | null;
  setScope: (scope: Record<string, number> | null) => void;
}

export function createMolangParser(): MolangParser;
```

### 2.3 消费方迁移

| 消费方 | 当前用法 | 迁移后 |
|--------|---------|--------|
| `animation.ts` `parseAxisItem` | `compileMolang(item)` 走单例 | 持有 parser 实例，`parser.compileMolang(item)` |
| `animation.ts` `parseClipTimeline` | 已用 `createMolangParser()` | 不变 |
| `animation-controller.ts` | 已用 `createMolangParser()` | 不变 |
| `animation.test.ts` | `getMolangParser` spy | 改为工厂实例测试 |
| `molang.test.ts` | 测试单例/工厂行为 | 移除单例测试，保留工厂测试 |
| `ysm-animation-player.test.ts` | 静态 import `compileMolang` | 改为 import 工厂或 mock 实例 |

**关键改动**：`parseBedrockAnimationJSON` 在入口处创建一次 parser 实例，通过闭包传递给 `parseAxisItem` → `parseKeyValue` → `extractKeyframe` → `parseChannel` 调用链。

### 2.4 函数签名变更

`parseBedrockAnimationJSON` 新增可选 `parser` 参数（向后兼容）：

```ts
export function parseBedrockAnimationJSON(
  jsonStr: string,
  parser?: MolangParser,
): { clips: AnimationClip[]; errors: string[] }
```

不传时内部 `createMolangParser()` 兜底，保持消费方零改动。

## 3. 后果（Consequences）

### 正面
- 消除双生命周期维护：每个解析/播放会话持有独立 parser 实例
- 代码精简：移除 deprecated 单例代码
- 测试隔离：不再依赖全局状态
- 与 ADR-211 对齐：clip 自带 parser 实例成为统一范式

### 负面
- `parseAxisItem` / `parseKeyValue` / `extractKeyframe` / `parseChannel` 需增加 `parser` 参数——4 个内部函数签名变更
- 测试中 `getMolangParser` spy 需改为 `createMolangParser()` + 实例 spy
- **LRU 缓存碎片化**：每 parse 新建 Molang 实例会丢单例时代跨解析共享的 molangjs LRU 表达式缓存（ADR-211 每 clip 一实例已付过一次）。动画解析是低频操作（模型加载时一次），影响可忽略；但若未来高频解析场景出现，可考虑实例池化

### 风险
- `parseBedrockAnimationJSON` 的 `parser` 可选参数使函数签名变复杂——但内部兜底逻辑简单，不增加调用方负担

## 4. 实施计划

| 步骤 | 文件 | 内容 |
|------|------|------|
| 1 | `molang.ts` | 删除 `parser` 单例 + `getMolangParser` + 模块级 `compileMolang` |
| 2 | `molang.ts` | 保留 `createMolangParser` 工厂 + `MolangParser` 接口 |
| 3 | `animation.ts`（拆分后保留解析器的文件） | `parseBedrockAnimationJSON` 新增 `parser` 可选参数，内部创建兜底 |
| 4 | `animation.ts` | `parseAxisItem` / `parseKeyValue` / `extractKeyframe` / `parseChannel` 增加 `parser` 参数 |
| 5 | `animation.test.ts` | 移除 `getMolangParser` spy，改为工厂实例测试 |
| 6 | `molang.test.ts` | 更新测试，验证工厂实例隔离性 |
| 7 | `ysm-animation-player.test.ts` | 更新 mock 从单例改为工厂实例 |
| 8 | 验证 | `npx vite build && npm run typecheck && npx vitest` |
| 9 | 提交 | 与 ADR-212 同一 PR |

## 5. 数据溯源

- 当前文件：`frontend/src/utils/animation/molang.ts`
- 单例定义：模块级 `const parser = new Molang()`
- deprecated 导出：`getMolangParser`
- 工厂定义：`createMolangParser`
- 单例消费方：`animation.ts` `parseAxisItem`（`compileMolang(item)`）
- 工厂消费方：`animation.ts` `parseClipTimeline`（`parser.compileMolang`）、`animation-controller.ts`（`createMolangParser()`）
- 测试：`molang.test.ts`、`animation.test.ts`（`getMolangParser` spy）、`ysm-animation-player.test.ts`（静态 import `compileMolang`）
