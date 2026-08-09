// ===== sidebar 事件层 =====
import { bus } from "../../bus.ts";
import { animateNumber } from "../../utils/animation/animate.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import type { SidebarInstance } from "./data.ts";
import { getApp } from "../../wails/app.ts";

// 绑定每个卡片展开/折叠
// 返回清理函数，组件销毁时移除事件监听
// 注意：事件委托在 #vg 上，outerHTML 替换子元素不破坏监听
let _lastList: HTMLElement | null = null;
let _clickHandler: ((e: MouseEvent) => void) | null = null;
let _contextHandler: ((e: MouseEvent) => void) | null = null;
// P2 修复：共享可变引用——renderVersionCards 只清 innerHTML 不替换 #vg 元素，
// 每次 _reload 后 bindCardEvents 走 list===_lastList 早退复用旧闭包；
// 若闭包直接捕获 instances 参数会拿到首次调用的旧数组（点击/右键数据陈旧）。
// 统一改读 currentInstances，每次调用先更新，早退分支的旧 handler 也能读到最新数据。
let currentInstances: SidebarInstance[] = [];

export function bindCardEvents(
  root: ShadowRoot,
  instances: SidebarInstance[],
): () => void {
  // 先清掉旧的右键容器（防止重复）
  root.querySelectorAll(".vc-context-menu").forEach((el) => el.remove());

  const list = root.getElementById("vg");
  if (!list) return () => {};

  // 每次调用都先更新共享引用（list 复用早退时旧闭包也能读到最新实例数据）
  currentInstances = instances;

  // 如果监听的 list 元素没变，用旧的 handler 引用避免重复绑定
  if (list === _lastList && _clickHandler) {
    restoreSelectedCard(root, instances);
    return () => {};
  }

  // 移除旧的监听（如果 list 被替换了）
  const prevList = _lastList;
  const prevClick = _clickHandler;
  const prevCtx = _contextHandler;
  if (prevList && prevClick && prevCtx) {
    prevList.removeEventListener("click", prevClick);
    prevList.removeEventListener("contextmenu", prevCtx);
  }
  // P2 修复（code_review）+ P2 复核修复：list 替换 = 同组件 reload（非新挂载），
  // 不再复位 _lastEmittedPkg——原实现每次 reload 都复位，restoreSelectedCard 的
  // emitKey 去重恒真失效，每次重发 package:selected，app-content 反复重建
  // <app-sync-manager>（状态丢失/闪烁回归）。真正卸载（disconnectedCallback）才复位，
  // 由 resetSelectedEmit() 显式调用。

  const clickHandler = (e: MouseEvent): void => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("button") || target.closest(".chk")) return;
    const vc = target.closest(".vc") as HTMLElement | null;
    if (!vc) return;
    const hdr = vc.querySelector(".vc-header") as HTMLElement | null;
    if (!hdr) return;
    // 高亮当前选中的版本
    root
      .querySelectorAll(".vc-header")
      .forEach((h) => h.classList.remove("active", "ripple"));
    // 涟漪效果：记录点击坐标，触发涟漪动画
    const rect = hdr.getBoundingClientRect();
    hdr.style.setProperty("--ripple-x", ((e.clientX - rect.left) / rect.width * 100) + "%");
    hdr.style.setProperty("--ripple-y", ((e.clientY - rect.top) / rect.height * 100) + "%");
    hdr.classList.add("active", "ripple");
    setTimeout(() => hdr.classList.remove("ripple"), 500);
    // 发送选中事件
    const idx = parseInt(vc.dataset.idx || "", 10);
    const pkg = currentInstances[idx];
    if (pkg) {
      bus.emit("package:selected", pkg);
      try {
        localStorage.setItem("sb_selectedName_" + (pkg.rtype || RESOURCE_TYPES.YSM), pkg.name);
      } catch (_) {}
    }
  };

  const contextHandler = (e: MouseEvent): void => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const vc = target.closest(".vc") as HTMLElement | null;
    if (!vc) return;
    e.preventDefault();
    e.stopPropagation();
    const idx = parseInt(vc.dataset.idx || "", 10);
    const pkg = currentInstances[idx];
    if (!pkg) return;
    const nameEl = vc.querySelector(".name");
    const name = nameEl ? nameEl.textContent.replace(/^📦\s*/, "") : "";
    bus.emit("ctx:show", {
      x: e.clientX,
      y: e.clientY,
      type: "instance",
      instanceName: name,
      path: pkg?.dir || "",
      rtype: pkg?.rtype || RESOURCE_TYPES.YSM,
    });
  };

  list.addEventListener("click", clickHandler);
  list.addEventListener("contextmenu", contextHandler);

  _lastList = list;
  _clickHandler = clickHandler;
  _contextHandler = contextHandler;

  // 恢复上次选中的整合包
  restoreSelectedCard(root, instances);

  return () => {
    list.removeEventListener("click", clickHandler);
    list.removeEventListener("contextmenu", contextHandler);
    if (_lastList === list) {
      _lastList = null;
      _clickHandler = null;
      _contextHandler = null;
    }
  };
}

