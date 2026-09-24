---
kind: app_content_settings
name: 设置页 settings
tier: leaf
category: ui
source_files:
  - frontend/src/views/app-content/settings/init.ts
  - frontend/src/views/app-content/settings/keymap.ts
  - frontend/src/views/app-content/settings/path-cards.ts
  - frontend/src/views/app-content/settings/store.ts
  - frontend/src/views/app-content/settings/theme.ts
  - frontend/src/views/app-content/settings/ui-prefs.ts
  - frontend/src/views/app-content/settings/worker-prefs.ts
auto_fields:
  symbols_with_lines:
    - applyUIPrefs
    - bindPathClick
    - cardRefreshers
    - cleanupKeymap
    - getCfg
    - initAdvancedGrid
    - initKeymap
    - initMcDetect
    - initSettings
    - initThemeSection
    - initUiPrefs
    - initWorkerPrefs
    - isBusy
    - resetSettingsStore
    - saveCfg
    - setBusy
    - SettingsCfg
    - toastError
  tests:
    - frontend/src/views/app-content/settings/init.test.ts
    - frontend/src/views/app-content/settings/keymap.test.ts
    - frontend/src/views/app-content/settings/theme.test.ts
quick_groups:
  - 配置与注册表
quick_intents:
  - 设置页、主题设置、键位、路径配置
  - 界面偏好、字号、worker-prefs
  - settings/init / keymap / store
quick_risk_lines:
  - 设置项必须经 settings/store.ts 持久化，禁止页面组件各自读写 localStorage
  - 卡片型设置项必须走 `stgCard()` 构造器，禁止手写 `stg-card` div 或裸样式仿卡（字体三栏、语言选择是已知待修债）
pitfalls:
  - 各组件各自读写 localStorage → 值不同步、设置页显示与页面行为不一致；必须经 store 单点
  - 键位未持久化 → 重启恢复默认；必须经 store 的 safeSet 落盘
  - label-for 合规（WCAG 4.1.2）：tpl-settings.ts 14+ 处 `<span class="label">` 全部改为 `<label for="...">` 关联对应 select/input，屏幕阅读器可正确读出「标签→控件」关联
  # ⚠️ frontmatter 是 YAML，不是 Markdown：① 值**不要以 `*` 开头**（YAML 把 `*` 当 alias 指示符
  #   → `unidentified alias`，与 Markdown 粗体无关）；② 值**不要以 `"` 开头后中途闭合**（会被当字符串定界符
  #   → `bad indentation of a sequence entry`）。含引号的长值统一用双引号整体包裹 + 内部 `\"` 转义。
  #   正文里的 `**...**` 不受影响。
  - "卡片唯一造法 = `stgCard()`：新增/重构「卡片型」设置项（hdr 图标+标题 / body 值或控件 / `stg-card-desc` 说明 / `actions` 按钮四区）一律走 `frontend/src/views/app-content/settings/stg-card.ts` 的 `stgCard()` 构造器，禁止手写 `<div class=\"stg-card\">` 或裸 `style=\"background:var(--surf);border:...\"` 仿卡——后者三处间距/圆角/动画各自为政，迟早漂移（见样式范式契约）"
  - "三范式各有边界，禁止混搭：卡片=`stgCard()`（含 `stg-grid` 平铺的同族小卡如键位/路径）；选择器瓦片=`theme-card`（主题六选一，已在 `.theme-picker` 内）；紧凑单控件=`settings-group`+`setting-row`（滑块/下拉/开关，如相机速度、旋转模式、主题自动切换）。不要把单控件塞进 `stg-card`、也不要把同族多选项拆成行组"

use_when:
  - 设置页
  - 主题设置
  - 键位
  - 路径配置
  - 界面偏好
invariant_anchors:
  - frontend/src/views/app-content/settings/init.ts|initSettings
status: active
---

# 设置页 settings

## 概览

