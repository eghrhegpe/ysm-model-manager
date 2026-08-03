// ===== sidebar 数据层 =====

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
  variantGroups: { missingGroups: string[]; extraGroups: string[]; variantMap: Record<string, { items: string[]; count: number }> } | null;
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

/** Go 不可用时的后备模拟数据 */
export function fallbackInstances(): SidebarInstance[] {
  return [
    {
      name: "我的整合包",
      synced: 3,
      missing: 1,
      extra: 2,
      status: "missing",
      exists: true,
      hasMod: true,
      disabled: 0,
      rtype: "ysm",
      variantGroups: null,
      _missingPaths: [],
      _extraPaths: [],
      dir: "",
      items: {
        synced: [
          { name: "steve_skin.ysm", size: "" },
          { name: "alex_deluxe.ysm", size: "" },
          { name: "neon_sword.ysm", size: "" },
        ],
        missing: [{ name: "dragon_armor.zip", size: "" }],
        extra: [
          { name: "custom_hat.ysm", size: "" },
          { name: "old_hat.ysm", size: "" },
        ],
      },
    },
    {
      name: "光影测试包",
      synced: 1,
      missing: 2,
      extra: 0,
      status: "missing",
      exists: true,
      hasMod: true,
      disabled: 0,
      rtype: "ysm",
      variantGroups: null,
      _missingPaths: [],
      _extraPaths: [],
      dir: "",
      items: { synced: [], missing: [], extra: [] },
    },
    {
      name: "空岛生存",
      synced: 5,
      missing: 0,
      extra: 0,
      status: "complete",
      exists: true,
      hasMod: true,
      disabled: 0,
      rtype: "ysm",
      variantGroups: null,
      _missingPaths: [],
      _extraPaths: [],
      dir: "",
      items: { synced: [], missing: [], extra: [] },
    },
    {
      name: "RPG 冒险",
      synced: 2,
      missing: 3,
      extra: 0,
      status: "missing",
      exists: true,
      hasMod: true,
      disabled: 0,
      rtype: "ysm",
      variantGroups: null,
      _missingPaths: [],
      _extraPaths: [],
      dir: "",
      items: { synced: [], missing: [], extra: [] },
    },
  ];
}
