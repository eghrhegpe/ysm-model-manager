// @vitest-environment node
// ===== GroundOverlay 单测（锐评 2026-10-09 从 GroundCapability 拆出的叠加层模块）=====
// 覆盖：构造建 mesh + 显隐门控（enabled × groundVisible × 样式非 none）+ dispose 幂等。
// 重建/纹理细节由 ground-effect-matrix.test.ts（像素生成）+ ground-capability.test.ts
//（经 cap 委托的集成行为）兜底，本文件只锁独立 class 的边界行为。
import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { GroundOverlay } from "./ground-overlay.ts";
import { resetEnvState, setEnvState } from "@/preview-3d/state/env-state.ts";

describe("GroundOverlay", () => {
  beforeEach(() => { resetEnvState(); });

  it("构造建 mesh（name ysm-ground-overlay，默认 none 隐藏）", () => {
    const gs = new GroundOverlay(() => true);
    expect(gs.mesh).toBeInstanceOf(THREE.Mesh);
    expect(gs.mesh.name).toBe("ysm-ground-overlay");
    // groundOverlay 默认 "none" → 构造后 hidden
    expect(gs.mesh.visible).toBe(false);
  });

  it("refresh 显隐门控：enabled × groundVisible × 样式非 none（三层合取）", () => {
    const gs = new GroundOverlay(() => true);
    setEnvState({ groundOverlay: "grid", groundVisible: true }, { source: "manual" });
    gs.refresh();
    expect(gs.mesh.visible).toBe(true);
    setEnvState({ groundVisible: false }, { source: "manual" });
    gs.refresh();
    expect(gs.mesh.visible).toBe(false);
    setEnvState({ groundOverlay: "none" }, { source: "manual" });
    gs.refresh();
    expect(gs.mesh.visible).toBe(false);
  });

  it("getEnabled=false 时 refresh 隐藏（能力开关合取）", () => {
    const gs = new GroundOverlay(() => false);
    setEnvState({ groundOverlay: "grid" }, { source: "manual" });
    gs.refresh();
    expect(gs.mesh.visible).toBe(false);
  });

  it("dispose 幂等（摘除 + 释放资源不抛）", () => {
    const gs = new GroundOverlay(() => true);
    setEnvState({ groundOverlay: "grid" }, { source: "manual" });
    gs.refresh();
    gs.dispose();
    expect(() => gs.dispose()).not.toThrow();
  });
});