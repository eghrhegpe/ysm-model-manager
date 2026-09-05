// ===== 配置守卫：读 mcRoot + 空守卫 + toast（去重 D-1，2026-08-05）=====
// 抽自 5 处重复的「const cfg = await LoadAppConfig(); mcRoot = cfg.mcRoot || "";
//   if (!mcRoot) { toast(...) }」模板。
// 迁移史：core/handlers/require-mcroot.ts → features/require-mcroot.ts（ADR-188
// ——features 内共享原语，pack-ops/sync 双消费；守卫自带 toast 属交互反馈，
// 非纯内核语义）。

import { t } from "../core/i18n/t.ts";
import { toast } from "../utils/dom/toast.ts";
import { TOAST_MS } from "../utils/dom/toast-ms.ts";
import { backendGetApp } from "./backend-deps.ts";

/**
 * 读取游戏根目录（mcRoot），空时发 warn toast 并返回 null。
 * 调用方：`const mcRoot = await requireMcRoot(); if (!mcRoot) return;`
 * @returns mcRoot 字符串；未配置时返回 null（已 toast 提示）
 */
export async function requireMcRoot(): Promise<string | null> {
  const { LoadAppConfig } = await backendGetApp();
  const cfg = await LoadAppConfig();
  const mcRoot = cfg.mcRoot || "";
  if (!mcRoot) {
    toast(t("ctx.pushNoMcRoot"), TOAST_MS.normal, "warn");
    return null;
  }
  return mcRoot;
}
