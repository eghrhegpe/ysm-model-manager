// ===== VRM 骼骼面板 UI 测试（vrm-bone-ui.ts）=====
// 覆盖：makeBonePanelRenderer 驱动——列表渲染（深度缩进）/ 详情区 / 显隐勾选 /
// 拾取联动（click viewContainer → pickBone → 高亮 + 详情）。用 fake VRM + DOM。
import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { makeBonePanelRenderer } from "./vrm-bone-ui.ts";
import { buildVrmBoneTree } from "./vrm-bone.ts";

/** 构造 fake VRM：humanBones 结构对齐 three-vrm（key=boneName，node=Object3D） */
function fakeVrmWithScene(boneNames: string[]): { vrm: unknown; nodes: Map<string, THREE.Object3D>; scene: THREE.Scene } {
  const scene = new THREE.Scene();
  const nodes = new Map<string, THREE.Object3D>();
  for (const n of boneNames) {
    const g = new THREE.Group();
    g.name = n;
    nodes.set(n, g);
    scene.add(g);
  }
  const humanBones: Record<string, { node: THREE.Object3D }> = {};
  for (const n of boneNames) humanBones[n] = { node: nodes.get(n)! };
  return {
    vrm: { humanoid: { humanBones }, scene },
    nodes,
    scene,
  };
}

function mountPanel(): { panel: HTMLElement; cleanup: () => void } {
  const panel = document.createElement("div");
  document.body.appendChild(panel);
  return { panel, cleanup: () => panel.remove() };
}

describe("makeBonePanelRenderer", () => {
  it("列表渲染：深度缩进（根 6px base，逐级 +12px）+ 名称正确", () => {
    const { vrm, nodes } = fakeVrmWithScene(["hips", "spine", "head"]);
    nodes.get("head")!.parent = nodes.get("spine")!;
    nodes.get("spine")!.parent = nodes.get("hips")!;
    const { panel, cleanup } = mountPanel();
    const renderer = makeBonePanelRenderer(buildVrmBoneTree(vrm as never));
    const viewContainer = document.createElement("div");
    const camera = new THREE.PerspectiveCamera();
    const done = renderer(panel, { viewContainer, camera, scene: new THREE.Scene() });
    try {
      const rows = panel.querySelectorAll<HTMLElement>("div[data-bone-id]");
      expect(rows.length).toBe(3);
      // hips depth=0（paddingLeft=6px），spine depth=1（18px），head depth=2（30px）
      const hips = panel.querySelector<HTMLElement>("div[data-bone-id='hips']")!;
      const spine = panel.querySelector<HTMLElement>("div[data-bone-id='spine']")!;
      const head = panel.querySelector<HTMLElement>("div[data-bone-id='head']")!;
      expect(hips.style.paddingLeft).toBe("6px");
      expect(spine.style.paddingLeft).toBe("18px");
      expect(head.style.paddingLeft).toBe("30px");
      expect(hips.querySelector("span")!.textContent).toBe("hips");
    } finally {
      done();
      cleanup();
    }
  });

  it("显隐勾选：toggleBoneVisible 触发（勾选框 onchange）", () => {
    const { vrm, nodes } = fakeVrmWithScene(["hips"]);
    const headNode = nodes.get("hips")!;
    headNode.visible = true;
    const { panel, cleanup } = mountPanel();
    const renderer = makeBonePanelRenderer(buildVrmBoneTree(vrm as never));
    const done = renderer(panel, { viewContainer: document.createElement("div"), camera: new THREE.PerspectiveCamera(), scene: new THREE.Scene() });
    try {
      const cb = panel.querySelector<HTMLInputElement>("input[type='checkbox']")!;
      cb.checked = false;
      cb.dispatchEvent(new Event("change"));
      expect(headNode.visible).toBe(false);
    } finally {
      done();
      cleanup();
    }
  });

  it("行点击：选中高亮 + 详情块原地展开（路径/父/子）", () => {
    const { vrm, nodes } = fakeVrmWithScene(["hips", "spine", "head"]);
    nodes.get("head")!.parent = nodes.get("spine")!;
    nodes.get("spine")!.parent = nodes.get("hips")!;
    const { panel, cleanup } = mountPanel();
    const renderer = makeBonePanelRenderer(buildVrmBoneTree(vrm as never));
    const done = renderer(panel, { viewContainer: document.createElement("div"), camera: new THREE.PerspectiveCamera(), scene: new THREE.Scene() });
    try {
      const spineRow = panel.querySelector<HTMLElement>("div[data-bone-id='spine']")!;
      spineRow.click();
      // 高亮：renderList 重建行后，新 spine 行 style.background 含 rgba
      const spineRowAfter = panel.querySelector<HTMLElement>("div[data-bone-id='spine']")!;
      expect(spineRowAfter.style.background).toContain("rgba");
      // 详情块：插在选中行下方（.bone-detail-inline），含路径/父/子
      const detail = panel.querySelector<HTMLElement>(".bone-detail-inline")!;
      expect(detail).toBeTruthy();
      expect(detail.textContent).toContain("hips / spine");
      expect(detail.textContent).toContain("hips");
      expect(detail.textContent).toContain("head");
    } finally {
      done();
      cleanup();
    }
  });

  it("拾取联动：click viewContainer → raycaster 命中 → 高亮命中骨骼", () => {
    const { vrm, nodes, scene } = fakeVrmWithScene(["hips", "head"]);
    nodes.get("head")!.parent = nodes.get("hips")!;
    // head 挂一个 mesh（raycaster 命中它 → 沿父链找 head）
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    mesh.name = ""; // 未设 name → 沿父链 head（Group name="head" 命中）
    nodes.get("head")!.add(mesh);
    const { panel, cleanup } = mountPanel();
    const viewContainer = document.createElement("div");
    document.body.appendChild(viewContainer);
    const camera = new THREE.PerspectiveCamera();
    const renderer = makeBonePanelRenderer(buildVrmBoneTree(vrm as never));
    const done = renderer(panel, { viewContainer, camera, scene });
    try {
      // mock raycaster.intersectObjects 命中 mesh
      const spy = vi.spyOn(THREE.Raycaster.prototype, "intersectObjects").mockReturnValue([
        { object: mesh, distance: 1 } as unknown as THREE.Intersection,
      ]);
      viewContainer.dispatchEvent(new MouseEvent("click"));
      spy.mockRestore();
      // 高亮 head 行
      const headRow = panel.querySelector<HTMLElement>("div[data-bone-id='head']")!;
      expect(headRow.style.background).toContain("rgba");
    } finally {
      done();
      cleanup();
      viewContainer.remove();
    }
  });

  it("cleanup：移除拾取监听 + 标记 disposed（再 click 不触发）", () => {
    const { vrm } = fakeVrmWithScene(["hips"]);
    const { panel, cleanup } = mountPanel();
    const viewContainer = document.createElement("div");
    const renderer = makeBonePanelRenderer(buildVrmBoneTree(vrm as never));
    const done = renderer(panel, { viewContainer, camera: new THREE.PerspectiveCamera(), scene: new THREE.Scene() });
    done();
    // 清理后 click 不应抛错（disposed 守卫）
    expect(() => viewContainer.dispatchEvent(new MouseEvent("click"))).not.toThrow();
    cleanup();
  });
});
