// ===== 树事件层（只负责绑定事件，不生成 HTML） =====
import { bus } from "../../bus.js";
import { flashBtn } from "./utils.js";
import { selectState, toggleSelect } from "./data.js";
import { updateStat } from "./render.js";

function updateSelectCount(root) {
  const stat = root?.getElementById("ftr-stat");
  if (!stat) return;
  const n = selectState.keys.size;
  if (n > 0) {
    stat.textContent = `已选 ${n} 个文件`;
    stat.style.color = "var(--accent)";
  } else {
    stat.style.color = "";
    // 让 updateStat 恢复原文
  }
}
import {
  ToggleModelEnable,
  ScanModelEntries,
  IsFileBanned,
  OpenFolder,
  LoadAppConfig,
} from "../../../wailsjs/go/main/App.js";

const ENABLE_MULTI_SELECT = true; // Feature Flag

// 绑定树节点事件（每次 _renderTree 后调用）
export function bindTreeEvents(container, vm) {
  // 文件夹展开/折叠 + 预览整合包信息
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
      // 通知预览面板显示整合包信息
      bus.emit("model:select", { path: el.dataset.dir, isDir: true });
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
        bus.emit("sync:toggle-status");
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

  // 左键点击文件 → 多选（Ctrl/Shift）或显示模型详情
  container.querySelectorAll(".fl").forEach((el) => {
    el.addEventListener("click", (e) => {
      // 忽略右键（仅处理左键，防止右键触发清空选中）
      if (e.button !== 0) return;
      if (e.target.closest(".ck")) return;
      e.stopPropagation();
      const fullPath = el.dataset.fullpath || el.dataset.path;

      if (ENABLE_MULTI_SELECT) {
        const isCtrl = e.ctrlKey || e.metaKey;
        const isShift = e.shiftKey;

        if (isShift) {
          e.preventDefault();
          // Shift 阻止浏览器默认文本选中
          document.getSelection()?.removeAllRanges();
          if (!selectState.lastKey) return;
          const allPaths = Array.from(container.querySelectorAll(".fl"))
            .map((el) => el.dataset.fullpath || el.dataset.path)
            .filter(Boolean);
          const startIdx = allPaths.indexOf(selectState.lastKey);
          const endIdx = allPaths.indexOf(fullPath);
          if (startIdx !== -1 && endIdx !== -1) {
            const [min, max] = [
              Math.min(startIdx, endIdx),
              Math.max(startIdx, endIdx),
            ];
            for (let i = min; i <= max; i++) {
              selectState.keys.add(allPaths[i]);
            }
          }
          selectState.lastKey = fullPath;
          vm._renderTree();
          const freshTree2 = vm._root?.getElementById("tree");
          freshTree2?.querySelectorAll(".fl").forEach((el) => {
            const p = el.dataset.fullpath || el.dataset.path;
            if (selectState.keys.has(p)) el.classList.add("selected");
          });
          updateSelectCount(vm._root);
          return;
        }

        if (isCtrl) {
          toggleSelect(fullPath, false);
          vm._renderTree();
          // 重新应用高亮：用 vm._root 重新查，避免闭包 container 过时
          const freshTree = vm._root?.getElementById("tree");
          freshTree?.querySelectorAll(".fl").forEach((el) => {
            const p = el.dataset.fullpath || el.dataset.path;
            if (selectState.keys.has(p)) el.classList.add("selected");
          });
          updateSelectCount(vm._root);
          return;
        }

        // 纯单击：清空旧选中，蓝底高亮当前文件
        selectState.keys.clear();
        selectState.lastKey = null;
        selectState.keys.add(fullPath);
        selectState.lastKey = fullPath;
        vm._renderTree();
        const freshTree3 = vm._root?.getElementById("tree");
        freshTree3?.querySelectorAll(".fl").forEach((el) => {
          const p = el.dataset.fullpath || el.dataset.path;
          if (selectState.keys.has(p)) el.classList.add("selected");
        });
        updateSelectCount(vm._root);
      }

      bus.emit("model:select", { path: fullPath });
    });
  });

  // 文件右键菜单（支持多选）
  container.querySelectorAll(".fl").forEach((el) => {
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const fullPath = el.dataset.fullpath || el.dataset.path;
      const nameEl = el.querySelector(".nm");
      const name = nameEl?.textContent?.replace(/^\S+\s/, "") || "";

      // 从 DOM 直接获取选中数量（比 selectState.keys 更可靠）
      const selectedEls = Array.from(
        container.querySelectorAll(".fl.selected"),
      );
      const selectedPaths = selectedEls
        .map((el) => el.dataset.fullpath || el.dataset.path)
        .filter(Boolean);

      // 如果当前文件没被选中但其他文件选中了，把它也加入选中集
      if (selectedPaths.length > 0 && !selectedPaths.includes(fullPath)) {
        selectedPaths.push(fullPath);
        el.classList.add("selected");
      }

      const multiCount = Math.max(selectedPaths.length, selectState.keys.size);
      if (ENABLE_MULTI_SELECT && multiCount > 1) {
        // 同步到 selectState.keys（确保后续操作一致）
        selectedPaths.forEach((p) => selectState.keys.add(p));
        selectState.lastKey = fullPath;
        bus.emit("ctx:show", {
          x: e.clientX,
          y: e.clientY,
          type: "batch",
          count: multiCount,
          paths: selectedPaths,
        });
        return;
      }

      // 单个文件菜单
      const banned = !el.querySelector(".ck")?.classList.contains("on");
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

  // 悬停快捷操作：🔍 预览
  container.querySelectorAll(".ha-preview").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const path = btn.dataset.path;
      if (path) bus.emit("model:select", { path });
    });
  });

  // 悬停快捷操作：📋 复制文件名
  container.querySelectorAll(".ha-copy").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const path = btn.dataset.path;
      const name = path?.split(/[/\\]/).pop() || "";
      navigator.clipboard?.writeText(name).catch(() => {});
      bus.emit("toast:show", {
        msg: "📋 已复制: " + name,
        duration: 1500,
        type: "info",
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
    bus.emit("sync:toggle-status");
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
