// ===== 模块级冻结 t() 的行为墓碑（2026-10-13 锐评 P0 收口）=====
// 病：`const OP_META = { import: { label: t("…") } }` 在模块构建期求值，译文焊死在
// 首查语言包（initI18n 异步装载，顶层求值落 zh-CN；lang:changed 只重建 DOM 不重建模块）。
// 静态门禁 scripts/i18n-frozen-t-check.ts 判形状，本文件判**行为**：模块 import 时刻
// t() 调用数必须为 0——形状检查会随语法演化漏网（正则级判据的天花板），行为判据不受语法影响。
// 手法：vi.resetModules + doMock 换 spy，再动态 import 被测模块（同 app-modules 装配测试惯例）。
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("模块装载期零 t()（冻结译文病的行为判据）", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function importWithTSpy(path: string) {
    const tSpy = vi.fn((key: string) => key);
    vi.doMock("@/core/i18n/t.ts", () => ({
      t: tSpy,
      tOf: tSpy,
      interpolate: (s: string) => s,
    }));
    await import(path);
    return tSpy;
  }

  it("logs.ts：import 期不译 OP_META（t 只在消费点 opMeta 调用）", async () => {
    const tSpy = await importWithTSpy("./logs.ts");
    expect(tSpy).not.toHaveBeenCalled();
  });

  it("health.ts：import 期不译 VERDICT_BANDS（表存 labelKey，renderHealthReport 现调）", async () => {
    const tSpy = await importWithTSpy("./health.ts");
    expect(tSpy).not.toHaveBeenCalled();
  });

  it("oldest-models.ts：import 期不译 VERDICT_BANDS（与 health.ts 同构，同族同治）", async () => {
    const tSpy = await importWithTSpy("@/features/maintenance/oldest-models.ts");
    expect(tSpy).not.toHaveBeenCalled();
  });
});
