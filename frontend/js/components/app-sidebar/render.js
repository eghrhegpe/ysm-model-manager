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
      ins.hasYSM,
    );
    container.appendChild(vc);
  });
}

export function renderBody(ins) {
  const sortByName = (a, b) =>
    (a.displayName || a.name).localeCompare(b.displayName || b.name);
  let h = "";
  if (ins.items.synced.length) {
    h += '<div data-category="synced">';
    h += sectionTitleHTML("✅ 已同步", ins.items.synced.length);
    ins.items.synced.sort(sortByName).forEach((it) => {
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
  if (ins.items.missing.length) {
    h += '<div data-category="missing">';
    h += sectionTitleHTML("⬇️ 缺失", ins.items.missing.length);
    ins.items.missing.sort(sortByName).forEach((it) => {
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
  if (ins.items.disabled && ins.items.disabled.length) {
    h += '<div data-category="disabled">';
    h += sectionTitleHTML("⚠️ 已禁用", ins.items.disabled.length);
    ins.items.disabled.sort(sortByName).forEach((it) => {
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
  if (ins.items.extra.length) {
    h += '<div data-category="extra">';
    h += sectionTitleHTML("📤 额外", ins.items.extra.length);
    ins.items.extra.sort(sortByName).forEach((it) => {
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
