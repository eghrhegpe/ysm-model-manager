// @vitest-environment node
// ===== 树构建/扁平化纯函数测试（ADR-021 扩展）=====
// buildTree：排序（name/size/date）/ filterPaths 交集 / Windows 路径归一。
// flattenVisible：目录展开/折叠 / search 过滤 / 搜索自动展开 / 文件行 key 用 fullPath。
import { describe, it, expect, beforeEach } from "vitest";
import {
  buildTree,
  flattenVisible,
  getRenderMode,
  ROW_H_GRID_COMPACT,
  ROW_H_LIST_COMPACT,
  rowHeightGrid,
  rowHeightList,
  setRenderMode,
} from "./render.ts";
import { fileRowCommon, folderRowCommon } from "./row-common.ts";
import { RESOURCE_TYPES } from "@/utils/resource/types.ts";
import type { TreeEntry } from "./loader.ts";

function entry(
  name: string,
  path: string,
  size = 0,
  modTime = 0,
  fullPath?: string,
): TreeEntry {
  return {
    name,
    path,
    fullPath: fullPath || path,
    size,
    modTime,
    banned: false,
    type: "",
  };
}

function treeKeys(root: Record<string, unknown>): string[] {
  return Object.keys(root).sort();
}

describe("buildTree 排序", () => {
  // 断言统一走 flattenVisible 行序——treeKeys 的 Object.keys().sort() 自排序
  // 曾让三个排序用例对任何实现都通过（2026-09 排序比较器漏实现 size/date 被掩盖的真因）
  it("name 排序按字典序", () => {
    const root = buildTree(
      [entry("b.ysm", "b.ysm"), entry("a.ysm", "a.ysm"), entry("c.ysm", "c.ysm")],
      "name",
      null,
    );
    const rows = flattenVisible(root, "", "", "name", {}, 0, "grid");
    expect(rows.map((r) => r.key)).toEqual(["a.ysm", "b.ysm", "c.ysm"]);
  });

  it("size 排序降序（文件名字典序与期望相反，防断言空转）", () => {
    const root = buildTree(
      [entry("a.ysm", "a.ysm", 100), entry("b.ysm", "b.ysm", 9000)],
      "size",
      null,
    );
    const rows = flattenVisible(root, "", "", "size", {}, 0, "grid");
    expect(rows.map((r) => r.key)).toEqual(["b.ysm", "a.ysm"]);
  });

  it("date 排序降序（文件名字典序与期望相反）", () => {
    const root = buildTree(
      [entry("a.ysm", "a.ysm", 0, 100), entry("b.ysm", "b.ysm", 0, 900)],
      "date",
      null,
    );
    const rows = flattenVisible(root, "", "", "date", {}, 0, "grid");
    expect(rows.map((r) => r.key)).toEqual(["b.ysm", "a.ysm"]);
  });

  it("size 模式：目录仍按名称排且在文件前（目录无 size 语义，聚合归 Go）", () => {
    const root = buildTree(
      [
        entry("z.ysm", "z.ysm", 999999),
        entry("a.ysm", "a.ysm", 1),
        entry("m.txt", "mfolder/m.txt"),
      ],
      "size",
      null,
    );
    const rows = flattenVisible(root, "", "", "size", {}, 0, "grid");
    expect(rows.map((r) => r.key)).toEqual(["mfolder", "z.ysm", "a.ysm"]);
  });

  it("文件夹始终排在文件前（name 模式）", () => {
    const root = buildTree(
      [entry("z.ysm", "folder/z.ysm"), entry("a.ysm", "a.ysm")],
      "name",
      null,
    );
    const rows = flattenVisible(root, "", "", "name", {}, 0, "grid");
    expect(rows.map((r) => r.key)).toEqual(["folder", "a.ysm"]);
  });
});

