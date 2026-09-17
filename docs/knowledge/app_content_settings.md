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
  # ⚠️ frontmatter 是 YAML，不是 Markdown：① 值**不要以 `*` 开头**（粗体标记会被当 alias 引用 →
  #   `unidentified alias`）；② 值**不要以 `"` 开头后中途闭合**（会被当字符串定界符 → `bad indentation of a
  #   sequence entry`）。含引号的长值统一用双引号整体包裹 + 内部 `\"` 转义。正文里的 `**...**` 不受影响。
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
- `path-cards.ts` — 路径配置卡片（目录选择器 `utils/dom/directory-picker` + 资源类型注册表 `services/resource-registry`）
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
- **路径选择走统一 `modalPicker` 脚手架**（2026-09-05 code_review 修复 8cfbf2e7）：path-cards 多路径选择不再自建手写 modal（`.mc-pick-item`/`.mc-pick-cancel` 类已删），测试须驱动共享 DOM 契约——行 `[data-testid="pick-item"]`（`data-idx` 定位）、取消 `[data-testid="dlg-cancel"]`；扫描提示 tooltip 的 id 保持 `mc-scan-tooltip`（init.test.ts 经 `getElementById` 驱动 hover/泄漏回归断言，改名即测试断裂）
- **复制到剪贴板必须消费布尔结果**（code_review 同批修复，宿主 instance-ops.ts 见 [global_handlers](./global-handlers.md)）：`copyText` 永不 reject，Clipboard API/execCommand 兜底失败只返回 false——`await copyText(text)` 丢弃返回值会在失败时误弹「已复制」假成功；须 `const ok = await copyText(text); if (!ok) { error toast; return; }`
  - 卡片型设置项必须走 `stgCard()` 构造器，禁止手写 `stg-card` div 或裸样式仿卡（字体三栏、语言选择是已知待修债）
  - **tab 按钮 ↔ 路由白名单必须同源**：新增设置页 tab 时，`renderStgTabs()`（按钮 `data-tab`）与 `init-pages.ts` 的 `bindTabs(host,".stg-tab","stg",[...])` 的 `ids` 数组**两处都要登记**，缺一不可——漏登 `ids` 会导致按钮可见但内容区 `hidden`（点击无反应，e2e 肉眼才发现）。建议收敛为 `SETTINGS_TABS` 单一常量派生两处（待修债，见样式范式契约外另立）。

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

### 已知待修债（回填计划，按卡推进）

1. ✅ `renderStgLangSelect()`（tpl-settings.ts）手写 `<div class="stg-card">` → 已回填为 `stgCard()`（hdr=语言标题，body=select+描述），单卡场景不再另挂 section-title（2026-09-15）。
2. ✅ `renderStgFontFamily()`（tpl-settings.ts）三栏裸样式 `div` → 已回填为 `stg-grid` 内三张 `stgCard()`（字号/显示字体/密度各一卡，hdr 小标题+body 控件），与路径三卡同构（2026-09-15）。
3. 主题自动切换 / 相机速度 / 旋转模式维持 `setting-row`（本就适合，不动）。

> 剩余非正典卡仅剩：主题选择（`theme-card` 瓦片，属选择器范式，正确）、主题自动切换/相机速度/旋转模式（`setting-row`，属行组范式，正确）。设置页三范式现已全部落在正典实现上。
> 背景：设置页跨多 ADR/PR 长出，`stgCard()` 是 ADR-040 拆分后才有的「正典卡片」，早于它的 section（主题/字体/相机/语言）从未回填，导致「卡片」在项目里实际有 3 种实现。此为存量债，非新增。
## 相关

- 主卡：`docs/knowledge/app-content.md`
- 知识卡：`theme`、`version-updater`、`app-modules`、`app-content`
- `frontend/src/views/app-content/css/content-stg.ts` — 设置页样式层（主卡持有）
