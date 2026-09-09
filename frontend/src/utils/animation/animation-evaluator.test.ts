// @vitest-environment node
// ===== animation-evaluator.ts 烟雾测试（ADR-212 拆分验证）=====
// 验证求值器模块独立导出正确。详细测试见 animation.test.ts。
import { describe, it, expect } from "vitest";
import {
  evaluateKeyframes,
  evaluateClip,
  executeTimeline,
  ysmAnimClipLabels,
} from "./animation-evaluator.ts";
import type { Keyframe, AnimationClip } from "./animation.ts";

describe("animation-evaluator 模块导出", () => {
  it("evaluateKeyframes 可独立导入并工作", () => {
    const kfs: Keyframe[] = [
      { time: 0, post: [0, 0, 0], pre: [0, 0, 0], lerp: "linear" },
      { time: 1, post: [10, 20, 30], pre: [10, 20, 30], lerp: "linear" },
    ];
    expect(evaluateKeyframes(kfs, 0.5)).toEqual([5, 10, 15]);
  });

  it("evaluateClip 可独立导入并工作", () => {
    const clip: AnimationClip = {
      name: "test",
      loop: true,
      length: 2,
      bones: {
        b: {
          rotation: [
            { time: 0, post: [0, 0, 0], pre: [0, 0, 0], lerp: "linear" },
            { time: 1, post: [10, 20, 30], pre: [10, 20, 30], lerp: "linear" },
          ],
        },
      },
    };
    const r = evaluateClip(clip, 0.5);
    expect(r.get("b")!.rotation).toEqual([5, 10, 15]);
  });

  it("executeTimeline 可独立导入并工作", () => {
    const calls: number[] = [];
    const timeline = [
      { time: 0.5, actions: [(t: number) => calls.push(t)], raw: ["e1"] },
    ];
    executeTimeline(timeline, 0.2, 0.7);
    expect(calls).toEqual([0.7]);
  });

  it("ysmAnimClipLabels 可独立导入并工作", () => {
    const clip: AnimationClip = { name: "idle", loop: true, length: 1, bones: {} };
    expect(ysmAnimClipLabels("run", [clip])).toEqual(["run"]);
  });
});
