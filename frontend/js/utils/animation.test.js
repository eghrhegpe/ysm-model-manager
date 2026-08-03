// ===== 骨骼动画计算测试（ADR-021 扩展，坐标高危区）=====
// evaluateKeyframes（插值）/ parseBedrockAnimationJSON（解析）/ evaluateClip（父级传播）。
import { describe, it, expect } from "vitest";
import {
  evaluateKeyframes,
  parseBedrockAnimationJSON,
  evaluateClip,
} from "./animation.ts";

const KFS = [
  { time: 0, post: [0, 0, 0], lerp: "linear" },
  { time: 1, post: [10, 20, 30], lerp: "linear" },
  { time: 2, post: [20, 20, 30], lerp: "linear" },
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
    const stepKfs = [
      { time: 0, post: [1, 1, 1], lerp: "step" },
      { time: 1, post: [9, 9, 9], lerp: "step" },
    ];
    expect(evaluateKeyframes(stepKfs, 0.5)).toEqual([1, 1, 1]);
  });

  it("t 恰为帧时间返回对应帧 post（重复时间帧取首帧）", () => {
    const dup = [
      { time: 0, post: [3, 3, 3], lerp: "linear" },
      { time: 0, post: [5, 5, 5], lerp: "linear" },
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
});

describe("evaluateClip 变换传播", () => {
  it("空 clip 返回空 Map", () => {
    expect(evaluateClip({ name: "x", loop: false, length: 0, bones: {} }, 0).size).toBe(0);
  });

  it("循环动画按 length 取模", () => {
    const clip = {
      name: "x",
      loop: true,
      length: 2,
      bones: { b: { rotation: KFS } },
    };
    // t=3 → 3%2=1 → 帧值 [10,20,30]
    const r = evaluateClip(clip, 3);
    expect(r.get("b").rotation).toEqual([10, 20, 30]);
  });

  it("非循环动画 t 超长钳制到末帧", () => {
    const clip = {
      name: "x",
      loop: false,
      length: 2,
      bones: { b: { position: KFS } },
    };
    const r = evaluateClip(clip, 100);
    expect(r.get("b").position).toEqual([20, 20, 30]);
  });

  it("父级变换传播到子级（旋转相加 / 位置相加 / 缩放相乘）", () => {
    const clip = {
      name: "x",
      loop: false,
      length: 1,
      bones: {
        root: {
          rotation: KFS, // t=0 → [0,0,0]
          position: [{ time: 0, post: [1, 2, 3], lerp: "linear" }],
          scale: [{ time: 0, post: [2, 2, 2], lerp: "linear" }],
        },
        child: {
          rotation: [{ time: 0, post: [10, 0, 0], lerp: "linear" }],
          position: [{ time: 0, post: [5, 0, 0], lerp: "linear" }],
          scale: [{ time: 0, post: [3, 1, 1], lerp: "linear" }],
        },
      },
    };
    const hierarchy = [
      { name: "root", parent: "" },
      { name: "child", parent: "root" },
    ];
    const r = evaluateClip(clip, 0, hierarchy);
    expect(r.get("root").rotation).toEqual([0, 0, 0]);
    expect(r.get("child").rotation).toEqual([10, 0, 0]); // 父 + 子
    expect(r.get("child").position).toEqual([6, 2, 3]); // 1+5, 2+0, 3+0
    expect(r.get("child").scale).toEqual([6, 2, 2]); // 2*3, 2*1, 2*1
  });

  it("localOnly 只返回局部变换，不传播父级", () => {
    const clip = {
      name: "x",
      loop: false,
      length: 1,
      bones: {
        root: { position: [{ time: 0, post: [1, 0, 0], lerp: "linear" }] },
        child: { position: [{ time: 0, post: [5, 0, 0], lerp: "linear" }] },
      },
    };
    const hierarchy = [
      { name: "root", parent: "" },
      { name: "child", parent: "root" },
    ];
    const r = evaluateClip(clip, 0, hierarchy, true);
    expect(r.get("child").position).toEqual([5, 0, 0]); // 不叠加父级
  });
});
