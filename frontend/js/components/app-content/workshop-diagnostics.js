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

export async function startDedup(root, esc, rtype) {
  const list = root.getElementById("diag-dedup-list");
  if (!list) return;

  const rtDefs = [
    { id: "ysm", icon: "💎", label: "YSM 模型" },
    { id: "mmd-skin", icon: "🎭", label: "MMD 模型" },
    { id: "vrchat-avatar", icon: "🥽", label: "VRChat" },
    { id: "resourcepack", icon: "🎨", label: "材质包" },
    { id: "shaderpack", icon: "☀️", label: "光影包" },
    { id: "create-blueprint", icon: "⚙️", label: "蓝图" },
  ];
  const typeLabel = rtype
    ? rtDefs.find((d) => d.id === rtype)?.label || rtype
    : "所有";
  const typeIcon = rtype
    ? rtDefs.find((d) => d.id === rtype)?.icon || "📦"
    : "📦";

  list.innerHTML =
    '<div class="stat-row diag-stat diag-stat-muted">⏳ 扫描 ' +
    typeIcon +
    " " +
    typeLabel +
    " 目录文件哈希...</div>";

  try {
    const { FindDuplicateFiles, GetRepoRoot, MoveToRecycle } =
      await import("../../../wailsjs/go/main/App.js");

    // 收集目标目录
    const targets = [];
    if (rtype && rtype !== "all") {
      const dir = await GetRepoRoot(rtype);
      if (dir)
        targets.push({ id: rtype, icon: typeIcon, label: typeLabel, dir });
    } else {
      for (const rt of rtDefs) {
        const dir = await GetRepoRoot(rt.id);
        if (dir) targets.push({ ...rt, dir });
      }
    }

    if (!targets.length) {
      list.innerHTML =
        '<div class="stat-row" style="padding:12px;color:#f38ba8;font-size:11px">请先设置资源目录</div>';
      return;
    }

    // 逐目录扫描
    const allResults = [];
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      list.innerHTML =
        '<div class="stat-row diag-stat diag-stat-muted">⏳ 扫描中 ' +
        (i + 1) +
        "/" +
        targets.length +
        " " +
        t.icon +
        " " +
        t.label +
        "</div>";
      await new Promise((r) => setTimeout(r, 10));
      const jsonStr = await FindDuplicateFiles(t.dir);
      const groups = JSON.parse(jsonStr || "[]") || [];
      if (groups.length)
        allResults.push({ icon: t.icon, label: t.label, groups });
    }

    const totalGroups = allResults.reduce((s, r) => s + r.groups.length, 0);
    const totalDups = allResults.reduce(
      (s, r) => s + r.groups.reduce((s2, g) => s2 + g.files.length - 1, 0),
      0,
    );

    if (!totalGroups) {
      list.innerHTML =
        '<div class="stat-row" style="padding:12px;color:#a6e3a1;font-size:11px">✅ 没有重复文件</div>';
      return;
    }

    let html = `<div style="padding:10px 12px;font-size:11px;color:var(--txt);border-bottom:1px solid var(--bd)">
发现 <strong>${totalGroups}</strong> 组重复文件（共 <strong>${totalDups}</strong> 个多余副本），每组选一个保留：
<span style="display:block;font-size:9px;color:var(--muted);margin-top:2px">未选择的文件将移入回收站</span>
</div>`;

    let groupIndex = 0;
    for (const rtResult of allResults) {
      html += `<div style="display:flex;align-items:center;gap:4px;padding:6px 12px 2px;font-size:10px;font-weight:600;color:var(--txt)">
${rtResult.icon} ${rtResult.label}
<span style="flex:1;border-bottom:1px solid var(--bd);margin-left:6px"></span>
<span style="font-size:9px;color:var(--muted);font-weight:400">${rtResult.groups.reduce((s, g) => s + g.files.length, 0)} 文件</span>
</div>`;

      for (const group of rtResult.groups) {
        const files = group.files || [];
        const defaultIdx = files.reduce(
          (best, e, i, arr) => (e.size > arr[best].size ? i : best),
          0,
        );
        const totalSize = files.reduce((s, e) => s + e.size, 0);
        const gi = groupIndex++;

        html += `<div style="margin:4px 12px;border:1px solid var(--bd);border-radius:8px;overflow:hidden">
<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;font-size:10px;font-weight:600;color:var(--txt);background:var(--surf);border-bottom:1px solid var(--bd)">
<span>📎 组 ${gi + 1}</span>
<span style="flex:1"></span>
<span style="font-size:9px;color:var(--muted);font-weight:400">${files.length} 个文件 · ${totalSize} 字节</span>
</div>`;
        files.forEach((e, fi) => {
          const checked = fi === defaultIdx ? " checked" : "";
          const isDefault = fi === defaultIdx;
          const dateStr = e.modTime
            ? new Date(e.modTime).toLocaleDateString()
            : "";
          const lastSep = Math.max(
            e.path.lastIndexOf("/"),
            e.path.lastIndexOf("\\"),
          );
          const dir = lastSep >= 0 ? e.path.substring(0, lastSep) : "";
          html += `<label style="display:flex;align-items:center;gap:4px;padding:4px 8px;font-size:10px;cursor:pointer;transition:background .1s;background:${isDefault ? "var(--hover)" : "transparent"}">
<input type="radio" name="dedup-keep-${gi}" value="${fi}"${checked} style="flex-shrink:0;accent-color:var(--accent)">
<span style="flex:1;overflow:hidden;min-width:0">
<span style="color:var(--txt);font-size:10px;cursor:pointer" title="点击查看详情: ${esc(e.path)}" data-path="${esc(e.path)}">${renderDisplayName(e.name)}</span>
<span style="display:block;font-size:8px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📁 ${esc(dir)}</span>
</span>
<span style="font-size:9px;color:var(--muted);flex-shrink:0;margin-right:4px">${(e.size / 1024).toFixed(0)}KB</span>
${dateStr ? '<span style="font-size:8px;color:var(--muted);flex-shrink:0">' + dateStr + "</span>" : ""}
${isDefault ? '<span style="font-size:8px;padding:0 4px;border-radius:3px;background:#a6e3a122;color:#a6e3a1">推荐</span>' : ""}
</label>`;
        });
        html += `</div>`;
      }
    }

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
          fail = 0,
          gi2 = 0;
        for (const rtResult of allResults) {
          for (const group of rtResult.groups) {
            const files = group.files || [];
            const selected = parseInt(
              list.querySelector('input[name="dedup-keep-' + gi2 + '"]:checked')
                ?.value ?? "0",
              10,
            );
            for (let fi = 0; fi < files.length; fi++) {
              if (fi === selected) continue;
              try {
                await MoveToRecycle(files[fi].path);
                del++;
              } catch {
                fail++;
              }
            }
            gi2++;
          }
        }
        if (del > 0) {
          bus.emit("stats:refresh");
          bus.emit("tree:reload");
        }
        list.querySelectorAll("[data-path]").forEach((el) => {
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            const path = el.dataset.path;
            if (path) bus.emit("model:select", { path });
          });
        });
        list.innerHTML =
          '<div class="stat-row" style="padding:8px 12px;font-size:11px;color:' +
          (fail > 0 ? "#f9a826" : "#a6e3a1") +
          '">✅ 去重完成：移入回收站 ' +
          del +
          " 个，失败 " +
          fail +
          " 个</div>";
      });
  } catch (err) {
    list.innerHTML =
      '<div class="stat-row" style="padding:12px;color:#f38ba8;font-size:11px">去重失败: ' +
      esc(String(err)) +
      "</div>";
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

// [已迁移到 features/oldest-models.js]
