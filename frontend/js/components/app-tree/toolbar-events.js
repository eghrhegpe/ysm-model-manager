// ===== 工具栏事件 + 筛选逻辑 =====
// 从 events.js 拆分：工具栏按钮绑定、文件夹批处理、高级筛选
import { friendlyError } from "../../utils/errors.js";
import { bus } from "../../bus.js";
import { flashBtn } from "./utils.js";
import { spinnerHTML } from "./tpl.js";
import { getExts } from "../../utils/extensions.js";

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
  const { ToggleModelEnable } = await import("../../../wailsjs/go/main/App.js");
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
    msg: `文件夹${enable ? "启用" : "禁用"}: ${ok} 成功, ${fail} 失败`,
    duration: 5000,
    type: fail > 0 ? "warn" : "success",
  });
}

function renderFilterHTML() {
  return `<div class="filter-bar hdr" style="padding:4px 12px;border-bottom:1px solid var(--bd);display:flex;gap:3px;flex-wrap:wrap;align-items:center">
    <input id="filter-bones-min" class="srch-inp" type="number" min="0" placeholder="🦴 骨骼≥" style="width:60px;font-size:9px">
    <input id="filter-bones-max" class="srch-inp" type="number" min="0" placeholder="骨骼≤" style="width:60px;font-size:9px">
    <input id="filter-cubes-min" class="srch-inp" type="number" min="0" placeholder="📦 立方≥" style="width:60px;font-size:9px">
    <input id="filter-cubes-max" class="srch-inp" type="number" min="0" placeholder="立方≤" style="width:60px;font-size:9px">
    <span id="filter-count" style="font-size:9px;color:var(--muted)"></span>
  </div>`;
}

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
    if (!kw && !minB && !maxB && !minC && !maxC && !texVal) {
      if (countEl) countEl.textContent = "";
      bus.emit("filter:results", null);
      return;
    }
    const { LoadAppConfig } = await import("../../../wailsjs/go/main/App.js");
    const cfg = await LoadAppConfig();
    if (!cfg.repoRoot) {
      if (countEl) countEl.textContent = "⚠️ 未设置仓库";
      return;
    }
    if (countEl) countEl.textContent = "⏳";
    if (!kw && !minB && !maxB && !minC && !maxC && texVal) {
      const { GetModelTexSizes } =
        await import("../../../wailsjs/go/main/App.js");
      const texSizes = await GetModelTexSizes(cfg.repoRoot);
      const filtered = (texSizes || []).filter((t) => {
        if (!t.texWidth || !t.texHeight) return false;
        return (
          t.texWidth >= minT &&
          t.texWidth <= maxT &&
          t.texHeight >= minT &&
          t.texHeight <= maxT
        );
      });
      if (countEl)
        countEl.textContent = `🔍 ${filtered.length} 模型纹理 ${minT}×${maxT}`;
      bus.emit("filter:results", filtered);
      return;
    }
    const { SearchModels } = await import("../../../wailsjs/go/main/App.js");
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
      countEl.textContent = results
        ? `🔍 ${results.length} 个结果`
        : "🔍 0 个结果";
    bus.emit("filter:results", results);
  } catch (e) {
    console.warn("[filter] 筛选失败:", e);
  }
}