`settings/` 是 `app-content` 的「设置」页子域，由主卡 `app-content` 的 `init-pages.ts` 在切到设置页时分发初始化。内部高内聚：`init.ts` 汇聚全部子模块（键位 / 路径卡 / 存储 / 主题 / 界面偏好 / worker 偏好），子模块之间只依赖 `store.ts`，对外只依赖 `core/i18n` / `bus` / `backend` / `utils` / `features/version-updater` 基础设施，**不反向依赖 app-content 其他子域**（归属边界干净，ADR-138 拆分依据）。

## 核心职责

- `init.ts` — 设置页 `initSettings`：直接解构 bindings（`LoadAppConfig` / `SaveAppConfig` / `SelectDirectory` / `GetMinecraftPaths` / `SetLinkMode`），配置变更派发 `config:updated` / `stats:refresh` / `toast:show`，并接入 `initVersionUpdater`；「启动默认页面」下拉读写 localStorage `ui-default-page`，显示值兜底 `repository`（与 `resolveInitialPage` 的兜底一致）
- `store.ts` — 设置存储桥接：`LoadAppConfig` / `SaveAppConfig`（`backend/app.ts`）+ `core/context-menu-shared.ts` 共享
- `keymap.ts` — 键位绑定编辑（依赖 `preview-3d/mesh/model3d.ts` 的 `loadTdKeymap`，相机快捷键与 3D 预览键位同源）
- `path-cards.ts` — 路径配置卡片（目录选择器 `utils/dom/directory-picker` + 类型条目同步读 `utils/resource/schema.ts` 的 `resourceTypesById`，ADR-269 D3④）
- `theme.ts` — 主题设置（写 `window.applyTheme` + localStorage，见知识卡 `theme`）
- `ui-prefs.ts` — 界面偏好（字号五档 `--fs-scale` 偏移 / 字体 / 密度 / 动画开关 `.no-animations`）；真基准 `--fs-base-size` 在 variables.css `:root` 单点定义，此处不再内联覆盖，`app-modules` 启动 IIFE 内 import 调用
- `worker-prefs.ts` — worker 线程数偏好

## 对外 API / 入口

- 由主卡 `app-content` 的 `init-pages.ts` 调用：切设置页 → `settings/init.ts` 的 `initSettings(root)`
- 监听 bus：`config:updated` / `stats:refresh` / `toast:show`（配置变更派发）
- 样式：`.stg-*` 设置页样式 + `#set-advanced-panel` 的 advPanel 动画定义在 `app-content` 样式层 `content-stg.ts`（跨子域共享，不随本卡迁移）

## 与其他子系统关系

- `theme`（主题系统）→ `settings/theme.ts` 消费端（设置页入口点选 → `applyTheme` + localStorage）
- `version-updater`（自动更新）→ `settings/init.ts` 的 `initVersionUpdater` 接入
- `preview-3d/mesh/model3d.ts` → `settings/keymap.ts` 键位同源
- 主卡 `app-content` 负责页面编排与分发；本卡只管设置页自身的初始化与渲染

## 不变量

