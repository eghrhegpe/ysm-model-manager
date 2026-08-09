// ===== 诊断页初始化（为 _initDiagnostics 减负） =====
import { t } from "../../../core/i18n/t.ts";
import { bus } from "../../../bus.ts";
import { renderDisplayName } from "../../../utils/dom/display.ts";
import { getApp } from "../../../wails/app.ts";
import { loadResourceRegistry } from "../../../utils/resource/registry.ts";
import { RESOURCE_TYPES, RESOURCE_TYPE_LABELS } from "../../../utils/resource/types.ts";

/** 转义函数签名（与组件 _esc 一致） */
type EscFn = (s: unknown) => string;

/**
 * 初始化诊断页所有功能
 * @param root - 组件 shadow root
 * @param esc - HTML 转义函数
 */
export function initDiagnostics(root: ShadowRoot, esc: EscFn): void {
  // 刷新按钮：按当前激活的诊断 tab 刷新对应面板
  root
    .getElementById("diag-refresh")
    ?.addEventListener("click", () => {
      const active = root.querySelector(".diag-btn[data-diag].active") as HTMLElement | null;
      const name = active?.dataset.diag;
      if (name === "runtime") loadRuntimeLogs(root, esc);
      else loadDiagnosticsLogs(root, esc);
    });
  root.getElementById("diag-clear")?.addEventListener("click", async () => {
    const { ClearImportLogs } = await getApp();
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
      const name = (btn as HTMLElement).dataset.diag;
      root
        .querySelectorAll(".diag-btn[data-diag]")
        .forEach((b) => b.classList.toggle("active", b === btn));
      const logPanel = root.getElementById("diag-log") as HTMLElement | null;
      const runtimePanel = root.getElementById("diag-runtime") as HTMLElement | null;
      const conflictPanel = root.getElementById("diag-conflict") as HTMLElement | null;
      if (logPanel) logPanel.style.display = name === "log" ? "" : "none";
      if (runtimePanel) runtimePanel.style.display = name === "runtime" ? "" : "none";
      if (conflictPanel) conflictPanel.style.display = name === "conflict" ? "" : "none";
      // 重启入场动画
      const activePanel =
        name === "log" ? logPanel : name === "runtime" ? runtimePanel : conflictPanel;
      if (activePanel) {
        activePanel.style.animation = "none";
        void activePanel.offsetHeight;
        activePanel.style.animation = "";
      }
      if (name === "log") loadDiagnosticsLogs(root, esc);
      if (name === "runtime") loadRuntimeLogs(root, esc);
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
  const logSearch = root.getElementById("diag-log-search") as HTMLInputElement | null;
  if (logSearch) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    logSearch.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => loadDiagnosticsLogs(root, esc), 300);
    });
  }
}

/** 绑定 ImportLog（仅用到的字段） */
interface ImportLogLike {
  Status?: string;
  Timestamp?: string | number;
  ModelName?: string;
  TargetDir?: string;
  SourcePath?: string;
  ErrorMsg?: string;
  Operation?: string;
}

/** 操作类型 → 中文标签 + 图标（分组标题与行内徽标共用） */
const OP_META: Record<string, { label: string; icon: string }> = {
  import: { label: t("diagnostics.opImport"), icon: "📥" },
  scan: { label: t("diagnostics.opScan"), icon: "🔍" },
  download: { label: t("diagnostics.opDownload"), icon: "⬇️" },
  sync: { label: t("diagnostics.opSync"), icon: "🔄" },
  rename: { label: t("diagnostics.opRename"), icon: "✏️" },
  delete: { label: t("diagnostics.opDelete"), icon: "🗑️" },
  ui: { label: t("diagnostics.opUI"), icon: "⚠️" },
};

/** 未知 op 回退到通用标签，避免显示裸英文 */
function opMeta(op: string | undefined): { label: string; icon: string } {
  if (op && OP_META[op]) return OP_META[op];
  return { label: op || "导入", icon: "🧾" };
}

