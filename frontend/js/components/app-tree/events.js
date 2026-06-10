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

  // 悬停快捷操作：🔍 B站搜索作者
  container.querySelectorAll(".ha-preview").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const path = btn.dataset.path;
      const name = path?.split(/[/\\]/).pop() || "";
      const { parseModelName } = await import("../../utils/display.js");
      const { author } = parseModelName(name);
      if (author) {
        window.open(
          "https://search.bilibili.com/all?keyword=" +
            encodeURIComponent(author),
          "_blank",
        );
      } else {
        bus.emit("toast:show", {
          msg: "未解析到作者名",
          duration: 2000,
          type: "warn",
        });
      }
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
  const closeDD = () => {
    clearTimeout(ddTimer);
    ddTimer = null;
    root
      .querySelectorAll(".dd-menu.show")
      .forEach((m) => m.classList.remove("show"));
  };

  // 搜索/排序
  $("srch")?.addEventListener("input", (e) => {
    vm._search = e.target.value;
    r();
  });
  $("sort")?.addEventListener("change", (e) => {
    vm._sort = e.target.value;
    r();
  });

  // ---- 下拉菜单统一管理 ----
  let ddTimer = null;
  function openDD(menu, btn, fn) {
    closeDD();
    if (!menu) return;
    fn(menu);
    menu.classList.add("show");
    if (btn) btn.textContent = btn.textContent.replace("▾", "") + "▾";
  }
  document.addEventListener("click", closeDD);

  // 给按钮添加悬停 330ms 自动打开
  function addHoverDD(btn, menu, openFn) {
    if (!btn || !menu) return;
    const wrap = menu.parentNode;
    btn.addEventListener("mouseenter", () => {
      clearTimeout(ddTimer);
      ddTimer = setTimeout(() => {
        if (!menu.classList.contains("show")) {
          closeDD();
          openFn(menu);
          menu.classList.add("show");
        }
      }, 330);
    });
    btn.addEventListener("mouseleave", () => {
      clearTimeout(ddTimer);
    });
    // 外层 wrap 统一处理离开关闭
    wrap.addEventListener("mouseleave", (e) => {
      if (wrap.contains(e.relatedTarget)) return;
      ddTimer = setTimeout(closeDD, 270);
    });
    wrap.addEventListener("mouseenter", () => {
      clearTimeout(ddTimer);
    });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (menu.classList.contains("show")) {
        closeDD();
        return;
      }
      openFn(menu);
      menu.classList.add("show");
    });
  }

  // 作者下拉
  const menuAuthors = $("menu-authors");
  addHoverDD($("btn-authors"), menuAuthors, (menu) => {
    const authors = window._treeAuthors || [];
    if (!authors.length) {
      menu.innerHTML =
        "<div style='padding:8px;font-size:9px;color:var(--muted)'>无作者数据</div>";
      return;
    }
    menu.innerHTML = authors
      .map((a) => `<button class="dd-item" data-author="${a}">🎨 ${a}</button>`)
      .join("");
    menu.querySelectorAll(".dd-item").forEach((el) => {
      el.addEventListener("click", () => {
        const srch = root.getElementById("srch");
        if (!srch) return;
        const a = el.dataset.author;
        srch.value = srch.value === "[" + a + "]" ? "" : "[" + a + "]";
        srch.dispatchEvent(new Event("input"));
        closeDD();
      });
    });
  });

  // 纹理下拉
  const texOpts = [
    { label: "任意", val: "" },
    { label: "64×64", val: "64" },
    { label: "128×128", val: "128" },
    { label: "256×256", val: "256" },
    { label: "512×512", val: "512" },
    { label: "1024×1024", val: "1024" },
  ];
  const menuTex = $("menu-tex");
  addHoverDD($("btn-tex"), menuTex, (menu) => {
    menu.innerHTML = texOpts
      .map(
        (t) =>
          `<button class="dd-item" data-val="${t.val}">${t.label}</button>`,
      )
      .join("");
    menu.querySelectorAll(".dd-item").forEach((el) => {
      el.addEventListener("click", () => {
        const val = el.dataset.val;
        $("btn-tex").textContent = val ? `📐 ${val}×${val} ▾` : "📐 纹理 ▾";
        closeDD();
        bus.emit("tree:run-filter");
      });
    });
  });

  // 批量下拉（用 dd-wrap 包裹按钮+菜单）
  const batchBtn = $("btn-batch");
  const batchWrap = document.createElement("div");
  batchWrap.className = "dd-wrap";
  batchWrap.style.display = "inline-block";
  const menuBatch = document.createElement("div");
  menuBatch.className = "dd-menu batch-menu";
  menuBatch.id = "menu-batch";
  batchBtn?.parentNode.insertBefore(batchWrap, batchBtn);
  batchWrap.appendChild(batchBtn);
  batchWrap.appendChild(menuBatch);
  addHoverDD(batchBtn, menuBatch, (menu) => {
    menu.innerHTML = `<button class="dd-item" id="batch-ea-dd">✅ 全部启用</button><button class="dd-item" id="batch-da-dd">⛔ 全部禁用</button>`;
    menu.querySelector("#batch-ea-dd")?.addEventListener("click", () => {
      bus.emit("batch:enable-all");
      closeDD();
    });
    menu.querySelector("#batch-da-dd")?.addEventListener("click", () => {
      bus.emit("batch:disable-all");
      closeDD();
    });
  });

  // 筛选：动态创建/移除
  $("btn-filter-toggle")?.addEventListener("click", () => {
    const c = root.getElementById("hdr-container");
    if (!c) return;
    // 如果批量已展开，先关掉
    if (c.children.length > 0 && !c.querySelector(".filter-bar")) {
      c.innerHTML = "";
      $("btn-batch").textContent = "⚡ 批量";
    }
    if (c.querySelector(".filter-bar")) {
      c.innerHTML = "";
      $("btn-filter-toggle").textContent = "🔍 筛选";
      return;
    }
    c.innerHTML = renderFilterHTML();
    $("btn-filter-toggle").textContent = "🔍 筛选 ▾";
    // 绑定筛选输入
    const inputs = c.querySelectorAll("input, select");
    let ft;
    inputs.forEach((el) => {
      el.addEventListener("input", () => {
        clearTimeout(ft);
        ft = setTimeout(() => runFilter(root), 300);
      });
      el.addEventListener("change", () => {
        clearTimeout(ft);
        ft = setTimeout(() => runFilter(root), 300);
      });
    });
    runFilter(root);
  });

  // 筛选事件（纹理/等外部触发）
  vm._unsubs.push(bus.on("tree:run-filter", () => runFilter(root)));

  // 生成索引
  $("repo-genindex")?.addEventListener("click", async () => {
    const btn = $("repo-genindex");
    btn.textContent = "⏳";
    try {
      const { LoadAppConfig, GenerateRepoIndex } =
        await import("../../../wailsjs/go/main/App.js");
      const cfg = await LoadAppConfig();
      if (!cfg.repoRoot) {
        bus.emit("toast:show", {
          msg: "请先在设置中配置仓库目录",
          duration: 2000,
          type: "warn",
        });
        btn.textContent = "📇 索引";
        return;
      }
      await GenerateRepoIndex(cfg.repoRoot);
      bus.emit("toast:show", {
        msg: "✅ index.json 已生成",
        duration: 3000,
        type: "success",
      });
      btn.textContent = "✅";
      setTimeout(() => {
        btn.textContent = "📇 索引";
      }, 3000);
    } catch (e) {
      bus.emit("toast:show", {
        msg: "❌ 索引失败: " + String(e),
        duration: 4000,
        type: "error",
      });
      btn.textContent = "📇 索引";
    }
  });

  $("btn-repo")?.addEventListener("click", () => bus.emit("navigate:settings"));
  $("btn-dedup")?.addEventListener("click", () => bus.emit("entries:dedup"));
  $("btn-trash")?.addEventListener("click", () => bus.emit("recycle:open"));
  $("btn-pv")?.addEventListener("click", () => bus.emit("preview:toggle"));
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

