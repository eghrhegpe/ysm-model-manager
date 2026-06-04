// ===== 树事件层（只负责绑定事件，不生成 HTML） =====
import { bus } from "../../bus.js";
import { flashBtn } from "./utils.js";
import {
  ToggleModelEnable,
  ScanModelEntries,
  IsFileBanned,
  OpenFolder,
  LoadAppConfig,
} from "../../../wailsjs/go/main/App.js";

// 绑定树节点事件（每次 _renderTree 后调用）
export function bindTreeEvents(container, vm) {
  // 文件夹展开/折叠
  container.querySelectorAll(".fh").forEach((el) => {
    el.addEventListener("click", (e) => {
      // 如果点击目标是开关，不触发展开/折叠
      if (e.target.closest(".ck")) return;
      e.stopPropagation();
      const ch = el.nextElementSibling;
      const ar = el.querySelector(".ar");
      if (!ch) return;
      const open = ch.style.display !== "none";
      ch.style.display = open ? "none" : "block";
      ar.textContent = open ? "▸" : "▾";
      vm._dirOpen[el.dataset.dir] = !open;
      localStorage.setItem("at_dirs", JSON.stringify(vm._dirOpen));
    });
  });

  // 文件夹开关
  container.querySelectorAll(".fh .ck").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFolderBatch(el.closest(".fh"), vm);
    });
  });

  // 文件开关
  container.querySelectorAll(".fl .ck").forEach((el) => {
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      const fullPath = el.dataset.fullpath || el.dataset.path;
      const wasOn = el.classList.contains("on");
      // 视觉上立即切换
      el.classList.toggle("on");
      const fl = el.closest(".fl");
      if (fl) fl.classList.add("flash");
      setTimeout(() => fl?.classList.remove("flash"), 400);
      try {
        await ToggleModelEnable(fullPath);
        await vm._load();
        vm._renderTree();
        bus.emit("stats:refresh");
      } catch (_) {
        // 失败则恢复
        el.classList.toggle("on");
      }
    });
  });

  // 文件夹右键菜单
  container.querySelectorAll(".fh").forEach((el) => {
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      bus.emit("ctx:show", {
        x: e.clientX,
        y: e.clientY,
        type: "dir",
        dir: el.dataset.dir,
      });
    });
  });

  // 左键点击文件 → 显示模型详情
  container.querySelectorAll(".fl").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".ck")) return;
      e.stopPropagation();
      const fullPath = el.dataset.fullpath || el.dataset.path;
      bus.emit("model:select", { path: fullPath });
    });
  });

  // 文件右键菜单
  container.querySelectorAll(".fl").forEach((el) => {
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const banned = !el.querySelector(".ck")?.classList.contains("on");
      const fullPath = el.dataset.fullpath || el.dataset.path;
      const nameEl = el.querySelector(".nm");
      const name = nameEl?.textContent?.replace(/^\S+\s/, "") || "";
      bus.emit("ctx:show", {
        x: e.clientX,
        y: e.clientY,
        type: "file",
        path: fullPath,
        banned,
        name,
      });
    });
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

  // 批量管理下拉
  const dd = root.getElementById("batch-dropdown");
  const trigger = root.getElementById("btn-batch-trigger");
  const menu = root.getElementById("batch-menu");
  if (dd && trigger && menu) {
    trigger.onclick = (e) => {
      e.stopPropagation();
      menu.style.display = menu.style.display === "none" ? "block" : "none";
    };
    // 点击菜单项后关闭
    menu.querySelectorAll(".batch-item").forEach((btn) => {
      btn.onclick = () => {
        menu.style.display = "none";
      };
    });
    // 点击外部关闭
    document.addEventListener("click", (e) => {
      if (!dd.contains(e.target)) menu.style.display = "none";
    });
  }

  $("btn-ea")?.addEventListener("click", async () => {
    flashBtn($("btn-ea"));
    bus.emit("batch:enable-all");
  });

  $("btn-da")?.addEventListener("click", async () => {
    flashBtn($("btn-da"));
    bus.emit("batch:disable-all");
  });
}

/** 点击文件夹开关：递归切换该文件夹及子文件夹下所有文件的启用/禁用状态 */
async function toggleFolderBatch(fhEl, vm) {
  const ck = fhEl.querySelector(".ck");
  if (!ck) return;
  const dirKey = fhEl.dataset.dir;
  if (!dirKey) return;

  const prefix = dirKey.replace(/\\/g, "/");
  const targets = collectDirEntries(vm._entries, prefix);
  if (!targets.length) {
    console.warn("toggleFolderBatch: 未匹配到任何文件", {
      dirKey,
      prefix,
      entriesCount: vm._entries?.length,
    });
    return;
  }

  // 核心：识别文件夹当前整体状态，决定翻转方向
  // 全启用 → 全部禁用；其他情况（全禁用或混合）→ 全部启用
  const allEnabled = targets.every((e) => !e.banned);
  const enable = allEnabled ? false : true;

  let ok = 0,
    fail = 0;
  for (const e of targets) {
    // 只翻转那些不处于目标状态的文件
    if (e.banned === !enable) continue;
    try {
      await ToggleModelEnable(e.fullPath);
      ok++;
    } catch (_) {
      fail++;
    }
  }
  if (ok > 0) {
    await vm._load();
    vm._renderTree();
    bus.emit("stats:refresh");
  }
  bus.emit("toast:show", {
    msg: `文件夹${enable ? "启用" : "禁用"}: ${ok} 成功, ${fail} 失败`,
    duration: 5000,
    type: fail > 0 ? "warn" : "success",
  });
}

/** 递归收集某个目录下的所有条目 */
function collectDirEntries(entries, prefix) {
  const result = [];
  for (const e of entries) {
    if (!e.path) continue;
    const normalized = e.path.replace(/\\/g, "/");
    if (normalized === prefix || normalized.startsWith(prefix + "/")) {
      result.push(e);
    }
  }
  return result;
}
