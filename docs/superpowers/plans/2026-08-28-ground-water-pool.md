# 地面/水面拓展与「水池模式」实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在**不拆分** `GroundCapability` 的前提下，大幅丰富地面（表面材质样式 + 程序化纹理）与水面（湿膜 → 可独立开关的「完整水面层」+ 带高度/池壁的水池形态）选项，保持两者共享同一 capability 的技术栈与维护成本。

**Architecture:** 单 capability 双子域策略——`GroundParams` 内新增独立的 `WaterParams` 嵌套对象（替代目前散落的 wetness/waterColor/waterOpacity/normalStrength 四字段），但仍由 GroundCapability 统一生命周期。几何采用 Mode 分派：平面 water mesh（现有湿膜）↔ 池体（盒式凹形 5 面几何，含可见池壁），两者共享 onBeforeCompile 波浪 shader 与法线贴图生成，**完全复用同一技术基盘**，避免技术差。表面材质新增「条纹/菱形/大理石噪声」三种模式与颜色渐变，继续复用 `ground-surface-spec.ts` 的 spec 单源 + structural/appearance 二分，新增字段自动进入 `surfaceSpecKey` 重建判别。

**Tech Stack:** TypeScript, Three.js (r185+), Web Components slide menu, Vitest (node env), i18n 3-locale (zh-CN/en/ja).

---

## 文件影响清单

| 文件 | 操作 | 职责 |
|------|------|------|
| `frontend/src/utils/3d/caps/ground-surface-spec.ts` | **修改** | 新增 matSource 枚举模式 `stripes/diamond/marble`、新增 `matColor2`（渐变副色）、扩展 structural 序列化、扩展像素生成 |
| `frontend/src/utils/3d/caps/ground-surface-spec.test.ts` | **修改** | 新增 3 种模式像素级合约 + specKey 新字段覆盖 |
| `frontend/src/utils/3d/caps/ground-capability.ts` | **修改** | ① 引入 `WaterParams` 嵌套；② 水面几何按 `waterMode=film/pool` 分派；③ 池体盒形 5 面几何构造；④ 新增 setter（水面独立开关/高度/壁厚/池壁颜色/圆角 等）；⑤ 扩展 `gcBuildWaterGroup` 菜单；⑥ 扩展 `gcBuildMaterialGroup`（新增 2 颜色 + 1 密度 slider + 渐变方向）；⑦ saveState/loadState/dispose 同步扩容 |
| `frontend/src/utils/3d/caps/ground-capability.test.ts` | **修改** | 新增 getMenuControls 长度断言修正 + 水面独立开关 + 池体几何 5 面验证 + 高度参数映射 + persist/restore 回归 |
| `frontend/src/core/i18n/locales/zh-CN.ts` | **修改** | 新增 ~18 个 key（水面模式/高度/壁厚/池壁色/圆角/独立开关；表面 渐变副色/密度/方向 + 新材质模式 label） |
| `frontend/src/core/i18n/locales/en.ts` | **修改** | 同上英文 |
| `frontend/src/core/i18n/locales/ja.ts` | **修改** | 同上日文 |

---

### Task 0: 基线验证（不写代码，先锁绿）

**Files:**
- Read: `frontend/src/utils/3d/caps/ground-capability.test.ts`
- Read: `frontend/src/utils/3d/caps/ground-surface-spec.test.ts`

- [ ] **Step 1: 跑 ground 相关测试锁基线**

