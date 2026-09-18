/**
 * icon-map.ts — UI 图标语义映射层（scripts/_lib，ADR-238 D4）。
 *
 * 是什么：**字形 → 语义名** 的映射表 + 查询函数。它是 ADR-238 D2「语义命名」的
 * 事实源，同时供：
 *   ① check-design-tokens 扫描器把「⚠️」这类命中项转成「建议 UI_ICONS.warning」；
 *   ② 契约测试校验 `frontend/src/utils/icon/ui-icons.ts` 实现了全部映射（防表与实现漂移）。
 *
 * 为什么需要独立于 ui-icons.ts：
 *   `ui-icons.ts` 在 frontend（含 `@/` 别名与浏览器侧依赖），scripts 侧 import 会踩
 *   别名/环境问题；且映射表要能被**测试与扫描器**共享。故语义名与「该名存在」的事实
 *   放 scripts/_lib（零依赖），SVG 路径实现放 frontend——两者靠契约测试对拍，
 *   同 `TOKEN_PX_BASELINE` ↔ `variables.css` 的对账范式。
 *
 * 命名原则（ADR-238 D2，最易犯错处）：
 *   **语义名，非外观名、非字形名**。`warning` 而非 `triangle`/`emoji-warning`。
 *   外观名把「实现」写进「调用点」——将来 ⚠️ 换成圆形感叹号，语义名调用方零改动。
 *
 * 依赖：零依赖（纯数据 + 纯函数）。
 */

/** 语义名 → 代表该语义的高频字形（用于扫描建议与文档生成）。
 *
 * 只收**有明确语义**且值得进图标集的字形；长尾装饰性 emoji（🦴🎤🙏 等）不收——
 * 它们更适合留在文案里或按需单独补，硬塞进表会让「建议」变成瞎猜。
 */
