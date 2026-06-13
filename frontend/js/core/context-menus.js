// ===== 右键菜单映射 =====
// 将 ctx:show 事件转换为新版组件使用的 menu:show 事件
import { bus } from "../bus.js";
import { friendlyError } from "../utils/errors.js";

/** 通知树组件和统计面板刷新 */
function refreshUI() {
  bus.emit("tree:reload");
  bus.emit("stats:refresh");
}

/** 显示 toast 通知 */
function toast(msg, duration = 3000, type = "success") {
  bus.emit("toast:show", { msg, duration, type });
}

export function registerContextMenus() {
  bus.on(
    "ctx:show",
    ({
      x,
      y,
      type,
      instanceName,
      path,
      banned,
      dir,
      name,
      count,
      paths,
      rtype,
    }) => {
      if (type === "instance") {
        bus.emit("menu:show", {
          x,
          y,
          items: [
            { label: "📦 " + instanceName, onClick: () => {} },
            { divider: true },
            {
              label: "打开文件夹",
              icon: "📂",
              onClick: () => {
                const { OpenFolder } = window.go.main.App;
                OpenFolder?.(path || "");
              },
            },
            { divider: true },
            {
              label: "复制模型清单",
              icon: "📄",
              onClick: () =>
                bus.emit("instance:export-list", { name: instanceName, rtype }),
            },
            { divider: true },
            {
              label: "清空此整合包的模型",
              icon: "🗑️",
              danger: true,
              onClick: () => bus.emit("instance:clear", { name: instanceName }),
            },
          ],
        });
        return;
      }
      if (type === "batch") {
        bus.emit("menu:show", {
          x,
          y,
          items: [
            { label: `📦 已选 ${count} 个文件`, onClick: () => {} },
            { divider: true },
            {
              label: "批量重命名...",
              icon: "✂️",
              onClick: () => bus.emit("batch:rename", { paths }),
            },
            {
              label: "移动到…",
              icon: "📂",
              onClick: async () => {
                const { modalPrompt } = await import("../dialogs/modal.js");
                const folder = await modalPrompt({
                  title: "移动到文件夹",
                  icon: "📂",
                  placeholder: "输入目标文件夹名，如 [作者名]",
                  okText: "移动",
                });
                if (!folder) return;
                const { LoadAppConfig, MoveModelFile } =
                  await import("../../wailsjs/go/main/App.js");
                const cfg = await LoadAppConfig();
                const repoRoot = cfg.repoRoot || "";
                if (!repoRoot) {
                  bus.emit("toast:show", {
                    msg: "❌ 请先设置仓库目录",
                    duration: 3000,
                    type: "error",
                  });
                  return;
                }
                const dstDir = repoRoot + "\\" + folder.replace(/\//g, "\\");
                let ok = 0,
                  fail = 0;
                for (const p of paths) {
                  try {
                    await MoveModelFile(p, dstDir);
                    ok++;
                  } catch (e) {
                    fail++;
                    console.error("移动失败:", p, e);
                  }
                }
                toast(
                  ok > 0 ? `✅ ${ok} 个文件已移动到 ${folder}` : "❌ 移动失败",
                  4000,
                );
                refreshUI();
              },
            },
            { divider: true },
            {
              label: "移入回收站",
              icon: "♻️",
              danger: true,
              onClick: async () => {
                const { modalConfirm } = await import("../dialogs/modal.js");
                const ok2 = await modalConfirm({
                  title: "批量移入回收站",
                  icon: "♻️",
                  message: `确定将选中的 ${count} 个文件移入回收站？`,
                  okText: "♻️ 移入",
                  danger: true,
                });
                if (!ok2) return;
                const { MoveToRecycle } =
                  await import("../../wailsjs/go/main/App.js");
                for (const p of paths) {
                  try {
                    await MoveToRecycle(p);
                  } catch {}
                }
                refreshUI();
              },
            },
          ],
        });
        return;
      }
      if (type === "file") {
        bus.emit("menu:show", {
          x,
          y,
          items: [
            {
              label: "重命名",
              icon: "✂️",
              onClick: async () => {
                try {
                  const { showRenameDialog } =
                    await import("../dialogs/rename.js");
                  const fileName = path.split(/[/\\]/).pop();
                  const newName = await showRenameDialog(path, fileName);
                  if (!newName) return;
                  const { RenameFile } =
                    await import("../../wailsjs/go/main/App.js");
                  await RenameFile(path, newName);
                  refreshUI();
                } catch (e) {
                  toast("❌ " + friendlyError(e, "重命名失败"), 4000, "error");
                }
              },
            },
            {
              label: "移动到…",
              icon: "📂",
              onClick: async () => {
                const { modalPrompt } = await import("../dialogs/modal.js");
                const folder = await modalPrompt({
                  title: "移动到文件夹",
                  icon: "📂",
                  placeholder: "输入目标文件夹名，如 [作者名]",
                  okText: "移动",
                });
                if (!folder) return;
                const { LoadAppConfig, MoveModelFile } =
                  await import("../../wailsjs/go/main/App.js");
                const cfg = await LoadAppConfig();
                const repoRoot = cfg.repoRoot || "";
                if (!repoRoot) {
                  bus.emit("toast:show", {
                    msg: "❌ 请先设置仓库目录",
                    duration: 3000,
                    type: "error",
                  });
                  return;
                }
                const dstDir = repoRoot + "\\" + folder.replace(/\//g, "\\");
                try {
                  await MoveModelFile(path, dstDir);
                  toast(`✅ 已移动到 ${folder}`, 3000);
                  refreshUI();
                } catch (e) {
                  toast("❌ " + friendlyError(e, "移动失败"), 4000, "error");
                }
              },
            },
            {
              label: "推送到整合包…",
              icon: "📦",
              onClick: async () => {
                const { LoadAppConfig, ListVersionInstances, InstallModelTo } =
                  await import("../../wailsjs/go/main/App.js");
                const cfg = await LoadAppConfig();
                const mcRoot = cfg.mcRoot || "";
                if (!mcRoot) {
                  toast("请先设置游戏根目录", 2000, "warn");
                  return;
                }
                const instances = await ListVersionInstances(mcRoot);
                if (!instances || !instances.length) {
                  toast("未找到任何整合包", 2000, "warn");
                  return;
                }
                const { modalSelect } = await import("../dialogs/modal.js");
                const names = instances.map((i) => i.Name);
                const chosen = await modalSelect({
                  title: "推送到整合包",
                  icon: "📦",
                  items: names,
                  okText: "📦 推送",
                });
                if (!chosen) return;
                const match = instances.find((i) => i.Name === chosen);
                if (!match) return;
                const name = path.split(/[/\\]/).pop();
                try {
                  await InstallModelTo(name, match.CustomDir);
                  toast(`✅ 已推送到 ${chosen}`, 2000);
                } catch (e) {
                  toast("❌ " + friendlyError(e, "推送失败"), 3000, "error");
                }
              },
            },
            { divider: true },
            {
              label: "移入回收站",
              icon: "♻️",
              danger: true,
              onClick: async () => {
                const { modalConfirm } = await import("../dialogs/modal.js");
                const ok2 = await modalConfirm({
                  title: "移入回收站",
                  icon: "♻️",
                  message: `确定将 ${path.split("/").pop()} 移入回收站？`,
                  okText: "♻️ 移入",
                  danger: true,
                });
                if (!ok2) return;
                const { MoveToRecycle } =
                  await import("../../wailsjs/go/main/App.js");
                try {
                  await MoveToRecycle(path);
                  refreshUI();
                } catch {}
              },
            },
            { divider: true },
            {
              label: "复制文件路径",
              icon: "📋",
              onClick: async () => {
                try {
                  await navigator.clipboard.writeText(path);
                  toast("✅ 路径已复制到剪贴板", 2000);
                } catch {
                  const ta = document.createElement("textarea");
                  ta.value = path;
                  ta.style.position = "fixed";
                  ta.style.opacity = "0";
                  document.body.appendChild(ta);
                  ta.select();
                  document.execCommand("copy");
                  document.body.removeChild(ta);
                  toast("✅ 路径已复制到剪贴板", 2000);
                }
              },
            },
          ],
        });
        return;
      }
      if (type === "dir") {
        bus.emit("menu:show", {
          x,
          y,
          items: [
            {
              label: "重命名…",
              icon: "✂️",
              onClick: () => bus.emit("dir:rename", { dir }),
            },
            {
              label: "批量重命名…",
              icon: "📝",
              onClick: () => bus.emit("dir:batch-rename", { dir }),
            },
            { divider: true },
            {
              label: "新建子文件夹…",
              icon: "🗂",
              onClick: () => bus.emit("dir:mkdir", { dir }),
            },
            { divider: true },
            {
              label: "移入回收站",
              icon: "♻️",
              danger: true,
              onClick: () => bus.emit("dir:recycle", { dir }),
            },
          ],
        });
        return;
      }
    },
  );
}
