---
kind: settings-tpl-shards
name: 设置页 tab 模板分片（tpl-settings-*）
tier: leaf
category: ui
status: active
source_files:
  - frontend/src/views/app-content/settings/tpl-settings-appearance.ts
  - frontend/src/views/app-content/settings/tpl-settings-path.ts
  - frontend/src/views/app-content/settings/tpl-settings-preview3d.ts
auto_fields:
  symbols_with_lines:
    - BASIC_PATH_CARD_SPECS
    - cardSupportedOn
    - renderStgAnimationSection
    - renderStgBasicPaths
    - renderStgDefaultPageSection
    - renderStgFontFamily
    - renderStgLangSelect
    - renderStgParserWorkers
    - renderStgPreview3d
    - renderStgStorageCard
    - renderStgThemeAuto
    - renderStgThemePicker
    - resolveSettingsPlatform
use_when:
  - 设置页外观 tab
  - 设置页环境 tab
  - 设置页 3D 预览 tab
  - 主题卡 / 字体三卡
  - 链接模式 / 镜像源
  - 相机速度 / 旋转模式 / 键位
quick_groups:
  - UI 交互与弹窗
quick_intents:
  - 外观 tab：语言 / 主题色点卡 / 字体三卡 / 动画 / 启动默认页
  - 环境 tab：路径三卡（mc-path / links / mirror）/ 存储卡 / FSA 卡
  - 3D 预览 tab：相机速度 / 旋转模式 / 键位三卡 + 解析 workers 折叠区
  - stgCard / stgCards 卡片正典与 stgUnits 入场编排
quick_risk_lines:
  - 模板分片出卡一律 stgCard()/stgCards() 构造器 + schema 枚举派生 option，禁手写裸 div 卡片与裸 option 列
pitfalls:
  - 主题图标/文案表必须保持 Record<ThemeCard, …> 形态——theme-core 加主题漏键即编译期报错，勿回退 Record<string, …> + 运行时 ?? 兜底
  - 入场步长一律由 stgUnits 注入（startMs/cardStep 参数），分片内硬编码 step 会造成「单元表声明 + 内部步长」双源
  - 平台能力矩阵 PATH_CARD_PLATFORMS 是「哪张卡在哪些平台真能用」的单一事实源，渲染函数与测试只消费它，勿各搓 flag
last_verified: 2026-10-09
---

# 设置页 tab 模板分片（tpl-settings-*）

## 概览

设置页三个 tab 的正文模板分片，系 2026-10-07 ADR-040 P1 分片收口自 `tpl-settings.ts` 拆出（只搬移不改行为：所有 render* 函数与常量表逐字保留，仍返回 string——本分片是模板文件，R8「非模板文件不新增 HTML 字面量」不约束它们）。`tpl-settings-appearance.ts`（外观 tab）、`tpl-settings-path.ts`（环境 tab）、`tpl-settings-preview3d.ts`（3D 预览 tab）。设置页整体契约（tab 结构、卡片正典 stgCard/stgCards/stgUnits、值域 schema、i18n 键域）见 [app-content-settings](./app-content-settings.md) 与 [app-content](./app-content.md)。

## 核心职责

- `tpl-settings-appearance.ts` — 外观 tab：语言选择（option 由 `SUPPORTED_LANGS` 派生，label = 语言内生名，自名不经 `t()`）、主题色点卡（`THEME_ICON` / `THEME_LABEL_KEY` / `THEME_SWATCH_VARS`：色点以 data-var 声明 `--bg/--accent/--bd` 三主题变量，真实色由 `theme.ts|initThemeSection` 的 document 探针逐主题回填 inline——设置页在 Shadow DOM 内，document 层 `.theme-x` 规则解析不到，var() 回落宿主继承值会导致六卡同色）、主题自动模式（`THEME_AUTO_VALID` 派生 + `THEME_AUTO_LABEL` Record）、字体三卡（字号/创作者名字体/密度，option 由 `settings-schema.ts` 的 FONT_SIZE_LEVELS / DISPLAY_FONTS / DENSITY_LEVELS 派生 + 各面 Record 文案表，加档位改 schema 一处即编译期逼同步）、动画开关、启动默认页卡（option 由 `navItems()` 派生）
- `tpl-settings-path.ts` — 环境 tab：`PATH_CARD_PLATFORMS` 平台能力矩阵（mc-path = 桌面 + 安卓 viewer 真授权入口；links / mirror = 纯桌面概念；storage = 三平台）+ `resolveSettingsPlatform` / `cardSupportedOn`（渲染与测试共用的平台判定）、基础路径三卡 spec 表驱动（`BASIC_PATH_CARD_SPECS`：mcPathCardSpec / linksCardSpec / mirrorCardSpec——加一张卡 = 写一个 spec 函数 + 表加一项 + 平台矩阵加一行，Record 键联合编译期强制平台声明；storage 不参与本表，grid 下方独立全宽）、镜像源卡 body（`MIRROR_SOURCES.map` 派生 option + `mirror-hint-<语义值>` 说明块，id 与 `init.ts|applyMirrorHints` 约定同源）、存储卡（桌面+安卓常规卡 / webViewer FSA 卡 `stg-web-repo-card` + `web-repo-auth-btn`）
- `tpl-settings-preview3d.ts` — 3D 预览 tab：相机速度 / 旋转模式 / 键位映射三张正典卡（值域/默认/枚举全部消费 `preview-3d/infra/settings-schema.ts` 的 TD_CAM_SPEED / TD_ROT_MODE——ADR-303 单一源，`ROT_MODE_LABEL` Record 锁文案键域），解析折叠区（FBX / MMD worker 两个开关，2026-10 自独立「解析」tab 降级并入，原生 `<details>` 保留 summary 入口 + 键盘行为；worker checkbox 经 `aria-labelledby` 同时说明格式/动作、`aria-describedby` 关联 hint），折叠区内部行组错峰入场编排（STG_GROUP_STEP_MS / STG_BAND / `groupDelay`——只被本分片消费，留在主文件会让分片反向 import 造成运行时环，故随分片迁出）

