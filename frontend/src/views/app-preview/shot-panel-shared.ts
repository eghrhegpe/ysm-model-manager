// ===== shot-panel-shared.ts — MMD/YSM 截图面板共享逻辑（[doc:adr-126-p4-b-2]）=====
// P4-B-2 收敛：MMD 截图面板（P4-B-1 已声明式化）与 YSM 截图面板同构（6 角度按钮 + 截图副作用），
// 共享 SHOT_KEYS / SHOT_LABELS / makeShotAction / shotButtonNodes，杜绝两处复制。
// 背景：ADR-052 P3 截图能力（screenshotFromRenderer 共享 renderer）——
//   - MMD：screenshotFn 是适配器注入的独立能力（null = 无截图能力 → 面板不注入）
//   - YSM：screenshot 是 ctx 可选字段（undefined = 走 renderMultiAngle fallback，面板常驻）
// 本共享层兼容两者：screenshotFn 允许 null | undefined，saveScreenshot 第四参语义一致。

import { bus } from "../../bus.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import { saveScreenshot } from "./skeleton-render.ts";
import type { PreviewMenuNode } from "../../preview-3d/menu/node-types.ts";

/** 截图六角度键（current/front/45/side/back45/all）——fillXxxShotPanel 与 shotButtonNodes 共用，防两处漂移。
 *  仅本模块内消费（knip：导出但无外部 import = 死导出，勿再 export） */
const SHOT_KEYS = ["current", "front", "45", "side", "back45", "all"] as const;

/** 截图六角度 i18n 键（与 SHOT_KEYS 同序） */
const SHOT_LABELS = [
  "preview.screenshotCurrent",
  "preview.screenshotFront",
  "preview.screenshot45",
  "preview.screenshotSide",
  "preview.screenshotBack45",
  "preview.screenshotAll",
] as const;

/** saveScreenshot 的 model 入参（MMD 假对象 / YSM 完整 model 都兼容） */
type ShotModel = Parameters<typeof saveScreenshot>[0];

/** 截图保存副作用：防连点 guard + toast 错误提示。fillXxxShotPanel（命令式）与 shotButtonNodes（声明式）共用 */
function makeShotAction(
  modelForSave: ShotModel,
  screenshotFn: (() => Promise<string | null>) | null | undefined,
): (key: string) => Promise<void> {
  let saving = false;
  return async (key: string): Promise<void> => {
    if (saving) return;
    saving = true;
    try {
      // 第四参传 screenshotFn（活跃渲染器截图）；第三参 setShotState 传空回调——
      // 原 fillMmdShotPanel 误把 screenshotFn 传第三参（被当 setShotState 调），
      // 导致实际截图走 renderMultiAngle fallback 而非活跃渲染器；此处顺手修正。
      await saveScreenshot(modelForSave, key, () => {}, screenshotFn ?? undefined);
    } catch (e) {
      console.error("[3D 截图]", e);
      bus.emit("toast:show", {
        msg: "截图保存失败：" + friendlyError(e),
        duration: TOAST_MS.verbose,
        type: "error",
      });
    } finally {
      saving = false;
    }
  };
}

/**
 * 截图面板声明式节点（6 button）：screenshotFn 为 null 时返回空数组（MMD 能力缺失不渲染）；
 * undefined（YSM ctx 可选字段）时仍返回 6 按钮（走 saveScreenshot fallback）。
 * [doc:adr-126-p4-b-1/2] 面板内容声明式化——纯数据节点，渲染走 renderMenu。
 */
export function shotButtonNodes(
  modelForSave: ShotModel,
  screenshotFn: (() => Promise<string | null>) | null | undefined,
): PreviewMenuNode[] {
  if (screenshotFn === null) return [];
  const saveShot = makeShotAction(modelForSave, screenshotFn);
  return SHOT_KEYS.map((key, i) => ({
    id: `shot-${key}`,
    kind: "button" as const,
    labelKey: SHOT_LABELS[i],
    fallback: key,
    icon: "📷",
    legacyTestId: `shot-${key}`,
    action: (): void => {
      void saveShot(key);
    },
  }));
}
