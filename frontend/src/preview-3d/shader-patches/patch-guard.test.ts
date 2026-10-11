// ===== shader-patches/patch-guard 契约测试（2026-09-14 锐评 P1-3 落地）=====
// 覆盖：checkRevision 纯函数（脱离 three 直测版本范围）、assertRevisionRange 范围外 throw、
// reportPatchIssue 的 ringLog→console 兜底（无 __ysmRingLog 挂载时 console 兜底、有挂载走 logger）、
// 守卫接线契约（巡检第 11 轮 F1：三消费者的断言必须落在 createAll 兜底覆盖的构造链内）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import {
  assertRevisionRange,
  checkRevision,
  reportPatchIssue,
} from "./patch-guard.ts";
// 守卫接线契约（巡检第 11 轮 F1）：assertRevisionRange 的失败哲学是「throw → registry
// 工厂 try/catch 兜底 → 恰本 cap 缺失、不崩 mount」。该哲学**只在断言落在构造链内**时成立
// ——[锐评 P1-1] 曾把 reflector 的断言从 apply 期（injectOpacityIntoShader）提回构造期治
// mount 崩病，但修复本身零回归锁：谁把任一处断言挪回 apply/编译期，全套现有测试照绿，
// 病灶（升级 three 后 mount 整体崩）即可复归。本组用例把「三消费者的断言 ∈ 构造链」
// 钉成判据：REVISION 失配态下直接 new 必抛，且经 createAll 端到端只缺 patch 系三 cap。
import { ReflectorCapability } from "@/preview-3d/caps/reflector-capability.ts";
import { SkyCapability } from "@/preview-3d/caps/sky-capability.ts";
import { WaterCapability } from "@/preview-3d/caps/water-capability.ts";
import { sceneCapabilityRegistry } from "@/preview-3d/caps/scene-capability-registry.ts";
import { clearEnvCallbacks } from "@/preview-3d/state/env-dispatcher.ts";

describe("checkRevision 纯函数", () => {
  it("rev 在 allowed 内 → null（无失配）", () => {
    expect(checkRevision("185", ["185"])).toBeNull();
    expect(checkRevision("186", ["185", "186", "187"])).toBeNull();
  });

  it("rev 不在 allowed 内 → 失配说明（含允许列表，便于升级审计定位）", () => {
    const msg = checkRevision("186", ["185"]);
    expect(msg).toContain("186");
    expect(msg).toContain("185");
    expect(msg).toContain("拒绝静默降级");
  });

  it("unknown（REVISION 缺失）→ 失配", () => {
    expect(checkRevision("unknown", ["185"])).not.toBeNull();
  });
});

describe("assertRevisionRange", () => {
  it("范围内 → 不抛（186 为当前已审计版本）", () => {
    expect(() => assertRevisionRange({ module: "sky-patch", allowed: ["186"] })).not.toThrow();
  });

  it("范围外 → 抛错（升级显式化），且 console.error 有兜底留痕", async () => {
    // 临时篡改 REVISION 模拟升级（restoreAllMocks 还原）
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const threeMod = await import("three");
    const orig = (threeMod as { REVISION?: string }).REVISION;
    (threeMod as { REVISION?: string }).REVISION = "199";
    try {
      expect(() => assertRevisionRange({ module: "sky-patch", allowed: ["186"] })).toThrow(
        /sky-patch/,
      );
      expect(spy).toHaveBeenCalled(); // 无 __ysmRingLog 挂载 → console 兜底
    } finally {
      const three = threeMod as { REVISION?: string };
      if (orig !== undefined) three.REVISION = orig;
      else delete three.REVISION;
      spy.mockRestore();
    }
  });
});

