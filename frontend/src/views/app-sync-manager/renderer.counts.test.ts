// ===== renderer.collectCounts 计数契约直测（2026-10 锐评收口：未知状态不再 NaN 污染）=====
// 背景：旧实现 `(c as unknown as Record<string, number>)[st]++` 把六字段 TypeCounts 擦成
// 动态索引自增——Go 侧新增而前端未同步的状态（如 "conflicted"）会 `undefined++` 产出
// NaN 静默塞进计数对象（虚假健壮性：脏数据来了结果还是坏的，只是坏得静默）。本文件
// 钉死修复后的契约：已知状态入桶、diverged 折叠进 missing、未知状态显式告警且不入桶、
// total 恒计入、未知 type 只走全局桶、计数对象键集合恒定。
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectCounts } from "./renderer.ts";
import type { SyncItem } from "./tpl.ts";

function item(over: Partial<SyncItem> & { path: string; status: string; type: string }): SyncItem {
  // path 由 ...over 提供（必含），此处只补默认 name/size/isDir；先写 name 再展开 over，
  // 显式传了 name 的调用方可覆盖默认
  return { name: over.path, size: 0, isDir: false, ...over } as SyncItem;
}

const typeConfig = [{ id: "ysm" }, { id: "mmd" }];

/** 计数直测的最小 self（collectCounts 只读 _typeConfig/_allItems 两字段） */
function selfWith(items: SyncItem[]): Parameters<typeof collectCounts>[0] {
  return { _typeConfig: typeConfig, _allItems: items } as unknown as Parameters<
    typeof collectCounts
  >[0];
}

/** TypeCounts 全部具名字段（键集合恒定断言用） */
const KNOWN_KEYS = ["synced", "missing", "disabled", "optional", "legacy", "total"] as const;

let warnSpy: ReturnType<typeof vi.spyOn> | undefined;
afterEach(() => {
  warnSpy?.mockRestore();
});

describe("collectCounts — 状态徽标计数", () => {
  it("已知状态逐类入桶，diverged 折叠进 missing", () => {
    const { typeCounts, globalCounts } = collectCounts(
      selfWith([
        item({ path: "a", status: "synced", type: "ysm" }),
        item({ path: "b", status: "missing", type: "ysm" }),
        item({ path: "c", status: "diverged", type: "ysm" }),
        item({ path: "d", status: "optional", type: "mmd" }),
      ]),
    );
    expect(typeCounts.ysm).toEqual({
      synced: 1,
      missing: 2,
      disabled: 0,
      optional: 0,
      legacy: 0,
      total: 3,
    });
    expect(typeCounts.mmd).toEqual({
      synced: 0,
      missing: 0,
      disabled: 0,
      optional: 1,
      legacy: 0,
      total: 1,
    });
    expect(globalCounts).toEqual({
      synced: 1,
      missing: 2,
      disabled: 0,
      optional: 1,
      legacy: 0,
      total: 4,
    });
  });

  it("未知状态：显式告警、不入已知桶、不产出 NaN、total 仍计入", () => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { typeCounts, globalCounts } = collectCounts(
      selfWith([
        item({ path: "a", status: "synced", type: "ysm" }),
        item({ path: "x", status: "conflicted", type: "ysm" }),
      ]),
    );
    // 未知状态显式暴露（环形日志可查），而非静默 NaN
    expect(warnSpy).toHaveBeenCalled();
    // 已知桶计数正确；未知键不塞进对象（键集合恒定 → 无 NaN 键）
    expect(Object.keys(globalCounts).sort()).toEqual([...KNOWN_KEYS].sort());
    expect(typeCounts.ysm.synced).toBe(1);
    expect(typeCounts.ysm.missing).toBe(0);
    // total 恒计入（含未知状态条目——列表行数与徽标总数口径一致）
    expect(typeCounts.ysm.total).toBe(2);
    expect(globalCounts.total).toBe(2);
    // 全部已知字段均为有限数（无 undefined++ 污染的 NaN）
    for (const c of [typeCounts.ysm, globalCounts]) {
      for (const k of KNOWN_KEYS) expect(Number.isFinite(c[k])).toBe(true);
    }
  });

  it("未知 type（不在 _typeConfig）：typeCounts 无该桶，globalCounts 正常计入", () => {
    const { typeCounts, globalCounts } = collectCounts(
      selfWith([item({ path: "z", status: "synced", type: "plugin-unknown" })]),
    );
    expect(typeCounts["plugin-unknown"]).toBeUndefined();
    expect(globalCounts.synced).toBe(1);
    expect(globalCounts.total).toBe(1);
  });

  it("嵌套 children 递归计入（容器+子项），total=节点数", () => {
    const { typeCounts, globalCounts } = collectCounts(
      selfWith([
        {
          path: "packs",
          name: "packs",
          status: "synced",
          type: "ysm",
          size: 0,
          isDir: true,
          children: [
            item({ path: "packs/a.zip", status: "disabled", type: "ysm" }),
            item({ path: "packs/b.zip", status: "disabled", type: "ysm" }),
          ],
        },
      ]),
    );
    expect(typeCounts.ysm).toEqual({
      synced: 1,
      missing: 0,
      disabled: 2,
      optional: 0,
      legacy: 0,
      total: 3,
    });
    expect(globalCounts).toEqual({
      synced: 1,
      missing: 0,
      disabled: 2,
      optional: 0,
      legacy: 0,
      total: 3,
    });
  });
});
