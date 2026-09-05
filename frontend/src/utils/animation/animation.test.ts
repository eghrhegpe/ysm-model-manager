// @vitest-environment node
// ===== 骨骼动画计算测试（ADR-021 扩展，坐标高危区）=====
// evaluateKeyframes（插值）/ parseBedrockAnimationJSON（解析）/ evaluateClip（局部变换）。
import { describe, it, expect } from "vitest";
import {
  evaluateKeyframes,
  parseBedrockAnimationJSON,
  evaluateClip,
  ysmAnimClipLabels,
} from "./animation.ts";
import type { Keyframe, AnimationClip } from "./animation.ts";

const KFS: Keyframe[] = [
  { time: 0, post: [0, 0, 0], pre: [0, 0, 0], lerp: "linear" },
  { time: 1, post: [10, 20, 30], pre: [10, 20, 30], lerp: "linear" },
  { time: 2, post: [20, 20, 30], pre: [20, 20, 30], lerp: "linear" },
];

describe("evaluateKeyframes 插值", () => {
  it("空数组返回 null", () => {
    expect(evaluateKeyframes([], 0)).toBeNull();
  });

  it("t 在首帧前返回首帧 post", () => {
    expect(evaluateKeyframes(KFS, -1)).toEqual([0, 0, 0]);
  });

  it("t 在末帧后返回末帧 post", () => {
    expect(evaluateKeyframes(KFS, 5)).toEqual([20, 20, 30]);
  });

  it("t 落在关键帧时间点返回该帧 post", () => {
    expect(evaluateKeyframes(KFS, 1)).toEqual([10, 20, 30]);
  });

  it("线性插值：t=0.5 取中间值", () => {
    expect(evaluateKeyframes(KFS, 0.5)).toEqual([5, 10, 15]);
  });

  it("step 插值：直接返回当前帧 post 不插值", () => {
    const stepKfs: Keyframe[] = [
      { time: 0, post: [1, 1, 1], pre: [1, 1, 1], lerp: "step" },
      { time: 1, post: [9, 9, 9], pre: [9, 9, 9], lerp: "step" },
    ];
    expect(evaluateKeyframes(stepKfs, 0.5)).toEqual([1, 1, 1]);
  });

  it("t 恰为帧时间返回对应帧 post（重复时间帧取首帧）", () => {
    const dup: Keyframe[] = [
      { time: 0, post: [3, 3, 3], pre: [3, 3, 3], lerp: "linear" },
      { time: 0, post: [5, 5, 5], pre: [5, 5, 5], lerp: "linear" },
    ];
    expect(evaluateKeyframes(dup, 0)).toEqual([3, 3, 3]);
  });
});

