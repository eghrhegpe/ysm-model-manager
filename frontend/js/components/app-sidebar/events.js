// ===== sidebar 事件层 =====
import { bus } from "../../bus.js";
import { animateNumber } from "../../utils/animate.js";
import { bindInstanceActions } from "./actions.js";

// 绑定每个卡片展开/折叠
export function bindCardEvents(root, instances) {
  // 后续绑定行内按钮
  bindInstanceActions(root, instances);
  // 先清掉旧的右键容器（防止重复）
  root.querySelectorAll(".vc-context-menu").forEach((el) => el.remove());

  // 点击卡片：发送选中事件到右侧面板（事件委托，outerHTML 后仍然有效）
  const list = root.getElementById("vg");
  if (list) {
    list.addEventListener("click", (e) => {
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
    });

    // 右键菜单（事件委托在容器上，outerHTML 后仍然有效）
    list.addEventListener("contextmenu", (e) => {
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
    });
  }

  // 恢复上次选中的整合包
  restoreSelectedCard(root, instances);
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
      const old = parseInt(
        statSync.textContent.match(/[0-9]+\/[0-9]+/)?.[0]?.split("/")[0] || "0",
        10,
      );
      statSync.textContent = label;
      animateNumber(statSync, syncedCount);
    }
  })();
}

// 绑定 bus 事件（实例同步状态更新）
export function bindBusUpdates(root, unsubs) {
  unsubs.push(
    bus.on("versions:updated", ({ instances }) => {
      const statEl = root.getElementById("stat-sync");
      if (!statEl || !instances?.length) return;
      const total = instances.length;
      const syncedCount = instances.filter(
        (ins) => (ins.missing || 0) + (ins.extra || 0) === 0,
      ).length;
      statEl.textContent =
        syncedCount === total
          ? `完全同步 ${total}/${total}`
          : `完全同步 ${syncedCount}/${total}`;
    }),
  );
}
