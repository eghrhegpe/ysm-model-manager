// ===== routeTypeMeta 回归测（ADR-269 D3 步骤①）=====
// 断言：类型元数据现由同步 schema 派生视图（typeIconOf / RESOURCE_TYPE_LABELS，
// 事实源 resource_types.json）直供，不再依赖 ctx.typeCache 异步预载。
// 反向验证：迁移前 routeTypeMeta(ctx, rtype) 读 ctx.typeCache——首帧 typeCache 为空表
// （LoadResourceTypes 是 fire-and-forget）→ 已知类型返回兜底 📦/rtype（📦 闪帧 bug）。
// 迁移后无 ctx、无空表窗口，已知类型恒返回 JSON 里的真实 icon/name。
import { describe, expect, it } from "vitest";
import { RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { routeTypeMeta } from "./preview-router.ts";

describe("routeTypeMeta（同步 schema 派生，无 typeCache）", () => {
  it("已知类型 → 返回 resource_types.json 的真实 icon/name，非兜底值", () => {
    expect(routeTypeMeta(RESOURCE_TYPES.YSM)).toEqual({ icon: "💎", label: "YSM 模型" });
    expect(routeTypeMeta(RESOURCE_TYPES.MMD)).toEqual({ icon: "🧍", label: "角色模型" });
    expect(routeTypeMeta(RESOURCE_TYPES.PACK)).toEqual({ icon: "🎨", label: "资源包" });
  });

  it("同步可用：无需预载、无 await，首帧即正确（📦 闪帧 bug 已消除）", () => {
    // 直接同步调用即得正确值——不经过任何异步注册表加载路径。
    const meta = routeTypeMeta(RESOURCE_TYPES.BLUEPRINT);
    expect(meta).toEqual({ icon: "⚙️", label: "蓝图" });
    expect(meta.icon).not.toBe("📦");
  });

  it("未知名 → icon 兜底 📦、label 回退原始 rtype", () => {
    expect(routeTypeMeta("no-such-type")).toEqual({ icon: "📦", label: "no-such-type" });
  });
});
