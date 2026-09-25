// ===== sidebar 数据层 =====

/** 推送/拉取下拉「全部类型」项的 data-sync-type 值（单一事实源）。
 *  跨视图评估（2026-09 锐评收口）：`data-sync-type="all"` 仅 app-sidebar 内部流通
 *  （tpl 生成 / sync-flow 消费 / 测试查询）；全仓其余 "all" 字面量（sync-manager 状态筛选、
 *  diagnostics 日志/去重过滤、litematic 切片模式、截图键）语义各异，不属同一契约——
 *  维持视图内常量，不升级为共享层。未来若他视图出现同 token 再评估上提。 */
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
