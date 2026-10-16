// ===== 设置导出/导入 逻辑层（ADR-344-d1）=====
// 前端只负责「采集 / 回写浏览器偏好」；磁盘轨（appConfig）由 Go 侧 `ImportSettingsFromFile`
// 在 configWriteMu 内**整份覆盖**（非逐字段合并：以导出配置为基，走同一套版本门控迁移 + 洗脏），
// 落盘前先备份当前 ysm_config.json，后悔可还原备份文件。
//
// 单一事实源：`frontend/src/settings-keys.ts` 台账。绝不手写第二份键名清单——手抄必漂移，
// 新键漏登记即漏备份（契约测试只锁「键集合与归属」，不锁读写语义，见 tests/test_settings_key_ledger.ts）。
//
// 病根：`b1116645c` 只写了备份迁移文档、代码从未实现导出/导入；用户按文档复制
// `ysm_config.json` 后，字号/键位/3D 偏好/收藏创作者几十项留在旧机浏览器存储里，全程零提示。

import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { exportableSettingsKeys, type SettingsKeyEntry } from "@/settings-keys";
import {
  isStorageAccessible,
  safeGet,
  safeKeys,
  safeRemove,
  safeSet,
} from "@/utils/base/primitives/storage.ts";
import { toast } from "@/utils/dom/toast.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import { toastError, withBusy } from "./store.ts";

/**
 * 该台账键是否随导出带走：判定已收进台账查询口 `exportableSettingsKeys()`
 * （tier=local-storage && authority=browser-authority，见 settings-keys.ts 该函数注释——
 * 排除 go-disk 随 appConfig 走、session/non-persistent 无用户意图、dual-write 镜像备份
 * 反而制造两处不一致）。此处不再复写一遍判定：两处各写一遍必漂移。
 */

/** 一个通配串（`*` 代表任意子串，至多一个）是否匹配某个候选键 */
function matchesPattern(pattern: string, key: string): boolean {
  const star = pattern.indexOf("*");
  if (star === -1) return key === pattern;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  return (
    key.startsWith(prefix) && key.length >= prefix.length + suffix.length && key.endsWith(suffix)
  );
}

/**
 * 一条台账登记 → 该登记对应的真实键集合。
 * - 无 `keyPattern`：就是 `entry.key` 本身（若候选集里没有则返回空）；
 * - 有 `keyPattern`：按通配在候选集里展开真键——**占位符只是登记名，不是真键**，
 *   `safeGet("ysm-scene-cap-*")` 恒 null，把占位符当真键读等于整族不迁移。
 * 候选集必须是「真实存在的键」，不是前缀猜：键名拼接规则一变，猜出来的集合立刻错。
 */
function entryKeysFromCandidates(entry: SettingsKeyEntry, candidates: string[]): string[] {
  const pattern = entry.keyPattern ?? entry.key;
  return candidates.filter((k) => matchesPattern(pattern, k));
}

/** 采集当前 localStorage 中随导出带走的偏好（键以台账为准，值缺失/存储不可用跳过） */
export function collectExportableLocalStorage(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isStorageAccessible()) return out;
  const allKeys = safeKeys();
  for (const entry of exportableSettingsKeys()) {
    for (const key of entryKeysFromCandidates(entry, allKeys)) {
      const v = safeGet(key);
      if (v === null) continue;
      out[key] = v;
    }
  }
  return out;
}

/**
 * 导入文件的浏览器偏好里、会被本机应用写入的键集合（按台账白名单 + keyPattern 展开过滤）。
 * 与 `applyImportedLocalStorage` 共用同一份判定，保证「写入键」与「回滚键」口径一致——
 * 两处各写一遍手抄判定，将来必漂移。
 */
export function importedKeysFrom(
  map: Record<string, string | undefined> | null | undefined,
): string[] {
  if (!map) return [];
  const candidates = Object.keys(map);
  const out: string[] = [];
  for (const entry of exportableSettingsKeys()) {
    for (const key of entryKeysFromCandidates(entry, candidates)) {
      if (typeof map[key] === "string") out.push(key);
    }
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
  for (const key of importedKeysFrom(map)) {
    // 只认真正落盘的：safeSet 在隐私模式/配额满时返回 false（仍记 warn），
    // 计入总数会让「已应用 N 项」虚高——分叉状态下唯一的用户线索就废了
    if (safeSet(key, map[key] as string)) applied += 1;
  }
  return applied;
}

/**
 * 导入前给浏览器偏好拍照（只拍会被导入覆盖的可导出键）。
 * 导入是「磁盘 + 浏览器」两轨的跨进程动作：磁盘侧写盘/备份/侧效任一失败都会抛错，
 * 而 Go 侧只备份 ysm_config.json，**浏览器侧没有备份**——若不回滚，失败的导入会让
 * 用户浏览器偏好被覆盖且无法撤销（比「两轨不一致」更糟：磁盘仍是旧值、浏览器已是新值）。
 */
function snapshotExportableLocalStorage(): Record<string, string> {
  return collectExportableLocalStorage();
}

/** 磁盘侧导入失败时把浏览器偏好还原到导入前（导入前不存在的键删除，存在的键原值写回）。
 *  `touched` = 本次即将写入的键（`importedKeysFrom` 的产物），只回滚这些，不动其它键。 */
function restoreExportableLocalStorage(snapshot: Record<string, string>, touched: string[]): void {
  if (!isStorageAccessible()) return;
  for (const key of touched) {
    const v = snapshot[key];
    if (typeof v === "string") safeSet(key, v);
    else safeRemove(key);
  }
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
        // 浏览器偏好先写 localStorage（Go 无能力写浏览器侧键值），故先拍照、
        // 磁盘侧导入失败即回滚——否则「磁盘未变、偏好已被覆盖」且无撤销入口。
        // 注意极少数情况（写盘成功但 watcher 重启失败，见 Go 侧 applyPostSaveSideEffects）
        // Go 会报错而磁盘已改，此时回滚会反向分叉；但该分支远少于写盘失败，且磁盘仍是真相源。
        const before = snapshotExportableLocalStorage();
        // 先在导出文件的「白名单命中键」上拍照回滚集——与 apply 共用 importedKeysFrom，
        // 保证「写入键」与「回滚键」口径一致（两处各写一遍手抄判定必漂移）
        const touched = importedKeysFrom(exp.localStorage);
        const applied = applyImportedLocalStorage(exp.localStorage);
        let backupPath = "";
        try {
          const res = await ImportSettingsFromFile(path);
          backupPath = res?.backupPath ?? "";
        } catch (e) {
          restoreExportableLocalStorage(before, touched);
          throw e;
        }
        // 计数用前端台账白名单过滤后的 applied，不用 Go 侧 len(导出文件.localStorage)：
        // 导出文件里本机不认识的键会被忽略，Go 的计数会虚高、误导「已生效 N 项」
        const n = applied;
        setStatus(t("settings.backup.importedTo", { n, backup: backupPath }));
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
