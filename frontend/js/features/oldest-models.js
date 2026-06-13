// ===== 仓库元老 + 健康度 + 今日推荐（响应全局类型切换） =====
import { bus } from "../bus.js";
import { renderDisplayName } from "../utils/display.js";

const RT_ICONS = {
  ysm: "💎",
  "mmd-skin": "🎭",
  "vrchat-avatar": "🥽",
  resourcepack: "🎨",
  shaderpack: "☀️",
  "create-blueprint": "⚙️",
};

/**
 * 加载仓库元老、健康度、热力图和今日推荐
 * @param {HTMLElement} container - 渲染容器
 * @param {Function} esc - HTML 转义函数
 */
export async function loadOldestModel(container, esc) {
  if (!container) return;
  let currentType = localStorage.getItem("repo_rtype") || "ysm";
  let unsub = null;

  async function render() {
    container.innerHTML =
      '<div style="padding:12px;color:#6c7086;font-size:var(--fs-base)">⏳ 扫描中...</div>';
    try {
      const { ScanModelEntries, GetRepoRoot } =
        await import("../../wailsjs/go/main/App.js");
      const repoRoot = await GetRepoRoot(currentType);
      if (!repoRoot) {
        container.innerHTML =
          '<div style="padding:12px;color:#f38ba8;font-size:var(--fs-base)">请先设置该资源类型的目录</div>';
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

      // 健康度评分
      let score = 100;
      if (entries.length > 0) {
        const banPenalty = Math.round((banned / entries.length) * 40);
        const dupPenalty = Math.min(dupTotal * 5, 55);
        score = Math.max(0, 100 - banPenalty - dupPenalty);
      }
      const healthColor =
        score >= 80 ? "#a6e3a1" : score >= 50 ? "#f9a826" : "#f38ba8";
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
            const ht = 8 + Math.round(pct * 24);
            const color =
              c === 0
                ? "var(--bd)"
                : pct > 0.66
                  ? "#a6e3a1"
                  : pct > 0.33
                    ? "#f9a826"
                    : "#f38ba8";
            const monthLabel = new Date(2026, i, 1).toLocaleDateString(
              "zh-CN",
              { month: "short" },
            );
            return (
              '<div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex:1">' +
              '<div style="width:100%;height:' +
              ht +
              "px;background:" +
              color +
              ';border-radius:3px;min-height:8px;transition:all .2s" title="' +
              monthLabel +
              ": " +
              c +
              ' 个文件"></div>' +
              '<span style="font-size:var(--fs-tiny);color:var(--muted);line-height:1">' +
              monthLabel +
              "</span></div>"
            );
          })
          .join("") +
        "</div>";

      // 仓库元老
      const sorted = [...entries]
        .filter((e) => e.ModTime)
        .sort((a, b) => a.ModTime - b.ModTime);
      const oldest4 = sorted.slice(0, 4);
      let oldestHtml = "";
      if (oldest4.length) {
        oldestHtml =
          '<div style="display:flex;flex-wrap:wrap;gap:6px;width:100%">' +
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
                '<div class="name" title="' +
                esc(e.Name || "") +
                '">📄 ' +
                renderDisplayName(e.Name) +
                "</div>" +
                '<div class="meta"><span>📏 ' +
                fmtSize(e.Size) +
                "</span><span>📅 " +
                dateStr +
                "</span><span>🕒 " +
                ageDays +
                " 天前</span></div></div>"
              );
            })
            .join("") +
          "</div>";
      }

      // 今日推荐
      const renderPicks = () => {
        const picks = [];
        const used = new Set();
        const total = Math.min(3, entries.length);
        for (let i = 0; i < total; i++) {
          let idx;
          do {
            idx = Math.floor(Math.random() * entries.length);
          } while (used.has(idx) && used.size < entries.length);
          used.add(idx);
          const p = entries[idx];
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
            '<div class="model-card" style="flex:1;min-width:140px;max-width:200px" data-path="' +
              esc(p.Path || p.Name || "") +
              '" title="点击查看详情: ' +
              esc(p.Name || "") +
              '">' +
              '<div class="name" style="font-size:var(--fs-md)" title="' +
              esc(p.Name || "") +
              '">' +
              renderDisplayName(p.Name) +
              "</div>" +
              '<div class="meta" style="font-size:var(--fs-sm);margin-top:4px"><span>📏 ' +
              sizeStr +
              "</span>" +
              (dateStr ? "<span>📅 " + dateStr + "</span>" : "") +
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

      const curIcon = RT_ICONS[currentType] || "📦";
      container.innerHTML =
        '<div style="display:flex;flex-direction:column;gap:16px;padding:16px;overflow-y:auto;height:100%">' +
        '<div style="display:flex;gap:16px;flex-wrap:wrap">' +
        '<div style="display:flex;align-items:center;gap:8px;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:8px 14px;flex-shrink:0;align-self:flex-start">' +
        '<div style="font-size:var(--fs-sm);color:var(--muted);white-space:nowrap">📊 健康度</div>' +
        '<div class="health-ring" style="background:conic-gradient(' +
        healthColor +
        " " +
        score +
        "%, var(--bd) " +
        score +
        '% 100%);width:28px;height:28px;border-radius:50%;flex-shrink:0">' +
        '<div class="health-ring-inner" style="position:relative;width:22px;height:22px;top:3px;left:3px;background:var(--surf);border-radius:50%;display:flex;align-items:center;justify-content:center">' +
        '<span style="font-size:var(--fs-sm);font-weight:700;color:var(--txt)">' +
        score +
        "</span></div></div>" +
        '<span class="health-tag ' +
        healthTagClass +
        '" style="font-size:var(--fs-sm)">' +
        healthLabel +
        "</span></div>" +
        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
        '<span style="padding:3px 10px;border:1px solid var(--bd);border-radius:12px;font-size:var(--fs-sm);color:var(--txt);background:var(--bg);white-space:nowrap">' +
        curIcon +
        " " +
        entries.length +
        "</span>" +
        '<span style="padding:3px 10px;border:1px solid var(--bd);border-radius:12px;font-size:var(--fs-sm);color:var(--txt);background:var(--bg);white-space:nowrap">📏 ' +
        fmtSize(totalSize) +
        "</span>" +
        '<span style="padding:3px 10px;border:1px solid var(--bd);border-radius:12px;font-size:var(--fs-sm);color:var(--txt);background:var(--bg);white-space:nowrap">⛔ ' +
        banned +
        "</span>" +
        '<span style="padding:3px 10px;border:1px solid var(--bd);border-radius:12px;font-size:var(--fs-sm);color:var(--txt);background:var(--bg);white-space:nowrap">🔗 ' +
        dupGroups +
        "</span></div>" +
        '<div style="flex:3;min-width:280px;background:var(--surf);border:1px solid var(--bd);border-radius:10px;padding:12px 14px">' +
        '<div style="font-size:var(--fs-base);color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">🏆 资历最深</div>' +
        '<div style="display:flex;justify-content:center">' +
        oldestHtml +
        "</div></div></div>" +
        '<div style="background:var(--surf);border:1px solid var(--bd);border-radius:10px;padding:8px 12px">' +
        '<div style="font-size:var(--fs-sm);color:var(--muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px">📅 月度活动</div>' +
        heatmapHtml +
        "</div>" +
        '<div style="text-align:center;background:var(--surf);border:1px solid var(--bd);border-radius:10px;padding:16px">' +
        '<div style="font-size:var(--fs-base);color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">🎲 今日推荐</div>' +
        '<div style="display:flex;justify-content:center">' +
        renderPicks() +
        "</div></div></div>";

      container.addEventListener("click", (e) => {
        const card = e.target.closest("[data-path]");
        if (card) {
          const path = card.dataset.path;
          if (path) bus.emit("model:select", { path });
        }
      });
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
