# ADR-279：设置页下拉图标死代码处置与自定义下拉迁移

- **状态**：✅ 已采纳（D1 本批落地；D2 方向已定、实施另批）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-20
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/views/app-content/settings/tpl-settings.ts` / `tpl-settings-about.ts` / `frontend/src/views/app-tree/tpl-batch-rename.ts`（病灶模板）；`frontend/src/utils/dom/css.ts`（`.dd-wrap/.dd-menu/.dd-item` 共享基础样式）；`frontend/src/preview-3d/menu/panels/env.ts`（`<option>` 纯文本内容模型的实证注释先例）；ADR-208 D2（模板外移 views）、ADR-190 D1a（HTML 归 views）

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->
全仓约 18 处 `<option>${UI_ICONS.x} ${t(...)}</option>` 分布在设置页两个 tpl、批量重命名弹窗 tpl 与默认页动态 option（图标经 MenuNode schema 透传）。原生 `<option>` 的内容模型只允许文本，SVG 拼进去恒显示为字面标记（env.ts 早有实证注释）——即这些图标**从未渲染成功过**，属于死代码。用户不知情下直觉「改造 SVG 时丢了图标」，实际是规范层面不可能渲染。

若要真显示图标，唯一路径是把控件换成自渲染 DOM 的自定义下拉。探测结论（决策时快照）：
- 设置页共 10 个 `<select class="stg-select">`，其中 6 个带图标死代码；弹窗层另有 `#br-mode` 1 个。
- 消费端契约高度统一：init.ts / theme.ts / ui-prefs.ts / default-page.ts / keymap.ts / batch-rename-form.ts 全部只用 `.value` 读写 + `addEventListener("change")`，无任何地方操作 `options` 集合或读 `textContent`。
- 因此存在低成本迁移形态：自定义下拉 UI + 隐藏 `<select>` 作 value store（影子 select），业务逻辑零改动。

## 2. 决策（Decision）

**D1（本批执行）**：清除全部 18 处 `<option>` 内 `${UI_ICONS.*}` / `${resolveIcon(...)}` 拼接，只留文本。零视觉回归（本来就没渲染出来），一次消灭死代码。

**D2（立案缓行，另批实施）**：若未来需要下拉选项带图标，按以下契约做，不直接重写各页交互：
1. 新建通用组件 `stg-select`（暂名）放 `utils/dom/`（DOM 原语归口，不进 `src/core`），外观复用 `utils/dom/css.ts` 既有 `.dd-wrap/.dd-menu/.dd-item` 基础样式，触发按钮 + 自渲染面板承载 SVG 图标。
2. **影子 select 模式**：组件内部保留隐藏 `<select>` 作为唯一 value store；用户点选项 → 写 `hiddenSelect.value` 并派发冒泡 `change`；外部 `sel.value = x` 赋值由组件监听同步回显示文本。上表 6 个业务模块的 `.value`/change 契约一行不改，存量测试可继续打隐藏 select。
3. 无障碍底线：键盘导航（↑↓ 选择、Enter 确认、Esc 关闭、焦点环对齐 `.stg-select:focus`）必须持平原生 select，否则不迁。
4. 迁移范围拍板：**全量同迁**（含无图标的 `set-lang`/`theme-auto`/`td-rotmode` 等），避免同页混排两种下拉观感割裂；`#br-mode` 弹窗下拉可后置。
5. 收益预期管理：真正可见增益仅 6 个控件的图标首次出现 + 默认页下拉恢复 MenuNode icon 语义；若 D1 已清掉图标，则 B 方案动机退化为「想要带图标的下拉」这一纯视觉诉求，实施前需产品再确认。

## 3. 后果（Consequences）

**正面**：18 处死代码清零，模板字符串变短、i18n 拼接不再夹带无效 SVG；后来者不再被「图标去哪了」困惑；D2 契约把「重写 3 页交互」的大改动预估压成「一个组件 + 换模板壳」的中改动。
**负面**：D1 后若有人翻 git 历史看到曾经有 `${UI_ICONS...}`，可能误以为功能退化——本 ADR 即防此困惑的锚点。
**已知遗留**：自定义下拉组件未实施（D2 缓行）；实施时需补组件单测与 init.test.ts 等 fixture 的适配评估。

## 4. 数据溯源

- 病灶清单来源：`grep '<option[^>]*>\$\{UI_ICONS'` 当前源码树实测 18 处（tpl-settings.ts ×15、tpl-settings-about.ts ×1、tpl-batch-rename.ts ×2）+ 默认页动态 option 1 处（`resolveIcon(it.icon)`）。
- `<option>` 纯文本约束实证：`frontend/src/preview-3d/menu/panels/env.ts:76-80` 注释（renderCapSelect 用 `textContent` 落位）。
- 消费端契约来源：逐文件 grep `.value` / `addEventListener("change")`（init.ts:91-282、theme.ts:100-116、ui-prefs.ts:107-155、default-page.ts:35-64、keymap.ts:158-161、batch-rename-form.ts:207-220）。

<!-- 文件名: select-icon-migration.md → 实际文件 ADR-279-select-icon-migration.md -->
