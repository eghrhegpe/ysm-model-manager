// @vitest-environment node
// ===== ground 存档迁移纯函数测试（锐评「迁移考古层下沉」2026-09-21）=====
// 行为逐条复刻自 ground-capability.loadState 内联考古段（下沉前实测语义钉死），
// 本文件是三代存档（扁平枚举 / ADR-249 图案 / 混合前缀）进化的回归锚。
import { describe, expect, it } from "vitest";
import { normalizeGroundLegacyState } from "./ground-migrations.ts";

describe("normalizeGroundLegacyState — 代数一：ADR-196 前扁平无前缀存档", () => {
  it("旧键逐一前缀化搬运，只搬实际存在的键", () => {
    const out = normalizeGroundLegacyState({
      visible: true,
      size: 120,
      divisions: 40,
      colorCenter: 0x112233,
      colorGrid: 0x445566,
      matColor: 0x9a8b78,
      matMetalness: 0.5,
    });
    expect(out.groundVisible).toBe(true);
    expect(out.groundSize).toBe(120);
    expect(out.groundDivisions).toBe(40);
    expect(out.groundColorCenter).toBe(0x112233);
    expect(out.groundColorGrid).toBe(0x445566);
    expect(out.groundMatColor).toBe(0x9a8b78);
    expect(out.groundMatMetalness).toBe(0.5);
    // 未出现的旧键不凭空造
    expect("matOpacity" in out).toBe(false);
    expect("groundMatOpacity" in out).toBe(false);
  });

  it("旧键不残留：迁移产物只含前缀新键（cap 私有键透传是 loadState 调用方的事）", () => {
    const out = normalizeGroundLegacyState({ visible: false });
    expect("visible" in out).toBe(false);
    expect(out.groundVisible).toBe(false);
  });

  it("无任一旧无前缀键 → 恒等（返回同一引用，纯新档零开销）", () => {
    const fresh = { groundVisible: true, groundSize: 80, enabled: true };
    expect(normalizeGroundLegacyState(fresh)).toBe(fresh);
  });

  it("判据 = 存在任一旧键而非缺新键（锐评 P4：混合存档也进迁移分支）", () => {
    const mixed = normalizeGroundLegacyState({
      groundSize: 100, // 新键在场
      visible: true, // 仍携旧键 ⇒ 触发搬运
    });
    expect(mixed.groundVisible).toBe(true);
    expect(mixed.groundSize).toBe(100);
  });
});

describe("normalizeGroundLegacyState — 保底透传：已前缀键不丢", () => {
  it("混合存档（旧键 + 已前缀化新键共存）透传新键（审核回归实测案例）", () => {
    const out = normalizeGroundLegacyState({
      visible: true,
      groundCanvasStyle: "marble",
    });
    expect(out.groundVisible).toBe(true);
    expect(out.groundCanvasStyle, "整对象替换曾把 canvasStyle 静默丢弃").toBe("marble");
  });

  it("旧键映射在场时覆盖同名新键（原实现语义：map 先写、透传不覆盖——旧值胜出）", () => {
    const out = normalizeGroundLegacyState({
      matColor: 0x000000,
      groundMatColor: 0xffffff,
    });
    expect(out.groundMatColor).toBe(0x000000);
  });
});

describe("normalizeGroundLegacyState — 代数二：旧单枚举 matSource 拆三轴（ADR-249/252）", () => {
  it("图案值 → plain 底座 + 叠加层进位，线色/格数搬运（视觉等价）", () => {
    const out = normalizeGroundLegacyState({
      visible: true,
      matSource: "checker",
      matLineColor: 0xabcdef,
      matGridSize: 16,
    });
    expect(out.groundSourceKind).toBe("canvas");
    expect(out.groundCanvasStyle).toBe("plain");
    expect(out.groundOverlay).toBe("checker");
    expect(out.groundOverlayColor).toBe(0xabcdef);
    expect(out.groundOverlaySize).toBe(16);
    expect(out.groundMatGridSize, "matGridSize 同时照常前缀化（表面粒度）").toBe(16);
  });

  it("材质值 marble → canvas/marble，不进叠加层", () => {
    const out = normalizeGroundLegacyState({ matSource: "marble" });
    expect(out.groundSourceKind).toBe("canvas");
    expect(out.groundCanvasStyle).toBe("marble");
    expect("groundOverlay" in out).toBe(false);
  });

  it("脏 matSource 回退 none（migrateGroundMatSource 兜底，不抛错）", () => {
    const out = normalizeGroundLegacyState({ matSource: "hack" });
    expect(out.groundSourceKind).toBe("none");
  });

  it("legacy 读的是原始 mapLineColor 键（前缀化变体同样识别）", () => {
    const a = normalizeGroundLegacyState({ matSource: "grid", matLineColor: 0x010203 });
    expect(a.groundOverlayColor).toBe(0x010203);
    const b = normalizeGroundLegacyState({
      visible: true,
      groundMatLineColor: 0x040506,
      groundCanvasStyle: "checker",
    });
    expect(b.groundOverlayColor, "代数三路径同样消费前缀化线色变体").toBe(0x040506);
  });
});

describe("normalizeGroundLegacyState — 代数三：ADR-249 时代图案型 canvasStyle 进位叠加层", () => {
  it("groundCanvasStyle=grid（无旧无前缀键触发）→ plain + overlay=grid", () => {
    const out = normalizeGroundLegacyState({
      groundVisible: true,
      groundSourceKind: "canvas",
      groundCanvasStyle: "grid",
      groundMatLineColor: 0x5a4b3a,
      groundMatGridSize: 10,
      groundOverlay: "none",
    });
    expect(out.groundCanvasStyle).toBe("plain");
    expect(out.groundOverlay).toBe("grid");
    expect(out.groundOverlayColor).toBe(0x5a4b3a);
    expect(out.groundOverlaySize).toBe(10);
  });

  it("已有非 none 叠加层 → 不覆盖，仅底座归 plain", () => {
    const out = normalizeGroundLegacyState({ groundCanvasStyle: "stripes", groundOverlay: "grid" });
    expect(out.groundCanvasStyle).toBe("plain");
    expect(out.groundOverlay).toBe("grid");
  });

  it("overlayColor/Size 已有值时不搬运（undefined 门）", () => {
    const out = normalizeGroundLegacyState({
      groundCanvasStyle: "diamond",
      groundMatLineColor: 0x111111,
      groundOverlayColor: 0x222222,
    });
    expect(out.groundOverlayColor).toBe(0x222222);
    expect("groundOverlaySize" in out).toBe(false);
  });

  it("材质值（marble/sand/grass/plain）原样保留，不引入叠加层", () => {
    const out = normalizeGroundLegacyState({ groundCanvasStyle: "marble", groundOverlay: "none" });
    expect(out.groundCanvasStyle).toBe("marble");
    expect(out.groundOverlay).toBe("none");
  });
});

describe("normalizeGroundLegacyState — 纯度契约", () => {
  it("输入对象不被 mutate（返回副本或恒等引用）", () => {
    const input = { visible: true, matSource: "grid", matLineColor: 7 };
    const snapshot = { ...input };
    normalizeGroundLegacyState(input);
    expect(input).toEqual(snapshot);
  });
});
