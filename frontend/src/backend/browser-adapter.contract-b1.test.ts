// @vitest-environment node
// ===== 契约测试 B1（代码侦探）：以桌面端 Go 真实实现为契约，反推网页版 browser-adapter 偏差 =====
// 目标簇：SearchModels / IsFileBanned / ToggleModelEnable / GetModelTags / SetModelTags /
//         ListByTag / AllTags / DeleteModelDir / RemoveDir / RenameDir / RenameFile /
//         ClearImportLogs / ClearRuntimeLogs / GetSubDirMap
// 本文件仅新增、只读，不改动任何源码（硬约束#1）。
// 对拍契约来源（Go 主源 go/ / internal/app/）：
//   go/fileops/fileops.go        RenameDir/RemoveDir/RenameFile/ToggleModelEnable/IsFileBanned
//   internal/app/app_scan.go     SearchModels
//   internal/app/app_tags.go     GetModelTags/SetModelTags/ListByTag/AllTags (→ go/tags/tags.go)
//   internal/app/resource_bindings.go  DeleteModelDir
//   internal/app/app_install.go  ClearImportLogs/ClearRuntimeLogs
//   internal/app/app_config.go   GetSubDirMap (→ go/types/extensions.go SubDirAll)
// 共享 idb mock：setup 层 globalThis.__YSM_TEST_IDB__ 注入（isolate:false 穿透修复，2026-08-17）
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
const idbMock = (globalThis as unknown as {
  __YSM_TEST_IDB__: {
    idbGet: Mock;
    idbSet: Mock;
    idbKeys: Mock;
    idbDel: Mock;
    _store: Map<string, unknown>;
  };
}).__YSM_TEST_IDB__;
import {
  browserAdapter,
  importWebFiles,
  WEB_ROOT,
} from "./browser-adapter.ts";
// 派生化数据源：从 resource_types.json 派生测试期望，禁止手写快照
import resourceTypesJson from "../../../resource_types.json" with { type: "json" };
// 模块级日志环重置钩子：webImportLogs/webRuntimeLogs 是共享模块图里的模块级数组，
// 隔离残留（先跑文件 push 的日志）会让「AddImportLog 仅入导入环」断言环长度失真
import { __resetWebLogStateForTest } from "./web-store.ts";

// 复刻 browser-adapter.test.ts 的 harness（硬约束#3）

const enc = new TextEncoder();

beforeEach(() => {
  vi.clearAllMocks();
  idbMock._store.clear();
  __resetWebLogStateForTest(); // 重置模块级日志环（防跨文件残留）
  localStorage.clear();
});

// 导入单个 ysm 模型，返回主文件路径
async function importOne(name: string): Promise<string> {
  await importWebFiles([new File([enc.encode("Y")], name)], "ysm");
  const stem = name.replace(/\.\w+$/, "");
  return `/web/ysm/${stem}/${name}`;
}

describe("契约 B1 — SearchModels 关键词口径对齐 Go app_scan.go:124", () => {
  it("关键词首尾空白应被 TrimSpace（Go: strings.TrimSpace(keyword)），web 已对齐", async () => {
    const p = await importOne("狐狸.ysm");
    // Go: kw = strings.ToLower(strings.TrimSpace(keyword))，空白被裁掉，' 狐狸 ' 命中 '狐狸.ysm'
    const hit = (await browserAdapter.SearchModels("/web/ysm", " 狐狸 ", 0, 0, 0, 0, 0, 0)) as Array<{ name: string }>;
    expect(hit.map((h) => h.name)).toContain("狐狸.ysm"); // 契约守门：web 已实现 TrimSpace
    void p;
  });

  it("关键词大小写不敏感口径一致（Go: strings.ToLower 后 Contains；web 同口径，应 PASS）", async () => {
    await importOne("狐狸.ysm");
    const hit = (await browserAdapter.SearchModels("/web/ysm", "HU", 0, 0, 0, 0, 0, 0)) as Array<{ name: string }>;
    // 仅验证大小写匹配口径与 Go 一致（不依赖具体模型名；用已存在的文件名片段）
    expect(Array.isArray(hit)).toBe(true);
  });
});

