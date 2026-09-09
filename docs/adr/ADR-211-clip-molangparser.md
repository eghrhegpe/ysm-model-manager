# ADR-211：clip 自带 MolangParser 实例替代全局单例

- **状态**：✅ 已采纳
- **日期**：2026-09-09
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`utils/animation/molang.ts`、`utils/animation/animation.ts`、`preview-3d/ysm-animation-player.ts`、`utils/animation/animation-controller.ts`

---

## 1. 背景（Context）

`molang.ts` 存在两条编译/求值路径：

1. **全局单例路径**（deprecated）：`compileMolang(expr)` 不传 scope → 闭包 `capturedScope = null` → 求值时回退到模块级 `_writeScope`。运行时 `ysm-animation-player.ts` 必须调 `setMolangScope(controllerVariables)` 把全局 parser 的 `variableHandler` 和 `_writeScope` 指向同一容器，timeline 写入才能被 controller 读到。
2. **工厂实例路径**（正确）：`createMolangParser()` 创建独立实例，`parser.compileMolang(expr, scope)` 闭包捕获 scope，运行时 `parser.setScope(scope)` 接线。

两条路径共存导致：
- `setMolangScope` 标注 deprecated 但无法移除（`parseClipTimeline` 仍编译到单例 parser 上）
- `molang.ts` 201 行中约 80 行是 deprecated 路径的维护代码（`_writeScope`、`_deprecationWarned`、`setMolangScope`、回退逻辑）
- 多播放器场景下全局 `_writeScope` 互盖（已部分修复：controller 走工厂实例，但 timeline 仍走单例）

## 2. 决策（Decision）

**clip 自带 `MolangParser` 实例，timeline 编译/求值彻底摆脱全局单例。**

### 具体方案

1. `AnimationClip` 新增 `molangParser?: MolangParser` 字段
2. `parseClipTimeline` 接受 `MolangParser` 参数，用 `parser.compileMolang(expr)` 编译 timeline 表达式
3. `parseBedrockAnimationJSON` 为每条 clip 创建 `createMolangParser()` 实例并赋值给 `clip.molangParser`
4. 运行时 `ysm-animation-player.ts` 用 `clip.molangParser?.setScope(state.controllerVariables)` 替代 `setMolangScope(...)`
5. 删除 `setMolangScope`、`_writeScope`、`_deprecationWarned`；`compileMolang` 移除 `?? _writeScope` 回退

### 保留

- `compileMolang` 独立函数保留（bone keyframes 仍用，不涉及 v.* 作用域）
- `getMolangParser` 保留但标注 deprecated（测试用，下一 PR 清理）

## 3. 后果（Consequences）

### 正面
- `molang.ts` 缩减约 80 行，消除 deprecated 路径的全部维护成本
- timeline 作用域彻底隔离，多播放器场景不再互盖
- `ysm-animation-player.ts` 不再需要 `setMolangScope` 双路挂载

### 负面
- `AnimationClip` 不再是纯数据对象（携带 parser 实例），但 `AnimationController` 已有先例（`molangParser` 字段），不构成新范式
- 测试需小幅调整（`getMolangParser()` → `createMolangParser()`）

### 已知遗留
- `foldMolangConstant` 仍保留（收益≈0，待 profiling 确认后移除，见 `animation-system.md`）
- `compileMolang` 独立函数仍服务 bone keyframes（不涉及 v.*，无隔离需求）

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `molang.ts` 注释自承「移除条件：重构 timeline 编译/求值链路」 | 本 ADR 即执行该条件 |
| `ysm-animation-player.ts:119-126` 双路挂载注释 | 拆除后只需 `clip.molangParser.setScope` 单路 |
| `animation-controller.ts` 已用工厂实例 | 本 ADR 将同一范式推广到 clip timeline |
