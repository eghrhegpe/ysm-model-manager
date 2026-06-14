// ===== 树事件层（事件委托版，兼容虚拟滚动） =====
import { bus } from "../../bus.js";
import { selectState, toggleSelect } from "./data.js";
import { updateStat } from "./render.js";
import {
  ToggleModelEnable,
  ScanModelEntries,
  IsFileBanned,
  OpenFolder,
  LoadAppConfig,
} from "../../../wailsjs/go/main/App.js";

const ENABLE_MULTI_SELECT = true;

function updateSelectCount(root) {
  const stat = root?.getElementById("ftr-stat");
  if (!stat) return;
  const n = selectState.keys.size;
  if (n > 0) {
    stat.textContent = "已选 " + n + " 个文件";
    stat.style.color = "var(--accent)";
  } else {
    stat.style.color = "";
  }
}

// 递归收集文件夹下所有条目
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

async function toggleFolderBatch(fhEl, vm) {
  const ck = fhEl.querySelector(".ck");
  if (!ck) return;
  const dirKey = fhEl.dataset.dir;
  if (!dirKey) return;
  const prefix = dirKey.replace(/\\/g, "/");
  const targets = collectDirEntries(vm._entries, prefix);
  if (!targets.length) return;
  const allEnabled = targets.every((e) => !e.banned);
  const enable = allEnabled ? false : true;
  let ok = 0,
    fail = 0;
  for (const e of targets) {
    if (e.banned === !enable) continue;
    try {
      await ToggleModelEnable(e.fullPath);
      ok++;
    } catch (_) {
      fail++;
    }
  }
  if (ok > 0) {
    // 直接更新本地 banned 状态（ScanModelEntries 有 30s 缓存，_load 会拿到旧数据）
    for (const e of targets) {
      if (!e.banned && !enable) e.banned = true;
      else if (e.banned && enable) e.banned = false;
    }
    vm._renderTree();
    bus.emit("sync:toggle-status");
  }
  bus.emit("toast:show", {
    msg:
      "文件夹" +
      (enable ? "启用" : "禁用") +
      ": " +
      ok +
      " 成功, " +
      fail +
      " 失败",
    duration: 5000,
    type: fail > 0 ? "warn" : "success",
  });
}

