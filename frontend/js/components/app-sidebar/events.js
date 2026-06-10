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

  root.querySelectorAll(".vc").forEach((vc) => {
    const hdr = vc.querySelector(".vc-header");
    if (!hdr) return;

    // 点击标题头：发送选中事件到右侧面板
    hdr.onclick = (e) => {
      if (e.target.closest("button")) return;
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

    // 右键菜单
    hdr.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const nameEl = hdr.querySelector(".name");
      const name = nameEl ? nameEl.textContent.replace(/^📦\s*/, "") : "";
      const idx = parseInt(vc.dataset.idx, 10);
      const pkg = instances[idx];
      bus.emit("ctx:show", {
        x: e.clientX,
        y: e.clientY,
        type: "instance",
        instanceName: name,
        path: pkg?.dir || "",
      });
    };
  });

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
    const hdr = vc.querySelector(".vc-header");
    if (hdr) hdr.classList.add("active");
    bus.emit("package:selected", instances[idx]);
  } catch (_) {}
}

// 绑定底部按钮 + 路径显示
export function bindFooter(root, instances) {
  const btn = root.getElementById("btn-mc");
  if (btn) {
    // 点击跳转到设置页的游戏根目录配置（合并重复入口）
    btn.onclick = () => {
      bus.emit("navigate:settings", { section: "mc" });
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

  const statIns = root.getElementById("stat-ins");
  const statPending = root.getElementById("stat-pending");
  (async () => {
    if (!instances || !instances.length) return;
    let totalPending = 0;
    for (const ins of instances) {
      totalPending += (ins.missing || 0) + (ins.extra || 0);
    }
    if (statIns) {
      const old = parseInt(statIns.textContent.match(/[0-9]+/)?.[0] || "0", 10);
      statIns.textContent = `📂 整合包: ${instances.length}`;
      animateNumber(statIns, instances.length);
    }
    if (statPending) {
      const old = parseInt(
        statPending.textContent.match(/[0-9]+/)?.[0] || "0",
        10,
      );
      statPending.textContent = `🔄 待处理: ${totalPending}`;
      animateNumber(statPending, totalPending);
    }
  })();
}

// 绑定 bus 事件（实例数更新）
export function bindBusUpdates(root, unsubs) {
  unsubs.push(
    bus.on("versions:updated", ({ instances }) => {
      const statEl = root.getElementById("ver-stat");
      if (statEl) statEl.textContent = `${instances.length}个整合包`;
    }),
  );
}
