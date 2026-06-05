// ===== sidebar 事件层 =====
import { bus } from "../../bus.js";
import { bindInstanceActions } from "./actions.js";

// 绑定每个卡片展开/折叠
export function bindCardEvents(root, instances) {
  // 后续绑定行内按钮
  bindInstanceActions(root, instances);
  // 先清掉旧的右键容器（防止重复）
  root.querySelectorAll(".vc-context-menu").forEach((el) => el.remove());

  root.querySelectorAll(".vc").forEach((vc) => {
    const hdr = vc.querySelector(".vc-header");
    const body = vc.nextElementSibling;
    if (!hdr || !body || !body.classList.contains("vc-body")) return;

    // 点击标题头：展开/折叠 + 发送选中事件到预览栏
    hdr.onclick = (e) => {
      // 如果点击的是按钮，不触发折叠
      if (e.target.closest("button")) return;
      const arrow = hdr.querySelector(".arrow");
      const isNowOpen = body.style.display !== "none";
      body.style.display = isNowOpen ? "none" : "";
      if (arrow) arrow.classList.toggle("open");
      // 持久化展开状态
      const nameEl = hdr.querySelector(".name");
      const name = nameEl ? nameEl.textContent.replace(/^📦\s*/, "") : "";
      if (name)
        try {
          localStorage.setItem("sb_open_" + name, !isNowOpen);
        } catch {}

      // 发送选中事件到预览栏
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
    const body = vc.nextElementSibling;
    if (hdr && body && body.classList.contains("vc-body")) {
      const arrow = hdr.querySelector(".arrow");
      body.style.display = "";
      if (arrow) arrow.classList.add("open");
    }
    bus.emit("package:selected", instances[idx]);
  } catch (_) {}
}

// 绑定搜索框
export function bindSearch(root, vm) {
  const inp = root.getElementById("ver-search");
  if (inp) {
    inp.oninput = (e) => {
      const keyword = e.target.value.toLowerCase().trim();
      vm._search = keyword;
      vm._renderCards();
    };
  }
}

// 绑定底部按钮 + 路径显示
export function bindFooter(root, instances) {
  const btn = root.getElementById("btn-mc");
  if (btn) {
    btn.onclick = () => bus.emit("dir:select-mc");
    (async () => {
      try {
        const { LoadAppConfig } =
          await import("../../../wailsjs/go/main/App.js");
        const cfg = await LoadAppConfig();
        btn.textContent = cfg.mcRoot || "" ? `🎮 ${cfg.mcRoot}` : "🎮 未设置";
      } catch {
        btn.textContent = "🎮 未设置";
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
    if (statIns) statIns.textContent = `📂 整合包: ${instances.length}`;
    if (statPending) statPending.textContent = `🔄 待处理: ${totalPending}`;
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
