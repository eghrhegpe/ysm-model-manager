# 拆分 WaterCapability（从 GroundCapability 解耦水面子域）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans 逐 task 执行。先锁基线再动刀。

**Goal:** 将 `GroundCapability` 内的水面子域（`WaterParams` + 波浪 shader/法线贴图 + film/pool 几何 + 菜单 + 持久化）抽成独立的 `WaterCapability`，使其与环境面板（sky/ground/environment/fog/reflector）平级成为一等公民；消除"地面能力里塞水务署"的语义别扭，并让核心循环以泛型方式驱动 `update`。

**Architecture:** 纯机械迁移 + 一处接口升格。
- 水面代码（含 `buildWaveWaterMaterial`/`generateNormalMap`，均为**纯水面专用**，地面不调用）整体迁入新文件 `frontend/src/utils/3d/caps/water-capability.ts`。**不**额外抽共享 `wave-surface.ts`——当前唯一消费者是水面，YAGNI。
- `SceneCapability` 接口增补可选 `update?(dt)`；`mount-preview-core` 把硬编码 `groundCap?.update(dt)` 改为对 `caps` 泛型 `cap.update?.(dt)`。
- 注册表 `add((ctx) => new WaterCapability(ctx))`；`preview-menu-env.ts` 的 `ENV_IDS` 加 `"water"`，水面即成为环境面板独立一行。
- 持久化：WaterCapability 用 `"water"` 键；保留 V1→V2 兼容——从旧 `"ground"` 键读 `wetness/waterColor/waterOpacity/normalStrength` 平铺字段 + `water` 嵌套对象迁到新键。

**Tech Stack:** TypeScript, Three.js, scene-capability 注册表, Vitest (node env), i18n 3-locale。

---

## 文件影响清单

| 文件 | 操作 | 职责 |
|------|------|------|
| `frontend/src/utils/3d/caps/scene-capability.ts` | **改** | 接口加可选 `update?(dt: number): void` |
| `frontend/src/utils/3d/caps/water-capability.ts` | **新建** | 水面全量逻辑（参数/几何/shader/菜单/持久化/update） |
| `frontend/src/utils/3d/caps/ground-capability.ts` | **改** | 删除水面相关全部代码，仅留 grid+surface+material |
| `frontend/src/utils/3d/caps/scene-capability-registry.ts` | **改** | 注册 WaterCapability 工厂 |
| `frontend/src/utils/3d/adapters/preview-menu-env.ts` | **改** | `ENV_IDS` 加 `"water"` |
| `frontend/src/utils/3d/adapters/mount-preview-core.ts` | **改** | `waterCap` 取用 + `update` 泛型驱动 |
| `frontend/src/utils/3d/caps/water-capability.test.ts` | **新建** | 迁入水面测试 |
| `frontend/src/utils/3d/caps/ground-capability.test.ts` | **改** | 删除水面测试、修正分组断言 |
| `docs/knowledge/ground_surface_spec.md` 等 | **改** | 说明水面已独立 |

---

### Task 1: 基线验证（不写代码，先锁绿）

```bash
cd frontend && npx vitest --run src/utils/3d/caps/ground-capability.test.ts
cd frontend && npm run typecheck
```

Expected: 全 PASS，0 类型错误。

### Task 2: SceneCapability 加 `update?`

`scene-capability.ts` 接口 `update`/`dispose` 之间加：
```ts
/** 逐帧更新（可选；动态效果如水面波纹驱动） */
update?(dt: number): void;
```

### Task 3: 新建 water-capability.ts

从 ground-capability.ts 迁出（保持公开 API 名不变）：
- `WaterParams` / `DEFAULT_WATER_PARAMS` / `WATER_MODES`
- 构造器 `{ scene, params?, enabled? }`，内部 `waterMerged` 浅合并
- 私有：`waterTime`、`water`（Mesh|Group）、`buildWaveWaterMaterial`、`generateNormalMap`、`collectWaterMeshes`、`findTopWater`、`createFilmMesh`、`createPoolGroup`、`disposeWater`、`rebuildWaterContainer`、`syncWaterVisibility`
- 公开 setter/getter：setWaterEnabled/getWaterEnabled、setWaterMode/getWaterMode、setWetness/getWetness、setWaterColor/getWaterColor、setWaterOpacity/getWaterOpacity、setNormalStrength/getNormalStrength、setPoolHeight/getPoolHeight、setPoolWallThickness/getPoolWallThickness、setPoolWallColor/getPoolWallColor、setPoolRoundness/getPoolRoundness、setWaveSpeed/getWaveSpeed、setClarity/getClarity
- `apply/dispose/setEnabled/isEnabled/update(dt)/getMenuControls`（gcBuildWaterGroup）/saveState/loadState（含迁移）
- `id="water"`，`labelKey="preview.water"`（需补 i18n），`icon="💧"`，`descKey="preview.waterDesc"`

### Task 4: 瘦身 ground-capability.ts

删除 Task 3 迁走的全部水面代码；`getMenuControls` 仅返回 `gcBuildMain + gcBuildMaterialGroup`；`setVisible/setEnabled/apply/dispose` 去掉 water 行；`saveState/loadState` 去掉 water 字段与 V1 平铺迁移（`water` 嵌套与 `wetness/waterColor/...` 迁移已随 WaterCapability）。`DEFAULT_GROUND_PARAMS` 去掉 `water`。

### Task 5: 接线

1. registry 加 `sceneCapabilityRegistry.add((ctx) => new WaterCapability(ctx));`（顺序：ground 之后）
2. `preview-menu-env.ts:15` `ENV_IDS` 加 `"water"`
3. `mount-preview-core.ts`：`const waterCap = sceneCapabilityRegistry.getById("water") as WaterCapability ?? null;`
   把 `groundCap?.update(dt);` 改为：
   ```ts
   for (const c of caps) c.update?.(dt);
   ```
   （`caps` 为 `createAll` 返回，含新建 water；若 rAF 闭包不可见则改用 `sceneCapabilityRegistry.getAll()`）

### Task 6: 测试搬迁

- `ground-capability.test.ts` 中 "Water 2026-08 拓展" describe + 零散 water 断言 → `water-capability.test.ts`（类名改 `WaterCapability`，WATER_GROUP 引用同步）
- ground 测试分组断言：water 不再属于 ground；`gcBuildWaterGroup` 断言移到 water 测试

### Task 7: 验证

```bash
cd frontend && npx vitest --run src/utils/3d/caps/ src/core/i18n/
cd frontend && npm run typecheck && npx vite build
```

### Task 8: 知识卡 + 提交

- 更新涉及 ground 水面的知识卡（说明已独立为 WaterCapability）
- `node scripts/doctor.mjs --docs` 无 ERROR
- 路径限定提交（并行会话活跃时尤其必要）

---

## 自我审查

- ✅ 解耦：水面成为独立能力，环境面板一等公民
- ✅ 复用保持：`buildWaveWaterMaterial`/`generateNormalMap` 随迁入，未重复
- ✅ 向后兼容：V1→V2 持久化迁移随 WaterCapability 走，旧 localStorage 不丢
- ✅ 红线性：`update` 升格为接口可选方法，核心循环改动与现有 `apply` 泛型口径一致
- 风险 P2：持久化迁移（单测覆盖）、核心循环改动（与 apply 同款遍历）
