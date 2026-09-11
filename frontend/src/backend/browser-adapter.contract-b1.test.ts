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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getIdbMock } from "@/test-utils/idb-mock.ts";
const idbMock = getIdbMock();
import {
  browserAdapter,
  importWebFiles,
} from "./browser-adapter.ts";
// SearchModels 数值条件契约：统计来源 Web Worker 批量统计，测试经注入 runner 替换
//（web-fs.searchWebModels → batchStatsWebModels → injectedRunner；null = 降级路径）
import { __setStatsRunnerForTest } from "./web-stats.ts";
// 直灌真实模型组结构用（多段组名场景：dir key 与组内 rel 无组名前缀）
import { dirKey, fileKey } from "./web-fs-shared.ts";
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
  __setStatsRunnerForTest(null); // 默认恢复 Worker 真实路径（本文件不触碰 Worker）
});
afterEach(() => {
  __setStatsRunnerForTest(null); // 防注入 runner 泄漏到后续测试文件（isolate:true 下亦防模块级残留）
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

  it("关键词大小写不敏感口径一致（Go: strings.ToLower 后 Contains；web 同口径）", async () => {
    await importOne("Fox.ysm");
    // 小写关键词应命中大写文件名（ToLower 折叠：'fox' 命中 'Fox.ysm'）
    const hitLower = (await browserAdapter.SearchModels("/web/ysm", "fox", 0, 0, 0, 0, 0, 0)) as Array<{ name: string }>;
    expect(hitLower.map((h) => h.name)).toContain("Fox.ysm");
    // 大写关键词同样命中（Go: strings.ToLower(keyword) 后比较，大小写均折叠）
    const hitUpper = (await browserAdapter.SearchModels("/web/ysm", "FOX", 0, 0, 0, 0, 0, 0)) as Array<{ name: string }>;
    expect(hitUpper.map((h) => h.name)).toContain("Fox.ysm");
  });
});

// ===== 契约 B1c — SearchModels kw 快路径降级语义 = web 契约（ADR-174 D3 有意差异显式锁）=====
// 差异声明（与 Go 的有意差异，ADR-174 D3 三类全满足：web 环境硬约束驱动 / binding 注释 + 本测试
// 双处显式声明 / UI 经 consumeWebSearchDegraded 提示而非红错）：
//   Go   app_scan.go SearchModels 对候选**恒**跑 AnalyzeBedrockModel，BoneCount==0（不可分析）即排除，
//        结果填真实 stats 且按 Name 主键稳定排序——即使无数值过滤条件也如此。
//   web  无数值条件 → kw 快路径不做内容分析：不可分析条目也命中，行形状=降级
//        （boneCount/cubeCount/texWidth/texHeight 全 0 + hasError:false），保持扫描序、不做 Name 排序。
// 本 describe 把「降级即 web 契约」显式锁死，防未来把差异当 bug 修、或把降级误当正确语义对齐 Go。
describe("契约 B1c — SearchModels kw 快路径降级 = web 契约（vs Go 恒分析 + BoneCount==0 排除）", () => {
  it("1 字节无效 stub（Go 侧 AnalyzeBedrockModel 必失败 → 排除）在 kw 快路径仍命中，行形状=降级全 0 + hasError:false", async () => {
    await importOne("stub.ysm"); // importOne 只写入 1 字节 "Y"，无任何可分析内容
    const hit = (await browserAdapter.SearchModels("/web/ysm", "stub", 0, 0, 0, 0, 0, 0)) as Array<{
      name: string;
      boneCount: number;
      cubeCount: number;
      texWidth: number;
      texHeight: number;
      hasError: boolean;
    }>;
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({
      name: "stub.ysm",
      boneCount: 0, // 降级行数值全 0：Go 此处会填真实 stats
      cubeCount: 0,
      texWidth: 0,
      texHeight: 0,
      hasError: false, // 不标错：web 契约 = 降级提示（consumeWebSearchDegraded），不是红错
    });
  });
});

