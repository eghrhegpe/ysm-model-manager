// @vitest-environment node
// ===== 浏览器后端适配器测试（ADR-049 Phase 1 骨架 + Phase 2 IndexedDB 模型库）=====
// 共享 idb mock：setup 层 globalThis.__YSM_TEST_IDB__ 注入（isolate:false 穿透修复，2026-08-17）
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
const idbMock = (globalThis as unknown as {
  __YSM_TEST_IDB__: {
    idbGet: Mock;
    idbSet: Mock;
    idbKeys: Mock;
    idbDel: Mock;
    _store: Map<string, unknown>;
  };
}).__YSM_TEST_IDB__;
import { zipSync, strToU8 } from "fflate";
import {
  browserAdapter,
  WebUnsupportedError,
  importWebFiles,
  selectLocalRepo,
  WEB_ROOT,
  arrayBufferToBase64,
  getFsaAuthState,
  rescanFsaRoot,
  reauthorizeFsaRoot,
} from "./browser-adapter.ts";

// idb 层内存实现（真实 indexedDB 仅在浏览器存在，测试注入 Map 语义）
// 2026-08-17：改用 test-utils/idb-mock.ts 共享实例——isolate:false 共享模块图下
// 各文件独立 vi.hoisted store 会被穿透（web-fs.ts 首次求值捕获先运行文件绑定），
// setup 层已全局注入，此处仅 import 共享实例（同引用，import 须在文件首位）。

const enc = new TextEncoder();