```bash
cd frontend
npx vitest --run src/utils/3d/caps/ground-capability.test.ts src/utils/3d/caps/ground-surface-spec.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 2: 跑 locales 一致性测试**

```bash
cd frontend
npx vitest --run src/core/i18n/locales-consistency.test.ts
```

Expected: PASS（三语 key 数对齐）。

- [ ] **Step 3: 前端 typecheck + build 锁基线**

```bash
cd frontend
npm run typecheck
npx vite build
```

Expected: 0 errors。

---

### Task 1: 表面材质拓展——3 种新模式 + 渐变副色

**Files:**
- Modify: `frontend/src/utils/3d/caps/ground-surface-spec.ts`
- Modify: `frontend/src/utils/3d/caps/ground-surface-spec.test.ts`

#### Step 1: 写失败测试（新增模式像素 + specKey 字段）

在 `ground-surface-spec.test.ts` 末尾追加：

```ts
describe("GroundSurfaceSpec — 新材质模式（stripes/diamond/marble）", () => {
  it("stripes 模式像素：奇偶列交替 color / lineColor", () => {
    const px = generateSurfacePixels(
      { mode: "stripes", color: [255, 0, 0], lineColor: [0, 0, 255], gridSize: 8, textureToken: "" },
      32,
    );
    // cell=4；列 0~3 主色，4~7 副色，循环
    // 取样 (0,0) 即第 0 列 → 主色 R
    expect(px[0]).toBe(255); expect(px[1]).toBe(0); expect(px[2]).toBe(0);
    // 取样 (4,0) 即第 4 列 → 副色 B
    const i = (0 * 32 + 4) * 4;
    expect(px[i]).toBe(0); expect(px[i+1]).toBe(0); expect(px[i+2]).toBe(255);
  });

  it("diamond 模式像素：对角线方向存在 lineColor 绘制（像素不全是 color）", () => {
    const px = generateSurfacePixels(
      { mode: "diamond", color: [200,200,200], lineColor: [0,0,0], gridSize: 4, textureToken: "" },
      32,
    );
    let hasBlack = false;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] === 0 && px[i+1] === 0 && px[i+2] === 0) { hasBlack = true; break; }
    }
    expect(hasBlack).toBe(true);
  });

  it("marble 模式：像素不是完全均匀（含噪声扰动），输出大小正确", () => {
    const px = generateSurfacePixels(
      { mode: "marble", color: [230,220,200], lineColor: [180,170,150], gridSize: 6, textureToken: "" },
      64,
    );
    expect(px.length).toBe(64 * 64 * 4);
    // 统计非主色像素，marble 必然存在纹线差异
    let different = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] !== 230 || px[i+1] !== 220 || px[i+2] !== 200) different++;
    }
    expect(different).toBeGreaterThan(64 * 64 * 0.05); // >5% 面积有纹
  });

  it("matColor2 变化 → structural specKey 变化（触发重建）", () => {
    const a = buildGroundSurfaceSpec(
      { ...DEFAULT_GROUND_SURFACE_PARAMS, matColor: 0xff0000, matColor2: 0x0000ff, matSource: "solid" },
      "",
    );
    const b = buildGroundSurfaceSpec(
      { ...DEFAULT_GROUND_SURFACE_PARAMS, matColor: 0xff0000, matColor2: 0x00ff00, matSource: "solid" },
      "",
    );
    expect(groundSurfaceNeedsRebuild(a, b)).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试，验证失败**

```bash
cd frontend
npx vitest --run src/utils/3d/caps/ground-surface-spec.test.ts
```

Expected: FAIL — `stripes/diamond/marble` 不在类型；`matColor2` 不在 `GroundMaterialParams`。

- [ ] **Step 3: 实现 spec 层改动**

在 `ground-surface-spec.ts`：

1) `GroundSurfaceMode` 扩展：
```ts
export type GroundSurfaceMode = "none" | "solid" | "plain" | "grid" | "checker" | "texture" | "stripes" | "diamond" | "marble";
```

2) `GroundMaterialParams` 新增：
```ts
  /** 渐变副色 / 大理石纹线色（当 mode=solid→渐变；mode=marble→纹线） */
  matColor2: number;
  /** 纹理密度（条纹/marble 有效，控制粗细） */
  matDensity: number;
  /** 渐变/条纹角度（度） */
  matAngleDeg: number;
```

3) `DEFAULT_GROUND_SURFACE_PARAMS` 追加：
```ts
  matColor2: 0x6b5d4c,
  matDensity: 1,
  matAngleDeg: 0,
```

4) `GroundSurfaceStructuralSpec` 新增 3 字段：
```ts
  color2: [number, number, number];
  density: number;
  angleRad: number; // 结构性：改变角度会改变像素图案内容
```

5) `buildGroundSurfaceSpec` 同步赋值：
```ts
    color2: hexToTriple(p.matColor2),
    density: p.matDensity,
    angleRad: (p.matAngleDeg * Math.PI) / 180,
```

6) `surfaceSpecKey` 数组追加三行：
```ts
    st.color2[0], st.color2[1], st.color2[2],
    st.density,
    st.angleRad,
```