describe("parseBedrockAnimationJSON 解析", () => {
  it("非法 JSON 返回解析错误", () => {
    const r = parseBedrockAnimationJSON("{not json");
    expect(r.clips).toEqual([]);
    expect(r.errors[0]).toContain("JSON 解析失败");
  });

  it("缺少 animations 字段返回错误", () => {
    const r = parseBedrockAnimationJSON("{}");
    expect(r.clips).toEqual([]);
    expect(r.errors[0]).toContain("缺少 animations");
  });

  it("解析动画的 loop / 骨骼通道 / 长度", () => {
    const json = JSON.stringify({
      animations: {
        walk: {
          loop: true,
          animation_length: 2,
          bones: {
            head: {
              rotation: { "0": [0, 0, 0], "1": [0, 30, 0] },
              position: { "0": [0, 0, 0] },
            },
            arm: {
              rotation: { "0": [0, 0, 0] },
            },
          },
        },
      },
    });
    const r = parseBedrockAnimationJSON(json);
    expect(r.errors).toEqual([]);
    expect(r.clips).toHaveLength(1);
    const clip = r.clips[0];
    expect(clip.name).toBe("walk");
    expect(clip.loop).toBe(true);
    expect(clip.length).toBe(2);
    expect(clip.bones.head.rotation).toHaveLength(2);
    expect(clip.bones.head.position).toHaveLength(1);
    expect(clip.hasMolang).toBe(false);
  });

  it("loop 字符串 true 也识别", () => {
    const json = JSON.stringify({
      animations: { a: { loop: "true", bones: { b: { rotation: { "0": [0, 0, 0] } } } } },
    });
    expect(parseBedrockAnimationJSON(json).clips[0].loop).toBe(true);
  });

  it("无 bones 的动画被跳过", () => {
    const json = JSON.stringify({ animations: { empty: { loop: false } } });
    const r = parseBedrockAnimationJSON(json);
    expect(r.clips).toHaveLength(0);
  });

  it("含 Molang 字符串标记 hasMolang（rotation 正常帧保留 clip）", () => {
    const json = JSON.stringify({
      animations: {
        a: {
          bones: {
            b: {
              rotation: { "0": [0, 0, 0] }, // 正常数字帧，保证 clip 保留
              position: { "0": "math.sin(q.tick)" }, // Molang 字符串
            },
          },
        },
      },
    });
    const r = parseBedrockAnimationJSON(json);
    expect(r.clips).toHaveLength(1);
    expect(r.clips[0].hasMolang).toBe(true);
  });

  it("非规范时间键（0.0 / 1.50）也能解析，不静默丢帧（P4 反推修复）", () => {
    // 原 parseChannel 用数字下标回查 channelData[t]，JS 数字转规范字符串后
    // "0.0"/"1.50" 键查不到 → 整帧丢弃；修复后按 entries 配对求值
    const json = JSON.stringify({
      animations: {
        a: {
          bones: {
            b: {
              rotation: { "0.0": [0, 0, 0], "1.50": [0, 30, 0] },
            },
          },
        },
      },
    });
    const r = parseBedrockAnimationJSON(json);
    expect(r.errors).toEqual([]);
    const kfs = r.clips[0].bones.b!.rotation!;
    expect(kfs).toHaveLength(2);
    expect(kfs[0].time).toBe(0);
    expect(kfs[1].time).toBe(1.5);
    // 旋转通道出弧度：[0, 30, 0] → Y 取负换算（对齐上游 RotationValue.convert）
    expect(kfs[1].post).toEqual([0, -30 * (Math.PI / 180), 0]);
  });
});

describe("evaluateClip 局部变换", () => {
  it("空 clip 返回空 Map", () => {
    expect(evaluateClip({ name: "x", loop: false, length: 0, bones: {} }, 0).size).toBe(0);
  });

  it("循环动画按 length 取模", () => {
    const clip: AnimationClip = {
      name: "x",
      loop: true,
      length: 2,
      bones: { b: { rotation: KFS } },
    };
    // t=3 → 3%2=1 → 帧值 [10,20,30]
    const r = evaluateClip(clip, 3);
    expect(r.get("b")!.rotation).toEqual([10, 20, 30]);
  });

  it("非循环动画 t 超长钳制到末帧", () => {
    const clip: AnimationClip = {
      name: "x",
      loop: false,
      length: 2,
      bones: { b: { position: KFS } },
    };
    const r = evaluateClip(clip, 100);
    expect(r.get("b")!.position).toEqual([20, 20, 30]);
  });
});

describe("数值安全（P1 反推修复）", () => {
  it("动画关键帧字符串数值溢出（1e999→Infinity）→ 轴占位 0，不产出 NaN（P1 反推修复）", () => {
    // 真实 Infinity 来源：字符串数值溢出 Number("1e999")=Infinity——
    // 走解析路径验证 parseKeyValue 的 Number.isFinite 守卫（直接构造数字 Keyframe
    // 绕过解析层，evaluateKeyframes 超范围按契约透传 post 拷贝）
    const res = parseBedrockAnimationJSON(
      JSON.stringify({
        animations: {
          x: {
            animation_length: 1,
            bones: { b: { position: { "0": ["1e999", "2", "3"] } } },
          },
        },
      }),
    );
    expect(res.errors).toEqual([]);
    const clip = res.clips[0];
    const kf = clip!.bones.b!.position![0];
    // L4：1e999 → Infinity 非合法数字，parseAxisItem 守卫将其置 0
    expect(kf.post).toEqual([0, 2, 3]);
    expect(kf.post.every((n) => Number.isFinite(n))).toBe(true);
  });
});

describe("ysmAnimClipLabels 标签策略（L3 全 clip 列表）", () => {
  function clipOf(name: string): AnimationClip {
    return { name, loop: true, length: 1, bones: {} };
  }

  it("单 clip 保持文件名口径（回归保护：不改动现有展示）", () => {
    expect(ysmAnimClipLabels("run", [clipOf("animation.model.run")])).toEqual(["run"]);
  });

  it("多 clip 以「文件名 · clip 名」区分", () => {
    expect(ysmAnimClipLabels("player", [clipOf("idle"), clipOf("walk")])).toEqual([
      "player · idle",
      "player · walk",
    ]);
  });

  it("多 clip 中无名 clip 用序号兜底", () => {
    expect(ysmAnimClipLabels("misc", [clipOf(""), clipOf("jump")])).toEqual([
      "misc · #1",
      "misc · jump",
    ]);
  });
});