/** 生成筛选栏 HTML（仅骨骼/立方体，作者已移至下拉菜单） */
function renderFilterHTML() {
  return `<div class="filter-bar hdr" style="padding:4px 12px;border-bottom:1px solid var(--bd);display:flex;gap:3px;flex-wrap:wrap;align-items:center">
    <input id="filter-bones-min" class="srch-inp" type="number" min="0" placeholder="🦴 骨骼≥" style="width:60px;font-size:9px">
    <input id="filter-bones-max" class="srch-inp" type="number" min="0" placeholder="骨骼≤" style="width:60px;font-size:9px">
    <input id="filter-cubes-min" class="srch-inp" type="number" min="0" placeholder="📦 立方≥" style="width:60px;font-size:9px">
    <input id="filter-cubes-max" class="srch-inp" type="number" min="0" placeholder="立方≤" style="width:60px;font-size:9px">
    <span id="filter-count" style="font-size:9px;color:var(--muted)"></span>
  </div>`;
}

/** 执行高级筛选 */
async function runFilter(root) {
  try {
    const kw = root.getElementById("srch")?.value || "";
    const minB = parseInt(root.getElementById("filter-bones-min")?.value) || 0;
    const maxB = parseInt(root.getElementById("filter-bones-max")?.value) || 0;
    const minC = parseInt(root.getElementById("filter-cubes-min")?.value) || 0;
    const maxC = parseInt(root.getElementById("filter-cubes-max")?.value) || 0;
    const texVal =
      root.getElementById("btn-tex")?.textContent?.match(/(\d+)×/)?.[1] || "";
    const minT = texVal ? parseInt(texVal) : 0;
    const maxT = texVal ? parseInt(texVal) : 0;
    const countEl = root.getElementById("filter-count");

    // 无筛选条件时跳过
    if (!kw && !minB && !maxB && !minC && !maxC && !texVal) {
      if (countEl) countEl.textContent = "";
      bus.emit("filter:results", null);
      return;
    }

    const { LoadAppConfig, SearchModels } =
      await import("../../../wailsjs/go/main/App.js");
    const cfg = await LoadAppConfig();
    if (!cfg.repoRoot) {
      if (countEl) countEl.textContent = "⚠️ 未设置仓库";
      return;
    }

    if (countEl) countEl.textContent = "⏳";
    const results = await SearchModels(
      cfg.repoRoot,
      kw,
      minB,
      maxB,
      minC,
      maxC,
      minT,
      maxT,
    );
    if (countEl)
      countEl.textContent = results?.length
        ? `✅ ${results.length} 结果`
        : "❌ 无匹配";

    // 通知 tree 刷新显示（用 fullPath 或 path 匹配 entries）
    bus.emit("filter:results", results || []);
    // 同时通知搜索框：切换筛选模式后主动关闭筛选面板
    if (!results || !results.length) {
      // 无结果时不清除 _filterPaths，保留空结果
    }
  } catch (e) {
    console.warn("[filter]", e);
    const countEl = root.getElementById("filter-count");
    if (countEl) countEl.textContent = "❌ 失败";
  }
}
