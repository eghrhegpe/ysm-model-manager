// ===== 配置守卫：读 mcRoot + 空守卫 + toast（去重 D-1，2026-08-05）=====
// 抽自 5 处重复的「const cfg = await LoadAppConfig(); mcRoot = cfg.mcRoot || "";
//   if (!mcRoot) { toast(...) }」模板。

import { getApp } from "../../backend/app.ts";
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import { toast } from "../feedback.ts";
import { t } from "../i18n/t.ts";

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
    toast(t("ctx.pushNoMcRoot"), TOAST_MS.normal, "warn");
    return null;
  }
  return mcRoot;
}
