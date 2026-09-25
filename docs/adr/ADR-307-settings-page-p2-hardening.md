# ADR-307：设置页 P2 硬化：tab 样式去重 / viewer 区块缺席告知 / 非 3D 设置项 schema 化

- **状态**：✅ 已采纳（Adopted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-25
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-300 §2.5（viewer 告知）/ ADR-303（settings-schema）/ ADR-189 D4（css 分层）/ docs/knowledge/app_content_settings.md / frontend/src/views/app-content/css/{content-stg.ts,content-repo.ts} / frontend/src/views/app-content/settings/{tpl-settings.ts,init.ts} / frontend/src/views/app-content/tabs-shell.ts`

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

2026-09-25 设置页菜单锐评（美观/易懂/可扩展性）收尾 P0+P1 后，余下三处 P2 病灶——它们彼此独立、但同属「设置页硬化」主题，故单开本 ADR 一次性裁定，本次不实施。三处当前态（均已源码实证）：

**B1 — tab 按钮样式两份逐字段复制**：`.stg-tab`（`content-stg.ts:174`）与 `.repo-tab`（`content-repo.ts:11`）是 18 个属性逐字段相同的两份，仅动画 keyframe 名不同——`.stg-tab` 用本地定义的 `stgTabIn`（`:177`），`.repo-tab` 用全局 `fadeSlideDown`。差异根因：设置页整体渲染在 **ShadowRoot**，全局 keyframe 不穿 shadow 边界，故 settings 必须本地定义 keyframe；仓库页为 light DOM，全局 keyframe 直接生效。`stgTabIn` 与 `fadeSlideDown` 语义完全相同（opacity 0→1 + translateY(-6px)→0）。改一处漏一处是迟早的事（已有两个同步点：keyframe 名 + 18 属性块）。

**B2 — viewer 缺席「沉默消失」未闭环到设置页**：`renderTabs`（`tabs-shell.ts:86`）已原生支持 tab 级 `desktopOnly?`（`TabSpec:35`）+ 调用级 `viewerMode?`/`viewerNotice?`（`TabsShellSpec:59/65`），并在确有 desktopOnly tab 被隐藏时产出 `.repo-tabs-notice` 告知行（ADR-300 §2.5「从沉默消失变可见缺席」）。但 `settingsHTML`（`tpl-settings.ts:505`）虽已算 `isViewer = isViewerMode()`（`:506`）/`isWebViewer`（`:507`），却**没把 `viewerMode`/`viewerNotice` 传给 `renderTabs`**。后果：Android viewer 下「环境」tab 的路径三卡 / 存储卡（`renderStgBasicPaths`/`renderStgStorageCard`）直接返回空串（`:140-142` 类分支），用户看到半页空白、**没有任何一行说明「你这个平台没有路径/存储配置」**。更深的缺口：`desktopOnly` 只有 **tab 粒度**——「环境」tab 不能整体打 desktopOnly（里面语言/启动默认页是通用的），真正缺席的是 tab 内的**若干 section**，现有机制无 section 级门控。

**B3 — 非 3D 设置项无 schema 护栏**：3D 域设置已吃 `settings-schema`（ADR-303）——`TD_CAM_SPEED`/`TD_ROT_MODE` 提供值域/默认值/枚举，`ROT_MODE_LABEL: Record<TdRotMode, LocaleKey>` 让新增旋转模式编译期逼出文案。非 3D 项（下载镜像源 / 字体族 / UI 密度 / 更新检查间隔）仍是裸字面量散落：模板 + `init.ts` 绑定 + 三语 locale 四处改，且**无兜底**。`MIRROR_I18N_KEY: Record<string, LocaleKey>`（`init.ts:39`）键类型是松 `string` 而非联合——加一个镜像源漏写文案键只在运行时 `?? "settings.mirror.nameDirect"`（`:65`）兜底，**编译期不报错**。这才是扩展性的真瓶颈：加一个设置项要动四份文件且全程无类型守门。

## 2. 决策（Decision）

**D1 — tab 按钮样式抽共享基类（去重，保 shadow keyframe）**：
- 抽 `.tab-btn` 基类承载 18 个共有属性，落点复用既有共享 CSS 出口 `@/utils/dom/css.ts`（`metaTagCSS` 同级，呼应 `content-repo.ts:45`「通用样式归 utils/dom/css.ts」）；`.stg-tab`/`.repo-tab` 降为 `.tab-btn` + 自身差异（仅 `animation` 指向的 keyframe）。
- keyframe 统一名 `tabIn`；**两份各自定义一份**（settings 在 ShadowRoot 内本地定义、repo 在全局定义）——不可只留全局一份，否则设置页 shadow 内动画静默失效（B1 根因）。`stgTabIn`/`fadeSlideDown` 退役。
- 须跑 `css-layer-check`（ADR-189 D4 分层门禁）确认共享模块不越层；抽取后 `extractClasses` 死 CSS 信号以新类名为准。

**D2 — viewer 缺席告知下探到 section 级**：
- `settingsHTML` 把 `viewerMode`/`viewerNotice` 接给 `renderTabs`（对齐 repo 页 ADR-300 §2.5 已落地形态），消除「算了 isViewer 却不用」的半截接线。
- 引入 **section 级缺席**机制：路径/存储段在 `isViewer` 时不返回空串，改调共享 `renderAbsentSection(noticeKey)` 产出一行 muted 占位（文案如「此平台无路径/存储配置」），落位与 ADR-300 告知行同哲学（可见缺席，非沉默消失）。
- 粒度扩展：`desktopOnly` 维持 tab 级（留给未来整 tab 才通用的场景），新增 section 级 `viewerAbsent` 标记供各渲染函数本地判定——**输入端（哪些 section 在 viewer 下无意义）由 Go/调用方声明，展示端（空串 vs 占位告知）由前端消费**，不回退到「前端按平台手搓空判断」。

> ⚠️ **查实修正（2026-09-25，实施前源码复查，推翻上款假设）**：上款「路径/存储段在 viewer 下无意义 → absent 占位」**不成立**。复查 `directory-picker.ts:18-66` + `path-cards.ts:67-95 bindPathClick` 证实：安卓 viewer 下 `set-files-root`（存储卡）与 `set-mc-path`（路径卡）点击均走 `pickDirectory()` → `resolveAndroidRepoDir()`——**未授权弹 warn toast + `bridge.requestStoragePermission()` 跳系统「所有文件访问」授权页，授权后 `GetDefaultRepoRoot` 自动定位 `/storage/emulated/0/YSM-Model-Manager`**（ADR-046 P2 已落地，Java 桥而非 Go 侧权限请求）。即 **storage 卡与 mc-path 卡是 viewer 下的真授权入口，不是缺席 section，严禁 absent 占位**。真正该 absent 的只有 `links`/`mirror` 卡（链接模式 / 下载镜像源是桌面 / 网络概念，安卓无意义）。原「路径 / 存储段整体 absent」裁定作废，落地以本注脚为准：**storage 卡（set-files-root）与 mc-path 卡保留（授权定位入口）；`links`/`mirror` 卡 absent**；`renderStgBasicPaths` 当前 `if(!isViewer) return ""` 整体消失是**过度隐藏**（埋了同样可用的 mc-path 卡），须拆 `isViewer` 守卫到卡片粒度，而非整体回空串。

> 📌 **落地形态（2026-09-25，继 a04597a97）**：`renderStgBasicPaths` / `renderStgStorageCard` 的平台守卫已收口为 `PATH_CARD_PLATFORMS: Record<cardId, SettingsPlatform[]>` 单一声明源（tpl-settings.ts），渲染函数一律 `cardSupportedOn(id, resolveSettingsPlatform(isViewer, isWebPlatform()))` 消费——同语义不再由两函数各手搓 flag（消除 storage 用 isWebViewer / mc-path 用 isViewer 的漂移温床）。D3 将把该表并入 settings-schema 作为平台字段。

**D3 — 非 3D 设置项收编进 settings-schema（ADR-303 同款护栏）**：
- 扩展 `settings-schema` 覆盖非 3D 域：`MirrorSource`（jsdelivr/githubapi/direct 联合）、`FontFamily`、`UiDensity`、`UpdateCheckInterval`（6/12/24/'off' 联合）等，值域/默认值/枚举同源声明。
- `MIRROR_I18N_KEY` 键收紧为 `Record<MirrorSource, LocaleKey>`——`string`→联合后，加镜像源漏文案即编译期红；其余非 3D 项的「值↔文案键」映射照搬 `Record<TdRotMode, LocaleKey>` 形态。
- 加一个设置项 = 在 schema 加一项 + 补一处 locale 键，绑定/文案缺失由类型系统拦下；`init.ts` 的 `?? 兜底` 收缩为「仅真未知值兜底」，不再掩盖漏键。

**D 间次序**：D1（纯样式，零视觉风险，可随时做）→ D2（UX 缺口，小到中）→ D3（架构改动最大，建议最后做、可拆子 PR）。三者互不阻塞。

## 3. 后果（Consequences）

- **正面**：D1 消除两份同步漂移点（keyframe 名 + 18 属性），改 tab 外观只动一处；D2 把 ADR-300「可见缺席」原则收口到设置页，viewer 用户不再面对半页空白无说明；D3 把设置项扩展从「四文件裸改无兜底」升为「schema 一处声明 + 编译护栏」，加项成本与出错率同降。
- **负面 / 代价**：D1 抽基类要过 `css-layer-check`，且 shadow/全局双 keyframe 不能省——误合成单份全局 keyframe 会让设置页动画失效（回归 B1 根因）；D3 是存量迁移（镜像源/字体/密度/更新间隔四处裸字面量回填进 schema），churn 不小，须配契约测试防回退。
- **已知遗留**：D2 的 `renderAbsentSection` 文案需三语；D3 落地后 `MIRROR_I18N_KEY` 旧 `string` 消费点（`:65` 的 `??`）要同步收紧；本 ADR 不解决 P2 之外的事（如密度/字体是否真值得进 schema，按实际扩展频率定）。

## 4. 数据溯源

- B1 实证：`frontend/src/views/app-content/css/content-stg.ts:172-177`（`.stg-tab` + 本地 `stgTabIn`，注释明示 shadow 不穿全局 keyframe）、`content-repo.ts:11-13`（`.repo-tab` + 全局 `fadeSlideDown`）；两处 18 属性逐字段 diff 一致，仅 keyframe 名异。
- B2 实证：`frontend/src/views/app-content/tabs-shell.ts:35/59/65/86`（`desktopOnly`/`viewerMode`/`viewerNotice` + `renderTabs`）；`frontend/src/views/app-content/settings/tpl-settings.ts:505-507`（`settingsHTML` 算 isViewer 未接 `renderTabs`）、`:140-142` 类 viewer 分支返回空串；`.repo-tabs-notice` 机制见 `content-repo.ts:14-16`（ADR-300 §2.5 D3）。
- B3 实证：`frontend/src/views/app-content/settings/init.ts:39-43`（`MIRROR_I18N_KEY: Record<string, LocaleKey>`）、`:65`（`?? "settings.mirror.nameDirect"` 运行时兜底）；对照护栏 `frontend/src/views/app-content/settings/tpl-settings.ts:428-431`（`ROT_MODE_LABEL: Record<TdRotMode, LocaleKey>`）+ `settings-schema`（ADR-303）。
- 锐评来源：2026-09-25 设置页菜单锐评（美观易懂与可扩展性）P2 三条，收尾 P0+P1（commit `2f7b400ba`）后单开本 ADR。

<!-- 文件名: settings-page-p2-hardening.md → 实际文件 ADR-307-settings-page-p2-hardening.md -->

<!-- 文件名: settings-page-p2-hardening.md → 实际文件 ADR-307-settings-page-p2-hardening.md -->