// 绑定工具栏事件
export function bindToolbarEvents(root, vm) {
  const $ = (id) => root.getElementById(id);
  const r = () => vm._renderTree();
  let ddTimer;

  // 全选 / 反选
  $("sel-all")?.addEventListener("click", () => {
    const { selectState } = vm._data || {};
    if (!selectState) return;
    const all = vm._treeData || vm._entries || [];
    const visible = all.filter((e) => e._visible !== false);
    const allSelected = visible.every((e) => selectState.keys.has(e.path));
    visible.forEach((e) => {
      if (allSelected) selectState.keys.delete(e.path);
      else selectState.keys.add(e.path);
    });
    updateSelectCount(root);
    flashBtn($("sel-all"));
  });

  // 批量导出骨骼名
  $("repo-export")?.addEventListener("click", async () => {
    const { re } = await import("../../../wailsjs/go/main/App.js");
    const { LoadAppConfig, ExportBoneStructures } =
      await import("../../../wailsjs/go/main/App.js");
    const cfg = await LoadAppConfig();
    if (!cfg.repoRoot) {
      bus.emit("toast:show", {
        msg: "请先设置仓库目录",
        duration: 2000,
        type: "warn",
      });
      return;
    }
    const text = await ExportBoneStructures(cfg.repoRoot);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.download = `bone-structures-${new Date().toISOString().slice(0, 10)}.txt`;
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    bus.emit("toast:show", {
      msg: "✅ 骨骼结构已导出",
      duration: 2000,
      type: "success",
    });
  });

  $("btn-repo")?.addEventListener("click", async () => {
    if (!vm._repoRoot) return;
    const { OpenFolder } = await import("../../../wailsjs/go/main/App.js");
    OpenFolder(vm._repoRoot);
  });

  // 搜索框实时过滤
  $("srch")?.addEventListener("input", () => {
    vm._search = $("srch")?.value || "";
    vm._renderTree();
  });

  // 作者下拉菜单 — 鼠标悬停时动态填充
  const menuAuthors = $("menu-authors");
  if (menuAuthors) {
    const ddWrap = menuAuthors.closest(".dd-wrap");
    if (ddWrap) {
      ddWrap.addEventListener("mouseenter", () => {
        if (menuAuthors.children.length) return; // 只填充一次
        const authors = vm._authors || [];
        if (!authors.length) {
          menuAuthors.innerHTML =
            '<div style="padding:4px 10px;font-size:10px;color:var(--muted)">暂无作者</div>';
          return;
        }
        authors.forEach((a) => {
          const name = typeof a === "string" ? a : a.Name || "";
          const count = typeof a === "object" ? a.Count || 0 : 0;
          if (!name) return;
          const btn = document.createElement("button");
          btn.className = "dd-item";
          btn.textContent = name + (count ? ` (${count})` : "");
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const srch = $("srch");
            if (srch) {
              srch.value = name;
              srch.dispatchEvent(new Event("input", { bubbles: true }));
            }
          });
          menuAuthors.appendChild(btn);
        });
      });
    }
  }

  // 批量按钮下拉菜单
  const menuBatch = $("menu-batch");
  if (menuBatch) {
    menuBatch.querySelectorAll("[data-batch]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const action = btn.dataset.batch;
        if (action === "enable-all") bus.emit("batch:enable-all");
        else if (action === "disable-all") bus.emit("batch:disable-all");
      });
    });
  }

  // 「⋮ 更多」下拉菜单
  const menuMore = $("menu-more");
  if (menuMore) {
    menuMore.addEventListener("click", async (e) => {
      const item = e.target.closest("[data-more]");
      if (!item) return;
      e.stopPropagation();
      const action = item.dataset.more;
      if (action === "open-folder") {
        if (!vm._repoRoot) return;
        const { OpenFolder } = await import("../../../wailsjs/go/main/App.js");
        await OpenFolder(vm._repoRoot);
      } else if (action === "import-file") {
        const rtype = vm._rootAttr || "ysm";
        const { SelectImportFile, ImportByType } =
          await import("../../../wailsjs/go/main/App.js");
        const exts = getExts(rtype);
        const ext = exts[0] || ".zip";
        const filePath = await SelectImportFile(
          rtype + " 模型|*" + ext,
          "选择" + rtype + "文件",
        );
        if (!filePath) return;
        const errMsg = await ImportByType(rtype, filePath);
        if (errMsg) {
          bus.emit("toast:show", {
            msg: "❌ 导入失败: " + errMsg,
            duration: 4000,
            type: "warn",
          });
          return;
        }
        await vm._load();
        vm._renderTree();
        bus.emit("toast:show", {
          msg: "✅ 导入成功",
          duration: 2000,
          type: "success",
        });
      } else if (action === "import-dir") {
        const rtype = vm._rootAttr || "ysm";
        const { SelectDirectory, ImportByType } =
          await import("../../../wailsjs/go/main/App.js");
        const dirPath = await SelectDirectory();
        if (!dirPath) return;
        // 找目录中的模型文件
        const targetExt = getExts(rtype)[0] || ".zip";
        // 直接导入目录（DirectoryCopyImporter 会按需处理）
        const errMsg = await ImportByType(rtype, dirPath);
        if (errMsg) {
          bus.emit("toast:show", {
            msg: "❌ 导入失败: " + errMsg,
            duration: 4000,
            type: "warn",
          });
          return;
        }
        await vm._load();
        vm._renderTree();
        bus.emit("toast:show", {
          msg: "✅ 文件夹导入成功",
          duration: 2000,
          type: "success",
        });
      } else if (action === "refresh") {
        const tree = $("tree");
        if (tree) tree.innerHTML = spinnerHTML();
        await vm._load();
        vm._renderTree();
      } else if (action === "genindex") {
        const btn = item;
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
            btn.textContent = "📇 生成索引";
            return;
          }
          await GenerateRepoIndex(cfg.repoRoot);
          bus.emit("toast:show", {
            msg: "✅ index.json 已生成",
            duration: 3000,
            type: "success",
          });
        } catch (e) {
          bus.emit("toast:show", {
            msg: "❌ " + friendlyError(e),
            duration: 4000,
            type: "error",
          });
        }
        btn.textContent = "📇 生成索引";
      }
    });
  }
}