describe("Molang 关键帧求值（ADR-100 L4）", () => {
  function parseOne(bones: unknown): AnimationClip {
    const res = parseBedrockAnimationJSON(
      JSON.stringify({ animations: { x: { animation_length: 1, loop: true, bones } } }),
    );
    expect(res.errors).toEqual([]);
    expect(res.clips).toHaveLength(1);
    return res.clips[0];
  }

  it("标量 Molang 帧：按 anim_time 求值（三轴同式）", () => {
    const clip = parseOne({ b: { rotation: { "0": "query.anim_time * 90" } } });
    expect(clip.hasMolang).toBe(true);
    // 旋转通道：求值后按 X/Y 取负、度→弧度换算（对齐上游 RotationValue 包裹口径）
    expect(evaluateKeyframes(clip.bones.b!.rotation!, 0.5)![0]).toBeCloseTo(-Math.PI / 4, 12);
    expect(evaluateKeyframes(clip.bones.b!.rotation!, 1)![0]).toBeCloseTo(-Math.PI / 2, 12);
  });

  it("逐轴混合数组：Molang 轴 + 数字轴各归各位", () => {
    const clip = parseOne({ b: { position: { "0": ["query.anim_time * 2", 3, 0] } } });
    expect(evaluateKeyframes(clip.bones.b!.position!, 1)).toEqual([2, 3, 0]);
  });

  it("对象形态 pre/post 的 Molang 帧", () => {
    const clip = parseOne({
      b: { position: { "0": { post: "query.anim_time * 4", pre: 0, lerp_mode: "linear" } } },
    });
    expect(evaluateKeyframes(clip.bones.b!.position!, 0.5)).toEqual([2, 2, 2]);
  });

  it("Molang 端点与数字端点之间的线性插值（端点先求值再 lerp）", () => {
    const clip = parseOne({
      b: { position: { "0": "query.anim_time * 10", "1": [20, 5, 5] } },
    });
    // t=0.5：帧0 molang 求值=[5,5,5]，帧1=[20,5,5]，线性中点=[12.5,5,5]
    expect(evaluateKeyframes(clip.bones.b!.position!, 0.5)).toEqual([12.5, 5, 5]);
  });

  it("非法 Molang 编译失败 → 零占位保留帧，解析不抛错", () => {
    const clip = parseOne({ b: { rotation: { "0": "(((" } } });
    expect(clip.bones.b!.rotation![0].post).toEqual([0, 0, 0]);
  });

  it("可折叠常量优先于 Molang 编译（回归保护）", () => {
    const clip = parseOne({ b: { rotation: { "0": "q.life_time * 0 + 30" } } });
    // 折叠成数字后走旋转通道口径：X/Y 取负、Z 不取负、度→弧度（对齐 RawBoneKeyFrame.init）
    const r30 = 30 * (Math.PI / 180);
    expect(evaluateKeyframes(clip.bones.b!.rotation!, 0.5)).toEqual([-r30, -r30, r30]);
  });
});