describe("reportPatchIssue console 兜底", () => {
  beforeEach(() => {
    delete (globalThis as { __ysmRingLog?: unknown }).__ysmRingLog;
    vi.restoreAllMocks();
  });
  afterEach(() => {
    delete (globalThis as { __ysmRingLog?: unknown }).__ysmRingLog;
    vi.restoreAllMocks();
  });

  it("无 __ysmRingLog 挂载 → console.warn 兜底（生产告警不再落空）", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    reportPatchIssue("water", "锚点失配", "warn");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[water]"));
    spy.mockRestore();
  });

  it("有 __ysmRingLog 挂载 → 走 logger（console 不兜底）", () => {
    const logger = vi.fn();
    (globalThis as { __ysmRingLog?: unknown }).__ysmRingLog = logger;
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    reportPatchIssue("sky", "失配", "warn");
    expect(logger).toHaveBeenCalledWith("sky", expect.stringContaining("失配"), "warn");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ===== 守卫接线契约（巡检第 11 轮 F1）=====
// 失败哲学（water.md 不变量 / 五笔账⑤）：REVISION 失配 = 前提崩塌 → throw → registry
// 工厂 try/catch 兜底 → 恰本 cap 缺失、不崩 mount。该哲学**只在断言落在构造链内**成立：
// [锐评 P1-1] 曾把 reflector 断言从 apply 期（injectOpacityIntoShader）提回构造期治
// mount 崩病，但三消费者的接线本身零回归锁——谁把任一处挪回 apply/编译期，全套现有
// 测试照绿，病灶（升级 three 未审计版 → mount 整体崩）即可静默复归。
// 本组用例把「断言 ∈ 构造链」钉成判据：①失配态下直接 new 必抛；②经 createAll 端到端
// 恰 patch 系三 cap（sky/water/reflector）缺席、无断言 cap（ground 等）照常存活。
describe("守卫接线契约 — REVISION 断言必须在构造链内（失配 → cap 缺失，不崩 mount）", () => {
  const threeMod = THREE as unknown as { REVISION?: string };

  function withUnauditedRevision(fn: () => void): void {
    const orig = threeMod.REVISION;
    threeMod.REVISION = "199"; // 未审计版本（三消费者 allowed 列表均不含）
    try {
      fn();
    } finally {
      if (orig !== undefined) threeMod.REVISION = orig;
    }
  }

  afterEach(() => {
    clearEnvCallbacks();
    sceneCapabilityRegistry.dispose();
  });

  it("sky/water/reflector 构造期即抛（三消费者接线互不相同：reflector 直调 / sky 经 inject / water 经 buildWave 材质链）", () => {
    const scene = new THREE.Scene();
    const renderer = new THREE.WebGLRenderer();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      withUnauditedRevision(() => {
        expect(
          () => new ReflectorCapability({ scene, renderer }),
          "reflector 断言须离开 apply/inject 期、回到构造期（锐评 P1-1 契约）",
        ).toThrow(/reflector-patch/);
        expect(
          () => new SkyCapability({ scene, renderer }),
          "sky 断言须在构造链（injectSkySunScalePatch 于构造期 :146 调用）",
        ).toThrow(/sky-patch/);
        expect(
          () => new WaterCapability({ scene }),
          "water 断言须在材质构造期（buildWaveWaterMaterial，非 onBeforeCompile 编译期）",
        ).toThrow(/water-patch/);
      });
    } finally {
      errSpy.mockRestore();
    }
  });

  it("端到端 createAll：失配态只缺 patch 系三 cap，其余 cap 存活，mount 不崩", () => {
    const scene = new THREE.Scene();
    const renderer = new THREE.WebGLRenderer();
    // FakeWebGLRenderer 无 shadowMap 字段（test-setup），shadow 构造抛与 REVISION 无关——
    // 用真实断言隔离：只验 sky/water/reflector 缺席 + ground 在场。
    (
      renderer as unknown as { shadowMap: { enabled: boolean; type: number; needsUpdate: boolean } }
    ).shadowMap = { enabled: false, type: 0, needsUpdate: false };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      withUnauditedRevision(() => {
        const ids = sceneCapabilityRegistry
          .createAll({ scene, renderer, camera: new THREE.PerspectiveCamera() })
          .map((c) => c.id);
        expect(ids).not.toContain("sky");
        expect(ids).not.toContain("water");
        expect(ids).not.toContain("reflector");
        // 兜底有效性反证：无断言 cap 照常实例化（createAll 没被 throw 打断）
        expect(ids, "ground 应存活（cap 级隔离，非 mount 级崩）").toContain("ground");
      });
    } finally {
      warnSpy.mockRestore();
      errSpy.mockRestore();
    }
  });
});

// ===== 锚点守卫的真实管线校验（巡检第 11 轮 F2）=====
// 病灶家族与第 9 轮 F2 同形：桩的形状 ≠ 生产读取的面。water 锚点检测（reportPatchIssue
// 的 vertexOk/…/reflOk）在全部测试里只吃过手写 fakeShader——fakeShader 只含 5 个 chunk
// 锚点（common/beginnormal/begin_vertex/normal_fragment_maps/dithering），对不上真实
// meshphysical 的文本形态时，桩永远绿，生产真文本才失配。升级 three 到未审计版会先被
// REVISION 断言拦住；本用例补上「锚点与当前安装版真实管线文本逐一对齐」的机器验证，
// 让「升级后先跑测试」的审计节奏（本文件头注）有具体抓手：红 = 锚点串要对新文本重钉。
describe("water onBeforeCompile 六锚点 × 真实 three meshphysical 管线文本", () => {
  afterEach(() => {
    delete (globalThis as { __ysmRingLog?: unknown }).__ysmRingLog;
  });

  /** 从真实 three 取 MeshPhysicalMaterial 的 shader 模板文本（ShaderLib.physical——
   *  WebGLProgram 编译期 onBeforeCompile 收到的含 #include 原文即此模板，与生产同源）。 */
  function realShader(): {
    uniforms: Record<string, { value: unknown }>;
    vertexShader: string;
    fragmentShader: string;
  } {
    const entry = (THREE as unknown as {
      ShaderLib: Record<string, { vertexShader: string; fragmentShader: string } | undefined>;
    }).ShaderLib.physical;
    expect(entry, "ShaderLib.physical 须在场（three 导出形态变了就先修取数再谈锚点）").toBeDefined();
    return {
      uniforms: {},
      vertexShader: entry!.vertexShader,
      fragmentShader: entry!.fragmentShader,
    };
  }

  it("六锚点在真实文本上全部命中（失配即 three 管线 chunk 改名/删除，测试红 = 重钉锚点的信号）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    const mat = (scene.getObjectByName("ysm-ground-water") as THREE.Mesh)
      .material as THREE.MeshPhysicalMaterial;
    const shader = realShader();
    const logged: Array<{ mod: string; msg: string; lvl: string | undefined }> = [];
    (globalThis as { __ysmRingLog?: unknown }).__ysmRingLog = (
      mod: string,
      msg: string,
      lvl?: string,
    ) => logged.push({ mod, msg, lvl });
    mat.onBeforeCompile!(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      undefined as unknown as THREE.WebGLRenderer,
    );
    // ① 告警层：六锚点任一 miss 都会 reportPatchIssue("water", …miss…)
    const miss = logged.filter((l) => l.mod === "water" && l.msg.includes("miss"));
    expect(miss, `water 锚点失配（真实 three 管线文本已漂移？）：${miss.map((m) => m.msg).join()}`).toHaveLength(0);
    // ② 内容层（告警之外的第二判据——防 reportPatchIssue 文案改「miss」字样后判据①失去判别力）：
    //    六处注入必须在真实文本上各自落地
    expect(shader.vertexShader).toContain("vec3 gerstner(");
    expect(shader.vertexShader).toContain("objectNormal = ysmWaveNormal;");
    expect(shader.vertexShader).toContain("transformed.z += gdisp.z;");
    expect(shader.fragmentShader).toContain("uniform sampler2D uReflTex;");
    expect(shader.fragmentShader).toContain("normal = normalize(normal +");
    expect(shader.fragmentShader).toContain("if (uReflStrength > 0.0) {");
  });
});
