// ===== 树事件层（只负责绑定事件，不生成 HTML） =====
import { flashBtn } from "./utils.js";

// 绑定树节点事件（每次 _renderTree 后调用）
export function bindTreeEvents(container, vm) {
  // 文件夹展开/折叠
  container.querySelectorAll(".fh").forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      const ch = el.nextElementSibling;
      const ar = el.querySelector(".ar");
      if (!ch) return;
      const open = ch.style.display !== "none";
      ch.style.display = open ? "none" : "block";
      ar.classList.toggle("open", !open);
      vm._dirOpen[el.dataset.dir] = !open;
      localStorage.setItem("at_dirs", JSON.stringify(vm._dirOpen));
    };
  });

  // 复选框
  container.querySelectorAll(".ck").forEach((el) => {
    el.onclick = (ev) => {
      ev.stopPropagation();
      const wasOn = el.classList.contains("on");
      el.classList.toggle("on");
      el.textContent = el.classList.contains("on") ? "✓" : "";
      const fl = el.closest(".fl");
      if (fl) fl.classList.add("flash");
      setTimeout(() => fl?.classList.remove("flash"), 400);
      const path = el.dataset.path;
      const fullPath = el.dataset.fullpath || path;
      bus.emit("entry:toggle", {
        path: fullPath,
        relPath: path,
        enabled: !wasOn,
      });
    };
  });

  // 右键菜单
  container.querySelectorAll(".fl").forEach((el) => {
    el.oncontextmenu = (e) => {
      e.preventDefault();
      const nm =
        el.querySelector(".nm")?.textContent?.replace(/^\S+\s/, "") || "";
      const banned = !el.querySelector(".ck")?.classList.contains("on");
      const fullPath = el.dataset.fullpath || el.dataset.path;
      bus.emit("ctx:show", {
        x: e.clientX,
        y: e.clientY,
        path: fullPath,
        relPath: el.dataset.path,
        name: nm,
        banned,
      });
    };
  });
}

// 绑定工具栏事件（index.js 中 _renderLayout 后调用）
export function bindToolbarEvents(root, vm) {
  const $ = (id) => root.getElementById(id);
  const r = () => vm._renderTree();

  $("srch")?.addEventListener("input", (e) => {
    vm._search = e.target.value;
    r();
  });
  $("sort")?.addEventListener("change", (e) => {
    vm._sort = e.target.value;
    r();
  });
  $("btn-repo")?.addEventListener("click", () => bus.emit("dir:select-repo"));
  $("btn-dedup")?.addEventListener("click", () => bus.emit("entries:dedup"));
  $("btn-trash")?.addEventListener("click", () => bus.emit("recycle:open"));
  $("btn-pv")?.addEventListener("click", () => bus.emit("preview:toggle"));

  $("btn-ea")?.addEventListener("click", () => {
    flashBtn($("btn-ea"));
    vm._entries.forEach((e) => {
      e.banned = false;
    });
    r();
  });

  $("btn-da")?.addEventListener("click", () => {
    flashBtn($("btn-da"));
    vm._entries.forEach((e) => {
      e.banned = true;
    });
    r();
  });

  $("btn-st")?.addEventListener("click", () => flashBtn($("btn-st")));
}
