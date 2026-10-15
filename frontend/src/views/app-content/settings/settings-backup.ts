// ===== 设置导出/导入 逻辑层（ADR-344-d1）=====
// 前端只负责「采集 / 回写浏览器偏好」；磁盘轨（appConfig）由 Go 侧 `ImportSettingsData`
// 落盘（锐评 P2②：前端先 ReadSettingsExport 预览、确认后把**同一个** exp 传入，不再让 Go
// 对同一文件读两遍——计数与实际写入必然一致）。它在 configWriteMu 内**整份覆盖**
// （非逐字段合并：以导出配置为基，走同一套版本门控迁移 + 洗脏），
// 落盘前先备份当前 ysm_config.json，后悔可还原备份文件。
//
// 导入顺序铁律：**磁盘先落盘、浏览器后回写**（锐评 2026-10-16 修正）。理由：
//  1. 磁盘是真相源——`ysm_config.json` + 它的 .bak-* 备份都可回滚，浏览器 localStorage 无备份；
//  2. `ImportSettingsFromFile` 报错 ≠ 磁盘未改（写盘成功但 watcher 重启失败同样会报错，
//     见 Go 侧 `applyPostSaveSideEffects`）。若先写浏览器、再写磁盘，报错时回滚浏览器会把
//     磁盘（新）与浏览器（旧）**反向分叉**——比「磁盘新/浏览器旧」更糟。
//  3. 顺序反过来之后，失败面是「磁盘新 / 浏览器旧」（可接受），且不再需要「导入前拍照 +
//     失败回滚」这套 30 行从未被测试的补偿事务——删掉的是不可判定的启发式，不是功能。
//
// 单一事实源：`frontend/src/settings-keys.ts` 台账。绝不手写第二份键名清单——手抄必漂移，
// 新键漏登记即漏备份（契约测试只锁「键集合与归属」，不锁读写语义，见 tests/test_settings_key_ledger.ts）。
//
// 病根：`b1116645c` 只写了备份迁移文档、代码从未实现导出/导入；用户按文档复制
// `ysm_config.json` 后，字号/键位/3D 偏好/收藏创作者几十项留在旧机浏览器存储里，全程零提示。

