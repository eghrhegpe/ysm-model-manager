// ===== 整合包操作：导出清单 / 清空目录（类型化版 — ADR-014 P3）=====
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import { bus } from "../../bus.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { modalConfirm } from "../../utils/dom/dialogs/modal.ts";
import { getApp } from "../../backend/app.ts";
import { requireMcRoot } from "./require-mcroot.ts";
import { RESOURCE_TYPES, RESOURCE_TYPE_LABELS } from "../../utils/resource/types.ts";
import { t } from "../../core/i18n/t.ts";
import { toastEmptyRtype } from "../context-menu-shared.ts";

/** 注册整合包操作 handler，push 返回的取消订阅函数到 unsubs */
export function registerInstanceOps(unsubs: Array<() => void>): void {
  // 导出文件清单到剪贴板（支持 rtype 筛选）
  unsubs.push(
    bus.on("instance:export-list", async ({ name: insName, rtype }) => {
      try {
        const {
          ListVersionInstances,
          ListFileNames,
          GetRepoRoot,
        } = await getApp();
        const mcRoot = await requireMcRoot();
        if (!mcRoot) return;

        // P0 修复：rtype 必须明确指定，不能 fallback 到遍历全部类型——
        // 否则用户右键「复制模型清单」会导出整合包所有类型的文件，
        // 而不是当前选中类型（如 MMD）的文件。
        if (!rtype) {
          toastEmptyRtype();
          return;
        }

        const instances = (await ListVersionInstances(mcRoot)) ?? [];
        const ins = instances.find((i) => i.Name === insName);
        if (!ins?.VersionDir) {
          bus.emit("toast:show", {
            msg: "未找到整合包",
            duration: TOAST_MS.normal,
            type: "error",
          });
          return;
        }

        // 子目录映射——从 Go 端统一获取
        const { GetSubDirMap } = await getApp();
        const subDirAll = (await GetSubDirMap()) ?? {};

        let dirs: string[] = [];
        let labels: string[] = [];
        if (subDirAll[rtype]) {
          dirs = [ins.VersionDir + "/" + subDirAll[rtype]];
          labels = [rtype];
        }
        // rtype 指定但未命中映射时，dirs 为空 → totalFiles===0 → 「没有资源文件」info toast

        let allLines: string[] = [`📦 ${insName}`];
        let totalFiles = 0;
        for (let i = 0; i < dirs.length; i++) {
          try {
            const files = await ListFileNames(dirs[i]);
            if (files?.length) {
              allLines.push(`\n── ${labels[i]} (${files.length}) ──`);
              allLines.push(...files);
              totalFiles += files.length;
            }
          } catch (e) {
            console.warn(`[instance-ops] ListFileNames 失败 (${labels[i]}):`, e);
          }
        }

        // P4 修复（子代理审计）：`!totalFiles` 用 truthiness 判断数值——虽不可能为 NaN
        //（仅 += files.length，非负整数）但违反 ADR-044 ②「数值用显式判断」，与同文件
        // L118 `totalCount === 0` 写法不一致
        if (totalFiles === 0) {
          bus.emit("toast:show", {
            msg: "该整合包没有资源文件",
            duration: TOAST_MS.success,
            type: "info",
          });
          return;
        }

        const text = allLines.join("\n");
        await navigator.clipboard.writeText(text);
        bus.emit("toast:show", {
          msg: `📋 已复制 ${totalFiles} 个文件清单到剪贴板`,
          duration: TOAST_MS.normal,
          type: "success",
        });
      } catch (e) {
        bus.emit("toast:show", {
          msg: `❌ ${friendlyError(e)}`,
          duration: TOAST_MS.long,
          type: "error",
        });
      }
    }),
  );

  // 清空整合包内指定类型的文件；未指定 rtype 时拒绝操作（P0 修复）
  unsubs.push(
    bus.on("instance:clear", async ({ name: insName, rtype }) => {
      try {
        const {
          CountInstanceResources,
          ClearInstanceResources,
        } = await getApp();
        const mcRoot = await requireMcRoot();
        if (!mcRoot) return;

        // P0 修复：rtype 必须明确指定，不能 fallback 到清空全部——
        // 否则用户右键「清空此整合包的模型」会误删所有类型的文件，
        // 而不是当前选中类型（如 MMD）的文件。
        if (!rtype) {
          toastEmptyRtype();
          return;
        }

        // 先统计数量——传入 rtype 限定范围
        let totalCount = 0;
        try {
          totalCount = await CountInstanceResources(insName, rtype);
        } catch (countErr) {
          // 统计失败不静默：显示「没有资源」会误导用户以为整合包为空
          bus.emit("toast:show", {
            msg: "❌ 统计失败: " + friendlyError(countErr, "无法统计资源数量"),
            duration: TOAST_MS.normal,
            type: "error",
          });
          return;
        }
        if (totalCount === 0) {
          bus.emit("toast:show", {
            msg: "该整合包没有可清空的资源文件",
            duration: TOAST_MS.success,
            type: "info",
          });
          return;
        }
        const typeLabel = RESOURCE_TYPE_LABELS[rtype] || rtype;
        const confirmed = await modalConfirm({
          title: "清空整合包",
          icon: "🗑️",
          message: `清空 ${insName}\n扫描到 ${totalCount} 个资源文件将被清空（走回收站，可恢复）。\n类型：${typeLabel}\n未入库的文件保留不动。确定继续吗？`,
          okText: "🗑️ 清空",
          danger: true,
        });
        if (!confirmed) {
          bus.emit("toast:show", {
            msg: "已取消",
            duration: TOAST_MS.quick,
            type: "info",
          });
          return;
        }
        try {
          const count = await ClearInstanceResources(insName, rtype);
          bus.emit("stats:refresh");
          bus.emit("toast:show", {
            msg: `🗑️ ${insName}: 已清空 ${count} 个文件（移入回收站）`,
            duration: TOAST_MS.normal,
            type: "success",
          });
        } catch (err) {
          bus.emit("toast:show", {
            msg: `❌ 清空失败: ${friendlyError(err, "清空失败")}`,
            duration: TOAST_MS.long,
            type: "error",
          });
        }
      } catch (e) {
        bus.emit("toast:show", {
          msg: `❌ ${friendlyError(e)}`,
          duration: TOAST_MS.long,
          type: "error",
        });
      }
    }),
  );
}
