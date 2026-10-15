// @vitest-environment node
// ===== 树构建/扁平化纯函数测试（ADR-021 扩展）=====
// buildTree：排序（name/size/date）/ filterPaths 交集 / Windows 路径归一。
// flattenVisible：目录展开/折叠 / search 过滤 / 搜索自动展开 / 文件行 key 用 fullPath。
import { describe, it, expect, beforeEach } from "vitest";
import {
  buildTree,
  emptyStateForEmptyEntries,
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

  it("filterPaths 匹配 fullPath 空时回落 path（对齐 tag-editor 写入的 modelPath）", () => {
    // 锐评 2026-10-09：tag-editor 的 modelPath = ctx:show path = `fullPath || path`（ADR-222），
    // 白名单可能含相对 path。原 `filterPaths.has(e.fullPath)` 对 fullPath 空条目永不命中
    // → 标签筛选静默失效。现统一 entryKey(e) = fullPath || path。entry() helper :30 已把
    // fullPath 空回落 path，故此处绕过它直构，才能造出 fullPath 真空的条目。
    const bare: TreeEntry = {
      name: "a.ysm",
      path: "sub/a.ysm",
      fullPath: "",
      size: 0,
      modTime: 0,
      banned: false,
      type: "",
    };
    const root = buildTree([bare], "name", new Set(["sub/a.ysm"]));
    // 命中 → 构建出 sub 节点；旧实现（has("")）→ 空树
    expect(treeKeys(root)).toEqual(["sub"]);
  });

  it("Windows 分隔符路径归一为嵌套目录", () => {
    const root = buildTree([entry("a.ysm", "folder\\sub\\a.ysm")], "name", null);
    const folder = root["folder"];
    expect(folder).toBeDefined();
    expect(Object.keys(folder as Record<string, unknown>)).toEqual(["sub"]);
  });
});

