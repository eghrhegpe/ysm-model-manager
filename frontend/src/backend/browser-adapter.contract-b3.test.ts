// @vitest-environment node
// ===== B3 契约测试（反推源码问题）：对标 Go 侧真实契约 =====
// 目标簇：ListModelAuthors / ScanLocalAuthors / GenerateRepoIndex
// 不改动任何源码，仅新增本文件。harness 复刻 browser-adapter.test.ts
// （vi.hoisted 的 idbMock + vi.mock("./idb.ts")）。
// 共享 idb mock：setup 层 globalThis.__YSM_TEST_IDB__ 注入（isolate:false 穿透修复，2026-08-17）
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
const idbMock = (globalThis as unknown as {
  __YSM_TEST_IDB__: {
    idbGet: Mock;
    idbSet: Mock;
    idbKeys: Mock;
    idbGetAll: Mock;
    idbDel: Mock;
    _store: Map<string, unknown>;
  };
}).__YSM_TEST_IDB__;
import { browserAdapter, importWebFiles } from "./browser-adapter.ts";

// idb 层内存实现（与既有测试同形）

const enc = new TextEncoder();

beforeEach(() => {
  vi.clearAllMocks();
  idbMock._store.clear();
  localStorage.clear();
});

/** 把模型名注入 IDB（type 默认 ysm） */
async function putModel(name: string, type = "ysm"): Promise<void> {
  await importWebFiles([new File([enc.encode("X")], name)], type);
}

// ===========================================================================
// 契约 1：ListModelAuthors —— 对齐 go/scanner/scanner.go:265（Go 注释「按出现次数降序」）
// Go 规则：去 .ban → 以 "[" 开头 → 取 "]" 之前为作者 → 计数降序；SampleFile=首个模型 Path
// Go AuthorInfo json tag：Name / Count / SampleFile（types.go:14-18，全大写）
// ===========================================================================
describe("B3 契约 — ListModelAuthors（对齐 go/scanner/scanner.go:265）", () => {
  it("文件名含 [作者] 前缀 → 正确提取作者，并按计数降序", async () => {
    await putModel("[张三]模型A.ysm");
    await putModel("[张三]模型B.ysm");
    await putModel("[李四]角色.ysm");
    const authors = (await browserAdapter.ListModelAuthors()) as Array<{
      Name: string;
      Count: number;
      SampleFile: string;
    }>;
    expect(authors).toHaveLength(2);
    expect(authors[0].Name).toBe("张三");
    expect(authors[0].Count).toBe(2);
    expect(authors[1].Name).toBe("李四");
    expect(authors[1].Count).toBe(1);
  });

  it("同作者跨多个模型 → Count 累加、SampleFile 取扫描首条目（按 Name 排序后）完整 Path", async () => {
    await putModel("[张三]甲.ysm");
    await putModel("[张三]乙.ysm");
    await putModel("[张三]丙.ysm");
    const authors = (await browserAdapter.ListModelAuthors()) as Array<{
      Name: string;
      Count: number;
      SampleFile: string;
    }>;
    expect(authors).toHaveLength(1);
    expect(authors[0].Name).toBe("张三");
    expect(authors[0].Count).toBe(3);
    // Go SampleFile 取首个模型完整 Path（含 [作者] 前缀文件名，与 web 同语义）；
    // web 先按 Name 排序再取首条，故断言其为三者之一的有效 /web 路径（不锁定具体模型）。
    expect(authors[0].SampleFile).toMatch(/^\/web\/ysm\/\[张三\](甲|乙|丙)\/\[张三\](甲|乙|丙)\.ysm$/);
  });

  it("无 [作者] 前缀的模型名 → 不计入作者（仅统计括号作者）", async () => {
    await putModel("普通模型.ysm");
    await putModel("无括号角色.ysm");
    expect((await browserAdapter.ListModelAuthors()) as unknown[]).toEqual([]);
  });

  // 网页局限（非 B3 提取器 bug）：Go 把 xxx.ysm.ban 当作被封禁模型计入作者，
  // 但网页 importWebFiles 仅接受 .ysm/ysm.json 作主文件，.ysm.ban 在导入层即被拒，
  // 故经由模型库路径 .ban 不可达。注意：extractBracketAuthor（browser-adapter.ts:591-594）
  // 的 .ban 分支函数级仍存活（保留作防御/潜在复用），但网页导入层过滤使其在该路径不可达。
  it("【网页局限】.ban 后缀模型在导入层被过滤，ListModelAuthors 的 .ban 分支在网页模型库路径不可达", async () => {
    const r = await importWebFiles([new File([enc.encode("X")], "[张三].ysm.ban")], "ysm");
    expect(r).toEqual({ imported: 0, failed: 1 });
    expect((await browserAdapter.ListModelAuthors()) as unknown[]).toEqual([]);
  });

  it("空库 → 返回 []（非 null、不抛错）", async () => {
    const r = await browserAdapter.ListModelAuthors();
    expect(Array.isArray(r)).toBe(true);
    expect(r).toEqual([]);
  });
});

