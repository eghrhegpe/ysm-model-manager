// @vitest-environment happy-dom
// ===== infra/unified-pick —— 拾取器未覆盖不变量 =====
// 集成用例（mount-preview-core.test.ts「统一多模型拾取器」）已覆盖：count<2 早退、隐藏链
// 跳过、boneMaps 回调、拖拽 >5px 过滤。本文件只锁它**未触及**的三类不变量：
//  ① 监听成对性：工厂只注册 pointerdown，dispose 必须按**同一函数引用**解绑
//     （canvas 是跨会话共享单例，漏解绑即监听器累积泄漏）；
//  ② NDC 映射：clientX/Y 必须经 getBoundingClientRect 归一化且 y 轴翻转。集成用例只点
//     **矩形中心**（clientX/Y=400/300，而它从不控制 rect 尺寸），rect 的缩放、偏移与 y 翻转
//     三个自由度在该点位下不可区分；本文件用**可控 rect + 非中心点位**把三者分别钉死。
//  ③ 拖拽阈值边界（==5px 仍算点击，>5px 不算）。
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import * as THREE from "three";
import type { PreviewScene } from "@/preview-3d/adapters/mount-preview-core.ts";
import { sceneRegistry } from "./scene-registry.ts";
import { makeUnifiedPickHandler } from "./unified-pick.ts";

const RECT = { left: 0, top: 0, width: 800, height: 600 };

function makeContent(): PreviewScene {
  return { dispose: vi.fn() } as unknown as PreviewScene;
}

interface Rig {
  handle: (e: MouseEvent) => void;
  dispose: () => void;
  el: HTMLElement;
  addSpy: MockInstance<HTMLElement["addEventListener"]>;
  removeSpy: MockInstance<HTMLElement["removeEventListener"]>;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** 取到工厂注册的 pointerdown 监听（用于模拟按下起点） */
  pointerDown: (x: number, y: number) => void;
}

function makeRig(rect: Partial<DOMRect> = {}): Rig {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, RECT.width / RECT.height, 0.1, 100);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  camera.updateMatrixWorld(true);

  const el = document.createElement("div");
  const addSpy = vi.spyOn(el, "addEventListener");
  const removeSpy = vi.spyOn(el, "removeEventListener");
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    ...RECT,
    ...rect,
    x: 0,
    y: 0,
    right: 0,
    bottom: 0,
    toJSON: () => ({}),
  } as DOMRect);

  const renderer = { domElement: el } as unknown as THREE.WebGLRenderer;
  const { handle, dispose } = makeUnifiedPickHandler(renderer, camera, scene);
  const downCall = addSpy.mock.calls.find((c) => c[0] === "pointerdown");
  if (!downCall) throw new Error("工厂未注册 pointerdown");
  const onDown = downCall[1] as (e: PointerEvent) => void;

  return {
    handle,
    dispose,
    el,
    addSpy,
    removeSpy,
    scene,
    camera,
    pointerDown: (x, y) => onDown({ clientX: x, clientY: y } as PointerEvent),
  };
}

/** 注册一个带根节点的模型（roots 进 objToEntry 索引，拾取按父链归属） */
function registerMesh(rig: Rig, path: string, mesh: THREE.Object3D): string {
  const registered = sceneRegistry.register({
    path,
    rtype: "ysm",
    roots: [mesh],
    content: makeContent(),
  });
  rig.scene.add(mesh);
  rig.scene.updateMatrixWorld(true);
  return registered;
}

/** 真实点击序列：同点位 pointerdown → click */
function tapAt(rig: Rig, x: number, y: number): void {
  rig.pointerDown(x, y);
  rig.handle(new MouseEvent("click", { clientX: x, clientY: y }));
}

/** 拖拽松手序列：起点按下 → 终点 click（位移由两点差决定） */
function dragFrom(rig: Rig, fromX: number, fromY: number, toX: number, toY: number): void {
  rig.pointerDown(fromX, fromY);
  rig.handle(new MouseEvent("click", { clientX: toX, clientY: toY }));
}

beforeEach(() => {
  localStorage.clear();
  sceneRegistry.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
  sceneRegistry.reset();
  localStorage.clear();
});

