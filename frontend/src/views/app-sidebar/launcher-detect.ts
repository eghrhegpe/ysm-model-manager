// ===== 实例页空态：游戏目录自动搜索 + 启动器实例检测（自 settings 搬家）=====
// 用户在整合包页看到「未找到整合包」时就地完成 mcRoot 配置：
// - 🔍 自动搜索：GetMinecraftPaths 扫描常见安装位置（覆盖标准布局）
// - 🎮 HMCL / PCL：选启动器目录 → DetectLauncherInstances 解析多实例布局
//   （HMCL/PCL 分离实例目录是自动搜索盲区，此入口免手填路径）
// 原 settings 版按钮与 MutationObserver 注入逻辑已随搬家移除，功能收敛到实例页空态。

import { pickDirectory } from "@/backend/directory-picker.ts";
import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { safeGet } from "@/utils/base/primitives/storage.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { modalPicker } from "@/utils/dom/modal-picker.ts";
import { modalSelect } from "@/utils/dom/modal-select.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { esc } from "@/utils/html/html.ts";
import { RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { backendGetApp } from "@/views/backend-deps.ts";

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

/** 并发守卫访问器（由 AppSidebar 实例实现，每实例独立守卫） */
export interface BusyGuard {
  getBusy(): boolean;
  setBusy(v: boolean): void;
}

const toastError = (error: unknown): void => {
  bus.emit("toast:show", {
    msg: `❌ ${friendlyError(error)}`,
    duration: TOAST_MS.verbose,
    type: "error",
  });
};

/** 保存 mcRoot（其余配置项沿用当前值原样回写；theme 取全局主题缺省 dark）；
 *  app 可传已取好的绑定引用（调用方顺手 LoadAppConfig 时免二次动态 import） */
async function saveMcRoot(
  mcRoot: string,
  app?: Awaited<ReturnType<typeof backendGetApp>>,
): Promise<void> {
  const App = app ?? (await backendGetApp());
  const latest = await App.LoadAppConfig();
  await App.SaveAppConfig(
    latest.filesRoot || "",
    latest.resourcepackRoot || "",
    mcRoot,
    latest.linkMode || "copy",
    safeGet("theme") || "dark",
    safeGet("theme-auto") || "",
  );
}

/** 🔍 自动搜索常见 MC 安装位置（多结果弹选择器） */
export async function runMcSearch(guard: BusyGuard): Promise<void> {
  if (guard.getBusy()) return;
  guard.setBusy(true);
  try {
    const App = await backendGetApp();
    const paths = await App.GetMinecraftPaths();
    if (!paths?.length) {
      bus.emit("toast:show", {
        msg: t("settings.mc.noFound"),
        duration: TOAST_MS.normal,
        type: "warn",
      });
      return;
    }
    let selected: string | null = paths[0];
    if (paths.length > 1) {
      selected = await modalSelect({
        title: t("launcher.mc.selectDir"),
        titleIcon: "game",
        items: [...paths],
        okText: t("dialog.ok"),
      });
      if (!selected) return;
    }
    await saveMcRoot(selected, App);
    bus.emit("stats:refresh");
    bus.emit("toast:show", {
      msg: t("content.mcPathSet", { path: selected }),
      duration: TOAST_MS.normal,
      type: "success",
    });
  } catch (error) {
    toastError(error);
  } finally {
    guard.setBusy(false);
  }
}

/** 🎮 HMCL / PCL 实例选择器：复用统一弹窗脚手架 modalPicker（单例/焦点陷阱/Esc/退场动画） */
function showLauncherInstancePicker(
  instances: LauncherInstance[],
): Promise<LauncherSelection | null> {
  return modalPicker({
    title: "HMCL / PCL",
    titleIcon: "game",
    width: "720px",
    subtitle: t("launcher.picker.subtitle"),
    items: instances.map((it) => ({
      label: `${it.launcher} · ${it.name}`,
      meta: it.gameVersion,
      sub: `${t("launcher.picker.game")}: ${it.gameDir}`,
      hint:
        t("launcher.picker.ysm") +
        ": " +
        it.customDir +
        (it.exists ? "" : ` · ${t("launcher.picker.pending")}`),
      hintColor: it.exists ? "var(--status-success,#a6e3a1)" : "",
    })),
    footerHTML: `<label style="display:flex;align-items:center;gap:7px;margin-top:10px;font-size:var(--fs-sm)"><input data-launcher-default name="useAsYsmRoot" type="checkbox" checked> ${esc(t("launcher.picker.useAsYsmRoot"))}</label>`,
  }).then((res): LauncherSelection | null => {
    if (!res) return null;
    const inst = instances[res.index];
    if (!inst) return null;
    return { instance: inst, useAsYsmRoot: res.footerChecked.useAsYsmRoot === true };
  });
}

/** 🎮 HMCL / PCL 启动器实例检测：选启动器目录 → 选实例 → 写 mcRoot（可选并设 YSM 资源根） */
export async function runLauncherDetect(guard: BusyGuard): Promise<void> {
  if (guard.getBusy()) return;
  guard.setBusy(true);
  try {
    const launcherDir = await pickDirectory();
    if (!launcherDir.ok) return;
    const App = await backendGetApp();
    const instances = await App.DetectLauncherInstances(launcherDir.dir);
    if (!instances?.length) {
      bus.emit("toast:show", {
        msg: t("launcher.detect.noInstances"),
        duration: TOAST_MS.normal,
        type: "warn",
      });
      return;
    }
    const selection = await showLauncherInstancePicker(instances);
    if (!selection) return;

    const latest = await App.LoadAppConfig();
    const previousMcRoot = latest.mcRoot || "";
    await saveMcRoot(selection.instance.gameRoot, App);
    if (selection.useAsYsmRoot) {
      try {
        await App.SetResourceRoot(RESOURCE_TYPES.YSM, selection.instance.customDir);
      } catch (error) {
        await saveMcRoot(previousMcRoot, App); // 失败回滚 mcRoot，不留半套配置
        throw error;
      }
    }
    bus.emit("stats:refresh"); // sidebar 防抖重载实例列表
    bus.emit("toast:show", {
      msg: t("launcher.detect.success", {
        launcher: selection.instance.launcher,
        version: selection.instance.gameVersion,
      }),
      duration: TOAST_MS.normal,
      type: "success",
    });
  } catch (error) {
    toastError(error);
  } finally {
    guard.setBusy(false);
  }
}
