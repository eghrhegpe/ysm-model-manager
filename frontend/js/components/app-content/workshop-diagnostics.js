// ===== 诊断页初始化（为 _initDiagnostics 减负） =====
import { bus } from "../../bus.js";
import { renderDisplayName } from "../../utils/display.js";

/**
 * 初始化诊断页所有功能
 * @param {ShadowRoot} root - 组件 shadow root
 * @param {Function} esc - HTML 转义函数
 */
export function initDiagnostics(root, esc) {
  root
    .getElementById("diag-refresh")
    ?.addEventListener("click", () => loadDiagnosticsLogs(root, esc));
  root.getElementById("diag-clear")?.addEventListener("click", async () => {
    const { ClearImportLogs } = await import("../../../wailsjs/go/main/App.js");
    await ClearImportLogs();
    loadDiagnosticsLogs(root, esc);
    bus.emit("toast:show", {
      msg: "🗑️ 日志已清空",
      duration: 2000,
      type: "info",
    });
  });
  root
    .getElementById("diag-scan-conflict")
    ?.addEventListener("click", () => scanConflicts(root, esc));
  // 左栏按钮切换
  root.querySelectorAll(".diag-btn[data-diag]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.diag;
      root
        .querySelectorAll(".diag-btn[data-diag]")
        .forEach((b) => b.classList.toggle("active", b === btn));
      root.getElementById("diag-log").style.display =
        name === "log" ? "" : "none";
      root.getElementById("diag-conflict").style.display =
        name === "conflict" ? "" : "none";
      if (name === "log") loadDiagnosticsLogs(root, esc);
    });
  });

  loadDiagnosticsLogs(root, esc);

  // 日志筛选按钮
  root.querySelectorAll(".diag-log-fbtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      root
        .querySelectorAll(".diag-log-fbtn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      loadDiagnosticsLogs(root, esc);
    });
  });

  // 日志搜索
  const logSearch = root.getElementById("diag-log-search");
  if (logSearch) {
    let timer;
    logSearch.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => loadDiagnosticsLogs(root, esc), 300);
    });
  }
}

async function loadDiagnosticsLogs(root, esc) {
  const list = root.getElementById("diag-log-list");
  if (!list) return;
  try {
    const { GetImportLogs } = await import("../../../wailsjs/go/main/App.js");
    const logs = await GetImportLogs();
    if (!logs || !logs.length) {
      list.innerHTML =
        '<div class="stat-row diag-stat diag-stat-muted">暂无日志</div>';
      return;
    }
    // 读筛选状态
    const activeBtn = root.querySelector(".diag-log-fbtn.active");
    const filter = activeBtn ? activeBtn.dataset.status : "all";
    const search = (root.getElementById("diag-log-search")?.value || "")
      .trim()
      .toLowerCase();

    const filtered = logs
      .slice(-500)
      .reverse()
      .filter((l) => {
        if (filter !== "all" && l.Status !== filter) return false;
        if (search && !l.ModelName.toLowerCase().includes(search)) return false;
        return true;
      });

    if (!filtered.length) {
      list.innerHTML =
        '<div class="stat-row diag-stat diag-stat-muted">无匹配日志</div>';
      return;
    }

    list.innerHTML = filtered
      .map((l) => {
        const statusLabel =
          l.Status === "success" ? "✅" : l.Status === "failed" ? "❌" : "⏭️";
        const t = l.Timestamp
          ? new Date(l.Timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })
          : "";
        const msg =
          renderDisplayName(l.ModelName) +
          (l.TargetDir ? "<br>📂 " + esc(l.TargetDir) : "") +
          (l.ErrorMsg
            ? "<br>❌ " +
              esc(l.ErrorMsg).replace(
                /\s+(问题描述|操作|源路径|目标路径|解决建议)[：:]?/g,
                "<br>$1：",
              )
            : "");
        return `<div class="log-row">
<span class="log-status ${status}">${statusLabel}</span>
<span class="log-msg">${msg}</span>
<span class="log-time">${t}</span>
</div>`;
      })
      .join("");
  } catch (_) {
    list.innerHTML =
      '<div class="stat-row diag-stat diag-stat-error">加载日志失败</div>';
  }
}