describe("buildTree 过滤", () => {
  it("search 关键字过滤文件名", () => {
    const root = buildTree(
      [entry("hero.ysm", "hero.ysm"), entry("villain.ysm", "villain.ysm")],
      "name",
      null,
    );
    const rows = flattenVisible(root, "", "hero", "name", {}, 0, "grid");
    expect(rows.map((r) => r.key)).toEqual(["hero.ysm"]);
  });

  it("filterPaths 只保留集合内的 fullPath", () => {
    const root = buildTree(
      [entry("a.ysm", "a.ysm", 0, 0, "/repo/a.ysm"), entry("b.ysm", "b.ysm", 0, 0, "/repo/b.ysm")],
      "name",
      new Set(["/repo/b.ysm"]),
    );
    expect(treeKeys(root)).toEqual(["b.ysm"]);
  });

  it("Windows 分隔符路径归一为嵌套目录", () => {
    const root = buildTree([entry("a.ysm", "folder\\sub\\a.ysm")], "name", null);
    const folder = root["folder"];
    expect(folder).toBeDefined();
    expect(Object.keys(folder as Record<string, unknown>)).toEqual(["sub"]);
  });
});

describe("flattenVisible", () => {
  it("折叠的目录只输出文件夹行（不递归）", () => {
    const root = buildTree(
      [entry("a.ysm", "folder/a.ysm")],
      "name",
      null,
    );
    const rows = flattenVisible(root, "", "", "name", {}, 0, "grid");
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("folder");
    expect(rows[0].key).toBe("folder");
    expect(rows[0].isOpen).toBe(false);
  });

  it("展开的目录递归输出子文件行", () => {
    const root = buildTree(
      [entry("a.ysm", "folder/a.ysm"), entry("b.ysm", "folder/sub/b.ysm")],
      "name",
      null,
    );
    const rows = flattenVisible(root, "", "", "name", { "folder": true, "folder/sub": true }, 0, "grid");
    const types = rows.map((r) => r.type);
    expect(types).toEqual(["folder", "folder", "file", "file"]);
  });

  it("搜索时目录自动展开（shouldOpen = hasSearch || dirOpen）", () => {
    const root = buildTree(
      [entry("target.ysm", "folder/target.ysm", 0, 0, "/repo/folder/target.ysm")],
      "name",
      null,
    );
    const rows = flattenVisible(root, "", "target", "name", {}, 0, "grid");
    const fileRow = rows.find((r) => r.type === "file");
    expect(fileRow).toBeDefined();
    // 键空间 = 磁盘 fullPath（ADR-222）；path 参数只参与树形构建与搜索过滤
    expect(fileRow?.key).toBe("/repo/folder/target.ysm");
  });

  it("搜索命中目录名 → 保留子文件行（按路径过滤，不丢文件行）", () => {
    const root = buildTree(
      [entry("a.ysm", "hero/char/a.ysm", 0, 0, "/repo/hero/char/a.ysm"), entry("b.ysm", "other/b.ysm", 0, 0, "/repo/other/b.ysm")],
      "name",
      null,
    );
    const rows = flattenVisible(root, "", "hero", "name", {}, 0, "grid");
    const fileRows = rows.filter((r) => r.type === "file");
    expect(fileRows).toHaveLength(1);
    expect(fileRows[0].key).toBe("/repo/hero/char/a.ysm");
  });

  it("搜索带首尾空白 → trim 后仍能匹配（与 buildTree 一致）", () => {
    const root = buildTree([entry("a.ysm", "hero/a.ysm")], "name", null);
    const rows = flattenVisible(root, "", "  hero  ", "name", {}, 0, "grid");
    expect(rows.some((r) => r.type === "file")).toBe(true);
  });

  it("文件行 key 用 fullPath（选中匹配依据）", () => {
    const root = buildTree(
      [entry("a.ysm", "folder/a.ysm", 0, 0, "/repo/folder/a.ysm")],
      "name",
      null,
    );
    const rows = flattenVisible(root, "", "", "name", { "folder": true }, 0, "grid");
    const fileRow = rows.find((r) => r.type === "file");
    // fullPath（磁盘绝对路径）≠ path（相对资源根）时必须取 fullPath：
    // 选中态 selectState.keys / DOM data-fullpath 均为磁盘路径，键空间须同源
    // （原断言误写为相对路径 path，把键空间分裂固化成契约，见 ADR-222）
    expect(fileRow?.key).toBe("/repo/folder/a.ysm");
  });

  it("文件行 key 与 DOM data-fullpath 同源（fullPath 缺失时回落 path）", () => {
    const withFull = buildTree([entry("a.ysm", "a.ysm", 0, 0, "/repo/a.ysm")], "name", null);
    expect(flattenVisible(withFull, "", "", "name", {}, 0, "grid")[0].key).toBe("/repo/a.ysm");
    // fullPath 为空串 → 回落 path（与 row-common 的 fp 表达式一致）
    const noFull = buildTree([{ ...entry("b.ysm", "b.ysm"), fullPath: "" }], "name", null);
    expect(flattenVisible(noFull, "", "", "name", {}, 0, "grid")[0].key).toBe("b.ysm");
  });
});

