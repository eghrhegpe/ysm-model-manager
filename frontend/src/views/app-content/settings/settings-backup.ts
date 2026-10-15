// ===== 设置导出/导入 逻辑层（ADR-344-d1）=====
// 前端只负责「采集 / 回写浏览器偏好」；磁盘轨（appConfig）的合并、版本门控迁移与导入前备份
// 由 Go 侧 `ImportSettingsFromFile` 在 configWriteMu 内完成。
//
// 单一事实源：`frontend/src/settings-keys.ts` 台账。绝不手写第二份键名清单——手抄必漂移，
// 新键漏登记即漏备份（契约测试只锁「键集合与归属」，不锁读写语义，见 tests/test_settings_key_ledger.ts）。
//
// 病根：`b1116645c` 只写了备份迁移文档、代码从未实现导出/导入；用户按文档复制
// `ysm_config.json` 后，字号/键位/3D 偏好/收藏创作者几十项留在旧机浏览器存储里，全程零提示。

import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { isStorageAccessible, safeGet, safeSet } from "@/utils/base/primitives/storage.ts";
import { toast } from "@/utils/dom/toast.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import { nonMigratingSettingsKeys, type SettingsKeyEntry } from "../../../settings-keys.ts";
import { toastError, withBusy } from "./store.ts";

/**
 * 该台账键是否随导出带走：
 * - `go-disk` 不在列——随 appConfig 走，Go 侧已收拢；
 * - `session` / `non-persistent`（缓存、哨兵、运行期派生）不备份——重启即重算，无用户意图可丢；
 * - `dual-write`（如 theme 的 localStorage 镜像）不在列——其事实源在磁盘 appConfig 里，
 *   镜像属缓存，备份它反而制造「两处不一致」的副本。
 */
function isExportable(entry: SettingsKeyEntry): boolean {
  return entry.tier === "local-storage" && entry.authority === "browser-authority";
}

/** 采集当前 localStorage 中随导出带走的偏好（键以台账为准，值缺失/存储不可用跳过） */
export function collectExportableLocalStorage(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isStorageAccessible()) return out;
  for (const entry of nonMigratingSettingsKeys()) {
    if (!isExportable(entry)) continue;
    const v = safeGet(entry.key);
    if (v === null) continue;
    out[entry.key] = v;
  }
  return out;
}

/**
 * 把导入文件的浏览器偏好写回 localStorage。
 * 写入白名单 = 台账中可导出键的集合——导出文件里未知的键（未来版本新增、或被人手工塞进
 * JSON 的键）一律忽略，这是「导入只应用本机认识的东西」的底线。返回实际写入条数。
 */
export function applyImportedLocalStorage(
  map: Record<string, string | undefined> | null | undefined,
): number {
  if (!map || !isStorageAccessible()) return 0;
  let applied = 0;
  for (const entry of nonMigratingSettingsKeys()) {
    if (!isExportable(entry)) continue;
    const v = map[entry.key];
    if (typeof v !== "string") continue;
    safeSet(entry.key, v);
    applied += 1;
  }
  return applied;
}

/** 绑定设置页「备份与迁移」卡片（导出 / 导入按钮 + 状态行）。
 *  与 initUiPrefs 同款接线位：initSettings 内调用一次，按钮经 withBusy 防连点。 */
export function initSettingsBackup(root: ShadowRoot): void {
  const statusEl = root.getElementById("set-backup-status");
  const setStatus = (html: string): void => {
    if (statusEl) statusEl.innerHTML = html;
  };

  const exportBtn = root.getElementById("set-backup-export") as HTMLButtonElement | null;
  exportBtn?.addEventListener("click", () => {
    void withBusy(async () => {
      try {
        const { ExportSettingsJSON } = await backendGetApp();
        const path = await ExportSettingsJSON(JSON.stringify(collectExportableLocalStorage()));
        // 状态行显示路径 + 复制按钮（复制属浏览器能力，Go 侧无绑定可依）
        setStatus(
          `<span style="word-break:break-all">${t("settings.backup.exportedTo", { path })}</span>
 <button type="button" class="btn-base sm" id="set-backup-copy" style="margin-top:6px;font-size:var(--fs-tiny);padding:var(--btn-padding-tool-lg)">${t("settings.backup.copyPath")}</button>`,
        );
        root.getElementById("set-backup-copy")?.addEventListener("click", () => {
          void navigator.clipboard?.writeText(path).then(
            () => toast(t("settings.backup.copied"), TOAST_MS.success, "success"),
            () => toast(t("settings.backup.copyFailed"), TOAST_MS.normal, "error"),
          );
        });
        toast(t("settings.backup.exportDone"), TOAST_MS.success, "success");
      } catch (e) {
        toastError(e);
      }
    });
  });

  const importBtn = root.getElementById("set-backup-import") as HTMLButtonElement | null;
  importBtn?.addEventListener("click", () => {
    void withBusy(async () => {
      try {
        const { SelectImportFile, ReadSettingsExport, ImportSettingsFromFile } =
          await backendGetApp();
        const path = await SelectImportFile(".json", t("settings.backup.importPickerTitle"));
        if (!path) return; // 用户取消
        const exp = await ReadSettingsExport(path); // 先只读校验（格式/版本），失败即抛、零副作用
        if (!exp) return; // 防御：read 成功但回空（Go 侧不应发生）
        // 浏览器偏好先写 localStorage（Go 无能力写浏览器侧键值）
        const applied = applyImportedLocalStorage(exp.localStorage);
        const res = await ImportSettingsFromFile(path);
        const n = res?.appliedKeyCount ?? applied;
        setStatus(t("settings.backup.importedTo", { n, backup: res?.backupPath ?? "" }));
        toast(t("settings.backup.importDone", { n }), TOAST_MS.long, "success");
        // 全量重建当前面板（清缓存 + 重渲染，同 lang:changed 机制）：主题/语言/路径可能已变，
        // 只刷 store 会留下 UI 与真相分叉
        bus.emit("settings:imported");
      } catch (e) {
        toastError(e);
      }
    });
  });
}
