// @vitest-environment happy-dom
// ===== buildTree 缓存修订号测试（审核 2026-10-15 P2）=====
// 病灶：getBuildTreeCached 的 O(1) 快速路径原判据是「entries 引用 + sort + filterPaths
// 引用均未变 → 复用上次指纹」，而乐观更新**原地写 `entry.banned` 不替换数组引用**
// → 误命中缓存 → 复用旧 TreeNode，而 dirFlags（WeakMap<TreeNode, hasEnabled/hasDisabled>）
// 只在 buildTree 内 annotateDirNodes 重算 → 文件行自身勾选态正确（惰性 html 读 e.banned），
// **父文件夹行的 ck on/partial/off 停在旧值**，直到后续 _load() 换数组引用才纠
// （窗口期 = IPC + Go 侧 InvalidatePath 真实扫盘；批量禁用 500 文件时全程可见）。
// 现 TreeRenderCtx.buildRev 单调递增并入快速路径判据，原地改动调 invalidateBuildCache。
// 本文件单独成卡的理由：render.test.ts 是 `@vitest-environment node`（纯函数，无 DOM），
// 而 renderTree 需要真实容器元素，故首行显式切 happy-dom。
import { describe, it, expect } from "vitest";
import {
  createTreeRenderCtx,
  getVsRows,
  invalidateBuildCache,
  renderTree,
  type TreeRenderCtx,
} from "./render.ts";
import type { TreeEntry } from "./loader.ts";

function entry(path: string): TreeEntry {
  return {
    name: path.split("/").pop() || path,
    path,
    fullPath: `/repo/${path}`,
    size: 0,
    modTime: 0,
    banned: false,
    type: "ysm",
  };
}

/** 渲染一次并取回文件夹行 html（唯一目录「folder」的 ck 类） */
function folderHtml(ctx: TreeRenderCtx, container: HTMLElement, entries: TreeEntry[]): string {
  renderTree(ctx, container, entries, "", "name", { folder: true }, null, "grid");
  return getVsRows(ctx, container).find((r) => r.type === "folder")!.html;
}

describe("buildTree 缓存修订号（invalidateBuildCache）", () => {
  it("原地翻 banned 不 bump → 快速路径复用旧 root，父文件夹 ck 停在旧值；bump 后重算", () => {
    const entries = [entry("folder/a.ysm")];
    const ctx = createTreeRenderCtx();
    const container = document.createElement("div");

    expect(folderHtml(ctx, container, entries), "唯一条目启用 → ck on").toContain('class="ck on"');

    // 乐观更新本体：原地改，数组引用不变、内容已变
    entries[0]!.banned = true;
    expect(
      folderHtml(ctx, container, entries),
      "未 bump 修订号 → 命中快速路径复用旧 root，ck 停在 on（缺陷本体）",
    ).toContain('class="ck on"');

    invalidateBuildCache(ctx);
    expect(
      folderHtml(ctx, container, entries),
      "bump 后走全量重建，dirFlags 重算：唯一条目已禁用 → 无 on",
    ).not.toContain("ck on");
  });

  it("同一 ctx 二次 flip + bump → 双向都跟随（on→off→on），非一次性缓存失效", () => {
    const entries = [entry("folder/a.ysm"), { ...entry("folder/b.ysm"), banned: true }];
    const ctx = createTreeRenderCtx();
    const container = document.createElement("div");

    expect(folderHtml(ctx, container, entries), "混合 → on partial").toContain("ck on partial");

    entries[1]!.banned = false;
    invalidateBuildCache(ctx);
    expect(folderHtml(ctx, container, entries), "全启用 → on").toContain('class="ck on"');

    entries[0]!.banned = true;
    entries[1]!.banned = true;
    invalidateBuildCache(ctx);
    const html = folderHtml(ctx, container, entries);
    expect(html, "全禁用 → 无 on / 无 partial").not.toContain("ck on");
  });

  it("仅搜索词变化（entries 不动）仍命中快速路径：buildRev 未变即复用", () => {
    // 搜索击键是最热路径——若本判据误伤，万级仓库每次击键都要付一次 O(n) buildTree
    const entries = [entry("folder/a.ysm"), entry("folder/b.ysm")];
    const ctx = createTreeRenderCtx();
    const container = document.createElement("div");
    renderTree(ctx, container, entries, "", "name", { folder: true }, null, "grid");
    const before = ctx.buildRev ?? 0;
    renderTree(ctx, container, entries, "a", "name", { folder: true }, null, "grid");
    expect(ctx.buildRev ?? 0, "渲染本身不得递增修订号").toBe(before);
  });
});