// ——— 事件委托：一次性绑定，虚拟滚动替换 innerHTML 后仍然有效 ———
export function bindTreeEvents(container, vm) {
  // 点击事件委托
  container.addEventListener("click", (e) => {
    // 文件夹开关
    const fhCk = e.target.closest(".fh .ck");
    if (fhCk) {
      e.stopPropagation();
      toggleFolderBatch(fhCk.closest(".fh"), vm);
      return;
    }

    // 文件夹展开/折叠
    const fh = e.target.closest(".fh");
    if (fh) {
      e.stopPropagation();
      const dir = fh.dataset.dir;
      if (!dir) return;
      const isOpen = vm._dirOpen[dir];
      vm._dirOpen[dir] = !isOpen;
      localStorage.setItem("at_dirs", JSON.stringify(vm._dirOpen));
      vm._renderTree();
      // 折叠时通知预览清空；展开时通知预览显示整合包
      if (!isOpen) {
        bus.emit("model:select", { path: dir, isDir: true });
      }
      return;
    }

    // 文件开关
    const flCk = e.target.closest(".fl .ck");
    if (flCk) {
      e.stopPropagation();
      const fullPath = flCk.dataset.fullpath || flCk.dataset.path;
      const fl = flCk.closest(".fl");
      if (fl) fl.classList.add("flash");
      setTimeout(() => fl?.classList.remove("flash"), 400);
      ToggleModelEnable(fullPath)
        .then(async () => {
          await vm._load();
          vm._renderTree();
          bus.emit("sync:toggle-status");
        })
        .catch(() => {});
      return;
    }

    // 左键点击文件 → 多选
    const fl = e.target.closest(".fl");
    if (fl && e.button === 0) {
      e.stopPropagation();
      const fullPath = fl.dataset.fullpath || fl.dataset.path;
      if (!fullPath) return;

      const isCtrl = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;

      if (isShift) {
        e.preventDefault();
        document.getSelection()?.removeAllRanges();
        if (!selectState.lastKey) return;
        const allPaths = (container._vsRows || [])
          .filter((r) => r.type === "file")
          .map((r) => r.key);
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
        updateSelectCount(vm._root);
        return;
      }

      if (isCtrl) {
        toggleSelect(fullPath, false);
        vm._renderTree();
        updateSelectCount(vm._root);
        return;
      }

      // 纯单击
      selectState.keys.clear();
      selectState.lastKey = null;
      selectState.keys.add(fullPath);
      selectState.lastKey = fullPath;
      vm._renderTree();
      updateSelectCount(vm._root);
      bus.emit("model:select", { path: fullPath });
      return;
    }

    // 悬停快捷操作：🔍 B站搜索
    const haPreview = e.target.closest(".ha-preview");
    if (haPreview) {
      e.stopPropagation();
      const path = haPreview.dataset.path;
      const name = path?.split(/[/\\]/).pop() || "";
      import("../../utils/display.js").then(({ parseModelName }) => {
        const { author } = parseModelName(name);
        if (author) {
          import("../../../wailsjs/go/main/App.js").then(({ OpenInBrowser }) =>
            OpenInBrowser("https://search.bilibili.com/all?keyword=" +
              encodeURIComponent(author)),
          );
        } else {
          bus.emit("toast:show", {
            msg: "未解析到作者名",
            duration: 2000,
            type: "warn",
          });
        }
      });
      return;
    }

    // 悬停快捷操作：📋 复制文件名
    const haCopy = e.target.closest(".ha-copy");
    if (haCopy) {
      e.stopPropagation();
      const path = haCopy.dataset.path;
      const name = path?.split(/[/\\]/).pop() || "";
      navigator.clipboard?.writeText(name).catch(() => {});
      bus.emit("toast:show", {
        msg: "📋 已复制: " + name,
        duration: 1500,
        type: "info",
      });
    }
  });

  // 右键事件委托
  container.addEventListener("contextmenu", (e) => {
    const fh = e.target.closest(".fh");
    if (fh) {
      e.preventDefault();
      e.stopPropagation();
      bus.emit("ctx:show", {
        x: e.clientX,
        y: e.clientY,
        type: "dir",
        dir: fh.dataset.dir,
      });
      return;
    }

    const fl = e.target.closest(".fl");
    if (fl) {
      e.preventDefault();
      e.stopPropagation();
      const fullPath = fl.dataset.fullpath || fl.dataset.path;
      const nameEl = fl.querySelector(".nm");
      const name = nameEl?.textContent?.replace(/^\S+\s/, "") || "";

      // 获取当前选中的文件路径列表
      const selectedPaths = (container._vsRows || [])
        .filter((r) => r.type === "file" && selectState.keys.has(r.key))
        .map((r) => r.key);

      // 如果右键的文件已在选中集中，显示多选菜单；否则只显示单文件菜单
      // 右键绝不修改选中状态
      if (
        ENABLE_MULTI_SELECT &&
        selectedPaths.length > 0 &&
        selectedPaths.includes(fullPath)
      ) {
        bus.emit("ctx:show", {
          x: e.clientX,
          y: e.clientY,
          type: "batch",
          count: selectedPaths.length,
          paths: selectedPaths,
        });
        return;
      }

      // 单个文件菜单
      const banned = !fl.querySelector(".ck")?.classList.contains("on");
      bus.emit("ctx:show", {
        x: e.clientX,
        y: e.clientY,
        type: "file",
        path: fullPath,
        banned,
        name,
      });
    }
  });
}
