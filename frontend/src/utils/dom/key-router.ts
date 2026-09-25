// ===== key-router.ts — 全局快捷键注册表（combo 键语义单点出口，ADR-308 D1）=====
//
// 背景：全仓 document 级 keydown 散点 10 处（devtools/树面板/3D/浮层/键位捕获…），
// 互斥靠临时约定（isPreviewOverlayActive 让路、输入阻断栈）维持，无注册表、无碰撞检测、
// 无 aria-keyshortcuts 自动声明。本模块把「全局组合键」收编为注册表：
//   - 单一 document keydown 分发点（首个 shortcut 挂上，末个摘除，防跨用例/HMR 叠加注册）
//   - 组合匹配纯函数（修饰键掩码 + 主键，大小写不敏感）
//   - 注册期同组合碰撞响亮告警（约定 → 检测）
//   - listShortcuts() 供快捷键帮助页/aria-keyshortcuts 自动声明消费
//
// 边界：本注册表只管 **combo 组合键**（一次按键事件即完成语义）。键状态类输入
// （WASD 长按/双轨键，preview-3d input-and-animation 的 keydown+keyup）与一次性捕获
// （设置页键位改绑 capture）语义不同，不进本注册表。

import { logWarn } from "@/utils/base/primitives/log.ts";

/** 组合键写法：修饰键 + 主键，以 "+" 连接。修饰键序不限；大小写不敏感。
 *  修饰词：Ctrl / Shift / Alt / Meta（Win、OS 为 Meta 别名）。主键 = KeyboardEvent.key（Delete/F12/ArrowDown…）。 */
export type ShortcutCombo = string;

/** 注册契约：全局组合键 = 组合 + 门禁（可选）+ 处理器 */
export interface ShortcutSpec {
  /** 唯一 id（注册期碰撞告警与帮助页展示用） */
  id: string;
  /** 组合键；数组 = 任一命中即触发（如 ["Delete","Del"] 双写兼容） */
  combo: ShortcutCombo | ShortcutCombo[];
  /** 门禁（默认 true）：3D 全屏让路 / 焦点在输入框外 等上下文判定。
   *  保持零应用层依赖——门禁逻辑由调用方注入（如 () => !isPreviewOverlayActive()）。 */
  when?: (e: KeyboardEvent) => boolean;
  /** 命中处理（组合匹配且 when 放行时按注册顺序调用；preventDefault 由 handler 自行决定） */
  handler: (e: KeyboardEvent) => void;
}

const MOD_ALIASES: Record<string, "ctrl" | "shift" | "alt" | "meta"> = {
  ctrl: "ctrl",
  control: "ctrl",
  shift: "shift",
  alt: "alt",
  meta: "meta",
  win: "meta",
  os: "meta",
};

/** 组合键是否命中当前按键事件（纯函数，供测试/门禁/帮助页复用）。 */
export function comboMatches(combo: ShortcutCombo, e: KeyboardEvent): boolean {
  const tokens = combo
    .split("+")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  // 裸键 = 唯一 token 且非修饰键（此时等价于「无修饰键 + 主键」）
  if (tokens.length === 1) {
    if (MOD_ALIASES[tokens[0]]) return false; // 只写修饰键无主键 → 恒失配
    // 裸键 = 无任何修饰键（Ctrl+Delete 不算 "Delete"）
    if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return false;
    return e.key.toLowerCase() === tokens[0];
  }
  const keyToken = tokens[tokens.length - 1];
  if (MOD_ALIASES[keyToken]) return false; // 末 token 仍是修饰键（如 "Ctrl+Shift"）→ 无主键
  const want = { ctrl: false, shift: false, alt: false, meta: false };
  for (let i = 0; i < tokens.length - 1; i++) {
    const mod = MOD_ALIASES[tokens[i]];
    if (!mod) return false; // 未知修饰词 → 失配（响亮不静默）
    want[mod] = true;
  }
  if (
    e.ctrlKey !== want.ctrl ||
    e.shiftKey !== want.shift ||
    e.altKey !== want.alt ||
    e.metaKey !== want.meta
  )
    return false;
  return e.key.toLowerCase() === keyToken;
}

function specCombos(spec: Pick<ShortcutSpec, "combo">): ShortcutCombo[] {
  return Array.isArray(spec.combo) ? spec.combo : [spec.combo];
}

/** 纯函数：registry 中与 candidate 共享任一组合的既有 id（自身 id 不算；修饰键不同不算碰撞）。 */
export function findCollisions(
  candidate: Pick<ShortcutSpec, "id" | "combo">,
  registry: readonly Pick<ShortcutSpec, "id" | "combo">[],
): string[] {
  const mine = new Set(specCombos(candidate));
  return registry
    .filter((s) => s.id !== candidate.id && specCombos(s).some((c) => mine.has(c)))
    .map((s) => s.id);
}

// ── 注册表 + 单点分发 ─────────────────────────────────────

const registry: ShortcutSpec[] = [];
let listenerAttached = false;

function dispatch(e: KeyboardEvent): void {
  const hits = registry.filter(
    (s) => specCombos(s).some((c) => comboMatches(c, e)) && (s.when?.(e) ?? true),
  );
  if (hits.length > 1) {
    // 运行期并发命中 = when 未做互斥的碰撞，响亮告警（注册期同组合已有告警，此处兜底 when 交集）
    const combo = specCombos(hits[0]).join("/");
    logWarn(
      "key-router",
      `同键并发：${hits.map((h) => h.id).join(", ")}（组合 ${combo}）——请把互斥逻辑收进 when 门禁`,
    );
  }
  for (const h of hits) h.handler(e);
}

function ensureListener(): void {
  if (listenerAttached || typeof document === "undefined") return;
  document.addEventListener("keydown", dispatch);
  listenerAttached = true;
}

function detachListener(): void {
  if (!listenerAttached) return;
  document.removeEventListener("keydown", dispatch);
  listenerAttached = false;
}

/** 注册一个全局组合键，返回 dispose（须随组件 disconnectedCallback / 会话结束调用）。 */
export function registerShortcut(spec: ShortcutSpec): () => void {
  const collisions = findCollisions(spec, registry);
  if (collisions.length) {
    logWarn(
      "key-router",
      `快捷键注册碰撞：${collisions.join(", ")} 已占用「${specCombos(spec).join(" / ")}」，${spec.id} 将并发触发`,
    );
  }
  registry.push(spec);
  ensureListener();
  let disposed = false;
  return (): void => {
    if (disposed) return;
    disposed = true;
    const i = registry.indexOf(spec);
    if (i !== -1) registry.splice(i, 1);
    if (!registry.length) detachListener();
  };
}

/** 当前全部已注册组合键（快照拷贝，供快捷键帮助页 / aria-keyshortcuts 自动声明消费）。 */
export function listShortcuts(): readonly ShortcutSpec[] {
  return registry.slice();
}

/** 组合键 → aria-keyshortcuts 标准写法（空格分隔，如 "Ctrl+F F12"）；帮助页与声明源共用。 */
export function formatAriaKeyShortcuts(specs: readonly Pick<ShortcutSpec, "combo">[]): string {
  return specs
    .flatMap((s) => specCombos(s))
    .map((c) => c.toUpperCase().replace(/^(WIN|OS)(\+)/, "META$2"))
    .join(" ");
}

/** 测试钩子：清空注册表并摘除 document 监听（vi.resetModules 跨代际卫生）。 */
export function __resetShortcutsForTest(): void {
  registry.length = 0;
  detachListener();
}