beforeEach(() => {
  vi.clearAllMocks();
  idbMock._store.clear();
  localStorage.clear();
  // node 环境无 window——FSA 授权簇（showDirectoryPicker）与 web-fs.ts:144 检测读 window
  vi.stubGlobal("window", {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browserAdapter — 虚拟根与仓库路径", () => {
  it("GetDefaultRepoRoot → /web；GetRepoRoot(type) → /web/<type>", async () => {
    expect(await browserAdapter.GetDefaultRepoRoot()).toBe(WEB_ROOT);
    expect(await browserAdapter.GetRepoRoot("ysm")).toBe("/web/ysm");
  });
});

describe("browserAdapter — Phase 2 模型库（IndexedDB）", () => {
  it("空库 ScanModelEntries → []", async () => {
    expect(await browserAdapter.ScanModelEntries("/web/ysm")).toEqual([]);
  });

  it("非 YSM 类型主文件可识别（ADR-066 识别层：.nbt 蓝图 / .litematic 投影 / .pmx MMD）", async () => {
    await importWebFiles([new File([enc.encode("NBT")], "建筑.nbt")], "blueprint");
    await importWebFiles([new File([enc.encode("LTM")], "投影.litematic")], "litematic");
    await importWebFiles([new File([enc.encode("PMX")], "角色.pmx")], "EntityPlayer");
    // 各类型目录都能扫到主文件条目（原实现只认 .ysm/.zip/ysm.json，非 YSM 全不显示）
    const bp = (await browserAdapter.ScanModelEntries("/web/blueprint")) as Array<{ Name: string }>;
    expect(bp.map((e) => e.Name)).toContain("建筑.nbt");
    const lt = (await browserAdapter.ScanModelEntries("/web/litematic")) as Array<{ Name: string }>;
    expect(lt.map((e) => e.Name)).toContain("投影.litematic");
    const mmd = (await browserAdapter.ScanModelEntries("/web/EntityPlayer")) as Array<{ Name: string }>;
    expect(mmd.map((e) => e.Name)).toContain("角色.pmx");
    // .ban 禁用模型导入层仍拒绝（不剥后缀当主文件）
    const r = await importWebFiles([new File([enc.encode("X")], "禁用.ysm.ban")], "ysm");
    expect(r).toEqual({ imported: 0, failed: 1 });
  });

  it("导入后 ScanModelEntries 返回条目（Name 含扩展名 / Path / Size 与 IDB 一致）", async () => {
    await importWebFiles([new File([enc.encode("YSM")], "狐狸.ysm", { type: "application/octet-stream" })], "ysm");
    const entries = (await browserAdapter.ScanModelEntries("/web/ysm")) as Array<{
      Name: string;
      Path: string;
      Size: number;
      Ext: string;
    }>;
    expect(entries).toHaveLength(1);
    // Name 必须含扩展名，对齐桌面 filepath.Base(p)，否则 loader.ts 的 endsWith(ext) 过滤会丢条目
    expect(entries[0].Name).toBe("狐狸.ysm");
    expect(entries[0].Ext).toBe(".ysm");
    expect(entries[0].Path).toBe("/web/ysm/狐狸/狐狸.ysm");
    expect(entries[0].Size).toBe(3); // "YSM" = 3 bytes
  });

  it("DetectResourceType：扩展名直判（单归属）+ 已导入模型判定（ADR-066 web 识别层）", async () => {
    // .nbt 单归属 blueprint（flat 架构：blueprint 独立顶级类型）
    expect(await browserAdapter.DetectResourceType("/web/blueprint/建筑/建筑.nbt")).toBe("blueprint");
    expect(await browserAdapter.DetectResourceType("/web/litematic/投影/a.litematic")).toBe("litematic");
    expect(await browserAdapter.DetectResourceType("/web/3d-skin/EntityPlayer/角色/a.pmx")).toBe("EntityPlayer");
    expect(await browserAdapter.DetectResourceType("/web/3d-skin/EntityPlayer/角色/a.vrm")).toBe("EntityPlayer"); // ADR-111: .vrm 是 EntityPlayer 的 variant
    expect(await browserAdapter.DetectResourceType("/web/ysm/模型/a.ysm")).toBe("ysm");
    expect(await browserAdapter.DetectResourceType("/web/ysm/模型/a.png")).toBe(""); // 辅助文件无类型
  });

  it("CachedCreatorAvatar 读 localStorage 头像缓存（ADR-066 缺口 #8：批量提取落缓存，避免重提）", async () => {
    localStorage.setItem("web:avatar:测试作者", "data:image/png;base64,AAA");
    expect(await browserAdapter.CachedCreatorAvatar("测试作者")).toBe("data:image/png;base64,AAA");
    expect(await browserAdapter.CachedCreatorAvatar("不存在作者")).toBe("");
    localStorage.removeItem("web:avatar:测试作者");
  });

  it("ScanModelEntriesWithLabel 同 ScanModelEntries（真实列表入口）", async () => {
    await importWebFiles([new File([enc.encode("YSM")], "狐狸.ysm")], "ysm");
    const entries = (await browserAdapter.ScanModelEntriesWithLabel("/web/ysm", "模型")) as Array<{
      Name: string;
    }>;
    expect(entries).toHaveLength(1);
    expect(entries[0].Name).toBe("狐狸.ysm");
  });

  it("ReadFileBytes 读回 base64（wasm.ts 解码链零改动复用）", async () => {
    await importWebFiles([new File([enc.encode("YSM")], "狐狸.ysm")], "ysm");
    const b64 = await browserAdapter.ReadFileBytes("/web/ysm/狐狸/狐狸.ysm");
    expect(b64).toBe(btoa("YSM"));
  });

  it("ReadFileBytes：不存在/非 /web/ 路径 → null（不抛错）", async () => {
    expect(await browserAdapter.ReadFileBytes("/web/ysm/不存在/a.ysm")).toBeNull();
    expect(await browserAdapter.ReadFileBytes("/repo/ysm/a.ysm")).toBeNull();
  });
});

describe("browserAdapter — Phase 2 配置（localStorage）", () => {
  it("SaveAppConfig → LoadAppConfig 往返（字段名对齐 AppConfig.resourcepackRoot）", async () => {
    await browserAdapter.SaveAppConfig("/web", "/web", "", "copy", "dark");
    const cfg = (await browserAdapter.LoadAppConfig()) as unknown as Record<string, string>;
    expect(cfg.filesRoot).toBe("/web");
    // rpRoot 必须落到 resourcepackRoot，否则 community.ts 读回恒 undefined 并永久丢失资源包根
    expect(cfg.resourcepackRoot).toBe("/web");
    expect(cfg.linkMode).toBe("copy");
    expect(cfg.theme).toBe("dark");
  });

  it("SaveAppConfig 空串保留旧值（对齐桌面 orDefault 语义，避免整体覆盖丢失其他配置）", async () => {
    await browserAdapter.SaveAppConfig("/web", "/rp", "", "copy", "dark");
    // 第二次以空串传 rpRoot —— 应保持上一次的 "/rp" 而非清空
    await browserAdapter.SaveAppConfig("/web2", "", "", "move", "light");
    const cfg = (await browserAdapter.LoadAppConfig()) as unknown as Record<string, string>;
    expect(cfg.resourcepackRoot).toBe("/rp");
    expect(cfg.filesRoot).toBe("/web2");
    expect(cfg.linkMode).toBe("move");
  });

  it("无配置 LoadAppConfig → {}（主应用可启动）", async () => {
    expect(await browserAdapter.LoadAppConfig()).toEqual({});
  });
});

describe("browserAdapter — Phase 2 3D 兜底守卫（ADR-049 P2-2 路径可达）", () => {
  it("GetModel3DSpec 网页版恒空（让 model3d-loader WASM 兜底守卫可达，而非 WebUnsupportedError 逃逸）", async () => {
    expect(await browserAdapter.GetModel3DSpec("/web/ysm/狐狸/狐狸.ysm")).toBe("{}");
  });
});

describe("browserAdapter — fail-fast（Phase 3 能力门控隐藏对应 UI）", () => {
  it("未实现 binding → reject WebUnsupportedError（明确报错，非 undefined 穿透）", async () => {
    await expect(browserAdapter.ImportModelFile("a", "b") as never).rejects.toBeInstanceOf(
      WebUnsupportedError,
    );
    await expect(
      (browserAdapter as unknown as { DownloadFile: () => Promise<unknown> }).DownloadFile(),
    ).rejects.toThrow("浏览器端未实现");
  });

  it("错误信息带 binding 名（可定位 Phase 3 待隐藏项）", async () => {
    await expect(browserAdapter.ImportModelFile("a", "b") as never).rejects.toThrow(
      "ImportModelFile",
    );
  });

  // ADR-123 P2：ExecuteCLI 不在 webCliBindings——`'ExecuteCLI' in browserAdapter`
  // 必须 false，让 can() 门控（capabilities.ts）在 web 隐藏 CLI 入口；
  // 此前假实现返回空 success/恒 not_supported 响应但门控恒 true，UI 可见却不可用
  it("ExecuteCLI 已移出 webImpls：has 探测 false + 直调 fail-fast", () => {
    expect("ExecuteCLI" in browserAdapter).toBe(false);
    expect(
      (browserAdapter as unknown as { ExecuteCLI: () => Promise<unknown> }).ExecuteCLI(),
    ).rejects.toThrow("ExecuteCLI");
  });
});

describe("importWebFiles — Phase 2 数据层", () => {
  it("成功导入返回 {imported: n, failed: 0}，且 dir/file 双记录落库", async () => {
    const r = await importWebFiles(
      [
        new File([enc.encode("A")], "模型A.ysm"),
        new File([enc.encode("B")], "模型B.ysm"),
      ],
      "ysm",
    );
    expect(r).toEqual({ imported: 2, failed: 0 });
    expect(idbMock.idbSet).toHaveBeenCalledWith("files", "dir:ysm/模型A:", expect.anything());
    expect(idbMock.idbSet).toHaveBeenCalledWith("files", "file:ysm/模型A/模型A.ysm", expect.anything());
  });

  it("空文件名（如 .ysm 隐藏文件）→ failed 计数", async () => {
    const r = await importWebFiles([new File([enc.encode("X")], ".ysm")], "ysm");
    expect(r).toEqual({ imported: 0, failed: 1 });
  });

  it("非支持扩展名（.txt/.png）与任意 .json → failed（复用 dnd-shared 白名单，防杂物入库）", async () => {
    const r = await importWebFiles(
      [
        new File([enc.encode("x")], "说明.txt"),
        new File([enc.encode("x")], "avatar.png"),
        new File([enc.encode("{}")], "动作.json"),
      ],
      "ysm",
    );
    expect(r).toEqual({ imported: 0, failed: 3 });
    expect(idbMock.idbSet).not.toHaveBeenCalled();
  });

  it("M1：.zip 入库；.7z 网页版跳过并提示（暂不支持解压，不入库）", async () => {
    const r = await importWebFiles(
      [new File([enc.encode("z")], "模型.zip"), new File([enc.encode("z")], "模型.7z")],
      "ysm",
    );
    // .zip 主文件落库；.7z 被 M1 过滤（网页版无法解压），不入库
    expect(r).toEqual({ imported: 1, failed: 0 });
    expect(idbMock._store.has("dir:ysm/模型:")).toBe(true);
    expect(idbMock._store.has("file:ysm/模型/模型.zip")).toBe(true);
    expect(idbMock._store.has("file:ysm/模型/模型.7z")).toBe(false);
  });

  it("多文件模型按 stem 分组：同组非主文件并入同一 dir（消灭每文件独立成模型）", async () => {
    const f1 = new File([enc.encode("Y")], "狐狸.ysm");
    const f2 = new File([enc.encode("{}")], "main.json");
    // 文件夹拖入扁平化：webkitRelativePath 同首段 → 同模型
    Object.defineProperty(f1, "webkitRelativePath", { value: "狐狸/狐狸.ysm" });
    Object.defineProperty(f2, "webkitRelativePath", { value: "狐狸/main.json" });
    const r = await importWebFiles([f1, f2], "ysm");
    expect(r).toEqual({ imported: 1, failed: 0 });
    // 组内非主文件（main.json）也落库（供 preview 读纹理/清单），但只建一个 dir 条目
    expect(idbMock.idbSet).toHaveBeenCalledWith("files", "dir:ysm/狐狸:", expect.anything());
    expect(idbMock.idbSet).toHaveBeenCalledWith("files", "file:ysm/狐狸/main.json", expect.anything());
    const entries = (await browserAdapter.ScanModelEntries("/web/ysm")) as Array<{ Name: string; Ext: string }>;
    expect(entries).toHaveLength(1);
    // 主文件优先选 .ysm，而非 main.json
    expect(entries[0].Name).toBe("狐狸.ysm");
  });

  it("组内无主文件（.ysm/ysm.json）→ 整组丢弃", async () => {
    const f = new File([enc.encode("{}")], "main.json");
    Object.defineProperty(f, "webkitRelativePath", { value: "杂项/main.json" });
    const r = await importWebFiles([f], "ysm");
    expect(r).toEqual({ imported: 0, failed: 1 });
  });

  it("超过 100MB → failed（对齐 import-dnd oversize 过滤）", async () => {
    const big = new File([new Uint8Array(100 * 1024 * 1024 + 1)], "超大.ysm");
    const r = await importWebFiles([big], "ysm");
    expect(r).toEqual({ imported: 0, failed: 1 });
  });

  it("R2 导入增强：.zip 解压展平成目录模型组（含子目录 rel）", async () => {
    // fflate zipSync 构造标准 zip：内含 ysm.json + models/ + textures/（带子目录）
    const zipBytes = zipSync({
      "狐狸/狐狸.ysm": strToU8("YSM"),
      "狐狸/ysm.json": strToU8("{}"),
      "狐狸/models/main.json": strToU8("{\"bones\":[]}"),
      "狐狸/textures/skin.png": strToU8("PNG"),
    });
    const zipFile = new File([zipBytes], "狐狸.zip");
    const r = await importWebFiles([zipFile], "ysm");
    // 解压后按 zip 内路径分组：模型组名 = 首段「狐狸」，组内 rel 保留子目录
    expect(r).toEqual({ imported: 1, failed: 0 });
    expect(idbMock._store.has("dir:ysm/狐狸:")).toBe(true);
    expect(idbMock._store.has("file:ysm/狐狸/狐狸.ysm")).toBe(true);
    expect(idbMock._store.has("file:ysm/狐狸/ysm.json")).toBe(true);
    expect(idbMock._store.has("file:ysm/狐狸/models/main.json")).toBe(true);
    expect(idbMock._store.has("file:ysm/狐狸/textures/skin.png")).toBe(true);
  });

  it("R2 导入增强：.zip 解压空 / 非标准 → 保留原 zip 整体入库（降级不阻断）", async () => {
    // 非标准 zip（无中央目录）→ extractZip 抛错 → 保留单文件，走「zip 当主文件」兜底
    const fake = new File([enc.encode("not a zip")], "坏.zip");
    const r = await importWebFiles([fake], "ysm");
    expect(r).toEqual({ imported: 1, failed: 0 });
    expect(idbMock._store.has("dir:ysm/坏:")).toBe(true);
    expect(idbMock._store.has("file:ysm/坏/坏.zip")).toBe(true);
  });

   it("R2 导入增强：扁平 .zip 无顶层目录 → zipStem 防碎片化（Blockbench 导出形态）", async () => {
    // 扁平 zip：ysm.json 在根目录，无公共顶层目录
    // 无此修复：ysm.json → group "ysm"，models/main.json → group "models"，
    //           textures/skin.png → group "textures" → 三组碎片化，坏模型 + 假失败
    const zipBytes = zipSync({
      "ysm.json": strToU8("{}"),
      "models/main.json": strToU8("{\"bones\":[]}"),
      "textures/skin.png": strToU8("PNG"),
    });
    const zipFile = new File([zipBytes], "角色.zip");
    const r = await importWebFiles([zipFile], "ysm");
    // 所有 entry 归入同一组（组名 = zipStem "角色"）
    expect(r).toEqual({ imported: 1, failed: 0 });
    expect(idbMock._store.has("dir:ysm/角色:")).toBe(true);
    expect(idbMock._store.has("file:ysm/角色/ysm.json")).toBe(true);
    expect(idbMock._store.has("file:ysm/角色/models/main.json")).toBe(true);
    expect(idbMock._store.has("file:ysm/角色/textures/skin.png")).toBe(true);
  });

  it("资源包 zip（解压后无主文件）→ 保留原 zip 当主文件（ADR-066 审计缺口 #3）", async () => {
    // pack.mcmeta + data/ 均非主文件扩展名——原实现解包后无主文件整组 failed imported=0
    const zipBytes = zipSync({
      "pack.mcmeta": strToU8("{}"),
      "data/minecraft/tags/blocks/x.json": strToU8("{}"),
    });
    const zipFile = new File([zipBytes], "材质包.zip");
    const r = await importWebFiles([zipFile], "resourcepack");
    expect(r).toEqual({ imported: 1, failed: 0 });
    // 原 zip 整体当主文件入库并显示
    const entries = (await browserAdapter.ScanModelEntries("/web/resourcepack")) as Array<{ Name: string }>;
    expect(entries.map((e) => e.Name)).toContain("材质包.zip");
  });

  it("ysm.json 可作主文件（桌面 IsYsmEntryJSON 白名单）；Ext 小写化 + 无点号保护", async () => {
    await importWebFiles([new File([enc.encode("{}")], "ysm.json")], "ysm");
    const entries = (await browserAdapter.ScanModelEntries("/web/ysm")) as Array<{ Name: string; Ext: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0].Name).toBe("ysm.json");
    expect(entries[0].Ext).toBe(".json");
    // 大小写变体：FOO.YSM → Ext 小写化（桌面 strings.ToLower 同口径）
    await importWebFiles([new File([enc.encode("Y")], "FOO.YSM")], "ysm");
    const entries2 = (await browserAdapter.ScanModelEntries("/web/ysm")) as Array<{ Name: string; Ext: string }>;
    expect(entries2.find((e) => e.Name === "FOO.YSM")?.Ext).toBe(".ysm");
  });

  it("中途 idbSet 失败 → 回滚只删本次新建 key，保留 preExisted（P3 code review）", async () => {
    // 预置：dir + 主文件已存在（模拟先前成功导入的同一模型）
    await importWebFiles([new File([enc.encode("OLD")], "狐狸.ysm")], "ysm");
    expect(idbMock._store.has("file:ysm/狐狸/狐狸.ysm")).toBe(true);
    expect(idbMock._store.has("dir:ysm/狐狸:")).toBe(true);
    // 本次重导入：主文件 + 辅助文件；第一次 idbSet（覆盖主文件）成功，
    // 第二次 idbSet（辅助文件写入）reject → 触发回滚
    const fMain = new File([enc.encode("NEW")], "狐狸.ysm");
    const fAux = new File([enc.encode("{}")], "main.json");
    Object.defineProperty(fMain, "webkitRelativePath", { value: "狐狸/狐狸.ysm" });
    Object.defineProperty(fAux, "webkitRelativePath", { value: "狐狸/main.json" });
    idbMock.idbSet
      .mockResolvedValueOnce(undefined) // 第一次（覆盖主文件）成功
      .mockRejectedValueOnce(new Error("QuotaExceededError")); // 第二次（辅助文件）失败
    const r = await importWebFiles([fMain, fAux], "ysm");
    expect(r.failed).toBeGreaterThan(0);
    // 主文件 key 是 preExisted（先前成功导入）→ 回滚不得删除，旧数据保留
    expect(idbMock._store.has("file:ysm/狐狸/狐狸.ysm")).toBe(true);
    // dir key 是 preExisted → 保留
    expect(idbMock._store.has("dir:ysm/狐狸:")).toBe(true);
  });

  it("中途失败回滚调用 idbDel 且只传本次新建 key（P3 code review：mock 补齐前不可测）", async () => {
    const f = new File([enc.encode("Y")], "新人.ysm");
    // 单文件组：第一次 idbSet（写 file key）成功，第二次 idbSet（写 dir key）失败
    // → 回滚删本次新建的 file key（preExisted=false）
    idbMock.idbSet
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("abort"));
    await importWebFiles([f], "ysm");
    expect(idbMock.idbDel).toHaveBeenCalledWith("files", "file:ysm/新人/新人.ysm");
    // 回滚后孤儿清理完成：库中无残留
    expect(idbMock._store.has("file:ysm/新人/新人.ysm")).toBe(false);
  });
});

