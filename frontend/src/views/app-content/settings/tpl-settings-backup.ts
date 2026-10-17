// ===== 设置页「备份与迁移」卡片模板（ADR-344-d1）=====
// 只出 HTML；按钮绑定在 settings-backup.ts|initSettingsBackup（模板层不 import 绑定层）。
// 卡片放「环境」tab 末位：备份/迁移是低频动作，不参与首屏槽位竞争（stgUnits 排在其前）。

import { t } from "@/core/i18n/t.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { stgCard } from "./stg-card.ts";

/** 备份与迁移卡片（桌面端）。网页版 localStorage/IDB 属浏览器沙盒，导出/导入语义不同，
 *  不在本卡内提供（后续 ADR 单独立项）。 */
export function renderStgBackupSection(startMs: number): string {
  return stgCard(
    UI_ICONS.save,
    t("settings.backup.title"),
    `<div class="stg-card-desc">${t("settings.backup.desc")}</div>
     <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
       <button type="button" class="btn-base sm" id="set-backup-export" style="font-size:var(--fs-sm);padding:var(--btn-padding-filter-lg)">${UI_ICONS.download} ${t("settings.backup.exportBtn")}</button>
       <button type="button" class="btn-base sm" id="set-backup-import" style="font-size:var(--fs-sm);padding:var(--btn-padding-filter-lg)">${UI_ICONS.upload} ${t("settings.backup.importBtn")}</button>
       <button type="button" class="btn-base sm" id="set-backup-restore" style="font-size:var(--fs-sm);padding:var(--btn-padding-filter-lg)">${UI_ICONS.undo} ${t("settings.backup.restoreBtn")}</button>
       <button type="button" class="btn-base sm" id="set-backup-open" style="font-size:var(--fs-sm);padding:var(--btn-padding-filter-lg)">${UI_ICONS.folder} ${t("settings.backup.openDirBtn")}</button>
     </div>
     <div id="set-backup-status" style="font-size:var(--fs-xs);color:var(--muted);margin-top:8px;line-height:1.5"></div>`,
    {
      header: { spaceBetween: false, titleSize: "base" },
      cardId: "stg-backup-card",
      marginTop: 8,
      delayMs: startMs,
    },
  );
}
