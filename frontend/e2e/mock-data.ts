// ===== E2E mock 数据源（共享 — vitest 与 E2E 共用，防双源漂移）=====
// 单源真理：改 Go Binding 签名时，只改本文件一处。
// vitest 测试通过 vi.mock 工厂引用本文件；
// E2E 测试通过 fixture 注入本文件为 page.addInitScript 字符串。

/** 所有 mock 绑定的返回值 */
export const MOCK_DATA = {
  GetAppVersion: "v1.0.0-e2e",
  GetRepoRoot: "/e2e/repo",
  LoadAppConfig: { mcRoot: "/e2e/mc" },
  ScanModelEntries: [
    { Name: "model-a.ysm", Path: "/e2e/repo/model-a.ysm" },
    { Name: "model-b.ysm", Path: "/e2e/repo/model-b.ysm" },
    { Name: "subdir", Path: "/e2e/repo/subdir", IsDir: true },
    // 资源包类型条目（供 app-resource-manager 列表渲染）
    { Name: "pack-a.zip", Path: "/e2e/repo/pack-a.zip" },
    { Name: "pack-b.zip", Path: "/e2e/repo/pack-b.zip" },
  ],
  ListVersionInstances: [
    { Name: "1.20.1-Fabric", VersionDir: "/e2e/mc/1.20.1-Fabric" },
    { Name: "1.21-NeoForge", VersionDir: "/e2e/mc/1.21-NeoForge" },
  ],
  GetInstanceSyncStatus: [
    { path: "a.ysm", name: "模型A", status: "synced", type: "ysm", size: 1024 },
    { path: "b.ysm", name: "模型B", status: "missing", type: "ysm", size: 2048 },
  ],
  LoadResourceTypes: JSON.stringify({
    resourceTypes: [
      { id: "ysm", name: "YSM 模型", icon: "💎" },
      { id: "resourcepack", name: "资源包", icon: "🎨", actions: ["import", "toggle", "delete", "openFolder"] },
    ],
  }),
  ToggleModelEnable: true,
  IsFileBanned: false,
  ToggleResourcePack: undefined,
  SaveAppConfig: undefined,
  DetectResourceType: "ysm",
  GetAppVersion: "v1.0.0-e2e",
  ReadPackMeta: { name: "测试资源包", description: "E2E 测试资源包", pack_format: 15 },
  IsResourcePackEnabled: true,
  SelectImportZip: "",
  SelectImportFile: "",
  ImportByType: undefined,
  DeleteResourcePack: undefined,
  OpenFolder: undefined,
  ReadShaderpackLang: { name: "光影包测试", entries: {} },
  PushSingleResourceToInstance: undefined,
  PullSingleResourceFromInstance: undefined,
  GetMinecraftPaths: [],
  GetResourceInstanceStatus: [],
  ClearScanCache: undefined,
  GetPackInfo: null,
  LoadWorkshopSites: [],
  LoadWorkshopCreators: [],
  ListModelAuthors: [],
  ScanLocalAuthors: [],
  RenameFile: undefined,
  SelectDirectory: "",
  IsFileBanned: false,
  SyncCustomToRepo: undefined,
  GetModelTexSizes: [],
  ExportBoneStructures: "",
  SearchModels: [],
  ListModelAuthors: [],
  GenerateRepoIndex: "",
} as const;

export type MockData = typeof MOCK_DATA;
export type MockKey = keyof MockData;

/**
 * 生成可注入 page.addInitScript 的 mock bridge 代码字符串。
 * 将 MOCK_DATA 序列化为 JS 对象字面量，注入 window.go.main.App 命名空间。
 */
export function generateMockBridgeScript(overrides: Partial<MockData> = {}): string {
  const merged = { ...MOCK_DATA, ...overrides };
  const lines: string[] = [];
  lines.push("window.go = { main: { App: {");
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value === "string") {
      // 字符串值：直接生成字符串字面量返回（如 LoadResourceTypes 的 JSON 字符串）
      lines.push(`${key}: async () => ${JSON.stringify(value)},`);
    } else {
      // 非字符串值：序列化后包 JSON.parse 还原（对象/数组/布尔等）
      const json = JSON.stringify(value, (_k, v) => (v === undefined ? "__UNDEFINED__" : v));
      lines.push(`${key}: async () => JSON.parse(${JSON.stringify(json)}),`);
    }
  }
  lines.push("} } };");
  lines.push("window.runtime = { Events: { On: () => () => {}, Off: () => {}, Emit: () => {} } };");
  return lines.join("\n");
}