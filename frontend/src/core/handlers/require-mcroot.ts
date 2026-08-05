// ===== 配置守卫：读 mcRoot + 空守卫 + toast（去重 D-1，2026-08-05）=====
// 抽自 5 处重复的「const cfg = await LoadAppConfig(); mcRoot = cfg.mcRoot || "";
//   if (!mcRoot) { bus.emit("toast:show", {...}) }」模板。
import { bus } from "../../bus.ts";
import { getApp } from "../../wails/app.ts";

/**
 * 读取游戏根目录（mcRoot），空时发 warn toast 并返回 null。
 * 调用方：`const mcRoot = await requireMcRoot(); if (!mcRoot) return;`
 * @returns mcRoot 字符串；未配置时返回 null（已 toast 提示）
 */
export async function requireMcRoot(): Promise<string | null> {
  const { LoadAppConfig } = await getApp();
  const cfg = await LoadAppConfig();
  const mcRoot = cfg.mcRoot || "";
  if (!mcRoot) {
    bus.emit("toast:show", {
      msg: "请先配置游戏目录",
      duration: 3000,
      type: "warn",
    });
    return null;
  }
  return mcRoot;
}
