// ===== sidebar 事件层 =====

// 绑定每个卡片展开/折叠
export function bindCardEvents(root) {
  root.querySelectorAll(".vc-header").forEach((hdr) => {
    hdr.onclick = () => {
      const body = hdr.nextElementSibling;
      const arrow = hdr.querySelector(".arrow");
      if (body && body.classList.contains("vc-body")) {
        body.style.display = body.style.display === "none" ? "" : "none";
        arrow.classList.toggle("open");
      }
    };
  });
}

// 绑定搜索框
export function bindSearch(root) {
  const inp = root.getElementById("ver-search");
  if (inp) {
    inp.oninput = (e) => {
      bus.emit("ver:search", { keyword: e.target.value });
    };
  }
}

// 绑定底部按钮
export function bindFooter(root) {
  const btn = root.getElementById("btn-mc");
  if (btn) {
    btn.onclick = () => bus.emit("dir:select-mc");
  }
}

// 绑定 bus 事件（实例数更新）
export function bindBusUpdates(root, unsubs) {
  unsubs.push(
    bus.on("versions:updated", ({ instances }) => {
      const statEl = root.getElementById("ver-stat");
      if (statEl) statEl.textContent = `${instances.length}个整合包`;
    })
  );
}
