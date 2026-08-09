// ===== 树事件层（事件委托版，兼容虚拟滚动） =====
import { bus } from "../../bus.ts";
import { selectState, toggleSelect, selectOnly } from "./data.ts";
import type { AppTree } from "./index.ts";
import type { TreeEntry } from "./loader.ts";
import { getApp } from "../../wails/app.ts";

const ENABLE_MULTI_SELECT = true;

// 更新底部"已选 N 个文件"统计（被工具栏复用，避免重复实现）
export function updateSelectCount(root: ShadowRoot): void {
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
function collectDirEntries(
  entries: TreeEntry[],
  prefix: string,
): TreeEntry[] {
  const result: TreeEntry[] = [];
  for (const e of entries) {
    if (!e.path) continue;
    const normalized = e.path.replace(/\\/g, "/");
    if (normalized === prefix || normalized.startsWith(prefix + "/")) {
      result.push(e);
    }
  }
  return result;
}

async function toggleFolderBatch(fhEl: HTMLElement, vm: AppTree): Promise<void> {
  if (vm._batchBusy || vm._toggleBusy) return; // 并发守卫：与单文件/批量 toggle 共用槽位，防重叠循环
  vm._batchBusy = true;
  try {
  const { ToggleModelEnable } = await getApp();
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
    } catch (err) {
      fail++;
      console.warn("[tree] toggleFolderBatch 失败:", e.fullPath, err);
    }
  }
  if (ok > 0) {
    // 直接更新本地 banned 状态（ScanModelEntries 有 30s 缓存，_load 会拿到旧数据）
    for (const e of targets) {
      if (!e.banned && !enable) e.banned = true;
      else if (e.banned && enable) e.banned = false;
    }
    vm._renderTree();
    bus.emit("sync:toggle:status");
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
  } finally {
    vm._batchBusy = false;
  }
}

// ——— 事件委托：一次性绑定，虚拟滚动替换 innerHTML 后仍然有效 ———
export function bindTreeEvents(container: HTMLElement, vm: AppTree): void {
  // 点击事件委托
  container.addEventListener("click", (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    // 文件夹开关
    const fhCk = target.closest(".fh .ck");
    if (fhCk) {
      e.stopPropagation();
      toggleFolderBatch(fhCk.closest(".fh") as HTMLElement, vm);
      return;
    }

    // 文件夹展开/折叠
    const fh = target.closest(".fh") as HTMLElement | null;
    if (fh) {
      e.stopPropagation();
      const dir = fh.dataset.dir;
      if (!dir) return;
      const isOpen = vm._dirOpen[dir];
      vm._dirOpen[dir] = !isOpen;
      // 折叠父文件夹时递归清除所有子文件夹的展开状态
      if (isOpen) {
        const prefix = (dir + "/").replace(/\\/g, "/");
        for (const key of Object.keys(vm._dirOpen)) {
          const nk = key.replace(/\\/g, "/");
          if (nk !== dir && nk.startsWith(prefix)) delete vm._dirOpen[key];
        }
      }
      localStorage.setItem("at_dirs", JSON.stringify(vm._dirOpen));
      vm._renderTree();
      // 折叠时通知预览清空；展开时通知预览显示整合包
      if (!isOpen) {
        bus.emit("model:select", { path: dir, isDir: true });
      }
      return;
    }

    // 文件开关
    const flCk = target.closest(".fl .ck") as HTMLElement | null;
    if (flCk) {
      e.stopPropagation();
      // 并发守卫：与批量 toggle 共用槽位，防连点翻转状态 + reload 竞态
      if (vm._toggleBusy || vm._batchBusy) return;
      vm._toggleBusy = true;
      const fullPath = flCk.dataset.fullpath || flCk.dataset.path;
      const fl = flCk.closest(".fl") as HTMLElement | null;
      if (fl) fl.classList.add("flash");
      setTimeout(() => fl?.classList.remove("flash"), 400);
      getApp()
        .then(({ ToggleModelEnable }) => ToggleModelEnable(fullPath || ""))
        .then(async () => {
          await vm._load();
          vm._renderTree();
          bus.emit("sync:toggle:status");
          bus.emit("stats:refresh");
        })
        .catch((err) => {
          console.warn("[tree] ToggleModelEnable 失败:", fullPath, err);
          bus.emit("toast:show", {
            msg:
              "❌ 切换失败: " +
              (fullPath ? fullPath.split(/[/\\]/).pop() : ""),
            duration: 3000,
            type: "error",
          });
        })
        .finally(() => {
          vm._toggleBusy = false;
        });
      return;
    }

    // 悬停快捷操作（在文件选中前检查，因为它们也在 .fl 内部）
    const haPreview = target.closest(".ha-preview") as HTMLElement | null;
    if (haPreview) {
      e.stopPropagation();
      const path = haPreview.dataset.path;
      const name = path?.split(/[/\\]/).pop() || "";
      import("../../utils/dom/display.ts").then(({ parseModelName }) => {
        const { author } = parseModelName(name);
        if (author) {
          getApp()
            .then(({ OpenInBrowser }) =>
              OpenInBrowser(
                "https://search.bilibili.com/all?keyword=" +
                  encodeURIComponent(author),
              ),
            )
            .catch((err) => {
              console.warn("[tree] OpenInBrowser 失败:", err);
              bus.emit("toast:show", {
                msg: "❌ 打开浏览器失败",
                duration: 3000,
                type: "error",
              });
            });
        } else {
          bus.emit("toast:show", {
            msg: "未解析到作者名",
            duration: 2000,
            type: "warn",
          });
        }
      }).catch((err) => {
        console.warn("[tree] 加载 display 模块失败:", err);
        bus.emit("toast:show", {
          msg: "❌ 加载解析模块失败",
          duration: 3000,
          type: "error",
        });
      });
      return;
    }

    // 悬停快捷操作：📋 复制文件名
    const haCopy = target.closest(".ha-copy") as HTMLElement | null;
    if (haCopy) {
      e.stopPropagation();
      const path = haCopy.dataset.path;
      const name = path?.split(/[/\\]/).pop() || "";
      // P3 修复：与 skeleton 复制按钮同源——剪贴板写入失败不假成功
      navigator.clipboard
        ?.writeText(name)
        .then(() => {
          bus.emit("toast:show", {
            msg: "📋 已复制: " + name,
            duration: 1500,
            type: "info",
          });
        })
        .catch(() => {
          bus.emit("toast:show", {
            msg: "❌ 复制失败",
            duration: 2000,
            type: "error",
          });
        });
      return;
    }

    // 左键点击文件 → 多选
    const fl = target.closest(".fl") as HTMLElement | null;
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
        toggleSelect(fullPath);
        vm._renderTree();
        updateSelectCount(vm._root);
        return;
      }

      // 纯单击（收敛到 data.ts 的方法，避免外部直接写 selectState）
      selectOnly(fullPath);
      vm._renderTree();
      updateSelectCount(vm._root);
      bus.emit("model:select", { path: fullPath });
      return;
    }
  });

  // 右键事件委托
  container.addEventListener("contextmenu", (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const fh = target.closest(".fh") as HTMLElement | null;
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

    const fl = target.closest(".fl") as HTMLElement | null;
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
        selectedPaths.includes(fullPath || "")
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
        path: fullPath || "",
        banned,
        name,
      });
    }
  });
}
