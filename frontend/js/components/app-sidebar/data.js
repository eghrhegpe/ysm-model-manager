// ===== sidebar 数据层 =====

// Go 不可用时的后备模拟数据
export function fallbackInstances() {
  return [
    {
      name: "我的整合包",
      synced: 3,
      missing: 1,
      extra: 2,
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
      items: { synced: [], missing: [], extra: [] },
    },
    {
      name: "空岛生存",
      synced: 5,
      missing: 0,
      extra: 0,
      items: { synced: [], missing: [], extra: [] },
    },
    {
      name: "RPG 冒险",
      synced: 2,
      missing: 3,
      extra: 0,
      items: { synced: [], missing: [], extra: [] },
    },
  ];
}
