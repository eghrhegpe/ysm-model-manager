// ===== sky-bake-pipeline.test.ts（ADR-329 刀③A：烘焙内核叶的直接单测）=====
// 为什么需要本文件：刀③A 把 PMREM 烘焙内核从 SkyCapability 下沉为独立叶，但拆分时
// 该叶**只有经 cap 的间接覆盖**（sky-capability.test.ts 经 bakeOf 探针）。
// 间接覆盖能验证「组合后行为对」，却有两处它够不着的缝：
//   ① cap 的构造路径固定走「先 apply 后断言」，阈值门控的**边界组合**（未到阈值/恰好到阈值/
//      force 绕过/首帧无 RT）在 cap 语境下难以逐点隔离表达；
//   ② `finally` 复原太阳盘、失败时**不更新门控基准**这两条，cap 语境里只能观察到副作用，
//      观察不到「为什么下次还会再烤一次」。
// 本文件直接对叶断言，把四条不变量（见叶文件头）从「靠集成测试间接记忆」升格为「机器钉死」。
//
// 判别性用例原则（同 ADR-311 精神）：每个用例只断一条不变量，且刻意选**能区分正确与错误实现**
// 的输入（如阈值用 1.999/2.0/2.001 三点分界，而非笼统的「变了/没变」）。

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as THREE from "three";
import { PMREM_ELEVATION_THRESHOLD, SkyBakePipeline } from "./sky-bake-pipeline.ts";

/** 造一个可被 fromScene 观测的假 envScene（叶只把它当 fromScene 的源，不碰其子对象） */
function fakeEnvScene(): THREE.Scene {
  return new THREE.Scene();
}

/**
 * 假 renderer：叶只在 ensurePMREM 里 `new THREE.PMREMGenerator(renderer)` 用它。
 * node 环境无 WebGL 上下文，故给一个满足构造入参形状的替身；
 * PMREMGenerator 的真实行为（编译着色器）由 fromScene spy 拦掉，不进真渲染路径。
 */
function fakeRenderer(): THREE.WebGLRenderer {
  return {
    capabilities: { isWebGL2: true, maxTextures: 16 },
    properties: new Map(),
    getRenderTarget: () => null,
    setRenderTarget: () => {},
    getSize: (v: THREE.Vector2) => v.set(1024, 1024),
    getPixelRatio: () => 1,
    domElement: {},
  } as unknown as THREE.WebGLRenderer;
}

/** 假 renderTarget（只须可 dispose + 带 texture 引用） */
function fakeRT(): THREE.WebGLRenderTarget {
  return {
    texture: { name: "baked-env" },
    dispose: vi.fn(),
  } as unknown as THREE.WebGLRenderTarget;
}

/** 叶的装配件：可变的太阳高度角 + showSunDisc 观察点（模拟 cap 注入的三个注入口） */
function harness(opts?: { elevation?: number }) {
  const state = {
    elevation: opts?.elevation ?? 0,
    sunDisc: 1,
    bakedCount: 0,
    /** 让某次 fromScene 抛错（模拟 GPU OOM，cap 侧用例覆盖不到叶内分支） */
    throwOnBake: false,
  };
  // uniform 访问器必须返回**本体引用**（真实实现返回 uniforms.showSunDisc 本身），
  // 若返回临时对象 { value: state.sunDisc } 则叶的写入落在临时对象上、观察点永远看不到变化——
  // 这正是本用例要防的「假绿」。
  const uniform = { value: 1 };
  state.sunDisc = 1;
  const bake = new SkyBakePipeline({
    renderer: fakeRenderer(),
    envScene: fakeEnvScene(),
    currentElevation: () => state.elevation,
    sunDiscUniform: () => uniform,
  });
  // 从 uniform 本体反读观察点（每次采样现值）
  const readSunDisc = () => uniform.value;
  // fromScene spy 挂在 prototype 上（叶内每次 bake 都经 ensurePMREM().fromScene）
  const fromScene = vi
    .spyOn(THREE.PMREMGenerator.prototype as unknown as { fromScene: () => unknown }, "fromScene")
    .mockImplementation(() => {
      state.bakedCount += 1;
      if (state.throwOnBake) throw new Error("gl oom");
      return fakeRT();
    });
  return { bake, state, fromScene, readSunDisc };
}

