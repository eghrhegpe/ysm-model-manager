// ===== 设置页初始化（为 _initSettings 减负） =====
import { bus } from "../../../bus.ts";
import { initVersionUpdater } from "../../../features/version-updater.ts";
import { friendlyError } from "../../../utils/errors.ts";
import { loadResourceRegistry, type ResourceTypeEntry } from "../../../utils/resource-registry.ts";
import { esc } from "../../../utils/dom.ts";

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
  } = await import("../../../../bindings/ysm-model-manager/internal/app/app.js");
  const cfg = await LoadAppConfig();
  const mcPath = cfg.mcRoot || "";
  const linkMode = cfg.linkMode || "copy";

  // 从 Go 端 resource_types.json 加载注册表
  const reg = await loadResourceRegistry();

  // 所有路径卡片的刷新函数列表
  const _cardRefreshers: Array<() => void> = [];
  // 异步按钮防连点：目录选择/自动检测进行中忽略后续点击（finally 释放）
  let _busy = false;

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
      el.textContent = p || "📂 选择目录";
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
          msg: "✅ 路径已更新",
          duration: 2000,
          type: "success",
        });
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
    const theme = localStorage.getItem("theme") || "dark";
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
  const advancedTypes: AdvancedType[] = Object.values(reg).map((t: ResourceTypeEntry) => ({
    rtype: t.id,
    icon: t.icon as string,
    name: (t.name as string) || t.id,
    cfgKey: t.configField
      ? String(t.configField).charAt(0).toLowerCase() + String(t.configField).slice(1)
      : "",
  }));

  const refreshAdvanced = async (): Promise<void> => {
    const grid = root.getElementById("set-advanced-grid");
    if (!grid) return;
    let html = "";
    for (const t of advancedTypes) {
      const canOverride = !!t.cfgKey;
      const overridePath = canOverride ? cfgStr(t.cfgKey) : "";
      const defaultPath = cfg.filesRoot
        ? cfg.filesRoot + "/" + (reg[t.rtype]?.storageSubDir || t.rtype || "")
        : "未设置文件存储路径";
      const currentPath = overridePath || defaultPath;
      const isOverridden = !!overridePath;
      html +=
        '<div class="stg-card' +
        (isOverridden ? ' stg-card-overridden' : '') +
        '">' +
        '<div class="stg-card-hdr">' +
        "<span>" +
        t.icon +
        "</span><span>" +
        t.name +
        "</span>" +
        (isOverridden
          ? '<span class="stg-custom-badge">已自定义</span>'
          : "") +
        (isOverridden
          ? '<button class="btn stg-adv-reset" data-rtype="' +
            t.rtype +
            '" style="font-size:var(--fs-btn-tool);padding:2px 6px">↩️ 默认</button>'
          : "") +
        "</div>" +
        '<div class="stg-card-body">' +
        '<div class="stg-card-val stg-adv-set stg-path-text" data-rtype="' +
        t.rtype +
        '" title="点击更改路径">' +
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
            await import("../../../../bindings/ysm-model-manager/internal/app/app.js");
          await SetResourceRoot(rtype, dir);
          const entry = advancedTypes.find((t) => t.rtype === rtype);
          if (entry && entry.cfgKey) cfgAny[entry.cfgKey] = dir;
          refreshAdvanced();
          bus.emit("config:updated");
          bus.emit("toast:show", {
            msg: "✅ 路径已设置",
            duration: 2000,
            type: "success",
          });
        } catch (e) {
          bus.emit("toast:show", {
            msg: "❌ " + friendlyError((e as Error)?.message || e, "保存失败"),
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
            await import("../../../../bindings/ysm-model-manager/internal/app/app.js");
          await ResetResourceRoot(rtype);
          const entry = advancedTypes.find((t) => t.rtype === rtype);
          if (entry && entry.cfgKey) cfgAny[entry.cfgKey] = "";
          refreshAdvanced();
          _cardRefreshers.forEach((fn) => fn());
          bus.emit("config:updated");
          bus.emit("toast:show", {
            msg: "↩️ 已恢复默认",
            duration: 2000,
            type: "success",
          });
        } catch (e) {
          bus.emit("toast:show", {
            msg: "❌ " + friendlyError((e as Error)?.message || e, "重置失败"),
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
        btn.textContent = "📂 展开 ▸";
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
        btn.textContent = "📂 收起 ▾";
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
          msg: "未找到已存在的游戏目录，请手动选择",
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
      const theme = localStorage.getItem("theme") || "dark";
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
      "ProgramFiles · Games · %APPDATA% · EXE 同目录" +
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

  // 主题卡片：直接点击切换
  const savedTheme = localStorage.getItem("theme") || "cyber";
  const themePicker = root.getElementById("theme-picker");
  if (themePicker) {
    themePicker.querySelectorAll(".theme-card").forEach((card) => {
      card.classList.toggle("active", (card as HTMLElement).dataset.theme === savedTheme);
      card.addEventListener("click", () => {
        themePicker.querySelectorAll(".theme-card").forEach((c) => c.classList.remove("active"));
        card.classList.add("active");
        const themeName = (card as HTMLElement).dataset.theme || "";
        window.applyTheme?.(themeName);
        localStorage.setItem("theme", themeName);
        // 关闭自动切换
        const autoSelect = root.getElementById("theme-auto") as HTMLSelectElement | null;
        if (autoSelect) autoSelect.value = "off";
        localStorage.setItem("theme-auto", "off");
      });
    });
  }

  // 自动切换下拉框
  const savedAuto = localStorage.getItem("theme-auto") || "off";
  const autoSelect = root.getElementById("theme-auto") as HTMLSelectElement | null;
  if (autoSelect) {
    autoSelect.value = savedAuto;
    autoSelect.addEventListener("change", () => {
      const mode = autoSelect.value;
      localStorage.setItem("theme-auto", mode);
      if (mode === "system") {
        window.applyTheme?.("system");
        localStorage.setItem("theme", "system");
        // 更新卡片选中态
        if (themePicker) themePicker.querySelectorAll(".theme-card").forEach((c) => c.classList.remove("active"));
      } else if (mode === "time") {
        applyTimeTheme();
        localStorage.setItem("theme", "time");
        if (themePicker) themePicker.querySelectorAll(".theme-card").forEach((c) => c.classList.remove("active"));
      }
      // "off" 时不改变当前主题，等用户手动点卡片
    });
    // 初始化：如果 savedAuto 是 system/time，应用对应主题
    if (savedAuto === "system") {
      window.applyTheme?.("system");
    } else if (savedAuto === "time") {
      applyTimeTheme();
    } else {
      window.applyTheme?.(savedTheme);
    }
  } else {
    window.applyTheme?.(savedTheme);
  }

  // 时间段主题切换
  function applyTimeTheme(): void {
    const hour = new Date().getHours();
    const isDay = hour >= 6 && hour < 18;
    window.applyTheme?.(isDay ? "warm" : "cyber");
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
      const { SetDownloadMirror } =
        await import("../../../../bindings/ysm-model-manager/internal/app/app.js");
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
    try {
      const {
        LoadAppConfig,
        ListVersionInstances,
        RelinkAllInstanceResources,
      } = await import("../../../../bindings/ysm-model-manager/internal/app/app.js");
      const cfg2 = await LoadAppConfig();
      const mcRoot = cfg2.mcRoot || "";
      if (!mcRoot) return;
      const instances = (await ListVersionInstances(mcRoot)) || [];
      let total = 0;
      for (const ins of instances) {
        if (!ins.Exists) continue;
        try {
          const n = await RelinkAllInstanceResources(ins.Name);
          total += n;
        } catch {
          /* 单实例失败不影响其余 */
        }
      }
      bus.emit("stats:refresh");
      bus.emit("toast:show", {
        msg: `🔄 已重新链接 ${total} 个文件`,
        duration: 3000,
        type: "success",
      });
    } catch (e) {
      bus.emit("toast:show", {
        msg: `❌ ${friendlyError(e)}`,
        duration: 5000,
        type: "error",
      });
    }
  };

  const linkSelect = root.getElementById("set-link-mode") as HTMLSelectElement | null;
  if (linkSelect) {
    linkSelect.value = linkMode;
    linkSelect.addEventListener("change", async () => {
      const val = linkSelect.value;
      updateLinkHint(val);
      const theme = localStorage.getItem("theme") || "dark";
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
        await import("../../../../bindings/ysm-model-manager/internal/app/app.js");
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
    import("../../../../bindings/ysm-model-manager/internal/app/app.js").then(({ OpenInBrowser }) =>
      OpenInBrowser("https://github.com/eghrhegpe/ysm-model-manager/releases"),
    );
  });

  // ===== 界面与体验设置 =====

  // 读取/应用 UI 偏好（localStorage）
  const applyUIPref = (): void => {
    const fontSize = localStorage.getItem("ui-font-size") || "normal";
    const displayFont = localStorage.getItem("ui-display-font") || "kaiti";
    const density = localStorage.getItem("ui-card-density") || "compact";
    const anim = localStorage.getItem("ui-animations") !== "off";

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
      localStorage.getItem("ui-font-size") || "normal");
  root.getElementById("set-display-font") &&
    ((root.getElementById("set-display-font") as HTMLSelectElement).value =
      localStorage.getItem("ui-display-font") || "kaiti");
  root.getElementById("set-card-density") &&
    ((root.getElementById("set-card-density") as HTMLSelectElement).value =
      localStorage.getItem("ui-card-density") || "compact");
  root.getElementById("set-animations") &&
    ((root.getElementById("set-animations") as HTMLInputElement).checked =
      localStorage.getItem("ui-animations") !== "off");
  root.getElementById("set-default-page") &&
    ((root.getElementById("set-default-page") as HTMLSelectElement).value =
      localStorage.getItem("ui-default-page") || "instances");

  applyUIPref();

  // 基准字号变更
  root.getElementById("set-font-size")?.addEventListener("change", (e) => {
    localStorage.setItem("ui-font-size", (e.target as HTMLSelectElement).value);
    applyUIPref();
    bus.emit("toast:show", {
      msg: "✅ 字号已更新",
      duration: 1500,
      type: "success",
    });
  });

  // 创作者字体变更
  root.getElementById("set-display-font")?.addEventListener("change", (e) => {
    localStorage.setItem("ui-display-font", (e.target as HTMLSelectElement).value);
    applyUIPref();
    bus.emit("toast:show", {
      msg: "✅ 字体已更新",
      duration: 1500,
      type: "success",
    });
  });

  // 卡片密度变更
  root.getElementById("set-card-density")?.addEventListener("change", (e) => {
    localStorage.setItem("ui-card-density", (e.target as HTMLSelectElement).value);
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
    localStorage.setItem("ui-animations", checked ? "on" : "off");
    applyUIPref();
    bus.emit("toast:show", {
      msg: checked ? "✅ 动画已开启" : "✅ 动画已关闭",
      duration: 1500,
      type: "success",
    });
  });

  // 默认页面变更
  root.getElementById("set-default-page")?.addEventListener("change", (e) => {
    localStorage.setItem("ui-default-page", (e.target as HTMLSelectElement).value);
    bus.emit("toast:show", {
      msg: "✅ 默认页面已保存",
      duration: 1500,
      type: "success",
    });
  });
}
