// ===== sidebar 渲染层 =====
import { vcHeaderHTML, sectionTitleHTML, rowHTML } from "./tpl.js";

// 渲染所有整合包卡片到容器
export function renderVersionCards(container, instances) {
  container.innerHTML = "";
  instances.forEach((ins, idx) => {
    const vc = document.createElement("div");
    vc.className = "vc";
    vc.dataset.idx = idx;
    vc.innerHTML = vcHeaderHTML(ins.name, ins.synced, ins.missing);
    container.appendChild(vc);

    // body
    const body = document.createElement("div");
    body.className = "vc-body";
    body.style.display = idx === 0 ? "" : "none";
    body.innerHTML = renderBody(ins);
    container.appendChild(body);
  });
}

function renderBody(ins) {
  let h = "";
  if (ins.items.synced.length) {
    h += sectionTitleHTML("✅ 已同步", ins.items.synced.length);
    ins.items.synced.forEach((it) => {
      h += rowHTML("#a6e3a1", it.name, it.size);
    });
  }
  if (ins.items.missing.length) {
    h += sectionTitleHTML("⬇️ 缺失", ins.items.missing.length);
    ins.items.missing.forEach((it) => {
      h += rowHTML("#f38ba8", it.name, it.size);
    });
  }
  if (ins.items.extra.length) {
    h += sectionTitleHTML("📤 额外", ins.items.extra.length);
    ins.items.extra.forEach((it) => {
      h += rowHTML("#f9a826", it.name, it.size);
    });
  }
  return h;
}
