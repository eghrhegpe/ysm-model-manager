# 地面材质参数 × 模式生效矩阵（ADR-249 §2.4 交付物）

> **性质**：ADR-249 的执行依据，非独立 ADR。
> ⚠️ **已过时（2026-09-17 标注）**：本矩阵的 9 值枚举（含 `grid`/`checker`/`stripes`/`diamond`）已被 [ADR-252](adr/ADR-252-ground-canvas-style-material-only.md) 取代——几何图案全部退役，样式轴收敛为纯材质（`plain`/`marble`/`sand`/`grass`）。当前事实源 = `frontend/src/preview-3d/caps/ground-surface-spec.ts` 的 `GROUND_SOURCE_KINDS`（来源轴）/ `GROUND_CANVAS_STYLES`（样式轴）/ `paramIsEffective`（逐参数 × 逐模式判定，`paramVisible` 同源）。本矩阵仅存史，勿按 9 列推断当前控件行为。
> **状态**：🔄 已过时（9 值矩阵仅存史；当前实现以 ground-surface-spec.ts 拆轴后枚举为准）
> **用途**：拆轴（`sourceKind` + `canvasStyle`）时，本矩阵是**菜单可见性**与**渲染读取**的共同单一事实源。禁止菜单与渲染各写一份判断。

---

## 0. 核实方法

三条读取路径，逐条对照源码：

| 路径 | 位置 | 作用 |
|------|------|------|
| **A. 像素生成** | `generateSurfacePixels(st, sizePx)` | 程序化贴图像素，决定 structural 类参数生效与否 |
| **B. 结构落地** | `applyGroundSurfaceStructural(mat, st, tex)` | 有贴图 → `map = tex` + 白乘色；无贴图 → `color` 直出 |
| **C. 外观落地** | `applyGroundSurfaceAppearance(mat, spec, meshSize)` | `opacity`/`transparent`/`depthWrite`/PBR/`map.repeat+rotation` |

**关键判据**：`matScale` / `matRotationDeg` 在路径 C 中作用于 `mat.map`，且被 `if (mat.map)` 包裹——**故其生效前提是该模式产出了贴图**，而非模式本身。

---

## 1. 生效矩阵（已核实）

图例：`✔` = 生效；`—` = 不读取（死参数）；`^` = 生效但语义特殊（见注）。

| 参数 | `none` | `solid` | `plain` | `grid` | `checker` | `stripes` | `diamond` | `marble` | `texture` |
|------|:------:|:-------:|:-------:|:------:|:---------:|:---------:|:---------:|:--------:|:---------:|
| `matColor` | — | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| `matColor2` | — | — | — | — | — | — | — | ✔ | — |
| `matLineColor` | — | — | — | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| `matGridSize` | — | — | — | ✔ | ✔ | ✔^ | ✔^ | ✔^ | — |
| `matDensity` | — | — | — | — | — | ✔ | ✔ | ✔ | — |
| `matAngleDeg` | — | — | — | — | — | ✔ | ✔ | ✔ | — |
| `matOpacity` | — | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `matRoughness` | — | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `matMetalness` | — | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `matScale` | — | — | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `matRotationDeg` | — | — | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |

### 注

- **`^` `matGridSize` 在新三模式语义改变**：`stripes`/`diamond`/`marble` 走 `periodCount = max(1, gridSize) * density`（`ground-surface-spec.ts` 内 "stripes / diamond / marble 不需要基于 cell 的逐格循环" 分支），此时它是**图案周期数**而非「每边格数」。同一控件在两类模式下语义不同——菜单文案需按模式区分，或接受语义泛化为「周期／密度」。
- **`matScale`/`matRotationDeg` 在 `plain` 起生效**：`plain` 产出贴图（纯色像素），故 `mat.map` 非空、`repeat`/`rotation` 可作用。虽视觉上对纯色贴图无观感差异（重复纯色仍是纯色），但**参数确实被读取**——属"生效但不可见"，与 `solid` 的"完全不读"性质不同。
- **`texture` 列**：`matColor` 系列全部 `—`，因为自定义贴图路径 `applyGroundSurfaceStructural` 走 `mat.color.setRGB(1,1,1)` 白乘（色值已烘进用户图片）。当前菜单仍在 `texture` 下显示 3 个色控件，属死控件。

---

## 2. 死控件清单（当前菜单 vs 实际生效）

当前 `ground-menu.ts` 的可见性谓词仅一条：`groundSurfaceOn = (s) => s["env.groundMatSource"] !== "none"`，被挂在**全部** 3 color + 6 slider 上。据 §1 矩阵，实际死控件：

| 模式 | 死控件（可见可调但零效果） |
|------|---------------------------|
| `solid` | 副色、线色、格数、纹理密度、纹理角度、纹理缩放、纹理旋转 |
| `plain` | 副色、线色、格数、纹理密度、纹理角度 |
| `grid` | 副色、纹理密度、纹理角度 |
| `checker` | 副色、纹理密度、纹理角度 |
| `stripes` | 副色 |
| `diamond` | 副色 |
| `marble` | （无死控件） |
| `texture` | 底色、副色、线色、格数、纹理密度、纹理角度 |
| `none` | 全部控件已隐藏（谓词生效）——但地面仍画实色，见 ADR-249 §2.2 |

**`none` 行的特殊性**：控件隐藏正确，渲染错误。属 ADR-249 §1.2 来源一。

---

## 3. 拆轴后的矩阵形态（目标态）

拆为 `sourceKind` + `canvasStyle` 后，可见性由两轴**共同**决定：

```
控件可见 ⇔ 该参数在 (sourceKind, canvasStyle) 组合下生效（据 §1 矩阵）
```

拆轴映射（ADR-249 §2.1）不改变 §1 的生效关系——`grid` 拆成 `(canvas, grid)` 后，`matLineColor` 仍只在该组合生效。**矩阵是拆轴前后的不变量**，故可作为迁移正确性的对照基准。

叠加层（ADR-249 §2.3）的控件生效范围由其**自身**的开启状态决定，与上述两轴正交，需在本矩阵外单独登记。

---

## 4. 实施强制项

1. **本矩阵必须成为代码内的单一事实源**（数据表 + 派生函数为推荐形态），菜单 `visibleWhen` 与渲染读取分支**共同派生自它**。
2. 新增参数 = 矩阵加一行；新增模式 = 矩阵加一列。**漏更新 = 回归死控件**，故须有测试断言「菜单可见集 == 矩阵生效集」。
3. 改 `generateSurfacePixels` 的读取逻辑后，**必须同步复核本矩阵**——矩阵描述的是实现的真实行为，不是设计意图。

<!-- 核实基准: frontend/src/preview-3d/caps/ground-surface-spec.ts (2026-09-16) -->