/** 根据 localStorage 选中最匹配的整合包 */
let _lastEmittedPkg: string | null = null; // P2 修复：模块级去重——原每次 _reload 都重发 package:selected，app-content 反复重建右侧面板

/** 复位去重标记：组件真正卸载（disconnectedCallback）时调用——
 * 同组件 reload 不复位（去重跨 reload 生效），仅新挂载会话才需重置（P2 复核修复） */
export function resetSelectedEmit(): void {
  _lastEmittedPkg = null;
}

function restoreSelectedCard(
  root: ShadowRoot,
  instances: SidebarInstance[],
): void {
  try {
    const rtypeKey = instances[0]?.rtype || RESOURCE_TYPES.YSM;
    const savedName = localStorage.getItem("sb_selectedName_" + rtypeKey);
    if (!savedName) return;
    const idx = instances.findIndex((i) => i.name === savedName);
    if (idx < 0) return;
    const vc = root.querySelector(`.vc[data-idx="${idx}"]`);
    if (!vc) return;
    // 用 requestAnimationFrame 确保 DOM 渲染完成后再标记高亮
    requestAnimationFrame(() => {
      const hdr = vc.querySelector(".vc-header");
      if (!hdr) return;
      hdr.classList.add("active");
      // P2 修复：仅选中项实际变化时才 emit——原每次重载都重发，
      // app-content 每次收到都 innerHTML 重建 <app-sync-manager>（状态丢失/闪烁）
      const emitKey = rtypeKey + ":" + savedName;
      if (_lastEmittedPkg !== emitKey) {
        _lastEmittedPkg = emitKey;
        bus.emit("package:selected", instances[idx]);
      }
    });
  } catch (_) {}
}

// 绑定底部按钮 + 路径显示
export function bindFooter(
  root: ShadowRoot,
  instances: SidebarInstance[],
): void {
  const btn = root.getElementById("btn-mc");
  if (btn) {
    // 点击跳转到设置页的游戏根目录配置（合并重复入口）
    btn.onclick = () => {
      bus.emit("nav:change", { page: "settings" });
    };
    (async () => {
      try {
        const { LoadAppConfig, SaveAppConfig, GetMinecraftPaths } =
          await getApp();
        const cfg = await LoadAppConfig();
        if (cfg.mcRoot) {
          btn.textContent = `🎮 ${cfg.mcRoot}`;
        } else {
          // 没设置时自动检测：用第一个有效路径
          const paths = await GetMinecraftPaths();
          if (paths?.length) {
            btn.textContent = `🎮 ${paths[0]}`;
            const theme = localStorage.getItem("theme") || "dark";
            await SaveAppConfig(
              cfg.filesRoot || "",
              cfg.resourcepackRoot || "",
              paths[0],
              cfg.linkMode || "copy",
              theme,
            );
          } else {
            btn.textContent = "🎮 未设置";
          }
        }
      } catch (e) {
        btn.textContent = "🎮 未设置";
        console.warn("[sidebar] MC detection:", e);
      }
    })();
  }

  const statSync = root.getElementById("stat-sync");
  (async () => {
    if (!instances || !instances.length) return;
    const total = instances.length;
    const syncedCount = instances.filter(
      (ins) => (ins.missing || 0) + (ins.extra || 0) === 0,
    ).length;
    if (statSync) {
      const label =
        syncedCount === total
          ? `完全同步 ${total}/${total}`
          : `完全同步 ${syncedCount}/${total}`;
      statSync.textContent = label;
      animateNumber(statSync, syncedCount);
    }
  })();
}
