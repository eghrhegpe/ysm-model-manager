// ===== 整合包详情显示 =====
// 从 events.js 拆分：showPackageDetail + 数字跳动动画
import { renderDisplayName } from "../../utils/display.js";
import { bus } from "../../bus.js";

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
      clearInterval(timer);
      el.textContent = target;
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

  // MMD 类型：变体聚合显示
  const isMmd = pkg.rtype === "mmd-skin";
  const variantGroups = pkg.variantGroups;

  // 填充三个展开列表（MMD 时用变体聚合视图）
  if (
    isMmd &&
    variantGroups &&
    (variantGroups.missingGroups?.length || variantGroups.extraGroups?.length)
  ) {
    renderMmdVariantLists(root, pkg, variantGroups);
  } else {
    renderFlatLists(root, pkg);
  }
}

/** 渲染普通的扁平列表（非 MMD 类型） */
function renderFlatLists(root, pkg) {
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

/**
 * 渲染 MMD 类型的变体聚合列表。
 * 每组的元素显示为可折叠卡片："文件夹名（x 个变体）+ 同步全部按钮"
 */
function renderMmdVariantLists(root, pkg, variantGroups) {
  // 已同步列表保持扁平的逐文件显示（不聚合）
  const syncedEl = root.getElementById("dp-detail-synced");
  if (syncedEl) {
    const syncedItems = pkg.items?.synced || [];
    syncedEl.innerHTML = syncedItems.length
      ? syncedItems
          .map((it) => {
            const display = renderDisplayName(it.displayName || it.name || "");
            return `<div class="dp-detail-item" title="${esc(it.name)}">✅ ${display}</div>`;
          })
          .join("")
      : `<div class="dp-detail-empty">无</div>`;
    syncedEl.classList.add("dp-detail-hidden");
  }

  const configs = [
    {
      id: "dp-detail-missing",
      groups: variantGroups.missingGroups,
      icon: "⬇️",
    },
    { id: "dp-detail-extra", groups: variantGroups.extraGroups, icon: "📤" },
  ];

  configs.forEach(({ id, groups, icon }) => {
    const el = root.getElementById(id);
    if (!el) return;

    if (!groups || !groups.length) {
      el.innerHTML = `<div class="dp-detail-empty">无</div>`;
      el.classList.add("dp-detail-hidden");
      return;
    }

    let html = "";
    groups.forEach((folderPath) => {
      const folderName = folderPath.split(/[/\\]/).pop() || folderPath;
      const variants = variantGroups.variantMap[folderPath] || [];
      const displayFolder = renderDisplayName(folderName);
      html += `<div class="dp-mmd-group" data-folder="${esc(folderPath)}">`;
      html += `<div class="dp-mmd-group-hdr">
        <span class="dp-mmd-fold-icon">▾</span>
        <span class="dp-mmd-folder-name">${displayFolder}</span>
        <span class="dp-mmd-variant-count">（${variants.length} 个变体）</span>
      </div>`;
      html += `<div class="dp-mmd-group-body dp-mmd-open">`;
      variants.forEach((fp) => {
        const fileName = fp.split(/[/\\]/).pop() || fp;
        const display = renderDisplayName(fileName);
        html += `<div class="dp-detail-item" title="${esc(fp)}">${icon} ${display}</div>`;
      });
      html += `<button class="dp-mmd-sync-btn" data-folder="${esc(folderPath)}" data-pkg-name="${esc(pkg.name)}">⬇️ 同步全部变体</button>`;
      html += `</div></div>`;
    });

    el.innerHTML = html;
    el.classList.add("dp-detail-hidden");
  });
}

// 模块级标志：仅注册一次 MMD 事件委托
let _mmdEventsRegistered = false;

/**
 * 注册 MMD 变体的事件委托（折叠头 + 同步按钮）。
 * 在 connectedCallback 中调用一次，之后通过事件委托处理所有动态生成的 DOM。
 * 注意：el 是 Shadow DOM 内的容器，通过 root.getElementById 获取。
 */
export function registerMmdEvents(root) {
  if (_mmdEventsRegistered) return;
  _mmdEventsRegistered = true;

  // 直接监听 root，不依赖子容器是否存在（可能在 connectedCallback 时尚未渲染）
  root.addEventListener("click", (e) => {
    // 折叠头事件
    const hdr = e.target.closest(".dp-mmd-group-hdr");
    if (hdr) {
      const body = hdr.nextElementSibling;
      if (body) {
        body.classList.toggle("dp-mmd-open");
        const icon = hdr.querySelector(".dp-mmd-fold-icon");
        if (icon) icon.classList.toggle("rotated");
      }
      return;
    }
    // 同步按钮事件
    const btn = e.target.closest(".dp-mmd-sync-btn");
    if (!btn) return;
    const folderPath = btn.dataset.folder;
    const pkgName = btn.dataset.pkgName;
    if (!folderPath) return;
    btn.textContent = "⏳ 同步中...";
    btn.disabled = true;
    bus.emit("mmd:sync-variant-folder", {
      instanceName: pkgName,
      folderPath: folderPath,
      rtype: "mmd-skin",
    });
  });
}