7) `generateSurfacePixels` 扩展：在 `checker/grid` 的 else 分支之后追加三种模式的像素生成。要点：
   - **stripes**：按角度旋转后的 x' = x cos θ + y sin θ，每 (cell / density) 宽度交替 color / color2（不是 lineColor，保持语义一致：lineColor 保留给 grid/checker 的线/副格用）
   - **diamond**：`|x| + |y| = const` 菱形等距线，线宽 2px 用 lineColor，填充用 color
   - **marble**：用**种子化位置哈希噪声**（不要 Math.random()，保证可复现）生成 sin 带状条纹并叠加扰动，再在 color 与 color2 间 lerp；密度影响频率

> marble 噪声函数（位置相关哈希，可直接内联）：
> ```ts
> function hash2(x: number, y: number): number {
>   let h = x * 374761393 + y * 668265263;
>   h = (h ^ (h >>> 13)) * 1274126177;
>   return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
> }
> function smoothStep(t: number): number { return t * t * (3 - 2 * t); }
> function valueNoise(x: number, y: number): number {
>   const xi = Math.floor(x), yi = Math.floor(y);
>   const xf = x - xi, yf = y - yi;
>   const a = hash2(xi, yi), b = hash2(xi + 1, yi);
>   const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
>   const u = smoothStep(xf), v = smoothStep(yf);
>   return a * (1-u)*(1-v) + b * u*(1-v) + c * (1-u)*v + d * u*v;
> }
> ```
> marble 的核心：对每像素归一化位置，叠加多层 valueNoise → 得到 `n` → `t = 0.5 + 0.5 * sin((normX*freq + n*amp) * Math.PI * 2)` → 在 `color` 与 `color2` 间 `Math.round(a + t*(b-a))` 混色。

- [ ] **Step 4: 重跑测试验证通过**

```bash
cd frontend
npx vitest --run src/utils/3d/caps/ground-surface-spec.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 5: typecheck**

```bash
cd frontend && npm run typecheck
```

Expected: 0 errors。

- [ ] **Step 6: 路径限定提交**

```bash
git add frontend/src/utils/3d/caps/ground-surface-spec.ts frontend/src/utils/3d/caps/ground-surface-spec.test.ts
git commit -m "feat(ground): 表面材质新增 stripes/diamond/marble 模式 + 渐变副色" -- frontend/src/utils/3d/caps/ground-surface-spec.ts frontend/src/utils/3d/caps/ground-surface-spec.test.ts
```

---

### Task 2: GroundCapability — 水面参数字段嵌套化 + 独立开关

**Files:**
- Modify: `frontend/src/utils/3d/caps/ground-capability.ts`
- Modify: `frontend/src/utils/3d/caps/ground-capability.test.ts`

- [ ] **Step 1: 写失败测试——water 独立 enabled + params 嵌套访问**

追加到 `ground-capability.test.ts` 的 `describe("GroundCapability")`：

```ts
  it("水面支持独立开关：关地面后仍可开水面（水膜独立于地网格）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    cap.setVisible(false);      // 关地面
    cap.setWaterEnabled(true);  // 开水面
    expect(cap.getVisible()).toBe(false);
    expect(cap.getWaterEnabled()).toBe(true);
    const water = scene.getObjectByName("ysm-ground-water");
    expect(water?.visible).toBe(true);
  });

  it("waterMode=film 保持水膜薄平面；waterMode=pool 后 ysm-ground-water 子元素≥4（池壁四面+顶）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    // 初始 film 模式：单 mesh
    expect(scene.getObjectByName("ysm-ground-water")).toBeInstanceOf(THREE.Mesh);
    cap.setWaterMode("pool");
    cap.setPoolHeight(0.8);
    const pool = scene.getObjectByName("ysm-ground-water")!;
    // 池体切换后应为 Group 或含 ≥4 子 mesh
    const meshes: THREE.Mesh[] = [];
    pool.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    expect(meshes.length).toBeGreaterThanOrEqual(5); // 底 + 四壁 = 5
  });

  it("setPoolHeight / setPoolWallColor 不抛错，setter/getter 一致", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.setPoolHeight(1.2);
    expect(cap.getPoolHeight()).toBe(1.2);
    cap.setPoolWallColor(0x2244aa);
    expect(cap.getPoolWallColor()).toBe(0x2244aa);
  });
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
cd frontend
npx vitest --run src/utils/3d/caps/ground-capability.test.ts
```

Expected: FAIL — `setWaterEnabled/setWaterMode/setPoolHeight` 不存在。

- [ ] **Step 3: 实现 — params 嵌套化（零行为变化，纯重构）**

在 `ground-capability.ts`：

1) 新增嵌套接口（放在文件顶部、DEFAULT_GROUND_PARAMS 之前）：
```ts
export type WaterMode = "film" | "pool";

