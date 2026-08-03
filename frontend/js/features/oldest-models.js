// ===== 资历最深 + 仓库评分 + 每日推荐（响应全局类型切换） =====
import { bus } from "../bus.ts";
import { renderDisplayName } from "../utils/display.js";
import { loadResourceRegistry } from "../utils/resource-registry.js";
import { getApp } from "../wails/app.js";

/**
 * 加载资历最深、仓库评分、热力图和每日推荐
 * @param {HTMLElement} container - 渲染容器
 * @param {Function} esc - HTML 转义函数
 */
export async function loadOldestModel(container, esc) {
  if (!container) return;
  let currentType = localStorage.getItem("repo_rtype") || "ysm";
  let unsub = null;

  // 命名函数，用于安全地移除/添加 click 监听，避免重复绑定
  function handleContainerClick(e) {
    const card = e.target.closest("[data-path]");
    if (card) {
      const path = card.dataset.path;
      if (path) bus.emit("model:select", { path });
    }
  }

  async function render() {
    container.innerHTML =
      '<div style="padding:12px;color:#6c7086;font-size:var(--fs-base)">⏳ 扫描中...</div>';
    try {
      const { ScanModelEntries, GetRepoRoot } = await getApp();
      const repoRoot = await GetRepoRoot(currentType);
      if (!repoRoot) {
        container.innerHTML =
          '<div style="padding:12px;color:#f38ba8;font-size:var(--fs-base)">请先配置该资源类型目录</div>';
        return;
      }

      const entries = await ScanModelEntries(repoRoot);
      if (!entries || !entries.length) {
        container.innerHTML =
          '<div style="padding:12px;color:#6c7086;font-size:var(--fs-base)">该类型仓库为空</div>';
        return;
      }

      // 基础统计
      let totalSize = 0,
        banned = 0,
        oldest = entries[0];
      const hashMap = {};
      entries.forEach((e) => {
        totalSize += e.Size || 0;
        if (e.ModTime && e.ModTime < oldest.ModTime) oldest = e;
        if ((e.Name || "").toLowerCase().endsWith(".ban")) banned++;
        if (e.Hash) hashMap[e.Hash] = (hashMap[e.Hash] || 0) + 1;
      });
      const dupGroups = Object.values(hashMap).filter((c) => c > 1).length;
      const dupTotal = Object.values(hashMap).reduce(
        (s, c) => s + (c > 1 ? c - 1 : 0),
        0,
      );

      // 仓库评分评分
      let score = 100;
      if (entries.length > 0) {
        const banPenalty = Math.round((banned / entries.length) * 40);
        const dupPenalty = Math.min(dupTotal * 5, 55);
        score = Math.max(0, 100 - banPenalty - dupPenalty);
      }
      const healthColor =
        score >= 80
          ? "var(--free)"
          : score >= 50
            ? "var(--tag-amber)"
            : "var(--paid)";
      const healthLabel =
        score >= 80 ? "健康" : score >= 50 ? "亚健康" : "需要整理";
      const healthTagClass = score >= 80 ? "good" : score >= 50 ? "ok" : "bad";

      // 热力图
      const monthCounts = buildMonthHeatmap(entries);
      const maxMonth = Math.max(1, ...monthCounts);
      const heatmapHtml =
        '<div style="display:flex;gap:4px;justify-content:center;align-items:end;padding:4px 0;min-height:48px">' +
        monthCounts
          .map((c, i) => {
            const pct = c / maxMonth;
            const ht = 4 + Math.round(pct * 44);
            const color =
              c === 0
                ? "var(--bd)"
                : pct > 0.66
                  ? "var(--free)"
                  : pct > 0.33
                    ? "var(--tag-amber)"
                    : "var(--paid)";
            const nowYear = new Date().getFullYear();
            const monthLabel = new Date(nowYear, i, 1).toLocaleDateString(
              "zh-CN",
              { month: "short" },
            );
            return (
              '<div class="heatmap-bar-wrap">' +
              '<div class="heatmap-bar" style="height:' +
              ht +
              "px;background:" +
              color +
              '" title="' +
              monthLabel +
              ": " +
              c +
              ' 个文件"></div>' +
              '<span class="heatmap-bar-label">' +
              monthLabel +
              "</span></div>"
            );
          })
          .join("") +
        "</div>";

      // 资历最深
      const sorted = [...entries]
        .filter((e) => e.ModTime)
        .sort((a, b) => a.ModTime - b.ModTime);
      const oldest4 = sorted.slice(0, 4);
      let oldestHtml = "";
      if (oldest4.length) {
        oldestHtml =
          '<div class="oldest-cards-row">' +
          oldest4
            .map((e) => {
              const ageDays = Math.floor((Date.now() - e.ModTime) / 86400000);
              const dateStr = new Date(e.ModTime).toLocaleDateString("zh-CN", {
                year: "numeric",
                month: "short",
                day: "numeric",
              });
              return (
                '<div class="model-card-sm" style="width:calc(50% - 3px);box-sizing:border-box" data-path="' +
                esc(e.Path || e.Name || "") +
                '" title="点击查看详情: ' +
                esc(e.Name || "") +
                '">' +
                '<div class="oldest-card-name" title="' +
                esc(e.Name || "") +
                '">' +
                renderDisplayName(e.Name) +
                "</div>" +
                '<div class="oldest-card-meta"><span>📏 ' +
                fmtSize(e.Size) +
                "</span><span>📅 " +
                dateStr +
                "</span><span> " +
                ageDays +
                " 天前</span></div></div>"
              );
            })
            .join("") +
          "</div>";
      }

      // 每日推荐
      const renderPicks = () => {
        // Fisher-Yates 洗牌后取前 3 个，避免重复且简洁可靠
        const shuffled = [...entries];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const total = Math.min(3, shuffled.length);
        const picks = [];
        for (let i = 0; i < total; i++) {
          const p = shuffled[i];
          if (!p) continue;
          const sizeStr = fmtSize(p.Size);
          const dateStr = p.ModTime
            ? new Date(p.ModTime).toLocaleDateString("zh-CN", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })
            : "";
          picks.push(
            '<div class="pick-card" data-path="' +
              esc(p.Path || p.Name || "") +
              '" title="点击查看详情: ' +
              esc(p.Name || "") +
              '">' +
              '<div class="name" title="' +
              esc(p.Name || "") +
              '">' +
              renderDisplayName(p.Name) +
              "</div>" +
              '<div class="meta"><span> ' +
              sizeStr +
              "</span>" +
              (dateStr ? "<span> " + dateStr + "</span>" : "") +
              "</div></div>",
          );
        }
        if (!picks.length)
          return '<div style="color:var(--muted);font-size:var(--fs-base)">暂无推荐</div>';
        return (
          '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">' +
          picks.join("") +
          "</div>"
        );
      };

      const reg = await loadResourceRegistry();
      const curIcon = (reg[currentType] && reg[currentType].icon) || "📦";
      container.innerHTML =
        '<div class="oldest-page">' +
        '<div class="oldest-stats-bar">' +
        '<div class="oldest-health-box">' +
        '<div class="oldest-health-label">📊 仓库评分</div>' +
        '<div class="oldest-health-ring" style="background:conic-gradient(' +
        healthColor +
        " " +
        score +
        "%, var(--bd) " +
        score +
        '% 100%)">' +
        '<div class="oldest-health-ring-inner">' +
        '<span class="oldest-health-ring-num">' +
        score +
        "</span></div></div>" +
        '<span class="health-tag ' +
        healthTagClass +
        '" style="font-size:var(--fs-sm)">' +
        healthLabel +
        "</span></div>" +
        '<div class="oldest-stats-divider"></div>' +
        '<div class="oldest-stats-row">' +
        '<span class="oldest-stat-pill">' +
        curIcon +
        " " +
        entries.length +
        "</span>" +
        '<span class="oldest-stat-pill">📏 ' +
        fmtSize(totalSize) +
        "</span>" +
        '<span class="oldest-stat-pill"> ' +
        banned +
        "</span>" +
        '<span class="oldest-stat-pill">🔗 ' +
        dupGroups +
        "</span></div></div>" +
        '<div class="oldest-section">' +
        '<div class="oldest-section-title">🏆 资历最深</div>' +
        '<div style="display:flex;justify-content:center">' +
        oldestHtml +
        "</div></div>" +
        '<div class="oldest-section">' +
        '<div class="oldest-section-title-sm">📅 月度活动</div>' +
        heatmapHtml +
        "</div>" +
        '<div class="oldest-section" style="text-align:center">' +
        '<div class="oldest-section-title">🎲 每日推荐</div>' +
        '<div style="display:flex;justify-content:center">' +
        renderPicks() +
        "</div></div></div>";

      // 先移除旧监听再添加，避免重复绑定导致内存泄漏
      container.removeEventListener("click", handleContainerClick);
      container.addEventListener("click", handleContainerClick);
    } catch (err) {
      container.innerHTML =
        '<div style="padding:12px;color:#f38ba8;font-size:var(--fs-base)">❌ 加载失败: ' +
        esc(err.message || String(err)) +
        "</div>";
    }
  }

  // 监听全局类型切换
  if (unsub) unsub();
  unsub = bus.on("repo:rtype-changed", (rtype) => {
    if (rtype && rtype !== currentType) {
      currentType = rtype;
      render();
    }
  });

  await render();

  // 返回清理函数
  return () => {
    container.removeEventListener("click", handleContainerClick);
    if (unsub) unsub();
  };
}

// ====== 工具函数 ======
function buildMonthHeatmap(entries) {
  const months = new Array(12).fill(0);
  entries.forEach((e) => {
    if (!e.ModTime) return;
    const d = new Date(e.ModTime);
    const m = d.getMonth();
    const now = new Date();
    const yearDiff = now.getFullYear() - d.getFullYear();
    if (yearDiff === 0 || (yearDiff === 1 && d.getMonth() >= now.getMonth())) {
      months[m]++;
    }
  });
  return months;
}

function fmtSize(bytes) {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let u = 0;
  let size = bytes;
  while (size >= 1024 && u < units.length - 1) {
    size /= 1024;
    u++;
  }
  return size.toFixed(u > 0 ? 1 : 0) + " " + units[u];
}
