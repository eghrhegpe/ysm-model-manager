// ===== 加载数据 =====
async function loadAll() {
  if (!mcRoot || !repoRoot) return;
  st.textContent = "⏳ 加载中...";
  try {
    const rawInstances = await window.go.main.App.ListVersionInstances(mcRoot);
    const rawStatuses = await window.go.main.App.GetInstanceStatus(
      mcRoot,
      repoRoot,
    );
    const rawEntries = await window.go.main.App.ScanModelEntries(repoRoot);
    instances = Array.isArray(rawInstances) ? rawInstances : [];
    statuses = Array.isArray(rawStatuses) ? rawStatuses : [];
    entries = Array.isArray(rawEntries) ? rawEntries : [];
    renderVersions();
    buildTree();
    updateVersionStats(instances, statuses, entries);
    updateInstallBtn();
    st.textContent = "就绪";
    // 清除引导提示
    const guide = document.querySelector(".startup-guide");
    if (guide) guide.remove();
  } catch (e) {
    st.textContent = "❌ 加载失败";
    console.error(e);
  }
}

// ===== 显示首次启动引导 =====
function showStartupGuide() {
  // 如果已有引导提示则跳过
  if (document.querySelector(".startup-guide")) return;
  const guide = document.createElement("div");
  guide.className = "startup-guide";
  guide.style.cssText =
    "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;z-index:10;background:var(--bg);padding:20px;text-align:center";
  guide.innerHTML = `
        <div style="font-size:36px">🧱</div>
        <h2 style="font-size:16px;color:var(--txt);margin:0">欢迎使用 YSM 模型管理器</h2>
        <p style="font-size:12px;color:var(--muted);max-width:280px;line-height:1.6">
            请先设置「仓库目录」和「游戏路径」以开始管理模型
        </p>
        <div style="display:flex;gap:12px;margin-top:4px">
            <button class="guide-btn" data-action="repo" style="padding:8px 20px;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer;font-size:13px;font-weight:600">📁 选择仓库目录</button>
            <button class="guide-btn" data-action="mc" style="padding:8px 20px;border-radius:6px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);cursor:pointer;font-size:13px">🎮 选择游戏路径</button>
        </div>
        <p style="font-size:10px;color:var(--muted);margin-top:8px">仓库：存放模型的文件夹<br>游戏路径：.minecraft 目录（含 versions/ 子目录）</p>
    `;
  // 获取 main 容器并设置 position: relative
  const main = document.querySelector(".main");
  if (!main) return;
  main.style.position = "relative";
  main.appendChild(guide);

  // 绑定引导按钮事件
  guide.querySelectorAll(".guide-btn").forEach((btn) => {
    btn.onclick = async () => {
      const action = btn.dataset.action;
      if (action === "repo") {
        const dir = await window.go.main.App.SelectDirectory();
        if (!dir) return;
        repoRoot = dir;
        window.go.main.App.SetRepoRoot(dir);
        localStorage.setItem("repoRoot", dir);
        document.getElementById("btn-repo").textContent = "📁 " + dir;
      } else if (action === "mc") {
        const dir = await window.go.main.App.SelectDirectory();
        if (!dir) return;
        mcRoot = dir;
        localStorage.setItem("mcRoot", dir);
        document.getElementById("btn-mc").textContent = "🎮 " + dir;
      }
      // 两个都设置后自动加载
      if (mcRoot && repoRoot) {
        await loadAll();
      }
    };
  });
}

// ===== 自动检测 + 恢复配置 =====
async function autoDetect() {
  // 1. 从磁盘配置文件加载（最优先）
  let savedRepo = "",
    savedMc = "",
    savedLinkMode = "";
  try {
    const cfg = await window.go.main.App.LoadAppConfig();
    savedRepo = cfg.repoRoot || "";
    savedMc = cfg.mcRoot || "";
    savedLinkMode = cfg.linkMode || "";
  } catch (e) {
    console.error("读取磁盘配置失败:", e);
  }

  // 2. 磁盘没有则回退 localStorage
  if (!savedRepo) savedRepo = localStorage.getItem("repoRoot") || "";
  if (!savedMc) savedMc = localStorage.getItem("mcRoot") || "";
  if (!savedLinkMode) savedLinkMode = localStorage.getItem("linkMode") || "";

  // 恢复链接模式
  if (savedLinkMode) {
    try {
      await window.go.main.App.SetLinkMode(savedLinkMode);
    } catch {}
  }

  // 恢复仓库路径
  if (savedRepo) {
    repoRoot = savedRepo;
    window.go.main.App.SetRepoRoot(savedRepo);
    document.getElementById("btn-repo").textContent = "📁 " + savedRepo;
  }

  // 恢复游戏路径
  if (savedMc) {
    mcRoot = savedMc;
    document.getElementById("btn-mc").textContent = "🎮 " + savedMc;
  } else {
    // 尝试自动检测
    const result = await window.go.main.App.GetMinecraftPath();
    if (result.includes("✅")) {
      mcRoot = result.replace(/^[^\x20]*\s*/, "").trim();
      localStorage.setItem("mcRoot", mcRoot);
      document.getElementById("btn-mc").textContent = "🎮 " + mcRoot;
    } else {
      st.textContent = result;
    }
  }

  if (mcRoot && repoRoot) {
    await loadAll();
  } else {
    // 首次启动引导：路径未完全设置
    st.textContent = mcRoot
      ? "请选择仓库目录"
      : repoRoot
        ? "请选择游戏路径"
        : "请设置路径开始";
    showStartupGuide();
  }
}

// ===== 更新安装按钮文字 =====
function updateInstallBtn() {
  const btn = document.getElementById("btn-sync-all");
  if (!btn) return;
  const totalMissing = (statuses || [])
    .filter((x) => x.HasYSM)
    .reduce((s, x) => s + (x.Missing ? x.Missing.length : 0), 0);
  btn.textContent =
    totalMissing > 0 ? "📥 批量安装（" + totalMissing + " 个）" : "📥 批量安装";
}

// ===== 启动 =====
// 延时启动，等待 DOM 和 Wails runtime 准备就绪
export { autoDetect, loadAll };
