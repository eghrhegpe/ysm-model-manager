// ===== 设置页初始化（为 _initSettings 减负） =====
import { bus } from "../../bus.js";
import { initVersionUpdater } from "../../features/version-updater.js";

/**
 * 初始化设置页所有事件绑定
 * @param {ShadowRoot} root - 组件 shadow root
 */
export async function initSettings(root) {
  const {
    LoadAppConfig,
    SaveAppConfig,
    SelectDirectory,
    GetMinecraftPaths,
    SetLinkMode,
    SelectRpDirectory,
  } = await import("../../../wailsjs/go/main/App.js");
  const cfg = await LoadAppConfig();
  const mcPath = cfg.mcRoot || "";
  const repoPath = cfg.repoRoot || "";
  const rpPath = cfg.resourcepackRoot || "";
  const linkMode = cfg.linkMode || "copy";

  // 所有路径卡片的刷新函数列表
  const _cardRefreshers = [];

  // 工具：绑定路径卡片点击
  // elId: 元素 ID, getPath: 获取当前路径的函数, onSelect: 选择目录后的保存回调
  function bindPathClick(elId, getPath, onSelect) {
    const el = root.getElementById(elId);
    if (!el) return;
    const refresh = () => {
      const p = getPath();
      el.textContent = p || "📂 选择目录";
      el.style.color = p ? "" : "var(--accent)";
    };
    _cardRefreshers.push(refresh);
    el.addEventListener("click", async () => {
      const dir = await SelectDirectory();
      if (!dir) return;
      await onSelect(dir);
      refresh();
      bus.emit("config:updated");
      bus.emit("stats:refresh");
      bus.emit("toast:show", {
        msg: "✅ 路径已更新",
        duration: 2000,
        type: "success",
      });
    });
    refresh();
  }

  // 绑定所有路径卡片
  bindPathClick(
    "set-mc-path",
    () => cfg.mcRoot || "",
    async (dir) => {
      const theme = localStorage.getItem("theme") || "dark";
      await SaveAppConfig(
        cfg.repoRoot || "",
        cfg.resourcepackRoot || "",
        dir,
        cfg.linkMode || "copy",
        theme,
      );
      cfg.mcRoot = dir;
    },
  );

  bindPathClick(
    "set-repo-path",
    () =>
      cfg.repoRoot ||
      (cfg.mcRoot
        ? cfg.mcRoot.replace(/\//g, "\\") + "\\config\\yes_steve_model\\custom"
        : ""),
    async (dir) => {
      const theme = localStorage.getItem("theme") || "dark";
      await SaveAppConfig(
        dir,
        cfg.resourcepackRoot || "",
        cfg.mcRoot || "",
        cfg.linkMode || "copy",
        theme,
      );
      cfg.repoRoot = dir;
    },
  );

  bindPathClick(
    "set-rp-path",
    () =>
      cfg.resourcepackRoot ||
      (cfg.mcRoot ? cfg.mcRoot.replace(/\//g, "\\") + "\\resourcepacks" : ""),
    async (dir) => {
      const theme = localStorage.getItem("theme") || "dark";
      await SaveAppConfig(
        cfg.repoRoot || "",
        dir,
        cfg.mcRoot || "",
        cfg.linkMode || "copy",
        theme,
      );
      cfg.resourcepackRoot = dir;
    },
  );

  // 纯展示路径（由 mcRoot 派生，不可独立设置）
  // 可点击的派生路径（选目录后用 SetResourceRoot 持久化）
  const rtypeKeyMap = {
    resourcepack: "resourcepackRoot",
    shaderpack: "shaderpackRoot",
    "create-blueprint": "schematicRoot",
    "mmd-skin": "mmdRoot",
    "vrchat-avatar": "vrcRoot",
  };
  function bindDerived(elId, rtype) {
    const el = root.getElementById(elId);
    if (!el) return;
    const key = rtypeKeyMap[rtype];
    const refresh = () => {
      const p = cfg[key] || (cfg.mcRoot ? mcDerivedPath(rtype) : "") || "";
      el.textContent = p ? p.replace(/\//g, "\\") : "待设置 MC 根目录";
      el.title = p.replace(/\//g, "\\") || "";
    };
    // 重置按钮
    const resetBtn = document.createElement("button");
    resetBtn.className = "btn";
    resetBtn.textContent = "↩️ 默认";
    resetBtn.style.cssText =
      "font-size:var(--fs-btn-tool);padding:var(--pad-btn-tool) 8px;margin-left:6px";
    resetBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        const { ResetResourceRoot } =
          await import("../../../wailsjs/go/main/App.js");
        await ResetResourceRoot(rtype);
        cfg[key] = "";
        refresh();
        bus.emit("config:updated");
        bus.emit("toast:show", {
          msg: "✅ 已恢复默认",
          duration: 2000,
          type: "success",
        });
      } catch (e) {
        bus.emit("toast:show", {
          msg: "❌ 重置失败: " + (e.message || String(e)),
          duration: 4000,
          type: "error",
        });
      }
    });
    // 重置按钮 → 放入卡片标题栏右侧
    const card = el.closest(".stg-card");
    if (card) {
      const hdr = card.querySelector(".stg-card-hdr");
      if (hdr) {
        hdr.style.display = "flex";
        hdr.style.alignItems = "center";
        hdr.style.justifyContent = "space-between";
        hdr.appendChild(resetBtn);
      }
    }

    el.classList.add("derived");
    el.addEventListener("click", async () => {
      const dir = await SelectDirectory();
      if (!dir) return;
      try {
        const { SetResourceRoot } =
          await import("../../../wailsjs/go/main/App.js");
        await SetResourceRoot(rtype, dir);
        cfg[key] = dir;
        refresh();
        bus.emit("config:updated");
        bus.emit("toast:show", {
          msg: "✅ 路径已设置",
          duration: 2000,
          type: "success",
        });
      } catch (e) {
        bus.emit("toast:show", {
          msg: "❌ 保存失败: " + (e.message || String(e)),
          duration: 4000,
          type: "error",
        });
      }
    });
    _cardRefreshers.push(refresh);
    refresh();
  }
  const mcDerivedPath = (rtype) => {
    const map = {
      resourcepack: "resourcepacks",
      shaderpack: "shaderpacks",
      "create-blueprint": "schematics",
      "mmd-skin": "3d-skin\\EntityPlayer",
      "vrchat-avatar": "vrchat-avatars",
    };
    return cfg.mcRoot
      ? cfg.mcRoot.replace(/\\/g, "\\") + "\\" + map[rtype]
      : "";
  };
  bindDerived("set-rp-path", "resourcepack");
  bindDerived("set-sp-path", "shaderpack");
  bindDerived("set-schem-path", "create-blueprint");
  bindDerived("set-mmd-path", "mmd-skin");
  bindDerived("set-vrc-path", "vrchat-avatar");

  // 游戏路径 - 自动搜索
  root.getElementById("set-mc-detect")?.addEventListener("click", async () => {
    const paths = await GetMinecraftPaths();
    if (paths?.length) {
      const found = paths[0];
      const theme = localStorage.getItem("theme") || "dark";
      await SaveAppConfig(
        cfg.repoRoot || "",
        cfg.resourcepackRoot || "",
        found,
        cfg.linkMode || "copy",
        theme,
      );
      cfg.mcRoot = found;
      _cardRefreshers.forEach((fn) => fn());
      bus.emit("config:updated");
      bus.emit("stats:refresh");
      bus.emit("toast:show", {
        msg: `✅ 已自动检测到: ${found}`,
        duration: 3000,
        type: "success",
      });
    }
  });

  // 主题
  let savedTheme = cfg.theme || cfg.Theme || "";
  if (!savedTheme) savedTheme = localStorage.getItem("theme") || "system";
  localStorage.setItem("theme", savedTheme);
  window.applyTheme(savedTheme);
  const themeSelect = root.getElementById("set-theme");
  if (themeSelect) themeSelect.value = savedTheme;

  // 镜像源
  const savedMirror = cfg.mirror || "";
  const mirrorSelect = root.getElementById("set-mirror");
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
        await import("../../../wailsjs/go/main/App.js");
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
  const updateLinkHint = (mode) => {
    ["copy", "hardlink", "symlink"].forEach((m) => {
      const el = root.getElementById("lm-hint-" + m);
      if (el) el.style.display = m === mode ? "block" : "none";
    });
  };
  updateLinkHint(linkMode);

  // 链接模式变更（下拉菜单）+ 重新应用按钮
  const doRelink = async () => {
    try {
      const {
        LoadAppConfig,
        ListVersionInstances,
        RelinkAllInstanceResources,
      } = await import("../../../wailsjs/go/main/App.js");
      const cfg = await LoadAppConfig();
      const mcRoot = cfg.mcRoot || "";
      if (!mcRoot) return;
      const instances = await ListVersionInstances(mcRoot);
      let total = 0;
      for (const ins of instances) {
        if (!ins.Exists) continue;
        try {
          const n = await RelinkAllInstanceResources(ins.Name);
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
  };

  const linkSelect = root.getElementById("set-link-mode");
  if (linkSelect) {
    linkSelect.value = linkMode;
    linkSelect.addEventListener("change", async () => {
      const val = linkSelect.value;
      updateLinkHint(val);
      const theme = localStorage.getItem("theme") || "dark";
      await SaveAppConfig(repoPath, "", mcPath, val, theme);
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

  const relinkBtn = root.getElementById("set-relink");
  if (relinkBtn) {
    relinkBtn.addEventListener("click", doRelink);
  }

  // 主题切换
  root.getElementById("set-theme")?.addEventListener("change", async (e) => {
    const mode = e.target.value;
    window.applyTheme(mode);
    localStorage.setItem("theme", mode);
    try {
      const { SaveAppConfig } = await import("../../../wailsjs/go/main/App.js");
      const theme2 = localStorage.getItem("theme") || mode;
      await SaveAppConfig(repoPath, "", mcPath, linkMode, theme2);
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

  // 显示版本号
  const showVersion = async () => {
    try {
      const { CurrentVersion } =
        await import("../../../wailsjs/go/main/App.js");
      const ver = await CurrentVersion();
      const el = root.getElementById("set-version");
      if (el) el.textContent = ver;
    } catch {}
  };
  showVersion();

  // 检查更新
  initVersionUpdater(root);

  // 打开发布页
  root.getElementById("set-releases")?.addEventListener("click", () => {
    window.open(
      "https://github.com/eghrhegpe/ysm-model-manager/releases",
      "_blank",
    );
  });

  // ===== 界面与体验设置 =====

  // 读取/应用 UI 偏好（localStorage）
  const applyUIPref = () => {
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
    const scaleMap = { small: "-1px", normal: "0px", large: "2px" };
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
  const resolvePx = (varName) => {
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
  const updateSizePreview = () => {
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
    (root.getElementById("set-font-size").value =
      localStorage.getItem("ui-font-size") || "normal");
  root.getElementById("set-display-font") &&
    (root.getElementById("set-display-font").value =
      localStorage.getItem("ui-display-font") || "kaiti");
  root.getElementById("set-card-density") &&
    (root.getElementById("set-card-density").value =
      localStorage.getItem("ui-card-density") || "compact");
  root.getElementById("set-animations") &&
    (root.getElementById("set-animations").checked =
      localStorage.getItem("ui-animations") !== "off");
  root.getElementById("set-default-page") &&
    (root.getElementById("set-default-page").value =
      localStorage.getItem("ui-default-page") || "instances");

  applyUIPref();

  // 基准字号变更
  root.getElementById("set-font-size")?.addEventListener("change", (e) => {
    localStorage.setItem("ui-font-size", e.target.value);
    applyUIPref();
    bus.emit("toast:show", {
      msg: "✅ 字号已更新",
      duration: 1500,
      type: "success",
    });
  });

  // 创作者字体变更
  root.getElementById("set-display-font")?.addEventListener("change", (e) => {
    localStorage.setItem("ui-display-font", e.target.value);
    applyUIPref();
    bus.emit("toast:show", {
      msg: "✅ 字体已更新",
      duration: 1500,
      type: "success",
    });
  });

  // 卡片密度变更
  root.getElementById("set-card-density")?.addEventListener("change", (e) => {
    localStorage.setItem("ui-card-density", e.target.value);
    applyUIPref();
    bus.emit("toast:show", {
      msg: "✅ 卡片密度已更新",
      duration: 1500,
      type: "success",
    });
  });

  // 动画开关
  root.getElementById("set-animations")?.addEventListener("change", (e) => {
    localStorage.setItem("ui-animations", e.target.checked ? "on" : "off");
    applyUIPref();
    bus.emit("toast:show", {
      msg: e.target.checked ? "✅ 动画已开启" : "✅ 动画已关闭",
      duration: 1500,
      type: "success",
    });
  });

  // 默认页面变更
  root.getElementById("set-default-page")?.addEventListener("change", (e) => {
    localStorage.setItem("ui-default-page", e.target.value);
    bus.emit("toast:show", {
      msg: "✅ 默认页面已保存",
      duration: 1500,
      type: "success",
    });
  });
}
