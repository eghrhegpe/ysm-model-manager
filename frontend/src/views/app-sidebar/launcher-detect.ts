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
import { modalPicker, modalSelect } from "../../utils/dom/dialogs/modal.ts";
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

const toastError = (error: unknown): void => {
  bus.emit("toast:show", { msg: "❌ " + friendlyError(error), duration: TOAST_MS.verbose, type: "error" });
};

/** 保存 mcRoot（其余配置项沿用当前值原样回写；theme 取全局主题缺省 dark）；
 *  app 可传已取好的绑定引用（调用方顺手 LoadAppConfig 时免二次动态 import） */
async function saveMcRoot(mcRoot: string, app?: Awaited<ReturnType<typeof getApp>>): Promise<void> {
  const App = app ?? await getApp();
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
        title: t("launcher.mc.selectDir"),
        icon: "🎮",
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
    _busy = false;
  }
}

/** 🎮 HMCL / PCL 实例选择器：复用统一弹窗脚手架 modalPicker（单例/焦点陷阱/Esc/退场动画） */
function showLauncherInstancePicker(instances: LauncherInstance[]): Promise<LauncherSelection | null> {
  return modalPicker({
    title: "🎮 HMCL / PCL",
    icon: "",
    width: "720px",
    subtitle: t("launcher.picker.subtitle"),
    items: instances.map((it) => ({
      label: `${it.launcher} · ${it.name}`,
      meta: it.gameVersion,
      sub: t("launcher.picker.game") + ": " + it.gameDir,
      hint: t("launcher.picker.ysm") + ": " + it.customDir + (it.exists ? "" : " · " + t("launcher.picker.pending")),
      hintColor: it.exists ? "var(--status-success,#a6e3a1)" : "",
    })),
    footerHTML: `<label style="display:flex;align-items:center;gap:7px;margin-top:10px;font-size:11px"><input data-launcher-default name="useAsYsmRoot" type="checkbox" checked> ${esc(t("launcher.picker.useAsYsmRoot"))}</label>`,
  }).then((res): LauncherSelection | null => {
    if (!res) return null;
    const inst = instances[res.index];
    if (!inst) return null;
    return { instance: inst, useAsYsmRoot: res.footerChecked["useAsYsmRoot"] === true };
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
      bus.emit("toast:show", { msg: t("launcher.detect.noInstances"), duration: 3500, type: "warn" });
      return;
    }
    const selection = await showLauncherInstancePicker(instances);
    if (!selection) return;

    const latest = await App.LoadAppConfig();
    const previousMcRoot = latest.mcRoot || "";
    await saveMcRoot(selection.instance.gameRoot, App);
    if (selection.useAsYsmRoot) {
      try {
        await App.SetResourceRoot("ysm", selection.instance.customDir);
      } catch (error) {
        await saveMcRoot(previousMcRoot, App); // 失败回滚 mcRoot，不留半套配置
        throw error;
      }
    }
    bus.emit("stats:refresh"); // sidebar 防抖重载实例列表
    bus.emit("toast:show", {
      msg: t("launcher.detect.success", { launcher: selection.instance.launcher, version: selection.instance.gameVersion }),
      duration: 3000,
      type: "success",
    });
  } catch (error) {
    toastError(error);
  } finally {
    _busy = false;
  }
}
