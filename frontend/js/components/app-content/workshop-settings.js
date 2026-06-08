// ===== 设置页初始化（为 _initSettings 减负） =====
import { bus } from "../../bus.js";
import { modalConfirm } from "../../dialogs/modal.js";
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
  window.applyTheme(savedTheme);
  const themeSelect = root.getElementById("set-theme");
  if (themeSelect) themeSelect.value = savedTheme;

  // 镜像源
  const savedMirror = cfg.mirror || "";
  const mirrorSelect = root.getElementById("set-mirror");
  if (mirrorSelect) {
    mirrorSelect.value = savedMirror;
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
    });
  }

  // ===== 事件绑定 =====

  // 游戏路径 - 选择目录
  root.getElementById("set-mc-browse")?.addEventListener("click", async () => {
    const dir = await SelectDirectory();
    if (!dir) return;
    const theme = localStorage.getItem("theme") || "dark";
    await SaveAppConfig(repoPath, dir, linkMode, theme);
    if (mcEl) mcEl.textContent = dir;
    bus.emit("config:updated");
    bus.emit("stats:refresh");
    bus.emit("toast:show", {
      msg: "✅ 游戏路径已设置",
      duration: 2000,
      type: "success",
    });
  });

  // 游戏路径 - 自动搜索
  root.getElementById("set-mc-detect")?.addEventListener("click", async () => {
    const paths = await GetMinecraftPaths();
    if (paths?.length) {
      const found = paths[0];
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
      if (el) el.style.display = m === mode ? "" : "none";
    });
  };
  updateLinkHint(linkMode);

  // 链接模式变更
  root.querySelectorAll('input[name="link-mode"]').forEach((radio) => {
    radio.addEventListener("change", async () => {
      if (!radio.checked) return;
      updateLinkHint(radio.value);
      const theme = localStorage.getItem("theme") || "dark";
      await SaveAppConfig(repoPath, mcPath, radio.value, theme);
      await SetLinkMode(radio.value);
      bus.emit("toast:show", {
        msg: `✅ 链接模式已切换至: ${radio.value}`,
        duration: 2000,
        type: "success",
      });
      const relink = await modalConfirm({
        title: "切换链接模式",
        icon: "🔗",
        message:
          "是否将已有模型重新链接为新模式？\n（将删除整合包中已安装的模型副本，用新模式重新安装）",
        okText: "重新链接",
      });
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
    const { OpenFolder } = window.go?.main?.App || {};
    // 用系统默认浏览器打开 GitHub Releases
    window.open(
      "https://github.com/eghrhegpe/ysm-model-manager/releases",
      "_blank",
    );
  });
}
