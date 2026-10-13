// ===== keyframes 单一事实源契约测试（node 环境，纯串断言）=====
// 背景（见 views/css/keyframes.ts 头注）：@keyframes 不穿透 Shadow DOM 边界，
// 跨 shadow 共享的 keyframe 收敛为 TS 常量（模板注入各 shadow CSS 串）。
// 本测试锁新常量的形状契约——名字/关键帧内容/与全局 components.css 同步提醒。
// 先例：FADE_SLIDE_LEFT 曾由注释人肉保证一致性（2026-08-24 评审 + 2026-09 锐评 P0 立法）。
import { describe, expect, it } from "vitest";
import { FADE_SLIDE_LEFT, PULSE_DOT } from "@/views/css/keyframes.ts";

describe("keyframes 单一事实源常量契约", () => {
  it("FADE_SLIDE_LEFT：既有契约不回归（translateX(-8px) 起手）", () => {
    expect(FADE_SLIDE_LEFT).toContain("@keyframes fadeSlideLeft");
    expect(FADE_SLIDE_LEFT).toContain("translateX(-8px)");
  });

  it("PULSE_DOT：@keyframes 命名 pulseDot，opacity 在 .4 与 1 间脉冲", () => {
    expect(PULSE_DOT).toContain("@keyframes pulseDot");
    // 呼吸 = 透明度往返：关键帧内须同时命中低值（.4，与 .tree-drop-hint .dot 基础态同值）
    // 和高值（1），动画才有「呼吸」而不是恒亮/恒灭
    expect(PULSE_DOT).toContain("opacity:.4");
    expect(PULSE_DOT).toContain("opacity:1");
  });

  it("PULSE_DOT：关键帧体不含 transform（纯透明度脉冲，不触发布局）", () => {
    // dot 是 6px 圆点，transform 缩放会带 layout/合成开销且视觉抖动，
    // 呼吸提示只要 opacity 足够（合成器友好，降级为静态也无语义损失）
    expect(PULSE_DOT).not.toContain("transform");
  });

  it("两个常量都是合法 keyframes 串（@keyframes 开头、花括号配平）", () => {
    for (const c of [FADE_SLIDE_LEFT, PULSE_DOT]) {
      expect(c.startsWith("@keyframes")).toBe(true);
      const open = (c.match(/\{/g) ?? []).length;
      const close = (c.match(/\}/g) ?? []).length;
      expect(open).toBe(close);
      expect(open).toBeGreaterThan(0);
    }
  });
});