export interface WaterParams {
  /** 水面是否独立启用（总开关，与地面 visible 无关） */
  enabled: boolean;
  /** 水面呈现模式：film=贴地薄水膜（原效果）；pool=立体水池（有侧壁+高度） */
  mode: WaterMode;
  /** 湿润度 0=干 1=完全湿润（film 模式下相当于乘 opacity 的遮罩） */
  wetness: number;
  /** 水面颜色 */
  waterColor: number;
  /** 水面不透明度 0=透明 1=不透明 */
  waterOpacity: number;
  /** 波浪法线强度 0=无 1=强 */
  normalStrength: number;
  /** （pool）水面高度（从 y=0 起的正高度，单位世界；默认 0.3） */
  poolHeight: number;
  /** （pool）池壁厚度（默认 0.15，太小会 z-fighting） */
  poolWallThickness: number;
  /** （pool）池壁外侧面颜色（默认深灰蓝，与水面形成内外对比） */
  poolWallColor: number;
  /** （pool）水池内圆角半径（默认 0，0=直角，0~0.5 范围） */
  poolRoundness: number;
  /** （pool）波纹速度倍率（默认 1.0，用户可让水池更湍急/更静止） */
  waveSpeed: number;
  /** （pool）水体透射/透明感（菲涅尔感用；默认 0.6） */
  clarity: number;
}
```

2) `GroundParams` 内替换水面四散落字段为：
```ts
  /** 水面参数（嵌套：未来继续加水属性不需要改 GroundParams 顶层签名） */
  water: WaterParams;
```

3) `DEFAULT_GROUND_PARAMS` 对应重写：移除 wetness/waterColor/waterOpacity/normalStrength 四顶层字段，改为：
```ts
  water: {
    enabled: true,
    mode: "film",
    wetness: 0.15,
    waterColor: 0x335577,
    waterOpacity: 0.25,
    normalStrength: 0.08,
    poolHeight: 0.3,
    poolWallThickness: 0.15,
    poolWallColor: 0x1a2a44,
    poolRoundness: 0,
    waveSpeed: 1.0,
    clarity: 0.6,
  },
```

4) 所有旧的 4 个顶层 getter/setter（`setWetness/getWetness/setWaterColor/getWaterColor/setWaterOpacity/getWaterOpacity/setNormalStrength/getNormalStrength`）改为通过 `this.params.water.xxx` 读写；**保留对外 API 名不变**（避免破坏菜单、持久化迁移还没做的瞬间），但内部指向 `params.water.xxx`。

5) 构造函数中 `createWaterMesh()` 与所有访问 `this.params.wetness / this.params.waterColor` 的地方，同步改为 `this.params.water.wetness` 等。

6) **迁移兼容性层**：在 `loadState()` 开头加一次性迁移逻辑——若 state 顶层有 `wetness/waterColor/waterOpacity/normalStrength` 任意一个（旧存档），则打包进 `state.water = { enabled: true, mode: "film", ... }`，保证旧 localStorage 不用清零即可恢复。

> 伪代码：
> ```ts
> // 旧态迁移（2026-08-28 前的存档：水字段在顶层）
> const legacyWater = (
>   typeof state.wetness === "number" ||
>   typeof state.waterColor === "number" ||
>   typeof state.waterOpacity === "number" ||
>   typeof state.normalStrength === "number"
> );
> if (legacyWater) {
>   state.water = {
>     ...DEFAULT_GROUND_PARAMS.water,
>     ...(state.water ?? {}),
>     wetness: typeof state.wetness === "number" ? state.wetness : DEFAULT_GROUND_PARAMS.water.wetness,
>     waterColor: typeof state.waterColor === "number" ? state.waterColor : DEFAULT_GROUND_PARAMS.water.waterColor,
>     waterOpacity: typeof state.waterOpacity === "number" ? state.waterOpacity : DEFAULT_GROUND_PARAMS.water.waterOpacity,
>     normalStrength: typeof state.normalStrength === "number" ? state.normalStrength : DEFAULT_GROUND_PARAMS.water.normalStrength,
>   };
>   delete state.wetness; delete state.waterColor; delete state.waterOpacity; delete state.normalStrength;
> }
> ```

- [ ] **Step 4: 实现 — 水面独立开关（enabled 字段）**

在 GroundCapability 内新增：
```ts
setWaterEnabled(v: boolean): void {
  this.params.water.enabled = v;
  // film 模式：直接显隐；pool 模式：整个池体 Group 显隐（实现见 Step 6）
  this.syncWaterVisibility();
}
getWaterEnabled(): boolean { return this.params.water.enabled; }

