// ===== 设置页初始化（为 _initSettings 减负） =====
import { bus } from "../../../bus.ts";
import { loadTdKeymap, type TdKeyAction } from "../../../utils/3d/model3d.ts";
import { initVersionUpdater } from "../../../features/version-updater.ts";
import { friendlyError } from "../../../utils/dom/errors.ts";
import { loadResourceRegistry, type ResourceTypeEntry } from "../../../utils/resource/registry.ts";
import { esc } from "../../../utils/dom/html.ts";
import { safeGet, safeSet, safeRemove } from "../../../utils/dom/storage.ts";
import { getApp } from "../../../wails/app.ts";
import { t } from "../../../core/i18n/t.ts";

// 单一捕获守卫：同一时刻仅允许一个键位捕获，且设置页卸载后自动失效，杜绝全局 keydown 劫持
let _activeCapture: ((e: KeyboardEvent) => void) | null = null;

/**
 * 初始化设置页所有事件绑定
 * @param root - 组件 shadow root
 */
export async function initSettings(root: ShadowRoot): Promise<void> {
  const {
    LoadAppConfig,
    SaveAppConfig,
    SelectDirectory,
    GetMinecraftPaths,
    SetLinkMode,
  } = await getApp();
  const cfg = await LoadAppConfig();
  const mcPath = cfg.mcRoot || "";
  const linkMode = cfg.linkMode || "copy";

  // 从 Go 端 resource_types.json 加载注册表
  const reg = await loadResourceRegistry();

  // 所有路径卡片的刷新函数列表
  const _cardRefreshers: Array<() => void> = [];
  // 异步按钮防连点：目录选择/自动检测进行中忽略后续点击（finally 释放）
  let _busy = false;

  // P2 修复：async handler 统一错误出口（抽公共函数，避免 5 处相似 catch 块重复）
  const toastError = (e: unknown): void => {
    bus.emit("toast:show", {
      msg: "❌ " + friendlyError(e),
      duration: 5000,
      type: "error",
    });
  };

  // cfg 动态索引辅助（cfgKey 来自配置字段，类型收窄为字符串索引）
  const cfgAny = cfg as unknown as Record<string, unknown>;
  const cfgStr = (key: string): string => (typeof cfgAny[key] === "string" ? (cfgAny[key] as string) : "");

  // 工具：绑定路径卡片点击
  function bindPathClick(
    elId: string,
    getPath: () => string,
    onSelect: (dir: string) => Promise<void>,
  ): void {
    const el = root.getElementById(elId);
    if (!el) return;
    const refresh = (): void => {
      const p = getPath();
      el.textContent = p || t("settings.path.selectDir");
      el.style.color = p ? "" : "var(--accent)";
    };
    _cardRefreshers.push(refresh);
    el.addEventListener("click", async () => {
      if (_busy) return; // 防连点：目录选择进行中忽略后续点击
      _busy = true;
      try {
        const dir = await SelectDirectory();
        if (!dir) return;
        await onSelect(dir);
        refresh();
        refreshAdvanced();
        bus.emit("config:updated");
        bus.emit("stats:refresh");
        bus.emit("toast:show", {
          msg: t("settings.path.updated"),
          duration: 2000,
          type: "success",
        });
      } catch (e) {
        // P2 修复：SelectDirectory/onSelect 失败要有出口，避免 unhandled rejection 静默
        toastError(e);
      } finally {
        _busy = false;
      }
    });
    refresh();
  }

  // 保存 cfg 辅助（保留各字段原值）
  const saveCfg = async (patch: {
    filesRoot?: string;
    rpRoot?: string;
    mcRoot?: string;
    linkMode?: string;
  }): Promise<void> => {
    const theme = safeGet("theme") || "dark";
    await SaveAppConfig(
      patch.filesRoot !== undefined ? patch.filesRoot : cfg.filesRoot || "",
      patch.rpRoot !== undefined ? patch.rpRoot : cfg.resourcepackRoot || "",
      patch.mcRoot !== undefined ? patch.mcRoot : cfg.mcRoot || "",
      patch.linkMode !== undefined ? patch.linkMode : cfg.linkMode || "copy",
      theme,
    );
    if (patch.filesRoot !== undefined) cfg.filesRoot = patch.filesRoot;
    if (patch.rpRoot !== undefined) cfg.resourcepackRoot = patch.rpRoot;
    if (patch.mcRoot !== undefined) cfg.mcRoot = patch.mcRoot;
    if (patch.linkMode !== undefined) cfg.linkMode = patch.linkMode;
  };

  // 🎮 游戏根目录
  bindPathClick(
    "set-mc-path",
    () => cfg.mcRoot || "",
    async (dir) => {
      await saveCfg({ mcRoot: dir });
    },
  );

  // 📁 文件存储路径
  bindPathClick(
    "set-files-root",
    () => cfg.filesRoot || "",
    async (dir) => {
      await saveCfg({ filesRoot: dir });
    },
  );

  // 📂 详细调整面板
  // 从注册表构建高级设置条目
  interface AdvancedType {
    rtype: string;
    icon: string;
    name: string;
    cfgKey: string;
  }
  const advancedTypes: AdvancedType[] = Object.values(reg).map((entry: ResourceTypeEntry) => ({
    rtype: entry.id,
    icon: entry.icon as string,
    name: (entry.name as string) || entry.id,
    cfgKey: entry.configField
      ? String(entry.configField).charAt(0).toLowerCase() + String(entry.configField).slice(1)
      : "",
  }));

  const refreshAdvanced = async (): Promise<void> => {
    const grid = root.getElementById("set-advanced-grid");
    if (!grid) return;
    let html = "";
    for (const at of advancedTypes) {
      const canOverride = !!at.cfgKey;
      const overridePath = canOverride ? cfgStr(at.cfgKey) : "";
      const defaultPath = cfg.filesRoot
        ? cfg.filesRoot + "/" + (reg[at.rtype]?.storageSubDir || at.rtype || "")
        : t("settings.path.notSetStorage");
      const currentPath = overridePath || defaultPath;
      const isOverridden = !!overridePath;
      html +=
        '<div class="stg-card' +
        (isOverridden ? ' stg-card-overridden' : '') +
        '">' +
        '<div class="stg-card-hdr">' +
        "<span>" +
        at.icon +
        "</span><span>" +
        at.name +
        "</span>" +
        (isOverridden
          ? '<span class="stg-custom-badge">' + t("settings.path.customized") + '</span>'
          : "") +
        (isOverridden
          ? '<button class="btn stg-adv-reset" data-rtype="' +
            at.rtype +
            '" style="font-size:var(--fs-btn-tool);padding:2px 6px">↩️ ' + t("settings.path.default") + '</button>'
          : "") +
        "</div>" +
        '<div class="stg-card-body">' +
        '<div class="stg-card-val stg-adv-set stg-path-text" data-rtype="' +
        at.rtype +
        '" title="' + t("settings.path.clickToChange") + '">' +
        escHtml(currentPath) +
        "</div>" +
        "</div></div>";
    }
    grid.innerHTML = html;

    // 点击路径文字更改路径
    grid.querySelectorAll(".stg-adv-set").forEach((el) => {
      el.addEventListener("click", async () => {
        const rtype = (el as HTMLElement).dataset.rtype || "";
        const dir = await SelectDirectory();
        if (!dir) return;
        try {
          const { SetResourceRoot } =
            await getApp();
          await SetResourceRoot(rtype, dir);
          const found = advancedTypes.find((a) => a.rtype === rtype);
          if (found && found.cfgKey) cfgAny[found.cfgKey] = dir;
          refreshAdvanced();
          bus.emit("config:updated");
          bus.emit("toast:show", {
            msg: t("settings.path.set"),
            duration: 2000,
            type: "success",
          });
        } catch (e) {
          bus.emit("toast:show", {
            msg: "❌ " + friendlyError((e as Error)?.message || e, t("settings.saveFailed")),
            duration: 4000,
            type: "error",
          });
        }
      });
    });
    // 绑定 ↩️ 按钮
    grid.querySelectorAll(".stg-adv-reset").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const rtype = (btn as HTMLElement).dataset.rtype || "";
        try {
          const { ResetResourceRoot } =
            await getApp();
          await ResetResourceRoot(rtype);
          const found = advancedTypes.find((a) => a.rtype === rtype);
          if (found && found.cfgKey) cfgAny[found.cfgKey] = "";
          refreshAdvanced();
          _cardRefreshers.forEach((fn) => fn());
          bus.emit("config:updated");
          bus.emit("toast:show", {
            msg: t("settings.resetDefault"),
            duration: 2000,
            type: "success",
          });
        } catch (e) {
          bus.emit("toast:show", {
            msg: "❌ " + friendlyError((e as Error)?.message || e, t("settings.resetFailed")),
            duration: 4000,
            type: "error",
          });
        }
      });
    });
  };

  // 展开/折叠
  root
    .getElementById("set-advanced-toggle")
    ?.addEventListener("click", async () => {
      const panel = root.getElementById("set-advanced-panel") as HTMLElement | null;
      const btn = root.getElementById("set-advanced-toggle") as HTMLElement | null;
      const card = root.getElementById("stg-files-card") as HTMLElement | null;
      if (!panel || !btn || !card) return;
      const isOpen = panel.classList.contains("adv-open");
      if (isOpen) {
        panel.classList.remove("adv-open");
        panel.classList.add("adv-closing");
        btn.textContent = t("settings.expand");
        card.style.gridColumn = "";
        setTimeout(() => {
          panel.classList.remove("adv-closing");
          panel.style.display = "none";
        }, 200);
      } else {
        await refreshAdvanced();
        panel.style.display = "block";
        panel.classList.remove("adv-closing");
        panel.classList.add("adv-open");
        btn.textContent = t("settings.collapse");
        card.style.gridColumn = "1 / -1";
      }
    });

  // 初始刷新
  refreshAdvanced();

  // 游戏路径 - 自动搜索
  const detectBtn = root.getElementById("set-mc-detect") as HTMLElement | null;
  detectBtn?.addEventListener("click", async () => {
    if (_busy) return; // 防连点：检测进行中忽略后续点击
    _busy = true;
    try {
      const paths = await GetMinecraftPaths();
      if (!paths?.length) {
        bus.emit("toast:show", {
          msg: t("settings.mc.noFound"),
          duration: 3000,
          type: "warn",
        });
        return;
      }
      // 只有一个直接使用，多个让用户选
      let selected: string | null = paths[0];
      if (paths.length > 1) {
        selected = await showPathPicker(root, paths);
        if (!selected) return; // 用户取消
      }
      const theme = safeGet("theme") || "dark";
      await SaveAppConfig(
        cfg.filesRoot || "",
        cfg.resourcepackRoot || "",
        selected,
        cfg.linkMode || "copy",
        theme,
      );
      cfg.mcRoot = selected as string; // 语义上此处非空（单路径为 paths[0]，多路径已 return null）
      _cardRefreshers.forEach((fn) => {
        fn();
      });
      bus.emit("config:updated");
      bus.emit("stats:refresh");
      bus.emit("toast:show", {
        msg: "✅ 已设置: " + selected,
        duration: 3000,
        type: "success",
      });
    } catch (e) {
      // P2 修复：GetMinecraftPaths/SaveAppConfig 失败要有出口，避免 unhandled rejection 静默
      toastError(e);
    } finally {
      _busy = false;
    }
  });

  function showPathPicker(root: ShadowRoot, paths: string[]): Promise<string | null> {
    return new Promise(function (resolve) {
      const overlay = document.createElement("div");
      overlay.style.cssText =
        "position:fixed;z-index:var(--z-modal);inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center";
      const box = document.createElement("div");
      box.style.cssText =
        "background:var(--surf,#2a2a3a);border:1px solid var(--bd,#444);border-radius:12px;padding:16px;max-width:500px;width:90%;max-height:70vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.4)";
      let listHtml = "";
      for (let i = 0; i < paths.length; i++) {
        listHtml +=
          "<div class='mc-pick-item' data-idx='" +
          i +
          "' style='padding:8px 10px;border-radius:6px;cursor:pointer;font-size:var(--fs-sm,11px);color:var(--txt,#cdd6f4);display:flex;align-items:center;gap:8px;transition:background var(--tr-fast)' onmouseenter='this.style.background=\"var(--hover,#3a3a4a)\"' onmouseleave='this.style.background=\"\"'>" +
          "<span style='color:var(--accent,#89b4fa);flex-shrink:0'>📁</span>" +
          escHtml(paths[i]) +
          "</div>";
      }
      box.innerHTML =
        "<div style='font-weight:600;font-size:13px;margin-bottom:8px'>🔍 选择游戏目录</div>" +
        "<div style='font-size:10px;color:var(--muted,#888);margin-bottom:12px'>扫描到多个游戏目录，请选择要使用的：</div>" +
        listHtml +
        "<div style='margin-top:12px;text-align:right'>" +
        "<button class='mc-pick-cancel' style='padding:4px 12px;border-radius:4px;border:1px solid var(--bd,#444);background:transparent;color:var(--txt,#cdd6f4);cursor:pointer;font-size:var(--fs-sm,11px);font-family:inherit'>取消</button>" +
        "</div>";
      overlay.appendChild(box);
      (root.getRootNode() === document
        ? document.body
        : root.host?.parentElement || document.body
      ).appendChild(overlay);

      box.querySelectorAll(".mc-pick-item").forEach(function (el) {
        el.addEventListener("click", function () {
          const idx = parseInt((el as HTMLElement).dataset.idx || "0", 10);
          overlay.remove();
          resolve(paths[idx] || null);
        });
      });
      box
        .querySelector(".mc-pick-cancel")
        ?.addEventListener("click", function () {
          overlay.remove();
          resolve(null);
        });
    });
  }
  // hover 时预加载并显示扫描到的所有路径 + 搜索范围
  let _scanTooltip: HTMLElement | null = null;
  let _scanPaths: string[] | null = null;
  detectBtn?.addEventListener("mouseenter", async () => {
    if (_scanTooltip) return;
    if (!_scanPaths) _scanPaths = await GetMinecraftPaths();
    _scanTooltip = showScanTooltip(root, detectBtn, _scanPaths || []);
  });
  detectBtn?.addEventListener("mouseleave", () => {
    if (_scanTooltip) {
      _scanTooltip.remove();
      _scanTooltip = null;
    }
  });

  function showScanTooltip(
    root: ShadowRoot,
    anchor: HTMLElement,
    paths: string[],
  ): HTMLElement {
    const rect = anchor.getBoundingClientRect();
    const tip = document.createElement("div");
    tip.id = "mc-scan-tooltip";
    tip.style.cssText =
      "position:fixed;z-index:var(--z-toast);background:var(--surf,#2a2a3a);border:1px solid var(--bd,#444);border-radius:8px;padding:10px 14px;font-size:var(--fs-sm,11px);color:var(--txt,#cdd6f4);box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:420px;max-height:350px;overflow-y:auto;pointer-events:none;line-height:1.6";
    tip.style.left = Math.max(4, rect.left) + "px";
    tip.style.top = rect.bottom + 4 + "px";

    // 搜索范围
    let html =
      "<div style='font-weight:600;margin-bottom:4px'>🔍 扫描范围</div>" +
      "<div style='font-size:10px;color:var(--muted,#888);margin-bottom:8px;padding-left:4px'>" +
      "C 盘 ~ Z 盘 · 根目录 .minecraft / 各启动器目录<br>" +
      "ProgramFiles · Games · 用户配置目录 · EXE 同目录" +
      "</div>" +
      "<div style='border-top:1px solid var(--bd,#444);margin:6px 0'></div>";

    // 搜索结果
    if (!paths.length) {
      html +=
        "<div style='color:var(--muted,#888);padding:4px 0'>未找到已存在的游戏目录</div>" +
        "<div style='font-size:10px;color:var(--muted,#888);padding-top:2px'>💡 如果装了启动器但没扫到，可能是非常规路径，请手动选择</div>";
    } else {
      html +=
        "<div style='font-weight:600;margin-bottom:4px'>✅ 找到 " +
        paths.length +
        " 个</div>";
      for (let i = 0; i < paths.length; i++) {
        html +=
          "<div style='padding:1px 0;display:flex;align-items:center;gap:6px;font-size:10px'>" +
          "<span style='color:var(--accent,#89b4fa);flex-shrink:0'>📁</span>" +
          escHtml(paths[i]) +
          "</div>";
      }
    }

    tip.innerHTML = html;
    (root.getRootNode() === document
      ? document.body
      : root.host?.parentElement || document.body
    ).appendChild(tip);
    return tip;
  }

  function escHtml(s: unknown): string {
    return esc(String(s ?? ""));
  }

  // ADR-044 策略 A：主题段读写统一走 utils/dom/storage.ts 的 safeGet/safeSet——
  // 隐私模式（存储禁用）下 localStorage 抛错会中断 initSettings、整页失效。
  // 原局部 themeGet/themeSet 收敛为共享工具（app-modules 启动链同源实现）。

  // 主题卡片：直接点击切换
  const savedTheme = safeGet("theme") || "cyber";
  const themePicker = root.getElementById("theme-picker");
  if (themePicker) {
    themePicker.querySelectorAll(".theme-card").forEach((card) => {
      card.classList.toggle("active", (card as HTMLElement).dataset.theme === savedTheme);
      card.addEventListener("click", () => {
        themePicker.querySelectorAll(".theme-card").forEach((c) => c.classList.remove("active"));
        card.classList.add("active");
        const themeName = (card as HTMLElement).dataset.theme || "";
        window.applyTheme?.(themeName);
        safeSet("theme", themeName);
        // P2 修复：主题切后同步到 ysm_config.json，保持 localStorage ↔ JSON 一致
        void (async () => {
          try { await SaveAppConfig(cfg.filesRoot || "", cfg.resourcepackRoot || "", cfg.mcRoot || "", linkMode, themeName); } catch { /* 保存失败不影响 UI 主题 */ }
        })();
        // 关闭自动切换
        const autoSelect = root.getElementById("theme-auto") as HTMLSelectElement | null;
        if (autoSelect) autoSelect.value = "off";
        safeSet("theme-auto", "off");
      });
    });
  }

  // 自动切换下拉框
  // P2 修复（code_review）：theme-auto 段同样走 safe 包装——原裸 getItem 在隐私模式
  // 下抛错中断 initSettings（与主题卡片段同源），且 setItem 三处未封口
  const savedAuto = safeGet("theme-auto") || "off";
  const autoSelect = root.getElementById("theme-auto") as HTMLSelectElement | null;
  if (autoSelect) {
    autoSelect.value = savedAuto;
    autoSelect.addEventListener("change", () => {
      const mode = autoSelect.value;
      safeSet("theme-auto", mode);
      if (mode === "system") {
        window.applyTheme?.("system");
        safeSet("theme", "system");
        // 更新卡片选中态
        if (themePicker) themePicker.querySelectorAll(".theme-card").forEach((c) => c.classList.remove("active"));
      } else if (mode === "time") {
        // P2 修复：applyTimeTheme 返回实际主题（warm/cyber）并写入 theme 键——
        // 原实现写 "time" 非法值，重启后 initTheme 归一化为 system，按时间段模式被静默降级
        const themeName = applyTimeTheme();
        safeSet("theme", themeName);
        if (themePicker) themePicker.querySelectorAll(".theme-card").forEach((c) => c.classList.remove("active"));
      }
      // "off" 时不改变当前主题，等用户手动点卡片
    });
    // 初始化：如果 savedAuto 是 system/time，应用对应主题
    if (savedAuto === "system") {
      window.applyTheme?.("system");
    } else if (savedAuto === "time") {
      const themeName = applyTimeTheme();
      safeSet("theme", themeName);
    } else {
      window.applyTheme?.(savedTheme);
    }
  } else {
    window.applyTheme?.(savedTheme);
  }

  // 时间段主题切换：返回实际应用的主题名（warm 白天 / cyber 夜晚）
  function applyTimeTheme(): string {
    const hour = new Date().getHours();
    const isDay = hour >= 6 && hour < 18;
    const themeName = isDay ? "warm" : "cyber";
    window.applyTheme?.(themeName);
    return themeName;
  }

  // 镜像源
  const savedMirror = cfg.mirror || "";
  const mirrorSelect = root.getElementById("set-mirror") as HTMLSelectElement | null;
  if (mirrorSelect) {
    mirrorSelect.value = savedMirror;
    const initMirrorKey = savedMirror || "direct";
    ["direct", "jsdelivr", "githubapi"].forEach((m) => {
      const el = root.getElementById("mirror-hint-" + m);
      if (el) el.style.display = m === initMirrorKey ? "block" : "none";
    });
    mirrorSelect.addEventListener("change", async () => {
      const val = mirrorSelect.value;
      try {
        const { SetDownloadMirror } =
          await getApp();
        await SetDownloadMirror(val);
        bus.emit("toast:show", {
          msg:
            "✅ 下载源已切换为 " +
            (val === "jsdelivr"
              ? "jsDelivr CDN"
              : val === "githubapi"
                ? "GitHub API"
                : "直连"),
          duration: 2000,
          type: "success",
        });
      } catch (e) {
        // P2 修复：getApp/SetDownloadMirror 失败要有出口，避免 unhandled rejection 静默
        toastError(e);
      }
      ["direct", "jsdelivr", "githubapi"].forEach((m) => {
        const el = root.getElementById("mirror-hint-" + m);
        if (el) el.style.display = m === (val || "direct") ? "block" : "none";
      });
    });
  }

  // ===== 以下代码保持原样（链接模式/主题切换/关于等） =====
  // 链接模式提示切换
  const updateLinkHint = (mode: string): void => {
    ["copy", "hardlink", "symlink"].forEach((m) => {
      const el = root.getElementById("lm-hint-" + m);
      if (el) el.style.display = m === mode ? "block" : "none";
    });
  };
  updateLinkHint(linkMode);

  // 链接模式变更（下拉菜单）+ 重新应用按钮
  const doRelink = async (): Promise<void> => {
    if (_busy) return; // 防连点：重新链接进行中忽略后续点击（含链接模式切换并发触发）
    _busy = true;
    let failed = 0;
    try {
      const {
        LoadAppConfig,
        ListVersionInstances,
        RelinkAllInstanceResources,
      } = await getApp();
      const cfg2 = await LoadAppConfig();
      const mcRoot = cfg2.mcRoot || "";
      if (!mcRoot) {
        bus.emit("toast:show", { msg: "请先设置游戏根目录", duration: 2500, type: "warn" });
        return;
      }
      const instances = (await ListVersionInstances(mcRoot)) || [];
      let total = 0;
      for (const ins of instances) {
        if (!ins.Exists || !ins.Name) continue;
        try {
          total += await RelinkAllInstanceResources(ins.Name);
        } catch (e) {
          failed++;
          console.warn("[community] 重新链接失败:", ins.Name, e);
        }
      }
      bus.emit("stats:refresh");
      if (total === 0) {
        bus.emit("toast:show", {
          msg: failed > 0 ? `⚠️ ${failed} 个整合包重新链接失败` : "没有需要重新链接的文件",
          duration: 3000,
          type: failed > 0 ? "error" : "info",
        });
        return;
      }
      bus.emit("toast:show", {
        msg: failed > 0 ? `🔄 已重新链接 ${total} 个文件（${failed} 个失败）` : `🔄 已重新链接 ${total} 个文件`,
        duration: 3000,
        type: "success",
      });
    } catch (e) {
      bus.emit("toast:show", {
        msg: `❌ ${friendlyError(e)}`,
        duration: 5000,
        type: "error",
      });
    } finally {
      _busy = false;
    }
  };

  const linkSelect = root.getElementById("set-link-mode") as HTMLSelectElement | null;
  if (linkSelect) {
    linkSelect.value = linkMode;
    linkSelect.addEventListener("change", async () => {
      const val = linkSelect.value;
      updateLinkHint(val);
      try {
        const theme = safeGet("theme") || "dark";
        await SaveAppConfig(
          cfg.filesRoot || "",
          cfg.resourcepackRoot || "",
          cfg.mcRoot || "",
          val,
          theme,
        );
        await SetLinkMode(val);
        bus.emit("toast:show", {
          msg: `✅ 链接模式已切换至: ${val}`,
          duration: 2000,
          type: "success",
        });
        // 自动重新链接
        await doRelink();
      } catch (e) {
        // P2 修复：SaveAppConfig/SetLinkMode 失败要有出口，避免 unhandled rejection 静默
        toastError(e);
      }
    });
  }

  const relinkBtn = root.getElementById("set-relink") as HTMLElement | null;
  if (relinkBtn) {
    relinkBtn.addEventListener("click", doRelink);
  }

  // 显示版本号
  const showVersion = async (): Promise<void> => {
    try {
      const { CurrentVersion } =
        await getApp();
      const ver = await CurrentVersion();
      const el = root.getElementById("set-version");
      if (el) el.textContent = ver;
    } catch {
      /* 版本获取失败静默 */
    }
  };
  showVersion();

  // 检查更新
  initVersionUpdater(root);

  // 打开发布页
  root.getElementById("set-releases")?.addEventListener("click", () => {
    getApp().then(({ OpenInBrowser }) =>
      OpenInBrowser("https://github.com/eghrhegpe/ysm-model-manager/releases"),
    );
  });

  // ===== 界面与体验设置 =====

  // 读取/应用 UI 偏好（localStorage）
  // P2 修复（code_review）：UI 偏好读取同样走 themeGet——原裸 getItem 在隐私模式下
  // 抛错中断 initSettings（applyUIPref 是 initSettings 同步执行的一部分）
  const applyUIPref = (): void => {
    const fontSize = safeGet("ui-font-size") || "normal";
    const displayFont = safeGet("ui-display-font") || "kaiti";
    const density = safeGet("ui-card-density") || "compact";
    const anim = safeGet("ui-animations") !== "off";

    // 基准字号 — 通过 --fs-scale 控制，CSS 自动缩放所有 --fs-* 和 --space-*
    // 先清除旧版直接设 --fs-* 的内联值（避免覆盖 calc()）
    [
      "--fs-base",
      "--fs-xs",
      "--fs-sm",
      "--fs-md",
      "--fs-lg",
      "--fs-tiny",
      "--fs-xl",
    ].forEach((v) => document.documentElement.style.removeProperty(v));
    // 小=-1px, 标准=0px, 大=+2px
    const scaleMap: Record<string, string> = { small: "-1px", normal: "0px", large: "2px" };
    document.documentElement.style.setProperty(
      "--fs-scale",
      scaleMap[fontSize] || "0px",
    );
    // 同步更新 --fs-base-size（保持各字号参考基准一致）
    document.documentElement.style.setProperty("--fs-base-size", "12px");

    // 创作者名字字体
    document.documentElement.style.setProperty(
      "--font-display",
      displayFont === "system"
        ? "var(--font-ui)"
        : "'STKaiti','KaiTi','楷体',serif",
    );

    // 卡片密度
    const padding = density === "compact" ? "6px 10px" : "10px 14px";
    document.documentElement.style.setProperty("--card-padding", padding);
    const cardGap = density === "compact" ? "6px" : "10px";
    document.documentElement.style.setProperty("--card-gap", cardGap);

    // 动画
    document.documentElement.classList.toggle("no-animations", !anim);

    // 更新字号预览值
    updateSizePreview();
  };

  /**
   * 解析 CSS 变量的计算像素值（getComputedStyle 对 calc() 返回原始表达式，
   * 需要间接通过真实 CSS 属性读取）
   */
  const resolvePx = (varName: string): string => {
    const d = document.body;
    const orig = d.style.paddingTop;
    d.style.paddingTop = "var(" + varName + ")";
    const val = getComputedStyle(d).paddingTop;
    d.style.paddingTop = orig;
    return val;
  };

  /**
   * 读取当前 --fs-* 和 --space-* 的计算值并显示
   */
  const updateSizePreview = (): void => {
    const base = resolvePx("--fs-base");
    const spaceMd = resolvePx("--space-md");
    const spaceSm = resolvePx("--space-sm");
    const fsSm = resolvePx("--fs-sm");

    // 按钮高示例：secondary 按钮 = padding-v(space-sm) * 2 + font-size * 1.4
    const basePx = parseFloat(base);
    const mdPx = parseFloat(spaceMd);
    const smPx = parseFloat(spaceSm);
    const smFontPx = parseFloat(fsSm);
    const btnH = Math.round(smPx * 2 + smFontPx * 1.4) + "px";

    const szBase = root.querySelector("#sz-base");
    const szSpace = root.querySelector("#sz-space");
    const szBtn = root.querySelector("#sz-btn-h");
    if (szBase) szBase.textContent = basePx ? Math.round(basePx) + "px" : base;
    if (szSpace) szSpace.textContent = mdPx ? Math.round(mdPx) + "px" : spaceMd;
    if (szBtn) szBtn.textContent = btnH;
  };

  // 初始化 UI 控件值
  root.getElementById("set-font-size") &&
    ((root.getElementById("set-font-size") as HTMLSelectElement).value =
      safeGet("ui-font-size") || "normal");
  root.getElementById("set-display-font") &&
    ((root.getElementById("set-display-font") as HTMLSelectElement).value =
      safeGet("ui-display-font") || "kaiti");
  root.getElementById("set-card-density") &&
    ((root.getElementById("set-card-density") as HTMLSelectElement).value =
      safeGet("ui-card-density") || "compact");
  root.getElementById("set-animations") &&
    ((root.getElementById("set-animations") as HTMLInputElement).checked =
      safeGet("ui-animations") !== "off");
  // 启动默认页面：显示「实际生效」的值——有显式配置用配置，否则回退
  // resolveInitialPage 的默认结果（仓库页）。旧写法 || "instances" 会显示
  // 一个从未生效的死默认值，与真实启动页不符（死设置遗留 bug）。
  root.getElementById("set-default-page") &&
    ((root.getElementById("set-default-page") as HTMLSelectElement).value =
      safeGet("ui-default-page") || "repository");

  applyUIPref();

  // 基准字号变更
  root.getElementById("set-font-size")?.addEventListener("change", (e) => {
    safeSet("ui-font-size", (e.target as HTMLSelectElement).value);
    applyUIPref();
    bus.emit("toast:show", {
      msg: "✅ 字号已更新",
      duration: 1500,
      type: "success",
    });
  });

  // 创作者字体变更
  root.getElementById("set-display-font")?.addEventListener("change", (e) => {
    safeSet("ui-display-font", (e.target as HTMLSelectElement).value);
    applyUIPref();
    bus.emit("toast:show", {
      msg: "✅ 字体已更新",
      duration: 1500,
      type: "success",
    });
  });

  // 卡片密度变更
  root.getElementById("set-card-density")?.addEventListener("change", (e) => {
    safeSet("ui-card-density", (e.target as HTMLSelectElement).value);
    applyUIPref();
    bus.emit("toast:show", {
      msg: "✅ 卡片密度已更新",
      duration: 1500,
      type: "success",
    });
  });

  // 动画开关
  root.getElementById("set-animations")?.addEventListener("change", (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    safeSet("ui-animations", checked ? "on" : "off");
    applyUIPref();
    bus.emit("toast:show", {
      msg: checked ? "✅ 动画已开启" : "✅ 动画已关闭",
      duration: 1500,
      type: "success",
    });
  });

  // 默认页面变更
  root.getElementById("set-default-page")?.addEventListener("change", (e) => {
    safeSet("ui-default-page", (e.target as HTMLSelectElement).value);
    bus.emit("toast:show", {
      msg: "✅ 默认页面已保存",
      duration: 1500,
      type: "success",
    });
  });

  // ===== 3D 预览操作（持久化于 localStorage，与 model3d.ts 同源） =====
  const TD_ACTIONS: Array<{ key: TdKeyAction; label: string }> = [
    { key: "forward", label: "前移" },
    { key: "back", label: "后移" },
    { key: "left", label: "左移" },
    { key: "right", label: "右移" },
    { key: "up", label: "上升" },
    { key: "down", label: "下降" },
  ];
  const tdKeyLabel = (code: string): string => {
    if (!code) return "—";
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    if (code.startsWith("Numpad")) return "Num " + code.slice(6);
    const map: Record<string, string> = {
      Space: "空格",
      ShiftLeft: "Shift",
      ShiftRight: "Shift(右)",
      ControlLeft: "Ctrl",
      ControlRight: "Ctrl(右)",
      AltLeft: "Alt",
      AltRight: "Alt(右)",
      ArrowUp: "↑",
      ArrowDown: "↓",
      ArrowLeft: "←",
      ArrowRight: "→",
      Tab: "Tab",
      Enter: "Enter",
      Backspace: "⌫",
    };
    return map[code] || code;
  };
  const tdSaveKeymap = (km: Record<TdKeyAction, string>): void => {
    safeSet("td-keymap", JSON.stringify(km));
  };
  const tdRenderKeymap = (): void => {
    // 重建网格前取消任何进行中的捕获，避免叠加/残留
    if (_activeCapture) {
      document.removeEventListener("keydown", _activeCapture, true);
      _activeCapture = null;
    }
    const grid = root.getElementById("td-keymap-grid");
    if (!grid) return;
    const km = loadTdKeymap();
    grid.innerHTML = "";
    TD_ACTIONS.forEach(({ key, label }) => {
      const row = document.createElement("div");
      row.style.cssText =
        "display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:var(--fs-sm)";
      const name = document.createElement("span");
      name.textContent = label;
      name.style.color = "var(--muted)";
      const btn = document.createElement("button");
      btn.className = "btn-base sm";
      btn.textContent = tdKeyLabel(km[key]);
      btn.style.minWidth = "64px";
      btn.addEventListener("click", () => {
        // 取消上一次未完成的捕获，保证同一时刻仅一个
        if (_activeCapture) {
          document.removeEventListener("keydown", _activeCapture, true);
          _activeCapture = null;
        }
        btn.textContent = "按键…";
        const onKey = (ev: KeyboardEvent): void => {
          // 设置页已卸载（grid 不存在）则放弃捕获，先判后拦截，杜绝全局 keydown 劫持
          if (!root.getElementById("td-keymap-grid")) {
            document.removeEventListener("keydown", onKey, true);
            _activeCapture = null;
            return;
          }
          ev.preventDefault();
          ev.stopPropagation();
          document.removeEventListener("keydown", onKey, true);
          _activeCapture = null;
          if (ev.code === "Escape") {
            tdRenderKeymap();
            return;
          }
          const cur = loadTdKeymap();
          const conflict = TD_ACTIONS.find((a) => a.key !== key && cur[a.key] === ev.code);
          if (conflict) {
            bus.emit("toast:show", {
              msg: `⚠️ ${tdKeyLabel(ev.code)} 已被「${conflict.label}」占用`,
              duration: 2500,
              type: "warn",
            });
            tdRenderKeymap();
            return;
          }
          cur[key] = ev.code;
          tdSaveKeymap(cur);
          tdRenderKeymap();
          bus.emit("toast:show", {
            msg: `✅ ${label} → ${tdKeyLabel(ev.code)}`,
            duration: 1500,
            type: "success",
          });
        };
        _activeCapture = onKey;
        document.addEventListener("keydown", onKey, true);
      });
      row.appendChild(name);
      row.appendChild(btn);
      grid.appendChild(row);
    });
  };
  tdRenderKeymap();
  root.getElementById("td-keymap-reset")?.addEventListener("click", () => {
    safeRemove("td-keymap");
    tdRenderKeymap();
    bus.emit("toast:show", {
      msg: "↩️ 已恢复默认键位",
      duration: 1500,
      type: "success",
    });
  });

  // 相机移动速度
  const csEl = root.getElementById("td-camspeed") as HTMLInputElement | null;
  const csVal = root.getElementById("td-camspeed-val");
  if (csEl) {
    csEl.value = safeGet("td-cam-speed") || "20";
    if (csVal) csVal.textContent = csEl.value;
    csEl.addEventListener("input", () => {
      if (csVal) csVal.textContent = csEl!.value;
      safeSet("td-cam-speed", csEl!.value);
    });
  }
  // 默认旋转模式
  const rmEl = root.getElementById("td-rotmode") as HTMLSelectElement | null;
  if (rmEl) {
    rmEl.value = safeGet("td-rot-mode") === "free" ? "free" : "orbit";
    rmEl.addEventListener("change", () => {
      safeSet("td-rot-mode", rmEl.value);
    });
  }

  // ── 语言切换（ADR-045）──
  const langSelect = root.getElementById("set-lang") as HTMLSelectElement | null;
  if (langSelect) {
    const { getLang, setLang } = await import("../../../core/i18n/locale.ts");
    langSelect.value = getLang();
    langSelect.addEventListener("change", async () => {
      try {
        await setLang(langSelect.value as "zh-CN" | "en" | "ja");
      } catch (e) {
        // P2 修复：语言包加载失败要有出口，避免 unhandled rejection 静默
        toastError(e);
      }
      // 热切换（ADR-045 增强）：不再整页 reload——setLang 内部 emit lang:changed，
      // app-content 全局订阅后重渲染当前页（t() 读取新语言包），保留应用状态
    });
  }
}
