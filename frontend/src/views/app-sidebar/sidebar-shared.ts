// ===== app-sidebar 同步层共享原语 =====
// sync-flow.ts 拆分（锐评 P1-2）：push / pull 两侧共用的类型与按钮复位逻辑。
// 单独成文件是为了避免 push / pull 双向引用同一份 resetButton（放任一侧都会让另一侧
// 依赖不该依赖的编排文件）。

import { t } from "@/core/i18n/t.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";

/** 同步动作方向 */
export type SyncVerb = "push" | "pull";

/** 按钮复位（push/pull finally 块共用）。▾ 指示符由 dropdownBaseCSS 的
 *  `.dd-wrap > button::after` 单源生成（ADR-238），此处不再手拼——手拼会双箭头 */
export function resetButton(btn: HTMLButtonElement, verb: SyncVerb): void {
  const iconSvg = verb === "push" ? UI_ICONS.upload : UI_ICONS.download;
  const key = verb === "push" ? "sidebar.pushSelected" : "sidebar.pullSelected";
  btn.innerHTML = `${iconSvg} ${t(key)}`;
  btn.disabled = false;
}