// ===== 契约 B1d — SearchModels 六数值参数过滤对齐 Go app_scan.go:132-160 (modelMatchesFilters) =====
// Go 语义（modelMatchesFilters，app_scan.go:133-153，逐条对照）：
//   [L134] model.BoneCount == 0 → 排除（恒，无条件）；web 侧 = stats.hasError（stats-core 对齐 BoneCount==0）
//   [L137] minBones > 0 && BoneCount < minBones → 排除
//   [L140] maxBones > 0 && BoneCount > maxBones → 排除
//   [L143] minCubes > 0 && CubeCount < minCubes → 排除
//   [L146] maxCubes > 0 && CubeCount > maxCubes → 排除
//   [L149] minTex > 0 && (TexWidth < minTex || TexHeight < minTex) → 排除（宽或高任一低于下限即排除）
//   [L152] maxTex > 0 && (TexWidth > maxTex || TexHeight > maxTex) → 排除（宽或高任一超上限即排除）
// 统计来源：web 走 Web Worker 批量统计（statsFromJsonBytes/statsFromDecodedFiles）；
// 测试经 __setStatsRunnerForTest 注入确定性 stats（隔离 Worker/WASM，聚焦过滤语义本身）。
// 六参数 >0 才参与过滤：0 = 不设限（Go 同款 `> 0` 守卫，见下方「无数值条件」断言）。
describe("契约 B1d — SearchModels 六数值参数过滤对齐 Go modelMatchesFilters", () => {
  // 两个模型：狐狸 10骨5方64x64；狼 2骨3方16x16（stats 注入，与文件名绑定）
  const seedTwo = async (): Promise<void> => {
    await importOne("狐狸.ysm");
    await importOne("狼.ysm");
    __setStatsRunnerForTest(async (paths: string[]) =>
      paths.map((p) => ({
        boneCount: p.includes("狐狸") ? 10 : 2,
        cubeCount: p.includes("狐狸") ? 5 : 3,
        texWidth: p.includes("狐狸") ? 64 : 16,
        texHeight: p.includes("狐狸") ? 64 : 16,
        hasError: false,
      })),
    );
  };

  it("minBones/maxBones 边界（Go L137/L140：>=minBones 保留、<=maxBones 保留）", async () => {
    await seedTwo();
    const minHit = (await browserAdapter.SearchModels("/web/ysm", "", 5, 0, 0, 0, 0, 0)) as Array<{ name: string }>;
    expect(minHit.map((r) => r.name)).toEqual(["狐狸.ysm"]); // 10>=5 保留；2<5 排除
    const maxHit = (await browserAdapter.SearchModels("/web/ysm", "", 0, 5, 0, 0, 0, 0)) as Array<{ name: string }>;
    expect(maxHit.map((r) => r.name)).toEqual(["狼.ysm"]); // 2<=5 保留；10>5 排除
    // 等值边界（Go 用 < / > 严格比较，等值不过滤）：boneCount 恰为边界值应保留
    const eqMin = (await browserAdapter.SearchModels("/web/ysm", "", 10, 0, 0, 0, 0, 0)) as Array<{ name: string }>;
    expect(eqMin.map((r) => r.name)).toEqual(["狐狸.ysm"]); // 10==minBones 保留（10<10 false）
    const eqMax = (await browserAdapter.SearchModels("/web/ysm", "", 0, 2, 0, 0, 0, 0)) as Array<{ name: string }>;
    expect(eqMax.map((r) => r.name)).toEqual(["狼.ysm"]); // 2==maxBones 保留（2>2 false）
  });

  it("minCubes/maxCubes 边界（Go L143/L146）", async () => {
    await seedTwo();
    const minHit = (await browserAdapter.SearchModels("/web/ysm", "", 0, 0, 4, 0, 0, 0)) as Array<{ name: string }>;
    expect(minHit.map((r) => r.name)).toEqual(["狐狸.ysm"]); // 5>=4 保留；3<4 排除
    const maxHit = (await browserAdapter.SearchModels("/web/ysm", "", 0, 0, 0, 4, 0, 0)) as Array<{ name: string }>;
    expect(maxHit.map((r) => r.name)).toEqual(["狼.ysm"]); // 3<=4 保留；5>4 排除
  });

  it("minTex 任一维度低于下限即排除（Go L149：TexWidth<minTex || TexHeight<minTex）", async () => {
    await seedTwo();
    // minTex=32：狐狸宽高均 64>=32 保留；狼宽高均 16<32 排除
    const hit = (await browserAdapter.SearchModels("/web/ysm", "", 0, 0, 0, 0, 32, 0)) as Array<{ name: string }>;
    expect(hit.map((r) => r.name)).toEqual(["狐狸.ysm"]);
    // minTex=16：等值边界（16==16 不触发 < 排除）→ 两只都保留
    const eq = (await browserAdapter.SearchModels("/web/ysm", "", 0, 0, 0, 0, 16, 0)) as Array<{ name: string }>;
    expect(eq).toHaveLength(2);
  });

  it("maxTex 任一维度超上限即排除（Go L152：TexWidth>maxTex || TexHeight>maxTex）", async () => {
    await seedTwo();
    const hit = (await browserAdapter.SearchModels("/web/ysm", "", 0, 0, 0, 0, 0, 32)) as Array<{ name: string }>;
    expect(hit.map((r) => r.name)).toEqual(["狼.ysm"]); // 16<=32 保留；64>32 排除
  });

  it("stats.hasError=true（Go BoneCount==0 等价）在数值条件下恒排除（Go L134）", async () => {
    await importOne("坏.ysm");
    __setStatsRunnerForTest(async (paths: string[]) =>
      paths.map((p) => ({
        boneCount: 0,
        cubeCount: 0,
        texWidth: 0,
        texHeight: 0,
        hasError: p.includes("坏"),
      })),
    );
    // 无数值条件 → kw 快路径（B1c 契约：hasError:false 降级行命中，不受影响）
    const kw = (await browserAdapter.SearchModels("/web/ysm", "坏", 0, 0, 0, 0, 0, 0)) as Array<{ name: string }>;
    expect(kw.map((r) => r.name)).toEqual(["坏.ysm"]);
    // 有数值条件（minBones=1）→ hasError=true 条目被排除（对齐 Go BoneCount==0 排除）
    const num = (await browserAdapter.SearchModels("/web/ysm", "坏", 1, 0, 0, 0, 0, 0)) as Array<{ name: string }>;
    expect(num).toEqual([]);
  });

  it("六参数全 0（无数值条件）→ 不按 stats 过滤：快路径返回全量关键词命中（Go `>0` 守卫）", async () => {
    await seedTwo();
    const all = (await browserAdapter.SearchModels("/web/ysm", "", 0, 0, 0, 0, 0, 0)) as Array<{ name: string }>;
    expect(all.map((r) => r.name).sort()).toEqual(["狐狸.ysm", "狼.ysm"]);
  });

  it("关键词 + 数值过滤组合（Go 先关键词预过滤再数值过滤）", async () => {
    await seedTwo();
    // kw="狐" 预过滤 → 仅狐狸候选；minBones=5 → 狐狸 10>=5 保留
    const combo = (await browserAdapter.SearchModels("/web/ysm", "狐", 5, 0, 0, 0, 0, 0)) as Array<{ name: string }>;
    expect(combo.map((r) => r.name)).toEqual(["狐狸.ysm"]);
    // 关键词命中但数值不满足 → 空（不是返回关键词结果）
    const miss = (await browserAdapter.SearchModels("/web/ysm", "狐", 0, 3, 0, 0, 0, 0)) as Array<{ name: string }>;
    expect(miss).toEqual([]); // 狐狸 10>maxBones=3 排除
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

// ===== 契约 B1e — MoveModelFile/CopyModelFile/RenameDir/RenameFile 对齐 Go fileops.go =====
// Go 契约（go/fileops/fileops.go）：
//   [L184] MoveModelFile(root, src, dstDir)：移动 src 到 dstDir，保留原名 → dst=Join(dstDir, Base(src))
//   [L222-249] ysm.json 提升为整组移动（web 无「游离文件」，组内任意文件路径均整组 rekey——ADR-071 #7 适配）
//   [L259] 目标已存在 → error「目标已存在」（防 os.Rename 静默覆盖）
//   [L310-320] prepareModelDest：自嵌套检查先于 MkdirAll（dstDir 位于 src 子树内拒绝）
//   [L324] CopyModelFile：同语义但保留源
// web 适配差异（web-fs.ts moveOrCopyWebModel 注释声明）：
//   - 模型库以「模型组」为最小单位（无桌面「游离文件」），src 为组内文件/组目录均整组移动/复制
//   - 多段组名只保留末段作为目标模型名（dst=Join(dstDir, Base(src))，如 分类1/狐狸 → 作者A/狐狸）
//   - 校验顺序对齐 Go：自嵌套先于目标已存在；源缺失/非法 dstDir 拒绝
// RenameDir/RenameFile（fileops.go RenameDir/RenameFile + web 适配）：
//   - 重命名只替换末段，保留父路径；目标已存在拒绝（防静默覆盖合并）
//   - ysm.json 是模型目录清单，禁止单文件改名（否则主文件 rank 掉 0 → 模型从列表消失）
describe("契约 B1e — Move/Copy/Rename 组级 rekey 对齐 Go fileops.go", () => {
  // 直灌真实模型组结构（对照 importWebFiles 落库形状：dir key 元数据 + file key 组内文件，
  // 组内 rel 不含组名前缀）。多段组名（分类1/狐狸）经 idbMock 直写 dirKey/fileKey 构造，
  // 避免 File 名含 "/" 时 importWebFiles 的 rel 保留整名导致的形状偏差。
  const seedRealGroup = async (
    type: string,
    name: string,
    rels: string[],
    addedAt = 1700000000000,
  ): Promise<void> => {
    idbMock._store.set(dirKey(type, name), { name, addedAt });
    for (const rel of rels) {
      const bytes = new TextEncoder().encode(rel);
      idbMock._store.set(fileKey(type, name, rel), {
        data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        size: bytes.length,
      });
    }
  };

  it("MoveModelFile：整组迁移 + 标记随迁，源组消失，目标名取 src 组名末段（Go dst=Join(dstDir,Base(src))）", async () => {
    await seedRealGroup("ysm", "分类1/狐狸", ["狐狸.ysm"]);
    const srcPath = "/web/ysm/分类1/狐狸/狐狸.ysm";
    await browserAdapter.SetModelTags(srcPath, ["联动"]);
    // src 传组内文件路径 → web 整组移动（无游离文件，ADR-071 #7 适配）
    await browserAdapter.MoveModelFile(srcPath, "/web/ysm/作者A");
    // 目标组：作者A/狐狸（分类1 父路径丢弃，对齐 Go Base(src)）
    const moved = (await browserAdapter.ScanModelEntries("/web/ysm/作者A/狐狸")) as Array<{ Path: string }>;
    expect(moved.map((m) => m.Path)).toEqual(["/web/ysm/作者A/狐狸/狐狸.ysm"]);
    // 源组消失
    expect((await browserAdapter.ScanModelEntries("/web/ysm/分类1")) as unknown[]).toHaveLength(0);
    // 标记随迁：tags 应绑定到新路径（web 侧 rekey 移动标记，对齐 Go .ban 文件随目录走）
    const tagsAtNew = (await browserAdapter.GetModelTags("/web/ysm/作者A/狐狸/狐狸.ysm")) as string[];
    expect(tagsAtNew).toEqual(["联动"]);
  });

  it("MoveModelFile：组内多个文件 + 子目录 rel 整组迁移", async () => {
    await seedRealGroup("ysm", "狐狸", ["狐狸.ysm", "tex/face.png"]);
    await browserAdapter.MoveModelFile("/web/ysm/狐狸/狐狸.ysm", "/web/ysm/作者B");
    // ListAllFilePaths 递归列组内全部文件（ScanModelEntries 只收敛主文件，tex/face.png 是辅助文件看不到）
    const moved = (await browserAdapter.ListAllFilePaths("/web/ysm/作者B/狐狸")) as string[];
    // .sort() 默认按 UTF-16 码位：ASCII('tex') < 中文('狐') → tex/face.png 排前
    expect(moved.sort()).toEqual([
      "/web/ysm/作者B/狐狸/tex/face.png",
      "/web/ysm/作者B/狐狸/狐狸.ysm",
    ]);
    // 源组全部文件消失（无残留：dir key + 全部 file key 均随迁）
    expect((await browserAdapter.ListAllFilePaths("/web/ysm/狐狸")) as string[]).toEqual([]);
  });

  it("CopyModelFile：目标组出现且源组保留（Go CopyModelFile 保留源语义）", async () => {
    await seedRealGroup("ysm", "狐狸", ["狐狸.ysm"]);
    await browserAdapter.CopyModelFile("/web/ysm/狐狸/狐狸.ysm", "/web/ysm/备份");
    const copy = (await browserAdapter.ScanModelEntries("/web/ysm/备份/狐狸")) as Array<{ Path: string }>;
    expect(copy.map((c) => c.Path)).toEqual(["/web/ysm/备份/狐狸/狐狸.ysm"]);
    // 源组保留（Go CopyModelFile 只写不删源）
    const src = (await browserAdapter.ScanModelEntries("/web/ysm/狐狸")) as Array<{ Path: string }>;
    expect(src.map((s) => s.Path)).toEqual(["/web/ysm/狐狸/狐狸.ysm"]);
  });

  it("目标已存在 → reject（Go L259 防静默覆盖）", async () => {
    await seedRealGroup("ysm", "狐狸", ["狐狸.ysm"]);
    await seedRealGroup("ysm", "备份/狐狸", ["狐狸.ysm"]); // 目标组 备份/狐狸 已存在
    await expect(
      browserAdapter.MoveModelFile("/web/ysm/狐狸/狐狸.ysm", "/web/ysm/备份"),
    ).rejects.toThrow();
  });

  it("自嵌套（dstDir 位于 src 子树内）→ reject（Go prepareModelDest 先于 MkdirAll）", async () => {
    await seedRealGroup("ysm", "狐狸", ["狐狸.ysm"]);
    await expect(
      browserAdapter.MoveModelFile("/web/ysm/狐狸/狐狸.ysm", "/web/ysm/狐狸/sub"),
    ).rejects.toThrow();
  });

  it("源缺失 / 非法 src / 非法 dstDir → reject（Go os.Stat 源报错 + 仓库边界校验）", async () => {
    await expect(browserAdapter.MoveModelFile("/web/ysm/不存在/main.ysm", "/web/ysm/作者A")).rejects.toThrow();
    await expect(browserAdapter.MoveModelFile("/notweb/x", "/web/ysm/作者A")).rejects.toThrow();
    await expect(browserAdapter.MoveModelFile("/web/ysm/狐狸/狐狸.ysm", "/notweb/dst")).rejects.toThrow();
  });

  it("RenameDir：整组 rekey，多段名只替换末段（分类1/狐狸 → 分类1/大猫），源消失", async () => {
    await seedRealGroup("ysm", "分类1/狐狸", ["狐狸.ysm"]);
    await browserAdapter.RenameDir("/web/ysm/分类1/狐狸", "大猫");
    const renamed = (await browserAdapter.ScanModelEntries("/web/ysm/分类1/大猫")) as Array<{ Path: string }>;
    expect(renamed.map((r) => r.Path)).toEqual(["/web/ysm/分类1/大猫/狐狸.ysm"]);
    expect((await browserAdapter.ScanModelEntries("/web/ysm/分类1/狐狸")) as unknown[]).toHaveLength(0);
  });

  it("RenameDir：目标已存在拒绝（防静默覆盖合并两模型）", async () => {
    await seedRealGroup("ysm", "分类1/狐狸", ["狐狸.ysm"]);
    await seedRealGroup("ysm", "分类1/大猫", ["大猫.ysm"]);
    await expect(browserAdapter.RenameDir("/web/ysm/分类1/狐狸", "大猫")).rejects.toThrow();
  });

  it("RenameFile：单文件 rekey；ysm.json 禁改（模型目录清单，改了主文件 rank 掉 0）", async () => {
    await seedRealGroup("ysm", "组A", ["模型.ysm"]);
    await browserAdapter.RenameFile("/web/ysm/组A/模型.ysm", "模型2.ysm");
    const renamed = (await browserAdapter.ScanModelEntries("/web/ysm/组A")) as Array<{ Path: string }>;
    expect(renamed.map((r) => r.Path)).toEqual(["/web/ysm/组A/模型2.ysm"]);
    // ysm.json 禁改：补 ysm.json 文件，RenameFile 应拒绝（对齐 Go RenameFile ADR-038 D3）
    idbMock._store.set(fileKey("ysm", "组A", "ysm.json"), {
      data: new ArrayBuffer(4),
      size: 4,
    });
    await expect(browserAdapter.RenameFile("/web/ysm/组A/ysm.json", "list.json")).rejects.toThrow();
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