## 对外 API / 入口

- 导出渲染函数（均 `(startMs, [cardStep]) => string`，编排参数由主文件 stgUnits 注入）：`renderStgLangSelect` / `renderStgThemePicker` / `renderStgThemeAuto` / `renderStgFontFamily` / `renderStgAnimationSection` / `renderStgDefaultPageSection` / `renderStgBasicPaths` / `renderStgStorageCard` / `renderStgPreview3d` / `renderStgParserWorkers`
- 导出的平台事实：`resolveSettingsPlatform`（isViewer/isWebViewer 两层判断 → 三态 SettingsPlatform）、`cardSupportedOn`、`BASIC_PATH_CARD_SPECS`
- 测试钩子与控制 id 全保留：td-camspeed / td-rotmode / td-keymap-grid / td-keymap-reset、stg-* 卡 id、set-mc-path / set-mc-detect / set-link-mode / set-relink / set-mirror / set-font-size / set-display-font / set-card-density / set-animations / set-default-page / set-remember-page 等（事件消费方 `settings/init.ts`，见 [app-content-settings](./app-content-settings.md)）

## 与其他子系统关系

- 上游（主文件）：`tpl-settings.ts` 的 `settingsHTML` 做 tab 装配 + `stg-card.ts|stgUnits` 做入场编排（[app-content](./app-content.md)）；三分片对主文件仅 type-only import（`SettingsPlatform` / `SettingsTabId`，编译期擦除、无运行时环）
- 值域单一源：`settings-schema.ts`（字号/字体/密度/镜像/链接模式，[app-content-settings](./app-content-settings.md)）+ `preview-3d/infra/settings-schema.ts`（ADR-303 3D 持久化偏好，[preview-settings](./preview-settings.md)）；值→文案映射归各面 Record 表与 `ui-maps.ts` 的 MIRROR_UI / LINK_MODE_UI（模板与 init 双消费面共用，[app-content-settings](./app-content-settings.md)）
- 主题色点卡真实色回填依赖 `theme.ts|initThemeSection` document 探针（[app-content-settings](./app-content-settings.md) 主题域）
- webViewer FSA 卡（`web-repo-auth-btn` / `web-repo-auth-status`）接线 `web-fs-auth.ts` 的授权三态（[backend-idb](./backend-idb.md) / [backend-web](./backend-web.md)）；isViewer 与 isWebViewer 两层判定口径（游戏根/链接卡 vs FSA 卡）见 [android-bridge](./android-bridge.md)

## 不变量

- 卡片正典：分片出卡一律经 `stgCard()` / `stgCards()` 构造器（hdr/body/cardId/入场延迟单点供给），禁手写 `<div class="stg-card">` 与裸样式仿卡（设置页裸样式仿卡债已清零，`tpl.test.ts` 回归锁定）
- 值域枚举只消费 schema：option 行全部由 schema 枚举 `.map` 派生（存在性 + 顺序 + selected 默认项随 schema），禁模板手写裸 option 列——「schema 有、下拉框静默没有」的半截接线事故即此（加镜像源时下拉框缺席且无报错）
- 入场步长单源：startMs/cardStep 由 stgUnits 注入，分片内禁硬编码 step（「单元表声明 + 内部步长」双源曾致改步长一处不跟、details 起始撞车）
- 平台能力事实单源：`PATH_CARD_PLATFORMS` + `cardSupportedOn` 是唯一声明处——mc-path 网页版不渲染（指向 /web 虚拟根，与 webRepo FSA 卡语义重叠），links/mirror 查看器无意义
- 3D 预览三卡值域/默认/枚举只消费 ADR-303 schema（`td-cam-speed` / `td-rot-mode` 键 + 值域 + 步进 + 默认唯一声明处），文案键域归本分片 Record 表；键位项专属 `.stg-keybind-row`（透明底 + 边框）避免卡中卡双层背景
- 镜像 hint 块排版统一 `.stg-hint-block`（content-stg.ts 只管排版不带显隐，display 由 `init.ts|applyHintVisibility` 按实值切），勿再内联复制 font-size/color/padding 配方

## 相关

- [app-content-settings](./app-content-settings.md) — 设置页基础设施（init / stg-card / settings-schema / ui-maps / theme / path-cards）
- [app-content](./app-content.md) — 主内容页与 `tpl-settings.ts` 主文件的 tab 装配（stgUnits 表驱动）
- [preview-settings](./preview-settings.md) — ADR-303 3D 持久化偏好 schema 单一源（相机/旋转/键位的值域源头）
- [android-bridge](./android-bridge.md) — isViewer / isWebViewer 两层平台判定与 FSA 卡渲染口径
- [backend-idb](./backend-idb.md) — 网页版 FSA 根句柄持久化与 web 文件系统