describe("selectLocalRepo — FSA 授权本地仓库（ADR-049 能力门控缺口补齐）", () => {
  // FSA 句柄桩：目录 → 异步迭代子项；文件 → kind/name/getFile（结构对齐 _FsaDirHandle）
  function fileHandle(name: string, content: string): unknown {
    return {
      kind: "file",
      name,
      getFile: async () => new File([enc.encode(content)], name),
    };
  }
  function dirHandle(name: string, children: unknown[]): unknown {
    return {
      kind: "directory", // 真实 FileSystemDirectoryHandle 带 kind，_collectYsmFiles 靠它判定递归
      name,
      async *values(): AsyncIterableIterator<unknown> {
        for (const c of children) yield c;
      },
    };
  }
  function setPicker(handle: unknown): void {
    Object.defineProperty(window, "showDirectoryPicker", {
      value: vi.fn(async () => handle),
      writable: true,
      configurable: true,
    });
  }

  it("授权目录 → 递归扫 .ysm 落 IDB，返回 {ok, imported, failed, dir}", async () => {
    setPicker(
      dirHandle("模型库", [
        fileHandle("狐狸.ysm", "YSM"),
        dirHandle("子目录", [fileHandle("小猫.YSM", "cat")]),
        fileHandle("说明.txt", "忽略"),
      ]),
    );
    const r = await selectLocalRepo();
    expect(r).toEqual({ ok: true, imported: 2, failed: 0, dir: "模型库" });
    // 递归（子目录）+ 大小写扩展名（.YSM）均入模型库
    const entries = (await browserAdapter.ScanModelEntries("/web/ysm")) as Array<{
      Name: string;
      Ext: string;
    }>;
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.Name === "狐狸.ysm")).toBeDefined();
    expect(entries.find((e) => e.Name === "小猫.YSM")?.Ext).toBe(".ysm");
    // 非 .ysm 文件（说明.txt）不被收集
    expect(entries.some((e) => e.Name === "说明.txt")).toBe(false);
  });

  it("目录内无 .ysm → {imported: 0, failed: 0}（空授权不算失败）", async () => {
    setPicker(dirHandle("空库", [fileHandle("说明.txt", "x")]));
    await expect(selectLocalRepo()).resolves.toEqual({
      ok: true,
      imported: 0,
      failed: 0,
      dir: "空库",
    });
  });

  it("环境无 showDirectoryPicker → reject WebUnsupportedError（fail-fast 明确报错）", async () => {
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    await expect(selectLocalRepo()).rejects.toBeInstanceOf(WebUnsupportedError);
  });
});

describe("R2 FSA 句柄持久化（蓝图 docs/roadmap/web-edition.md §R2，参照 MikuMikuAR ADR-180/183）", () => {
  // 可持久化句柄桩：带 queryPermission/requestPermission 的目录句柄（对齐 FileSystemDirectoryHandle）
  function permDirHandle(name: string, perm: PermissionState, children: unknown[] = []): unknown {
    return {
      kind: "directory",
      name,
      queryPermission: vi.fn(async () => perm),
      requestPermission: vi.fn(async () => perm),
      async *values(): AsyncIterableIterator<unknown> {
        for (const c of children) yield c;
      },
    };
  }
  function fileHandle(name: string, content: string): unknown {
    return {
      kind: "file",
      name,
      getFile: async () => new File([enc.encode(content)], name),
    };
  }
  function setPicker(handle: unknown): void {
    Object.defineProperty(window, "showDirectoryPicker", {
      value: vi.fn(async () => handle),
      writable: true,
      configurable: true,
    });
  }

  it("selectLocalRepo 持久化句柄到 config store（供下次启动恢复）", async () => {
    setPicker(permDirHandle("模型库", "granted", [fileHandle("狐狸.ysm", "YSM")]));
    await selectLocalRepo();
    // 句柄已结构化克隆落库（key = fsaRootHandle）
    expect(idbMock._store.has("fsaRootHandle")).toBe(true);
    // 授权状态从持久化句柄可判定为 granted
    expect(await getFsaAuthState()).toBe("granted");
  });

  it("getFsaAuthState：无句柄 → none；不支持 FSA → unsupported", async () => {
    // 显式声明 FSA 支持（此前依赖前一用例 setPicker 残留，node 环境 window 重建后不再成立）
    setPicker(undefined);
    expect(await getFsaAuthState()).toBe("none");
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    expect(await getFsaAuthState()).toBe("unsupported");
  });

  it("getFsaAuthState：持久化句柄 permission revoked → revoked", async () => {
    setPicker(permDirHandle("模型库", "granted"));
    await selectLocalRepo();
    // 模拟权限被撤销：改写句柄 queryPermission 返回 prompt
    const h = idbMock._store.get("fsaRootHandle") as { queryPermission: () => Promise<PermissionState> };
    h.queryPermission = async () => "prompt" as PermissionState;
    expect(await getFsaAuthState()).toBe("revoked");
  });

  it("rescanFsaRoot：启动自愈恢复句柄并重扫入库", async () => {
    // 模拟上次会话已授权：句柄已持久化，无 picker 调用（启动期无手势）
    idbMock.idbSet("config", "fsaRootHandle", permDirHandle("模型库", "granted", [fileHandle("小猫.ysm", "cat")]));
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    const r = await rescanFsaRoot();
    expect(r).toEqual({ ok: true, imported: 1, failed: 0, dir: "模型库" });
    const entries = (await browserAdapter.ScanModelEntries("/web/ysm")) as Array<{ Name: string }>;
    expect(entries.find((e) => e.Name === "小猫.ysm")).toBeDefined();
  });

  it("rescanFsaRoot：句柄权限失效（revoked）→ 降级不扫描（返回 ok:false）", async () => {
    idbMock.idbSet("config", "fsaRootHandle", permDirHandle("模型库", "prompt"));
    const r = await rescanFsaRoot();
    expect(r).toEqual({ ok: false, imported: 0, failed: 0, dir: "" });
    expect(await browserAdapter.ScanModelEntries("/web/ysm")).toHaveLength(0);
  });

  it("reauthorizeFsaRoot：requestPermission granted → 重授权成功", async () => {
    idbMock.idbSet("config", "fsaRootHandle", permDirHandle("模型库", "granted"));
    expect(await reauthorizeFsaRoot()).toBe(true);
  });

  it("reauthorizeFsaRoot：无句柄 → false；requestPermission 拒绝 → false", async () => {
    expect(await reauthorizeFsaRoot()).toBe(false);
    idbMock.idbSet("config", "fsaRootHandle", permDirHandle("模型库", "prompt"));
    expect(await reauthorizeFsaRoot()).toBe(false);
  });
});

describe("browserAdapter — LoadResourceTypes（注册表驱动视图降级消除）", () => {
  it("返回与 resource_types.json 同形状 JSON（registry.ts 不再静默降级为空）", async () => {
    const json = (await browserAdapter.LoadResourceTypes()) as string;
    const parsed = JSON.parse(json) as { resourceTypes: Array<{ id: string }> };
    expect(Array.isArray(parsed.resourceTypes)).toBe(true);
    expect(parsed.resourceTypes.some((rt) => rt.id === "ysm")).toBe(true);
    expect(parsed.resourceTypes.length).toBeGreaterThanOrEqual(7);
  });
});

