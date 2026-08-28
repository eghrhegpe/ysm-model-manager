# ADR-127：性能档位薄壳版——数据表 + 通用套用器（低/中/高/自定义）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-08-29
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/utils/3d/state/perf-presets.ts, ADR-125, ADR-126, docs/knowledge/preview_menu_settings_state.md`

---

## 1. 背景（Context）

3D 预览设置面板（ADR-125/126 落地）有六项独立开关（帧率/分辨率/视锥裁剪/Bloom/PMREM/线框），但**低配机用户要「一键降档」没有入口**——只能在面板里逐项手调，且分不清哪几项真正影响帧率。

相邻项目 MikuMikuAR 的性能预设是**命令式**：`SetPerformanceMode` 走 Wails 绑定（Go 侧持久化）+ 每个模式一个完整参数块写死在映射 + custom 档需手动 reRender 整个面板——模式一多手写映射膨胀、跨语言耦合、面板刷新靠手动重建，是「整出阴影」的方案。

本项目已具备的基座：ADR-125/126 的**状态层**（`preview-state` 六路径统一读写口 `setStateValue`）+ **cap 自报控件**（`MenuControlDef` 稳定 id + `setValue` 写口）——「性能档位」可以只挂在这两个现成写口上，不需要再造机制。

## 2. 决策（Decision）

**薄壳版**：性能档位 = 纯数据表 + 通用套用器，刻意规避 MikuMikuAR 的命令式方案。

- `PERF_PRESETS`（`frontend/src/utils/3d/state/perf-presets.ts`）：低/中/高三档 → `StatePath → 值`，路径类型 `typeof KNOWN_PATHS[number]` 编译期守卫——**新增档位/参数只改表，零代码接线**。
- `applyPerfPreset(level)`：遍历表走 `setStateValue`（状态层统一写口，广播 notify）；cap 缺席的派生路径静默跳过；**custom 不套用**（保持用户手调，零副作用）。
- 档位：低/中/高 + 自定义；持久化键 `ysm_3d_perfPreset`（无存档回 `medium`）。
- **一期范围**：只控有状态层路径的性能项（`render.maxFps` / `render.maxPixelRatio` / `render.bloom`）。wireframe/pmrem 是视觉项不进表；frustumCull 是纯优化（无画质损失）恒开不进表。
- **套用时序**：进入预览 `loadAll（用户持久化）→ setPreset（模型类别预设）→ applyPerfPreset（用户显式档位最后覆盖）`。
- **切档 UI**：设置面板性能组顶部 select（低/中/高/自定义），切档套用后 `menu.refresh()` 刷新兄弟控件显示。
- **否决**命令式方案（对齐 MikuMikuAR 的 `SetPerformanceMode`）：手写映射 + Go 绑定 + custom 档手动 reRender 三重坑。

## 3. 后果（Consequences）

### 正面

- **零接线扩展**：新增档位/参数 = 数据表加一行；副作用由状态层 / cap 的 `setValue` 自理（内聚）。
- **纯前端**：不碰 Go、不引 Wails 绑定，切档刷新走既有 `menu.refresh()`。
- **类型安全**：档位表路径必须落在 KNOWN_PATHS（编译期守卫），写错路径编译失败。

### 负面

- 一期只覆盖有状态层路径的项——深度性能参数（SSAO / SSR / 阴影分辨率）不在档位表；要进档位需先给参数建状态路径或经 cap 控件 id 映射（二期候选）。
- 档位值是人工设计的数据（每档每参数定多少是产品决策，不是自动推导）。

### 已知遗留

- `subscribeSettings` 仍零生产消费者（切档刷新走 `menu.refresh()`，非订阅链路）——观察，等真实「设置↔环境联动」诉求再激活。

## 4. 数据溯源

- **ADR-125 / ADR-126**：状态层六路径 + 单渲染器 + cap 自动聚合——本 ADR 的档位套用器挂在这两个写口上。
- **docs/knowledge/preview_menu_settings_state.md**：「性能档位（P4 延续：薄壳版）」章节（实施进度落知识卡，本 ADR 不记）。
- **实现落点**：`frontend/src/utils/3d/state/perf-presets.ts`（数据表 + 套用器）、`preview-menu-settings.ts`（档位 select）、`mount-preview-core.ts`（进入预览套用）。
- **被否决参照**：MikuMikuAR `settings-graphics.ts` 的 `buildPresetSchema`（命令式预设：Wails 绑定 + 手写参数块 + custom 档 reRender）。

<!-- 文件名: preview-perf-presets.md → 实际文件 ADR-127-preview-perf-presets.md -->