async function loadDiagnosticsLogs(root: ShadowRoot, esc: EscFn): Promise<void> {
  const list = root.getElementById("diag-log-list");
  if (!list) return;
  try {
    const { GetImportLogs } = await getApp();
    const logs: ImportLogLike[] = (await GetImportLogs()) || [];
    if (!logs || !logs.length) {
      list.innerHTML =
        '<div class="stat-row diag-stat diag-stat-muted">暂无日志</div>';
      return;
    }
    // 读筛选状态
    const activeBtn = root.querySelector(".diag-log-fbtn.active");
    const filter = activeBtn ? (activeBtn as HTMLElement).dataset.status : "all";
    const search = (root.getElementById("diag-log-search") as HTMLInputElement | null)
      ?.value?.trim().toLowerCase() || "";

    const filtered = logs
      .slice(-500)
      .reverse()
      .filter((l) => {
        if (filter !== "all" && l.Status !== filter) return false;
        if (search && !(l.ModelName || "").toLowerCase().includes(search)) return false;
        return true;
      });

    if (!filtered.length) {
      list.innerHTML =
        '<div class="stat-row diag-stat diag-stat-muted">无匹配日志</div>';
      return;
    }

    // 按操作类型分组（保持时间倒序），组内行带中文徽标
    const groups = new Map<string, ImportLogLike[]>();
    for (const l of filtered) {
      const key = l.Operation || "import";
      const arr = groups.get(key);
      if (arr) arr.push(l);
      else groups.set(key, [l]);
    }

    const parts: string[] = [];
    for (const [op, items] of groups) {
      const meta = opMeta(op);
      parts.push(
        `<div class="log-group" style="padding:4px 16px 2px;font-size:var(--fs-xs);color:var(--muted);display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--bd);background:var(--surf)">
<span>${meta.icon} ${meta.label}</span><span style="margin-left:auto">${items.length} 条</span></div>`,
      );
      items.forEach((l, i) => {
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
          renderDisplayName(l.ModelName || "") +
          ((l.TargetDir || l.SourcePath) ? "<br>📂 " + esc(l.TargetDir || l.SourcePath) : "") +
          (l.ErrorMsg
            ? "<br>❌ " +
              esc(l.ErrorMsg).replace(
                /\s+(问题描述|操作|源路径|目标路径|解决建议)[：:]?/g,
                "<br>$1：",
              )
            : "");
        // ⚠️ 原 JS 的 `${status}` 引用了未定义变量（模板串求值抛 ReferenceError，
        // 被外层 catch 吞掉 → 日志列表永远显示「加载日志失败」）。TS 编译期暴露，
        // 按意图改为 l.Status（与 statusLabel 同源）
        parts.push(
          `<div class="log-row" style="animation-delay:${Math.min(i * 20, 400)}ms">
<span class="log-status ${l.Status || ""}">${statusLabel}</span>
<span class="log-msg">${msg}</span>
<span class="log-time">${t}</span>
</div>`,
        );
      });
    }
    list.innerHTML = parts.join("");
  } catch (_) {
    list.innerHTML =
      '<div class="stat-row diag-stat diag-stat-error">加载日志失败</div>';
  }
}

/** 运行时日志条目（仅用到的字段） */
interface RuntimeLogLike {
  Message?: string;
  Timestamp?: string | number;
}

/** 加载运行时日志（watcher/sync 等标准库 log 输出） */
async function loadRuntimeLogs(root: ShadowRoot, esc: EscFn): Promise<void> {
  const list = root.getElementById("diag-runtime-list");
  if (!list) return;
  try {
    const { GetRuntimeLogs } = await getApp();
    const logs: RuntimeLogLike[] = (await GetRuntimeLogs()) || [];
    if (!logs || !logs.length) {
      list.innerHTML =
        '<div class="stat-row diag-stat diag-stat-muted">暂无运行时日志</div>';
      return;
    }
    list.innerHTML = logs
      .slice(-300)
      .reverse()
      .map((l, i) => {
        const t = l.Timestamp
          ? new Date(l.Timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })
          : "";
        return `<div class="log-row" style="animation-delay:${Math.min(i * 20, 400)}ms">
<span class="log-status">🕹️</span>
<span class="log-msg" style="white-space:pre-wrap">${esc(l.Message || "")}</span>
<span class="log-time">${t}</span>
</div>`;
      })
      .join("");
  } catch (_) {
    list.innerHTML =
      '<div class="stat-row diag-stat diag-stat-error">加载运行时日志失败</div>';
  }
}

/**
 * 去重结果容器统一显式传入（消除 mock root 包装 + 幽灵 id diag-dedup-list）。
 * 之前调用方传 { getElementById: () => list } 包装对象，startDedup 内部查
 * "diag-dedup-list"——模板中并无此 id，靠包装对象兜底才不崩，报错无法定位。
 */
