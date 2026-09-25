// ===== sidebar 数据层 =====

/** 推送/拉取下拉「全部类型」项的 data-sync-type 值（单一事实源） */
export const SYNC_TYPE_ALL = "all";

/** sidebar 整合包实例（loader 转换后的渲染格式） */
export interface SidebarInstance {
  name: string;
  dir: string;
  exists: boolean;
  hasMod: boolean;
  status: "missing" | "extra" | "complete";
  synced: number;
  missing: number;
  extra: number;
  disabled: number;
  rtype: string;
  variantGroups: {
    missingGroups: string[];
    extraGroups: string[];
    variantMap: Record<string, { items: string[]; count: number }>;
  } | null;
  _missingPaths: string[];
  _extraPaths: string[];
  /** loader 生成 { synced, disabled }；fallback 模拟数据为 { synced, missing, extra }——宽松化以兼容两者 */
  items: {
    synced: unknown[];
    missing?: unknown[];
    extra?: unknown[];
    disabled?: unknown[];
  };
}
