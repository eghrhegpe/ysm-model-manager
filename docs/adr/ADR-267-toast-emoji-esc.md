# ADR-267：toast 消息载荷 emoji→类型驱动语义图标，去 esc 文本槽盲区

- **状态**：✅ 已采纳
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-18
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：[ADR-238](ADR-238-ui.md)、`frontend/src/views/app-toast/index.ts`、`frontend/src/utils/icon/ui-icons.ts`

---

## 1. 背景（Context）

ADR-238（emoji→SVG 收债）已把**结构图标位**（titleIcon / 工具栏 / 菜单 icon / modal okIcon / statsBadge）全部清理；`check-design-tokens` 已报「emoji 当图标 = 0」。

但 **toast 消息载荷（msg）里的 emoji 是结构性盲区债**，此前量不到也不拦：

- 渲染层 [toast/index.ts](file:///c:/Users/zhujieling11/ysm-model-manager/frontend/src/views/app-toast/index.ts#L129) 走 `<span class="msg">${esc(msg)}</span>`，msg 经 `esc()` 转义 → **塞 SVG 会以字面 `<svg>` 文本显示**，无法直接承载图标。
- `check-design-tokens` 的 `findEmojiIconViolations` 只认「HTML 图标位（class=/<tag/data-testid）+ 字面量 emoji」；toast msg 里的 emoji 经变量/插值传给 `esc()`，源码无字面量 → 量不到也不拦。
- 规模：内联 11 处直接前缀（`sync.ts:110`、`import/executor.ts`、`dnd/pack-dnd.ts`、`utils/dom/toast.ts:26` 等），另有一批经 locale 源注入（`tree.indexGenerated` ✅、`tree.tagQueryFail` ❌、`tree.webStatsDegraded` ⚠️、`tree.filterFound` 🔍 等）。
- 此外 toast 就有 **`↩` undo 按钮图标**（真按钮图标，属结构槽）。

**`type` 冗余**：`.toast` 已按 type 语义着色（`error` 红 / `success` 绿 / `warn` 橙 / `info` 蓝 左边框），`msg` 载荷里的 ✅/❌/⚠️ 与 type 视觉重复——属于**信息冗余**而非必需。

**前例已走通**：copy-toast（ADR-238 C5）已提交「去 ✅/❌ 前缀 + 视觉改由 toast type 驱动」的同类清理，本 ADR 是同一纪律在 toast 渲染层的全面推广。

## 2. 决策（Decision）

1. **渲染层加类型驱动图标位**：`<app-toast>` 渲染时按 `type`（info/success/error/warn）前置一枚语义 SVG 图标（经 `resolveIcon` 产出内部常量），替代 `.toast` 纯色左边框的裸状态表达；msg 文本槽仍走 `esc()`（不改变 XSS 语义，仅图标位新增独立 SVG 通道）。
2. **msg 载荷一律去 emoji 前缀**：内联字面量与管理器 helper（`toastError` 等）里 `✅ / ❌ / ⚠️ / 🔍 / ⏳ / 📁 / 🗑️` 等前缀移除；状态语义交给 type（视觉）+ 语义图标（渲染层）承载。
3. **undo 按钮 `↩` → `UI_ICONS.undo`**（icon-map 已登记 `↩→undo`，复用现有映射）。
4. **跨界/保留**：locale 源经 `translate()` 产出的 msg 里若仍嵌 emoji，随各语言 key 清理；**纯文本语句内非前缀 emoji（如内文语气符）不强制**，只清「前缀型状态符号」。
5. **门禁补盲**：为 `check-design-tokens` 增加「toast:show 载荷 + locale 值中的前缀型 emoji」检测（或等效正向守卫），防止本 ADR 清完后再引入——根治「量不到也不拦」。

**不做**（超范围）：不改 toast 的 `esc()` XSS 语义；不把全量 msg 文本承载换成 innerHTML SVG（保持只读文本槽）。

## 3. 后果（Consequences）

**正面**：
- toast 载荷不再有 emoji 文字符，视觉统一由 type→SVG 图标 + 左边框承担，与全站 SVG 图标语言一致。
- 消除「esc 转义导致 SVG 无法承载」的结构盲区，`check-design-tokens` 彻底归零。
- 文案里不再混入平台相关字符（emoji），跨平台渲染一致。

**负面**：
- 需同步更新若干 toast 相关 vitest / e2e 断言（原断言内联 emoji 或按文案 filter 的用例）。
- 门禁增加一项检测规则，需维护 icon-map 映射（前缀型 emoji→语义名）避免误报。

**已知遗留**：
- 非前缀、嵌句中的表情符号不属于本 ADR，另议。
- undo 图标等结构槽数量少，随本 ADR 一并收敛，不单独立项。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `check-design-tokens` 全量扫描 | 结构图标位 emoji 已归零；toast msg 盲区缺失 |
| `frontend/src/views/app-toast/index.ts:129` | `<span class="msg">${esc(msg)}</span>` —— msg 不可承载 SVG |
| `frontend/src/utils/icon/icon-map.ts` | ✅→success、❌→error、⚠️→warning、🔍→search、🗑️→delete、↩→undo、📁→folder、⏳→refresh 映射齐备 |
| `shared: sync/import/dnd/utils-dom-toast` | 内联 11 处前缀型 emoji 消费点 |
| locale 三语 | `tree` 域 + 其他域多条前缀型 emoji，随 key 清理 |

<!-- 文件名: toast-emoji-esc.md → 实际文件 ADR-267-toast-emoji-esc.md -->