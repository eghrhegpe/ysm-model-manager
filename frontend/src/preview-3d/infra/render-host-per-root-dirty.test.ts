// ===== [ADR-330] frustum-cull 逐根矩阵置脏契约：perFrame 携带根身份 → 消费端逐根 /
// 无根身份 → 保守全体（正确性不变）=====
// 钉死 render-host rAF 帧循环对 frustum-cull 置脏调用的归属形态（2026-10-12 收口
// 10-11 逐根化遗留的「全体置脏」债）：
//   ① 全 perFrame 有根 → 逐根置脏（只刷真有变换写入的根，静态根不再陪刷）；
//   ② 任一 perFrame 无根 → 全体置脏（保守兜底，含无根回调的归属盲区）；
//   ③ 剔除关闭 → 零置脏调用（restoreModelGroupsVisible 直渲路径）；
//   ④ 无 perFrame → 零置脏调用。
// 反向保护：若有人把逐根改回无条件全体（或漏掉无根回退），本测试即红。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

const frustumMock = vi.hoisted(() => ({
  cullModelGroups: vi.fn(),
  isFrustumCullEnabled: vi.fn(() => true),
  markCullMatricesDirty: vi.fn(),
  restoreModelGroupsVisible: vi.fn(),
}));
vi.mock("./frustum-cull.ts", () => frustumMock);

import { RendererHost } from "./render-host.ts";

/** 受控 rAF（同 render-host.raf-contract.test.ts 的最小实现） */
class ControlledRaf {
  private queue: Array<{ id: number; cb: FrameRequestCallback }> = [];
  private nextId = 1;
  request = (cb: FrameRequestCallback): number => {
    const id = this.nextId++;
    this.queue.push({ id, cb });
    return id;
  };
  cancel = (id: number): void => {
    this.queue = this.queue.filter((f) => f.id !== id);
  };
  flushFrame(): number {
    const batch = this.queue;
    this.queue = [];
    for (const f of batch) f.cb(performance.now());
    return batch.length;
  }
}

function makeInfraStub() {
  return {
    camera: { position: { x: 0, y: 0, z: 0 } },
    controls: { enabled: true },
    orbitTarget: { x: 0, y: 0, z: 0 },
    scene: {},
    renderer: {
      render: vi.fn(),
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
      info: { render: { calls: 0, triangles: 0 } },
    },
  } as unknown as import("@/preview-3d/adapters/shared-infra.ts").SharedInfra;
}

function makeContainerStub(): HTMLElement {
  return { isConnected: false, clientWidth: 0, clientHeight: 0 } as unknown as HTMLElement;
}

describe("[ADR-330] frustum-cull 逐根矩阵置脏", () => {
  let raf: ControlledRaf;
  let host: RendererHost;

  beforeEach(() => {
    vi.clearAllMocks();
    frustumMock.isFrustumCullEnabled.mockReturnValue(true);
    raf = new ControlledRaf();
    vi.stubGlobal("requestAnimationFrame", raf.request);
    vi.stubGlobal("cancelAnimationFrame", raf.cancel);
    host = new RendererHost();
  });

  afterEach(() => {
    host.reset();
    vi.unstubAllGlobals();
  });

  // 各用例：先注册 perFrame（含根身份），再 start()——start 内同步跑的第 1 帧即唯一
  // 置脏轮次（不 flush 第 2 帧，计数恰 1 轮）。
  it("① 全 perFrame 有根 → 逐根置脏（无全体调用），静态根不陪刷", () => {
    const rootA = new THREE.Group();
    const rootB = new THREE.Group();
    host.registerPerFrame(() => {}, rootA);
    host.registerPerFrame(() => {}, rootB);
    host.start(makeContainerStub(), makeInfraStub());
    // 逐根：两次带根调用（插入序），零次无根（全体）调用
    expect(frustumMock.markCullMatricesDirty.mock.calls).toEqual([[rootA], [rootB]]);
    expect(frustumMock.cullModelGroups).toHaveBeenCalled();
  });

  it("② 任一 perFrame 无根 → 保守全体置脏一次（不逐根）", () => {
    const rootA = new THREE.Group();
    host.registerPerFrame(() => {}, rootA);
    host.registerPerFrame(() => {}); // 无根
    host.start(makeContainerStub(), makeInfraStub());
    // 全体形态 = 零参调用（markCullMatricesDirty() 无参）；不得出现带根调用
    expect(frustumMock.markCullMatricesDirty.mock.calls).toEqual([[]]);
  });

  it("③ 剔除关闭 → 零置脏调用（走 restoreModelGroupsVisible 直渲路径）", () => {
    frustumMock.isFrustumCullEnabled.mockReturnValue(false);
    host.registerPerFrame(() => {}, new THREE.Group());
    host.start(makeContainerStub(), makeInfraStub());
    expect(frustumMock.markCullMatricesDirty).not.toHaveBeenCalled();
    expect(frustumMock.cullModelGroups).not.toHaveBeenCalled();
    expect(frustumMock.restoreModelGroupsVisible).toHaveBeenCalledTimes(1);
  });

  it("④ 无 perFrame → 零置脏调用（cullModelGroups 仍跑）", () => {
    host.start(makeContainerStub(), makeInfraStub());
    expect(frustumMock.markCullMatricesDirty).not.toHaveBeenCalled();
    expect(frustumMock.cullModelGroups).toHaveBeenCalledTimes(1);
  });
});
