// ===== 工具栏事件绑定 =====
import { friendlyError } from "../../utils/errors.ts";
import { RESOURCE_TYPES } from "../../utils/resource-types.ts";
import { bus } from "../../bus.ts";
import { flashBtn } from "./utils.ts";
import { spinnerHTML } from "./tpl.ts";
import { selectState } from "./data.ts";
import { getExts } from "../../utils/extensions.ts";
import { modalAdvFilter, type AdvFilterValue } from "../../dialogs/adv-filter.ts";
import { updateSelectCount } from "./events.ts";
import { dbg } from "../../utils/debug.ts";
import { setRenderMode, type RenderMode } from "./render.ts";
import { getApp } from "../../wails/app.ts";
import type { AppTree } from "./index.ts";
import type { AuthorInfo } from "./authors.ts";

type $Id = (id: string) => HTMLElement | null;

// 打开弹窗版筛选器（应用结果到 inline 面板 + 后端搜索）
async function openAdvFilterDialog($: $Id, vm: AppTree): Promise<void> {
  dbg("adv-filter", "open:start", { repoRoot: vm._repoRoot });
  // 输入框值都是字符串形态（弹窗内部转数字）；AdvFilterValue 为 number|null，
  // 此处是「当前输入框值」表示，类型上放宽转换
  const $v = (id: string): string => ($(id) as HTMLInputElement | null)?.value || "";
  const cur: Record<string, string> = {
    keyword: $v("srch"),
    minBones: $v("af-minBones"),
    maxBones: $v("af-maxBones"),
    minCubes: $v("af-minCubes"),
    maxCubes: $v("af-maxCubes"),
    minTex: $v("af-minTex"),
    maxTex: $v("af-maxTex"),
  };
  dbg("adv-filter", "dialog:open", { cur });
  const result = await modalAdvFilter({
    value: cur as unknown as Partial<AdvFilterValue>,
  });
  dbg("adv-filter", "dialog:return", { result });
  if (!result) {
    dbg("adv-filter", "dialog:cancelled-or-null");
    return;
  }
  // "清除全部"路径：result 是 { cleared: true }，无 minBones 等字段——断言为
  // AdvFilterValue 后字段为 undefined，被 setVal/isUnset/n 的 null 守卫兜底（行为保真）
  const rv = result as AdvFilterValue;

  // 统一回填 inline 面板（null/undefined → ""）
  const setVal = (id: string, v: unknown): void => {
    const el = $(id) as HTMLInputElement | null;
    if (el) el.value = v == null ? "" : String(v);
  };
  setVal("af-minBones", rv.minBones);
  setVal("af-maxBones", rv.maxBones);
  setVal("af-minCubes", rv.minCubes);
  setVal("af-maxCubes", rv.maxCubes);
  setVal("af-minTex", rv.minTex);
  setVal("af-maxTex", rv.maxTex);
  const srchEl = $("srch") as HTMLInputElement | null;
  if (srchEl && rv.keyword !== undefined) {
    srchEl.value = rv.keyword;
    vm._search = rv.keyword;
  }

  const kw = srchEl?.value || "";
  const hasTag = rv.tag && !(rv.tag === "");
  const isUnset = (v: unknown): boolean => v == null || v === "";
  if (
    !kw &&
    !hasTag &&
    isUnset(rv.minBones) &&
    isUnset(rv.maxBones) &&
    isUnset(rv.minCubes) &&
    isUnset(rv.maxCubes) &&
    isUnset(rv.minTex) &&
    isUnset(rv.maxTex)
  ) {
    vm._filterPaths = null;
    vm._renderTree();
    return;
  }
  const { SearchModels, ListByTag, GetRepoRoot } =
    await getApp();

  // 1. 按标签筛选（如果有）
  let tagPaths: Set<string> | null = null;
  if (hasTag) {
    try {
      const paths = await ListByTag(rv.tag);
      tagPaths = new Set(paths || []);
    } catch (e) {
      bus.emit("toast:show", {
        msg: "❌ 标签查询失败: " + friendlyError(e),
        duration: 4000,
        type: "error",
      });
    }
  }

  // 2. 按骨骼/纹理等条件搜索（如果有关键词或范围条件）
  const hasRange =
    !isUnset(rv.minBones) ||
    !isUnset(rv.maxBones) ||
    !isUnset(rv.minCubes) ||
    !isUnset(rv.maxCubes) ||
    !isUnset(rv.minTex) ||
    !isUnset(rv.maxTex) ||
    kw;

  let modelPaths: Set<string> | null = null;
  if (hasRange) {
    const repoRoot = await GetRepoRoot(RESOURCE_TYPES.YSM);
    if (!repoRoot) {
      bus.emit("toast:show", {
        msg: "请先配置仓库目录",
        duration: 2000,
        type: "warn",
      });
      return;
    }
    const n = (v: unknown): number => (v == null ? 0 : parseInt(String(v), 10) || 0);
    try {
      const results = await SearchModels(
        repoRoot,
        kw,
        n(rv.minBones),
        n(rv.maxBones),
        n(rv.minCubes),
        n(rv.maxCubes),
        n(rv.minTex),
        n(rv.maxTex),
      );
      modelPaths = results?.length
        ? new Set(results.map((r) => r.path))
        : new Set();
    } catch (e) {
      dbg("adv-filter", "search:error", { err: String(e) });
      bus.emit("toast:show", {
        msg: "❌ 高级筛选失败: " + friendlyError(e),
        duration: 5000,
        type: "error",
      });
      vm._filterPaths = null;
      vm._renderTree();
      return;
    }
  }

  // 3. 取交集：标签 ∩ 搜索条件（如果两者都有）
  if (tagPaths && modelPaths) {
    vm._filterPaths = new Set([...tagPaths].filter((p) => modelPaths.has(p)));
  } else if (tagPaths) {
    vm._filterPaths = tagPaths;
  } else if (modelPaths) {
    vm._filterPaths = modelPaths;
  } else {
    vm._filterPaths = null;
  }

  const size = vm._filterPaths?.size ?? 0;
  if (size > 0) {
    bus.emit("toast:show", {
      msg: `🔍 找到 ${size} 个匹配`,
      duration: 1500,
      type: "success",
    });
  } else if (vm._filterPaths && size === 0) {
    bus.emit("toast:show", {
      msg: "🔍 无匹配模型（已应用筛选）",
      duration: 2000,
      type: "warn",
    });
  }
  vm._renderTree();
}