describe("flattenVisible — 文件夹启禁用标记（P2b 短路判定）", () => {
  it("文件夹内全部启用 → 行 ck 为 on", () => {
    const root = buildTree(
      [entry("a.ysm", "folder/a.ysm"), entry("b.ysm", "folder/b.ysm")],
      "name",
      null,
    );
    const rows = flattenVisible(root, "", "", "name", {}, 0, "grid");
    const folderRow = rows.find((r) => r.type === "folder")!;
    expect(folderRow.html).toContain('class="ck on"');
  });

  it("文件夹内全部禁用 → 行 ck 无 on/partial 标记", () => {
    const root = buildTree(
      [
        { ...entry("a.ysm", "folder/a.ysm"), banned: true },
        { ...entry("b.ysm", "folder/b.ysm"), banned: true },
      ],
      "name",
      null,
    );
    const rows = flattenVisible(root, "", "", "name", {}, 0, "grid");
    const folderRow = rows.find((r) => r.type === "folder")!;
    expect(folderRow.html).toContain('class="ck"');
    expect(folderRow.html).not.toContain("ck on");
  });

  it("文件夹内启用/禁用混合 → 行 ck 为 on partial", () => {
    const root = buildTree(
      [
        entry("a.ysm", "folder/a.ysm"),
        { ...entry("b.ysm", "folder/b.ysm"), banned: true },
      ],
      "name",
      null,
    );
    const rows = flattenVisible(root, "", "", "name", {}, 0, "grid");
    const folderRow = rows.find((r) => r.type === "folder")!;
    expect(folderRow.html).toContain('class="ck on partial"');
  });

  it("深层嵌套：禁用条目埋在子目录 → 顶层文件夹判定正确", () => {
    const root = buildTree(
      [{ ...entry("deep.ysm", "top/mid/deep.ysm"), banned: true }],
      "name",
      null,
    );
    const rows = flattenVisible(root, "", "", "name", {}, 0, "grid");
    const top = rows.find((r) => r.type === "folder" && r.key === "top")!;
    // top 下只有禁用条目：hasEnabled=false（无 on），hasDisabled=true
    expect(top.html).not.toContain("ck on");
  });

  it("深层嵌套：启用条目埋在子目录 → 顶层文件夹判定正确", () => {
    const root = buildTree(
      [{ ...entry("ok.ysm", "top/mid/ok.ysm"), banned: false }],
      "name",
      null,
    );
    const rows = flattenVisible(root, "", "", "name", {}, 0, "grid");
    const top = rows.find((r) => r.type === "folder" && r.key === "top")!;
    expect(top.html).toContain('class="ck on"');
  });

  it("深链（1000 级）：全禁用条目埋在底端 → 顶层与中层判定正确", () => {
    const depth = 1000;
    const path = Array.from({ length: depth }, (_, i) => `d${i}`).join("/") + "/deep.ysm";
    const root = buildTree([{ ...entry("deep.ysm", path), banned: true }], "name", null);
    // 默认不展开 → 顶层 d0 可见；展开到 d500 让中层也进入渲染窗口
    const dirOpen: Record<string, boolean> = {};
    const acc: string[] = [];
    for (let i = 0; i <= 500; i++) {
      acc.push(`d${i}`);
      dirOpen[acc.join("/")] = true;
    }
    const rows = flattenVisible(root, "", "", "name", dirOpen, 0, "grid");
    // 顶层 d0 下只有禁用条目 → 无 on 标记
    const top = rows.find((r) => r.type === "folder" && r.key === "d0")!;
    expect(top).toBeDefined();
    expect(top.html).not.toContain("ck on");
    // 中层 d500 同样只有禁用后代（dirFlags 自底向上合并的中间层正确性）；
    // row.key 为完整路径 d0/d1/.../d500
    const midKey = Array.from({ length: 501 }, (_, i) => `d${i}`).join("/");
    const mid = rows.find((r) => r.type === "folder" && r.key === midKey)!;
    expect(mid).toBeDefined();
    expect(mid.html).not.toContain("ck on");
  });
});

