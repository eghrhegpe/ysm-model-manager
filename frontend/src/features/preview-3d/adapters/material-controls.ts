// ===== 材质面板声明式节点（[doc:adr-126-p5] 审计 #3：material 声明式化——组合行增强）=====
// MMD/VRM 的 material 面板同构（每行 = 材质名 + eye 显隐 + 透明度滑条），bridge 提供完整
// 读写口（list/getDetail/setVisible/setOpacity）——即 Capability 雏形，无需再造类。
// materialNodes 是纯数据工厂（零 DOM，R1 合规）；bridge 用结构类型（Structural typing：
// MMD MaterialControlBridge / VRM VrmMaterialControlBridge 天然兼容，不跨层 import 类型）。

import type { PreviewMenuNode } from "../menu/node-types.ts";

/** material bridge 最小结构（MMD / VRM bridge 均满足——鸭子类型，无跨层依赖） */
export interface MaterialBridgeLike {
  list(): Array<{ index: number; name: string }>;
  getDetail(index: number): { visible?: boolean; opacity?: number } | null;
  setVisible(index: number, v: boolean): void;
  setOpacity(index: number, o: number): void;
}

/** 材质面板声明式节点：每材质一行组合控件（eye + opacity），闭包经 bridge 下沉 */
export function materialNodes(bridge: MaterialBridgeLike): PreviewMenuNode[] {
  const items = bridge.list();
  if (items.length === 0) {
    return [{ id: "mat-empty", kind: "field" as const, labelKey: "preview.noMaterial", fallback: "（无材质）", value: "" }];
  }
  return items.map((it) => ({
    id: `mat-${it.index}`,
    kind: "material-row" as const,
    labelKey: it.name,
    fallback: it.name,
    eye: {
      get: () => bridge.getDetail(it.index)?.visible ?? true,
      set: (v: boolean) => bridge.setVisible(it.index, v),
    },
    opacity: {
      get: () => Math.round((bridge.getDetail(it.index)?.opacity ?? 1) * 100),
      set: (v: number) => bridge.setOpacity(it.index, v / 100),
    },
  }));
}
