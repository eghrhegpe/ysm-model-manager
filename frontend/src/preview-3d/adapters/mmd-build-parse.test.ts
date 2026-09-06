// ===== mmd-build-parse 单元测试 =====
// P0 review 修复：worker 路径伪造 mmd 的 updateWithMixer 曾是 no-op，
// c.mixer.update(dt) 无人调用 → worker 路径 VMD 动画永不播放（mmd-build-result.ts:58 每帧
// 只走 c.mmd?.updateWithMixer(dt, c.mixer, ...)）。
import { describe, it, expect, vi } from "vitest";
import { workerMmdUpdateWithMixer } from "./mmd-build-parse.ts";



describe("workerMmdUpdateWithMixer（P0：worker 路径动画静止修复）", () => {
  it("转发 delta 到 mixer.update（对齐真实 MMD.updateWithMixer 的 mixer.update(dt) 语义）", () => {
    const mixer = { update: vi.fn() };
    workerMmdUpdateWithMixer(0.016, mixer);
    expect(mixer.update).toHaveBeenCalledTimes(1);
    expect(mixer.update).toHaveBeenCalledWith(0.016);
  });

  it("多次调用每次都推进 mixer（非 no-op）", () => {
    const mixer = { update: vi.fn() };
    workerMmdUpdateWithMixer(0.016, mixer);
    workerMmdUpdateWithMixer(0.032, mixer);
    expect(mixer.update).toHaveBeenCalledTimes(2);
  });
});