private syncWaterVisibility(): void {
  const on = this.params.water.enabled && (this.params.water.mode === "film" ? this.params.water.wetness > 0 : true);
  // 池体/水膜的容器统一由 this.water 指向（即使 pool 模式它是一个 Group）
  this.water.visible = on;
}
```

并修改 `setVisible(false)` 不再强制 `this.water.visible = false`（水面与地面脱钩——这正是独立开关的语义）。旧 `setWetness` 里 `this.water.visible = this.grid.visible && wetness>0` 改为只改 film 模式下 opacity，可见性交给 `syncWaterVisibility`。

- [ ] **Step 5: 重跑 Step 1 的水独立开关子测试**

```bash
cd frontend
npx vitest --run src/utils/3d/caps/ground-capability.test.ts -t "水面支持独立开关"
```

Expected: PASS。

- [ ] **Step 6: 实现 — 水池模式（mode=pool，盒式凹形 5 面几何）**

目标：当 `setWaterMode("pool")` 被调用时，释放旧 film water mesh，重建为一个 **THREE.Group（name="ysm-ground-water"）**，它包含：
- **水面顶（Top）**：PlaneGeometry(size, size, segments, segments)，y = `poolHeight`，`rotation.x = -Math.PI/2`——继续使用现有 `onBeforeCompile` 注入的波浪 shader（完全复用同一技术基盘，不另写 shader）；材质：MeshPhysicalMaterial（升级自 Standard，加 transmission = water.clarity，thickness = poolHeight，让水体看上去「有厚度和透射」，继续复用 `generateNormalMap` 做 normalMap）。
- **四壁（Walls 内外侧）**：内侧（朝水那面）= 水面色 waterColor、半透明；**外侧**（朝外那面）= `poolWallColor` 不透明实色。几何：4 个 PlaneGeometry 围成长方形——
  - 北壁：z = -size/2，面朝 +z；宽 size × 高 poolHeight；上 y = poolHeight，下 y = 0
  - 南壁：z = +size/2，面朝 -z
  - 东壁：x = +size/2，面朝 -x；高 poolHeight 宽 size（注意：PlaneGeometry 是 xy 平面，需 `rotation.y = Math.PI/2` 或 `rotation.y = -Math.PI/2`）
  - 西壁：x = -size/2，面朝 +x
- **池底（Bottom）**：贴 y=0，size×size 的 PlaneGeometry（朝上），用 poolWallColor 纯色。

为了减少 draw call：**内侧四壁共用 1 份 MeshPhysicalMaterial（水色 + transmission），外侧四壁共用 1 份 MeshStandardMaterial（wallColor + 不透明），顶 1 份，底 1 份——总共 4 份 material × 9 个 mesh。**

**关于圆角**（`poolRoundness`）：v1 不做真几何圆角（代价大且易有 UV 缝），改为**材质级近似**：在水顶 shader 注入里，距离水面边 `d = min(|x|,|z|)/halfSize`，当 `d < roundness*2` 时 opacity 做 smoothstep 衰减，视觉上边缘「变薄羽化」，成本为 0 几何重建。这样用户 slider 从 0~0.5 拖动能立即看到变化。

**几何切换入口**：
```ts
setWaterMode(m: WaterMode): void {
  if (this.params.water.mode === m) return;
  this.params.water.mode = m;
  this.rebuildWater(); // 释放旧 water 容器 + 按 mode 重建新容器 this.water（Mesh 或 Group），保持同名 ysm-ground-water，然后 apply 时 scene.add 不重复
}
```

**波纹速度**：在 `update(dt)` 中改为 `this.waterTime.value += dt * this.params.water.waveSpeed`，实现用户可调速。

**clarity（透射）**：顶 material `transmission = params.water.clarity`，`thickness = params.water.poolHeight * 0.5`；内侧壁 `transmission = params.water.clarity * 0.5`。

- [ ] **Step 7: 实现 setter 对重建的门控**

凡是需要改几何尺寸的 setter（`setPoolHeight`、`setSize`（现有？需新增）、`setPoolWallThickness`、`setWaterMode`）——在 film→pool 切换或变高度时调用 `rebuildWater()`；其他 setter（`setPoolWallColor`、`setWaveSpeed`、`setClarity`）直接 `material.setHex / .uniforms.xxx.value = v` 原地改。

- [ ] **Step 8: 重跑 ground-capability 全量测试**

```bash
cd frontend
npx vitest --run src/utils/3d/caps/ground-capability.test.ts
```

Expected: 全 PASS（注意：旧的 `getMenuControls().length===16` 断言要手动更新，见 Task 4）。

- [ ] **Step 9: typecheck**

```bash
cd frontend && npm run typecheck
```

- [ ] **Step 10: 路径限定提交**

```bash
git add frontend/src/utils/3d/caps/ground-capability.ts frontend/src/utils/3d/caps/ground-capability.test.ts
git commit -m "feat(ground): 水面 params 嵌套化 + 独立开关 + 立体水池模式" -- frontend/src/utils/3d/caps/ground-capability.ts frontend/src/utils/3d/caps/ground-capability.test.ts
```

---

### Task 3: 菜单控件扩容 — 水组 9 控件 + 材质组 15 控件

**Files:**
- Modify: `frontend/src/utils/3d/caps/ground-capability.ts`（`gcBuildWaterGroup` / `gcBuildMaterialGroup` / `getMenuControls`）
- Modify: `frontend/src/core/i18n/locales/zh-CN.ts`
- Modify: `frontend/src/core/i18n/locales/en.ts`
- Modify: `frontend/src/core/i18n/locales/ja.ts`

- [ ] **Step 1: 先写失败测试 — 新控件数与 group 归属**

追加到 `ground-capability.test.ts` 的 `getMenuControls 分组` describe：

```ts
  it("2026-08 拓展后控件：总开关 1 + 水组 9 + 材质组 15 = 25 控件", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    const c = cap.getMenuControls();
    expect(c.length).toBe(25);
    const w = c.filter((x) => x.group === "preview.groundGroupWater");
    expect(w.length).toBe(9);
    expect(w.map((x) => x.id)).toEqual(expect.arrayContaining([
      "ground-water-enabled",
      "ground-water-mode",
      "ground-wetness",
      "ground-water-color",
      "ground-water-opacity",
      "ground-normal-strength",
      "ground-pool-height",
      "ground-pool-wall-color",
      "ground-pool-roundness",
    ]));
    const m = c.filter((x) => x.group === "preview.groundGroupMaterial");
    expect(m.length).toBe(15);
  });