describe("browserAdapter — ADR-049 桥接增强 Batch 1（纯前端可复现绑定）", () => {
  const enc2 = new TextEncoder();

  it("SearchModels：关键词匹配模型名，返回 SearchResult[]（无数值条件 → 快路径）", async () => {
    await importWebFiles([new File([enc2.encode("YSM")], "狐狸.ysm")], "ysm");
    await importWebFiles([new File([enc2.encode("YSM")], "小猫.ysm")], "ysm");
    const hit = (await browserAdapter.SearchModels("/web/ysm", "狐狸", 0, 0, 0, 0, 0, 0)) as Array<{ name: string; path: string }>;
    expect(hit).toHaveLength(1);
    expect(hit[0].name).toBe("狐狸.ysm");
    expect(hit[0].path).toBe("/web/ysm/狐狸/狐狸.ysm");
    const miss = (await browserAdapter.SearchModels("/web/ysm", "龙", 0, 0, 0, 0, 0, 0)) as unknown[];
    expect(miss).toHaveLength(0);
  });

  it("ToggleModelEnable / IsFileBanned：ban 标记翻转，返回新「已启用」态", async () => {
    await importWebFiles([new File([enc2.encode("Y")], "狐狸.ysm")], "ysm");
    const p = "/web/ysm/狐狸/狐狸.ysm";
    expect(await browserAdapter.IsFileBanned(p)).toBe(false);
    expect(await browserAdapter.ToggleModelEnable(p)).toBe(false); // 首次切换 → 禁用
    expect(await browserAdapter.IsFileBanned(p)).toBe(true);
    expect(await browserAdapter.ToggleModelEnable(p)).toBe(true); // 再次切换 → 启用
    expect(await browserAdapter.IsFileBanned(p)).toBe(false);
  });

  it("标签：SetModelTags → GetModelTags / AllTags / ListByTag 闭环", async () => {
    await importWebFiles([new File([enc2.encode("Y")], "狐狸.ysm")], "ysm");
    const p = "/web/ysm/狐狸/狐狸.ysm";
    await browserAdapter.SetModelTags(p, ["新番", "联动"]);
    expect((await browserAdapter.GetModelTags(p)) as string[]).toEqual(["新番", "联动"]);
    expect((await browserAdapter.AllTags()) as string[]).toEqual(expect.arrayContaining(["新番", "联动"]));
    expect((await browserAdapter.ListByTag("新番")) as string[]).toContain(p);
    await browserAdapter.SetModelTags(p, null);
    expect((await browserAdapter.GetModelTags(p)) as string[]).toEqual([]);
  });

  it("DeleteResourcePack / RemoveDir：删除模型组（dir + file + 标记）", async () => {
    await importWebFiles([new File([enc2.encode("Y")], "狐狸.ysm")], "ysm");
    const p = "/web/ysm/狐狸/狐狸.ysm";
    await browserAdapter.SetModelTags(p, ["临时"]);
    await browserAdapter.DeleteResourcePack(p, "ysm");
    expect(await browserAdapter.ScanModelEntries("/web/ysm")).toHaveLength(0);
    expect(idbMock._store.has("file:ysm/狐狸/狐狸.ysm")).toBe(false);
    expect(idbMock._store.has("dir:ysm/狐狸:")).toBe(false);
    expect(idbMock._store.has("tags:/web/ysm/狐狸/狐狸.ysm")).toBe(false);
    // RemoveDir 走目录形态同样删除
    await importWebFiles([new File([enc2.encode("Y")], "小猫.ysm")], "ysm");
    await browserAdapter.RemoveDir("/web/ysm/小猫");
    expect(await browserAdapter.ScanModelEntries("/web/ysm")).toHaveLength(0);
  });

  it("RenameDir：模型目录整组 rekey（dir + file + 标记）；仅改目录名不改主文件名", async () => {
    await importWebFiles([new File([enc2.encode("Y")], "狐狸.ysm")], "ysm");
    const p = "/web/ysm/狐狸/狐狸.ysm";
    await browserAdapter.ToggleModelEnable(p); // 置 ban 标记，验证 rekey 跟随
    await browserAdapter.RenameDir("/web/ysm/狐狸", "小猫");
    const entries = (await browserAdapter.ScanModelEntries("/web/ysm")) as Array<{ Name: string; Path: string }>;
    expect(entries).toHaveLength(1);
    // RenameDir 重命名目录（模型文件夹），主文件名不变（与桌面一致：Name=主文件名）
    expect(entries[0].Name).toBe("狐狸.ysm");
    expect(entries[0].Path).toBe("/web/ysm/小猫/狐狸.ysm");
    // ban 标记随全路径 rekey 到新目录
    expect(await browserAdapter.IsFileBanned("/web/ysm/小猫/狐狸.ysm")).toBe(true);
    expect(idbMock._store.has("file:ysm/狐狸/狐狸.ysm")).toBe(false);
    expect(idbMock._store.has("file:ysm/小猫/狐狸.ysm")).toBe(true);
  });

  it("RenameFile：组内单文件 rekey（保留标记跟随全路径）", async () => {
    const f1 = new File([enc2.encode("Y")], "狐狸.ysm");
    const f2 = new File([enc2.encode("{}")], "main.json");
    Object.defineProperty(f1, "webkitRelativePath", { value: "狐狸/狐狸.ysm" });
    Object.defineProperty(f2, "webkitRelativePath", { value: "狐狸/main.json" });
    await importWebFiles([f1, f2], "ysm");
    await browserAdapter.RenameFile("/web/ysm/狐狸/main.json", "data.json");
    expect(idbMock._store.has("file:ysm/狐狸/data.json")).toBe(true);
    expect(idbMock._store.has("file:ysm/狐狸/main.json")).toBe(false);
  });

  it("ClearImportLogs / ClearRuntimeLogs：清空内存日志环", async () => {
    await browserAdapter.AddImportLog("m", "s", "t", 1, "ok", "");
    expect((await browserAdapter.GetImportLogs()) as unknown[]).toHaveLength(1);
    await browserAdapter.ClearImportLogs();
    expect((await browserAdapter.GetImportLogs()) as unknown[]).toHaveLength(0);
    await browserAdapter.AddOpLog("op", "m", "s", "t", 1, "ok", "");
    expect((await browserAdapter.GetRuntimeLogs()) as unknown[]).toHaveLength(1);
    await browserAdapter.ClearRuntimeLogs();
    expect((await browserAdapter.GetRuntimeLogs()) as unknown[]).toHaveLength(0);
  });

  it("GetSubDirMap：由 resource_types.json 派生 {id: storageSubDir}", async () => {
    const map = (await browserAdapter.GetSubDirMap()) as Record<string, string>;
    expect(map.ysm).toBeDefined();
    expect(typeof map.ysm).toBe("string");
    expect(Object.keys(map).length).toBeGreaterThanOrEqual(7);
  });
});

describe("browserAdapter — Proxy 原型成员（P3：Object 原型成员不路由 fail-fast）", () => {
  it("toString 等返回原型链实现，String(adapter) 正常而非 rejected Promise", () => {
    const proxy = browserAdapter as unknown as {
      toString: unknown;
      constructor: unknown;
      valueOf: unknown;
    };
    // fail-fast 不得路由到原型成员：读 toString 应拿到函数（原型链实现），非 rejected Promise
    expect(typeof proxy.toString).toBe("function");
    expect(typeof proxy.valueOf).toBe("function");
    // 若 fail-fast 路由到 toString → String(adapter) 得 "[object Promise]" 或抛错；
    // 走原型链 → "[object Object]"
    expect(String(browserAdapter)).toBe("[object Object]");
  });

  it("has trap：原型成员与未实现绑定返回 false，已实现绑定返回 true", () => {
    expect("toString" in browserAdapter).toBe(false);
    expect("constructor" in browserAdapter).toBe(false);
    expect("ScanModelEntries" in browserAdapter).toBe(true);
    expect("CreateDir" in browserAdapter).toBe(false); // 未实现 → fail-fast
  });
});

describe("browserAdapter — 社区/工坊桥接（ADR-049 Batch 2：bundled 默认 + localStorage 覆盖）", () => {
  it("LoadWorkshopCreators 返回 bundled creators（非 null、含 name/desc）", async () => {
    const c = (await browserAdapter.LoadWorkshopCreators()) as Array<{ name: string; desc: string }>;
    expect(Array.isArray(c)).toBe(true);
    expect(c.length).toBeGreaterThan(0);
    expect(typeof c[0].name).toBe("string");
    expect(typeof c[0].desc).toBe("string");
  });

  it("DefaultWorkshopSites 返回 bundled sites（非 null、含 id/url）", async () => {
    const s = (await browserAdapter.DefaultWorkshopSites()) as Array<{ id: string; url: string }>;
    expect(Array.isArray(s)).toBe(true);
    expect(s.length).toBeGreaterThan(0);
    expect(typeof s[0].id).toBe("string");
    expect(typeof s[0].url).toBe("string");
  });

  it("LoadGitHubRepos 返回 bundled github 仓库（只读，非 null）", async () => {
    const r = (await browserAdapter.LoadGitHubRepos()) as Array<{ name: string; type: string }>;
    expect(Array.isArray(r)).toBe(true);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].type).toBe("github");
  });

  it("Save→Load 覆盖优先：创作者自定义列表可被读回", async () => {
    const custom = [{ name: "测试作者", desc: "单测注入", type: "bilibili" }];
    await browserAdapter.SaveWorkshopCreators(custom as never);
    const got = (await browserAdapter.LoadWorkshopCreators()) as Array<{ name: string }>;
    expect(got).toHaveLength(1);
    expect(got[0].name).toBe("测试作者");
  });

  it("Save(null) 重置覆盖层：回退 bundled 默认", async () => {
    await browserAdapter.SaveWorkshopCreators([{ name: "临时", desc: "x" }] as never);
    await browserAdapter.SaveWorkshopCreators(null);
    const got = (await browserAdapter.LoadWorkshopCreators()) as Array<{ name: string }>;
    expect(got.length).toBeGreaterThan(1); // bundled 默认远大于 1
  });

  it("Save→Load 覆盖优先：站点自定义列表可被读回，且与创作者隔离", async () => {
    const customSites = [{ id: "mysite", icon: "⭐", label: "我的站", url: "https://x.test", desc: "t", group: "search" }];
    await browserAdapter.SaveWorkshopSites(customSites as never);
    const got = (await browserAdapter.DefaultWorkshopSites()) as Array<{ id: string }>;
    expect(got).toHaveLength(1);
    expect(got[0].id).toBe("mysite");
    // 创作者覆盖层不受影响（独立 key）
    expect(((await browserAdapter.LoadWorkshopCreators()) as Array<unknown>).length).toBeGreaterThan(0);
  });

  it("Load 返回深拷贝：修改返回值不影响下次 Load", async () => {
    const a = (await browserAdapter.LoadWorkshopCreators()) as Array<{ name: string }>;
    a.push({ name: "被污染" } as never);
    const b = (await browserAdapter.LoadWorkshopCreators()) as Array<{ name: string }>;
    expect(b.length).toBe(a.length - 1);
  });

  it("覆盖数据损坏（非 JSON）时回退 bundled，不抛错", async () => {
    localStorage.setItem("web:workshop-creators", "{broken");
    const c = (await browserAdapter.LoadWorkshopCreators()) as Array<unknown>;
    expect(c.length).toBeGreaterThan(0);
  });
});

