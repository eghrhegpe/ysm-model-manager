// ===== skeleton-fill-panel 声明式 schema 测试（[doc:adr-126-p5-c] buildYsmModelSchema）=====
// 覆盖：统计 field / 纹理 row / 组件选择 select 的声明式产出（纯数据零 DOM）。
// fill3DPanel 命令式渲染的既有测试在 skeleton.test.ts（未动）。

import { describe, it, expect } from "vitest";
import {
  buildYsmModelSchema,
  ysmModelStats,
  ysmModelTextureSlots,
} from "./skeleton-fill-panel.ts";
import type { PreviewSnapshot } from "../../features/preview-3d/state/preview-state.ts";
import type { Spec3D } from "../../features/preview-3d/model3d.ts";
import * as THREE from "three";

/** 最小 spec（单组件）：1 个 modelGroup，2 根骨骼，2 个纹理槽 */
function makeSpec(overrides: { models?: unknown[] } = {}) {
  const models = overrides.models ?? [
    {
      name: "main",
      bones: [{ _cubeCount: 2 }, { _cubeCount: 1 }],
      textureWidth: 64,
      textureHeight: 32,
      meshGroups: [{ texIdx: 0 }, { texIdx: 1 }],
    },
  ];
  return { models, componentTextures: {} } as unknown as Spec3D;
}

const ctx = {
  model: {
    textureNames: ["skin", "tail"],
    textures: ["a/skin.png", "a/tail.png"],
    textureCategories: ["", ""],
  },
  spec: makeSpec(),
  texArr: [
    { userData: { imgWidth: 64, imgHeight: 32 } },
    { userData: { imgWidth: 128, imgHeight: 64 } },
  ],
} as unknown as Parameters<typeof buildYsmModelSchema>[0];

const snap = (activeComponent: number): PreviewSnapshot =>
  ({ "ui.activeComponent": activeComponent }) as PreviewSnapshot;

/** 会话级 activeComponent 闭包（对齐 B2 范式：per-scene 会话态，不走全局状态层） */
const sessionActive = (initial = -1): { get: () => number; set: (n: number) => void; snapshot: PreviewSnapshot } => {
  let v = initial;
  return {
    get: () => v,
    set: (n: number) => {
      v = n;
    },
    snapshot: snap(v),
  };
};

