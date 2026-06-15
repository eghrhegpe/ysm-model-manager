// ===== 工具栏事件绑定 =====
import { friendlyError } from "../../utils/errors.js";
import { bus } from "../../bus.js";
import { flashBtn } from "./utils.js";
import { spinnerHTML } from "./tpl.js";
import { selectState } from "./data.js";
import { getExts } from "../../utils/extensions.js";
import { modalAdvFilter } from "../../dialogs/adv-filter.js";
import { updateSelectCount } from "./events.js";
import { dbg } from "../../utils/debug.js";

// 打开弹窗版筛选器（应用结果到 inline 面板 + 后端搜索）
async function openAdvFilterDialog($, vm) {
  dbg("adv-filter", "open:start", { repoRoot: vm._repoRoot });
  const cur = {
    keyword: $("srch")?.value || "",
    minBones: $("af-minBones")?.value || "",
    maxBones: $("af-maxBones")?.value || "",
    minCubes: $("af-minCubes")?.value || "",
    maxCubes: $("af-maxCubes")?.value || "",
    minTex: $("af-minTex")?.value || "",
    maxTex: $("af-maxTex")?.value || "",
  };
  dbg("adv-filter", "dialog:open", { cur });
  const result = await modalAdvFilter({ value: cur });
  dbg("adv-filter", "dialog:return", { result });
  if (!result) {
    dbg("adv-filter", "dialog:cancelled-or-null");
    return;
  }

  // "清除全部"路径：result 是 { cleared: true }，无 minBones 等字段
  // 统一回填 inline 面板（null/undefined → ""）
  const setVal = (id, v) => {
    const el = $(id);
    if (el) el.value = v == null ? "" : v;
  };
  setVal("af-minBones", result.minBones);
  setVal("af-maxBones", result.maxBones);
  setVal("af-minCubes", result.minCubes);
  setVal("af-maxCubes", result.maxCubes);
  setVal("af-minTex", result.minTex);
  setVal("af-maxTex", result.maxTex);
  const srchEl = $("srch");
  if (srchEl && result.keyword !== undefined) {
    srchEl.value = result.keyword;
    vm._search = result.keyword;
  }

  const kw = srchEl?.value || "";
  // 显式 == null 同时匹配 null 和 undefined（兼容弹窗"清除全部"返回的 {cleared:true}）
  const isUnset = (v) => v == null || v === "";
  if (
    !kw &&
    isUnset(result.minBones) &&
    isUnset(result.maxBones) &&
    isUnset(result.minCubes) &&
    isUnset(result.maxCubes) &&
    isUnset(result.minTex) &&
    isUnset(result.maxTex)
  ) {
    vm._filterPaths = null;
    vm._renderTree();
    return;
  }
  const { LoadAppConfig, SearchModels } =
    await import("../../../wailsjs/go/main/App.js");
  const cfg = await LoadAppConfig();
  if (!cfg.repoRoot) {
    bus.emit("toast:show", {
      msg: "⚠️ 请先在「设置」页面中配置仓库目录",
      duration: 3000,
      type: "warn",
    });
    return;
  }
  // 后端 SearchModels 走 > 0 判定；null 转 0 后不会触发过滤
  const n = (v) => (v == null ? 0 : parseInt(v, 10) || 0);
  const searchArgs = {
    repoRoot: cfg.repoRoot,
    kw,
    minBones: n(result.minBones),
    maxBones: n(result.maxBones),
    minCubes: n(result.minCubes),
    maxCubes: n(result.maxCubes),
    minTex: n(result.minTex),
    maxTex: n(result.maxTex),
  };
  dbg("adv-filter", "search:call", searchArgs);
  let resultCount = 0;
  try {
    const results = await SearchModels(
      cfg.repoRoot,
      kw,
      n(result.minBones),
      n(result.maxBones),
      n(result.minCubes),
      n(result.maxCubes),
      n(result.minTex),
      n(result.maxTex),
    );
    resultCount = results?.length ?? 0;
    vm._filterPaths = resultCount
      ? new Set(results.map((r) => r.Path))
      : new Set();
    dbg("adv-filter", "search:done", {
      resultCount,
      filterPathsSize: vm._filterPaths?.size,
      sample: Array.from(vm._filterPaths || []).slice(0, 2),
    });
  } catch (e) {
    const reason = friendlyError(e, "高级筛选");
    dbg("adv-filter", "search:error", { err: String(e), reason });
    bus.emit("toast:show", {
      msg: `❌ 高级筛选失败\n${reason}\n请检查仓库目录是否可访问，或尝试重置筛选条件`,
      duration: 5000,
      type: "error",
    });
    vm._filterPaths = null;
  }
  // 给用户明确反馈：找到 N 个 / 无匹配
  // 关键：之前 results=[] 时 _filterPaths 被设为 null → 走 buildTree 不进入过滤分支 → UI 完全没变
  // 现在无匹配时 _filterPaths 是空 Set → 走 buildTree 进入过滤分支 → 显示"未找到匹配的文件"
  if (vm._filterPaths && vm._filterPaths.size > 0) {
    bus.emit("toast:show", {
      msg: `🔍 找到 ${vm._filterPaths.size} 个匹配`,
      duration: 1500,
      type: "success",
    });
  } else if (vm._filterPaths && vm._filterPaths.size === 0) {
    bus.emit("toast:show", {
      msg: "🔍 无匹配模型（已应用筛选）",
      duration: 2000,
      type: "warn",
    });
  }
  vm._renderTree();
}

// 填充作者下拉（hover 或 click 都触发，避免鼠标快速点击时未填充）
function fillAuthorMenu(menuAuthors, vm, $) {
  if (menuAuthors.children.length) return; // 已填充
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
}