describe("browserAdapter — 作者扫描/仓库索引（ADR-049 Batch 3：基于 IDB 模型库）", () => {
  it("ListModelAuthors 从 [作者] 前缀统计并按计数降序", async () => {
    await importWebFiles([
      new File([enc.encode("Y")], "[张三]模型A.ysm"),
      new File([enc.encode("Y")], "[张三]模型B.ysm"),
      new File([enc.encode("Y")], "[李四]角色.ysm"),
    ], "ysm");
    const authors = (await browserAdapter.ListModelAuthors()) as Array<{ Name: string; Count: number }>;
    expect(authors).toHaveLength(2);
    expect(authors[0].Name).toBe("张三");
    expect(authors[0].Count).toBe(2);
    expect(authors[1].Name).toBe("李四");
    expect(authors[1].Count).toBe(1);
  });

  it("ScanLocalAuthors 提取 [作者] 并带 type 标签（来自本地仓库）", async () => {
    await importWebFiles([new File([enc.encode("Y")], "[王五]角色.ysm")], "ysm");
    const creators = (await browserAdapter.ScanLocalAuthors("")) as Array<{ name: string; type: string; desc: string }>;
    expect(creators).toHaveLength(1);
    expect(creators[0].name).toBe("王五");
    expect(creators[0].type).toBe("ysm");
    expect(creators[0].desc).toBe("来自本地仓库");
  });

  it("GenerateRepoIndex 返回 index.json 内容（相对路径正斜杠）", async () => {
    await importWebFiles([new File([enc.encode("YY")], "赵六.ysm")], "ysm");
    const idx = (await browserAdapter.GenerateRepoIndex("/web/ysm")) as string;
    // 对齐 go/scanner/scanner.go indexEntry json tag：小写 name/path/size（契约测试 B3 锁定）
    const parsed = JSON.parse(idx) as Array<{ name: string; path: string; size: number }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("赵六.ysm");
    expect(parsed[0].path).toBe("赵六/赵六.ysm"); // 相对 /web/ysm
    expect(parsed[0].size).toBe(2);
  });

  it("空库时 ListModelAuthors/ScanLocalAuthors 返回 []（非 null，不抛错）", async () => {
    expect(await browserAdapter.ListModelAuthors()).toEqual([]);
    expect(await browserAdapter.ScanLocalAuthors("")).toEqual([]);
  });
});

