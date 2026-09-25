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
  - "三范式各有边界，禁止混搭：卡片=`stgCard()`（含 `stg-grid` 平铺的同族小卡，如路径/字体/鸣谢）；选择器瓦片=`theme-card`（主题六选一，已在 `.theme-picker` 内）；紧凑单控件=`settings-group`+`setting-row`（滑块/下拉/开关，以及键位动作行）。键位是快捷键单值，不得为每个动作嵌套一张 `stg-card`"

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
  - **tab 结构（2026-10 菜单收口，方案 A；2026-09-25 锐评改名 + 语义收债）**：4 tab（**环境**/外观/**3D 预览**/更新与关于），tab 文案键 = `settings.env` / `settings.appearance` / `settings.tab3d` / `settings.aboutUpdate`。「解析」（FBX/MMD worker 开关）=「3D 预览」tab 内的「解析」折叠节、不占独立槽；「鸣谢」（纯只读展示）=「更新与关于」tab 下段小节，`tpl-settings-about.ts|aboutPageBody` 是「更新与关于 + 鸣谢」页唯一组合根。「启动默认页面」归入「环境」，不归外观；**「语言」显示偏好随之迁出环境、归入「外观」**（用户第一直觉在外观，旧挂「常规」违反「槽位回答这里能配什么」）。槽位语义契约：菜单槽回答「这里能配置什么」——两个开关/只读展示不占槽；「更新与关于」含真实设置（更新检查间隔/检查更新/版本）故保留 tab
    - ⚠️ 原第三个 tab 键名为 `settings.operations`（"操作"）而文案写「3D 与解析」——**键名与显示文案脱节**，且「3D 与解析」是「解析 tab 降级并入 3D」时的妥协拼接词，用户无法从名字推断内容，形成「猜 tab + 展开折叠」的双重隐藏。2026-09 已改名 `settings.tab3d` =「3D 预览」，键名与文案对齐，名字直接回答「这里配什么」。**新增 tab 时键名必须与其显示文案同义**，禁止留历史妥协名。
    - ⚠️ **命名脱钩有两个载体，i18n 键改了 ≠ id 改了**（2026-09-25 收债）：上一轮只改了 i18n 键，`tpl-settings.ts|settingsHTML` 的 `TabSpec.id` 仍是 `basic/ui/ops`（`ops` 显示「3D 预览」、`ui` 显示「外观」），而 **id 才是 DOM `data-tab` 与面板 id `stg-tab-<id>` 的唯一锚点**（测试钩子/未来深链接都抓它）。现已统一为 `env/appearance/preview3d/aboutUpdate`（general→env、about→aboutUpdate 为 2026-09-25 语义收债：旧名「常规/关于」答不了「这里能配什么」），并抽 `SettingsTabId` 联合类型 + `SETTINGS_TAB_META`（`Record<SettingsTabId, {icon; labelKey}>`）+ `buildSettingsTabs(bodies: Record<SettingsTabId, string>)`：新增 tab 漏给图标/文案键/面板体任一处即**编译期报错**（照抄 ADR-303 `Record<TdRotMode, LocaleKey>` 护栏）。改名须同步 `tpl.test.ts` / `app-content.component.test.ts` 的 `stg-tab-*` 锚点。
    - ⚠️ **testid 前缀必须与 DOM id 模板岔开**：按钮 testid 用 `stg-tabbtn-<id>`、面板 testid 用 `stg-panel-<id>`，不得叫 `stg-tab-<id>`——因为 `data-testid="stg-tab-general"` 的属性文本里天然含子串 `id="stg-tab-general"`，测试按 `id="` 锚点切片（`tpl.test.ts|panelSlice`）会先命中 tab 栏按钮而非面板，切片被顶到 bar 上（2026-09-25 实测）。三套命名空间互不重叠：面板 DOM id `stg-tab-*` / 按钮 DOM id `stg-tab-btn-*`（bindTabs 运行期写）/ testid `stg-tabbtn-*`,`stg-panel-*`。
    - **tab 图标语义（2026-09-25 收债，防跨层级撞形）**：「环境」tab = `UI_ICONS.folder`（本地落点，路径/链接/镜像源/存储/启动页都归「东西放哪」），**不用 `settings`（齿轮）**——齿轮是左侧一级导航设置入口（`nav-items.ts` icon:"settings"），页内二级 tab 复用同形 → 「点齿轮」在两种层级间歧义；也不用 `controls`（三滑块）挂在没有滑块的环境 tab。「外观」tab = `UI_ICONS.brush`（画笔），**曾误用 `appearance`（圆脸笑脸）且同一常量被一级导航「社区」占用**（`nav-items.ts` icon:"appearance" → 2026-09-25 改 `users`，消除跨两级同形歧义，同类病「齿轮撞形」的延伸）。「3D 预览」tab = `UI_ICONS.voxel`（立方体），**不用 `joystick`（手柄=输入操作）**——本 tab 配的是「看的方式」（相机/旋转/键位/解析），不是手柄映射。同理「下载镜像源」卡用 `download` 而非 `web`——`web` 与语言卡的 `globe` 引用同一个 `GLOBE_PATH` 常量（`ui-icons.ts` 两个别名），渲染逐字节相同，2026-09 那次「图标语义校正」只换变量名零视觉产出。**校验图标是否真不同，要比对其引用的 path 常量，不是比变量名。**
  - **设置页布局与交互硬化**：`.stg-page` 是 tab 面板唯一滚动容器，`settingsHTML` 不再给 tab-body 叠加 `overflow-y:auto`；`.stg-grid` 使用 `auto-fit + minmax(min(220px,100%),1fr)`，子项 `min-width:0`，卡片 header 可换行；键位网格额外使用 `.stg-keymap-grid { width:100%; }`，避免在 `setting-row` 的 `align-items:flex-start` 下被压成单列窄条。路径值、路径 picker、主题瓦片使用原生 `<button type="button">`；主题初始化/手动/自动切换同步 `.active` 与 `aria-pressed`。`renderStgBasicPaths` 仅在有实际路径卡时输出网格；Android viewer 不输出空「路径配置」区，Web viewer 保留文件来源标题但不输出空网格。
  - **解析与鸣谢渐进披露**：`tpl-settings.ts|renderStgParserWorkers` 与 `tpl-settings-about.ts|creditsSection` 使用默认收起的原生 `<details>`；worker checkbox 通过 `aria-labelledby` 同时说明格式/动作，并通过 `aria-describedby` 关联 hint。新增折叠区必须保留 summary 入口与原生键盘行为，不能用不可访问的 `div` 模拟。
  - **3D 键位编辑约定**：`keymap.ts|tdRenderKeymap` 捕获的是单个 `KeyboardEvent.code`，不是组合键；Esc 取消捕获。每个动作使用 `setting-row.stg-keybind-row` 单行呈现，按钮须是原生 button；普通态 aria-label 只表达“动作；快捷键 key”，并用 `aria-keyshortcuts`/`aria-describedby` 补充元信息，捕获态改为“动作：正在等待按键；Esc 取消”并不再宣称旧快捷键；`.stg-keymap-grid` 使用 `auto-fit + minmax(min(220px,100%),1fr)`，不设固定最大列数，键位按钮具备独立边框/背景/焦点样式。
   - **键位 registry 单一事实源**：`preview-3d/infra/keymap.ts|TD_KEYMAP_REGISTRY` 统一声明 action/defaultCode/group/order/fallbackCodes，并派生 `TdKeyAction` 与 `DEFAULT_TD_KEYMAP`；设置页只保留 `Record<TdKeyAction, LocaleKey>` 标签映射并在渲染时调用 `t()`，输入层从 registry 的 fallbackCodes 派生回退表。新增动作先改 registry，禁止重新在 settings/input/infra 各写一份动作列表；未来 3D 菜单须通过 `MenuNode` schema 适配，不复制设置页 HTML。
  - **本页 3D 卡片的值域/默认/枚举消费 `preview-3d/infra/settings-schema.ts`**（ADR-303）：相机速度 range 的 `min/max/value`、旋转模式 `<option>` 集均由 `TD_CAM_SPEED` / `TD_ROT_MODE` 派生，文案键经 `Record<TdRotMode, LocaleKey>` 表（schema 加模式即编译期报错）；禁止在本页重写裸字面量——曾与 3D ⚙ 面板 + 读取层多处副本漂移

