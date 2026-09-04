// ===== 可编辑目标判定（收编自 dnd-shared / input-and-animation 双轨）=====
// 单一事实来源：拖拽导入守卫（drop 落在表单控件上不触发导入）与 3D 键盘守卫
// （焦点在输入控件不吞键）共用同一判定，消除「同名近义不同实现」的双轨漂移。
// 统一取两轨并集：INPUT/TEXTAREA/SELECT 均属可编辑/可选择控件；
// contenteditable 走严格 ===true（与 input-and-animation 原口径一致，防 truthy
// 误判非标准属性值）。

/** 事件目标是否为可编辑 / 可选择控件（输入框打字、下拉选择、contenteditable 编辑
 *  不应被外层行为吞掉——如 drop 导入 / 3D 键位）。参数为 EventTarget 即可，
 *  KeyboardEvent / DragEvent 等事件对象天然兼容（取 .target）。 */
export function isEditableTarget(el: EventTarget | null | undefined): boolean {
  if (!el) return false;
  const t = el as HTMLElement | null;
  if (!t || typeof t.tagName !== "string") return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable === true;
}
