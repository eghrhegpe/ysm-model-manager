// ===== sidebar 事件层 =====
import { bus } from "../../bus.js";
import { animateNumber } from "../../utils/animate.js";

// 绑定每个卡片展开/折叠
// 返回清理函数，组件销毁时移除事件监听
// 注意：事件委托在 #vg 上，outerHTML 替换子元素不破坏监听
let _lastList = null;
let _clickHandler = null;
let _contextHandler = null;

export function bindCardEvents(root, instances) {
  // 先清掉旧的右键容器（防止重复）
  root.querySelectorAll(".vc-context-menu").forEach((el) => el.remove());

  const list = root.getElementById("vg");
  if (!list) return () => {};

  // 如果监听的 list 元素没变，用旧的 handler 引用避免重复绑定
  if (list === _lastList && _clickHandler) {
    restoreSelectedCard(root, instances);
    return () => {};
  }

  // 移除旧的监听（如果 list 被替换了）
  if (_lastList && _clickHandler) {
    _lastList.removeEventListener("click", _clickHandler);
    _lastList.removeEventListener("contextmenu", _contextHandler);
  }

  const clickHandler = (e) => {
    if (e.target.closest("button") || e.target.closest(".chk")) return;
    const vc = e.target.closest(".vc");
    if (!vc) return;
    const hdr = vc.querySelector(".vc-header");
    if (!hdr) return;
    // 高亮当前选中的版本
    root
      .querySelectorAll(".vc-header")
      .forEach((h) => h.classList.remove("active"));
    hdr.classList.add("active");
    // 发送选中事件
    const idx = parseInt(vc.dataset.idx, 10);
    const pkg = instances[idx];
    if (pkg) {
      bus.emit("package:selected", pkg);
      try {
        localStorage.setItem("sb_selectedName", pkg.name);
      } catch (_) {}
    }
  };

  const contextHandler = (e) => {
    const vc = e.target.closest(".vc");
    if (!vc) return;
    e.preventDefault();
    e.stopPropagation();
    const idx = parseInt(vc.dataset.idx, 10);
    const pkg = instances[idx];
    if (!pkg) return;
    const nameEl = vc.querySelector(".name");
    const name = nameEl ? nameEl.textContent.replace(/^📦\s*/, "") : "";
    bus.emit("ctx:show", {
      x: e.clientX,
      y: e.clientY,
      type: "instance",
      instanceName: name,
      path: pkg?.dir || "",
      rtype: pkg?.rtype || "ysm",
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
function restoreSelectedCard(root, instances) {
  try {
    const savedName = localStorage.getItem("sb_selectedName");
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
      bus.emit("package:selected", instances[idx]);
    });
  } catch (_) {}
}

// 绑定底部按钮 + 路径显示
export function bindFooter(root, instances) {
  const btn = root.getElementById("btn-mc");
  if (btn) {
    // 点击跳转到设置页的游戏根目录配置（合并重复入口）
    btn.onclick = () => {
      bus.emit("nav:change", { page: "settings" });
    };
    (async () => {
      try {
        const { LoadAppConfig, SaveAppConfig, GetMinecraftPaths } =
          await import("../../../wailsjs/go/main/App.js");
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
              cfg.repoRoot || "",
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
