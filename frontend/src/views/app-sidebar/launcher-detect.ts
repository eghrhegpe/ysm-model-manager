// ===== 实例页空态：游戏目录自动搜索 + 启动器实例检测（自 settings 搬家）=====
// 用户在整合包页看到「未找到整合包」时就地完成 mcRoot 配置：
// - 🔍 自动搜索：GetMinecraftPaths 扫描常见安装位置（覆盖标准布局）
// - 🎮 HMCL / PCL：选启动器目录 → DetectLauncherInstances 解析多实例布局
//   （HMCL/PCL 分离实例目录是自动搜索盲区，此入口免手填路径）
// 原 settings 版按钮与 MutationObserver 注入逻辑已随搬家移除，功能收敛到实例页空态。

import { bus } from "../../bus.ts";
import { t } from "../../core/i18n/t.ts";
import { getApp } from "../../backend/app.ts";
import { pickDirectory } from "../../utils/dom/directory-picker.ts";
import { modalSelect } from "../../utils/dom/dialogs/modal.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { safeGet } from "../../utils/dom/storage.ts";
import { esc } from "../../utils/dom/html.ts";
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";

interface LauncherInstance {
  launcher: string;
  name: string;
  gameVersion: string;
  gameRoot: string;
  gameDir: string;
  customDir: string;
  exists: boolean;
}

interface LauncherSelection {
  instance: LauncherInstance;
  useAsYsmRoot: boolean;
}

/** 检测/搜索进行中守卫（两类入口共享：都在改 mcRoot，不并发） */
let _busy = false;

/** 保存 mcRoot（其余配置项沿用当前值原样回写；theme 取全局主题缺省 dark） */
async function saveMcRoot(mcRoot: string): Promise<void> {
  const App = await getApp();
  const latest = await App.LoadAppConfig();
  await App.SaveAppConfig(
    latest.filesRoot || "",
    latest.resourcepackRoot || "",
    mcRoot,
    latest.linkMode || "copy",
    safeGet("theme") || "dark",
  );
}

/** 🔍 自动搜索常见 MC 安装位置（多结果弹选择器） */
export async function runMcSearch(): Promise<void> {
  if (_busy) return;
  _busy = true;
  try {
    const App = await getApp();
    const paths = await App.GetMinecraftPaths();
    if (!paths?.length) {
      bus.emit("toast:show", { msg: t("settings.mc.noFound"), duration: TOAST_MS.normal, type: "warn" });
      return;
    }
    let selected: string | null = paths[0];
    if (paths.length > 1) {
      selected = await modalSelect({
        title: "选择游戏目录",
        icon: "🎮",
        items: [...paths],
        okText: "确定",
      });
      if (!selected) return;
    }
    await saveMcRoot(selected);
    bus.emit("stats:refresh");
    bus.emit("toast:show", {
      msg: t("content.mcPathSet", { path: selected }),
      duration: TOAST_MS.normal,
      type: "success",
    });
  } catch (error) {
    bus.emit("toast:show", { msg: "❌ " + friendlyError(error), duration: TOAST_MS.verbose, type: "error" });
  } finally {
    _busy = false;
  }
}

function showLauncherInstancePicker(instances: LauncherInstance[]): Promise<LauncherSelection | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.dataset.launcherPicker = "1";
    overlay.style.cssText = "position:fixed;z-index:100000;inset:0;background:rgba(0,0,0,.48);display:flex;align-items:center;justify-content:center";
    const box = document.createElement("div");
    box.style.cssText = "background:var(--surf,#2a2a3a);border:1px solid var(--bd,#444);border-radius:12px;padding:16px;max-width:720px;width:92%;max-height:78vh;overflow:auto;box-shadow:0 8px 32px rgba(0,0,0,.4);color:var(--txt,#cdd6f4)";
    const rows = instances.map((instance, index) => `
      <button data-launcher-instance="${index}" style="display:block;width:100%;text-align:left;margin:6px 0;padding:10px;border:1px solid var(--bd,#444);border-radius:8px;background:transparent;color:inherit;cursor:pointer;font-family:inherit">
        <div style="display:flex;justify-content:space-between;gap:8px;font-weight:600">
          <span>${esc(instance.launcher)} · ${esc(instance.name)}</span>
          <span style="color:var(--accent,#89b4fa)">${esc(instance.gameVersion)}</span>
        </div>
        <div style="font-size:10px;color:var(--muted,#888);margin-top:5px">Game: ${esc(instance.gameDir)}</div>
        <div style="font-size:10px;color:${instance.exists ? "var(--status-success,#a6e3a1)" : "var(--muted,#888)"};margin-top:2px">YSM: ${esc(instance.customDir)}${instance.exists ? "" : " · pending"}</div>
      </button>`).join("");
    box.innerHTML = `<div style="font-weight:650;font-size:14px">🎮 HMCL / PCL</div>
      <div style="font-size:10px;color:var(--muted,#888);margin:5px 0 10px">Select a Minecraft instance and its YSM custom directory.</div>
      ${rows}
      <label style="display:flex;align-items:center;gap:7px;margin-top:10px;font-size:11px"><input data-launcher-default type="checkbox" checked> Use YSM custom directory as default download path</label>
      <div style="margin-top:12px;text-align:right"><button data-launcher-cancel class="btn-base sm">Cancel</button></div>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    box.querySelectorAll<HTMLElement>("[data-launcher-instance]").forEach((row) => {
      row.addEventListener("click", () => {
        const index = Number(row.dataset.launcherInstance || "0");
        const useAsYsmRoot = !!box.querySelector<HTMLInputElement>("[data-launcher-default]")?.checked;
        overlay.remove();
        resolve(instances[index] ? { instance: instances[index], useAsYsmRoot } : null);
      });
    });
    box.querySelector("[data-launcher-cancel]")?.addEventListener("click", () => {
      overlay.remove();
      resolve(null);
    });
  });
}

/** 🎮 HMCL / PCL 启动器实例检测：选启动器目录 → 选实例 → 写 mcRoot（可选并设 YSM 资源根） */
export async function runLauncherDetect(): Promise<void> {
  if (_busy) return;
  _busy = true;
  try {
    const launcherDir = await pickDirectory();
    if (!launcherDir) return;
    const App = await getApp();
    const instances = await App.DetectLauncherInstances(launcherDir);
    if (!instances?.length) {
      bus.emit("toast:show", { msg: "No HMCL/PCL Minecraft instance found", duration: 3500, type: "warn" });
      return;
    }
    const selection = await showLauncherInstancePicker(instances);
    if (!selection) return;

    const latest = await App.LoadAppConfig();
    const previousMcRoot = latest.mcRoot || "";
    await saveMcRoot(selection.instance.gameRoot);
    if (selection.useAsYsmRoot) {
      try {
        await App.SetResourceRoot("ysm", selection.instance.customDir);
      } catch (error) {
        await saveMcRoot(previousMcRoot); // 失败回滚 mcRoot，不留半套配置
        throw error;
      }
    }
    bus.emit("stats:refresh"); // sidebar 防抖重载实例列表
    bus.emit("toast:show", {
      msg: `✅ ${selection.instance.launcher} · Minecraft ${selection.instance.gameVersion}`,
      duration: 3000,
      type: "success",
    });
  } catch (error) {
    bus.emit("toast:show", { msg: "❌ " + friendlyError(error), duration: TOAST_MS.verbose, type: "error" });
  } finally {
    _busy = false;
  }
}