describe("annotateDirNodes — O(n²) 回归绊线（深链全启用无早退）", () => {
  it(
    "10000 级深链 buildTree 应在 1s 内完成（旧实现 O(n²) 需 ~3s+，见审计基准）",
    () => {
      const depth = 10000;
      const path = Array.from({ length: depth }, (_, i) => `d${i}`).join("/") + "/f.ysm";
      const t0 = performance.now();
      const root = buildTree([entry("f.ysm", path)], "name", null);
      const elapsed = performance.now() - t0;
      expect(root).toBeDefined();
      // O(n) 后序合并应亚毫秒级；O(n²) 重扫子树在 10000 级深链实测 ~2.9s。
      // 阈值留 20 倍余量防 CI 抖动，旧实现必然超时（绊线生效）。
      expect(elapsed).toBeLessThan(1000);
    },
    15000,
  );
});

// ===== R3 验收：web 多段组（P-A IDB 路径化）→ 子目录树可展开 =====
// scanWebModels 对多段组名返回 Path=/web/<type>/<name>/<mainRel>（name 含 /），
// loader 剪掉 /web/<type> 得到多段 relPath（分类1/狐狸/狐狸.ysm），buildTree 按段
// 建嵌套节点、flattenVisible 递归展开——本组用例锁定「树视图子目录可展开」闭环。
describe("R3 子目录展开（web 多段组形态）", () => {
  // 模拟 loader 对 web entry 的 relPath 计算结果（多段组名 + 组内主文件）
  function webEntry(mainRel: string, grpPath: string): TreeEntry {
    const rel = grpPath.replace(/^\//, "");
    return entry(mainRel, `${rel}/${mainRel}`, 10, 1, `${grpPath}/${mainRel}`);
  }

  it("多段组名 → 折叠时只出顶层文件夹行", () => {
    const root = buildTree(
      [webEntry("狐狸.ysm", "/分类1/狐狸"), webEntry("猫咪.ysm", "/分类1/猫咪")],
      "name",
      null,
    );
    expect(treeKeys(root)).toEqual(["分类1"]);
    const rows = flattenVisible(root, "", "", "name", {}, 0, "grid");
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("folder");
    expect(rows[0].key).toBe("分类1");
    expect(rows[0].isOpen).toBe(false);
  });

  it("逐层展开 → 子目录与文件行按深度递归出现", () => {
    const root = buildTree(
      [webEntry("狐狸.ysm", "/分类1/狐狸"), webEntry("猫咪.ysm", "/分类1/猫咪")],
      "name",
      null,
    );
    const rows = flattenVisible(
      root,
      "",
      "",
      "name",
      { "分类1": true, "分类1/狐狸": true, "分类1/猫咪": true },
      0,
      "grid",
    );
    const keys = rows.map((r) => r.key);
    expect(rows[0]).toMatchObject({ type: "folder", key: "分类1", depth: 0 });
    // 两个模型组文件夹（depth 1）各自展开出主文件行（depth 2）
    expect(rows.filter((r) => r.type === "folder")).toHaveLength(3);
    expect(keys).toContain("分类1");
    expect(keys).toContain("分类1/狐狸");
    expect(keys).toContain("分类1/猫咪");
    // 文件行 key = 磁盘 fullPath（与 DOM data-fullpath / selectState.keys 同源，ADR-222）；
    // folder 行仍用树内拼接路径（仅服务 dirOpen 展开态，自洽子系统）。
    // 原注释「路径段拼接，对齐树导航依据」不成立：file 行 key 无任何树导航消费方，
    // 其全部消费点都是「由 DOM/选中态回查行」（重命名定位 / 范围选择 / 键盘高亮）。
    expect(keys).toContain("/分类1/狐狸/狐狸.ysm");
    expect(keys).toContain("/分类1/猫咪/猫咪.ysm");
    const fileRows = rows.filter((r) => r.type === "file");
    expect(fileRows.every((r) => r.depth === 2)).toBe(true);
  });

  it("组名含多段 + 组内子目录文件 → 更深层级正确展开（桌面 WalkDir 同构）", () => {
    const root = buildTree(
      [webEntry("狐狸.ysm", "/分类1/狐狸"), webEntry("main.json", "/分类1/狐狸")],
      "name",
      null,
    );
    const rows = flattenVisible(
      root,
      "",
      "",
      "name",
      { "分类1": true, "分类1/狐狸": true },
      0,
      "grid",
    );
    const fileRows = rows.filter((r) => r.type === "file");
    expect(fileRows).toHaveLength(2);
    // 文件行 key = 磁盘 fullPath（webEntry 的 fullPath 带前导 /，与 path 有别）；顺序不敏感
    expect(fileRows.map((r) => r.key)).toEqual(
      expect.arrayContaining(["/分类1/狐狸/狐狸.ysm", "/分类1/狐狸/main.json"]),
    );
  });
});

describe("getRenderMode / setRenderMode（node 环境无 localStorage 的降级路径）", () => {
  beforeEach(() => {
    // test-setup 在 node 环境注入内存 localStorage 兜底；isolate:false 共享
    // globalThis 下其他文件写入的 "ysm-render-mode" 会残留 → getRenderMode 读错值。
    // 每个用例前清掉该 key，恢复「存储空」的降级语义。
    try {
      localStorage.removeItem("ysm-render-mode");
    } catch {
      /* 无 localStorage：正合降级语义 */
    }
  });

  it("getRenderMode 在存储不可用时降级为 grid", () => {
    expect(getRenderMode()).toBe("grid");
  });

  it("setRenderMode 在存储不可用时静默降级（不抛错）", () => {
    expect(() => setRenderMode("list")).not.toThrow();
  });
});

describe("行高随卡片密度驱动（rowHeightGrid / rowHeightList）", () => {
  beforeEach(() => {
    localStorage.removeItem("ui-card-density");
  });

  it("未设置密度 → 回落 compact（grid 28 / list 24，与 CSS 默认同值）", () => {
    expect(rowHeightGrid()).toBe(28);
    expect(rowHeightList()).toBe(24);
  });

  it("normal → grid 32 / list 28", () => {
    localStorage.setItem("ui-card-density", "normal");
    expect(rowHeightGrid()).toBe(32);
    expect(rowHeightList()).toBe(28);
  });

  it("显式 compact / 非法值 → 均回落 compact（防脏值撑错行高）", () => {
    localStorage.setItem("ui-card-density", "compact");
    expect(rowHeightGrid()).toBe(28);
    localStorage.setItem("ui-card-density", "spacious");
    expect(rowHeightGrid()).toBe(28);
    expect(rowHeightList()).toBe(24);
  });
});

describe("行高单一事实源：CSS 兜底与 JS 常量不漂移", () => {
  // CSS 的 var(--tree-row-*, <兜底值>) 与 variables.css 的 :root 默认值是手写字面量，
  // 若只改 ROW_H_* 常量（JS 与注入变量会一起动）而漏改兜底，则 applyUIPrefs 未跑时
  // （隐私模式 localStorage 被禁 → 回落 compact）CSS 高度 ≠ JS 假定高度 → 虚拟滚动错位。
  // 本用例把「JS 常量 == CSS 字面量」钉死，消除这一处唯一残留的漂移面。
  const compactGrid = 28;
  const compactList = 24;

  it("compact 档 JS 常量等于 CSS 兜底默认值", () => {
    expect(ROW_H_GRID_COMPACT).toBe(compactGrid);
    expect(ROW_H_LIST_COMPACT).toBe(compactList);
  });

  it("app-tree-styles 的 var 兜底值与 compact 常量一致", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(new URL("./app-tree-styles.ts", import.meta.url), "utf8");
    // 兜底形如 var(--tree-row-grid, 28px)
    expect(css).toContain(`var(--tree-row-grid, ${ROW_H_GRID_COMPACT}px)`);
    expect(css).toContain(`var(--tree-row-list, ${ROW_H_LIST_COMPACT}px)`);
  });

  it("variables.css 的 :root 默认值与 compact 常量一致", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(new URL("../../../css/variables.css", import.meta.url), "utf8");
    expect(css).toContain(`--tree-row-grid: ${ROW_H_GRID_COMPACT}px;`);
    expect(css).toContain(`--tree-row-list: ${ROW_H_LIST_COMPACT}px;`);
  });
});