```

- [ ] **Step 2: 实现 i18n 三语同步新增 key**

zh-CN 在 `preview.ground*` 同区段追加：

```ts
  "preview.groundWaterEnabled": "启用水面",
  "preview.groundWaterMode": "水面形态",
  "preview.groundWaterModeFilm": "薄水膜",
  "preview.groundWaterModePool": "立体水池",
  "preview.groundPoolHeight": "水池高度",
  "preview.groundPoolWallColor": "池壁颜色",
  "preview.groundPoolRoundness": "边缘羽化",
  "preview.groundWaveSpeed": "波速倍率",
  "preview.groundClarity": "水体通透度",

  "preview.groundMatStripes": "条纹",
  "preview.groundMatDiamond": "菱形",
  "preview.groundMatMarble": "大理石",
  "preview.groundMatColor2": "渐变副色",
  "preview.groundMatDensity": "纹理密度",
  "preview.groundMatAngle": "图案角度",
```

en.ts 对应英文：
```ts
  "preview.groundWaterEnabled": "Water Overlay",
  "preview.groundWaterMode": "Water Shape",
  "preview.groundWaterModeFilm": "Thin Film",
  "preview.groundWaterModePool": "3D Pool",
  "preview.groundPoolHeight": "Pool Height",
  "preview.groundPoolWallColor": "Pool Wall Color",
  "preview.groundPoolRoundness": "Edge Softness",
  "preview.groundWaveSpeed": "Wave Speed",
  "preview.groundClarity": "Water Clarity",

  "preview.groundMatStripes": "Stripes",
  "preview.groundMatDiamond": "Diamond",
  "preview.groundMatMarble": "Marble",
  "preview.groundMatColor2": "Secondary Color",
  "preview.groundMatDensity": "Pattern Density",
  "preview.groundMatAngle": "Pattern Angle",