export async function startDedup(
  list: HTMLElement,
  esc: EscFn,
  rtype?: string,
): Promise<void> {

  const reg = await loadResourceRegistry();
  const entry = rtype ? reg[rtype] : undefined;
  const entryName = entry && typeof entry.name === "string" ? entry.name : "";
  const entryIcon = entry && typeof entry.icon === "string" ? entry.icon : "";
  const typeLabel = rtype ? entryName || rtype : "所有";
  const typeIcon = rtype ? entryIcon || "📦" : "📦";

  list.innerHTML =
    '<div class="stat-row diag-stat diag-stat-muted">⏳ 扫描 ' +
    typeIcon +
    " " +
    typeLabel +
    " 目录文件哈希...</div>";

  try {
    const { FindDuplicateFiles, GetRepoRoot, MoveToRecycle } =
      await getApp();

    // 收集目标目录
    interface DedupTarget {
      id: string;
      icon: string;
      label: string;
      dir: string;
    }
    const targets: DedupTarget[] = [];
    if (rtype && rtype !== "all") {
      const dir = await GetRepoRoot(rtype);
      if (dir)
        targets.push({ id: rtype, icon: typeIcon, label: typeLabel, dir });
    } else {
      for (const rt of Object.values(reg)) {
        const dir = await GetRepoRoot(rt.id);
        if (dir) {
          const rtName = typeof rt.name === "string" ? rt.name : rt.id;
          const rtIcon = typeof rt.icon === "string" ? rt.icon : "📦";
          targets.push({ id: rt.id, icon: rtIcon, label: rtName, dir });
        }
      }
    }

    if (!targets.length) {
      list.innerHTML =
        '<div class="stat-row diag-msg diag-msg-error">请先配置资源目录</div>';
      return;
    }

    // 逐目录扫描
    interface DedupFile {
      path: string;
      name: string;
      size: number;
      modTime?: string;
    }
    interface DedupGroup {
      files: DedupFile[];
    }
    interface DedupGroupResult {
      icon: string;
      label: string;
      groups: DedupGroup[];
    }
    const allResults: DedupGroupResult[] = [];
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
        '<div class="stat-row diag-msg diag-msg-success" style="justify-content:center">✅ 没有重复文件</div>';
      return;
    }

    let html = `<div class="diag-dedup-summary">
发现 <strong>${totalGroups}</strong> 组重复文件（共 <strong>${totalDups}</strong> 个多余副本），每组选一个保留：
<span class="diag-dedup-summary-hint">未选择的文件将移入回收站</span>
</div>`;

    let groupIndex = 0;
    for (const rtResult of allResults) {
      html += `<div class="diag-dedup-rt">
${rtResult.icon} ${rtResult.label}
<span class="diag-dedup-rt-sep"></span>
<span class="diag-dedup-rt-count">${rtResult.groups.reduce((s, g) => s + g.files.length, 0)} 文件</span>
</div>`;

      for (const group of rtResult.groups) {
        const files = group.files || [];
        const defaultIdx = files.reduce(
          (best, e, i, arr) => (e.size > arr[best].size ? i : best),
          0,
        );
        const totalSize = files.reduce((s, e) => s + e.size, 0);
        const gi = groupIndex++;

        html += `<div class="diag-dedup-group">
<div class="diag-dedup-group-head">
<span>📎 组 ${gi + 1}</span>
<span class="diag-dedup-group-fill"></span>
<span class="diag-dedup-group-info">${files.length} 个文件 · ${totalSize} 字节</span>
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
          html += `<label class="diag-dedup-file${isDefault ? " diag-dedup-file-default" : ""}">
<input type="radio" name="dedup-keep-${gi}" value="${fi}"${checked} class="diag-dedup-radio">
<span class="diag-dedup-file-name">
<span class="diag-dedup-file-name-text" title="点击查看详情: ${esc(e.path)}" data-path="${esc(e.path)}">${renderDisplayName(e.name)}</span>
<span class="diag-dedup-file-dir">📁 ${esc(dir)}</span>
</span>
<span class="diag-dedup-file-size">${(e.size / 1024).toFixed(0)}KB</span>
${dateStr ? '<span class="diag-dedup-file-date">' + dateStr + "</span>" : ""}
${isDefault ? '<span class="diag-dedup-recommend">推荐</span>' : ""}
</label>`;
        });
        html += `<label class="diag-dedup-keep-all">
<input type="radio" name="dedup-keep-${gi}" value="-1" class="diag-dedup-radio">
<span class="diag-dedup-keep-all-label">🔀 保留全部（不删除）</span>
</label>`;
        html += `</div>`;
      }
    }

    html += `<div class="diag-dedup-actions">
<button id="diag-dedup-exec" class="diag-dedup-exec">🗑️ 删除未选中的重复文件</button>
<button id="diag-dedup-cancel" class="diag-dedup-cancel">取消</button>
</div>`;
    list.innerHTML = html;

    // 文件名点击预览（渲染后立即绑定，不等到 exec 之后）
    list.querySelectorAll("[data-path]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const path = (el as HTMLElement).dataset.path;
        if (path) bus.emit("model:select", { path });
      });
    });

    list.querySelector("#diag-dedup-cancel")?.addEventListener("click", () => {
      list.innerHTML =
        '<div class="stat-row diag-msg diag-msg-muted">已取消去重</div>';
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
            const selEl = list.querySelector(
              'input[name="dedup-keep-' + gi2 + '"]:checked',
            ) as HTMLInputElement | null;
            const selected = selEl ? parseInt(selEl.value, 10) : 0;
            // 选中「保留全部」(-1) 时跳过改组
            if (selected === -1) {
              gi2++;
              continue;
            }
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
        list.innerHTML =
          '<div class="stat-row diag-msg ' +
          (fail > 0 ? "diag-msg-warn" : "diag-msg-success") +
          '">✅ 去重完成：移入回收站 ' +
          del +
          " 个，失败 " +
          fail +
          " 个</div>";
      });
  } catch (err) {
    list.innerHTML =
      '<div class="stat-row diag-msg diag-msg-error">去重失败: ' +
      esc(String(err)) +
      "</div>";
  }
}

async function scanConflicts(root: ShadowRoot, esc: EscFn): Promise<void> {
  const list = root.getElementById("diag-conflict-list");
  if (!list) return;
  // 扫描按钮雷达动画
  const scanBtn = root.getElementById("diag-scan-conflict") as HTMLElement | null;
  const resetBtn = (): void => {
    if (scanBtn) {
      scanBtn.classList.remove("scanning");
      scanBtn.textContent = "⚡ 开始扫描";
    }
  };
  if (scanBtn) {
    scanBtn.classList.add("scanning");
    scanBtn.textContent = "⏳ 扫描中...";
  }
  list.innerHTML =
    '<div class="scan-radar-wrap"><div class="scan-radar"></div><div class="scan-radar-dot"></div></div><div class="stat-row diag-msg diag-msg-muted" style="text-align:center">正在扫描整合包冲突...</div>';
  try {
    const { LoadAppConfig, ListVersionInstances, ScanModelEntriesWithLabel } =
      await getApp();
    const cfg = await LoadAppConfig();
    const mcRoot = cfg.mcRoot || "";
    if (!mcRoot) {
      resetBtn();
      list.innerHTML =
        '<div class="stat-row diag-msg diag-msg-error">请先配置游戏目录</div>';
      return;
    }

    const instances = (await ListVersionInstances(mcRoot)) || [];
    if (!instances || !instances.length) {
      resetBtn();
      list.innerHTML =
        '<div class="stat-row diag-msg diag-msg-muted">没有找到整合包</div>';
      return;
    }

    interface InstanceFile {
      name: string;
    }
    const instanceFiles: Record<string, InstanceFile[]> = {};
    for (const ins of instances) {
      if (!ins.Exists) continue;
      const entries = (await ScanModelEntriesWithLabel(ins.CustomDir, RESOURCE_TYPE_LABELS[RESOURCE_TYPES.YSM])) || [];
      instanceFiles[ins.Name] = entries.map((e) => ({
        name: e.Name.replace(/\.ban$/i, ""),
      }));
    }

    const nameMap: Record<string, string[]> = {};
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
      resetBtn();
      list.innerHTML =
        '<div class="stat-row diag-msg diag-msg-success">✅ 未检测到文件名冲突</div>';
      return;
    }

    let html = `<div class="stat-row diag-msg diag-msg-error" style="animation:conflictRowIn .3s ease">⚠️ 发现 ${conflicts.length} 个文件存在于多个整合包</div>`;
    conflicts.slice(0, 50).forEach(([name, insNames], i) => {
      const delay = Math.min(i * 30, 600);
      html += `<div class="conflict-row" style="animation-delay:${delay}ms">
<span class="conflict-name">${renderDisplayName(name)}</span>
<span class="conflict-ver">${insNames.length} 个整合包</span>
</div>`;
      insNames.forEach((n, j) => {
        html += `<div class="conflict-ins" style="animation-delay:${delay + (j + 1) * 15}ms">&nbsp;&nbsp;📦 ${esc(n)}</div>`;
      });
    });
    if (conflicts.length > 50) {
      html += `<div class="stat-row diag-msg diag-msg-muted" style="font-size:10px">...还有 ${conflicts.length - 50} 个</div>`;
    }
    resetBtn();
    list.innerHTML = html;
  } catch (err) {
    resetBtn();
    list.innerHTML = `<div class="stat-row diag-msg diag-msg-error">扫描失败: ${esc(String(err))}</div>`;
  }
}

/** 👴 资历最深 + 📊 仓库评分 + 🎲 每日推荐 + 热力图（已迁移到 features/oldest-models.ts） */