export async function startDedup(root, esc) {
  const list = root.getElementById("diag-dedup-list");
  if (!list) return;
  list.innerHTML =
    '<div class="stat-row diag-stat diag-stat-muted">⏳ 扫描仓库文件哈希...</div>';
  try {
    const { LoadAppConfig, ScanModelEntries, MoveToRecycle } =
      await import("../../../wailsjs/go/main/App.js");
    const cfg = await LoadAppConfig();
    const repoRoot = cfg.repoRoot || "";
    if (!repoRoot) {
      list.innerHTML =
        '<div class="stat-row" style="padding:12px;color:#f38ba8;font-size:11px">请先设置仓库目录</div>';
      return;
    }

    const entries = await ScanModelEntries(repoRoot);
    if (!entries || entries.length < 2) {
      list.innerHTML =
        '<div class="stat-row" style="padding:12px;color:#a6e3a1;font-size:11px">✅ 无需去重（文件不足 2 个）</div>';
      return;
    }

    // 按哈希分组
    const hashGroups = {};
    entries.forEach((e) => {
      if (!e.Hash) return;
      (hashGroups[e.Hash] ||= []).push(e);
    });

    const dupHashes = Object.entries(hashGroups).filter(
      ([, v]) => v.length > 1,
    );
    if (!dupHashes.length) {
      list.innerHTML =
        '<div class="stat-row" style="padding:12px;color:#a6e3a1;font-size:11px">✅ 没有重复文件</div>';
      return;
    }

    const totalDups = dupHashes.reduce((s, [, v]) => s + v.length - 1, 0);

    let html = `<div style="padding:10px 12px;font-size:11px;color:var(--txt);border-bottom:1px solid var(--bd)">
发现 <strong>${dupHashes.length}</strong> 组重复文件，请选一个保留（每组）
<span style="display:block;font-size:9px;color:var(--muted);margin-top:2px">未选择的文件将移入回收站</span>
</div>`;
    dupHashes.forEach(([, group], gi) => {
      const defaultIdx = group.reduce(
        (best, e, i, arr) => (e.Size > arr[best].Size ? i : best),
        0,
      );
      html += `<div style="margin:6px 12px;border:1px solid var(--bd);border-radius:8px;overflow:hidden">
<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;font-size:10px;font-weight:600;color:var(--txt);background:var(--surf);border-bottom:1px solid var(--bd)">
<span>📎 组 ${gi + 1}</span>
<span style="flex:1"></span>
<span style="font-size:9px;color:var(--muted);font-weight:400">${group.length} 个文件 · ${group.reduce((s, e) => s + e.Size, 0)} 字节</span>
</div>`;
      // 提取相对目录（去掉仓库根目录前缀）
      const getRelDir = (path) => {
        // 找到最后一个 / 或 \
        const lastSep = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
        const dir = lastSep >= 0 ? path.substring(0, lastSep) : "";
        // 去掉仓库根目录前缀
        const rootNorm = (repoRoot || "").replace(/[/\\]+/g, "\\");
        const dirNorm = dir.replace(/[/\\]+/g, "\\");
        let rel = dirNorm;
        if (rootNorm && dirNorm.startsWith(rootNorm)) {
          rel = dirNorm.slice(rootNorm.length).replace(/^[/\\]+/, "");
        }
        return rel || "/";
      };
      group.forEach((e, fi) => {
        const checked = fi === defaultIdx ? " checked" : "";
        const isDefault = fi === defaultIdx;
        const dateStr = e.ModTime
          ? new Date(e.ModTime).toLocaleDateString()
          : "";
        const relDir = getRelDir(e.Path);
        html += `<label style="display:flex;align-items:center;gap:4px;padding:4px 8px;font-size:10px;cursor:pointer;transition:background .1s;background:${isDefault ? "var(--hover)" : "transparent"}"
>
<input type="radio" name="dedup-keep-${gi}" value="${fi}"${checked} style="flex-shrink:0;accent-color:var(--accent)">
<span style="flex:1;overflow:hidden;min-width:0">
<span style="color:var(--txt);font-size:10px" title="${esc(e.Path)}">${renderDisplayName(e.Name)}</span>
<span style="display:block;font-size:8px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📁 ${esc(relDir)}</span>
</span>
<span style="font-size:9px;color:var(--muted);flex-shrink:0;margin-right:4px">${(e.Size / 1024).toFixed(0)}KB</span>
${dateStr ? `<span style="font-size:8px;color:var(--muted);flex-shrink:0">${dateStr}</span>` : ""}
${isDefault ? '<span style="font-size:8px;padding:0 4px;border-radius:3px;background:#a6e3a122;color:#a6e3a1">推荐</span>' : ""}
</label>`;
      });
      html += `</div>`;
    });
    html += `<div style="display:flex;gap:6px;padding:8px 12px;border-top:1px solid var(--bd)">
<button id="diag-dedup-exec" style="flex:1;padding:7px 16px;border-radius:6px;border:none;background:var(--accent);color:#fff;cursor:pointer;font-size:11px">🗑️ 删除未选中的重复文件</button>
<button id="diag-dedup-cancel" style="padding:7px 16px;border-radius:6px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:11px">取消</button>
</div>`;
    list.innerHTML = html;

    list.querySelector("#diag-dedup-cancel")?.addEventListener("click", () => {
      list.innerHTML =
        '<div class="stat-row" style="padding:12px;color:#6c7086;font-size:11px">已取消去重</div>';
    });

    list
      .querySelector("#diag-dedup-exec")
      ?.addEventListener("click", async () => {
        let del = 0,
          fail = 0;
        for (let gi = 0; gi < dupHashes.length; gi++) {
          const [, group] = dupHashes[gi];
          const selected = parseInt(
            list.querySelector(`input[name="dedup-keep-${gi}"]:checked`)
              ?.value ?? "0",
            10,
          );
          for (let fi = 0; fi < group.length; fi++) {
            if (fi === selected) continue;
            try {
              await MoveToRecycle(group[fi].Path);
              del++;
            } catch {
              fail++;
            }
          }
        }
        if (del > 0) {
          bus.emit("stats:refresh");
          bus.emit("tree:reload");
        }
        list.innerHTML = `<div class="stat-row" style="padding:8px 12px;font-size:11px;color:${fail > 0 ? "#f9a826" : "#a6e3a1"}">
✅ 去重完成：移入回收站 ${del} 个，失败 ${fail} 个</div>`;
      });
  } catch (err) {
    list.innerHTML = `<div class="stat-row" style="padding:12px;color:#f38ba8;font-size:11px">去重失败: ${esc(String(err))}</div>`;
  }
}