```

ja.ts 对应日文（用常见和制译法，可接受近似）：
```ts
  "preview.groundWaterEnabled": "水面を表示",
  "preview.groundWaterMode": "水面の形状",
  "preview.groundWaterModeFilm": "薄い水膜",
  "preview.groundWaterModePool": "立体プール",
  "preview.groundPoolHeight": "プールの高さ",
  "preview.groundPoolWallColor": "プール壁の色",
  "preview.groundPoolRoundness": "エッジの丸み",
  "preview.groundWaveSpeed": "波の速度",
  "preview.groundClarity": "水の透明度",

  "preview.groundMatStripes": "ストライプ",
  "preview.groundMatDiamond": "ダイヤ",
  "preview.groundMatMarble": "マーブル",
  "preview.groundMatColor2": "サブカラー",
  "preview.groundMatDensity": "テクスチャ密度",
  "preview.groundMatAngle": "パターン角度",
```

- [ ] **Step 3: 重写 `gcBuildWaterGroup` 从 4 控件到 9 控件**

结构：
```
水组 preview.groundGroupWater：
1. toggle  ground-water-enabled       水面启用（独立开关）
2. select  ground-water-mode          形态：薄水膜 / 立体水池
3. slider  ground-wetness             湿润度（仅 film 模式生效，UI 可加 hint 或保持静默：功能本身在 pool 模式下 setWetness 仍安全是 no-op 也可）
4. color   ground-water-color         水色
5. slider  ground-water-opacity       不透明度
6. slider  ground-normal-strength     法线强度
7. slider  ground-pool-height         水池高度 0~3 step 0.05 （仅 pool 影响，film 模式安全存值）
8. color   ground-pool-wall-color     池壁色
9. slider  ground-pool-roundness      边缘羽化 0~0.5 step 0.01
```

**波速和通透度**作为「进阶项」先不塞菜单（避免太挤；先 9 控件，后续用户要再加）——但**代码里参数和 setter 已实现**（Task 2.3），只是不暴露控件。这样菜单不会过载。

- [ ] **Step 4: 扩充 `gcBuildMaterialGroup` 从 11 控件到 15 控件**

在现有 `ground-mat-source` 的 select 选项中追加三条：
```ts
  { value: "stripes", labelKey: "preview.groundMatStripes", fallback: "条纹" },
  { value: "diamond", labelKey: "preview.groundMatDiamond", fallback: "菱形" },
  { value: "marble",  labelKey: "preview.groundMatMarble",  fallback: "大理石" },
