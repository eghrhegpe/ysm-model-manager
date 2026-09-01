// ===== E2E mock 数据源（共享 — vitest 与 E2E 共用，防双源漂移）=====
// 单源真理：改 Go Binding 签名时，只改本文件一处。
// vitest 测试通过 vi.mock 工厂引用本文件；
// E2E 测试通过 fixture 注入本文件为 page.addInitScript 字符串。

/** 所有 mock 绑定的返回值 */
export const MOCK_DATA = {
  GetAppVersion: "v1.0.0-e2e",
  // 禁用状态检查：loader 对每个条目调用 IsFileBanned(e.Path)（返回 false=未禁用）。
  // ⚠️ 上一轮去重误删两处定义后此处曾缺失 → "IsFileBanned is not a function"，
  // 全量 file-tree/settings/tree-multiselect 渲染失败（retries: 0 暴露）。
  IsFileBanned: false,
  GetRepoRoot: "/e2e/repo",
  // LoadAppConfig 必须补全前端消费的字段——缺 filesRoot 会让 import-queue 误弹
  // 「请先设置文件存储路径」，缺 theme/linkMode/mirror 走错分支（子代理审核 P3）
  LoadAppConfig: {
    mcRoot: "/e2e/mc",
    filesRoot: "/e2e/repo",
    theme: "",
    linkMode: "copy",
    mirror: "",
  },
  // 子代理审核 P2 补覆盖缺口：sync-manager 主数据源等此前缺失 → 降级/报错态假绿
  GetInstanceSyncStatus: JSON.stringify([]),
  CurrentVersion: "v1.0.0-e2e",
  OpenInBrowser: undefined,
  CheckFileExists: true,
  AddImportLog: undefined,
  AddOpLog: undefined,
  ScanModelEntriesWithLabel: [
    { Name: "model-a.ysm", Path: "/e2e/repo/model-a.ysm", Size: 1024, ModTime: 0, Ext: ".ysm", Hash: "", HasTags: false },
    { Name: "model-b.ysm", Path: "/e2e/repo/model-b.ysm", Size: 2048, ModTime: 0, Ext: ".ysm", Hash: "", HasTags: false },
    { Name: "subdir", Path: "/e2e/repo/subdir", Size: 0, ModTime: 0, Ext: "", Hash: "", HasTags: false },
    // 嵌套文件：其 Path 前缀段生成 subdir 目录节点 → tree-dir 真实渲染子行
    // （此前无嵌套条目 → tree-dir 恒 0，目录展开/折叠测试永远 skip，file-tree 审核 P1）
    { Name: "subdir-model.ysm", Path: "/e2e/repo/subdir/subdir-model.ysm", Size: 512, ModTime: 0, Ext: ".ysm", Hash: "", HasTags: false },
    // 资源包类型条目（供 app-resource-manager 列表渲染）
    { Name: "pack-a.zip", Path: "/e2e/repo/pack-a.zip", Size: 4096, ModTime: 0, Ext: ".zip", Hash: "", HasTags: false },
    { Name: "pack-b.zip", Path: "/e2e/repo/pack-b.zip", Size: 8192, ModTime: 0, Ext: ".zip", Hash: "", HasTags: false },
  ],
  ScanModelEntriesFiltered: [
    { Name: "model-a.ysm", Path: "/e2e/repo/model-a.ysm", Size: 1024, ModTime: 0, Ext: ".ysm", Hash: "", HasTags: false },
    { Name: "model-b.ysm", Path: "/e2e/repo/model-b.ysm", Size: 2048, ModTime: 0, Ext: ".ysm", Hash: "", HasTags: false },
    { Name: "subdir-model.ysm", Path: "/e2e/repo/subdir/subdir-model.ysm", Size: 512, ModTime: 0, Ext: ".ysm", Hash: "", HasTags: false },
  ],
  ListVersionInstances: [
    { Name: "1.20.1-Fabric", VersionDir: "/e2e/mc/1.20.1-Fabric" },
    { Name: "1.21-NeoForge", VersionDir: "/e2e/mc/1.21-NeoForge" },
  ],
  GetResourceInstanceStatus: [
    // 对齐 models.ts 必填字段（CustomDir/Status/Disabled/HasYSM/Files）——
    // 缺字段会让依赖排序/状态分支的 e2e 掩盖真实现问题（子代理审计 P2）。
    // Status 契约值域："complete" | "missing" | "extra"（models.ts 注释），
    // Files 契约：CustomFileInfo[] | null——"ok"/0 属漂移值，E2E 会命中生产不存在的状态
    { Name: "1.20.1-Fabric", VersionDir: "/e2e/mc/1.20.1-Fabric", CustomDir: "", Status: "complete", Disabled: [], HasYSM: true, Files: [], Missing: [], Extra: [], Synced: 0, HasMod: false },
    { Name: "1.21-NeoForge", VersionDir: "/e2e/mc/1.21-NeoForge", CustomDir: "", Status: "complete", Disabled: [], HasYSM: true, Files: [], Missing: [], Extra: [], Synced: 0, HasMod: false },
  ],
  LoadResourceTypes: JSON.stringify({
    resourceTypes: [
      { id: "ysm", name: "YSM 模型", icon: "💎" },
      { id: "resourcepack", name: "资源包", icon: "🎨", actions: ["import", "toggle", "delete", "openFolder"] },
    ],
  }),
  ToggleModelEnable: true,
  // 统一启禁（方案 A）：e2e 未直接触达，补键防绑定契约守卫报错（undefined 最安全）
  ToggleEnable: undefined,
  // 对齐 binding 契约 Promise<boolean>——原 undefined 类型错位（子代理审计 P2）
  ToggleResourcePack: true,
  SaveAppConfig: undefined,
  DetectResourceType: "ysm",
  DetectLauncherInstances: [],
  // ReadPackMeta 返回 JSON 字符串（对齐 Go binding 契约，代码侧 JSON.parse 消费）
  ReadPackMeta: JSON.stringify({
    name: "测试资源包",
    description: "E2E 测试资源包",
    pack_format: 15,
  }),
  IsResourcePackEnabled: true,
  SelectImportZip: "",
  SelectImportFile: "",
  ImportByType: undefined,
  // 拖拽导入（import-executor 直调，返回 undefined 表示静默成功）
  ImportModelFile: undefined,
  ImportModelFolder: undefined,
  ImportModelFolderTo: undefined,
  // 整合包卡片拖拽导入（先入仓库再推送；e2e 未触达，补 undefined 最安全）
  ImportFileAndPushToInstance: undefined,
  ImportFolderAndPushToInstance: undefined,
  DeleteResourcePack: undefined,
  OpenFolder: undefined,
  ReadShaderpackLang: JSON.stringify({ name: "光影包测试", entries: {} }),
  PushSingleResourceToInstance: undefined,
  PullSingleResourceFromInstance: undefined,
  GetMinecraftPaths: [],
  ClearScanCache: undefined,
  EnsureStorageDirs: undefined,
  // P2 修复（子代理审计）：github 页 _initGithub→loadRepos 调用 LoadGitHubRepos，
  // 原 MOCK_DATA 无此键 → mock bridge 返回 undefined → 抛 TypeError → 页面显示
  // 「加载失败」，但导航测试只断言 active class → 假绿；补空数组（无仓库正常态）
  LoadGitHubRepos: [],
  // settings relink 依赖 SetLinkMode（community.ts 已解构），一并补齐
  SetLinkMode: undefined,
  SetAllowedCommands: undefined,
  // 对齐 binding 契约 PackInfo 非空对象——原 null 类型不符（子代理审计 P2）
  GetPackInfo: {
    name: "测试资源包",
    description: "E2E 测试资源包",
    pack_format: 15,
    thumbnail: "",
  },
  DefaultWorkshopSites: [
    {
      id: "bilibili",
      icon: "📺",
      label: "B站",
      url: "https://www.bilibili.com/",
      desc: "展示模型视频的主流平台",
      group: "search",
      searchUrl: "https://search.bilibili.com/all?keyword={{q}}",
      presetSearches: [{ label: "YSM免费模型", q: "" }],
    },
    {
      id: "github",
      icon: "🐙",
      label: "GitHub",
      url: "https://github.com/",
      desc: "开源仓库托管平台",
      group: "repo",
      // 对齐真实 workshop_sites.json 的 github 条目：带 searchUrl 走 fillSearch 分支
      // （缺失会退化为「打开首页」分支，e2e 覆盖不到真实搜索路径）
      searchUrl: "https://github.com/search?q={{q}}",
      presetSearches: [{ label: "免费 YSM 模型仓库", q: "" }],
    },
  ],
  LoadWorkshopCreators: [
    // 对齐 WorkshopCreator 契约：desc 必填（community 列表卡片渲染 cr.desc，缺失显示 undefined）
    { name: "测试创作者A", desc: "E2E 创作者A", type: "bilibili" },
    { name: "测试创作者B", desc: "E2E 创作者B", type: "bilibili" },
  ],
  ListModelAuthors: [],
  ScanLocalAuthors: [],
  GetImportLogs: [],
  GetRuntimeLogs: [],
  ClearImportLogs: undefined,
  RenameFile: undefined,
  // 设置页「选择目录」返回非空路径（走通 SelectDirectory → saveCfg 保存链路）
  SelectDirectory: "/e2e/mc",
  // 对齐 binding 契约 Promise<number>（同步文件数）——原 undefined 类型错位
  SyncCustomToRepo: 0,
  GetModelTexSizes: [],
  SearchAllModels: [],
  SearchModels: [],
  GenerateRepoIndex: "",
  // ===== 契约守卫补全：以下 binding 为 e2e 未触达函数，显式占位 undefined（防漏加漂移）=====
  AnalyzeYSMModel: undefined,
  AnalyzeBedrockModel: undefined,
  AnalyzeBedrockModelEntry: undefined,
  AllTags: undefined,
  BackupWorkshopCreators: undefined,
  BatchExtractCreatorAvatars: undefined,
  Build3DSpecFromGeometryJSON: undefined,
  CacheModelAvatars: undefined,
  CachedCreatorAvatar: undefined,
  CancelQueue: undefined,
  CheckUpdate: undefined,
  ClearCustomDir: undefined,
  ClearInstanceResources: undefined,
  ClearRuntimeLogs: undefined,
  ClosePlazaWindow: undefined,
  CopyModelFile: undefined,
  CountInstanceResources: undefined,
  CreateDir: undefined,
  DebugExtractCreatorAvatar: undefined,
  DeduplicateCustomDir: undefined,
  DeleteFromRecycle: undefined,
  DetectConflicts: undefined,
  DetectZipType: undefined,
  DoUpdate: undefined,
  DownloadFromGitHub: undefined,
  EmptyRecycleBin: undefined,
  EnqueueDownloads: undefined,
  ExecuteCLI: undefined,
  ExportModelStructureJSON: undefined,
  ExportWorkshopCreatorsJSONFile: undefined,
  ExportWorkshopSitesCSV: undefined,
  ExportWorkshopSitesJSONFile: undefined,
  ExtractPreviewTexture: undefined,
  ExtractYSMHeader: undefined,
  ExtractYSMHeaderFromBase64: undefined,
  ExtractYsmSummary: undefined,
  FindDuplicateFiles: undefined,
  FindPreviewImage: undefined,
  GetAllRepoRoots: undefined,
  GetAllowedCLICommands: undefined,
  GetConfigPath: undefined,
  GetDefaultRepoRoot: undefined,
  GetGlobalCustomDir: undefined,
  GetInstanceStatus: undefined,
  GetLinkMode: undefined,
  GetLitematicVoxelData: undefined,
  GetModel3DSpec: undefined,
  GetSyncScanDirs: undefined,
  GetModelTags: undefined,
  GetNbtVoxelData: undefined,
  GetSchematicVoxelData: undefined,
  GetSubDirMap: undefined,
  GetVoxelDataInContainer: undefined,
  GetWasmBinary: undefined,
  GetWindowPosition: undefined,
  GetYSMRepoRoot: undefined,
  HasYSMMod: undefined,
  ImportModelFileOverwrite: undefined,
  ImportModelFileOverwriteTo: undefined,
  ImportModelFileOverwriteToMMD: undefined,
  ImportModelFileSkipCheck: undefined,
  ImportModelFileTo: undefined,
  ImportModelFileToMMD: undefined,
  ImportWorkshopSitesCSV: undefined,
  InstallModelFile: undefined,
  InstallModelTo: undefined,
  InstallModelWithOverlay: undefined,
  InstallResourceToInstance: undefined,
  InvalidateScanCache: undefined,
  ListAllFilePaths: undefined,
  ListByTag: undefined,
  ListContainerEntries: undefined,
  ListFileNames: undefined,
  ListPackModels: undefined,
  ListPackModelsDetail: undefined,
  ListRecycleBin: undefined,
  MergeWorkshopCreatorsFromJSON: undefined,
  MoveModelFile: undefined,
  MoveToRecycle: undefined,
  MoveToRecycleEx: undefined,
  NavigatePlazaWindow: undefined,
  OpenInstanceFolder: undefined,
  PlazaGoBack: undefined,
  PlazaGoForward: undefined,
  PlazaReload: undefined,
  PlazaZoomIn: undefined,
  PlazaZoomOut: undefined,
  PlazaZoomReset: undefined,
  PullResourceFromInstance: undefined,
  PushResourceToInstance: undefined,
  QueueStatus: undefined,
  ReadFileBytes: undefined,
  ReadFileBytesBatch: undefined,
  ReadFileBytesBatchWithMeta: undefined,
  SaveCachedTexture: undefined,
  GetCachedTexture: undefined,
  GetCachedTextureByHash: undefined,
  HasCachedTexture: undefined,
  HasCachedTextures: undefined,
  ClearTextureCache: undefined,
  ReadLitematicMeta: undefined,
  ReadNbtStructure: undefined,
  ReadPackEntry: undefined,
  ReadSchematic: undefined,
  RelinkAllInstanceResources: undefined,
  RelinkCustomDir: undefined,
  ResolveConflicts: undefined,
  RemoveDir: undefined,
  RenameDir: undefined,
  ReplaceWorkshopCreatorsFromJSON: undefined,
  RepoHealthAudit: undefined,
  RepoHealthAuditAll: undefined, // 全仓库体检（binding 重生成后补键，契约断言）
  ResetResourceRoot: undefined,
  ResetWorkshopConfigs: undefined,
  RestartApplication: undefined,
  RestoreFromRecycle: undefined,
  RevealInExplorer: undefined,
  SavePreviewTempFile: undefined,
  SaveScreenshotFile: undefined,
  SaveThresholds: undefined,
  SaveWindowPosition: undefined,
  SaveWorkshopCreators: undefined,
  SaveWorkshopCreatorsBySite: undefined,
  SaveWorkshopPresetsBySite: undefined,
  SaveWorkshopSites: undefined,
  ScanModelEntries: undefined,
  SetApp: undefined,
  SetDownloadMirror: undefined,
  SetMainWindow: undefined,
  SetModelTags: undefined,
  SetResourceRoot: undefined,
  SetSessionFilesRoot: undefined,
  SetVoxelMaxBlocks: undefined,
  SyncModelToggleStatus: undefined,
  SyncResources: undefined,
  ValidateMinecraftDir: undefined,
  ValidateWorkshopSites: undefined,
} as const;

