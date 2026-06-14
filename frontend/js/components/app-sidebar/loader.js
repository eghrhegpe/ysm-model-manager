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

    const isMmd = rtypeActual === "mmd-skin";

    const instances = rawInstances.map((ins) => {
      const st = statusMap[ins.Name] || {};
      const missingList = st.Missing || [];
      const extraList = st.Extra || [];
      const syncedTotal = st.Synced || 0;

      // MMD 类型：将属于同一父文件夹的 .pmx 变体聚合成 variantGroups
      let variantGroups = null;
      let flatMissing = missingList;
      let flatExtra = extraList;

      if (isMmd) {
        variantGroups = groupMmdVariants(missingList, extraList);
        // 用聚合后的组数替代原始条目数（卡片徽章显示组数而非文件数）
        flatMissing = variantGroups.missingGroups;
        flatExtra = variantGroups.extraGroups;
      }

      return {
        name: ins.Name,
        dir: ins.VersionDir || "",
        exists: ins.Exists,
        hasMod: st.HasMod,
        status:
          flatMissing.length > 0
            ? "missing"
            : flatExtra.length > 0
              ? "extra"
              : "complete",
        synced: syncedTotal,
        missing: flatMissing.length,
        extra: flatExtra.length,
        disabled: 0,
        rtype: rtypeActual,
        variantGroups: isMmd ? variantGroups : null,
        items: {
          missing: flatMissing.map((fullPath) => {
            const displayName = fullPath.split(/[/\\]/).pop() || fullPath;
            return { name: fullPath, displayName, size: "" };
          }),
          extra: flatExtra.map((n) => {
            return { name: n, size: "" };
          }),
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

/**
 * 对 MMD 类型，按父文件夹聚合 .pmx 变体文件。
 * 返回 { missingGroups, extraGroups, variantMap }
 *   - missingGroups/extraGroups: string[] 聚合后的代表路径（父文件夹路径）
 *   - variantMap: { [folderPath]: string[] } 文件夹下的变体文件路径列表
 */
function groupMmdVariants(missingList, extraList) {
  const variantMap = {}; // { folderPath: { items: string[], count: number } }
  const collect = (paths) => {
    paths.forEach((fp) => {
      const parts = fp.replace(/\\/g, "/").split("/");
      if (parts.length < 2) {
        // 单层路径，无父文件夹
        const key = fp;
        if (!variantMap[key]) variantMap[key] = { items: [], count: 0 };
        variantMap[key].items.push(fp);
        variantMap[key].count++;
        return;
      }
      // 父文件夹路径（去掉最后一级文件名）
      const parent = parts.slice(0, -1).join("/");
      const key = parent;
      if (!variantMap[key]) variantMap[key] = { items: [], count: 0 };
      variantMap[key].items.push(fp);
      variantMap[key].count++;
    });
  };
  collect(missingList);
  collect(extraList);

  // 生成聚合后的组列表
  const missingGroups = [];
  const extraGroups = [];
  const seen = {};
  const assign = (paths, target) => {
    paths.forEach((fp) => {
      const parts = fp.replace(/\\/g, "/").split("/");
      const parent = parts.length >= 2 ? parts.slice(0, -1).join("/") : fp;
      if (!seen[parent]) {
        seen[parent] = true;
        target.push(parent);
      }
    });
  };
  assign(missingList, missingGroups);
  assign(extraList, extraGroups);

  return { missingGroups, extraGroups, variantMap };
}
