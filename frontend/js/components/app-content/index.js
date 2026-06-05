// ===== <app-content> 入口 =====
import { bus } from "../../bus.js";
import { contentCSS } from "./content-css.js";
import {
  repositoryHTML,
  instancesHTML,
  settingsHTML,
  placeholderHTML,
  diagnosticsHTML,
  recycleHTML,
} from "./tpl.js";
import { registerGlobalHandlers } from "../../core/global-handlers.js";

class AppContent extends HTMLElement {
  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._root.adoptedStyleSheets = [new CSSStyleSheet()];
    this._root.adoptedStyleSheets[0].replaceSync(contentCSS);
    this._current = "instances";
    this._globalUnsubs = [];
  }

  connectedCallback() {
    this._unsub = bus.on("nav:change", ({ page }) => {
      this._current = page;
      bus.emit("nav:changed", { page });
      this._render();
    });
    this._render();
    this._globalUnsubs = registerGlobalHandlers();
  }

  disconnectedCallback() {
    if (this._unsub) this._unsub();
    this._globalUnsubs.forEach((fn) => fn());
  }

  _render() {
    let inner = "";
    switch (this._current) {
      case "repository":
        inner = repositoryHTML();
        break;
      case "instances":
        inner = instancesHTML();
        break;
      case "downloads":
        inner = placeholderHTML("⬇️", "下载与更新");
        break;
      case "recycle":
        inner = recycleHTML();
        break;
      case "diagnostics":
        inner = diagnosticsHTML();
        break;
      case "settings":
        inner = settingsHTML();
        break;
      default:
        inner = instancesHTML();
    }
    this._root.innerHTML = `<div class="page">${inner}</div>`;

    if (this._current === "diagnostics") {
      this._initDiagnostics();
    } else if (this._current === "recycle") {
      this._initRecycle();
    } else if (this._current === "settings") {
      this._initSettings();
    }
  }

  _initDiagnostics() {
    const root = this._root;

    root
      .getElementById("diag-refresh")
      ?.addEventListener("click", () => this._loadDiagnosticsLogs());
    root.getElementById("diag-clear")?.addEventListener("click", async () => {
      const { ClearImportLogs } =
        await import("../../../wailsjs/go/main/App.js");
      await ClearImportLogs();
      this._loadDiagnosticsLogs();
      bus.emit("toast:show", {
        msg: "🗑️ 日志已清空",
        duration: 2000,
        type: "info",
      });
    });
    root
      .getElementById("diag-scan-conflict")
      ?.addEventListener("click", () => this._scanConflicts());
    root
      .getElementById("diag-start-dedup")
      ?.addEventListener("click", () => this._startDedup());

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
        if (name === "log") this._loadDiagnosticsLogs();
      });
    });

    this._loadDiagnosticsLogs();
  }

  async _startDedup() {
    const list = this._root.getElementById("diag-dedup-list");
    if (!list) return;
    list.innerHTML =
      '<div class="stat-row" style="padding:12px;color:#6c7086;font-size:11px">⏳ 扫描仓库文件哈希...</div>';
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
      const confirmed = await window.showConfirm?.(
        `发现 ${totalDups} 个重复文件（${dupHashes.length} 组），移入回收站？`,
      );
      if (!confirmed) {
        list.innerHTML =
          '<div class="stat-row" style="padding:12px;color:#6c7086;font-size:11px">已取消去重</div>';
        return;
      }

      let del = 0,
        fail = 0;
      const detailList = [];
      for (const [, group] of dupHashes) {
        // 保留第一个，其余移入回收站
        for (let i = 1; i < group.length; i++) {
          try {
            await MoveToRecycle(group[i].Path);
            del++;
            detailList.push({ name: group[i].Name, type: "success" });
          } catch {
            fail++;
            detailList.push({ name: group[i].Name, type: "fail" });
          }
        }
      }

      if (del > 0) {
        bus.emit("stats:refresh");
        bus.emit("tree:reload");
      }
      list.innerHTML = `<div class="stat-row" style="padding:8px 12px;font-size:11px;color:${fail > 0 ? "#f9a826" : "#a6e3a1"}">
✅ 去重完成：移入回收站 ${del} 个，失败 ${fail} 个</div>`;
    } catch (err) {
      list.innerHTML = `<div class="stat-row" style="padding:12px;color:#f38ba8;font-size:11px">去重失败: ${this._esc(String(err))}</div>`;
    }
  }

  async _loadDiagnosticsLogs() {
    const list = this._root.getElementById("diag-log-list");
    if (!list) return;
    try {
      const { GetImportLogs } = await import("../../../wailsjs/go/main/App.js");
      const logs = await GetImportLogs();
      if (!logs || !logs.length) {
        list.innerHTML =
          '<div class="stat-row" style="padding:12px;color:#6c7086;font-size:11px">暂无日志</div>';
        return;
      }
      list.innerHTML = logs
        .slice(-500)
        .reverse()
        .map((l) => {
          const status =
            l.Status === "success"
              ? "success"
              : l.Status === "failed"
                ? "failed"
                : "skipped";
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
            l.ModelName +
            (l.TargetDir ? "<br>📂 " + this._esc(l.TargetDir) : "") +
            (l.ErrorMsg
              ? "<br>❌ " +
                this._esc(l.ErrorMsg).replace(
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
        '<div class="stat-row" style="padding:12px;color:#f38ba8;font-size:11px">加载日志失败</div>';
    }
  }

  async _scanConflicts() {
    const list = this._root.getElementById("diag-conflict-list");
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
<span class="conflict-name">${this._esc(name)}</span>
<span class="conflict-ver">${insNames.length} 个整合包</span>
</div>`;
        insNames.forEach((n) => {
          html += `<div class="conflict-ins">&nbsp;&nbsp;📦 ${this._esc(n)}</div>`;
        });
      });
      if (conflicts.length > 50) {
        html += `<div class="stat-row" style="padding:8px 12px;color:#6c7086;font-size:10px">...还有 ${conflicts.length - 50} 个</div>`;
      }
      list.innerHTML = html;
    } catch (err) {
      list.innerHTML = `<div class="stat-row" style="padding:12px;color:#f38ba8;font-size:11px">扫描失败: ${this._esc(String(err))}</div>`;
    }
  }

  _initRecycle() {
    const root = this._root;
    root
      .getElementById("recy-refresh")
      ?.addEventListener("click", () => this._loadRecycleBin());
    root.getElementById("recy-empty")?.addEventListener("click", async () => {
      const confirmed = await window.showConfirm?.(
        "确定永久清空回收站所有文件？此操作不可恢复！",
      );
      if (!confirmed) return;
      try {
        const { LoadAppConfig, EmptyRecycleBin } =
          await import("../../../wailsjs/go/main/App.js");
        const cfg = await LoadAppConfig();
        const repoRoot = cfg.repoRoot || "";
        if (!repoRoot) {
          bus.emit("toast:show", {
            msg: "请先设置仓库目录",
            duration: 3000,
            type: "warn",
          });
          return;
        }
        const n = await EmptyRecycleBin(repoRoot);
        bus.emit("toast:show", {
          msg: `🗑️ 已清空 ${n} 个文件`,
          duration: 3000,
          type: "success",
        });
        this._loadRecycleBin();
        bus.emit("stats:refresh");
        bus.emit("tree:reload");
      } catch (e) {
        bus.emit("toast:show", {
          msg: `❌ 清空失败: ${String(e)}`,
          duration: 5000,
          type: "error",
        });
      }
    });
    this._loadRecycleBin();
  }

  async _loadRecycleBin() {
    const list = this._root.getElementById("recy-list");
    const hint = this._root.getElementById("recy-empty-hint");
    const count = this._root.getElementById("recy-count");
    if (!list) return;
    try {
      const {
        LoadAppConfig,
        ListRecycleBin,
        RestoreFromRecycle,
        DeleteFromRecycle,
        EmptyRecycleBin,
      } = await import("../../../wailsjs/go/main/App.js");
      const cfg = await LoadAppConfig();
      const repoRoot = cfg.repoRoot || "";
      if (!repoRoot) {
        if (count) count.textContent = "请先设置仓库目录";
        return;
      }

      const entries = await ListRecycleBin(repoRoot);
      if (!entries || !entries.length) {
        list.innerHTML = "";
        if (hint) hint.style.display = "flex";
        if (count) count.textContent = "空";
        return;
      }
      if (hint) hint.style.display = "none";
      if (count) count.textContent = `${entries.length} 个文件`;

      list.innerHTML = entries
        .map((e) => {
          const name = e.Name.replace(/\.(ysm|zip|7z)\.ban$/i, ".$1");
          const size = e.Size ? this._fmtSize(e.Size) : "?";
          return `<div class="recy-item" style="display:flex;flex-direction:column;gap:2px;padding:5px 8px;border-radius:5px;background:var(--bg,#1e1e2e);font-size:11px">
<div style="display:flex;align-items:center;gap:6px">
<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt,#cdd6f4)" title="${this._esc(e.Path)}">${this._esc(name)}</span>
<span style="font-size:9px;color:var(--muted,#6c7086)">${size}</span>
<button class="recy-restore" data-path="${this._esc(e.Path)}" style="padding:2px 6px;border-radius:3px;border:1px solid var(--bd,#444);background:var(--surf,#2a2a42);color:var(--txt,#cdd6f4);cursor:pointer;font-size:9px">↩️ 恢复</button>
<button class="recy-del" data-path="${this._esc(e.Path)}" style="padding:2px 6px;border-radius:3px;border:1px solid #e5534b;background:transparent;color:#e5534b;cursor:pointer;font-size:9px">🗑️ 删除</button>
</div>
<div style="font-size:9px;color:var(--muted,#6c7086);padding-left:2px;word-break:break-all">📂 ${this._esc(e.Path)}</div>
</div>`;
        })
        .join("");

      // 恢复按钮
      list.querySelectorAll(".recy-restore").forEach((btn) => {
        btn.onclick = async () => {
          try {
            await RestoreFromRecycle(btn.dataset.path, repoRoot);
            bus.emit("toast:show", {
              msg: "✅ 已恢复",
              duration: 2000,
              type: "success",
            });
            this._loadRecycleBin();
            bus.emit("stats:refresh");
            bus.emit("tree:reload");
          } catch (e) {
            bus.emit("toast:show", {
              msg: `❌ 恢复失败: ${String(e)}`,
              duration: 3000,
              type: "error",
            });
          }
        };
      });

      // 删除按钮
      list.querySelectorAll(".recy-del").forEach((btn) => {
        btn.onclick = async () => {
          const confirmed = await window.showConfirm?.("确定永久删除此文件？");
          if (!confirmed) return;
          try {
            await DeleteFromRecycle(btn.dataset.path);
            this._loadRecycleBin();
            bus.emit("toast:show", {
              msg: "✅ 已删除",
              duration: 2000,
              type: "success",
            });
          } catch (e) {
            bus.emit("toast:show", {
              msg: `❌ 删除失败: ${String(e)}`,
              duration: 3000,
              type: "error",
            });
          }
        };
      });
    } catch (e) {
      list.innerHTML = `<div class="stat-row" style="padding:12px;color:#f38ba8;font-size:11px">❌ 读取回收站失败: ${this._esc(String(e))}</div>`;
      if (count) count.textContent = "加载失败";
    }
  }

  async _initSettings() {
    const root = this._root;
    try {
      const {
        LoadAppConfig,
        SaveAppConfig,
        SelectDirectory,
        GetMinecraftPath,
        SetLinkMode,
        GetLinkMode,
      } = await import("../../../wailsjs/go/main/App.js");
      const cfg = await LoadAppConfig();
      const mcPath = cfg.mcRoot || "";
      const repoPath = cfg.repoRoot || "";
      const linkMode = cfg.linkMode || "copy";

      // 显示当前值
      const mcEl = root.getElementById("set-mc-path");
      const repoEl = root.getElementById("set-repo-path");
      if (mcEl) mcEl.textContent = mcPath || "未设置";
      if (repoEl) repoEl.textContent = repoPath || "未设置";

      // 链接模式
      const lmRadio = root.querySelector(
        `input[name="link-mode"][value="${linkMode}"]`,
      );
      if (lmRadio) lmRadio.checked = true;

      // 主题：先读 Go 配置，再回退 localStorage
      let savedTheme = cfg.theme || cfg.Theme || "";
      if (!savedTheme) savedTheme = localStorage.getItem("theme") || "system";
      localStorage.setItem("theme", savedTheme);
      applyTheme(savedTheme);
      const themeSelect = root.getElementById("set-theme");
      if (themeSelect) themeSelect.value = savedTheme;

      // ===== 事件绑定 =====

      // 游戏路径 - 选择目录
      root
        .getElementById("set-mc-browse")
        ?.addEventListener("click", async () => {
          const dir = await SelectDirectory();
          if (!dir) return;
          const theme = localStorage.getItem("theme") || "dark";
          await SaveAppConfig(repoPath, dir, linkMode, theme);
          if (mcEl) mcEl.textContent = dir;
          // 广播配置变更
          bus.emit("config:updated");
          bus.emit("stats:refresh");
          bus.emit("toast:show", {
            msg: "✅ 游戏路径已设置",
            duration: 2000,
            type: "success",
          });
        });

      // 游戏路径 - 自动搜索
      root
        .getElementById("set-mc-detect")
        ?.addEventListener("click", async () => {
          const result = await GetMinecraftPath();
          // 返回格式如 "✅ 游戏路径: D:\PCL2\.minecraft" 或 "⚠️ 未找到"
          const match = result.match(/[✅⚠️]\s*游戏路径[:：]\s*(.+)/);
          if (match) {
            const found = match[1].trim();
            if (found) {
              const theme1 = localStorage.getItem("theme") || "dark";
              await SaveAppConfig(repoPath, found, linkMode, theme1);
              if (mcEl) mcEl.textContent = found;
              bus.emit("config:updated");
              bus.emit("stats:refresh");
              bus.emit("toast:show", {
                msg: `✅ 已自动检测到: ${found}`,
                duration: 3000,
                type: "success",
              });
              return;
            }
          }
          bus.emit("toast:show", {
            msg: result || "未找到 .minecraft 文件夹",
            duration: 3000,
            type: "warn",
          });
        });

      // 仓库路径
      root
        .getElementById("set-repo-browse")
        ?.addEventListener("click", async () => {
          const dir = await SelectDirectory();
          if (!dir) return;
          const theme = localStorage.getItem("theme") || "dark";
          await SaveAppConfig(dir, mcPath, linkMode, theme);
          if (repoEl) repoEl.textContent = dir;
          bus.emit("config:updated");
          bus.emit("stats:refresh");
          bus.emit("toast:show", {
            msg: "✅ 仓库路径已设置",
            duration: 2000,
            type: "success",
          });
        });

      // 链接模式变更
      root.querySelectorAll('input[name="link-mode"]').forEach((radio) => {
        radio.addEventListener("change", async () => {
          if (!radio.checked) return;
          const theme = localStorage.getItem("theme") || "dark";
          await SaveAppConfig(repoPath, mcPath, radio.value, theme);
          await SetLinkMode(radio.value);
          bus.emit("toast:show", {
            msg: `✅ 链接模式已切换至: ${radio.value}`,
            duration: 2000,
            type: "success",
          });
          // 询问是否重新链接已有模型
          const relink = await window.showConfirm?.(
            "是否将已有模型重新链接为新模式？\n（将删除整合包中已安装的模型副本，用新模式重新安装）",
          );
          if (!relink) return;
          try {
            const { LoadAppConfig, ListVersionInstances, RelinkCustomDir } =
              await import("../../../wailsjs/go/main/App.js");
            const cfg = await LoadAppConfig();
            const mcRoot = cfg.mcRoot || "";
            const rRoot = cfg.repoRoot || "";
            if (!mcRoot || !rRoot) return;
            const instances = await ListVersionInstances(mcRoot);
            let total = 0;
            for (const ins of instances) {
              if (!ins.Exists) continue;
              try {
                const n = await RelinkCustomDir(ins.CustomDir, rRoot);
                total += n;
              } catch {}
            }
            bus.emit("stats:refresh");
            bus.emit("toast:show", {
              msg: `🔄 已重新链接 ${total} 个文件`,
              duration: 3000,
              type: "success",
            });
          } catch (e) {
            bus.emit("toast:show", {
              msg: `❌ 重新链接失败: ${String(e)}`,
              duration: 5000,
              type: "error",
            });
          }
        });
      });

      // 主题切换
      root
        .getElementById("set-theme")
        ?.addEventListener("change", async (e) => {
          const mode = e.target.value;
          applyTheme(mode);
          localStorage.setItem("theme", mode);
          // 同步到 Go 配置
          try {
            const { SaveAppConfig } =
              await import("../../../wailsjs/go/main/App.js");
            const theme2 = localStorage.getItem("theme") || mode;
            await SaveAppConfig(repoPath, mcPath, linkMode, theme2);
          } catch {}
          const label =
            {
              cyber: "赛博霓虹",
              warm: "温暖木纹",
              pro: "极简深邃",
              system: "跟随系统",
            }[mode] || mode;
          bus.emit("toast:show", {
            msg: `✅ 主题已切换为: ${label}`,
            duration: 2000,
            type: "success",
          });
        });
    } catch (e) {
      console.error("[settings] 初始化失败:", e);
    }
  }

  _fmtSize(bytes) {
    if (!bytes) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  _esc(s) {
    return (s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}
customElements.define("app-content", AppContent);