describe("row-common 公共行计算", () => {
  it("fileRowCommon：banned / 类型图标 / 缩进 / fullPath 兜底", () => {
    const normal = fileRowCommon(
      { path: "a.ysm", fullPath: "/r/a.ysm", banned: false, name: "a", size: 1, modTime: 0, type: RESOURCE_TYPES.YSM },
      "icon",
      null,
    );
    expect(normal.checked).toBe(" on");
    expect(normal.ban).toBe("");
    expect(normal.typeIcon).toBe("💎");
    expect(normal.pad).toBe("");

    const banned = fileRowCommon(
      { path: "b.ysm", fullPath: "/r/b.ysm", banned: true, name: "b", size: 1, modTime: 0, type: RESOURCE_TYPES.PACK },
      "icon",
      20,
    );
    expect(banned.checked).toBe("");
    expect(banned.ban).toBe(" ban");
    expect(banned.typeIcon).toBe("🎨");
    expect(banned.pad).toContain("20px");

    const noFullPath = fileRowCommon(
      { path: "c.ysm", fullPath: "", banned: false, name: "c", size: 1, modTime: 0, type: "other" },
      "icon",
      null,
    );
    expect(noFullPath.fp).toContain("c.ysm");
  });

  it("folderRowCommon：锁定 / 展开 / 部分选中 / 缩进", () => {
    const open = folderRowCommon("dir", "dir", true, false, true, false, 10);
    expect(open.fi).toBe("📁");
    expect(open.ar).toBe("▾");
    expect(open.ac).toBe(" open");
    expect(open.ckCls).toBe(" on");
    expect(open.pad).toContain("10px");

    const locked = folderRowCommon("dir", "dir", false, true, false, false, null);
    expect(locked.fi).toBe("🔒");
    expect(locked.lk).toBe(" locked");
    expect(locked.ar).toBe("▸");
    expect(locked.ckCls).toBe("");

    const partial = folderRowCommon("dir", "dir", false, false, true, true, null);
    expect(partial.ckCls).toBe(" on partial");
  });
});