describe("browserAdapter — 桥接增强边界/异常分支补全（审核补充）", () => {
  const enc3 = new TextEncoder();

  it("SearchModels 数值条件降级（真实环境无 Worker）：数值 0 且非零数值不影响关键词匹配", async () => {
    await importWebFiles([new File([enc3.encode("YSM")], "狐狸.ysm")], "ysm");
    const hit = (await browserAdapter.SearchModels("/web/ysm", "狐狸", 999, 999, 999, 999, 999, 999)) as Array<{
      name: string;
      boneCount: number;
      cubeCount: number;
      hasError: boolean;
    }>;
    expect(hit).toHaveLength(1);
    expect(hit[0].name).toBe("狐狸.ysm");
    // 数值条件无几何分析，如实降级（非静默错误）：sizes 恒 0
    expect(hit[0].boneCount).toBe(0);
    expect(hit[0].cubeCount).toBe(0);
    expect(hit[0].hasError).toBe(false);
  });

  it("DeleteResourcePack 清理 ban 标记（dir+file+ban/tags 整组清理）", async () => {
    await importWebFiles([new File([enc3.encode("Y")], "狐狸.ysm")], "ysm");
    const p = "/web/ysm/狐狸/狐狸.ysm";
    await browserAdapter.ToggleModelEnable(p); // 置 ban
    expect(await browserAdapter.IsFileBanned(p)).toBe(true);
    await browserAdapter.DeleteResourcePack(p, "ysm");
    expect(await browserAdapter.ScanModelEntries("/web/ysm")).toHaveLength(0);
    expect(idbMock._store.has("ban:/web/ysm/狐狸/狐狸.ysm")).toBe(false);
    expect(idbMock._store.has("file:ysm/狐狸/狐狸.ysm")).toBe(false);
    expect(idbMock._store.has("dir:ysm/狐狸:")).toBe(false);
  });

  it("SetModelTags(path, null) 删除标签 key（对齐桌面清除语义，不残留空数组）", async () => {
    await importWebFiles([new File([enc3.encode("Y")], "狐狸.ysm")], "ysm");
    const p = "/web/ysm/狐狸/狐狸.ysm";
    await browserAdapter.SetModelTags(p, ["临时"]);
    expect(idbMock._store.has("tags:/web/ysm/狐狸/狐狸.ysm")).toBe(true);
    await browserAdapter.SetModelTags(p, null);
    // 修复后：key 被删除（而非残留空数组）
    expect(idbMock._store.has("tags:/web/ysm/狐狸/狐狸.ysm")).toBe(false);
    expect((await browserAdapter.GetModelTags(p)) as string[]).toEqual([]);
  });

  it("GenerateRepoIndex 全库（repoPath 非 /web 开头）→ 跨类型相对 WEB_ROOT 路径", async () => {
    await importWebFiles([new File([enc3.encode("YY")], "赵六.ysm")], "ysm");
    const idx = (await browserAdapter.GenerateRepoIndex("not-a-web-root")) as string;
    // 对齐 Go indexEntry json tag：小写 name/path（契约测试 B3 锁定）
    const parsed = JSON.parse(idx) as Array<{ name: string; path: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("赵六.ysm");
    expect(parsed[0].path).toBe("ysm/赵六/赵六.ysm"); // 相对 WEB_ROOT=/web
  });

  it("ScanLocalAuthors 跨类型同作者 → type 用 ; 合并（来自本地仓库）", async () => {
    await importWebFiles([new File([enc3.encode("Y")], "[王五]A.ysm")], "ysm");
    await importWebFiles([new File([enc3.encode("Y")], "[王五]B.ysm")], "litematic");
    const creators = (await browserAdapter.ScanLocalAuthors("")) as Array<{ name: string; type: string }>;
    expect(creators).toHaveLength(1);
    expect(creators[0].name).toBe("王五");
    expect(creators[0].type).toContain("ysm");
    expect(creators[0].type).toContain("litematic");
  });

  it("ListModelAuthors 忽略无 [作者] 前缀的模型名（仅统计括号作者）", async () => {
    await importWebFiles([new File([enc3.encode("Y")], "普通模型.ysm")], "ysm");
    expect((await browserAdapter.ListModelAuthors()) as unknown[]).toEqual([]);
  });

  it("SaveWorkshopSites(null) 重置覆盖层 → 回退 bundled 默认", async () => {
    await browserAdapter.SaveWorkshopSites([{ id: "x", url: "https://x.test" }] as never);
    await browserAdapter.SaveWorkshopSites(null);
    const got = (await browserAdapter.DefaultWorkshopSites()) as Array<{ id: string }>;
    expect(got.length).toBeGreaterThan(1); // bundled 默认远大于 1
  });
});

// ===== ADR-071 #6：SearchModels 数值过滤（Worker 统计注入 / 降级 / 快路径）=====
// 数值条件统计走 Web Worker（web-stats.ts）；单测环境无 Worker → 注入统计 runner
// 模拟「Worker 可用」；runner 返回 null 模拟「Worker 不可用 → 降级」。
// 注入/降级标记经 browser-adapter 链 re-export 引入：与 web-fs 内 searchWebModels
// 共用同一 web-stats 实例（vitest mock 图会拆独立实例，直接 import 会断降级标记）。
import {
  __setStatsRunnerForTest,
  consumeWebSearchDegraded,
  terminateStatsWorker,
} from "./browser-adapter.ts";

describe("browserAdapter — SearchModels 数值过滤（ADR-071 #6 Worker 统计）", () => {
  const encN = new TextEncoder();

  beforeEach(() => {
    // 清残留：上一 describe（桥接增强边界测试）可能置过降级标记（真实环境无 Worker）
    __setStatsRunnerForTest(null);
    while (consumeWebSearchDegraded()) {}
  });

  afterEach(() => {
    __setStatsRunnerForTest(null);
    while (consumeWebSearchDegraded()) {}
    terminateStatsWorker();
  });

  it("数值条件：min/max 骨骼、立方体、纹理过滤生效，且返回真实统计数值", async () => {
    await importWebFiles([new File([encN.encode("X")], "大狐狸.ysm")], "ysm");
    await importWebFiles([new File([encN.encode("X")], "小猫.ysm")], "ysm");
    __setStatsRunnerForTest(async (paths) =>
      paths.map((p) =>
        p.includes("大狐狸")
          ? { boneCount: 10, cubeCount: 30, texWidth: 128, texHeight: 128, hasError: false }
          : { boneCount: 4, cubeCount: 8, texWidth: 32, texHeight: 16, hasError: false },
      ),
    );

    // minBones=5 → 仅大狐狸（10 ≥ 5；小猫 4 < 5 排除）
    const byMinBones = (await browserAdapter.SearchModels("/web/ysm", "", 5, 0, 0, 0, 0, 0)) as Array<{
      name: string;
      boneCount: number;
      cubeCount: number;
      texWidth: number;
    }>;
    expect(byMinBones.map((r) => r.name)).toEqual(["大狐狸.ysm"]);
    expect(byMinBones[0].boneCount).toBe(10);
    expect(byMinBones[0].cubeCount).toBe(30);
    expect(byMinBones[0].texWidth).toBe(128);

    // maxBones=8 → 仅小猫（4 ≤ 8；大狐狸 10 > 8 排除）
    const byMaxBones = (await browserAdapter.SearchModels("/web/ysm", "", 0, 8, 0, 0, 0, 0)) as Array<{
      name: string;
    }>;
    expect(byMaxBones.map((r) => r.name)).toEqual(["小猫.ysm"]);

    // minCubes=10 → 仅大狐狸（30 ≥ 10；小猫 8 < 10 排除）
    const byMinCubes = (await browserAdapter.SearchModels("/web/ysm", "", 0, 0, 10, 0, 0, 0)) as Array<{
      name: string;
    }>;
    expect(byMinCubes.map((r) => r.name)).toEqual(["大狐狸.ysm"]);

    // minTex=64 → 仅大狐狸（宽高均 ≥ 64；小猫 32×16 排除——对齐 Go minTex 语义）
    const byMinTex = (await browserAdapter.SearchModels("/web/ysm", "", 0, 0, 0, 0, 64, 0)) as Array<{
      name: string;
      texWidth: number;
      texHeight: number;
    }>;
    expect(byMinTex.map((r) => r.name)).toEqual(["大狐狸.ysm"]);
    expect(byMinTex[0].texWidth).toBe(128);
    expect(byMinTex[0].texHeight).toBe(128);

    // Worker 生效 → 不置降级标记
    expect(consumeWebSearchDegraded()).toBe(false);
  });

  it("数值条件 + 统计失败（hasError）→ 该模型排除（对齐 Go BoneCount==0 跳过）", async () => {
    await importWebFiles([new File([encN.encode("X")], "好模型.ysm")], "ysm");
    await importWebFiles([new File([encN.encode("X")], "坏模型.ysm")], "ysm");
    __setStatsRunnerForTest(async (paths) =>
      paths.map((p) =>
        p.includes("坏模型")
          ? { boneCount: 0, cubeCount: 0, texWidth: 0, texHeight: 0, hasError: true }
          : { boneCount: 7, cubeCount: 9, texWidth: 64, texHeight: 64, hasError: false },
      ),
    );
    // maxBones=100：坏模型若返回 0 骨也会通过 max 过滤，但 Go 语义要求 BoneCount==0 直接跳过
    const hit = (await browserAdapter.SearchModels("/web/ysm", "", 0, 100, 0, 0, 0, 0)) as Array<{
      name: string;
      hasError: boolean;
    }>;
    expect(hit.map((r) => r.name)).toEqual(["好模型.ysm"]);
    expect(hit[0].hasError).toBe(false);
  });

  it("数值条件 + Worker 不可用（runner 返回 null）→ 降级：数值 0 + hasError false + 降级标记置位", async () => {
    await importWebFiles([new File([encN.encode("X")], "狐狸.ysm")], "ysm");
    await importWebFiles([new File([encN.encode("X")], "小猫.ysm")], "ysm");
    __setStatsRunnerForTest(async () => null);
    const hit = (await browserAdapter.SearchModels("/web/ysm", "小", 999, 0, 0, 0, 0, 0)) as Array<{
      name: string;
      boneCount: number;
      texWidth: number;
      hasError: boolean;
    }>;
    // 降级 = 纯关键词匹配（数值条件忽略，保持既有行为）
    expect(hit.map((r) => r.name)).toEqual(["小猫.ysm"]);
    expect(hit[0].boneCount).toBe(0);
    expect(hit[0].texWidth).toBe(0);
    expect(hit[0].hasError).toBe(false);
    // toolbar-search 据此 toast 降级提示
    expect(consumeWebSearchDegraded()).toBe(true);
  });

  it("无数值条件 → 快路径：不触发统计 runner，数值恒 0", async () => {
    await importWebFiles([new File([encN.encode("X")], "狐狸.ysm")], "ysm");
    const runner = vi.fn(async (paths: string[]) =>
      paths.map(() => ({ boneCount: 1, cubeCount: 1, texWidth: 1, texHeight: 1, hasError: false })),
    );
    __setStatsRunnerForTest(runner as never);
    const hit = (await browserAdapter.SearchModels("/web/ysm", "狐狸", 0, 0, 0, 0, 0, 0)) as Array<{
      name: string;
      boneCount: number;
    }>;
    expect(hit).toHaveLength(1);
    expect(hit[0].name).toBe("狐狸.ysm");
    expect(hit[0].boneCount).toBe(0); // 快路径不统计
    expect(runner).not.toHaveBeenCalled();
    expect(consumeWebSearchDegraded()).toBe(false);
  });
});

// ===== 审计补测：三向一致性 / 错误路径 / 空输入 / 重复操作（Batch1-3 覆盖空洞堵漏）=====
// 上一批测试的缺口：RenameDir 只验证了 file+ban（未验证 dir key rekey 与 tags 跟随）；
// RenameFile 测试名宣称「保留标记跟随全路径」却无任何标记断言（半假绿）；
// 错误路径 / 空输入 / 重复操作均无覆盖。以下用例逐一补齐。
describe("browserAdapter — 三向一致性/边界补测（审核补充）", () => {
  const e4 = new TextEncoder();

  it("RenameDir：dir + file + ban/tags 三向 rekey（含 dir meta.name 更新，列表可见性保持）", async () => {
    await importWebFiles([new File([e4.encode("Y")], "狐狸.ysm")], "ysm");
    const p = "/web/ysm/狐狸/狐狸.ysm";
    await browserAdapter.SetModelTags(p, ["旧标签"]);
    await browserAdapter.ToggleModelEnable(p); // 置 ban
    await browserAdapter.RenameDir("/web/ysm/狐狸", "小猫");
    // dir key rekey（旧 key 消失、新 key 出现）
    expect(idbMock._store.has("dir:ysm/小猫:")).toBe(true);
    expect(idbMock._store.has("dir:ysm/狐狸:")).toBe(false);
    // file key rekey
    expect(idbMock._store.has("file:ysm/小猫/狐狸.ysm")).toBe(true);
    expect(idbMock._store.has("file:ysm/狐狸/狐狸.ysm")).toBe(false);
    // ban/tags 标记随全路径 rekey（上一批只验证了 ban，tags 未验证）
    expect(idbMock._store.has("ban:/web/ysm/小猫/狐狸.ysm")).toBe(true);
    expect(idbMock._store.has("tags:/web/ysm/小猫/狐狸.ysm")).toBe(true);
    expect(idbMock._store.has("ban:/web/ysm/狐狸/狐狸.ysm")).toBe(false);
    expect(await browserAdapter.IsFileBanned("/web/ysm/小猫/狐狸.ysm")).toBe(true);
    expect((await browserAdapter.GetModelTags("/web/ysm/小猫/狐狸.ysm")) as string[]).toEqual(["旧标签"]);
    // dir meta.name 更新 → scanWebModels 在新前缀下仍能扫到（列表不空）
    const entries = (await browserAdapter.ScanModelEntries("/web/ysm")) as Array<{ Path: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0].Path).toBe("/web/ysm/小猫/狐狸.ysm");
  });

  it("RenameFile：ban/tags 标记跟随重命名后的全路径（补上测试名宣称却未断言的标记路径）", async () => {
    await importWebFiles([new File([e4.encode("Y")], "狐狸.ysm")], "ysm");
    const oldP = "/web/ysm/狐狸/狐狸.ysm";
    const newP = "/web/ysm/狐狸/小狐狸.ysm";
    await browserAdapter.SetModelTags(oldP, ["联动"]);
    await browserAdapter.ToggleModelEnable(oldP); // 置 ban
    await browserAdapter.RenameFile(oldP, "小狐狸.ysm");
    // 文件数据 rekey
    expect(idbMock._store.has("file:ysm/狐狸/小狐狸.ysm")).toBe(true);
    expect(idbMock._store.has("file:ysm/狐狸/狐狸.ysm")).toBe(false);
    // 标记按新全路径跟随（原测试无断言 → 实现回归时假绿）
    expect(idbMock._store.has("ban:/web/ysm/狐狸/小狐狸.ysm")).toBe(true);
    expect(idbMock._store.has("tags:/web/ysm/狐狸/小狐狸.ysm")).toBe(true);
    expect(idbMock._store.has("tags:/web/ysm/狐狸/狐狸.ysm")).toBe(false);
    expect(await browserAdapter.IsFileBanned(newP)).toBe(true);
    expect((await browserAdapter.GetModelTags(newP)) as string[]).toEqual(["联动"]);
  });

  it("错误路径：非 /web/ 路径的删除/重命名 → reject（无效路径拒绝，模型不受影响）", async () => {
    await importWebFiles([new File([e4.encode("Y")], "狐狸.ysm")], "ysm");
    await expect(browserAdapter.DeleteResourcePack("/repo/ysm/狐狸/狐狸.ysm", "ysm")).rejects.toThrow("无效路径");
    await expect(browserAdapter.RemoveDir("/repo/ysm/狐狸")).rejects.toThrow("无效路径");
    await expect(browserAdapter.RenameDir("/repo/ysm/狐狸", "猫")).rejects.toThrow("无效路径");
    await expect(browserAdapter.RenameFile("/repo/ysm/狐狸/狐狸.ysm", "猫.ysm")).rejects.toThrow("无效路径");
    // 模型组未受影响（dir + file 仍在）
    expect((await browserAdapter.ScanModelEntries("/web/ysm")) as unknown[]).toHaveLength(1);
    expect(idbMock._store.has("file:ysm/狐狸/狐狸.ysm")).toBe(true);
  });

  it("空输入：空库 GenerateRepoIndex → [] JSON（不抛错）", async () => {
    const idx = (await browserAdapter.GenerateRepoIndex("/web/ysm")) as string;
    expect(JSON.parse(idx)).toEqual([]);
  });

  it("空输入：空库 AllTags / ListByTag → []（不抛错，非 null）", async () => {
    expect(await browserAdapter.AllTags()).toEqual([]);
    expect(await browserAdapter.ListByTag("任意")).toEqual([]);
  });

  it("空输入：SearchModels 空关键词 → 返回全部条目（对齐桌面 kw=='' 语义）", async () => {
    await importWebFiles([new File([e4.encode("Y")], "狐狸.ysm")], "ysm");
    const hit = (await browserAdapter.SearchModels("/web/ysm", "", 0, 0, 0, 0, 0, 0)) as Array<{ name: string }>;
    expect(hit).toHaveLength(1);
    expect(hit[0].name).toBe("狐狸.ysm");
  });

  it("SetModelTags(path, []) 空数组等同删除 key（对齐 go/tags/tags.go len==0 → delete）", async () => {
    await importWebFiles([new File([e4.encode("Y")], "狐狸.ysm")], "ysm");
    const p = "/web/ysm/狐狸/狐狸.ysm";
    await browserAdapter.SetModelTags(p, []);
    expect(idbMock._store.has(`tags:${p}`)).toBe(false); // Go 契约：空数组删除 key，不残留
    expect((await browserAdapter.GetModelTags(p)) as string[]).toEqual([]);
  });

  it("重复操作：连续两次不同名 RenameDir → 数据完整保持（每次 rekey 闭环无残留）", async () => {
    await importWebFiles([new File([e4.encode("Y")], "狐狸.ysm")], "ysm");
    await browserAdapter.RenameDir("/web/ysm/狐狸", "小猫");
    await browserAdapter.RenameDir("/web/ysm/小猫", "大猫");
    const entries = (await browserAdapter.ScanModelEntries("/web/ysm")) as Array<{ Path: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0].Path).toBe("/web/ysm/大猫/狐狸.ysm");
    expect(idbMock._store.has("dir:ysm/大猫:")).toBe(true);
    expect(idbMock._store.has("file:ysm/大猫/狐狸.ysm")).toBe(true);
    expect(idbMock._store.has("file:ysm/小猫/狐狸.ysm")).toBe(false);
    expect(idbMock._store.has("dir:ysm/小猫:")).toBe(false);
  });

  it("重复操作：删除已删模型组幂等（不抛错）", async () => {
    await importWebFiles([new File([e4.encode("Y")], "狐狸.ysm")], "ysm");
    const p = "/web/ysm/狐狸/狐狸.ysm";
    await browserAdapter.DeleteResourcePack(p, "ysm");
    await expect(browserAdapter.DeleteResourcePack(p, "ysm")).resolves.toBeUndefined();
    expect(await browserAdapter.ScanModelEntries("/web/ysm")).toHaveLength(0);
  });

  // ===== 缺陷/边界（对齐并行修复后的源码行为）=====
  it("RenameDir 同名/目标已存在 → 拒绝并保留数据（对齐桌面「目标已存在」语义）", async () => {
    await importWebFiles([new File([e4.encode("Y")], "狐狸.ysm")], "ysm");
    await expect(browserAdapter.RenameDir("/web/ysm/狐狸", "狐狸")).rejects.toThrow("目标已存在");
    // 数据保留（不静默覆盖/合并）
    expect((await browserAdapter.ScanModelEntries("/web/ysm")) as unknown[]).toHaveLength(1);
    expect(idbMock._store.has("dir:ysm/狐狸:")).toBe(true);
    expect(idbMock._store.has("file:ysm/狐狸/狐狸.ysm")).toBe(true);
  });

  // 缺陷证据（第六轮批次1 修复）：renameWebFile 的「目标已存在」守卫原用
  // newKey !== oldKey 跳过同名场景，同名时 idbSet(newKey) 再 idbDel(oldKey)（同 key）
  // → 文件被删除（数据丢失）。已修复：同名 no-op 早退，测试启用。
  it("RenameFile 同名（newName === 原 rel）→ 文件保留（修复前 set 后 del 同名 key → 文件丢失）", async () => {
    await importWebFiles([new File([e4.encode("Y")], "狐狸.ysm")], "ysm");
    await browserAdapter.RenameFile("/web/ysm/狐狸/狐狸.ysm", "狐狸.ysm"); // 同名重命名
    expect(idbMock._store.has("file:ysm/狐狸/狐狸.ysm")).toBe(true);
    expect((await browserAdapter.ScanModelEntries("/web/ysm")) as unknown[]).toHaveLength(1);
  });
});