async function scanConflicts(root, esc) {
  const list = root.getElementById("diag-conflict-list");
  if (!list) return;
  list.innerHTML =
    '<div class="stat-row" style="padding:12px;color:#6c7086;font-size:11px">扫描中...</div>';
  try {
    const { LoadAppConfig, ListVersionInstances, ScanModelEntries } =
      await import("../../../wailsjs/go/main/App.js");
    const cfg = await LoadAppConfig();
    const mcRoot = cfg.mcRoot || cfg.McRoot || "";
    if (!mcRoot) {
      list.innerHTML =
        '<div class="stat-row" style="padding:12px;color:#f38ba8;font-size:11px">请先设置游戏路径</div>';
      return;
    }

    const instances = await ListVersionInstances(mcRoot);
    if (!instances || !instances.length) {
      list.innerHTML =
        '<div class="stat-row" style="padding:12px;color:#6c7086;font-size:11px">没有找到整合包</div>';
      return;
    }

    const instanceFiles = {};
    for (const ins of instances) {
      if (!ins.Exists) continue;
      const entries = await ScanModelEntries(ins.CustomDir);
      instanceFiles[ins.Name] = (entries || []).map((e) => ({
        name: e.Name.replace(/\.ban$/i, ""),
      }));
    }

    const nameMap = {};
    for (const [insName, files] of Object.entries(instanceFiles)) {
      for (const f of files) {
        if (!nameMap[f.name]) nameMap[f.name] = [];
        nameMap[f.name].push(insName);
      }
    }

    const conflicts = Object.entries(nameMap)
      .filter(([, v]) => v.length > 1)
      .sort((a, b) => b[1].length - a[1].length);

    if (!conflicts.length) {
      list.innerHTML =
        '<div class="stat-row" style="padding:12px;color:#a6e3a1;font-size:11px">✅ 未检测到文件名冲突</div>';
      return;
    }

    let html = `<div class="stat-row" style="padding:8px 12px;color:#f38ba8;font-size:11px">⚠️ 发现 ${conflicts.length} 个文件存在于多个整合包</div>`;
    conflicts.slice(0, 50).forEach(([name, insNames]) => {
      html += `<div class="conflict-row">
<span class="conflict-name">${renderDisplayName(name)}</span>
<span class="conflict-ver">${insNames.length} 个整合包</span>
</div>`;
      insNames.forEach((n) => {
        html += `<div class="conflict-ins">&nbsp;&nbsp;📦 ${esc(n)}</div>`;
      });
    });
    if (conflicts.length > 50) {
      html += `<div class="stat-row" style="padding:8px 12px;color:#6c7086;font-size:10px">...还有 ${conflicts.length - 50} 个</div>`;
    }
    list.innerHTML = html;
  } catch (err) {
    list.innerHTML = `<div class="stat-row" style="padding:12px;color:#f38ba8;font-size:11px">扫描失败: ${esc(String(err))}</div>`;
  }
}

