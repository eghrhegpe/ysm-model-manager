// @vitest-environment happy-dom
// ===== runPostprocCostProbe 主体契约（锐评 infra 轮：补 diff 覆盖率 + 锁 dispose 出口）=====
//
// 背景：该函数原「需真实 WebGL + 活跃会话，按需手动跑，不进 CI」，故主体零测试。
// 但本轮给它加了 `try/finally { timer.dispose() }`（GPU query 孤儿修复），
// **新增行必须有测试覆盖**（check-diff-coverage 60% 阈值），否则修复本身无法进主干。
//
// 本文件用桩注入 infra 现场与 cap 注册表，驱动主体跑到报告产出，锁：
//   ① 环境不具备（无 scene/camera/renderer）→ null（`null` 语义 = 环境不足，非「测得 0」）
//   ② 正常跑完 → 产出报告 + **timer 被 dispose**（query 不残留）
//   ③ 渲染段抛错 → finally 仍释放 query（防中断路径泄漏）
//   ④ 报告核心数字口径（msaaSamples / rtBytes / taxMeaningful）
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type * as THREE from "three";
import {
  runPostprocCostProbe,
  setProbeCapRegistry,
  setProbeInfraSource,
} from "./postproc-cost-probe.ts";

/** 假 WebGL2 上下文：记录 query 创建/删除配对 */
function makeFakeGl(opts: { everReady?: boolean } = {}) {
  const created: object[] = [];
  const deleted: object[] = [];
  const gl = {
    createQuery: vi.fn(() => {
      const q = { id: created.length + 1 };
      created.push(q);
      return q;
    }),
    deleteQuery: vi.fn((q: object) => {
      deleted.push(q);
    }),
    beginQuery: vi.fn(),
    endQuery: vi.fn(),
    getParameter: vi.fn(() => false),
    getQueryParameter: vi.fn((_q: object, p: number) =>
      p === 0x8867 ? opts.everReady === true : 12_000_000,
    ),
    getExtension: vi.fn(() => ({ TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb })),
    getContextAttributes: vi.fn(() => ({ antialias: true })),
    QUERY_RESULT_AVAILABLE: 0x8867,
    QUERY_RESULT: 0x8866,
  };
  return { gl, created, deleted };
}

interface RigOpts {
  everReady?: boolean;
  renderThrows?: boolean;
  ppEnabled?: boolean;
}

function installRig(o: RigOpts = {}) {
  const fake = makeFakeGl({ everReady: o.everReady === true });
  const renderer = {
    domElement: { width: 1920, height: 1080 },
    getPixelRatio: () => 2,
    getContext: () => fake.gl,
    render: vi.fn(() => {
      if (o.renderThrows) throw new Error("render boom");
    }),
  };
  const scene = {};
  const camera = {};
  setProbeInfraSource(() => ({
    scene: scene as unknown as THREE.Scene,
    camera: camera as unknown as THREE.Camera as unknown as THREE.PerspectiveCamera,
    renderer: renderer as unknown as THREE.WebGLRenderer,
  }));
  setProbeCapRegistry({
    getById: (id: string) => {
      if (id === "postprocessing") {
        return {
          isEnabled: () => o.ppEnabled === true,
          render: () => false, // 不走 composer 臂（简化：两臂同直渲）
        };
      }
      return null;
    },
  } as never);
  return { fake, renderer };
}

describe("runPostprocCostProbe — 主体与 query 释放出口", () => {
  beforeEach(() => {
    setProbeInfraSource(null);
    setProbeCapRegistry(null);
  });

  afterEach(() => {
    setProbeInfraSource(null);
    setProbeCapRegistry(null);
    vi.restoreAllMocks();
  });

  it("环境不具备（未注册 infra）→ 返回 null（语义：环境不足，非「测得 0」）", async () => {
    await expect(runPostprocCostProbe()).resolves.toBeNull();
  });

  it("正常跑完 → 产出报告，且 **query 创建数 == 删除数**（timer.dispose 生效）", async () => {
    const { fake } = installRig({ everReady: true });
    const report = await runPostprocCostProbe({ framesPerArm: 2, warmup: 0 });

    expect(report).not.toBeNull();
    expect(report?.canvas.bufferW).toBe(1920);
    expect(report?.canvas.logicalW).toBe(960); // 1920 / pixelRatio 2
    expect(report?.msaaSamples).toBe(4); // antialias 授予 → MSAA 常量
    // 核心不变量：跑完不留孤儿 query
    expect(fake.deleted.length, "创建数 == 删除数").toBe(fake.created.length);
  });

  it("**[query 孤儿修复] 渲染段抛错 → finally 仍释放 query**（中断路径不泄漏）", async () => {
    const { fake } = installRig({ everReady: true, renderThrows: true });
    await expect(runPostprocCostProbe({ framesPerArm: 1, warmup: 0 })).rejects.toThrow("render boom");
    // 关键：即使中途抛错，try/finally 也必须补齐删除
    expect(fake.created.length, "确实创建过 query").toBeGreaterThan(0);
    expect(fake.deleted.length, "抛错路径亦须全部删除").toBe(fake.created.length);
  });

  it("query 永不就绪（后台节流）→ 跑完仍不残留（drain 上限外的兜底删除）", async () => {
    const { fake } = installRig({ everReady: false });
    const report = await runPostprocCostProbe({ framesPerArm: 2, warmup: 0 });
    expect(report).not.toBeNull();
    expect(report?.gpuTimingAvailable, "无就绪样本 ⇒ GPU 时间不可用").toBe(false);
    expect(fake.deleted.length, "未就绪者亦被兜底删除").toBe(fake.created.length);
  });

  it("ppEnabled=false → taxMeaningful=true（A−B 差才是常驻税）", async () => {
    installRig({ everReady: true, ppEnabled: false });
    const report = await runPostprocCostProbe({ framesPerArm: 1, warmup: 0 });
    expect(report?.ppEnabled).toBe(false);
    expect(report?.taxMeaningful).toBe(true);
  });

  it("ppEnabled=true → taxMeaningful=false（差值是全部后处理成本，非税）", async () => {
    installRig({ everReady: true, ppEnabled: true });
    const report = await runPostprocCostProbe({ framesPerArm: 1, warmup: 0 });
    expect(report?.taxMeaningful).toBe(false);
  });

  it("rtBytes 口径：单/双缓冲 = bufferW×bufferH×8×samples（MSAA 上界语义）", async () => {
    installRig({ everReady: true });
    const report = await runPostprocCostProbe({ framesPerArm: 1, warmup: 0 });
    const expectSingle = 1920 * 1080 * 8 * 4;
    expect(report?.rtBytesSingle).toBe(expectSingle);
    expect(report?.rtBytesBoth, "读写双缓冲 = 单值 ×2").toBe(expectSingle * 2);
  });
});
