// ===== 工具栏事件绑定 =====
import { friendlyError } from "../../utils/errors.js";
import { bus } from "../../bus.js";
import { flashBtn } from "./utils.js";
import { spinnerHTML } from "./tpl.js";
import { selectState } from "./data.js";
import { getExts } from "../../utils/extensions.js";

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

// 绑定工具栏事件
export function bindToolbarEvents(root, vm) {
  const $ = (id) => root.getElementById(id);
  const r = () => vm._renderTree();
  let ddTimer;

  // 全选 / 反选 — 基于当前过滤后可见的行
  const selAllBtn = $("sel-all");
  if (selAllBtn) {
    selAllBtn.addEventListener("click", () => {
      const rows = vm._root._vsRows || vm._entries || [];
      const visible = rows.filter((r) => r.type === "file");
      const keys = visible.map((r) => r.path).filter(Boolean);
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

  $("btn-repo")?.addEventListener("click", () => {
    bus.emit("nav:change", { page: "settings" });
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
        btn.disabled = true;
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
        } finally {
          btn.textContent = "📇 生成索引";
          btn.disabled = false;
        }
      }
    });
  }
}
