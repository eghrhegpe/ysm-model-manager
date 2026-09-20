# ADR-286：water applyChangedParams 声明式分派表

- **状态**：✅ 已采纳（2026-09-20，已实施）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-20
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：待补（`docs/adr/` / 关联代码路径）

---

## 1. 背景（Context）

`water-capability.ts` 的 `applyChangedParams(changed)`（~L424-536）是一条手写 if 瀑布：
water 组 14 个参数键逐键 `changed.has("waterXxx")` 分支，每个分支各自取 target、各自 cast 材质、各自写 uniform。ADR-283 §2.6 已判定它为独立病灶（与值域无耦合），明确「拆独立 ADR」——本 ADR 即该项。

病灶特征：
- **新增参数 = 改瀑布**：加一个 water 参数要在瀑布尾部续 if，容易漏掉「changed.has 门控」三件套之外的细节（如 film 下乘 wetness、pool 内壁乘 INNER_WALL_OPACITY_FACTOR）。
- **无完备性检查**：`waterWaveSpeed` 无材质应用，这一「不作为」只靠注释声明，没有结构证据。
- **与 ADR-257 策略表并存但风格不一**：形态差异已查表（strategy），参数应用却仍是手写分支。

## 2. 决策（Decision）

将 if 瀑布替换为**逐键分派表**，键域类型化 + 编译期强制逐键表态：

```ts
type WaterParamKey = Extract<EnvStateKey, `water${string}`>; // water 组键全部带 water 前缀
type WaterApplyCtx = {
  strategy: WaterBodyStrategy;
  targets: (role: WaterPartRole) => THREE.Mesh[];
  syncUniform: (mat: THREE.Material | undefined, name: string, v: number) => void;
};
const WATER_PARAM_APPLIERS: Record<WaterParamKey, (ctx: WaterApplyCtx) => void> = {
  waterWetness: ({ strategy, targets, syncUniform }) => { /* 仅 wetnessGated 形态 */ },
  waterOpacity: ({ /* ... */ }) => { /* 顶水面 + 内壁×FACTOR */ },
  // ...
  waterWaveSpeed: () => {}, // 显式 no-op：仅 update 累加速度读值——「不作为」获得编译期席位
};
```

派发：`for (const k of changed) WATER_PARAM_APPLIERS[k]?.(ctx)`（changed 已被 dispatcher 前置过滤为 water 组）。

要点：
1. **编译期完备**：`Record<WaterParamKey, …>` 缺键即红；`waterWaveSpeed` 的 no-op 条目是结构化声明，替代注释自辩。
2. **顺序无关可证**：现瀑布各分支写的是互不相交的字段（opacity/color/各 uniform/transform），`effectiveOpacity` 由 envState 派生而非由先前分支的副作用累积——分派序与 `changed` 集合序不同不影响结果。此性质写为守卫测试断言（乱序全量 patch 结果一致）。
3. **共享原语收口**：`setUniform`/`syncBaseOpacityUniform`/`INNER_WALL_OPACITY_FACTOR` 仍留 cap（或收进 ctx），条目函数只做「读 envState → 写 target」，不重复 cast 样板。
4. **结构三键（size/poolHeight/wallThickness）**各自独立条目，均调用 `strategy.applyProfile`（幂等 transform），poolHeight/wallThickness 条目内追加派生量（thickness / 内壁 thickness）、size 条目追加 uSize/uHalfSize——与现行为逐条对应，不合并成隐式耦合块。

## 3. 后果（Consequences）

**正面**
- 新增 water 参数 = schema 声明 + 表内加一条目，漏接由编译器兜底。
- 「film 乘 wetness / pool 内壁乘 FACTOR」等形态门控在条目内一眼可见，不再埋在瀑布第 N 个 if 里。
- 与 ADR-257 strategy 表风格统一：形态差异查 strategy，参数应用查本表。

**负面**
- 闭包条目比裸 if 多一层间接；调试栈深一层（可忽略）。
- `waterWaveSpeed: () => {}` 空条目是刻意的冗余（换取完备性），需注释说明防「清理」。

**已知遗留**
- 其余 9 组 cap（ground/sky/…）如出现同病，参照本表模式收敛（只减不增，不强制）。

## 4. 数据溯源

- 病灶定位：`frontend/src/preview-3d/caps/water-capability.ts:424-536`（14 键 if 瀑布）。
- 前置决策：ADR-283 §2.6「明确不做：apply 分派表，拆独立 ADR」→ 本文件。
- 行为基线：`frontend/src/preview-3d/caps/water-capability.test.ts`（既有 water 组全量用例）+ 实施时新增「乱序/单键 patch 等价」守卫测试。