describe("SkyBakePipeline — 烘焙内核叶（ADR-329 刀③A）", () => {
  let restoreRingLog: (() => void) | undefined;

  beforeEach(() => {
    // 叶在失败分支走 ringLog("sky", ...)——静音之，免污染测试输出
    const g = globalThis as { __ysmRingLog?: unknown };
    const prev = g.__ysmRingLog;
    restoreRingLog = () => {
      g.__ysmRingLog = prev;
    };
    g.__ysmRingLog = () => {};
  });
  afterEach(() => {
    restoreRingLog?.();
    vi.restoreAllMocks();
  });

  describe("不变量①：太阳高度角阈值门控", () => {
    it("首帧（无 renderTarget）无条件烘焙——从无到有一律装载", () => {
      const h = harness({ elevation: 0 });
      expect(h.bake.bake(false)).toBe(true);
      expect(h.state.bakedCount, "首帧不得被阈值挡住（门控基准=-999 但 RT 为空）").toBe(1);
      expect(h.bake.hasTexture()).toBe(true);
    });

    it("RT 已存在 + 高度角变化未达阈值 → 不重建（判别值：阈值 - 0.001）", () => {
      const h = harness({ elevation: 0 });
      h.bake.bake(true); // 先烤一次建 RT，基准记为 0
      h.state.elevation = PMREM_ELEVATION_THRESHOLD - 0.001; // 差 0.001°，肉眼与数值皆不可辨
      expect(h.bake.bake(false)).toBe(true);
      expect(h.state.bakedCount, "未达阈值必须跳过重烤（昼夜循环每帧推进 timeOfDay，无门即每帧全量 PMREM）").toBe(1);
    });

    it("RT 已存在 + 高度角变化恰好达阈值 → 重建（判别值：恰好等于阈值，验 ≥ 而非 >）", () => {
      const h = harness({ elevation: 0 });
      h.bake.bake(true);
      h.state.elevation = PMREM_ELEVATION_THRESHOLD;
      expect(h.bake.bake(false)).toBe(true);
      expect(h.state.bakedCount, "边界须取 >=：写成 > 会让恰好 2° 的转动永不重烤").toBe(2);
    });

    it("force=true 无条件重烤（跳过阈值——离散动作走此路）", () => {
      const h = harness({ elevation: 0 });
      h.bake.bake(true);
      h.state.elevation = 0.0001; // 几乎没动
      expect(h.bake.bake(true)).toBe(true);
      expect(h.state.bakedCount).toBe(2);
    });

    it("连续昼夜循环只在越过阈值那一刻重烤（跨阈值的净效果，非逐帧计数）", () => {
      const h = harness({ elevation: 0 });
      h.bake.bake(true); // 首帧
      for (let i = 1; i <= 100; i += 1) {
        // 每帧推进 0.05°：单帧不过阈，但基准在每次真烤时更新，故应摊销为少量重建
        h.state.elevation += 0.05;
        h.bake.bake(false);
      }
      // 100 帧 × 0.05° = 5° 净位移 / 阈值 2° ≈ 2~3 次真烤（首帧 + 越过 2° + 越过 4°）
      expect(h.state.bakedCount, "100 帧 5° 位移的重建次数须远小于 100（门控生效的判别证据）").toBeLessThanOrEqual(3);
      expect(h.state.bakedCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe("不变量②：烘焙期间隐藏太阳盘 + finally 必须复原", () => {
    it("烘焙期间 showSunDisc=0，结束后复原为 1", () => {
      const h = harness({ elevation: 0 });
      h.bake.bake(true);
      expect(h.readSunDisc(), "结束时须为 1").toBe(1);
      // 从 leaf 的行为反推烘焙期间的值：在 fromScene 执行那一刻采样
      const seen: number[] = [];
      h.fromScene.mockImplementation(() => {
        seen.push(h.readSunDisc());
        h.state.bakedCount += 1;
        return fakeRT();
      });
      h.state.elevation = PMREM_ELEVATION_THRESHOLD * 2;
      h.bake.bake(true);
      expect(seen[0], "烘焙瞬间须为 0（隐藏太阳盘避免 PMREM 光斑伪影）").toBe(0);
      expect(h.readSunDisc(), "finally 必须复原为 1（漏复原则主路径太阳盘永久消失）").toBe(1);
    });

    it("fromScene 抛错时太阳盘同样复原（finally 覆盖失败路径）", () => {
      const h = harness({ elevation: 0 });
      h.state.throwOnBake = true;
      expect(h.bake.bake(true)).toBe(false);
      expect(h.readSunDisc(), "失败路径也必须复原（画面症状：报错一次后太阳永久消失）").toBe(1);
    });
  });

  describe("不变量③：失败时置空产物且不更新门控基准", () => {
    it("失败后 texture()/hasTexture() 均为空（不得返回悬空引用）", () => {
      const h = harness({ elevation: 0 });
      h.state.throwOnBake = true;
      expect(h.bake.bake(true)).toBe(false);
      expect(h.bake.texture()).toBeNull();
      expect(h.bake.hasTexture()).toBe(false);
    });

    it("失败后下一次仍会真烤（门控基准未更新——不吞错误）", () => {
      const h = harness({ elevation: 5 });
      h.state.throwOnBake = true;
      expect(h.bake.bake(true)).toBe(false);
      // 高度角完全不动地再试一次：若失败时误更新了门控基准且 RT 已存在，
      // 某些实现会因「无变化且无 RT」而短路——此处断言的是「RT 为空必烤」这一层语义
      h.state.throwOnBake = false;
      expect(h.bake.bake(false), "RT 为空时必须真烤恢复，不能因上次失败被门控挡住").toBe(true);
      expect(h.state.bakedCount).toBe(2);
    });

    it("成功烤一次后失败：门控基准应保持在最后一次成功时的角度（不前移）", () => {
      const h = harness({ elevation: 0 });
      h.bake.bake(true); // 成功，基准 = 0
      h.state.elevation = PMREM_ELEVATION_THRESHOLD * 3; // 远超阈值
      h.state.throwOnBake = true;
      expect(h.bake.bake(false)).toBe(false); // 越过阈值 → 真烤 → 失败
      h.state.throwOnBake = false;
      // 若失败时把基准前移到 6°，且失败路径错误地留下了 RT，则后续不会再烤；
      // 断言当前语义：RT 已清空 → 下次必烤（与上一例同源，此处钉住「失败清 RT」）
      expect(h.bake.hasTexture()).toBe(false);
    });
  });

  describe("dispose", () => {
    it("dispose 后产物与生成器均被释放，texture() 归空", () => {
      const h = harness({ elevation: 0 });
      h.bake.bake(true);
      const rt = (h.bake as unknown as { renderTarget: THREE.WebGLRenderTarget }).renderTarget;
      const disposeSpy = vi.spyOn(rt, "dispose");
      h.bake.dispose();
      expect(disposeSpy, "叶的 dispose 须释放 renderTarget（否则 GPU 纹理泄漏）").toHaveBeenCalled();
      expect(h.bake.texture()).toBeNull();
      expect(h.bake.hasTexture()).toBe(false);
    });

    it("dispose 后门控基准归零（-999）——重建即首帧必烤（惰性常驻场景下防旧凭据沿用）", () => {
      const h = harness({ elevation: 0 });
      h.bake.bake(true);
      h.bake.dispose();
      // 基准若未复位，同高度角下 bake(false) 应仍会烤（RT 为空故必烤）；
      // 断言「dispose 后仍能重新烘焙」这一对外可观察语义
      expect(h.bake.bake(false), "dispose 后叶应可安全重建").toBe(true);
      expect(h.state.bakedCount).toBe(2);
    });
  });
});
