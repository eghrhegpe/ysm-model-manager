// ===== move-dnd 纯逻辑测试（node 环境——分流判定/自反过滤/乐观重算不碰 DOM）=====
// ADR-336 树内拖拽移动：拖源 types 标记（x-ysm-tree-move）与 Files 导入互斥；
// 自反过滤（拖进自己所在目录 = no-op）；乐观更新的 path/fullPath 本地重算。
// DOM 交互（dragstart/dragover/drop 委托）归 e2e dnd.spec（jsdom 无 DragEvent）。
import { describe, expect, it } from "vitest";
import {
  TREE_MOVE_MIME,
  type TreeMovePayload,
  computeMovedEntry,
  filterSelfReflection,
  isTreeMoveDrag,
  parseTreeMovePayload,
} from "./move-dnd.ts";
import type { TreeEntry } from "@/views/app-tree/loader.ts";

function entry(path: string, fullPath: string): TreeEntry {
  return { name: path.split("/").pop() || path, path, fullPath, size: 1, modTime: 0, banned: false, type: "ysm" };
}

describe("isTreeMoveDrag — 双通道分流判据", () => {
  it("types 含 x-ysm-tree-move → true（应用内拖源）", () => {
    expect(isTreeMoveDrag([TREE_MOVE_MIME])).toBe(true);
  });

  it("types 仅 Files → false（OS 导入，互斥不混流）", () => {
    expect(isTreeMoveDrag(["Files"])).toBe(false);
  });

  it("types 空 / undefined → false（防御）", () => {
    expect(isTreeMoveDrag([])).toBe(false);
    expect(isTreeMoveDrag(undefined)).toBe(false);
  });

  it("前缀相近的自定义 type 不误判（判据 = 精确匹配非 startsWith）", () => {
    expect(isTreeMoveDrag(["application/x-ysm-tree-move-v2"])).toBe(false);
  });
});

describe("parseTreeMovePayload — 载荷往返与防伪", () => {
  const payload: TreeMovePayload = { paths: ["/repo/a.ysm", "/repo/b.ysm"], anchor: "/repo/a.ysm" };

  it("JSON 往返一致", () => {
    expect(parseTreeMovePayload(JSON.stringify(payload))).toEqual(payload);
  });

  it("非法 JSON → null（防 DOM 拖入伪造串）", () => {
    expect(parseTreeMovePayload("not-json{")).toBeNull();
  });

  it("paths 非数组 / anchor 非串 → null（形状校验 fail-closed）", () => {
    expect(parseTreeMovePayload(JSON.stringify({ paths: "x", anchor: 1 }))).toBeNull();
    expect(parseTreeMovePayload(JSON.stringify({ anchor: "/a" }))).toBeNull();
  });

  it("空 paths → null（无可移动项）", () => {
    expect(parseTreeMovePayload(JSON.stringify({ paths: [], anchor: "/a" }))).toBeNull();
  });
});

describe("filterSelfReflection — 自反过滤（拖进自己所在目录 = no-op）", () => {
  const ROOT = "/repo";
  it("目标目录 = 条目父目录 → 自反滤除；子目录条目向外移合法保留", () => {
    // a.ysm 父目录 = 作者A（自反）；sub/b.ysm 父目录 = 作者A/sub（移到作者A = 向外移，合法）
    const paths = ["/repo/作者A/a.ysm", "/repo/作者A/sub/b.ysm", "/repo/作者B/c.ysm"];
    const keep = filterSelfReflection(paths, "作者A", ROOT);
    expect(keep).toEqual(["/repo/作者A/sub/b.ysm", "/repo/作者B/c.ysm"]);
  });

  it("全部自反 → 空数组（调用方静默 no-op）", () => {
    const paths = ["/repo/作者A/a.ysm", "/repo/作者A/b.ysm"];
    expect(filterSelfReflection(paths, "作者A", ROOT)).toEqual([]);
  });

  it("目标 = 仓库根（targetDir 空串，dstDir = filesRoot 本身）→ 根目录条目自反", () => {
    const paths = ["/repo/a.ysm", "/repo/作者A/b.ysm"];
    expect(filterSelfReflection(paths, "", ROOT)).toEqual(["/repo/作者A/b.ysm"]);
  });

  it("前缀嵌套不误伤（/repo/作者 vs /repo/作者B 非同目录）", () => {
    const paths = ["/repo/作者B/c.ysm"];
    expect(filterSelfReflection(paths, "作者", ROOT)).toEqual(["/repo/作者B/c.ysm"]);
  });

  it("分隔符归一：Windows 反斜杠路径与 / 混用同判", () => {
    const paths = ["\\repo\\作者A\\a.ysm", "/repo/作者B/c.ysm"];
    expect(filterSelfReflection(paths, "作者A", "\\repo")).toEqual(["/repo/作者B/c.ysm"]);
  });
});

describe("computeMovedEntry — 乐观更新本地重算", () => {
  it("path 重拼 targetDir + 原 name；fullPath 重拼 filesRoot + 新 path", () => {
    const e = entry("作者A/hero.ysm", "/repo/作者A/hero.ysm");
    const moved = computeMovedEntry(e, "作者B", "/repo");
    expect(moved.path).toBe("作者B/hero.ysm");
    expect(moved.fullPath).toBe("/repo/作者B/hero.ysm");
    // name 与其余字段原样（移动不改名）
    expect(moved.name).toBe("hero.ysm");
    expect(moved.banned).toBe(e.banned);
  });

  it("移到根（targetDir 空串）→ path = 纯文件名", () => {
    const e = entry("作者A/hero.ysm", "/repo/作者A/hero.ysm");
    expect(computeMovedEntry(e, "", "/repo").path).toBe("hero.ysm");
    expect(computeMovedEntry(e, "", "/repo").fullPath).toBe("/repo/hero.ysm");
  });

  it("path 已带反斜杠 → 先归一再重拼（key 空间 = ADR-222 正斜杠同形，reload 后键匹配）", () => {
    const e = entry("作者A\\hero.ysm", "\\repo\\作者A\\hero.ysm");
    const moved = computeMovedEntry(e, "作者B", "\\repo");
    expect(moved.path).toBe("作者B/hero.ysm");
    expect(moved.fullPath).toBe("/repo/作者B/hero.ysm");
  });

  it("多段嵌套目标目录（作者B/子夹）逐段保留", () => {
    const e = entry("a.ysm", "/repo/a.ysm");
    const moved = computeMovedEntry(e, "作者B/子夹", "/repo");
    expect(moved.path).toBe("作者B/子夹/a.ysm");
    expect(moved.fullPath).toBe("/repo/作者B/子夹/a.ysm");
  });
});