describe("R1 文件层级读取（P-A 多段路径，蓝图 docs/roadmap/web-edition.md §R1）", () => {
  // 多段目录导入：分类1/狐狸 作为组名（目录树模型组），组内 rel 保留子目录（tex/face.png）
  it("多段目录导入：组名含路径，组内 rel 保留子目录层级", async () => {
    const fMain = new File([enc.encode("YSM")], "狐狸.ysm");
    Object.defineProperty(fMain, "webkitRelativePath", { value: "分类1/狐狸/狐狸.ysm" });
    const fTex = new File([enc.encode("PNG")], "face.png");
    Object.defineProperty(fTex, "webkitRelativePath", { value: "分类1/狐狸/tex/face.png" });
    const fJson = new File([enc.encode("{}")], "main.json");
    Object.defineProperty(fJson, "webkitRelativePath", { value: "分类1/狐狸/main.json" });
    const r = await importWebFiles([fMain, fTex, fJson], "ysm");
    expect(r).toEqual({ imported: 1, failed: 0 });
    // dir key 组名含多段
    expect(idbMock._store.has("dir:ysm/分类1/狐狸:")).toBe(true);
    // 组内 rel 保留子目录层级（不再拍平为 basename）
    expect(idbMock._store.has("file:ysm/分类1/狐狸/狐狸.ysm")).toBe(true);
    expect(idbMock._store.has("file:ysm/分类1/狐狸/main.json")).toBe(true);
    expect(idbMock._store.has("file:ysm/分类1/狐狸/tex/face.png")).toBe(true);
    // scanWebModels：Path 含多段组名；主文件 = 组根 .ysm（嵌套 tex 不参与竞争）
    const entries = (await browserAdapter.ScanModelEntries("/web/ysm")) as Array<{ Name: string; Path: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0].Name).toBe("狐狸.ysm");
    expect(entries[0].Path).toBe("/web/ysm/分类1/狐狸/狐狸.ysm");
  });

  it("多段组：读文件 /web/<type>/<name>/<rel> 直达（不拆 name 边界）", async () => {
    const fMain = new File([enc.encode("YSM")], "狐狸.ysm");
    Object.defineProperty(fMain, "webkitRelativePath", { value: "分类1/狐狸/狐狸.ysm" });
    await importWebFiles([fMain], "ysm");
    const bytes = enc.encode("YSM");
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    expect(await browserAdapter.ReadFileBytes("/web/ysm/分类1/狐狸/狐狸.ysm")).toBe(arrayBufferToBase64(ab));
    expect(await browserAdapter.ReadFileBytes("/web/ysm/分类1/狐狸/missing.json")).toBeNull();
  });

  it("多段组：RenameDir 整组 rekey 保持层级", async () => {
    const fMain = new File([enc.encode("YSM")], "狐狸.ysm");
    Object.defineProperty(fMain, "webkitRelativePath", { value: "分类1/狐狸/狐狸.ysm" });
    await importWebFiles([fMain], "ysm");
    await browserAdapter.RenameDir("/web/ysm/分类1/狐狸", "大猫");
    expect(idbMock._store.has("dir:ysm/分类1/大猫:")).toBe(true);
    expect(idbMock._store.has("dir:ysm/分类1/狐狸:")).toBe(false);
    expect(idbMock._store.has("file:ysm/分类1/大猫/狐狸.ysm")).toBe(true);
    expect(idbMock._store.has("file:ysm/分类1/狐狸/狐狸.ysm")).toBe(false);
    const entries = (await browserAdapter.ScanModelEntries("/web/ysm")) as Array<{ Path: string }>;
    expect(entries[0].Path).toBe("/web/ysm/分类1/大猫/狐狸.ysm");
  });

  it("多段组：DeleteResourcePack 整组删除 + 幂等", async () => {
    const fMain = new File([enc.encode("YSM")], "狐狸.ysm");
    Object.defineProperty(fMain, "webkitRelativePath", { value: "分类1/狐狸/狐狸.ysm" });
    await importWebFiles([fMain], "ysm");
    await browserAdapter.DeleteResourcePack("/web/ysm/分类1/狐狸/狐狸.ysm", "ysm");
    expect(await browserAdapter.ScanModelEntries("/web/ysm")).toHaveLength(0);
    expect(idbMock._store.has("dir:ysm/分类1/狐狸:")).toBe(false);
    // 幂等：重复删除不抛错（组已删 → 格式合法但 dir 无匹配 → 静默通过）
    await expect(browserAdapter.DeleteResourcePack("/web/ysm/分类1/狐狸/狐狸.ysm", "ysm")).resolves.toBeUndefined();
  });

  it("多段组：RenameFile 组内文件（含子目录 rel）rekey", async () => {
    const fMain = new File([enc.encode("YSM")], "狐狸.ysm");
    Object.defineProperty(fMain, "webkitRelativePath", { value: "分类1/狐狸/狐狸.ysm" });
    const fTex = new File([enc.encode("PNG")], "face.png");
    Object.defineProperty(fTex, "webkitRelativePath", { value: "分类1/狐狸/tex/face.png" });
    await importWebFiles([fMain, fTex], "ysm");
    await browserAdapter.RenameFile("/web/ysm/分类1/狐狸/tex/face.png", "eye.png");
    expect(idbMock._store.has("file:ysm/分类1/狐狸/tex/eye.png")).toBe(true);
    expect(idbMock._store.has("file:ysm/分类1/狐狸/tex/face.png")).toBe(false);
  });

  it("ListAllFilePaths：递归列目录下全部文件完整路径（R1 桥接）", async () => {
    const fMain = new File([enc.encode("YSM")], "狐狸.ysm");
    Object.defineProperty(fMain, "webkitRelativePath", { value: "分类1/狐狸/狐狸.ysm" });
    const fTex = new File([enc.encode("PNG")], "face.png");
    Object.defineProperty(fTex, "webkitRelativePath", { value: "分类1/狐狸/tex/face.png" });
    const fJson = new File([enc.encode("{}")], "main.json");
    Object.defineProperty(fJson, "webkitRelativePath", { value: "分类1/狐狸/main.json" });
    await importWebFiles([fMain, fTex, fJson], "ysm");
    // 目录 = 模型组 → 递归取全部文件（含组内子目录 rel）
    const all = await browserAdapter.ListAllFilePaths("/web/ysm/分类1/狐狸");
    expect(all).toEqual(
      expect.arrayContaining([
        "/web/ysm/分类1/狐狸/狐狸.ysm",
        "/web/ysm/分类1/狐狸/main.json",
        "/web/ysm/分类1/狐狸/tex/face.png",
      ]),
    );
    expect(all).toHaveLength(3);
    // 子目录形态路径 → 只取该子树
    const sub = await browserAdapter.ListAllFilePaths("/web/ysm/分类1/狐狸/tex");
    expect(sub).toEqual(["/web/ysm/分类1/狐狸/tex/face.png"]);
    // 非 /web 路径 → 空数组（不抛错）
    expect(await browserAdapter.ListAllFilePaths("/repo/abc")).toEqual([]);
  });

  // 存量兼容：单层 webkitRelativePath（首段 = 组名）行为不变，不破坏既有库
  it("存量兼容：单层目录导入仍以目录为组名", async () => {
    const fMain = new File([enc.encode("YSM")], "狐狸.ysm");
    Object.defineProperty(fMain, "webkitRelativePath", { value: "狐狸/狐狸.ysm" });
    const fAux = new File([enc.encode("{}")], "main.json");
    Object.defineProperty(fAux, "webkitRelativePath", { value: "狐狸/main.json" });
    const r = await importWebFiles([fMain, fAux], "ysm");
    expect(r).toEqual({ imported: 1, failed: 0 });
    expect(idbMock._store.has("dir:ysm/狐狸:")).toBe(true);
    expect(idbMock._store.has("file:ysm/狐狸/狐狸.ysm")).toBe(true);
    expect(idbMock._store.has("file:ysm/狐狸/main.json")).toBe(true);
  });
});

