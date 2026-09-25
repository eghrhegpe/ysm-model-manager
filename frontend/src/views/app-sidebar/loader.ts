// ===== sidebar 数据加载层 =====

import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import type { SidebarInstance } from "./data.ts";

/** Go 端实例同步状态（绑定类型局部视图，字段以 Go struct 为准）
 *  ADR-310：计数为面板链**单元级**（dirLevel=模型夹 / fileLevel=文件），
 *  `MissingCount` 已含 diverged 折叠（红=待推送）；`Missing` 是仓库侧文件级
 *  路径清单（一键安装契约），长度可大于 MissingCount，不得当计数用。
 *  `Extra`/`Disabled` 为实例侧单元路径（本层只取长度与展示）。 */
interface InstanceStatusView {
  Name?: string;
  MissingCount?: number;
  Missing?: string[];
  Extra?: string[];
  Disabled?: string[];
  Synced?: number;
  HasMod?: boolean;
}

/** 在途去重表（2026-08-21）：同 rtype 的并发 loadInstances 共享一次请求——
 * 点击整合包时多组件并发触发 reload，重复 IPC 会让 Go 侧重复扫描在途重叠
 * （30s 缓存扫完才 Store，重叠请求双双真扫 → 操作日志同秒重复条目）。
 * 前端在途去重 + go/scanner 航班合并双层防御。 */
const _inflight = new Map<string, Promise<SidebarInstance[]>>();
const _inflightTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** 从 Go 加载整合包实例列表，转换为 render 需要的格式（同 rtype 在途请求合并）
 *  @param opts.force 变异后刷新（sync 拉取/导入/启停完成）传 true，跳过在途去重——
 *  去重只服务「读并发」（多组件同时触发 reload），若变异完成的刷新并入变异前发起的
 *  在途请求，会拿到变更前的旧实例列表（缺/多余的状态卡住到下次触发）。 */
export function loadInstances(
  rtype: string,
  opts?: { force?: boolean },
): Promise<SidebarInstance[]> {
  const key = rtype || RESOURCE_TYPES.YSM;
  if (!opts?.force) {
    const running = _inflight.get(key);
    if (running) return running;
  }
  const p = doLoadInstances(key).finally(() => {
    _inflight.delete(key);
    const timer = _inflightTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      _inflightTimers.delete(key);
    }
  });
  _inflight.set(key, p);
  // 30s 超时淘汰：防止 Promise 永远不 settle 导致条目永久残留
  _inflightTimers.set(
    key,
    setTimeout(() => {
      if (_inflight.get(key) === p) _inflight.delete(key);
      _inflightTimers.delete(key);
    }, 30000),
  );
  return p;
}

async function doLoadInstances(rtypeActual: string): Promise<SidebarInstance[]> {
  try {
    const { LoadAppConfig, ListVersionInstances, GetResourceInstanceStatus, GetRepoRoot } =
      await backendGetApp();
    const cfg = await LoadAppConfig();
    const mcRoot = cfg.mcRoot || "";

    if (!mcRoot) return [];

    // 获取整合包列表
    const rawInstances = await ListVersionInstances(mcRoot);
    if (!rawInstances?.length) return [];

    // 只按当前资源类型查询同步状态（rtypeActual 已在入口归一）
    const filesRoot = await GetRepoRoot(rtypeActual);
    const statusList = await GetResourceInstanceStatus(rtypeActual, mcRoot, filesRoot);
    const statusMap: Record<string, InstanceStatusView> = {};
    (statusList || []).forEach((s) => {
      statusMap[s.Name] = s as InstanceStatusView;
    });

    const instances: SidebarInstance[] = rawInstances.map((ins) => {
      const st: InstanceStatusView = statusMap[ins.Name] || {};
      const missingList = st.Missing || [];
      const extraList = st.Extra || [];
      const disabledList = st.Disabled || [];
      // ADR-310：badge 数取 Go 聚合的单元数（MMD 等 dirLevel 类型的变体聚合
      // 已在 Go 面板链完成，前端不再本地重算——职责红线：聚合归 Go）
      const missingTotal = st.MissingCount || 0;
      const extraTotal = extraList.length;
      const disabledTotal = disabledList.length;
      const syncedTotal = st.Synced || 0;

      return {
        name: ins.Name,
        dir: ins.VersionDir || "",
        exists: ins.Exists,
        hasMod: Boolean(st.HasMod),
        status: missingTotal > 0 ? "missing" : extraTotal > 0 ? "extra" : "complete",
        synced: syncedTotal,
        missing: missingTotal,
        extra: extraTotal,
        disabled: disabledTotal,
        rtype: rtypeActual,
        // 仅存原始路径，展开卡片时按需构建对象
        _missingPaths: missingList,
        _extraPaths: extraList,
        items: {
          synced: [],
          disabled: disabledList,
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
      msg: `${t("sidebar.loadFailed")}: ${friendlyError(err, t("sidebar.loadFailedDetail"))}`,
      duration: TOAST_MS.long,
      type: "error",
    });
    return [];
  }
}