// ===========================================================================
// 契约 2：ScanLocalAuthors —— 对齐 go/scanner/scanner.go:297
// Go WorkshopCreator json tag：name / desc / type（config.go:58-62，全小写）
// Go 类型合并规则：existing.Type 不含 rtype 时 `Type += ";" + rtype`（分隔符 ;）
// ===========================================================================
describe("B3 契约 — ScanLocalAuthors（对齐 go/scanner/scanner.go:297）", () => {
  it("提取 [作者] 并带 type 标签（desc=来自本地仓库，字段名小写对齐 Go WorkshopCreator）", async () => {
    await putModel("[王五]角色.ysm");
    const creators = (await browserAdapter.ScanLocalAuthors("")) as Array<{
      name: string;
      type: string;
      desc: string;
    }>;
    expect(creators).toHaveLength(1);
    expect(creators[0].name).toBe("王五");
    expect(creators[0].type).toBe("ysm");
    expect(creators[0].desc).toBe("来自本地仓库");
  });

  it("同作者跨不同类型 → Type 用 ; 合并（与 Go `;` 分隔符一致）", async () => {
    await putModel("[王五]A.ysm", "ysm");
    await putModel("[王五]B.ysm", "litematic");
    const creators = (await browserAdapter.ScanLocalAuthors("")) as Array<{
      name: string;
      type: string;
    }>;
    expect(creators).toHaveLength(1);
    expect(creators[0].name).toBe("王五");
    // Go：Type += ";" + rtype —— 断言拼接符为 ;（不偏移到 , / | 等）
    expect(creators[0].type).toBe("ysm;litematic");
  });

  it("空库 → 返回 []（非 null、不抛错）", async () => {
    const r = await browserAdapter.ScanLocalAuthors("");
    expect(Array.isArray(r)).toBe(true);
    expect(r).toEqual([]);
  });
});

// ===========================================================================
// 契约 3：GenerateRepoIndex —— 对齐 go/scanner/scanner.go:356
// Go 产出 indexEntry struct 的 json tag（scanner.go:359-364）：
//   Name string `json:"name"`
//   Path string `json:"path"`
//   Size int64  `json:"size"`
//   Hash string `json:"hash,omitempty"`   // 空 hash 时省略该键
// 即 index.json 必须为【小写键】，且空 hash 不出现 hash 键。
// 供 GitHub Actions / Linux 消费（scanner.go:355 注释），下游按小写键解析。
// ===========================================================================
describe("B3 契约 — GenerateRepoIndex（对齐 go/scanner/scanner.go:356 indexEntry 小写 json tag）", () => {
  it("/web 开头 repoPath → 路径相对 repoPath，正斜杠", async () => {
    await putModel("赵六.ysm");
    const idx = (await browserAdapter.GenerateRepoIndex("/web/ysm")) as string;
    const parsed = JSON.parse(idx) as Array<{ path?: string; Path?: string }>;
    expect(parsed).toHaveLength(1);
    // 期望相对 /web/ysm 得 "赵六/赵六.ysm"（与 Go filepath.Rel 同口径）
    expect(parsed[0].path ?? parsed[0].Path).toBe("赵六/赵六.ysm");
  });

  it("非 /web 开头 repoPath → 全库分支，路径相对 WEB_ROOT=/web", async () => {
    await putModel("赵六.ysm");
    const idx = (await browserAdapter.GenerateRepoIndex("not-a-web-root")) as string;
    const parsed = JSON.parse(idx) as Array<{ path?: string; Path?: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].path ?? parsed[0].Path).toBe("ysm/赵六/赵六.ysm");
  });

  it("空库 → 返回 [] JSON（不抛错）", async () => {
    const idx = (await browserAdapter.GenerateRepoIndex("/web/ysm")) as string;
    expect(JSON.parse(idx)).toEqual([]);
  });

  // —— 以下为对齐 Go indexEntry json tag 的核心契约守门断言（web 已对齐小写键）——
  it("【契约】index.json 键为小写 name/path/size（对齐 Go indexEntry json tag）", async () => {
    await putModel("赵六.ysm");
    const idx = (await browserAdapter.GenerateRepoIndex("/web/ysm")) as string;
    const parsed = JSON.parse(idx) as Array<Record<string, unknown>>;
    // 网页版 hash 恒空（scanWebModels 不计算），故 Go 会因 omitempty 省略 hash 键，
    // 仅剩 name/path/size 三键。断言小写键存在（browser-adapter.ts GenerateRepoIndex 已用小写键）。
    expect(Object.keys(parsed[0])).toEqual(expect.arrayContaining(["name", "path", "size"]));
    // 契约守门：不得出现大写键（Go indexEntry json tag 为小写）
    expect(parsed[0]).not.toHaveProperty("Name");
    expect(parsed[0]).not.toHaveProperty("Path");
    expect(parsed[0]).not.toHaveProperty("Size");
  });

  it("【契约】空 hash 时 index.json 省略 hash 键（对齐 Go `json:\"hash,omitempty\"`）", async () => {
    await putModel("赵六.ysm");
    const idx = (await browserAdapter.GenerateRepoIndex("/web/ysm")) as string;
    const parsed = JSON.parse(idx) as Array<Record<string, unknown>>;
    // Go：hash 为空 → omitempty 省略；网页版不应携带 "Hash":"" / "hash":""
    expect(parsed[0]).not.toHaveProperty("Hash");
    expect(parsed[0]).not.toHaveProperty("hash");
  });
});