describe("旋转通道口径转换（度→弧度，X/Y 取负 — 对齐上游 RotationValue.convert）", () => {
  const D2R = Math.PI / 180;

  function parseOne(bones: unknown): AnimationClip {
    const res = parseBedrockAnimationJSON(
      JSON.stringify({ animations: { x: { animation_length: 1, loop: true, bones } } }),
    );
    expect(res.errors).toEqual([]);
    return res.clips[0];
  }

  it("数字帧：post/pre 同步换算（X/Y 取负、Z 不取负）", () => {
    const clip = parseOne({ b: { rotation: { "0": [10, 20, 30] } } });
    const kf = clip.bones.b!.rotation![0];
    expect(kf.post).toEqual([-10 * D2R, -20 * D2R, 30 * D2R]);
    expect(kf.pre).toEqual(kf.post);
  });

  it("position/scale 通道不做换算（仅 rotation）", () => {
    const clip = parseOne({
      b: { position: { "0": [10, 20, 30] }, scale: { "0": [10, 20, 30] } },
    });
    expect(clip.bones.b!.position![0].post).toEqual([10, 20, 30]);
    expect(clip.bones.b!.scale![0].post).toEqual([10, 20, 30]);
  });

  it("逐轴混合：Molang 轴求值后换算，数字轴直接换算", () => {
    const clip = parseOne({
      b: { rotation: { "0": ["query.anim_time * 90", 45, 0] } },
    });
    // t=1：轴0 = -(90·1)·D2R；轴1 = -45·D2R；轴2 = 0
    const v = evaluateKeyframes(clip.bones.b!.rotation!, 1)!;
    expect(v[0]).toBeCloseTo(-Math.PI / 2, 12);
    expect(v[1]).toBeCloseTo(-Math.PI / 4, 12);
    expect(v[2]).toBe(0);
  });

  it("对象形态 pre/post 双端换算", () => {
    const clip = parseOne({
      b: { rotation: { "0": { post: [0, 90, 0], pre: [0, 0, 0], lerp_mode: "linear" } } },
    });
    const kf = clip.bones.b!.rotation![0];
    expect(kf.post).toEqual([0, -90 * D2R, 0]);
    expect(kf.pre).toEqual([0, 0, 0]);
  });

  it("零值帧换算后仍为零（非法 Molang 零占位不漂移）", () => {
    const clip = parseOne({ b: { rotation: { "0": "(((" } } });
    expect(clip.bones.b!.rotation![0].post).toEqual([0, 0, 0]);
  });
});

describe("catmullrom 插值（官方模型 lerp_mode 不再降级 linear）", () => {
  // 四点 0/1/2/3：p0=[0,0,0] p1=[0,10,0] p2=[10,20,0] p3=[20,10,0]
  const CAT: Keyframe[] = [
    { time: 0, post: [0, 0, 0], pre: [0, 0, 0], lerp: "catmullrom" },
    { time: 1, post: [0, 10, 0], pre: [0, 10, 0], lerp: "catmullrom" },
    { time: 2, post: [10, 20, 0], pre: [10, 20, 0], lerp: "catmullrom" },
    { time: 3, post: [20, 10, 0], pre: [20, 10, 0], lerp: "catmullrom" },
  ];

  it("中点是 C1 样条值而非线性中点（抬升超过 [5,15,0]）", () => {
    // s=0.5 标准 uniform Catmull-Rom：x=4.375, y=16.25（linear 为 [5,15,0]）
    expect(evaluateKeyframes(CAT, 1.5)).toEqual([4.375, 16.25, 0]);
  });

  it("经过两端控制点（s=0 → p1，s=1 → p2）", () => {
    expect(evaluateKeyframes(CAT, 1)).toEqual([0, 10, 0]);
    expect(evaluateKeyframes(CAT, 2)).toEqual([10, 20, 0]);
  });

  it("首尾越界钳制到端点帧 post", () => {
    expect(evaluateKeyframes(CAT, -1)).toEqual([0, 0, 0]);
    expect(evaluateKeyframes(CAT, 5)).toEqual([20, 10, 0]);
  });

  it("首/尾帧的邻界钳制到端点（2 帧猫样条无邻点时仍可求值）", () => {
    const two: Keyframe[] = [
      { time: 0, post: [0, 0, 0], pre: [0, 0, 0], lerp: "catmullrom" },
      { time: 1, post: [1, 1, 1], pre: [1, 1, 1], lerp: "catmullrom" },
    ];
    expect(evaluateKeyframes(two, 0.5)).toEqual([0.5, 0.5, 0.5]);
  });

  it("parse 认 lerp_mode: catmullrom（不再按 linear 降级）", () => {
    const json = JSON.stringify({
      animations: {
        a: {
          bones: {
            b: {
              rotation: {
                "0": { post: [0, 0, 0], lerp_mode: "catmullrom" },
                "1": { post: [0, 30, 0], lerp_mode: "catmullrom" },
              },
            },
          },
        },
      },
    });
    const r = parseBedrockAnimationJSON(json);
    expect(r.errors).toEqual([]);
    const kfs = r.clips[0].bones.b!.rotation!;
    expect(kfs[0].lerp).toBe("catmullrom");
    expect(kfs[1].lerp).toBe("catmullrom");
    // 旋转通道仍走度→弧度换算（X/Y 取负），不因 catmullrom 破坏
    expect(kfs[1].post).toEqual([0, -30 * (Math.PI / 180), 0]);
  });
});
