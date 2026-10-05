# ADR-106：3D 预览环境菜单两级下钻与可视化控件扩展

- **状态**：✅ 已采纳
- **日期**：2026-08-20
- **决策人**：Jieling（人类首席架构师）、AtomCode（AI 代理）
- **相关**：ADR-075（环境控件收进环境菜单）、ADR-076（声明式根菜单外壳）、ADR-097（SceneCapability 注册表）、ADR-099（九 cap 接入 + 五 tab 映射）。本 ADR 在 ADR-075/076/099 的菜单外壳与 cap 注册表之上，扩展两级下钻、分组折叠、跨 cap 预设联动、4 种可视化控件类型（image/color/timeline/histogram）、昼夜循环动画、水面湿润表面模式、环境亮度直方图。

---

## 1. 背景（Context）

### 1.1 一级菜单平铺已到极限

ADR-075/076/099 落地后，环境面板（🌍 environment）的控件数量持续增长：预设、自定义 HDR、背景与强度、雾参数、反射参数、天空时间/云量/昼夜循环、地面开关、水面参数……单层平铺已超过 20 个控件，用户滚动疲劳、定位困难。

### 1.2 声明式控件类型不够丰富

`MenuControlDef.kind` 原仅 `toggle | slider | select | button | divider`。随着功能演进，需要更多可视化控件类型：

- **HDR 预览缩略图**——用户选了自定义 HDR 后，看不到选了什么场景
- **雾效颜色拾取**——fog 颜色固定，无法配合天空色调
- **光影时间轴**——裸 slider 无法直观呈现昼夜光照变化
- **环境亮度直方图**——调 intensity 时没有量化反馈

### 1.3 预设联动散落各 cap

5 个环境预设（☀️晴天/🌅黄昏/🌙夜景/🌳森林/🌤️工作室）各自散落在 sky/fog/environment 的参数里，用户选预设后需手动调三个 cap，体验割裂。

---

## 2. 决策（Decision）

### 2.1 两级下钻菜单结构

`fillEnvironment` 从一级平铺改为两级：

- **第一层**：每 cap 一行摘要（主控件 + cap 名称 + › 下钻箭头），整行可点下钻
- **第二层**：该 cap 完整控件列表（`renderCapControls(subList, controls)`）

**主控件选取规则**：每个 cap 的 `getMenuControls()` 第一个非 divider 控件作为该行主控件：
- environment/fog/reflector：第一个是 `*-enabled` toggle
- sky：第一个是 `sky-time` slider（无 enabled toggle）
- ground：仅一个 visible toggle（纯开关行无 ›）

**`hasSubPanel` 判定**：`controls.length > 1` 才显示 ›。ground 只有一个 toggle → 纯开关行无 ›。

**向后兼容**：无 `menu` 句柄（legacy 调用方）走旧平铺路径 `renderCapControls(list, collectAllControls())`。

### 2.2 子面板分组折叠

`MenuControlDef` 加可选 `group?: string` 字段。`renderCapControls` 检测 group 变化时插入可折叠 section header（▾/▸，默认展开）。`group` 为 `undefined` 的控件直接挂 list（向后兼容）；同一 group 连续控件归入同一 section body。

各 cap 的 group 划分：
- environment：`preview.envGroupPreset` / `preview.envGroupCustomHdr` / `preview.envGroupBackground`
- fog：`preview.fogGroupParams`（开关 + 雾参数）
- reflector：`preview.reflectorGroupParams`（开关 + 反射参数）
- sky：`preview.skyGroupAdvanced`（云量 + 环境贴图 + 昼夜循环）
- ground：`preview.groundGroupWater`（湿润度/水色/不透明度）

### 2.3 预设快捷栏 + 跨 cap 联动

`ENV_PRESET_LINKAGE` 映射表（定义在 `environment-capability.ts`，类型 `EnvPresetLinkage`）描述 5 个预设各对应的 sky.time/cloud + fog.enabled/density/mode/near/far + env.intensity。

`fillEnvironment` 两级路径入口插入一排预设按钮（☀️/🌅/🌙/🌳/🌤️），点击调 `applyPresetLinkage` 联动各 cap，再 `menu.refresh()`。

### 2.4 可视化控件类型扩展

`MenuControlKind` 新增 4 种类型，`renderCapControls` 各加渲染分支：

| kind | 用途 | getValue 返回 |
|------|------|--------------|
| `image` | HDR 预览缩略图 | dataURL 或 null（跳过渲染） |
| `color` | 雾色/水色拾取 | hex number |
| `timeline` | 光影时间轴（昼夜色带 + 太阳标记 + pointer 拖动） | timeOfDay number |
| `histogram` | 环境亮度直方图（16-bin 柱状图） | number[16] |

`getValue` 返回类型从 `number | string | boolean` 扩展为 `number | string | boolean | null | number[]`。

### 2.5 昼夜循环动画