// 填充作者下拉（hover 或 click 都触发，避免鼠标快速点击时未填充）
function fillAuthorMenu(
  menuAuthors: HTMLElement,
  vm: AppTree,
  $: $Id,
): void {
  if (menuAuthors.children.length) return; // 已填充
  const authors: Array<AuthorInfo | string> = vm._authors || [];
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
      const srch = $("srch") as HTMLInputElement | null;
      if (srch) {
        srch.value = name;
        srch.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    menuAuthors.appendChild(btn);
  });
}

// 绑定工具栏事件
export function bindToolbarEvents(root: ShadowRoot, vm: AppTree): void {
  const $: $Id = (id) => root.getElementById(id);

  // 全选 / 反选 — 基于当前过滤后可见的行
  const selAllBtn = $("sel-all");
  if (selAllBtn) {
    selAllBtn.addEventListener("click", () => {
      // 原代码 vm._root._vsRows 取的是 ShadowRoot 上从未设置的属性（_vsRows 设在 #tree 上）→ 全选恒失效
      const rows = vm._root.getElementById("tree")?._vsRows || [];
      const visible = rows.filter((r) => r.type === "file");
      const keys = visible.map((r) => r.key).filter(Boolean);
      const allSelected = keys.every((k) => selectState.keys.has(k));
      keys.forEach((k) => {
        if (allSelected) selectState.keys.delete(k);
        else selectState.keys.add(k);
      });
      // 复用 events.ts 里的实现（避免重复定义）
      updateSelectCount(root);
      flashBtn(selAllBtn);
    });
  }

  // 批量导出骨骼名
  $("repo-export")?.addEventListener("click", async () => {
    const { ExportBoneStructures, GetRepoRoot } =
      await getApp();
    const repoRoot = await GetRepoRoot(RESOURCE_TYPES.YSM);
    if (!repoRoot) {
      bus.emit("toast:show", {
        msg: "请先配置存储路径",
        duration: 2000,
        type: "warn",
      });
      return;
    }
    const text = await ExportBoneStructures(repoRoot);
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

  $("btn-repo")?.addEventListener("click", () => {
    bus.emit("nav:change", { page: "settings" });
  });

  // 搜索框实时过滤
  $("srch")?.addEventListener("input", () => {
    vm._search = ($("srch") as HTMLInputElement | null)?.value || "";
    vm._renderTree();
  });

  // 排序下拉（name/size/date，renderTree 已支持，此前缺绑定导致控件无效）
  $("sort")?.addEventListener("change", () => {
    vm._sort = ($("sort") as HTMLSelectElement | null)?.value || "name";
    vm._renderTree();
  });

  // 视图模式切换（grid ⇄ list）
  const viewModeBtn = $("btn-view-mode");
  if (viewModeBtn) {
    // 初始按钮图标：当前模式对应的「切换目标」图标
    viewModeBtn.textContent = vm._renderMode === "list" ? "▦" : "☰";
    viewModeBtn.addEventListener("click", () => {
      vm._renderMode = (vm._renderMode === "list" ? "grid" : "list") as RenderMode;
      setRenderMode(vm._renderMode);
      viewModeBtn.textContent = vm._renderMode === "list" ? "▦" : "☰";
      vm._renderTree();
      flashBtn(viewModeBtn);
    });
  }

  // 高级筛选按钮：触发弹窗版筛选器
  const advBtn = $("btn-adv-filter");
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
      const el = $(id) as HTMLInputElement | null;
      if (el) el.value = "";
    });
    const srchEl = $("srch") as HTMLInputElement | null;
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
        const action = (btn as HTMLElement).dataset.batch;
        if (action === "enable-all") bus.emit("batch:enable-all");
        else if (action === "disable-all") bus.emit("batch:disable-all");
      });
    });
  }

  // 「⋮ 更多」下拉菜单
  const menuMore = $("menu-more");
  if (menuMore) {
    menuMore.addEventListener("click", async (e) => {
      const target = e.target as HTMLElement | null;
      const item = target ? target.closest("[data-more]") : null;
      if (!item) return;
      e.stopPropagation();
      const action = (item as HTMLElement).dataset.more;
      if (action === "open-folder") {
        if (!vm._repoRoot) return;
        const { OpenFolder } = await getApp();
        await OpenFolder(vm._repoRoot);
      } else if (action === "import-file") {
        const rtype = vm._rootAttr || "ysm";
        const { SelectImportFile, ImportByType } =
          await getApp();
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
          await getApp();
        const dirPath = await SelectDirectory();
        if (!dirPath) return;
        // 后端 ImportByType → SimpleCopyImporter / DirectoryCopyImporter 都判 info.IsDir()，目录/文件都支持
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
        const btn = item as HTMLButtonElement;
        btn.textContent = "⏳";
        btn.disabled = true;
        try {
          const { GenerateRepoIndex, GetRepoRoot } =
            await getApp();
          const repoRoot = await GetRepoRoot(RESOURCE_TYPES.YSM);
          if (!repoRoot) {
            bus.emit("toast:show", {
              msg: "请先配置存储路径",
              duration: 2000,
              type: "warn",
            });
            return;
          }
          await GenerateRepoIndex(repoRoot);
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
        } finally {
          btn.textContent = "📇 生成索引";
          btn.disabled = false;
        }
      }
    });
  }
}