describe("makeUnifiedPickHandler —— 监听成对性", () => {
  it("只注册 pointerdown；dispose 按同一函数引用解绑（防 canvas 跨会话监听器累积）", () => {
    const rig = makeRig();
    const added = rig.addSpy.mock.calls.filter((c) => c[0] === "pointerdown");
    expect(added.length).toBe(1);
    expect(rig.addSpy.mock.calls.every((c) => c[0] === "pointerdown")).toBe(true); // 不越权注册 click

    rig.dispose();

    const removed = rig.removeSpy.mock.calls.filter((c) => c[0] === "pointerdown");
    expect(removed.length).toBe(1);
    // 函数引用恒等——传匿名包装会让 removeEventListener 静默失配（真实泄漏）
    expect(removed[0][1]).toBe(added[0][1]);
  });
});

describe("makeUnifiedPickHandler —— NDC 映射", () => {
  it("水平：点右侧取右模型、点左侧取左模型（rect 归一化 + 无 x 轴反转）", () => {
    const rig = makeRig();
    const left = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    left.position.set(-4.5, 0, -10);
    const right = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    right.position.set(4.5, 0, -10);
    const idLeft = registerMesh(rig, "/l.ysm", left);
    const idRight = registerMesh(rig, "/r.ysm", right);
    sceneRegistry.setActive(idRight); // 初始活跃 = 右

    tapAt(rig, 700, 300); // NDC x≈+0.75 → 世界 x≈+4.66 → 右模型
    expect(sceneRegistry.getActiveId()).toBe(idRight);

    tapAt(rig, 100, 300); // NDC x≈-0.75 → 世界 x≈-4.66 → 左模型
    expect(sceneRegistry.getActiveId()).toBe(idLeft);
  });

  it("竖直：点上方取上模型、点下方取下模型（clientY → NDC y 翻转）", () => {
    const rig = makeRig();
    const top = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    top.position.set(0, 2.6, -10);
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    bottom.position.set(0, -2.6, -10);
    const idTop = registerMesh(rig, "/t.ysm", top);
    const idBottom = registerMesh(rig, "/b.ysm", bottom);
    sceneRegistry.setActive(idBottom);

    tapAt(rig, 400, 150); // NDC y=+0.5 → 世界上方
    expect(sceneRegistry.getActiveId()).toBe(idTop);

    tapAt(rig, 400, 450); // NDC y=-0.5 → 世界下方
    expect(sceneRegistry.getActiveId()).toBe(idBottom);
  });

  it("rect 偏移参与映射：同一 client 点随 rect.left/top 平移落点不同", () => {
    const base = makeRig();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    mesh.position.set(4.5, 0, -10);
    const id = registerMesh(base, "/o.ysm", mesh);
    const decoy = registerMesh(base, "/o2.ysm", new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));

    tapAt(base, 700, 300); // rect 原点 → NDC x=0.75 → 命中右模型
    expect(sceneRegistry.getActiveId()).toBe(id);
    expect(decoy).not.toBe(id);

    // 同一 clientX 在平移后的 rect 下 NDC 不同（不再命中右模型）
    const shifted = makeRig({ left: 400, top: 300 });
    const mesh2 = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    mesh2.position.set(4.5, 0, -10);
    const sid = registerMesh(shifted, "/s.ysm", mesh2);
    const other = registerMesh(shifted, "/s2.ysm", new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
    sceneRegistry.setActive(other);

    tapAt(shifted, 700, 300); // rect 平移后等价 clientX=300 → NDC -0.25 → 未命中右模型
    expect(sceneRegistry.getActiveId()).toBe(other);

    // 反证：同一 rect 下 clientX = left + 700 才等价命中
    tapAt(shifted, 1100, 600);
    expect(sceneRegistry.getActiveId()).toBe(sid);
  });
});

describe("makeUnifiedPickHandler —— 拖拽阈值边界", () => {
  it("位移恰为 5px 仍算点击；6px 视为 orbit 松手不拾取", () => {
    const rig = makeRig();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4));
    mesh.position.set(0, 0, -10);
    const id = registerMesh(rig, "/d.ysm", mesh);
    const decoy = registerMesh(rig, "/d2.ysm", new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));

    dragFrom(rig, 400, 300, 405, 300); // pointerdown(400,300) → click(405,300)：hypot=5 不算拖拽
    expect(sceneRegistry.getActiveId()).toBe(id);

    sceneRegistry.setActive(decoy);
    dragFrom(rig, 400, 300, 406, 300); // hypot=6 > 5 → 拖拽误触，不拾取
    expect(sceneRegistry.getActiveId()).toBe(decoy);
  });
});
