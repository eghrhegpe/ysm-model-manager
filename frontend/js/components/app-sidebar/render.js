// ===== sidebar 渲染层 =====
import { vcHeaderHTML } from "./tpl.js";

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
      idx,
      ins.hasMod,
      ins.rtype || "ysm",
    );
    container.appendChild(vc);
  });
}
