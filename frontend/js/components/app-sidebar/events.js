// ===== sidebar 事件层 =====

// 绑定每个卡片展开/折叠
export function bindCardEvents(root) {
  // 先清掉旧的右键容器（防止重复）
  root.querySelectorAll(".vc-context-menu").forEach((el) => el.remove());

  root.querySelectorAll(".vc").forEach((vc) => {
    const hdr = vc.querySelector(".vc-header");
    const body = vc.nextElementSibling;
    if (!hdr || !body || !body.classList.contains("vc-body")) return;

    // 点击标题头：展开/折叠
    hdr.onclick = () => {
      const arrow = hdr.querySelector(".arrow");
      body.style.display = body.style.display === "none" ? "" : "none";
      if (arrow) arrow.classList.toggle("open");
    };

    // 右键菜单
    hdr.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const nameEl = hdr.querySelector(".name");
      const name = nameEl ? nameEl.textContent.replace(/^📦\s*/, "") : "";
      bus.emit("ctx:show", {
        x: e.clientX,
        y: e.clientY,
        type: "instance",
        instanceName: name,
      });
    };
  });
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
    }),
  );
}