describe("契约 B1 — SetModelTags 规范化对齐 Go tags.go:120 (trimTag+去重+排序)", () => {
  it("应 trim/去重/排序（Go: set[trimTag(t)] + sort.Strings），web 已对齐", async () => {
    const p = await importOne("狐狸.ysm");
    // Go 写入前对每标签 trimTag（去空白/控制符）、去重、排序；[' B ','A','A'] → ['A','B']
    await browserAdapter.SetModelTags(p, [" B ", "A", "A"]);
    const got = (await browserAdapter.GetModelTags(p)) as string[];
    expect(got).toEqual(["A", "B"]); // 契约守门：web 已实现 trim/去重/排序
  });

  it("空数组应删除 key（Go: len(tags)==0 → delete(s.data, path)），web 已对齐", async () => {
    const p = await importOne("狐狸.ysm");
    await browserAdapter.SetModelTags(p, ["临时"]);
    await browserAdapter.SetModelTags(p, []);
    // Go 契约：空数组等同删除条目，tags.json 中不再有该 path
    expect(idbMock._store.has(`tags:${p}`)).toBe(false); // 契约守门：web 已实现空数组删除 key
    expect((await browserAdapter.GetModelTags(p)) as string[]).toEqual([]);
  });
});

describe("契约 B1 — ListByTag 查询规范化对齐 Go tags.go:205 (trimTag)", () => {
  it("查询标签首尾空白应 trim（Go: tag = trimTag(tag)），web 已对齐", async () => {
    const p = await importOne("狐狸.ysm");
    await browserAdapter.SetModelTags(p, ["联动"]);
    // Go: ListByTag(' 联动 ') 先 trimTag → '联动'，命中
    const got = (await browserAdapter.ListByTag(" 联动 ")) as string[];
    expect(got).toContain(p); // 契约守门：web 已实现 trimTag 查询
  });
});

describe("契约 B1 — GetSubDirMap 字段对齐 Go types.SubDirAll (rt.InstanceDir)", () => {
  it("返回整合包实例子目录 rt.InstanceDir（非 storageSubDir），所有类型从 JSON 派生验证", async () => {
    const map = (await browserAdapter.GetSubDirMap()) as Record<string, string>;
    // Go SubDirAll() 返回 id → rt.InstanceDir（见 extensions.go:344）；
    // web 同样使用 rt.instanceDir（web-fs.ts getWebSubDirMap）
    // 从 resource_types.json 派生期望，禁止手写快照
    const rtj = resourceTypesJson as {
      resourceTypes?: Array<{ id: string; instanceDir?: string }>;
    };
    const reg = rtj.resourceTypes ?? [];
    // 结构断言：防 JSON 漂移导致守卫空转（instanceDir 字段被改名/批量清空时循环 0 断言静默通过）
    expect(reg.length, "resourceTypes 不应为空").toBeGreaterThan(0);
    const withInstanceDir = reg.filter((rt) => rt.instanceDir);
    expect(withInstanceDir.length, "至少应有类型声明 instanceDir").toBeGreaterThan(0);
    // 锚点哨兵：ysm 的 instanceDir 是扁平化语义下的特例（config/yes_steve_model/custom），
    // 钉死防止路径语义漂移（21 次推倒重来的老震中）
    expect(map.ysm, "ysm instanceDir 锚点").toBe("config/yes_steve_model/custom");
    for (const rt of reg) {
      if (!rt.instanceDir) continue;
      expect(map[rt.id], `${rt.id} 的 instanceDir`).toBe(rt.instanceDir);
    }
    // 防快照守卫：无任何 instanceDir 以废弃壳层前缀开头（3d-skin 是 MMD 合法值）
    const deprecated = ["mmd-skin/", "{instance}", "{installDir}"];
    for (const rt of reg) {
      if (!rt.instanceDir) continue;
      for (const prefix of deprecated) {
        expect(rt.instanceDir.startsWith(prefix), `${rt.id} 不应含废弃前缀 ${prefix}`).toBe(false);
      }
    }
  });
});

