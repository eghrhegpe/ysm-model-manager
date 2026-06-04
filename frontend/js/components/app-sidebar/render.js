// ===== sidebar 渲染层 =====
import { vcHeaderHTML, sectionTitleHTML, rowHTML } from "./tpl.js";
function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// 渲染所有整合包卡片到容器
export function renderVersionCards(container, instances) {
  container.innerHTML = "";
  instances.forEach((ins, idx) => {
    const vc = document.createElement("div");
    vc.className = "vc";
    vc.dataset.idx = idx;
    const isOpen = idx === 0;
    vc.innerHTML = vcHeaderHTML(
      ins.name,
      ins.synced,
      ins.missing,
      ins.extra,
      ins.status,
      isOpen,
      idx,
    );
    container.appendChild(vc);

    // body
    const body = document.createElement("div");
    body.className = "vc-body";
    body.style.display = isOpen ? "" : "none";
    body.innerHTML = renderBody(ins);
    container.appendChild(body);
  });
}

function renderBody(ins) {
  let h = "";
  if (ins.items.synced.length) {
    h += sectionTitleHTML("✅ 已同步", ins.items.synced.length);
    ins.items.synced.forEach((it) => {
      h += rowHTML(
        "#a6e3a1",
        it.name,
        it.size,
        it.linkType,
        "",
        "",
        "",
        " row-prefix",
      );
    });
  }
  if (ins.items.missing.length) {
    h += sectionTitleHTML("⬇️ 缺失", ins.items.missing.length);
    ins.items.missing.forEach((it) => {
      const btnHtml = `<button class="btn-install-one" data-path="${esc(it.name)}" style="margin-left:4px;padding:1px 4px;border-radius:3px;border:1px solid var(--bd);background:transparent;color:var(--accent);cursor:pointer;font-size:9px">⬇️ 安装</button>`;
      h += rowHTML(
        "#f38ba8",
        it.displayName || it.name,
        it.size,
        "",
        "row-missing",
        it.name,
        btnHtml,
      );
    });
  }
  if (ins.items.disabled && ins.items.disabled.length) {
    h += sectionTitleHTML("⚠️ 已禁用", ins.items.disabled.length);
    ins.items.disabled.forEach((it) => {
      h += rowHTML("#f9a826", it.name, it.size, "", "", "", "", " row-prefix");
    });
  }
  if (ins.items.extra.length) {
    h += sectionTitleHTML("📤 额外", ins.items.extra.length);
    ins.items.extra.forEach((it) => {
      h += rowHTML("#f9a826", it.name, it.size, "", "", "", "", " row-prefix");
    });
  }
  return h;
}
