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
  } = await import("../../../wailsjs/go/main/App.js");
  const cfg = await LoadAppConfig();
  const mcPath = cfg.mcRoot || "";
  const repoPath = cfg.repoRoot || "";
  const linkMode = cfg.linkMode || "copy";

  // 显示当前值 + 空状态提示
  const mcEl = root.getElementById("set-mc-path");
  const repoEl = root.getElementById("set-repo-path");
  const mcHint = root.getElementById("set-mc-empty-hint");
  const repoHint = root.getElementById("set-repo-empty-hint");
  if (mcEl) {
    mcEl.textContent = mcPath || "未设置";
    if (mcHint) mcHint.style.display = mcPath ? "none" : "";
  }
  if (repoEl) {
    repoEl.textContent = repoPath || "未设置";
    if (repoHint) repoHint.style.display = repoPath ? "none" : "";
  }

  // 主题：先读 Go 配置，再回退 localStorage
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
    // 初始化镜像源提示
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
      // 切换镜像源提示
      ["direct", "jsdelivr", "githubapi"].forEach((m) => {
        const el = root.getElementById("mirror-hint-" + m);
        if (el) el.style.display = m === (val || "direct") ? "block" : "none";
      });
    });
  }

  // ===== 事件绑定 =====

  // 游戏路径 - 选择目录
  root.getElementById("set-mc-browse")?.addEventListener("click", async () => {
    const dir = await SelectDirectory();
    if (!dir) return;
    const theme = localStorage.getItem("theme") || "dark";
    try {
      await SaveAppConfig(repoPath, dir, linkMode, theme);
      if (mcEl) mcEl.textContent = dir;
      if (mcHint) mcHint.style.display = "none";
      bus.emit("config:updated");
      bus.emit("stats:refresh");
      bus.emit("toast:show", {
        msg: "✅ 游戏路径已设置",
        duration: 2000,
        type: "success",
      });
    } catch (e) {
      bus.emit("toast:show", {
        msg: "⚠️ " + (e?.message || String(e)),
        duration: 5000,
        type: "warn",
      });
    }
  });

  // 游戏路径 - 自动搜索
  root.getElementById("set-mc-detect")?.addEventListener("click", async () => {
    const paths = await GetMinecraftPaths();
    if (paths?.length) {
      const found = paths[0];
      const theme1 = localStorage.getItem("theme") || "dark";
      try {
        await SaveAppConfig(repoPath, found, linkMode, theme1);
        if (mcEl) mcEl.textContent = found;
        if (mcHint) mcHint.style.display = "none";
        bus.emit("config:updated");
        bus.emit("stats:refresh");
        bus.emit("toast:show", {
          msg: `✅ 已自动检测到: ${found}`,
          duration: 3000,
          type: "success",
        });
      } catch (e) {
        bus.emit("toast:show", {
          msg: "⚠️ " + (e?.message || String(e)),
          duration: 5000,
          type: "warn",
        });
      }
    } else {
      bus.emit("toast:show", {
        msg: "⚠️ 未找到 .minecraft 文件夹",
        duration: 3000,
        type: "warn",
      });
    }
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
      if (repoHint) repoHint.style.display = "none";
      bus.emit("config:updated");
      bus.emit("stats:refresh");
      bus.emit("tree:reload"); // 仓库路径变了，重新加载树
      bus.emit("toast:show", {
        msg: "✅ 仓库路径已设置",
        duration: 2000,
        type: "success",
      });
    });

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
  };

  const linkSelect = root.getElementById("set-link-mode");
  if (linkSelect) {
    linkSelect.value = linkMode;
    linkSelect.addEventListener("change", async () => {
      const val = linkSelect.value;
      updateLinkHint(val);
      const theme = localStorage.getItem("theme") || "dark";
      await SaveAppConfig(repoPath, mcPath, val, theme);
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

    // 基准字号
    const sizes = { small: "11px", normal: "13px", large: "15px" };
    document.documentElement.style.setProperty(
      "--fs-base",
      sizes[fontSize] || "13px",
    );
    // 调整关联变量（相对值）
    const ratio = fontSize === "small" ? 0.85 : fontSize === "large" ? 1.15 : 1;
    document.documentElement.style.setProperty(
      "--fs-xs",
      Math.round(9 * ratio) + "px",
    );
    document.documentElement.style.setProperty(
      "--fs-sm",
      Math.round(10 * ratio) + "px",
    );
    document.documentElement.style.setProperty(
      "--fs-md",
      Math.round(12 * ratio) + "px",
    );
    document.documentElement.style.setProperty(
      "--fs-lg",
      Math.round(14 * ratio) + "px",
    );

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