- 配置变更三事件（`config:updated` / `stats:refresh` / `toast:show`）必须齐全，否则改配置后界面不刷新
- `ui-default-page` 显示值兜底 `repository`，与 `resolveInitialPage` 的兜底一致
- 主题写回必须过白名单（cyber/warm/pro/sakura/ocean/mint/system），防脏值污染持久层
- **链接模式切换 = 确认框 + 全程持锁 + 增量进度**（ADR-296 D5，`init.ts|stgBindLinkMode` / `relinkAllInstancesInner`）：change 回调顶部纳入 `isBusy/setBusy` 守卫（与「重新链接」按钮共锁，busy 期间忽略点击、不弹确认框），发任何 RPC 前先 `ListVersionInstances` 计数并弹 `modalConfirm`（danger；mcRoot 空/计数失败退化 n=0 不拦确认）；**取消必须回退 `linkSelect.value` 与 hint 到上次生效值**（闭包 `curVal` 仅在保存成功后推进，勿用 cfg 初值快照当旧值）且零 RPC、零切换 toast；确认后 relink 段调无守卫的 `relinkAllInstancesInner`（公共出口 `relinkAllInstances` 仍带守卫，供按钮复用——拆 Inner 而非加 skipBusyGuard 参数，锁语义单点）。逐实例增量 toast `settings.relinkProgress{done}/{total}`，末个实例让位终态汇总不重发、单实例无中间进度。测试注意：modalConfirm 结算走退场动画定时器（~120ms），取消回退断言必须 `waitFor` 而非裸 `setTimeout(0)`
- **路径选择走统一 `modalPicker` 脚手架**（2026-09-05 code_review 修复 8cfbf2e7）：path-cards 多路径选择不再自建手写 modal（`.mc-pick-item`/`.mc-pick-cancel` 类已删），测试须驱动共享 DOM 契约——行 `[data-testid="pick-item"]`（`data-idx` 定位）、取消 `[data-testid="dlg-cancel"]`；扫描提示 tooltip 的 id 保持 `mc-scan-tooltip`（init.test.ts 经 `getElementById` 驱动 hover/泄漏回归断言，改名即测试断裂）
- **复制到剪贴板必须消费布尔结果**（code_review 同批修复，宿主 instance-ops.ts 见 [global_handlers](./global-handlers.md)）：`copyText` 永不 reject，Clipboard API/execCommand 兜底失败只返回 false——`await copyText(text)` 丢弃返回值会在失败时误弹「已复制」假成功；须 `const ok = await copyText(text); if (!ok) { error toast; return; }`
  - 卡片型设置项必须走 `stgCard()` 构造器，禁止手写 `stg-card` div 或裸样式仿卡（字体三栏是已知待修债；语言选择已收敛至 stgCard 正典卡 ✅）
  - **tab 按钮 ↔ 面板同源**：设置页 tab 栏 + 面板均由 `renderTabs({prefix:"stg",buttonClass:"stg-tab",tabs:[...]})` 单一工厂产出（ADR-259 §3），`bindTabs` 从 DOM `data-tab` 派发，不再维护 `ids` 白名单；新增 tab 只需在 `tabs` 数组加一项
  - **tab 结构（2026-10 菜单收口）**：4 tab（基础/界面与体验/操作/关于）。「解析」（FBX/MMD worker 开关）=「操作」tab 的「解析」节、不占独立槽；「鸣谢」（纯只读展示）=「关于」tab 下段小节，`tpl-settings-about.ts|aboutPageBody` 是「关于 + 鸣谢」页唯一组合根。槽位语义契约：菜单槽回答「这里能配置什么」——两个开关/只读展示不占槽；「关于」含真实设置（更新检查间隔/检查更新/版本）故保留 tab
  - **本页 3D 卡片的值域/默认/枚举消费 `preview-3d/infra/settings-schema.ts`**（ADR-303）：相机速度 range 的 `min/max/value`、旋转模式 `<option>` 集均由 `TD_CAM_SPEED` / `TD_ROT_MODE` 派生，文案键经 `Record<TdRotMode, LocaleKey>` 表（schema 加模式即编译期报错）；禁止在本页重写裸字面量——曾与 3D ⚙ 面板 + 读取层多处副本漂移

## 样式范式契约（UI 一致性）

设置页当前混用 5 种写法，但按语义收敛为 **3 种范式**，各有唯一使用场景。新增/重构设置项先对号入座，禁止自创第四种。

### 范式总览

| 范式 | 唯一造法 | 适用 | 反例（待修债） |
|------|----------|------|----------------|
| 卡片（大/小卡） | `stgCard()`（`settings/stg-card.ts`） | 自包含功能块：hdr（图标+标题）+ body（值/控件）+ `stg-card-desc`（说明）+ `actions`（按钮）四区齐全；同族多选项用 `stg-grid` 平铺（路径三卡、键位六卡） | 字体三栏（裸 `style="background:var(--surf);border:..."` 内联手写卡）、语言选择（手写 `<div class="stg-card">`，未走构造器）→ 间距/圆角/动画与正典卡不一致 |
| 选择器瓦片 | `theme-card`（`.theme-picker` 内） | 同族多选项的「点选」场景（主题六选一） | 勿把普通卡片写成瓦片 |
| 紧凑行组 | `settings-group` + `setting-row` | 单控件占用整行的紧凑参数：滑块/下拉/开关（相机速度、旋转模式、主题自动切换） | 勿把 2 字标签撑满整行却内容稀疏的项硬塞；确需并排时改用 `stg-grid` 小卡 |

