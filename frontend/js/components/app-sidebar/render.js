// ===== sidebar 渲染层 =====
import { vcHeaderHTML, sectionTitleHTML, rowHTML } from "./tpl.js";
import { renderDisplayName } from "../../utils/display.js";
function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// 渲染所有整合包卡片到容器
export function renderVersionCards(container, instances) {
  container.innerHTML = "";
  if (!instances.length) {
    container.innerHTML =
      '<div class="ws-empty" style="padding:24px">🔍 未找到匹配的整合包</div>';
    return;
  }
  instances.forEach((ins, idx) => {
    const vc = document.createElement("div");
    vc.className = "vc";
    vc.dataset.idx = idx;
    vc.innerHTML = vcHeaderHTML(
      ins.name,
      ins.synced,
      ins.missing,
      ins.extra,
      ins.status,
      false, // isOpen
      idx,
      ins.hasMod,
      ins.rtype || "ysm",
    );
    container.appendChild(vc);
  });
}

/** 从路径数组构建条目对象（展开卡片时按需调用） */
function buildItems(paths) {
  if (!paths || !paths.length) return [];
  return paths.map((p) => {
    const displayName = typeof p === "string" ? (p.split(/[/\\]/).pop() || p) : (p.displayName || p.name || "");
    const name = typeof p === "string" ? p : (p.name || "");
    const size = typeof p === "string" ? "" : (p.size || "");
    return { name, displayName, size };
  });
}

export function renderBody(ins) {
  const sortByName = (a, b) =>
    (a.displayName || a.name).localeCompare(b.displayName || b.name);

  // 按需构建
  const missingItems = buildItems(ins._missingPaths);
  const extraItems = buildItems(ins._extraPaths);
  const syncedItems = ins.items.synced || [];
  const disabledItems = ins.items.disabled || [];

  let h = "";
  if (syncedItems.length) {
    h += '<div data-category="synced">';
    h += sectionTitleHTML("✅ 已同步", syncedItems.length);
    syncedItems.sort(sortByName).forEach((it) => {
      h += rowHTML(
        "#6bb86b",
        renderDisplayName(it.name),
        it.size,
        it.linkType,
        "",
        "",
        "",
        " row-prefix",
      );
    });
    h += "</div>";
  }
  if (missingItems.length) {
    h += '<div data-category="missing">';
    h += sectionTitleHTML("⬇️ 缺失", missingItems.length);
    missingItems.sort(sortByName).forEach((it) => {
      const btnHtml = `<button class="btn-install-one" data-path="${esc(it.name)}" style="margin-left:4px;padding:1px 4px;border-radius:3px;border:1px solid var(--bd);background:transparent;color:var(--accent);cursor:pointer;font-size:9px">安装</button>`;
      h += rowHTML(
        "#f38ba8",
        renderDisplayName(it.displayName || it.name),
        it.size,
        "",
        "row-missing",
        it.name,
        btnHtml,
      );
    });
    h += "</div>";
  }
  if (disabledItems.length) {
    h += '<div data-category="disabled">';
    h += sectionTitleHTML("⚠️ 已禁用", disabledItems.length);
    disabledItems.sort(sortByName).forEach((it) => {
      h += rowHTML(
        "#f9a826",
        renderDisplayName(it.name),
        it.size,
        "",
        "",
        "",
        "",
        "",
        " row-prefix",
      );
    });
    h += "</div>";
  }
  if (extraItems.length) {
    h += '<div data-category="extra">';
    h += sectionTitleHTML("📤 额外", extraItems.length);
    extraItems.sort(sortByName).forEach((it) => {
      h += rowHTML(
        "#f9a826",
        renderDisplayName(it.name),
        it.size,
        it.linkType,
        "",
        "",
        "",
        " row-prefix",
      );
    });
    h += "</div>";
  }
  return h;
}