describe("flattenVisible — 深链 + 搜索态栈溢出回归绊线（P2 修复）", () => {
  // 原递归实现：搜索态 shouldOpen 无条件 true → 全目录展开 → 递归深度 = 树深，
  // 10000 级深链直接 Maximum call stack size exceeded（annotateDirNodes 已改显式栈，
  // flattenVisible 曾漏网）。现改显式栈迭代，深链 + 搜索应正常完成且行序保前序。
  it(
    "10000 级深链 + 搜索命中 → 不抛栈溢出，行序为深度优先前序",
    () => {
      const depth = 10000;
      const path = Array.from({ length: depth }, (_, i) => `d${i}`).join("/") + "/f.ysm";
      const root = buildTree([entry("f.ysm", path, 0, 0, "/repo/" + path)], "name", null);
      expect(root).toBeDefined();
      // 搜索命中 → 所有目录 shouldOpen=true → 全量展开（旧实现递归到栈溢出）
      const rows = flattenVisible(root, "", "f.ysm", "name", {}, 0, "grid");
      expect(rows.length).toBeGreaterThan(depth); // 每个目录行 + 叶子文件行
      // 首行应为最深层目录的前序——校验行序保前序：第 1 行是最浅层目录
      expect(rows[0]).toMatchObject({ type: "folder", key: "d0", depth: 0 });
      // 末行为叶子文件（深度 = 树深）；key 取磁盘 fullPath 而非树内拼接路径（ADR-222）
      const last = rows[rows.length - 1];
      expect(last.type).toBe("file");
      expect(last.key).toBe("/repo/" + path);
    },
    15000,
  );
});