### 判定口诀

- **「一个有标题+说明+可能按钮的功能块」→ `stgCard()`**
- **「一排里选一个」→ `theme-card` 瓦片**
- **「一个滑块/下拉/开关独占一行」→ `setting-row`**

### 入场动画（单一 keyframe）

设置页三类范式的入场动画**统一用 `fadeSlideUp var(--tr-enter) both`**（`.stg-card` / `.settings-group` / `.setting-row` 同一节奏，卡片错峰靠内联 `animation-delay`）；**节标题 `.section-title`（全 app-content 共享原语）也已纳入**——class 内显式 `animation-delay:0ms`，标题恒定 0ms 起播、永不晚于其下方卡片（卡片档 0/60/120ms… 起步），切 tab 观感连贯（2026-09 补）。

- `card-in`（`scale(.95)` 弹出）是 v1.7.6「Keyframe 合并 13→3」明确并入 `fadeSlideUp` 的**旧动画**，其唯一 shadow 层定义已删除；新增卡片/行组/行**不得再引用 `card-in`**（引用已删 keyframe 会静默失效，`css-layer-check` 检查 1/1b 阻断）。
- 内联 `style="animation:..."` 的 keyframe 名必须在同 shadow 层有 `@keyframes` 定义（@keyframes 不穿 shadow，CSS 变量可穿）。
- ⚠️ **注释体内不得写“星号+斜杠”**：会提前闭合注释，其后文本成为裸 CSS 并被当作选择器、吞掉紧随的 `{...}` 块——2026 实测吞掉 `@keyframes fadeSlideUp`，使全 shadow 入场动画（含本节全部范式）静默失效数月（`animationName` 仍显示名字、`getAnimations()` 为 0）。机检 `css-layer-check` 检查 5 + `content-css.test.ts` 单测。

### 已知待修债（回填计划，按卡推进）

1. ✅ `renderStgLangSelect()`（tpl-settings.ts）手写 `<div class="stg-card">` → 已回填为 `stgCard()`（hdr=语言标题，body=select+描述），单卡场景不再另挂 section-title（2026-09-15）。
2. ✅ `renderStgFontFamily()`（tpl-settings.ts）三栏裸样式 `div` → 已回填为 `stg-grid` 内三张 `stgCard()`（字号/显示字体/密度各一卡，hdr 小标题+body 控件），与路径三卡同构（2026-09-15）。
3. 主题自动切换 / 相机速度 / 旋转模式维持 `setting-row`（本就适合，不动）。
> 剩余非正典卡：主题选择（`theme-card` 瓦片，属选择器范式，正确）、主题自动切换/相机速度/旋转模式（`setting-row`，属行组范式，正确）；**About 页（`aboutHTML`）的 features / 技术栈 / 链接 / 快速开始四组仍为裸样式手写卡**（`background:var(--surf);border:...`），用户 2026-09-15 明确暂不处理，列为遗留债。
> 鸣谢（tpl-settings-about.ts `creditsSection()`，2026-10 菜单收口自独立 tab 降级为「关于」tab 下段小节）已数组化 + `stgCard`：灵感来源四张抽 `INSPIRATIONS` 数组、贡献者沿用 `CONTRIBUTORS` 数组，二者均 `map` 出 `stgCard()` 平铺于 `stg-grid`（2026-09-15）；加人/加灵感来源只改数据数组。
> 背景：设置页跨多 ADR/PR 长出，`stgCard()` 是 ADR-040 拆分后才有的「正典卡片」，早于它的 section（主题/字体/相机/语言）从未回填，导致「卡片」在项目里实际有 3 种实现。此为存量债，非新增。
## 相关

- 主卡：`docs/knowledge/app-content.md`
- 知识卡：`theme`、`version-updater`、`app-modules`、`app-content`
- `frontend/src/views/app-content/css/content-stg.ts` — 设置页样式层（主卡持有）
