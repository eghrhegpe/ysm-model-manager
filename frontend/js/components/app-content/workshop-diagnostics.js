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
  root
    .getElementById("diag-start-dedup")
    ?.addEventListener("click", () => startDedup(root, esc));

  // 左栏按钮切换（含去重）
  root.querySelectorAll(".diag-btn[data-diag]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.diag;
      root
        .querySelectorAll(".diag-btn[data-diag]")
        .forEach((b) => b.classList.toggle("active", b === btn));
      root.getElementById("diag-log").style.display =
        name === "log" ? "" : "none";
      root.getElementById("diag-dedup").style.display =
        name === "dedup" ? "" : "none";
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

async function startDedup(root, esc) {
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
发现 <strong>${dupHashes.length}</strong> 组重复文件，共 <strong>${totalDups}</strong> 个可清理
<span style="font-size:9px;color:var(--muted);margin-left:4px">每组选一个保留，其余移入回收站</span>
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
      group.forEach((e, fi) => {
        const checked = fi === defaultIdx ? " checked" : "";
        const isDefault = fi === defaultIdx;
        const dateStr = e.ModTime
          ? new Date(e.ModTime).toLocaleDateString()
          : "";
        html += `<label style="display:flex;align-items:center;gap:4px;padding:4px 8px;font-size:10px;cursor:pointer;transition:background .1s;background:${isDefault ? "var(--hover)" : "transparent"}"
>
<input type="radio" name="dedup-keep-${gi}" value="${fi}"${checked} style="flex-shrink:0;accent-color:var(--accent)">
<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt)" title="${esc(e.Path)}">${renderDisplayName(e.Name)}</span>
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