export const EMOJI_TO_ICON: Readonly<Record<string, string>> = {
  // ── 状态语义（UI 最高频，且最需要主题化：成功绿/失败红/警告黄）──
  "⚠️": "warning",
  "❌": "error",
  "✅": "success",
  "🚫": "blocked",
  "🛑": "stop",
  ℹ️: "info",
  "💡": "hint",
  "🔞": "restricted",
  // 日志状态收债（2026-09-18）：💀=致命错误、⏭️=跳过。⏭️ 曾被误记成 performance（闪电，
  // 语义串味——「跳过」与「性能」毫无关系，是历史手滑），此处纠正为 skip。
  "💀": "fatal",
  "⏭️": "skip",

  // ── 操作语义 ──
  "🔍": "search",
  "🔄": "refresh",
  "🗑️": "delete",
  "💾": "save",
  "⬇️": "download",
  "⬇": "download",
  "⬆️": "upload",
  "⬆": "upload",
  "📤": "upload",
  "📥": "import",
  "↩️": "undo",
  "↩": "undo",
  "✂️": "cut",
  "📎": "attach",
  "🖌️": "brush",
  "🧹": "clean",
  "🛠️": "tools",
  "⚙️": "settings",
  "🔀": "shuffle",
  "✕": "close",
  "☰": "menu",
  "☐": "checkbox",
  "🧭": "navigate",

  // ── 内容/分类语义 ──
  "📁": "folder",
  "📂": "folderOpen",
  "📦": "package",
  "📄": "file",
  "📋": "clipboard",
  "📝": "note",
  "📜": "script",
  "📊": "chart",
  "📏": "ruler",
  "📐": "geometry",
  "📖": "book",
  "📅": "calendar",
  "🗓️": "calendar",
  "🕐": "clock",
  "🏷️": "tag",
  "🔗": "link",
  "📌": "pin",
  "🖼️": "image",
  "🖼": "image",
  "🎬": "video",
  "🎥": "video",
  "📺": "media",
  "📭": "inboxEmpty",
  "📮": "inbox",
  "🗒️": "note",

  // ── 实体/领域语义 ──
  "🎮": "game",
  "🕹️": "joystick",
  "🧸": "model",
  // 3D 菜单坞站「角色」组用 🧍（2026-09 迁移补：与 🧸 同指 model 语义）
  "🧍": "model",
  "🦴": "bone",
  "🧱": "voxel",
  "🧊": "unknown",
  "💎": "gem",
  "🥽": "vrHeadset",
  "⚔️": "violent",
  "🎭": "character",
  "🎨": "appearance",
  "🧩": "parser",
  "🏗️": "build",
  "🐙": "github",
  "🌐": "web",
  "🌍": "globe",
  // 3D 菜单坞站「动作」组（2026-09 迁移补）
  "💃": "motion",
  "🎛️": "controls",
  "🌫️": "fog",
  // 3D 菜单表其余结构槽图标（2026-09 迁移补）
  "📷": "camera",
  "📸": "camera",
  "▶️": "play",
  "▶": "play",
  "👁️": "visibility",
  "👁": "visibility",
  "❓": "unknown",
  "❔": "unknown",
  // 左导航「资源库」项（2026-09 迁移补）
  "📚": "book",
  // 能力行图标（2026-09 迁移补；cap 用 `readonly icon = "…"` 声明，见 caps/*-capability.ts）
  "🌑": "shadow",
  "🪟": "mirror",
  "🌤️": "sky",
  // 批量操作动作（2026-09 自 icon-kit 并入 UI_ICONS）：两枚是**纯 SVG 设计、无字形来源**，
  // 此处取最贴近的字形仅为满足「映射表 ↔ 实现双向对拍」并给扫描器一个建议入口
  //（☑️ 全勾 ≈ 全部启用；⛔ 禁止 ≈ 全部禁用）。已刻意避开 ✅/🚫——那两枚在表里已归
  // success/error 的「状态」语义，不宜再指向「动作」语义，否则建议会串味。
  "☑️": "enableAll",
  "⛔": "disableAll",
  // 「槽内容就是一个字形」→ 语义名（2026-09 收口；字形此前直接写进 textContent）
  "➕": "add",
  "←": "back",
  "🏠": "home",
  "🏆": "rank",
  "👤": "user",
  "👥": "users",
  "💳": "payment",
  "💰": "money",
  "🩺": "diagnose",
  "💬": "comment",
  "📛": "label",
  "🔒": "lock",
  "🔐": "lockClosed",
  "🔑": "key",
  "⚡": "performance",
  "🔺": "collision",
  "🎯": "target",
  "🎲": "random",
  "🌙": "moon",
  "☀️": "sun",
  "🌸": "sakura",
  "🍃": "mint",
  "🌊": "ocean",
  "⚪": "dot",
  "🔹": "bullet",
  "🔸": "bulletAlt",
  // radio 焦点钮：●/○ 是「实心饼 + 圆角矩形边框」的字形拼凑（旧实现），
  // 语义名收编后建议用 ◉（环+圆心）/ ○（空环）两态字形兜底识别
  "◉": "radioOn",
  "○": "radioOff",
  "✨": "sparkle",
  "👴": "oldest",
  "👈": "pointerLeft",
  "↗": "external",
  "🎤": "voice",
  "✒️": "author",
  "🙏": "thanks",
  "😊": "avatar",
  "😀": "avatar",
  "♻️": "recycle",
  "🖥️": "window",
  "💻": "window",
  "✏️": "edit",
  "🖊️": "edit",
  "↑": "chevronUp",
  "↓": "chevronDown",
  "⏰": "clock",
  "🕒": "clock",
  "⏳": "refresh",
} as const;

/**
 * 字形 → 建议的语义名（未收录返回 null）。
 *
 * 返回 null 是**刻意的**：宁可不给建议，也不猜错语义（同 `suggestToken` 对
 * 「值不精确相等就不建议」的克制）。调用方应把 null 呈现为「需人工命名」。
 */
export function suggestIconName(glyph: string): string | null {
  return EMOJI_TO_ICON[glyph] ?? null;
}

/** 全部语义名（去重、稳定排序）——供契约测试与文档生成消费。 */
export function allIconNames(): string[] {
  return [...new Set(Object.values(EMOJI_TO_ICON))].sort();
}

/** 该语义名在映射表中的代表字形（反向查询，文档用）。无则 null。 */
export function glyphOfIconName(name: string): string | null {
  for (const [glyph, n] of Object.entries(EMOJI_TO_ICON)) {
    if (n === name) return glyph;
  }
  return null;
}
