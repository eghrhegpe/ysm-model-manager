/**
 * index.ts — icon-kit 入口（多源图标中介层）。
 *
 * 用法：
 *   import { ICON_KIT, renderIcon } from "@/utils/icon/icon-kit/index.ts";
 *   `${renderIcon(ICON_KIT.enableAll)} ${t("tree.batchEnableAll")}`
 */
export { ICON_KIT, type IconKitName, iconKitNames } from "./icons.ts";
export { renderIcon } from "./render.ts";
export type { IconSource, IconSpec } from "./types.ts";
