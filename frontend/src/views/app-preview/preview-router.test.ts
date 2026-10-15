// ===== routeTypeMeta 回归测（ADR-269 D3 步骤①）=====
// 断言：类型元数据现由同步 schema 派生视图（typeIconOf + `rtypeLabelOf` 出口，
// 事实源 resource_types.json）直供，不再依赖 ctx.typeCache 异步预载。
// ⚠️ 显示名 2026-10-15 起走 i18n 出口（拍板「类型文案权威源 = locale」）：本 label 经
// preview-registry → detail-3d 的 pageShellHTML.title 直写 DOM，直取注册表中文 = 每次点
// 模型进预览面板即中文裸奔。同日命名终审已把 zh 键值与注册表 name 对齐为同一词
// （EntityPlayer =「角色模型」，遵 ADR-111），出口与注册表不再有两形。
// 反向验证：迁移前 routeTypeMeta(ctx, rtype) 读 ctx.typeCache——首帧 typeCache 为空表
// （LoadResourceTypes 是 fire-and-forget）→ 已知类型返回兜底 📦/rtype（📦 闪帧 bug）。
// 迁移后无 ctx、无空表窗口，已知类型恒返回真实 icon + 译文 label。
import { describe, expect, it } from "vitest";
import { rtypeLabelOf, RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { routeTypeMeta } from "./preview-router.ts";

describe("routeTypeMeta（同步 schema 派生，无 typeCache）", () => {
  it("已知类型 → 真实 icon + 出口显示名（非兜底值、非注册表中文直取）", () => {
    // 判据走出口同源值：本文件不覆写 t.ts，test-setup 钉 zh-CN，故出口返回 zh 键值。
    expect(routeTypeMeta(RESOURCE_TYPES.YSM)).toEqual({ icon: "💎", label: "YSM 模型" });
    expect(routeTypeMeta(RESOURCE_TYPES.MMD)).toEqual({
      icon: "🧍",
      label: rtypeLabelOf(RESOURCE_TYPES.MMD),
    });
    expect(routeTypeMeta(RESOURCE_TYPES.MMD).label).toBe("角色模型");
    expect(routeTypeMeta(RESOURCE_TYPES.PACK)).toEqual({ icon: "🎨", label: "资源包" });
  });

  it("同步可用：无需预载、无 await，首帧即正确（📦 闪帧 bug 已消除）", () => {
    // 直接同步调用即得正确值——不经过任何异步注册表加载路径。
    const meta = routeTypeMeta(RESOURCE_TYPES.BLUEPRINT);
    expect(meta).toEqual({ icon: "⚙️", label: "蓝图" });
    expect(meta.icon).not.toBe("📦");
  });

  it("未知名 → icon 兜底 📦、label 回退原始 rtype（出口末端回落，不吐裸 key）", () => {
    expect(routeTypeMeta("no-such-type")).toEqual({ icon: "📦", label: "no-such-type" });
  });
});
