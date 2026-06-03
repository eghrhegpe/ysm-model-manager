// ===== sidebar 数据加载层 =====
import {
  LoadAppConfig,
  ListVersionInstances,
  GetInstanceStatus,
  ScanModelEntries,
} from "../../../wailsjs/go/main/App.js";

/** 从 Go 加载整合包实例列表，转换为 render 需要的格式 */
export async function loadInstances() {
  bus.emit("loading:start");
  try {
    const cfg = await LoadAppConfig();
    const mcRoot = cfg.mcRoot || cfg.McRoot || "";
    const repoRoot = cfg.repoRoot || cfg.RepoRoot || "";

    if (!mcRoot || !repoRoot) return null;

    // 获取仓库所有文件（用于算已同步数）
    const repoEntries = await ScanModelEntries(repoRoot);
    const repoSet = new Set();
    repoEntries.forEach((e) => repoSet.add(e.Name.replace(/\.ban$/i, "")));

    // 获取整合包列表
    const rawInstances = await ListVersionInstances(mcRoot);
    if (!rawInstances || !rawInstances.length) return null;

    // 获取整合包状态
    const statusList = await GetInstanceStatus(mcRoot, repoRoot);
    const statusMap = {};
    (statusList || []).forEach((s) => {
      statusMap[s.Name] = s;
    });

    const instances = rawInstances.map((ins) => {
      const st = statusMap[ins.Name] || {};
      const missing = st.Missing || [];
      const extra = st.Extra || [];
      const missingSet = new Set(missing.map((n) => n.replace(/\.ban$/i, "")));
      const extraSet = new Set(extra.map((n) => n.replace(/\.ban$/i, "")));

      // 已同步 = 仓库有但不在 missing 和 extra 中
      const syncedNames = [];
      repoSet.forEach((name) => {
        if (!missingSet.has(name) && !extraSet.has(name)) {
          syncedNames.push(name);
        }
      });

      return {
        name: ins.Name,
        exists: ins.Exists,
        hasYSM: st.HasYSM,
        status: st.Status || "missing",
        synced: syncedNames.length,
        missing: missing.length,
        extra: extra.length,
        items: {
          synced: syncedNames.slice(0, 20).map((n) => {
            const linkType = getLinkType(n, st.Files);
            return { name: n, size: "", linkType };
          }),
          missing: missing.slice(0, 20).map((n) => {
            const linkType = getLinkType(n, st.Files);
            return { name: n, size: "", linkType };
          }),
          extra: extra.slice(0, 20).map((n) => {
            const linkType = getLinkType(n, st.Files);
            return { name: n, size: "", linkType };
          }),
        },
      };
    });

    return instances;
  } finally {
    bus.emit("loading:end");
  }
}

function getLinkType(name, files) {
  if (!files || !files.length) return "";
  const found = files.find((f) => f.Name === name);
  if (!found) return "";
  if (found.LinkType === "symlink") return "🔗";
  if (found.LinkType === "hardlink") return "🔗";
  return "📋";
}

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}
