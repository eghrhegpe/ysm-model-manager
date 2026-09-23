---
kind: survey_emoji_icons
name: emoji/UI_ICONS 摸排方法论
tier: leaf
category: ui
status: active
source_files:
  - scripts/_lib/survey-emoji-icons.ts
  - scripts/_lib/design-tokens.ts
  - scripts/_lib/icon-map.ts
use_when:
  - emoji 残留摸排
  - UI_ICONS 消费分布
  - 孤儿图标盘点
  - 图标迁移审计
auto_fields:
  symbols_with_lines:
    - allIconNames
    - checkLayoutDocDrift
    - COMBINING_MARKS
    - COMBO_EXPANSION
    - COMBO_PADDING_TOKENS
    - DesignViolation
    - DesignViolationKind
    - DocDrift
    - EMOJI_TO_ICON
    - findEmojiIconViolations
    - findLocaleEmojiPrefixViolations
    - findStyleAttrViolations
    - findToastEmojiPrefixViolations
    - findToastEmojiPrefixWindowViolations
    - findViolationsOnLines
    - FixEdit
    - fixLineTokens
    - GLYPH_CLUSTER
    - glyphOfIconName
    - GRAPHIC_EMOJI
    - hasCustomEasing
    - hasGraphicEmoji
    - isCommentLine
    - isNeutralColor
    - isRealtimeFeedbackTransition
    - nearestPadToken
    - normalizeShadowValue
    - PAD_TOKEN_VERTICAL
    - parseTokenMap
    - propDeclRe
    - propValueRe
    - REALTIME_FEEDBACK_MAX_SECS
    - REALTIME_FEEDBACK_PROPS
    - SHADOW_TOKEN_VALUES
    - SP_FLOOR_PX
    - SP_TOKEN_VERTICAL
    - splitTopLevelCommas
    - STATUS_ICON_NAMES
    - suggestIconName
    - suggestPaddingToken
    - suggestShadowToken
    - suggestToken
    - suggestTransitionToken
    - suggestTransitionTokenExact
    - TOKEN_PX_BASELINE
    - TokenPxMap
    - TokenRawMap
    - TR_EXEMPT_MARKER
    - TRANSITION_TOKEN_DURATIONS
    - TRANSITION_TOKEN_VALUES
quick_groups:
  - emoji 摸排 / UI_ICONS 消费 / 孤儿图标 / 迁移残留
quick_intents:
  - emoji
  - UI_ICONS
  - 图标迁移
  - 摸排
  - 残留扫描
quick_risk_lines:
  - 别再几十次零散 grep emoji —— 一封 `node scripts/_lib/survey-emoji-icons.ts` 出全貌
pitfalls:
  - 零散 grep 每枚 emoji/每个 UI_ICONS 模式各发一次 → token 浪费（实测上一会话 28 分钟 / 5.6M tok 都在翻 emoji）：改用一次性脚本
  - "`check-design-tokens --kind emoji-icon` 只认「HTML 标签图标位 + 字面量 emoji」，扫不到运行时 toast 载荷 / locale 值前缀 emoji；要全量需用 survey 脚本或 findToastEmojiPrefixViolations / findLocaleEmojiPrefixViolations"
  - emoji 字符集必须含 U+2190-21FF / U+2300-23FF（含 ⏳/← 等），否则单字形槽整类逃逸 —— survey 脚本已**复用 design-tokens.ts 导出的 GRAPHIC_EMOJI**，不自抄副本（单一事实源，门禁改字符集 survey 自动跟随）
invariant_anchors:
  - scripts/_lib/design-tokens.ts|GRAPHIC_EMOJI
  - scripts/_lib/icon-map.ts|EMOJI_TO_ICON
---

# emoji/UI_ICONS 摸排方法论

## 概览

ADR-238 把 emoji 当 UI 图标迁移成 SVG（`UI_ICONS` + `.ws-icon`）。摸排「还有哪些 emoji 残留 / 哪些图标没被用」时，**不要**几十次零散 grep——仓库已有现成工具，一次运行出全貌。

## 核心职责

- 一次性产出 4 类报表：① emoji 字面量按文件/按字形分布；② HTML 图标位残留（ADR-238 未迁移点）；③ 映射表收录但零消费的「孤儿图标」；④ locale 文案值前缀型状态符号 emoji。
- 静态分析**复用门禁** `scripts/_lib/design-tokens.ts` 的判定与字符集（`findEmojiIconViolations` / `findLocaleEmojiPrefixViolations` / `GRAPHIC_EMOJI`），与 `check-design-tokens` 完全同源，不自抄正则副本。

## 对外 API / 入口

- 运行：`node scripts/_lib/survey-emoji-icons.ts`（零依赖，直接 node 跑，不要包 `npx` / `node scripts/` 双层）
- 权威门禁口径（HTML 图标位残留）：`node scripts/check-design-tokens.ts --kind emoji-icon`（接 pre-commit 行级判定，存量债不拦）
- 语义映射事实源：`scripts/_lib/icon-map.ts` 的 `EMOJI_TO_ICON`（字形→语义名，供脚本给每枚 emoji 附建议 `UI_ICONS.x`）

## 与其他子系统关系

- `frontend/src/utils/icon/ui-icons.ts`：`UI_ICONS` 实现 + `UiIconName` 字面量联合（拼错编译报错，ADR-248 D1）
- `tests/test_ui_icons.ts`：`ui-icons.ts` 实现 ↔ `icon-map.ts` 映射 双向对拍，防漂移
- `frontend/src/utils/icon/icon.ts`：`fileIcon` 走 emoji，属**数据图标**（资源类型图标，前端只读不判，保持 emoji 不动——红线）

## 不变量

- 全仓 emoji 字面量 ≈ 994（2026-09 盘点）：非图标类字形（`⭐/☆/🖱️/⇔` 等装饰/箭头/星标）与 UI 图标迁移无关，勿误改。
- HTML 图标位残留 emoji 经 `check-design-tokens` 仅 2 处（rename.ts / tpl-batch-rename.ts），已是存量债。
- 映射语义名共 120，已消费 96，孤儿 24（`restricted/verticalDots/inbox/globe/motion/controls/fog/camera/play/visibility/shadow/mirror/sky/enableAll/disableAll/money/key/sun/sakura/mint/ocean/bulletAlt/radioOn/radioOff`）：多为 3D 菜单坞站/能力行/批量动作位，迁移时预定但当前未接 UI，属「备而不用」，非 bug。

## diagnostics 三个扫描按钮状态机（上一会话重点翻的）

- 冲突扫描 `conflicts.ts`：`dgCfSetScanBtnState(scanBtn, scanning, esc)` 统一管态——扫描中 `classList.add("scanning")` + `textContent = t("diagnostics.scanningDot")`；结束 `innerHTML` 重建 `UI_ICONS.performance + esc(t("diagnostics.startScan"))`（因 textContent 覆写会抹掉 SVG）。并发守卫模块级 `diagScanning` / `diagSyncBusy`，`busy` 命中直接 return，`try/finally` 复位。
- 仓库体检 `health.ts`：`_healthBusy` 守卫，扫描中 `statRowHTML(..., {icon: UI_ICONS.refresh})`（SVG 转圈，不覆写 textContent），`try/finally` 复位。
- 范式：纯并发守卫用模块级 busy 即可（ADR 注释明确「改造会话工厂 ROI 低，不立项」）——**不要**为此引入状态机框架。

## 相关

- [utils-icon](./utils-icon.md) — fileIcon 走 emoji（数据图标，不迁移）
- `scripts/check-design-tokens.ts` / `docs/UI-Design.md` — emoji 图标禁用规范
