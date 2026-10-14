// ===== 工坊编辑态焦点恢复（锐评 Perf #3，2026-10-14）=====
// 病：preset 编辑区的「上移/下移/删除」按钮各自触发整站重渲（reRender →
// renderSiteView → searchResults.innerHTML = html），按钮 DOM 被销毁重建——
// 键盘用户连按两次方向键（或鼠标连点排序）时，第二次按键落在 body 上，
// 必须重新用鼠标找回位置。
// 修法：重渲前后记录/恢复焦点。锚点用 **preset 的稳定身份**（presetSearches[].q
// 搜索词，同站内一般唯一）而非 data-idx 位置索引——上移/下移会让索引漂移
// （点第 3 项「上移」→ 它变成第 2 项 → data-idx 从 2 变 1），按索引恢复会跳错行。
// 只认编辑区三类按钮（cr-order-up / cr-order-down / cr-del-preset），其他焦点
// （搜索框、输入框）本就不随重渲消失，由各自的 blur/change 链处理，不越界抢。

/** 可恢复焦点的编辑区按钮类（顺序即查询优先级，稳定无关） */
const EDIT_BTN_CLASSES = ["cr-order-up", "cr-order-down", "cr-del-preset"] as const;

export interface EditFocusAnchor {
  /** 触发按钮的类名（cr-order-up 等） */
  cls: string;
  /** preset 稳定身份（搜索词 `ps.q || ps.label`） */
  q: string;
  /**
   * 同一 q 内的出现序号（锐评修复，2026-10-14）。
   * ⚠️ 为什么必需：多个 preset **共享同一 q 是常见配置**（bowroll 站实测「热门日系模型」
   * 与「日系模型」可同为 q=MMD，见知识卡 app-content-site）——单靠 q 身份不唯一，
   * 按 q 恢复焦点会跳到错误行。`(q, occ)` 在重排/增删下都是该 preset 的不变量
   *（除非重排两个 q 完全相同的 preset，那二者本就在语义上不可区分）。
   */
  occ: string;
}

/** 取当前焦点所在行按钮的锚点（非编辑区按钮/无焦点 → null） */
export function captureEditFocus(root: ParentNode | null): EditFocusAnchor | null {
  if (!root) return null;
  const active = (root as HTMLElement).ownerDocument?.activeElement ?? null;
  if (!active || !(active instanceof HTMLElement)) return null;
  const cls = EDIT_BTN_CLASSES.find((c) => active.classList.contains(c));
  if (!cls) return null;
  // 按钮挂在对应 preset 卡片上；身份取卡上的 data-preset-q + data-preset-occ
  const card = active.closest("[data-preset-q]");
  const q = card?.getAttribute("data-preset-q") ?? "";
  const occ = card?.getAttribute("data-preset-occ") ?? "0";
  return { cls, q, occ };
}

/**
 * 重渲后把焦点恢复到同一 preset 的同类按钮。
 * @param root 站点视图容器（searchResults）
 * @param anchor captureEditFocus 的返回值；null 时无操作
 * @returns 是否成功恢复（未找到对应按钮时 false，调用方可据此决定是否降级提示）
 */
export function restoreEditFocus(root: ParentNode | null, anchor: EditFocusAnchor | null): boolean {
  if (!root || !anchor) return false;
  // 同身份（q + 出现序号）+ 同操作类的按钮即为原焦点目标
  const sel =
    `[data-preset-q="${cssEscape(anchor.q)}"]` +
    `[data-preset-occ="${cssEscape(anchor.occ)}"] .${anchor.cls}`;
  const hit = root.querySelector<HTMLElement>(sel);
  if (!hit) return false;
  hit.focus({ preventScroll: true });
  return true;
}

/** CSS.escape 兜底：happy-dom/旧 WebView 可能未实现 */
function cssEscape(s: string): string {
  const g = globalThis as { CSS?: { escape?: (v: string) => string } };
  if (typeof g.CSS?.escape === "function") return g.CSS.escape(s);
  return s.replace(/["\\]/g, "\\$&");
}