## 样式范式契约（UI 一致性）

设置页当前混用 5 种写法，但按语义收敛为 **3 种范式**，各有唯一使用场景。新增/重构设置项先对号入座，禁止自创第四种。

### 范式总览

| 范式 | 唯一造法 | 适用 | 反例（待修债） |
|------|----------|------|----------------|
| 卡片（大/小卡） | `stgCard()`（单张）/ `stgCards()`（同族一组，延迟按序号派生）（`settings/stg-card.ts`） | 自包含功能块：hdr（图标+标题）+ body（值/控件）+ `stg-card-desc`（说明）+ `actions`（按钮）四区齐全；同族多选项用 `stg-grid` 平铺（如路径三卡、字体三卡、鸣谢卡） | 裸 `style="background:var(--surf);border:..."` 内联手写卡、手写 `<div class="stg-card">` 未走构造器 → 间距/圆角/动画与正典卡不一致。**2026-09 已清零**（字体三栏 / 语言选择 / About 五卡全部回填，见文末待修债），新增卡片若再出现裸样式即视为回退 |
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
- **延迟值分界（2026-09 锐评 P2，防手填阶梯漂移）**：**组内**延迟 = 由 `stgCards(items, { startMs, step })` 按 `startMs + i * step` 派生，调用方**不写** `delayMs`；**页面级编排**延迟 = 单卡显式 `delayMs`（如存储卡 180 / 语言卡 240，表达「这一组整体在第几档入场」，非组序号）。此前全页散落 0/60/90/120/150/180/210/240/270/300 十一档手填字面量且两套步长混用，而鸣谢组却用 `60 * (i + 1)` 派生——同一件事两条标准，新增第七张卡时「下一个填多少」无规则。新增同族卡片**必须**走 `stgCards`，禁止再手填组内阶梯。

