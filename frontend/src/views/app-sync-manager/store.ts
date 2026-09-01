// ===== app-sync-manager 数据层（store） =====
// 职责：数据加载（类型配置 + 同步状态）与筛选
// 纯函数，接收组件实例 self，通过 self 读写状态；无 DOM / 无 bus 副作用。
// 依赖 DAG：index → store ← network（网络操作后调 loadData 刷新）

import { getApp } from "../../backend/app.ts";
import { bus } from "../../bus.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import type { SyncManagerSelf } from "./index.ts";
import type { SyncItem } from "./tpl.ts";

export type SyncStoreSelf = SyncManagerSelf;

/**
 * 加载资源类型配置（LoadResourceTypes）
 * 过期代际/已卸载静默丢弃；加载失败 toast 提醒 + 空数组降级。
 */
export async function loadTypeConfig(self: SyncStoreSelf): Promise<void> {
  const gen = self._gen;
  try {
    const { LoadResourceTypes } = await getApp();
    const reg = await LoadResourceTypes();
    if (gen !== self._gen) return;
    // 只取前端需要的字段子集
    self._typeConfig = (reg?.resourceTypes || []).map(r => ({
      id: r.id,
      name: r.name,
      icon: r.icon,
      dirLevelSync: r.dirLevelSync,
    }));
  } catch {
    if (gen !== self._gen || !self.isConnected) return;
    self._typeConfig = [];
    bus.emit("toast:show", {
      msg: "⚠️ 资源类型配置加载失败",
      duration: TOAST_MS.normal,
      type: "warn",
    });
  }
}

/**
 * 加载实例同步状态（GetInstanceSyncStatus）
 * 过期代际丢弃；加载失败 toast 提醒 + 空数组。
 */
export async function loadData(self: SyncStoreSelf): Promise<void> {
  const gen = self._gen;
  try {
    const { GetInstanceSyncStatus } = await getApp();
    const json = await GetInstanceSyncStatus(self._instance, self._subtype || "", self._selectedType || "");
    if (gen !== self._gen) return;
    self._allItems = (JSON.parse(json) as SyncItem[]) || [];
    if (self._selectedType) {
      // 目录可见性：顺带取实际扫描目录（非阻断，失败仅不显示摘要）
      try {
        const { GetSyncScanDirs } = await getApp();
        const dirsJson = await GetSyncScanDirs(self._selectedType, self._instance);
        if (gen !== self._gen) return;
        if (!self._scanDirs) self._scanDirs = {};
        self._scanDirs[self._selectedType] = JSON.parse(dirsJson) as { global: string; instance: string; warningCode?: string; warningParams?: { label: string; dir: string; subDir: string } };
      } catch {
        /* 目录摘要非关键路径，静默降级 */
      }
    }
  } catch {
    if (gen !== self._gen) return;
    self._allItems = [];
    bus.emit("toast:show", {
      msg: "⚠️ 同步状态加载失败",
      duration: TOAST_MS.normal,
      type: "warn",
    });
  }
}

/** tabStatus：diverged 折叠进 missing tab（继承可操作属性——与 renderer 计数同规，
 * 逐节点复用以防口径漂移）。返回该条目在 status tab 下归属的展示状态。
 * 导出供 renderer 计数递归复用（点3：筛选谓词与统计口径一致）。 */
export function tabStatus(item: SyncItem): string {
  return item.status === "diverged" ? "missing" : item.status;
}

/** matches：item 自身是否命中「类型 + 状态」筛选（type/status 逐节点独立判定，点4） */
function matches(self: SyncStoreSelf, item: SyncItem): boolean {
  if (self._selectedType && item.type !== self._selectedType) return false;
  if (self._statusFilter === "all") return true;
  return tabStatus(item) === self._statusFilter;
}

/**
 * filterNode：递归筛选一个节点（keep-ancestors 语义）。
 * - 自身命中 → 保留；
 * - 任一后代命中（type/status）→ 保留父链（filter-keep-ancestors）；
 * - 都不命中 → 丢弃。
 * 仅当 status 筛选激活（非 all）且该目录「有命中的后代」时，将其 path 记入
 * forceOpen——渲染层据此展开命中目录，使折叠下的命中子项可见（点1）。
 * 返回 null 表示该节点（含其后代）均不命中，应整体过滤掉。
 */
function filterNode(self: SyncStoreSelf, item: SyncItem, force: Set<string>): SyncItem | null {
  const selfHit = matches(self, item);
  let keptChildren: SyncItem[] | undefined;
  if (item.children?.length) {
    const filtered: SyncItem[] = [];
    for (const c of item.children) {
      const kept = filterNode(self, c, force);
      if (kept) filtered.push(kept);
    }
    if (filtered.length) {
      keptChildren = filtered;
      // 有命中的后代 → 该目录需展开显示它们（仅 status 筛选激活时；type 筛选是常态，不 force）
      if (self._statusFilter !== "all") force.add(item.path);
    }
  }
  if (!selfHit && !keptChildren?.length) return null;
  // 关键：children 存在时一律重建（含保底空数组）——自身命中但子项全不命中的目录
  // 展开后不得露出未命中的原始 children（破坏「列表全为筛选态」不变量，边角不对称修复）。
  return item.children?.length ? { ...item, children: keptChildren || [] } : item;
}

/**
 * 应用类型 + 状态筛选，写入 self._filteredItems（递归 + keep-ancestors）。
 * 子目录过滤已由后端路径限定处理（GetInstanceSyncStatus 走 subtype 参数），
 * 前端不再需要 MMD 子目录过滤——回归事实源（resource_types.json subtype.instanceDir）。
 * 同时维护 self._forceOpenPaths：status 筛选下「有命中后代的目录」集合，
 * 供 renderer 渲染时无视 _dirOpen 强制展开（点1）。
 */
export function applyFilter(self: SyncStoreSelf): void {
  const force = new Set<string>();
  const out: SyncItem[] = [];
  for (const item of self._allItems) {
    const kept = filterNode(self, item, force);
    if (kept) out.push(kept);
  }
  self._filteredItems = out;
  self._forceOpenPaths = force;
}
