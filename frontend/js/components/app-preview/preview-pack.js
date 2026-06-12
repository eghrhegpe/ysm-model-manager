// ===== 整合包详情显示 =====
// 从 events.js 拆分：showPackageDetail + 数字跳动动画
import { renderDisplayName } from "../../utils/display.js";

const esc = (s) =>
  (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function animateCount(el, target) {
  if (!el) return;
  const from = parseInt(el.textContent) || 0;
  if (from === target) {
    el.textContent = target;
    return;
  }
  const diff = target - from;
  const steps = Math.min(Math.abs(diff), 20);
  const interval = Math.max(30, 200 / steps);
  let i = 0;
  const timer = setInterval(() => {
    i++;
    const current = Math.round(from + (diff * i) / steps);
    el.textContent = current;
    if (i >= steps) {
      el.textContent = target;
      clearInterval(timer);
    }
  }, interval);
}

/** 更新预览面板显示整合包详情 */
export function showPackageDetail(root, pkg, resetButtons) {
  const body = root.getElementById("dp-body");
  const placeholder = root.getElementById("dp-placeholder");
  if (!body || !placeholder) return;

  if (!pkg) {
    body.style.display = "none";
    placeholder.style.display = "";
    if (resetButtons) resetButtons(root);
    return;
  }

  placeholder.style.display = "none";
  body.style.display = "";
  if (resetButtons) resetButtons(root);

  // 头部：包名 + 状态指示灯
  const nameEl = root.getElementById("dp-name");
  const statusEl = root.getElementById("dp-status");
  if (nameEl) nameEl.textContent = `📦 ${pkg.name}`;
  if (statusEl) {
    if (pkg.status === "complete") {
      statusEl.textContent = "";
      statusEl.style.cssText =
        "width:8px;height:8px;border-radius:50%;background:#a6e3a1;flex-shrink:0;display:inline-block;vertical-align:middle";
    } else if (pkg.status === "missing") {
      statusEl.textContent = "";
      statusEl.style.cssText =
        "width:8px;height:8px;border-radius:50%;background:#f38ba8;flex-shrink:0;display:inline-block;vertical-align:middle";
    } else if (pkg.status === "extra") {
      statusEl.textContent = "";
      statusEl.style.cssText =
        "width:8px;height:8px;border-radius:50%;background:#f9a826;flex-shrink:0;display:inline-block;vertical-align:middle";
    } else {
      statusEl.style.cssText = "display:none";
    }
  }

  // 三张状态卡片（带数字跳动）
  const syncedNum = root.getElementById("dp-card-synced-num");
  const missingNum = root.getElementById("dp-card-missing-num");
  const extraNum = root.getElementById("dp-card-extra-num");
  animateCount(syncedNum, pkg.synced || 0);
  animateCount(missingNum, pkg.missing || 0);
  animateCount(extraNum, pkg.extra || 0);

  // 填充三个展开列表
  [
    { id: "dp-detail-synced", items: pkg.items?.synced || [], icon: "✅" },
    { id: "dp-detail-missing", items: pkg.items?.missing || [], icon: "⬇️" },
    { id: "dp-detail-extra", items: pkg.items?.extra || [], icon: "📤" },
  ].forEach(({ id, items, icon }) => {
    const el = root.getElementById(id);
    if (!el) return;
    el.innerHTML = items.length
      ? items
          .map((it) => {
            const display = renderDisplayName(it.displayName || it.name || "");
            const fullPath = it.name || "";
            return `<div class="dp-detail-item" title="${esc(fullPath)}">${icon} ${display}</div>`;
          })
          .join("")
      : `<div class="dp-detail-empty">无</div>`;
    el.classList.add("dp-detail-hidden");
  });
}