SkyCapability 加 `startAutoRotate/stopAutoRotate/isAutoRotating` 接口：`requestAnimationFrame` 循环递增 `timeOfDay`（1 小时/秒，24 秒一圈）。`dispose()` 调 `stopAutoRotate()` 防泄漏。`getMenuControls` 在 `skyGroupAdvanced` 组追加 `sky-auto-rotate` toggle。

### 2.6 水面（ground 湿润表面模式）

`GroundParams` 加 `wetness`/`waterColor`/`waterOpacity` 字段。`GroundCapability` 加半透明水面 Mesh（`PlaneGeometry` 32×32 分段 + `MeshStandardMaterial`，低粗糙度 0.2 + 中金属度 0.3，`wetness>0` 时显示）。

水面波纹动画：`onBeforeCompile` 注入 `uTime` uniform + vertex shader 三层叠加波（不同方向/频率/振幅/速度）。`update(dt)` 推进 time uniform，mount-preview-core render loop 调用。

### 2.7 环境亮度直方图

`EnvironmentCapability` 加 `getLuminanceHistogram()`：16-bin，Reinhard 映射 + Rec.601 luminance。
- **custom HDR**：`THREE.DataUtils.halfToFloat(u16)` 逐元素转换，降采样（每 ~4096 像素取 1）
- **程序化预设**：从 `backgroundSrcTex` 的 canvas 读 `getImageData`，包 try/catch 防 tainted canvas

`getMenuControls` 在 `envGroupBackground` 组插入 `env-histogram` histogram 控件。

---

## 3. 后果（Consequences）

### 3.1 正面

- **菜单可发现性提升**：两级下钻把 20+ 控件分到 5 个 cap 子面板，首屏只看 5 行摘要
- **预设一键到位**：跨 cap 联动消除"选预设后手动调三处"的割裂
- **可视化反馈**：HDR 缩略图/时间轴/直方图让用户"看到"参数含义，不再裸调 slider
- **声明式扩展闭环**：`MenuControlDef` 类型扩展覆盖了本轮所有可视化需求，未来加新类型只需扩 `kind` 联合 + `renderCapControls` 分支

### 3.2 负面

- **两级路径测试复杂度上升**：`preview-menu-items.test.ts` 需 `as unknown as SceneCapability & { id: "sky" }` 包一层注入 id（测试场景 `sceneCapabilityRegistry` 为空走 ctx getter 回退）
- **half-float reinterpret 易写错**：首版 `getLuminanceHistogram` 用 Uint16→Float32Array bit-reinterpret 产生垃圾值 + 越界读，codereview P2 拦截后改用 `DataUtils.halfToFloat` 逐元素转换
- **水面 onBeforeCompile 维护成本**：自定义 shader 注入依赖 Three.js 内部 shader chunk 名（`#include <common>` / `#include <begin_vertex>`），Three.js 升级时可能需适配


---

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `frontend/src/utils/3d/adapters/preview-menu.ts` — `fillEnvironment` 两级菜单 + `renderCapControls` 分组折叠 + 4 种新控件渲染分支 | 两级下钻 + 分组折叠 + image/color/timeline/histogram 渲染闭环 |
| `frontend/src/utils/3d/caps/scene-capability.ts` — `MenuControlDef` 加 `group?`、`MenuControlKind` 加 4 种新类型、`getValue` 返回类型扩展 | 声明式控件类型扩展闭环 |
| `frontend/src/utils/3d/caps/environment-capability.ts` — `ENV_PRESET_LINKAGE` 映射表 + `getCustomHdrThumbnail()` + `getLuminanceHistogram()` + `getMenuControls` 分组 | 预设联动 + HDR 缩略图 + 亮度直方图 |
| `frontend/src/utils/3d/caps/sky-capability.ts` — `startAutoRotate/stopAutoRotate/isAutoRotating` + `getSunPosition()` | 昼夜循环动画 + 时间轴太阳位置 |
| `frontend/src/utils/3d/caps/fog-capability.ts` — `getColor()` getter + `getMenuControls` 追加 `fog-color` color 控件 | 雾效颜色拾取 |
| `frontend/src/utils/3d/caps/ground-capability.ts` — `GroundParams` 加水面字段 + 半透明水面 Mesh + `onBeforeCompile` 波纹动画 + `update(dt)` | 水面湿润表面模式 + 波纹动画 |
| `frontend/src/core/i18n/locales/{zh-CN,en,ja}.ts` — 三语入库 group 标题键 + 6 个新控件标签 | i18n 三语闭环 |
| 提交 `9f96cd33`/`032faf07`/`262f9c72`/`b7f709cd`/`ee63aba0`/`1f9a6024`/`a1b023d6`/`d5a462e1`/`d328b072`/`e0f590b9`/`8fe4f594` | 本轮 11 次提交完整时间线 |

验证：typecheck ✅ + vitest 86 passed ✅ + vite build 6.31s ✅
