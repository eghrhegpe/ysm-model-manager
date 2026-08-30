// ===== sidebar 数据加载层 =====
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import { bus } from "../../bus.ts";
import { t } from "../../core/i18n/t.ts";
import { dbg } from "../../utils/debug/debug.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import type { SidebarInstance } from "./data.ts";
import { getApp } from "../../backend/app.ts";
import { friendlyError } from "../../utils/dom/errors.ts";

/** Go 端实例同步状态（绑定类型局部视图，字段以 Go struct 为准） */
interface InstanceStatusView {
  Name?: string;
  Missing?: string[];
  Extra?: string[];
  Synced?: number;
  HasMod?: boolean;
}

/** MMD 变体聚合结果 */
export interface MmdVariantGroups {
  missingGroups: string[];
  extraGroups: string[];
  variantMap: Record<string, { items: string[]; count: number }>;
}

/** 在途去重表（2026-08-21）：同 rtype 的并发 loadInstances 共享一次请求——
 * 点击整合包时多组件并发触发 reload，重复 IPC 会让 Go 侧重复扫描在途重叠
 * （30s 缓存扫完才 Store，重叠请求双双真扫 → 操作日志同秒重复条目）。
 * 前端在途去重 + go/scanner 航班合并双层防御。 */
const _inflight = new Map<string, Promise<SidebarInstance[]>>();

/** 从 Go 加载整合包实例列表，转换为 render 需要的格式（同 rtype 在途请求合并）
 *  @param opts.force 变异后刷新（sync 拉取/导入/启停完成）传 true，跳过在途去重——
 *  去重只服务「读并发」（多组件同时触发 reload），若变异完成的刷新并入变异前发起的
 *  在途请求，会拿到变更前的旧实例列表（缺/多余的状态卡住到下次触发）。 */
export function loadInstances(rtype: string, opts?: { force?: boolean }): Promise<SidebarInstance[]> {
  const key = rtype || RESOURCE_TYPES.YSM;
  if (!opts?.force) {
    const running = _inflight.get(key);
    if (running) return running;
  }
  const p = doLoadInstances(key).finally(() => {
    _inflight.delete(key);
  });
  _inflight.set(key, p);
  return p;
}

async function doLoadInstances(rtypeActual: string): Promise<SidebarInstance[]> {
  try {
    const {
      LoadAppConfig,
      ListVersionInstances,
      GetResourceInstanceStatus,
      GetRepoRoot,
    } = await getApp();
    const cfg = await LoadAppConfig();
    const mcRoot = cfg.mcRoot || "";

    if (!mcRoot) return [];

    // 获取整合包列表
    const rawInstances = await ListVersionInstances(mcRoot);
    if (!rawInstances || !rawInstances.length) return [];

    // 只按当前资源类型查询同步状态（rtypeActual 已在入口归一）
    const filesRoot = await GetRepoRoot(rtypeActual);
    const statusList = await GetResourceInstanceStatus(
      rtypeActual,
      mcRoot,
      filesRoot,
    );
    const statusMap: Record<string, InstanceStatusView> = {};
    (statusList || []).forEach((s) => {
      statusMap[s.Name] = s as InstanceStatusView;
    });

    const isMmd = rtypeActual === RESOURCE_TYPES.MMD;

    const instances: SidebarInstance[] = rawInstances.map((ins) => {
      const st: InstanceStatusView = statusMap[ins.Name] || {};
      const missingList = st.Missing || [];
      const extraList = st.Extra || [];
      const syncedTotal = st.Synced || 0;

      // MMD 类型：将属于同一父文件夹的 .pmx 变体聚合成 variantGroups
      let variantGroups: MmdVariantGroups | null = null;
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
        hasMod: Boolean(st.HasMod),
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
        // 仅存原始路径，展开卡片时按需构建对象
        _missingPaths: flatMissing,
        _extraPaths: flatExtra,
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

    dbg(
      "loader",
      "loadInstances 返回, rtype:",
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
  } catch (err) {
    // 失败不静默：显示空整合包列表会误导用户以为没装实例
    bus.emit("toast:show", {
      msg: "❌ " + t("sidebar.loadFailed") + ": " + friendlyError(err, t("sidebar.loadFailedDetail")),
      duration: TOAST_MS.long,
      type: "error",
    });
    return [];
  }
}

/**
 * 对 MMD 类型，按父文件夹聚合 .pmx 变体文件。
 * 返回 { missingGroups, extraGroups, variantMap }
 *   - missingGroups/extraGroups: string[] 聚合后的代表路径（父文件夹路径）
 *   - variantMap: { [folderPath]: string[] } 文件夹下的变体文件路径列表
 */
export function groupMmdVariants(
  missingList: string[],
  extraList: string[],
): MmdVariantGroups {
  const variantMap: Record<string, { items: string[]; count: number }> = {};
  const collect = (paths: string[]): void => {
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
  const missingGroups: string[] = [];
  const extraGroups: string[] = [];
  // seen 必须按 missing/extra 各自独立：共享会导致同父文件夹「缺失+多余」时 extra 组被 missing 去重污染而漏组
  const assign = (paths: string[], target: string[]): void => {
    const seen: Record<string, boolean> = {};
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