/** 👴 仓库元老 + 📊 健康度 + 🎲 今日推荐 */
/** 构建年度热力图数据 */
function buildHeatmap(entries) {
  // 按天统计活动次数
  const dayMap = {};
  entries.forEach((e) => {
    if (!e.ModTime) return;
    const d = new Date(e.ModTime);
    const key = d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
    dayMap[key] = (dayMap[key] || 0) + 1;
  });
  // 生成过去 364 天的网格 (52周×7天)
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 363); // 约一年前
  const cells = [];
  for (let i = 0; i < 364; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
    const count = dayMap[key] || 0;
    let level = 0;
    if (count > 0) level = count <= 1 ? 1 : count <= 3 ? 2 : count <= 8 ? 3 : 4;
    cells.push(level);
  }
  // 按周分组 (52列×7行)
  const weeks = [];
  for (let w = 0; w < 52; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const idx = w * 7 + d;
      col.push(idx < cells.length ? cells[idx] : 0);
    }
    weeks.push(col);
  }
  // 月份标签 (每4周一个)
  const monthLabels = [];
  for (let w = 0; w < 52; w += 4) {
    const d = new Date(start);
    d.setDate(d.getDate() + w * 7);
    monthLabels.push(d.getMonth() + 1 + "月");
  }
  return { weeks, monthLabels };
}

/** 👴 仓库元老 + 📊 健康度 + 🎲 今日推荐 + 热力图 */
function fmtSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

function truncatePath(path, maxLen = 60) {
  if (!path || path.length <= maxLen) return path || "";
  const parts = path.replace(/\\/g, "/").split("/");
  let result = parts.pop();
  while (
    parts.length > 0 &&
    result.length + parts[parts.length - 1].length + 3 < maxLen
  ) {
    result = parts.pop() + "/" + result;
  }
  return "…/" + result;
}

