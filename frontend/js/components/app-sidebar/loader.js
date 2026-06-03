// ===== sidebar 数据加载层 =====
import { LoadAppConfig, ListVersionInstances, GetInstanceStatus, ScanModelEntries } from "../../wailsjs/go/main/App.js";

/** 从 Go 加载整合包实例列表，转换为 render 需要的格式 */
export async function loadInstances() {
  const cfg = await LoadAppConfig();
  const mcRoot = cfg.mcRoot || cfg.McRoot || "";
  const repoRoot = cfg.repoRoot || cfg.RepoRoot || "";

  if (!mcRoot || !repoRoot) return null;

  // 获取仓库所有文件（用于算已同步数）
  const repoEntries = await ScanModelEntries(repoRoot);
  const repoSet = new Set();
  repoEntries.forEach(e => repoSet.add(e.Name.replace(/\.ban$/i, "")));

  // 获取整合包列表
  const rawInstances = await ListVersionInstances(mcRoot);
  if (!rawInstances || !rawInstances.length) return null;

  // 获取整合包状态
  const statusList = await GetInstanceStatus(mcRoot, repoRoot);
  const statusMap = {};
  (statusList || []).forEach(s => { statusMap[s.Name] = s; });

  const instances = rawInstances.map(ins => {
    const st = statusMap[ins.Name] || {};
    const missing = st.Missing || [];
    const extra = st.Extra || [];
    const disabled = st.Disabled || [];
    const missingSet = new Set(missing.map(n => n.replace(/\.ban$/i, "")));
    const extraSet = new Set(extra.map(n => n.replace(/\.ban$/i, "")));

    // 已同步 = 仓库有但不在 missing 和 extra 中
    const syncedNames = [];
    repoSet.forEach(name => {
      if (!missingSet.has(name) && !extraSet.has(name)) {
        syncedNames.push(name);
      }
    });

    // 用 ScanModelEntries 扫描 custom 目录获取文件大小
    const customEntries = [];
    if (ins.Exists) {
      try {
        // 直接调用 Go 扫描 custom 目录
        const entries = ScanModelEntries(ins.CustomDir);
        const entryMap = {};
        (entries || []).forEach(e => { entryMap[e.Name.replace(/\.ban$/i, "")] = e; });
        customEntries.push(...(entries || []));
      } catch (_) {}
    }
    const getSize = (name) => {
      const found = customEntries.find(e => e.Name.replace(/\.ban$/i, "") === name.replace(/\.ban$/i, ""));
      return found ? fmtSize(found.Size) : "";
    };

    return {
      name: ins.Name,
      exists: ins.Exists,
      hasYSM: st.HasYSM,
      synced: syncedNames.length,
      missing: missing.length,
      extra: extra.length,
      items: {
        synced: syncedNames.slice(0, 20).map(n => ({ name: n, size: getSize(n) })),
        missing: missing.slice(0, 20).map(n => ({ name: n, size: getSize(n) })),
        extra: extra.slice(0, 20).map(n => ({ name: n, size: getSize(n) })),
      },
    };
  });

  return instances;
}

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}