// 绑定工具栏事件
export function bindToolbarEvents(root, vm) {
  const $ = (id) => root.getElementById(id);
  let ddTimer;

  // 全选 / 反选 — 基于当前过滤后可见的行（_vsRows 存在 #tree 元素上，不在 shadow root）
  const selAllBtn = $("sel-all");
  if (selAllBtn) {
    selAllBtn.addEventListener("click", () => {
      const tree = $("tree");
      const rows = tree?._vsRows || [];
      const visible = rows.filter((r) => r.type === "file");
      const keys = visible.map((r) => r.key).filter(Boolean);
      const allSelected = keys.every((k) => selectState.keys.has(k));
      keys.forEach((k) => {
        if (allSelected) selectState.keys.delete(k);
        else selectState.keys.add(k);
      });
      updateSelectCount(root);
      flashBtn(selAllBtn);
    });
  }

  // 批量导出骨骼名
  $("repo-export")?.addEventListener("click", async () => {
    try {
      const { LoadAppConfig, ExportBoneStructures } =
        await import("../../../wailsjs/go/main/App.js");
      const cfg = await LoadAppConfig();
      if (!cfg.repoRoot) {
        bus.emit("toast:show", {
          msg: "⚠️ 请先在「设置」页面中配置仓库目录",
          duration: 3000,
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
    } catch (e) {
      const reason = friendlyError(e, "骨骼结构导出");
      bus.emit("toast:show", {
        msg: `❌ 骨骼结构导出失败\n${reason}\n请确认仓库中存在含骨骼数据的模型文件`,
        duration: 5000,
        type: "error",
      });
    }
  });

  $("btn-repo")?.addEventListener("click", () => {
    bus.emit("nav:change", { page: "settings" });
  });

  // 搜索框实时过滤
  $("srch")?.addEventListener("input", () => {
    vm._search = $("srch")?.value || "";
    vm._renderTree();
  });

  // 高级筛选按钮：触发弹窗版筛选器
  const advBtn = $("btn-adv-filter");
  dbg("toolbar-bind", "btn-adv-filter", advBtn ? "found" : "NOT-FOUND");
  advBtn?.addEventListener("click", () => {
    dbg("adv-filter", "btn:click");
    openAdvFilterDialog($, vm);
  });

  // 高级筛选：清除（inline 面板"清除"按钮 — 快速清空所有筛选）
  $("af-clear")?.addEventListener("click", () => {
    [
      "af-minBones",
      "af-maxBones",
      "af-minCubes",
      "af-maxCubes",
      "af-minTex",
      "af-maxTex",
    ].forEach((id) => {
      const el = $(id);
      if (el) el.value = "";
    });
    const srchEl = $("srch");
    if (srchEl) {
      srchEl.value = "";
      vm._search = "";
    }
    vm._filterPaths = null;
    vm._renderTree();
  });

  // 作者下拉菜单 — hover 或 click 都触发填充（避免快速点击时未填充）
  const menuAuthors = $("menu-authors");
  if (menuAuthors) {
    const ddWrap = menuAuthors.closest(".dd-wrap");
    if (ddWrap) {
      ddWrap.addEventListener("mouseenter", () =>
        fillAuthorMenu(menuAuthors, vm, $),
      );
      ddWrap.addEventListener("click", () =>
        fillAuthorMenu(menuAuthors, vm, $),
      );
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
        // 列出所有支持的扩展名（后端 SelectImportFile 用 | 解析 "显示名|*.ext1;*.ext2"）
        const exts = getExts(rtype);
        const extFilter = exts.length
          ? exts.map((e) => "*" + e).join(";")
          : "*.*";
        const filePath = await SelectImportFile(
          rtype + " 文件|" + extFilter,
          "选择" + rtype + "文件",
        );
        if (!filePath) return;
        const errMsg = await ImportByType(rtype, filePath);
        if (errMsg) {
          bus.emit("toast:show", {
            msg: `❌ 文件导入失败\n${errMsg}\n请确认文件格式正确且未被其他程序占用`,
            duration: 5000,
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
        // 后端 ImportByType → SimpleCopyImporter / DirectoryCopyImporter 都判 info.IsDir()，目录/文件都支持
        const errMsg = await ImportByType(rtype, dirPath);
        if (errMsg) {
          bus.emit("toast:show", {
            msg: `❌ 文件夹导入失败\n${errMsg}\n请确认目录中包含有效的模型文件`,
            duration: 5000,
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
        // 重置筛选/搜索，确保刷新后展示全部数据
        vm._filterPaths = null;
        vm._search = "";
        const srchEl = $("srch");
        if (srchEl) srchEl.value = "";
        await vm._load();
        vm._renderTree();
      } else if (action === "genindex") {
        const btn = item;
        btn.textContent = "⏳";
        btn.disabled = true;
        try {
          const { LoadAppConfig, GenerateRepoIndex } =
            await import("../../../wailsjs/go/main/App.js");
          const cfg = await LoadAppConfig();
          if (!cfg.repoRoot) {
            bus.emit("toast:show", {
              msg: "⚠️ 请先在「设置」页面中配置仓库目录",
              duration: 3000,
              type: "warn",
            });
            return;
          }
          await GenerateRepoIndex(cfg.repoRoot);
          bus.emit("toast:show", {
            msg: "✅ index.json 已生成",
            duration: 3000,
            type: "success",
          });
        } catch (e) {
          const reason = friendlyError(e, "索引生成");
          bus.emit("toast:show", {
            msg: `❌ 索引生成失败\n${reason}\n请确认仓库目录可读写，磁盘空间充足`,
            duration: 5000,
            type: "error",
          });
        } finally {
          btn.textContent = "📇 生成索引";
          btn.disabled = false;
        }
      }
    });
  }
}