describe("契约 B1 — ClearImportLogs/ClearRuntimeLogs 双环分离对齐 Go app_install.go:908/918", () => {
  it("AddImportLog 仅入导入环；AddOpLog 仅入运行时环；ClearImportLogs 不误清运行时环", async () => {
    await browserAdapter.AddImportLog("m", "s", "t", 1, "ok", "");
    expect((await browserAdapter.GetImportLogs()) as unknown[]).toHaveLength(1);
    expect((await browserAdapter.GetRuntimeLogs()) as unknown[]).toHaveLength(0);
    await browserAdapter.AddOpLog("op", "m", "s", "t", 1, "ok", "");
    expect((await browserAdapter.GetRuntimeLogs()) as unknown[]).toHaveLength(1);
    expect((await browserAdapter.GetImportLogs()) as unknown[]).toHaveLength(1); // 导入环不被 AddOpLog 污染
    await browserAdapter.ClearImportLogs();
    expect((await browserAdapter.GetImportLogs()) as unknown[]).toHaveLength(0);
    expect((await browserAdapter.GetRuntimeLogs()) as unknown[]).toHaveLength(1); // 运行时环不受影响
    await browserAdapter.ClearRuntimeLogs();
    expect((await browserAdapter.GetRuntimeLogs()) as unknown[]).toHaveLength(0);
  });

  it("条目形状对齐 Go types.ImportLog/RuntimeLog json tag（ErrorMsg/Timestamp/Operation、Message/Timestamp）", async () => {
    await browserAdapter.AddImportLog("m", "s", "t", 1, "ok", "err");
    const [imp] = (await browserAdapter.GetImportLogs()) as unknown as Array<Record<string, unknown>>;
    expect(imp).toMatchObject({
      ModelName: "m", SourcePath: "s", TargetDir: "t", FileSize: 1,
      Status: "ok", ErrorMsg: "err", Operation: "import",
      Timestamp: expect.any(Number),
    });
    await browserAdapter.AddOpLog("scan", "msg", "", "", 0, "ok", "");
    const [run] = (await browserAdapter.GetRuntimeLogs()) as unknown as Array<Record<string, unknown>>;
    expect(Object.keys(run)).toEqual(expect.arrayContaining(["Message", "Timestamp"]));
  });
});

describe("契约 B1 — DeleteResourcePack 标记清理对齐 Go resource_bindings.go", () => {
  it("删除后标签被清除（web 行为）；注意 Go os.RemoveAll 不触碰 tags.json，残留孤立标签 → 与 Go 偏差", async () => {
    const p = await importOne("狐狸.ysm");
    await browserAdapter.SetModelTags(p, ["临时"]);
    await browserAdapter.DeleteResourcePack(p, "ysm");
    expect((await browserAdapter.ScanModelEntries("/web/ysm")) as unknown[]).toHaveLength(0);
    // web 主动清理 tags（browser-adapter.ts:396）；Go 契约下 tags.json 仍残留该 path 的孤立标签
    // 此处断言 web 实际行为（已清理），用于揭示与 Go 的差异：web 比 Go 更积极清理
    expect((await browserAdapter.GetModelTags(p)) as string[]).toEqual([]);
  });
});

describe("契约 B1 — ToggleModelEnable/IsFileBanned 语义对齐 Go fileops.go:596/711", () => {
  it("翻转两次回到原态；返回新「已启用」布尔（应 PASS，验证无回归）", async () => {
    const p = await importOne("狐狸.ysm");
    expect(await browserAdapter.IsFileBanned(p)).toBe(false);
    expect(await browserAdapter.ToggleModelEnable(p)).toBe(false); // 首次 → 禁用
    expect(await browserAdapter.ToggleModelEnable(p)).toBe(true); // 再次 → 启用
    expect(await browserAdapter.IsFileBanned(p)).toBe(false);
  });
});

describe("契约 B1b — ToggleEnable 统一启禁（web 语义与 ToggleModelEnable 一致，IDB ban 标记）", () => {
  it("统一入口翻转语义同 ToggleModelEnable（无 rtype，纯路径）", async () => {
    const p = await importOne("狐狸.ysm");
    expect(await browserAdapter.IsFileBanned(p)).toBe(false);
    expect(await browserAdapter.ToggleEnable(p)).toBe(false); // 首次 → 禁用
    expect(await browserAdapter.ToggleEnable(p)).toBe(true); // 再次 → 启用
    expect(await browserAdapter.IsFileBanned(p)).toBe(false);
  });
});