import type { SettingsExport } from "@/bindings/ysm-model-manager/go/types/models.ts";
import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { exportableSettingsKeys, type SettingsKeyEntry } from "@/settings-keys";
import {
  isStorageAccessible,
  safeGet,
  safeKeys,
  safeSet,
} from "@/utils/base/primitives/storage.ts";
import { modalConfirm } from "@/utils/dom/modal-confirm.ts";
import { toast } from "@/utils/dom/toast.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { esc } from "@/utils/html/html.ts";
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
 * 与 `applyImportedLocalStorage` 共用同一份判定，保证「提示条数」与「实际写入」口径一致——
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
 *
 * 只在本函数成功调用（磁盘侧导入已完成）后才执行——见文件头「导入顺序铁律」。
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
        // 偏好 map 直接过绑定，不再 JSON.stringify：Go 侧签名已收 map，
        // stringify 是纯双重编码绕弯（前端编码 → Go 解码），多一道出错面无收益
        const path = await ExportSettingsJSON(collectExportableLocalStorage());
        // 状态行显示路径 + 复制按钮（复制属浏览器能力，Go 侧无绑定可依）。
        // path 来自 Go `configDir()`（磁盘路径），非可信常量，必须走 esc()——
        // 状态行是 innerHTML，裸插字符串即注入点
        setStatus(
          `<span style="word-break:break-all">${t("settings.backup.exportedTo", { path: esc(path) })}</span>
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
        const { SelectImportFile, ReadSettingsExport, ImportSettingsData, DirectoryExists } =
          await backendGetApp();
        const path = await SelectImportFile(".json", t("settings.backup.importPickerTitle"));
        if (!path) return; // 用户取消
        const exp = await ReadSettingsExport(path); // 先只读校验（格式/版本），失败即抛、零副作用
        if (!exp?.format) return; // 防御：read 成功但结构不完整（Go 侧不应发生）
        // 导入是**整份覆盖**磁盘配置（ADR-344-d1「以导入配置为基」）且会重启 watcher、
        // 改写 FilesRoot/McRoot——破坏性动作必须二次确认，否则误选/误点即覆盖当前全部设置。
        // ReadSettingsExport 的 Go 侧注释本就约定「前端先做导入前确认」，此前只用了它的计数。
        const willApply = importedKeysFrom(exp.localStorage).length;
        const ok = await modalConfirm({
          title: t("settings.backup.importConfirmTitle"),
          titleIcon: "warning",
          danger: true,
          message: t("settings.backup.importConfirmMessage", { n: willApply }),
          okText: t("settings.backup.importConfirmOk"),
        });
        if (!ok) return; // 用户取消，零副作用（磁盘与浏览器都未动）
        // ① 磁盘轨先落盘（含备份 + 版本门控迁移 + 洗脏 + 侧效），失败即抛、零副作用——
        //    此时浏览器偏好尚未动，不产生任何分叉，也无需回滚
        // 用**同一个** exp 落盘（锐评 P2②）：不再让 Go 对同一文件读两遍——ReadSettingsExport
        // 预览与旧 ImportSettingsFromFile 内部读取之间文件若被替换，确认时的计数与实际
        // 写入就不一致（轻微 TOCTOU）。ImportSettingsData 内部只认 exp.Format 做数据入口防线。
        const res = await ImportSettingsData(exp);
        // ② 磁盘已生效，再回写浏览器偏好（Go 无能力写浏览器侧键值）。
        //    磁盘是真相源且可回滚（.bak-*），浏览器侧失败最多「磁盘新/浏览器旧」，可接受。
        const backupPath = res?.backupPath ?? "";
        const applied = applyImportedLocalStorage(exp.localStorage);
        // 计数用前端台账白名单过滤后的 applied，不用 Go 侧 len(导出文件.localStorage)：
        // 导出文件里本机不认识的键会被忽略，Go 的计数会虚高、误导「已生效 N 项」
        const n = applied;
        // backupPath 为磁盘路径，须走 esc()（同导出路径，理由见上）
        const base = t("settings.backup.importedTo", { n, backup: esc(backupPath) });
        // 锐评 2026-10-17 P2⑤ 增强：导入会**整份覆盖**磁盘路径配置（FilesRoot/McRoot/CustomRoots），
        // 旧机的路径大概率在本机不存在。导入文案原本只提示「若路径无效请在环境页重设」，
        // 这里把提示升级为可执行的检测（目录存在性只能问 Go，回归红线：前端不扫盘）+ 一键跳转环境页。
        const missing = await missingDirsOf(exp.appConfig, DirectoryExists);
        setStatus(
          missing.length === 0
            ? base
            : `<p>${base}</p><p style="color:var(--err);margin-top:4px">${t(
                "settings.backup.importPathMissing",
                { paths: esc(missing.join(", ")) },
              )}</p><button type="button" class="btn-base sm" id="set-backup-open-env" style="font-size:var(--fs-sm);padding:var(--btn-padding-filter-lg);margin-top:6px">${esc(
                t("settings.backup.gotoEnv"),
              )}</button>`,
        );
        if (missing.length > 0) {
          (
            root.getElementById("set-backup-open-env") as HTMLButtonElement | null
          )?.addEventListener("click", () => {
            (root.querySelector('.stg-tab[data-tab="env"]') as HTMLElement | null)?.click();
          });
        }
        toast(t("settings.backup.importDone", { n }), TOAST_MS.long, "success");
        // 全量重建当前面板（清缓存 + 重渲染，同 lang:changed 机制）：主题/语言/路径可能已变，
        // 只刷 store 会留下 UI 与真相分叉
        bus.emit("settings:imported");
      } catch (e) {
        toastError(e);
      }
    });
  });

  // 「恢复最近备份」（锐评 P2④）：导入前自动备份的 .bak-* 此前只产出、UI 无消费入口，
  // 「导入前自动备份、后悔可还原」的承诺全落在文件管理器之外（用户得自己翻 .bak-* 改名）。
  // 恢复也是**整份覆盖**磁盘配置且会重启 watcher → 同样二次确认。
  const restoreBtn = root.getElementById("set-backup-restore") as HTMLButtonElement | null;
  restoreBtn?.addEventListener("click", () => {
    void withBusy(async () => {
      try {
        const { ListSettingsBackups, RestoreSettingsBackup } = await backendGetApp();
        const backups = (await ListSettingsBackups()) ?? [];
        if (backups.length === 0) {
          toast(t("settings.backup.noBackup"), TOAST_MS.normal, "error");
          return;
        }
        const target = backups[0]; // 列表最新在前，恢复最近一次导入前的状态
        const ok = await modalConfirm({
          title: t("settings.backup.restoreConfirmTitle"),
          titleIcon: "warning",
          danger: true,
          message: t("settings.backup.restoreConfirmMessage", {
            // 原始路径直插：modal-confirm.ts:47 对整个 message 做 esc()，外层再 esc 是双重
            // 转义——含 & 的路径显示成 &amp;（锐评 P3④）。
            path: target,
          }),
          okText: t("settings.backup.restoreConfirmOk"),
        });
        if (!ok) return;
        await RestoreSettingsBackup(target);
        toast(t("settings.backup.restoreDone"), TOAST_MS.long, "success");
        // 恢复改写磁盘主题/语言/路径 → 全量重建面板（index.ts 的 settings:imported 订阅里会重算主题镜像）
        bus.emit("settings:imported");
      } catch (e) {
        toastError(e);
      }
    });
  });

  // 打开备份目录（锐评 P2④，P3⑥ 修口）：让用户在文件管理器里看到 .bak-* / ysm_config.json。
  // 旧注释称「本机没有取配置目录的绑定」不实——GetConfigPath 一直存在（app_config.go:71），
  // 据此取目录后，**无备份也能打开**（配置目录恒在，导出快照与 .bak-* 都落这里）；
  // dirOf 保留——浏览器侧拿 Go 磁盘路径只能自己切（无 node path），砍掉的是「必须有备份」的自缚。
  const openBtn = root.getElementById("set-backup-open") as HTMLButtonElement | null;
  openBtn?.addEventListener("click", () => {
    void withBusy(async () => {
      try {
        const { GetConfigPath, OpenFolder } = await backendGetApp();
        const cfgPath = (await GetConfigPath()) ?? "";
        if (!cfgPath) {
          // 平台数据根缺失（configDir fail-fast 形态，见 app_config.go:51-57）：无从打开
          toast(t("settings.backup.dirUnavailable"), TOAST_MS.normal, "error");
          return;
        }
        await OpenFolder(dirOf(cfgPath));
        toast(t("settings.backup.openedDir"), TOAST_MS.normal, "success");
      } catch (e) {
        toastError(e);
      }
    });
  });
}

/** 取路径的目录部分（跨平台：兼容 Windows `\` 与 POSIX `/`，取最后一个分隔符之前的部分）。
 *  生产侧无 node `path`，浏览器里拿 Go 磁盘路径只能自己切。 */
function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i <= 0 ? "." : p.slice(0, i);
}

/** 收集导入配置里在本机**不存在**的目录路径（锐评 2026-10-17 P2⑤）。
 *  目录存在性只能问 Go（回归红线：前端不扫磁盘、不重算归属语义）；空路径跳过（未设置不算缺失）。
 *  `customRoots` 是 `{资源类型 -> 路径}` map，值可能为 undefined，一并过滤。 */
async function missingDirsOf(
  cfg: SettingsExport["appConfig"],
  exists: (path: string) => Promise<boolean>,
): Promise<string[]> {
  const candidates = [cfg?.filesRoot, cfg?.mcRoot, ...Object.values(cfg?.customRoots ?? {})].filter(
    (p): p is string => typeof p === "string" && p.trim() !== "",
  );
  const missing: string[] = [];
  for (const p of candidates) {
    if (!(await exists(p))) missing.push(p);
  }
  return missing;
}