### 已知待修债（回填计划，按卡推进）

1. ✅ `renderStgLangSelect()`（tpl-settings.ts）手写 `<div class="stg-card">` → 已回填为 `stgCard()`（hdr=语言标题，body=select+描述），单卡场景不再另挂 section-title（2026-09-15）。
2. ✅ `renderStgFontFamily()`（tpl-settings.ts）三栏裸样式 `div` → 已回填为 `stg-grid` 内三张 `stgCard()`（字号/显示字体/密度各一卡，hdr 小标题+body 控件），与路径三卡同构（2026-09-15）。
3. 主题自动切换 / 相机速度 / 旋转模式维持 `setting-row`（本就适合，不动）。
> 剩余非正典卡：主题选择（`theme-card` 瓦片，属选择器范式，正确）、主题自动切换/相机速度/旋转模式（`setting-row`，属行组范式，正确）。
> 4. ✅ **About 五卡裸样式清零**（2026-09 锐评 P1）：`tpl-settings-about.ts|aboutSection` 的 features / 技术栈 / 链接 / 快速开始四组原为裸 `style="background:var(--surf);border:1px solid var(--bd);border-radius:var(--radius-lg)"`（圆角还用 `--radius-lg`，与审计 P1-2 收口后的 `--radius-card` 不同），版本卡更是直接手写 `<div class="stg-card">` 绕过构造器——**均违反本卡自己的「卡片唯一造法」红线**。现五张卡全部走 `stgCard()`/`stgCards()`，圆角/边框/动画由类单点供给；不等宽两列改用 `cardStyle: "flex:2 1 280px"` / `"flex:1 1 220px"` 声明并加 `flex-wrap`（原固定 `flex:2`/`flex:1` 在窄屏会挤爆），入场延迟并入 `stgCards` 派生。**至此设置页裸样式仿卡清零。**
> 鸣谢（tpl-settings-about.ts `creditsSection()`，2026-10 菜单收口自独立 tab 降级为「关于」tab 下段小节）已数组化 + `stgCard`：灵感来源四张抽 `INSPIRATIONS` 数组、贡献者沿用 `CONTRIBUTORS` 数组，二者均 `map` 出 `stgCard()` 平铺于 `stg-grid`（2026-09-15）；加人/加灵感来源只改数据数组。
> 背景：设置页跨多 ADR/PR 长出，`stgCard()` 是 ADR-040 拆分后才有的「正典卡片」，早于它的 section（主题/字体/相机/语言）从未回填，导致「卡片」在项目里实际有 3 种实现。此为存量债，非新增。
## 相关

- 主卡：`docs/knowledge/app-content.md`
- 知识卡：`theme`、`version-updater`、`app-modules`、`app-content`
- `frontend/src/views/app-content/css/content-stg.ts` — 设置页样式层（主卡持有）