describe("flattenVisible", () => {
  // 锐评性能 #5 后续（2026-10-14）：虚拟滚动只渲染可见窗口，但 eager 实现为全部行拼 HTML
  // ——搜索击键一次 O(n) 次模板拼接（n 万级仓库 = 每次击键拼几万个字符串，DOM 里只进 ~30 行）。
  // html 改惰性 getter（memoize-once）：字段名与字符串语义不变，25 处既有 .html 断言零改动。
  it("html 是惰性 getter：flattenVisible 阶段不构造模板字符串（虚拟滚动关键路径）", () => {
    const root = buildTree(
      [entry("a.ysm", "a.ysm"), entry("b.ysm", "b.ysm"), entry("c.ysm", "c.ysm")],
      "name",
      null,
    );
    const rows = flattenVisible(root, "", "", "name", {}, 0, "grid");
    expect(rows).toHaveLength(3);
    // 全部行都带 getter（不是 data 属性 eager 值）
    for (const r of rows) {
      const d = Object.getOwnPropertyDescriptor(r, "html");
      expect(typeof d?.get).toBe("function");
      // 惰性：getter 存在但尚未求值（无 value）
      expect(d?.value).toBeUndefined();
    }
  });

  it("惰性 getter 语义等价：首次读取构造、重复读取记忆化（同一字符串）", () => {
    const root = buildTree([entry("a.ysm", "a.ysm")], "name", null);
    const rows = flattenVisible(root, "", "", "name", {}, 0, "grid");
    const first = rows[0].html;
    expect(first).toContain("a");
    expect(rows[0].html).toBe(first); // 重复读同值（memoize-once）
    // 数据仍完整可读（惰性不等于丢字段）
    expect(first).toContain('data-testid="tree-file"');
    expect(first).toContain('aria-selected="false"');
  });

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

  // 锐评 2026-10-15 P1-B：搜索态原先「所有目录行无条件入列」，于是
  // ① 大仓库搜索被上百个空的作者文件夹淹掉；② 一个都没搜到时 rows 仍非空，
  // renderTree 的 `!rows.length` 分支走不到 → guide/repository.md 承诺的
  // 「无结果时显示未找到匹配的文件」在含子目录的仓库里等于失效。
  it("搜索态剪枝：只保留含命中后代的目录行（空目录不占屏）", () => {
    const root = buildTree(
      [
        entry("hit.ysm", "[作者A]/hit.ysm", 0, 0, "/repo/[作者A]/hit.ysm"),
        entry("miss.ysm", "[作者B]/miss.ysm", 0, 0, "/repo/[作者B]/miss.ysm"),
        entry("deep.ysm", "[作者B]/sub/deep.ysm", 0, 0, "/repo/[作者B]/sub/deep.ysm"),
      ],
      "name",
      null,
    );
    const rows = flattenVisible(root, "", "hit", "name", {}, 0, "grid");
    expect(rows.filter((r) => r.type === "folder").map((r) => r.key)).toEqual(["[作者A]"]);
    expect(rows.filter((r) => r.type === "file").map((r) => r.key)).toEqual(["/repo/[作者A]/hit.ysm"]);
  });

  it("搜索态剪枝：命中深层文件 → 祖先目录链全部保留、无关兄弟目录剪掉", () => {
    const root = buildTree(
      [
        entry("deep.ysm", "[作者B]/sub/deep.ysm", 0, 0, "/repo/[作者B]/sub/deep.ysm"),
        entry("other.ysm", "[作者C]/other.ysm", 0, 0, "/repo/[作者C]/other.ysm"),
      ],
      "name",
      null,
    );
    const rows = flattenVisible(root, "", "deep", "name", {}, 0, "grid");
    expect(rows.filter((r) => r.type === "folder").map((r) => r.key)).toEqual([
      "[作者B]",
      "[作者B]/sub",
    ]);
  });

  it("搜索一个都不命中 → rows 为空（空态分支可达：未找到匹配的文件）", () => {
    const root = buildTree(
      [entry("a.ysm", "[作者A]/a.ysm", 0, 0, "/repo/[作者A]/a.ysm")],
      "name",
      null,
    );
    expect(flattenVisible(root, "", "不存在的名字", "name", {}, 0, "grid")).toEqual([]);
  });

  it("搜索态目录行恒报已展开（aria-expanded 不得与可见子行相悖）", () => {
    const root = buildTree(
      [entry("hit.ysm", "[作者A]/hit.ysm", 0, 0, "/repo/[作者A]/hit.ysm")],
      "name",
      null,
    );
    // dirOpen 空（磁盘上该目录是收起的）——搜索态子行仍然可见，行态必须同步为已展开
    const rows = flattenVisible(root, "", "hit", "name", {}, 0, "grid");
    const folder = rows.find((r) => r.type === "folder");
    expect(folder?.isOpen).toBe(true);
    expect(folder?.html).toContain('aria-expanded="true"');
  });

  it("非搜索态不受剪枝影响（收起目录仍出行、行态仍读磁盘展开态）", () => {
    const root = buildTree(
      [
        entry("a.ysm", "[作者A]/a.ysm", 0, 0, "/repo/[作者A]/a.ysm"),
        entry("b.ysm", "[作者B]/b.ysm", 0, 0, "/repo/[作者B]/b.ysm"),
      ],
      "name",
      null,
    );
    const rows = flattenVisible(root, "", "", "name", {}, 0, "grid");
    // 两个目录都收起：目录行都在（原语义），文件行都不在
    expect(rows.map((r) => r.type)).toEqual(["folder", "folder"]);
    expect(rows.every((r) => r.isOpen === false)).toBe(true);
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

// ===== 行选中态随数据渲染（2026-10-13 P0-1 接线）=====
// 历史：f4d590e12「消除未使用参数」误删 selCls 计算 → rowCls 恒 ""，.fl.selected CSS
// 零生产者、aria-selected 恒 false（鼠标选中无视觉反馈）；唯键盘导航手写 classList
// 补丁（_onKeyArrowNav）双轨存活。修复 = 选中态回归数据渲染唯一出口，本组断言即回归锁：
// 再有人「消除参数」删掉 selected 通道，这里必红。
describe("行选中态随数据渲染（rowCls / aria-selected）", () => {
  it("selectedKeys 含行键 → grid 行含 selected 类且 aria-selected=true", () => {
    const root = buildTree(
      [entry("a.ysm", "a.ysm", 0, 0, "/repo/a.ysm"), entry("b.ysm", "b.ysm", 0, 0, "/repo/b.ysm")],
      "name",
      null,
    );
    const rows = flattenVisible(root, "", "", "name", {}, 0, "grid", new Set(["/repo/a.ysm"]));
    const sel = rows.find((r) => r.type === "file" && r.key === "/repo/a.ysm")!;
    expect(sel.html).toContain('class="fl selected"');
    expect(sel.html).toContain('aria-selected="true"');
    const unsel = rows.find((r) => r.type === "file" && r.key === "/repo/b.ysm")!;
    expect(unsel.html).not.toContain('class="fl selected"');
    expect(unsel.html).toContain('aria-selected="false"');
  });

  it("list 模式同样生效（fl-list selected）", () => {
    const root = buildTree([entry("a.ysm", "a.ysm", 0, 0, "/repo/a.ysm")], "name", null);
    const rows = flattenVisible(root, "", "", "name", {}, 0, "list", new Set(["/repo/a.ysm"]));
    expect(rows.find((r) => r.type === "file")!.html).toContain('class="fl-list selected"');
  });

  it("selectedKeys 缺省 / 空集 → 全行无 selected 类（aria-selected=false，两形态都防误报）", () => {
    const root = buildTree([entry("a.ysm", "a.ysm", 0, 0, "/repo/a.ysm")], "name", null);
    const rowsNoArg = flattenVisible(root, "", "", "name", {}, 0, "grid");
    expect(rowsNoArg[0].html).toContain('class="fl"');
    expect(rowsNoArg[0].html).not.toContain('class="fl selected"');
    expect(rowsNoArg[0].html).toContain('aria-selected="false"');
    const rowsEmpty = flattenVisible(root, "", "", "name", {}, 0, "grid", new Set());
    expect(rowsEmpty[0].html).not.toContain('class="fl selected"');
  });

  it("选中键空间 = entryKey（fullPath 优先）——Set 存磁盘路径命中", () => {
    // path（相对）与 fullPath（磁盘）不同的条目：selectedKeys 按 selectState 同源口径存 fullPath
    const root = buildTree([entry("a.ysm", "folder/a.ysm", 0, 0, "/repo/folder/a.ysm")], "name", null);
    const rows = flattenVisible(
      root,
      "",
      "",
      "name",
      { folder: true },
      0,
      "grid",
      new Set(["/repo/folder/a.ysm"]),
    );
    expect(rows.find((r) => r.type === "file")!.html).toContain('class="fl selected"');
  });

  // ===== dragging 拖源行降透明（ADR-336 视觉三态之三，2026-10-13 补齐）=====
  it("draggingKeys 命中行 → fl dragging 类（拖源降透明视觉态）", () => {
    const root = buildTree(
      [entry("a.ysm", "a.ysm", 0, 0, "/repo/a.ysm"), entry("b.ysm", "b.ysm", 0, 0, "/repo/b.ysm")],
      "name",
      null,
    );
    const rows = flattenVisible(root, "", "", "name", {}, 0, "grid", undefined, new Set(["/repo/a.ysm"]));
    const drag = rows.find((r) => r.type === "file" && r.key === "/repo/a.ysm")!;
    expect(drag.html).toContain('class="fl dragging"');
    const still = rows.find((r) => r.type === "file" && r.key === "/repo/b.ysm")!;
    expect(still.html).not.toContain("dragging");
  });

  it("draggingKeys 缺省 → 全行无 dragging（向后兼容，既有调用零改动）", () => {
    const root = buildTree([entry("a.ysm", "a.ysm", 0, 0, "/repo/a.ysm")], "name", null);
    const rows = flattenVisible(root, "", "", "name", {}, 0, "grid");
    expect(rows[0].html).not.toContain("dragging");
  });

  it("selected 与 dragging 并存 → 两类同挂（多选拖拽时锚行既选中又在拖）", () => {
    const root = buildTree([entry("a.ysm", "a.ysm", 0, 0, "/repo/a.ysm")], "name", null);
    const rows = flattenVisible(
      root,
      "",
      "",
      "name",
      {},
      0,
      "grid",
      new Set(["/repo/a.ysm"]),
      new Set(["/repo/a.ysm"]),
    );
    expect(rows[0].html).toContain('class="fl selected dragging"');
  });
});

// ===== 搜索态命中高亮（hl <mark>，2026-10-13 P0-2 恢复接线）=====
// 用户指南 repository.md「匹配字符高亮」+ 知识卡 utils-display.md「搜索态走 hl()」
// 的承诺在此锁定：搜索态命中段包 <mark>，非搜索态走 renderDisplayName 无 mark。
describe("搜索态命中高亮（hl <mark>）", () => {
  it("搜索态文件名命中段包 <mark>", () => {
    const root = buildTree([entry("hero.ysm", "hero.ysm")], "name", null);
    const rows = flattenVisible(root, "", "hero", "name", {}, 0, "grid");
    const file = rows.find((r) => r.type === "file")!;
    expect(file.html).toContain("<mark>hero</mark>");
  });

  it("非搜索态走 renderDisplayName，无 mark", () => {
    const root = buildTree([entry("hero.ysm", "hero.ysm")], "name", null);
    const rows = flattenVisible(root, "", "", "name", {}, 0, "grid");
    const file = rows.find((r) => r.type === "file")!;
    expect(file.html).not.toContain("<mark>");
  });

  it("list 模式搜索态同样高亮", () => {
    const root = buildTree([entry("hero.ysm", "hero.ysm")], "name", null);
    const rows = flattenVisible(root, "", "hero", "name", {}, 0, "list");
    const file = rows.find((r) => r.type === "file")!;
    expect(file.html).toContain("<mark>hero</mark>");
  });
});

// ===== 加载失败与空目录的空态区分（2026-10-13 P2）=====
// _load 失败曾静默降级为「暂无模型文件」空态——用户侧无法区分「目录真空」与「扫描出错」，
// 排障只能看日志。emptyStateForEmptyEntries 纯函数按 loadFailed 分叉空态文案；
// 抽纯函数的立因 = render.test.ts 是 node 环境（@vitest-environment node），
// renderTree 的空态分支（container.innerHTML）在此不可触达。
describe("加载失败空态区分（emptyStateForEmptyEntries）", () => {
  it("loadFailed=true → 加载失败文案（warning 图标语义名）", () => {
    const html = emptyStateForEmptyEntries(true);
    expect(html).toContain("加载失败");
    expect(html).not.toContain("暂无模型文件");
  });

  it("loadFailed=false → 暂无模型文件（真空目录语义不变）", () => {
    const html = emptyStateForEmptyEntries(false);
    expect(html).toContain("暂无模型文件");
    expect(html).not.toContain("加载失败");
  });

  it("失败态图标走 warning 语义名（resolveIcon 产物 SVG，非裸 emoji）", () => {
    expect(emptyStateForEmptyEntries(true)).toContain("ws-icon");
  });
});

// ===== ADR-334：buildTree 键与继承属性同名 → 全局原型污染 + 子树不显示 =====
// 键来自磁盘目录名/文件名（无净化）。普通对象的 `current["__proto__"]` 读到继承的
// Object.prototype（truthy）→ 跳过建节点并把整棵子树写进全局原型：① Object.prototype
// 被污染（全进程）② 该目录及子树在 UI 完全不显示（Object.keys(root) 恒不含它）。
// 修法 = 建节点用 Object.create(null)，此类键退化为普通字符串键。
// 另附 dirOpen 侧同名读缺陷（`dirOpen["__proto__"]` 读到原型 → 目录永不可折叠）。
//
// ⚠️ 测试自身的坑：dirOpen 必须用 `Object.fromEntries` / `Object.create(null)` 构造，
// 对象字面量 `{ __proto__: true }` 会设置**原型**而非 own key，测的就不是产品行为了。
function dirOpenOf(pairs: Array<[string, boolean]>): Record<string, boolean> {
  return Object.fromEntries(pairs);
}

describe("buildTree 键与 Object.prototype 同名（ADR-334）", () => {
  // 捕获「写进了 Object.prototype」——污染后任意新对象都能读到该键
  function protoPollutedKeys(): string[] {
    return Object.keys(Object.prototype);
  }

  it("__proto__ 目录及其子树可见（不被原型链吞掉）", () => {
    const before = protoPollutedKeys();
    const root = buildTree(
      [
        entry("a.ysm", "__proto__/a.ysm"),
        entry("b.ysm", "__proto__/deep/nested/b.ysm"),
        entry("ok.ysm", "models/ok.ysm"),
      ],
      "name",
      null,
    );
    expect(treeKeys(root)).toContain("__proto__");
    expect(treeKeys(root)).toContain("models");
    // 展开后子项必须递归可见（子树完整，非只剩壳）
    const rows = flattenVisible(
      root,
      "",
      "",
      "name",
      dirOpenOf([
        ["__proto__", true],
        ["__proto__/deep", true],
        ["__proto__/deep/nested", true],
        ["models", true],
      ]),
      0,
      "grid",
    );
    const keys = rows.map((r) => r.key);
    expect(keys).toContain("__proto__");
    // 文件行 key 走 entryKey（磁盘路径，ADR-222 选中态同源），非树内拼接路径
    expect(keys).toContain("__proto__/deep/nested/b.ysm");
    expect(keys).toContain("models/ok.ysm");
    expect(protoPollutedKeys()).toEqual(before);
  });

  it("名为 __proto__ 的文件（叶子位）同样安全", () => {
    const before = protoPollutedKeys();
    const root = buildTree([entry("__proto__", "__proto__")], "name", null);
    expect(treeKeys(root)).toContain("__proto__");
    expect(protoPollutedKeys()).toEqual(before);
  });

  it("constructor / toString 等继承键目录照常建树", () => {
    const before = protoPollutedKeys();
    const root = buildTree(
      [
        entry("a.ysm", "constructor/a.ysm"),
        entry("b.ysm", "toString/b.ysm"),
        entry("c.ysm", "hasOwnProperty/c.ysm"),
      ],
      "name",
      null,
    );
    for (const k of ["constructor", "toString", "hasOwnProperty"]) {
      expect(treeKeys(root), `${k} 目录应建出`).toContain(k);
    }
    const rows = flattenVisible(
      root,
      "",
      "",
      "name",
      dirOpenOf([
        ["constructor", true],
        ["toString", true],
        ["hasOwnProperty", true],
      ]),
      0,
      "grid",
    );
    expect(rows.map((r) => r.key)).toContain("constructor/a.ysm");
    expect(protoPollutedKeys()).toEqual(before);
  });

  it("目录行展开态：__proto__ 目录不被恒判为已展开（dirOpen 原型读缺陷）", () => {
    const root = buildTree([entry("a.ysm", "__proto__/a.ysm")], "name", null);
    // 空 dirOpen → __proto__ 目录必须是「未展开」，且不递归出子行
    const rows = flattenVisible(root, "", "", "name", {}, 0, "grid");
    const dirRow = rows.find((r) => r.type === "folder")!;
    expect(dirRow.isOpen).toBe(false);
    expect(rows).toHaveLength(1);
  });
});