export type MockData = typeof MOCK_DATA;
export type MockKey = keyof MockData;

// ===== 契约守卫：mock 键与 binding 导出双向对齐（防 e2e mock 漂移，批次4 P2 / P3）=====
// binding 产物由 npm run generate:bindings（-ts 契约）生成并 git 跟踪。
// 正向：binding 每导出一个函数，mock 必须提供对应键；出现缺失键时下方条件类型退化为 false → 赋值编译错。
// 反向：binding 删除导出后 mock 旧键成死代码（仍注入 window.go 无消费方）——knip project 仅
// src/**（e2e 不在扫描范围），且 generateMockBridgeScript 迭代全部键使任何键都被视为"已用"，
// 无现成死代码工具覆盖，故在此显式断言 mock 键 ⊆ binding 导出。
// tsc 报错后到 MOCK_DATA 里补/删键即可（未被 e2e 触达的函数补 undefined 最安全）。
import type * as Bindings from "../bindings/ysm-model-manager/internal/app/app.ts";
type BindingExportName = keyof typeof Bindings;
type MissingMockKeys = Exclude<BindingExportName, MockKey>;
const __mockBindingContract: [MissingMockKeys] extends [never] ? true : false = true;
void __mockBindingContract;
// 反向断言：mock 键必须仍存在于 binding 导出，防 binding 删除后 mock 旧键成为死代码
type StaleMockKeys = Exclude<MockKey, BindingExportName>;
const __mockBindingReverseContract: [StaleMockKeys] extends [never] ? true : false = true;
void __mockBindingReverseContract;

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
    } else if (value === undefined) {
      // undefined 单独发字面量——JSON.stringify 会把顶层 undefined 序列化为
      // "undefined" 字符串，JSON.parse 还原后仍是字符串，消费方真值判断走错分支
      // （如 ImportByType 的 if (errMsg) 恒真 → 误报导入失败）
      lines.push(`${key}: async () => undefined,`);
    } else {
      // 其他值（对象/数组/布尔）：直接 JSON.stringify——对象内 undefined 属性
      // 会被 JSON 序列化丢弃，JSON.parse 后该键为 undefined，与语义一致。
      // 勿用 replacer 替换为 "__UNDEFINED__"（运行时还原不了，P3 陷阱）。
      const json = JSON.stringify(value);
      lines.push(`${key}: async () => JSON.parse(${JSON.stringify(json)}),`);
    }
  }
  lines.push("} } };");
  lines.push("window.runtime = { Events: { On: () => () => {}, Off: () => {}, Emit: () => {} } };");
  return lines.join("\n");
}