describe("buildYsmModelSchema（声明式 schema）", () => {
  it("单组件：统计 2 行 field + 纹理 2 行 row，无组件选择 select", () => {
    const nodes = buildYsmModelSchema(ctx, snap(-1), sessionActive(-1));
    // 单组件 → 无 select
    expect(nodes.some((n) => n.kind === "select")).toBe(false);
    // 统计
    expect(nodes[0]).toMatchObject({ id: "ysm-stats-bones", kind: "field", value: "2 根" });
    expect(nodes[1]).toMatchObject({ id: "ysm-stats-cubes", kind: "field", value: "3 个" });
    // 纹理行
    const texNodes = nodes.filter((n) => n.kind === "row");
    expect(texNodes.length).toBe(2);
    expect(texNodes[0].id).toBe("ysm-tex-0");
    expect(texNodes[0].value).toContain("声明 64×32");
    expect(texNodes[0].value).toContain("加载 64×32");
  });

  it("多组件：组件选择 select 出现，get/set 闭包读写会话 activeComponent，选项含 All + 各组件", () => {
    const multiCtx = {
      ...ctx,
      spec: makeSpec({
        models: [
          { name: "main", bones: [{ _cubeCount: 1 }], meshGroups: [{ texIdx: 0 }] },
          { name: "armor", bones: [], meshGroups: [{ texIdx: 1 }] },
        ],
      }),
    } as unknown as Parameters<typeof buildYsmModelSchema>[0];
    const nodes = buildYsmModelSchema(multiCtx, snap(-1), sessionActive(-1));
    const sel = nodes.find((n) => n.kind === "select")!;
    expect(sel.id).toBe("ysm-component-select");
    // [doc:adr-126-p5-b→B2] select 不再 bind 全局状态层——get/set 闭包读写 per-scene 会话态
    expect(sel.control?.bind).toBeUndefined();
    expect(sel.control?.get).toBeTypeOf("function");
    expect(sel.control?.set).toBeTypeOf("function");
    expect(sel.control?.options?.map((o) => o.value)).toEqual(["-1", "0", "1"]);
    expect(sel.control?.options?.[0].label).toBe("全部组件");
  });

  it("多组件 + activeComponent=1：统计/纹理按组件 1 聚合（会话闭包读）", () => {
    const multiCtx = {
      ...ctx,
      spec: makeSpec({
        models: [
          { name: "main", bones: [{ _cubeCount: 5 }], textureWidth: 64, textureHeight: 32, meshGroups: [{ texIdx: 0 }] },
          { name: "armor", bones: [{ _cubeCount: 2 }], textureWidth: 128, textureHeight: 64, meshGroups: [{ texIdx: 1 }] },
        ],
      }),
      texArr: [{ userData: { imgWidth: 128, imgHeight: 64 } }] as unknown as THREE.Texture[],
      model: { textureNames: ["armor_tex"], textures: ["a/armor.png"], textureCategories: [""] } as unknown as Parameters<typeof buildYsmModelSchema>[0]["model"],
    } as unknown as Parameters<typeof buildYsmModelSchema>[0];
    const active = sessionActive(1);
    const nodes = buildYsmModelSchema(multiCtx, snap(1), active);
    expect(nodes.find((n) => n.id === "ysm-stats-bones")?.value).toBe("1 根");
    expect(nodes.find((n) => n.id === "ysm-stats-cubes")?.value).toBe("2 个");
    // 组件 1 只有 1 个槽位
    expect(nodes.filter((n) => n.kind === "row").length).toBe(1);
  });

  it("多组件 + 专属纹理：componentTextures[compName] 命中 → 渲染专属纹理行（ADR-114 回归）", () => {
    // [doc:adr-126-p5] P5-A review P2：旧 fillPanelComponent 渲染专属纹理区，
    // 新 schema 流此前只走全局槽——此处锁「命中专属 → 替代全局槽行」契约
    const exclusiveCtx = {
      ...ctx,
      spec: {
        models: [
          { name: "main", bones: [{ _cubeCount: 1 }], meshGroups: [{ texIdx: 0 }] },
          { name: "armor", bones: [{ _cubeCount: 2 }], textureWidth: 128, textureHeight: 64, meshGroups: [{ texIdx: 1 }] },
        ],
        componentTextures: { armor: ["a/armor_skin.png", "a/armor_trim.png"] },
      } as unknown as Spec3D,
      texArr: [{ userData: { imgWidth: 128, imgHeight: 64 } }] as unknown as THREE.Texture[],
      model: { textureNames: ["armor_tex"], textures: ["a/armor.png"], textureCategories: [""] } as unknown as Parameters<typeof buildYsmModelSchema>[0]["model"],
    } as unknown as Parameters<typeof buildYsmModelSchema>[0];
    const nodes = buildYsmModelSchema(exclusiveCtx, snap(1), sessionActive(1));
    const rows = nodes.filter((n) => n.kind === "row");
    expect(rows.length).toBe(2); // 专属纹理 2 行（替代全局槽行）
    expect(rows[0].id).toBe("ysm-tex-ex-0");
    expect(rows[0].labelKey).toBe("armor #1"); // 专属纹理 >1 个时带序号
    expect(rows[0].value).toContain("专属纹理");
    expect(rows[0].value).toContain("声明 128×64");
    expect(rows[1].id).toBe("ysm-tex-ex-1");
    expect(rows[1].labelKey).toBe("armor #2");
  });

  it("组件 select 闭包 set 后 get 读回新值（会话态写读一致，B2）", () => {
    const multiCtx = {
      ...ctx,
      spec: makeSpec({
        models: [
          { name: "main", bones: [{ _cubeCount: 1 }], meshGroups: [{ texIdx: 0 }] },
          { name: "armor", bones: [], meshGroups: [{ texIdx: 1 }] },
        ],
      }),
    } as unknown as Parameters<typeof buildYsmModelSchema>[0];
    const active = sessionActive(-1);
    const nodes = buildYsmModelSchema(multiCtx, snap(-1), active);
    const sel = nodes.find((n) => n.kind === "select")!;
    expect(sel.control!.get!(undefined)).toBe("-1");
    sel.control!.set!("1");
    expect(active.get()).toBe(1);
    // 重建节点：get 闭包读会话态新值（对齐 litematic shell 闭包范式）
    const rebuilt = buildYsmModelSchema(multiCtx, snap(-1), active);
    const sel2 = rebuilt.find((n) => n.kind === "select")!;
    expect(sel2.control!.get!(undefined)).toBe("1");
  });
});

describe("纯函数（fillPanelComponent 同逻辑抽取）", () => {
  it("ysmModelStats：All（-1）聚合全部，指定组件聚合单个", () => {
    const spec = makeSpec({
      models: [
        { name: "main", bones: [{ _cubeCount: 2 }] },
        { name: "armor", bones: [{ _cubeCount: 3 }] },
      ],
    }) as unknown as Spec3D;
    expect(ysmModelStats(spec, -1)).toMatchObject({ bones: 2, cubes: 5, compName: "main" });
    expect(ysmModelStats(spec, 1)).toMatchObject({ bones: 1, cubes: 3, compName: "armor" });
  });

  it("ysmModelTextureSlots：按 meshGroups.texIdx 去重，缺省回退全部", () => {
    const spec = makeSpec({
      models: [{ name: "main", bones: [], meshGroups: [{ texIdx: 0 }, { texIdx: 0 }, { texIdx: 1 }] }],
    }) as unknown as Spec3D;
    expect(ysmModelTextureSlots(spec, 0, 3)).toEqual([0, 1]);
    // meshGroups 缺失 → 回退全部
    const bare = { models: [{ name: "main", bones: [] }] } as unknown as Spec3D;
    expect(ysmModelTextureSlots(bare, 0, 3)).toEqual([0, 1, 2]);
  });
});