// ===== MoveModelFile / CopyModelFile（模型组移动/复制，P0 翻案项）=====
// 对齐桌面 fileops.MoveModelFile/CopyModelFile 语义：Move 删源、Copy 保留源；
// dstDir = /web/<type>/<目标文件夹>，目标模型名 = 目标文件夹/<src 组名末段>
// （Go 的 dst=Join(dstDir, Base(src))）；组级 rekey（dir + file + ban/tags 标记）。
describe("browserAdapter — MoveModelFile / CopyModelFile（组级移动/复制）", () => {
  const e6 = new TextEncoder();

  it("MoveModelFile：整组移动（dir + file + ban/tags rekey，旧路径消失、新路径可见）", async () => {
    await importWebFiles([new File([e6.encode("Y")], "狐狸.ysm")], "ysm");
    const p = "/web/ysm/狐狸/狐狸.ysm";
    await browserAdapter.SetModelTags(p, ["联动"]);
    await browserAdapter.ToggleModelEnable(p); // 置 ban 标记
    await browserAdapter.MoveModelFile(p, "/web/ysm/作者A");
    // 扫描结果：新路径出现、旧路径消失
    const entries = (await browserAdapter.ScanModelEntries("/web/ysm")) as Array<{ Name: string; Path: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0].Name).toBe("狐狸.ysm");
    expect(entries[0].Path).toBe("/web/ysm/作者A/狐狸/狐狸.ysm");
    // dir/file key rekey（旧 key 删、新 key 建）
    expect(idbMock._store.has("dir:ysm/作者A/狐狸:")).toBe(true);
    expect(idbMock._store.has("dir:ysm/狐狸:")).toBe(false);
    expect(idbMock._store.has("file:ysm/作者A/狐狸/狐狸.ysm")).toBe(true);
    expect(idbMock._store.has("file:ysm/狐狸/狐狸.ysm")).toBe(false);
    // ban/tags 标记随全路径 rekey（对齐 renameWebDir 既有处理）
    expect(idbMock._store.has("tags:/web/ysm/作者A/狐狸/狐狸.ysm")).toBe(true);
    expect(idbMock._store.has("ban:/web/ysm/作者A/狐狸/狐狸.ysm")).toBe(true);
    expect(idbMock._store.has("tags:/web/ysm/狐狸/狐狸.ysm")).toBe(false);
    expect(await browserAdapter.IsFileBanned("/web/ysm/作者A/狐狸/狐狸.ysm")).toBe(true);
    expect((await browserAdapter.GetModelTags("/web/ysm/作者A/狐狸/狐狸.ysm")) as string[]).toEqual(["联动"]);
  });

  it("MoveModelFile：目录形态 src（/web/<type>/<name>）同样整组移动", async () => {
    await importWebFiles([new File([e6.encode("Y")], "狐狸.ysm")], "ysm");
    await browserAdapter.MoveModelFile("/web/ysm/狐狸", "/web/ysm/作者A");
    expect(idbMock._store.has("dir:ysm/作者A/狐狸:")).toBe(true);
    expect(idbMock._store.has("dir:ysm/狐狸:")).toBe(false);
    const entries = (await browserAdapter.ScanModelEntries("/web/ysm")) as Array<{ Path: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0].Path).toBe("/web/ysm/作者A/狐狸/狐狸.ysm");
  });

  it("MoveModelFile：多段组名移动只保留末段（分类1/狐狸 → 作者A/狐狸，对齐 Go Base(src)）", async () => {
    const fMain = new File([e6.encode("YSM")], "狐狸.ysm");
    Object.defineProperty(fMain, "webkitRelativePath", { value: "分类1/狐狸/狐狸.ysm" });
    const fTex = new File([e6.encode("PNG")], "face.png");
    Object.defineProperty(fTex, "webkitRelativePath", { value: "分类1/狐狸/tex/face.png" });
    await importWebFiles([fMain, fTex], "ysm");
    await browserAdapter.MoveModelFile("/web/ysm/分类1/狐狸/狐狸.ysm", "/web/ysm/作者A");
    expect(idbMock._store.has("dir:ysm/作者A/狐狸:")).toBe(true);
    expect(idbMock._store.has("dir:ysm/分类1/狐狸:")).toBe(false);
    expect(idbMock._store.has("file:ysm/作者A/狐狸/狐狸.ysm")).toBe(true);
    expect(idbMock._store.has("file:ysm/作者A/狐狸/tex/face.png")).toBe(true);
    expect(idbMock._store.has("file:ysm/分类1/狐狸/tex/face.png")).toBe(false);
  });

  it("CopyModelFile：复制保留源（新旧模型并存，dir/file/标记都复制）", async () => {
    await importWebFiles([new File([e6.encode("Y")], "狐狸.ysm")], "ysm");
    const p = "/web/ysm/狐狸/狐狸.ysm";
    await browserAdapter.SetModelTags(p, ["联动"]);
    await browserAdapter.CopyModelFile(p, "/web/ysm/备份");
    // 新旧都存在（扫描 2 条）
    const entries = (await browserAdapter.ScanModelEntries("/web/ysm")) as Array<{ Path: string }>;
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.Path)).toEqual(
      expect.arrayContaining(["/web/ysm/狐狸/狐狸.ysm", "/web/ysm/备份/狐狸/狐狸.ysm"]),
    );
    // 源 key 保留 + 新 key 建立
    expect(idbMock._store.has("dir:ysm/狐狸:")).toBe(true);
    expect(idbMock._store.has("dir:ysm/备份/狐狸:")).toBe(true);
    expect(idbMock._store.has("file:ysm/狐狸/狐狸.ysm")).toBe(true);
    expect(idbMock._store.has("file:ysm/备份/狐狸/狐狸.ysm")).toBe(true);
    // 标记复制到新路径，源标记保留
    expect(idbMock._store.has("tags:/web/ysm/备份/狐狸/狐狸.ysm")).toBe(true);
    expect(idbMock._store.has("tags:/web/ysm/狐狸/狐狸.ysm")).toBe(true);
  });

  it("目标冲突：目标组已存在 → reject 且数据不动（对齐 Go「目标已存在」）", async () => {
    // 预置目标模型 作者A/狐狸（webkitRelativePath 直接建多段组，RenameDir 禁含 / 名）
    const fDst = new File([e6.encode("X")], "狐狸.ysm");
    Object.defineProperty(fDst, "webkitRelativePath", { value: "作者A/狐狸/狐狸.ysm" });
    await importWebFiles([fDst], "ysm");
    // 另建顶层 狐狸，移动到 作者A → 目标 作者A/狐狸 已存在
    await importWebFiles([new File([e6.encode("Y")], "狐狸.ysm")], "ysm");
    await expect(browserAdapter.MoveModelFile("/web/ysm/狐狸/狐狸.ysm", "/web/ysm/作者A")).rejects.toThrow("目标已存在");
    // 源不动、目标不动
    expect(idbMock._store.has("dir:ysm/狐狸:")).toBe(true);
    expect(idbMock._store.has("file:ysm/狐狸/狐狸.ysm")).toBe(true);
    expect(idbMock._store.has("dir:ysm/作者A/狐狸:")).toBe(true);
    expect((await browserAdapter.ScanModelEntries("/web/ysm")) as unknown[]).toHaveLength(2);
  });

  it("非法路径：src 非 /web/ 或 dstDir 非目录形态 → reject（模型不受影响）", async () => {
    await importWebFiles([new File([e6.encode("Y")], "狐狸.ysm")], "ysm");
    // src 非 /web/ 路径
    await expect(browserAdapter.MoveModelFile("/repo/ysm/狐狸/狐狸.ysm", "/web/ysm/作者A")).rejects.toThrow("无效源路径");
    // dstDir 缺目标名（/web/ysm 根）或非 /web/ 路径
    await expect(browserAdapter.MoveModelFile("/web/ysm/狐狸/狐狸.ysm", "/web/ysm")).rejects.toThrow("目标目录无效");
    await expect(browserAdapter.CopyModelFile("/web/ysm/狐狸/狐狸.ysm", "/repo/ysm/作者A")).rejects.toThrow("目标目录无效");
    // 源模型未被破坏
    expect((await browserAdapter.ScanModelEntries("/web/ysm")) as unknown[]).toHaveLength(1);
    expect(idbMock._store.has("file:ysm/狐狸/狐狸.ysm")).toBe(true);
  });

  it("自嵌套：目标位于源内 → reject（对齐 Go「目标目录不能位于源目录内」）", async () => {
    await importWebFiles([new File([e6.encode("Y")], "狐狸.ysm")], "ysm");
    // dstDir 名 = 源组名 → 目标 狐狸/狐狸 是源严格子目录
    await expect(browserAdapter.MoveModelFile("/web/ysm/狐狸/狐狸.ysm", "/web/ysm/狐狸")).rejects.toThrow("不能位于源目录内");
    // 多段组：dstDir 名 = 源父路径 → 目标 == 源（自身移动）→ 命中「目标已存在」
    // （对齐 Go：dst===src 时 stat(dst) 存在报「目标已存在」，非自嵌套——relToSrc 为 ".."）
    const fNested = new File([e6.encode("YSM")], "狐狸.ysm");
    Object.defineProperty(fNested, "webkitRelativePath", { value: "分类1/狐狸/狐狸.ysm" });
    await importWebFiles([fNested], "ysm");
    await expect(browserAdapter.MoveModelFile("/web/ysm/分类1/狐狸/狐狸.ysm", "/web/ysm/分类1")).rejects.toThrow(
      "目标已存在",
    );
    expect((await browserAdapter.ScanModelEntries("/web/ysm")) as unknown[]).toHaveLength(2);
    expect(idbMock._store.has("file:ysm/分类1/狐狸/狐狸.ysm")).toBe(true);
  });

  it("源不存在 → reject（对齐 Go os.Stat 源报错，拒绝静默 no-op）", async () => {
    await expect(browserAdapter.MoveModelFile("/web/ysm/不存在/不存在.ysm", "/web/ysm/作者A")).rejects.toThrow("模型不存在");
    await expect(browserAdapter.CopyModelFile("/web/ysm/不存在/不存在.ysm", "/web/ysm/作者A")).rejects.toThrow("模型不存在");
  });
});