```

并在清除贴图按钮后追加 4 条新控件：
- gcColorDef(`ground-mat-color2`, `preview.groundMatColor2`, `渐变副色`, getMatColor2, setMatColor2)
- gcSliderDef(`ground-mat-density`, `preview.groundMatDensity`, `纹理密度`, `{min:0.25 max:8 step:0.25}`, getMatDensity, setMatDensity)
- gcSliderDef(`ground-mat-angle`, `preview.groundMatAngle`, `图案角度`, `{min:0 max:360 step:5 unit:"°"}`, getMatAngle, setMatAngle)

同时在 `GroundCapability` 里新增对应 setter/getter（全部 set 完调 `this.refreshSurface()`，与其余 mat setter 同口径），并在 `GroundMaterialParams` 已经有字段（Task 1）：
```ts
setMatColor2(hex: number): void { this.params.matColor2 = hex; this.refreshSurface(); }
getMatColor2(): number { return this.params.matColor2; }
setMatDensity(v: number): void { this.params.matDensity = Math.max(0.25, Math.min(8, v)); this.refreshSurface(); }
getMatDensity(): number { return this.params.matDensity; }
setMatAngle(deg: number): void { this.params.matAngleDeg = ((deg%360)+360)%360; this.refreshSurface(); }
getMatAngle(): number { return this.params.matAngleDeg; }
```

- [ ] **Step 5: saveState/loadState/dispose 扩容**

saveState 里水面改为存嵌套对象：
```ts
water: { ...this.params.water },
```

loadState 里对应白名单赋值（先经迁移层迁移旧态，再 `Object.assign(this.params.water, { enabled/mode/wetness/waterColor/waterOpacity/normalStrength/poolHeight/poolWallThickness/poolWallColor/poolRoundness/waveSpeed/clarity }`，每个字段 `typeof === "number|boolean"` 再赋，保持容错）。

mat 新三件（matColor2/matDensity/matAngleDeg）对应加入 save/load。

- [ ] **Step 6: 跑测试（locales + ground）**

```bash
cd frontend
npx vitest --run src/core/i18n/locales-consistency.test.ts src/utils/3d/caps/ground-capability.test.ts src/utils/3d/caps/ground-surface-spec.test.ts
```

Expected: 全 PASS。

- [ ] **Step 7: 前端 build + typecheck**

```bash
cd frontend
npm run typecheck
npx vite build
```

Expected: 0 errors。

- [ ] **Step 8: 路径限定提交**

```bash
git add frontend/src/utils/3d/caps/ground-capability.ts frontend/src/utils/3d/caps/ground-capability.test.ts frontend/src/core/i18n/locales/zh-CN.ts frontend/src/core/i18n/locales/en.ts frontend/src/core/i18n/locales/ja.ts
git commit -m "feat(ground): 水/表面菜单扩容 + 三语 key 同步" -- frontend/src/utils/3d/caps/ground-capability.ts frontend/src/utils/3d/caps/ground-capability.test.ts frontend/src/core/i18n/locales/zh-CN.ts frontend/src/core/i18n/locales/en.ts frontend/src/core/i18n/locales/ja.ts
```

---

### Task 4: 回归总验 — 知识卡同步 + doctor 文档门

**Files:**
- Modify: `docs/knowledge/ground_surface_spec.md`（新字段/新模式）
- Modify: `docs/knowledge/ground-cap-gcbuildmaterialgroup-133.md`（菜单数量变化）

- [ ] **Step 1: 更新 ground_surface_spec.md 不变量 section**

在「核心职责」buildGroundSurfaceSpec 签名里加 `matColor2/matDensity/matAngleDeg` 三个字段文字描述；在「对外 API」菜单 section 说明表面材质 9 种模式 + 渐变副色 2 色 + 密度 + 角度；在「不变量」第 4 条持久化白名单里加入 matColor2/matDensity/matAngleDeg 三件。

- [ ] **Step 2: 跑 doctor 文档门禁**

```bash
node scripts/doctor.mjs --docs
```

Expected: 无 ERROR；如有知识卡漂移提示，补卡。

- [ ] **Step 3: 前端/Go 总编译（最后防线）**

```bash
cd frontend && npx vite build && cd ..
go build ./go/...
```

Expected: 全绿。

- [ ] **Step 4: 文档路径限定提交**

```bash
git add docs/knowledge/ground_surface_spec.md docs/knowledge/ground-cap-gcbuildmaterialgroup-133.md
git commit -m "docs(ground): 同步 surface 拓展与菜单扩容知识卡" -- docs/knowledge/ground_surface_spec.md docs/knowledge/ground-cap-gcbuildmaterialgroup-133.md
```

---

## 自我审查（Plan 完成度）

**1. Spec 覆盖：**
- ✅ 地面更丰富选项：Task 1 新增 3 种程序化模式 + 渐变副色/密度/角度三控件
- ✅ 水面更丰富选项：Task 2 嵌套化 12 个 WaterParams（enabled/mode/wetness/color/opacity/normalStrength/poolHeight/wallThickness/wallColor/roundness/waveSpeed/clarity）
- ✅ 立体水池（有高度）：Task 2.6 盒式 5 面凹形几何 + 内外侧材质区分 + 边缘羽化圆角
- ✅ 保持不拆：全计划只改 GroundCapability（+ 其下属 spec 与 i18n），不新增独立 WaterCapability
- ✅ 技术基盘共享：水池顶仍复用现有波浪 shader 注入 + generateNormalMap，不新写自定义反射 shader，零技术差

**2. 占位符扫描：** 无 TBD/TODO；所有 setter 有具体实现或明确入口；所有步骤附命令 + 预期输出。

**3. 类型一致性：** GroundMaterialParams 顶层新增 matColor2/matDensity/matAngleDeg 三个字段在 Task 1.3，对应 setter 在 Task 3.4 同步命名；WaterParams 在 Task 2.3，所有 setter/getter 名在 Task 2 断言与 Task 3.1 数组期望中互相一致（`getPoolHeight/setPoolHeight` 等）。