export async function loadOldestModel(root, esc) {
  const list = root.getElementById("diag-oldest-list");
  if (!list) return;
  list.innerHTML =
    '<div class="stat-row diag-stat diag-stat-muted">⏳ 扫描中...</div>';
  try {
    const { LoadAppConfig, ScanModelEntries, OpenFolder } =
      await import("../../../wailsjs/go/main/App.js");
    const cfg = await LoadAppConfig();
    const repoRoot = cfg.repoRoot || "";
    if (!repoRoot) {
      list.innerHTML =
        '<div class="stat-row" style="padding:12px;color:#f38ba8;font-size:11px">请先设置仓库目录</div>';
      return;
    }

    const entries = await ScanModelEntries(repoRoot);
    if (!entries || !entries.length) {
      list.innerHTML =
        '<div class="stat-row" style="padding:12px;color:#6c7086;font-size:11px">仓库为空</div>';
      return;
    }

    // 扫描统计数据
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
    score = Math.min(
      Math.max(
        score -
          Math.min(dupTotal * 5, 30) -
          Math.min(banned * 3, 15) +
          Math.min(Math.floor(entries.length / 10) * 2, 10),
        0,
      ),
      100,
    );

    const healthPct = score;
    const healthColor =
      score >= 80 ? "#a6e3a1" : score >= 50 ? "#f9a826" : "#f38ba8";
    const healthLabel =
      score >= 80 ? "健康" : score >= 50 ? "亚健康" : "需要整理";
    const healthTagClass = score >= 80 ? "good" : score >= 50 ? "ok" : "bad";
    const healthMsg =
      score >= 80
        ? "你的仓库状态很好！"
        : score >= 50
          ? "有一些小问题需要处理"
          : "重复文件和禁用模型太多了！";

    // 热力图
    const { weeks, monthLabels } = buildHeatmap(entries);
    const heatmapHtml = `
<div class="hm-wrap">
  <div class="hm-month">${monthLabels.map((m) => "<span>" + m + "</span>").join("")}</div>
  <div class="hm-grid">
    ${weeks.map((col) => '<div class="hm-col">' + col.map((l) => '<div class="hm-cell' + (l > 0 ? " l" + l : "") + '"></div>').join("") + "</div>").join("")}
  </div>
  <div class="hm-legend">
    <span>少</span>
    <div class="hm-cell"></div>
    <div class="hm-cell l1"></div>
    <div class="hm-cell l2"></div>
    <div class="hm-cell l3"></div>
    <div class="hm-cell l4"></div>
    <span>多</span>
  </div>
</div>`;

    // 仓库元老
    let oldestHtml = "";
    if (oldest && oldest.ModTime) {
      const ageMs = Date.now() - oldest.ModTime;
      const ageDays = Math.floor(ageMs / 86400000);
      const dateStr = new Date(oldest.ModTime).toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      const path = oldest.Path || oldest.Name;
      oldestHtml = `
<div class="oldest-card">
  <div class="name">📄 ${renderDisplayName(oldest.Name)}</div>
  <div class="path" data-path="${esc(path)}" title="点击打开所在文件夹">📁 ${esc(truncatePath(path))}</div>
  <div class="meta">📏 ${fmtSize(oldest.Size)} · 📅 ${dateStr} · 🕒 ${ageDays} 天前</div>
  <div class="actions">
    <button data-path="${esc(path)}" class="oldest-open">📂 定位文件</button>
  </div>
</div>`;
    }

    // 今日推荐 + 换一批逻辑
    let _pickIndex = Math.floor(Math.random() * entries.length);
    const renderPick = () => {
      const p = entries[_pickIndex];
      if (!p)
        return '<div class="stat-row diag-stat diag-stat-muted">暂无推荐</div>';
      return `
<div class="rec-card" title="${esc(p.Path || p.Name)}">
  <div class="name">${renderDisplayName(p.Name)}</div>
  <div class="hint">💡 今天要不试试这个？</div>
  <div class="actions">
    <button class="rec-open" data-path="${esc(p.Path || p.Name)}">📂 定位</button>
    <button class="rec-next">🎲 换一批</button>
  </div>
</div>`;
    };
    const todayPickHtml = renderPick();

    // 组装页面
    list.innerHTML = `
<div style="padding:16px;display:flex;flex-direction:column;gap:16px">
  <!-- 第一行：健康度 + 资历最深 -->
  <div style="display:flex;gap:16px;flex-wrap:wrap;justify-content:center">
    <div style="flex:1;min-width:180px;text-align:center;background:var(--surf);border:1px solid var(--bd);border-radius:10px;padding:16px">
      <div style="font-size:10px;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">📊 仓库健康度</div>
      <div class="health-ring" style="background:conic-gradient(${healthColor} ${healthPct}%, var(--bd) ${healthPct}% 100%);margin:0 auto 8px">
        <div class="health-ring-inner">
          <span style="font-size:20px;font-weight:700;color:var(--txt);line-height:1">${score}</span>
          <span style="font-size:9px;color:var(--muted);line-height:1">/ 100</span>
        </div>
      </div>
      <div><span class="health-tag ${healthTagClass}">${healthLabel}</span></div>
      <div style="font-size:10px;color:var(--muted);margin-top:4px">${healthMsg}</div>
    </div>
    <div style="flex:1;min-width:180px;text-align:center;background:var(--surf);border:1px solid var(--bd);border-radius:10px;padding:16px">
      <div style="font-size:10px;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">🏆 资历最深</div>
      <div style="display:flex;justify-content:center">${oldestHtml}</div>
    </div>
  </div>

  <!-- 统计标签 -->
  <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center">
    <span class="stat-pill">📦 ${entries.length} 个模型</span>
    <span class="stat-pill">📏 ${fmtSize(totalSize)}</span>
    <span class="stat-pill">⛔ ${banned} 个禁用</span>
    <span class="stat-pill">🔗 ${dupGroups} 组重复</span>
  </div>

  <!-- 热力图 -->
  <div style="background:var(--surf);border:1px solid var(--bd);border-radius:10px;padding:12px 16px">
    <div style="font-size:9px;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">📅 年度活动热力图</div>
    ${heatmapHtml}
  </div>

  <!-- 今日推荐 -->
  <div style="text-align:center;background:var(--surf);border:1px solid var(--bd);border-radius:10px;padding:16px">
    <div style="font-size:10px;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">🎲 今日推荐</div>
    <div style="display:flex;justify-content:center;min-height:60px" id="oldest-rec-wrap">${todayPickHtml}</div>
  </div>
</div>`;

    // 点击路径/按钮打开文件夹
    list.querySelectorAll("[data-path]").forEach((el) => {
      if (el.classList.contains("rec-next")) return;
      el.addEventListener("click", async () => {
        const path = el.dataset.path;
        if (path) {
          try {
            await OpenFolder(path);
          } catch (_) {}
        }
      });
    });

    // 换一批
    list.querySelectorAll(".rec-next").forEach((btn) => {
      btn.addEventListener("click", () => {
        let next;
        do {
          next = Math.floor(Math.random() * entries.length);
        } while (next === _pickIndex && entries.length > 1);
        _pickIndex = next;
        const wrap = list.querySelector("#oldest-rec-wrap");
        if (wrap) wrap.innerHTML = renderPick();
        // 重新绑定新卡片的事件
        wrap?.querySelectorAll("[data-path]").forEach((el) => {
          el.addEventListener("click", async () => {
            const path = el.dataset.path;
            if (path) {
              try {
                await OpenFolder(path);
              } catch (_) {}
            }
          });
        });
        wrap?.querySelectorAll(".rec-next").forEach((b) => {
          b.addEventListener("click", () => btn.click());
        });
      });
    });
  } catch (err) {
    list.innerHTML =
      '<div class="stat-row" style="padding:12px;color:#f38ba8;font-size:11px">加载失败: ' +
      esc(String(err)) +
      "</div>";
  }
}
