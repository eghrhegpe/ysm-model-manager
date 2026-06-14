// ===== sidebar 数据加载层 =====
import { bus } from "../../bus.js";
import { fallbackInstances } from "./data.js";
import {
  LoadAppConfig,
  ListVersionInstances,
  GetInstanceStatus,
  GetResourceInstanceStatus,
} from "../../../wailsjs/go/main/App.js";

/** 从 Go 加载整合包实例列表，转换为 render 需要的格式 */
export async function loadInstances(rtype) {
  bus.emit("loading:start");
  try {
    const cfg = await LoadAppConfig();
    const mcRoot = cfg.mcRoot || cfg.McRoot || "";

    if (!mcRoot) return fallbackInstances();

    // 获取整合包列表
    const rawInstances = await ListVersionInstances(mcRoot);
    if (!rawInstances || !rawInstances.length) return fallbackInstances();

    // 只按当前资源类型查询同步状态
    const rtypeActual = rtype || "ysm";
    const repoRoot = cfg.repoRoot || cfg.RepoRoot || "";
    const statusList = await GetResourceInstanceStatus(
      rtypeActual,
      mcRoot,
      repoRoot,
    );
    const statusMap = {};
    (statusList || []).forEach((s) => {
      statusMap[s.Name] = s;
    });

    const instances = rawInstances.map((ins) => {
      const st = statusMap[ins.Name] || {};
      const missingList = st.Missing || [];
      const extraList = st.Extra || [];
      const syncedTotal = st.Synced || 0;

      return {
        name: ins.Name,
        dir: ins.VersionDir || "",
        exists: ins.Exists,
        hasMod: st.HasMod,
        status:
          missingList.length > 0
            ? "missing"
            : extraList.length > 0
              ? "extra"
              : "complete",
        synced: syncedTotal,
        missing: missingList.length,
        extra: extraList.length,
        disabled: 0,
        rtype: rtypeActual,
        // 仅存原始路径，展开卡片时按需构建对象
        _missingPaths: missingList,
        _extraPaths: extraList,
        items: {
          synced: [],
          disabled: [],
        },
      };
    });

    // 排序：无 mod 排最后，其次按已同步数降序
    instances.sort((a, b) => {
      if (a.hasMod !== b.hasMod) return a.hasMod ? -1 : 1;
      return (b.synced || 0) - (a.synced || 0);
    });

    console.log(
      "[loader] loadInstances 返回, rtype:",
      rtypeActual,
      "实例数:",
      instances.length,
      "第一个:",
      instances[0]
        ? {
            name: instances[0].name,
            synced: instances[0].synced,
            missing: instances[0].missing,
          }
        : "无",
      "statusList 长度:",
      statusList ? statusList.length : 0,
    );
    return instances;
  } catch {
    return fallbackInstances();
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
