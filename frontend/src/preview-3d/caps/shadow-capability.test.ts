// @vitest-environment node
// ===== ShadowCapability 测试（ADR-196 迁移至 envState）=====
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { ShadowCapability } from "./shadow-capability.ts";
import { envState, resetEnvState, setEnvState } from "../state/env-state.ts";
import { LightCapability } from "./light-capability.ts";

function makeFakeRenderer() {
  return {
    shadowMap: {
      enabled: false,
      type: THREE.PCFSoftShadowMap,
      needsUpdate: false,
    },
    capabilities: { isWebGL2: true, maxTextures: 16 },
    properties: new Map(),
    info: { autoReset: true, memory: { textures: 0, geometries: 0 }, render: { calls: 0, triangles: 0, points: 0, frame: 0 }, reset: () => {} },
    domElement: { style: {}, tagName: "CANVAS" } as unknown as HTMLCanvasElement,
    getSize: () => ({ width: 512, height: 512 }),
    getPixelRatio: () => 1,
    getContext: () => null,
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1,
  } as unknown as THREE.WebGLRenderer;
}

/** stub LightCapability：只提供 shadow 侧消费的两个 getter */
function stubLightCap(dirs: THREE.DirectionalLight[], spot: THREE.SpotLight | null) {
  return {
    getDirectionalLights: () => dirs,
    getSpotLight: () => spot,
  } as unknown as LightCapability;
}

interface Ctx {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  lights: { dir: THREE.DirectionalLight; dir2?: THREE.DirectionalLight; spot?: THREE.SpotLight };
}

function setup(opts: { extraDir?: boolean; spot?: boolean } = {}): Ctx & { cap: ShadowCapability } {
  const scene = new THREE.Scene();
  const renderer = makeFakeRenderer();
  const dir = new THREE.DirectionalLight(0xffffff, 1);
  scene.add(dir);
  const lights: Ctx["lights"] = { dir };
  if (opts.extraDir) {
    lights.dir2 = new THREE.DirectionalLight(0xffffff, 0.5);
    scene.add(lights.dir2);
  }
  if (opts.spot) {
    lights.spot = new THREE.SpotLight(0xffffff, 2);
    scene.add(lights.spot);
  }
  const cap = new ShadowCapability({ scene, renderer, enabled: true });
  cap.syncLights([
    lights.dir,
    ...(lights.dir2 ? [lights.dir2] : []),
    ...(lights.spot ? [lights.spot] : []),
  ]);
  return { scene, renderer, lights, cap };
}

function makeMesh(parent: THREE.Object3D, cast = false, receive = false) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  parent.add(mesh);
  return mesh;
}

describe("ShadowCapability — collectLights 取灯语义（白名单，不遍历场景）", () => {
  beforeEach(() => { resetEnvState(); });

  it("只认 lightCap/legacyLights 两个来源：场景里未接线的灯不被纳入阴影配置", () => {
    const scene = new THREE.Scene();
    const renderer = makeFakeRenderer();
    const wired = new THREE.DirectionalLight(0xffffff, 1);
    const stray = new THREE.DirectionalLight(0xffffff, 0.3);
    scene.add(wired, stray);
    const cap = new ShadowCapability({ scene, renderer, enabled: true });
    cap.syncLights([wired]);
    expect(wired.castShadow).toBe(true);
    expect(stray.castShadow).toBe(false);
  });

  it("lightCap 注入的灯即使不在 syncLights 缓存里也会被纳入", () => {
    const scene = new THREE.Scene();
    const renderer = makeFakeRenderer();
    const lightCap = new LightCapability({ scene, renderer });
    const cap = new ShadowCapability({ scene, renderer, enabled: true });
    cap.setLightCap(lightCap);
    for (const dl of lightCap.getDirectionalLights()) {
      expect(dl.castShadow).toBe(true);
    }
  });
});

describe("ShadowCapability — 构造与默认值", () => {
  beforeEach(() => { resetEnvState(); });

  it("构造默认值完整", () => {
    const { scene, renderer } = { scene: new THREE.Scene(), renderer: makeFakeRenderer() };
    const cap = new ShadowCapability({ scene, renderer });
    expect(cap.isEnabled()).toBe(true);
    expect(cap.getMapSize()).toBe(2048);
    expect(cap.isSoft()).toBe(false);
    expect(cap.getBias()).toBe(-0.0005);
    expect(cap.getNormalBias()).toBe(0.02);
    expect(cap.getCameraSize()).toBe(15);
  });

  it("enabled:false 初始禁用", () => {
    const { scene, renderer } = { scene: new THREE.Scene(), renderer: makeFakeRenderer() };
    const cap = new ShadowCapability({ scene, renderer, enabled: false });
    expect(cap.isEnabled()).toBe(false);
  });

  it("setEnvState 覆盖生效", () => {
    setEnvState({ shadowMapSize: 2048, shadowType: "soft", shadowCameraSize: 20 }, { source: 'manual' });
    const { scene, renderer } = { scene: new THREE.Scene(), renderer: makeFakeRenderer() };
    const cap = new ShadowCapability({ scene, renderer });
    expect(cap.getMapSize()).toBe(2048);
    expect(cap.isSoft()).toBe(true);
    expect(cap.getCameraSize()).toBe(20);
  });
});

describe("ShadowCapability — apply 管线（真实灯对象）", () => {
  beforeEach(() => { resetEnvState(); });

  it("setEnabled(true) 后 shadowMap 开启、hard → BasicShadowMap", () => {
    const { renderer, cap } = setup();
    cap.setEnabled(true);
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(renderer.shadowMap.type).toBe(THREE.BasicShadowMap);
    expect(renderer.shadowMap.needsUpdate).toBe(true);
  });

  it("软阴影 → PCFSoftShadowMap", () => {
    const { renderer, cap } = setup();
    cap.setSoft(true);
    cap.setEnabled(true);
    expect(renderer.shadowMap.type).toBe(THREE.PCFSoftShadowMap);
  });

  it("方向灯 shadow 参数全量下发（mapSize/bias/normalBias/相机视锥）", () => {
    const { lights, cap } = setup({ extraDir: true });
    cap.setMapSize(2048);
    cap.setCameraSize(30);
    cap.setEnabled(true);
    for (const dir of [lights.dir, lights.dir2!]) {
      expect(dir.castShadow).toBe(true);
      expect(dir.shadow.mapSize.x).toBe(2048);
      expect(dir.shadow.mapSize.y).toBe(2048);
      expect(dir.shadow.bias).toBe(envState.shadowBias);
      expect(dir.shadow.normalBias).toBe(envState.shadowNormalBias);
      const cam = dir.shadow.camera as THREE.OrthographicCamera;
      expect(cam.left).toBe(-30);
      expect(cam.right).toBe(30);
      expect(cam.top).toBe(30);
      expect(cam.bottom).toBe(-30);
      expect(cam.near).toBe(0.5);
      expect(cam.far).toBe(100);
      expect(dir.shadow.needsUpdate).toBe(true);
    }
  });

  it("spot 灯 shadow 参数下发且 far=max(distance,50)", () => {
    const { lights, cap } = setup({ spot: true });
    lights.spot!.distance = 20;
    cap.setEnabled(true);
    const sp = lights.spot!;
    expect(sp.castShadow).toBe(true);
    expect(sp.shadow.mapSize.x).toBe(2048);
    expect(sp.shadow.bias).toBe(envState.shadowBias);
    const cam = sp.shadow.camera as THREE.PerspectiveCamera;
    expect(cam.far).toBe(50);
    expect(sp.shadow.needsUpdate).toBe(true);
  });

  it("spot distance 较大时 far 跟随 distance", () => {
    const { lights, cap } = setup({ spot: true });
    lights.spot!.distance = 80;
    cap.setEnabled(true);
    expect((lights.spot!.shadow.camera as THREE.PerspectiveCamera).far).toBe(80);
  });

  it("mesh castShadow/receiveShadow 全量置 true", () => {
    const { scene, cap } = setup();
    const mesh = makeMesh(scene);
    cap.setEnabled(true);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(true);
  });

  it("setEnabled(false) 还原灯与 mesh 原状态及 shadowMap", () => {
    const { scene, renderer, lights, cap } = setup({ spot: true });
    const mesh = makeMesh(scene, true, false);
    lights.dir.castShadow = false;
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    cap.setEnabled(true);
    expect(mesh.castShadow).toBe(true);
    expect(lights.dir.castShadow).toBe(true);

    cap.setEnabled(false);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(false);
    expect(lights.dir.castShadow).toBe(false);
    expect(lights.spot!.castShadow).toBe(false);
    expect(lights.dir.shadow.mapSize.x).toBe(512);
    expect(lights.dir.shadow.bias).toBe(0);
    expect(renderer.shadowMap.enabled).toBe(false);
    expect(renderer.shadowMap.type).toBe(THREE.PCFSoftShadowMap);
  });

  it("分派契约：param-only（bias）in-place 不触发 apply 重建；structural（mapSize）才重建", () => {
    // code_review c979305a9 #4（P3）：structural（mapSize/type）触发 apply 重建
    // （renderer.shadowMap.needsUpdate），param-only（bias/cameraSize）in-place 改灯
    // （仅灯级 shadow.needsUpdate）不得走 apply——若误触发 apply，会把快照/结构值
    // 全量重写（disable→enable 循环泄漏用户调整）
    const { renderer, lights, cap } = setup();
    cap.setEnabled(true); // apply：置 renderer.shadowMap.needsUpdate=true
    renderer.shadowMap.needsUpdate = false; // 清标志（区分后续是否走 apply）
    cap.setBias(0.1); // param-only dispatch：in-place 改灯
    expect(lights.dir.shadow.bias).toBe(0.1); // in-place 生效
    expect(renderer.shadowMap.needsUpdate).toBe(false); // 未触发 apply 重建
    cap.setMapSize(2048); // structural dispatch：apply 重建
    expect(renderer.shadowMap.needsUpdate).toBe(true);
    expect(lights.dir.shadow.mapSize.x).toBe(2048);
  });

  it("不可见 spot 只快照不应用参数（visible=false 跳过）", () => {
    const { lights, cap } = setup({ spot: true });
    lights.spot!.visible = false;
    cap.setEnabled(true);
    expect(lights.spot!.castShadow).toBe(false);
    cap.setEnabled(false);
    expect(lights.spot!.castShadow).toBe(false);
  });

  it("多 spot（legacy 多盏）全部快照并还原", () => {
    const scene = new THREE.Scene();
    const renderer = makeFakeRenderer();
    const sp1 = new THREE.SpotLight(0xffffff, 1);
    const sp2 = new THREE.SpotLight(0xffffff, 1);
    sp1.castShadow = true;
    scene.add(sp1, sp2);
    const cap = new ShadowCapability({ scene, renderer });
    cap.syncLights([sp1, sp2]);
    cap.setEnabled(true);
    expect(sp1.castShadow).toBe(true);
    expect(sp2.castShadow).toBe(true);

    cap.setEnabled(false);
    expect(sp1.castShadow).toBe(true);
    expect(sp2.castShadow).toBe(false);
    expect(sp1.shadow.mapSize.x).toBe(512);
    expect(sp2.shadow.mapSize.x).toBe(512);
  });

  it("dispose 等价 setEnabled(false)：还原一切", () => {
    const { scene, renderer, lights, cap } = setup();
    const mesh = makeMesh(scene);
    cap.setEnabled(true);
    cap.dispose();
    expect(mesh.castShadow).toBe(false);
    expect(lights.dir.castShadow).toBe(false);
    expect(renderer.shadowMap.enabled).toBe(false);
    expect(cap.isEnabled()).toBe(true);
  });

  it("重复 apply 幂等（先清旧快照再应用）", () => {
    const { scene, lights, cap } = setup();
    const mesh = makeMesh(scene, true, true);
    cap.setEnabled(true);
    cap.apply();
    expect(lights.dir.castShadow).toBe(true);
    expect(mesh.castShadow).toBe(true);
    cap.setEnabled(false);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(true);
  });

  it("空场景 apply 不炸", () => {
    const scene = new THREE.Scene();
    const cap = new ShadowCapability({ scene, renderer: makeFakeRenderer() });
    cap.setEnabled(true);
    expect(cap.isEnabled()).toBe(true);
    cap.setEnabled(false);
    expect(cap.isEnabled()).toBe(false);
  });
});

describe("ShadowCapability — collectLights 来源与去重", () => {
  beforeEach(() => { resetEnvState(); });

  it("lightCap 优先提供灯（不经场景遍历）", () => {
    const scene = new THREE.Scene();
    const renderer = makeFakeRenderer();
    const external = new THREE.DirectionalLight(0xffffff, 1);
    const spot = new THREE.SpotLight(0xffffff, 1);
    const cap = new ShadowCapability({ scene, renderer });
    cap.setLightCap(stubLightCap([external], spot));
    cap.setEnabled(true);
    expect(external.castShadow).toBe(true);
    expect(spot.castShadow).toBe(true);
  });

  it("legacy 与 lightCap 重复灯去重（apply 只下发一次，还原可读）", () => {
    const scene = new THREE.Scene();
    const renderer = makeFakeRenderer();
    const dir = new THREE.DirectionalLight(0xffffff, 1);
    const spot = new THREE.SpotLight(0xffffff, 1);
    scene.add(dir, spot);
    const cap = new ShadowCapability({ scene, renderer });
    cap.setLightCap(stubLightCap([dir], spot));
    cap.syncLights([dir, spot]);
    cap.setEnabled(true);
    expect(dir.castShadow).toBe(true);
    expect(spot.castShadow).toBe(true);
    cap.setEnabled(false);
    expect(dir.castShadow).toBe(false);
    expect(spot.castShadow).toBe(false);
  });

  it("lightCap 无 spot 时 legacy spot 补位", () => {
    const scene = new THREE.Scene();
    const renderer = makeFakeRenderer();
    const legacySpot = new THREE.SpotLight(0xffffff, 1);
    scene.add(legacySpot);
    const cap = new ShadowCapability({ scene, renderer });
    cap.setLightCap(stubLightCap([], null));
    cap.syncLights([legacySpot]);
    cap.setEnabled(true);
    expect(legacySpot.castShadow).toBe(true);
    cap.setEnabled(false);
    expect(legacySpot.castShadow).toBe(false);
  });

  it("非方向灯/聚光灯的 legacy 灯被忽略", () => {
    const scene = new THREE.Scene();
    const renderer = makeFakeRenderer();
    const point = new THREE.PointLight(0xffffff, 1);
    scene.add(point);
    const cap = new ShadowCapability({ scene, renderer });
    cap.syncLights([point as unknown as THREE.DirectionalLight]);
    cap.setEnabled(true);
    expect(cap.isEnabled()).toBe(true);
    cap.setEnabled(false);
  });

  it("setLightCap(null) 后 enabled 走 legacy 缓存", () => {
    const scene = new THREE.Scene();
    const renderer = makeFakeRenderer();
    const dir = new THREE.DirectionalLight(0xffffff, 1);
    scene.add(dir);
    const cap = new ShadowCapability({ scene, renderer });
    cap.syncLights([dir]);
    cap.setLightCap(null);
    cap.setEnabled(true);
    expect(dir.castShadow).toBe(true);
    cap.setEnabled(false);
    expect(dir.castShadow).toBe(false);
  });
});

describe("ShadowCapability — setPreset", () => {
  beforeEach(() => { resetEnvState(); });

  it("按 adapterId 映射预设（mmd→soft）", () => {
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    cap.setPreset("mmd");
    expect(cap.isSoft()).toBe(true);
    expect(cap.getMapSize()).toBe(2048);
    expect(cap.getCameraSize()).toBe(15);
    expect(cap.getParams().enabled).toBe(true);
    expect(cap.isEnabled()).toBe(true);
  });

  it("未知 adapterId 落回 default 预设", () => {
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    cap.setPreset("unknown-type");
    expect(cap.isSoft()).toBe(false);
    expect(cap.isEnabled()).toBe(true);
  });

  it("loadState 后 setPreset 不覆盖用户会话配置", () => {
    localStorage.setItem("ysm-scene-cap-shadow", JSON.stringify({ enabled: true, type: "hard", mapSize: 4096 }));
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    cap.loadState();
    cap.setPreset("mmd");
    expect(cap.isSoft()).toBe(false);
    expect(cap.getMapSize()).toBe(4096);
  });
});

describe("ShadowCapability — 跨能力注入", () => {
  beforeEach(() => { resetEnvState(); });

  it("enabled 时 setLightCap 立即 apply", () => {
    const scene = new THREE.Scene();
    const dir = new THREE.DirectionalLight(0xffffff, 1);
    scene.add(dir);
    const cap = new ShadowCapability({ scene, renderer: makeFakeRenderer(), enabled: true });
    expect(dir.castShadow).toBe(false);
    cap.setLightCap(stubLightCap([dir], null));
    expect(dir.castShadow).toBe(true);
  });

  it("enabled 时 syncLights 立即 apply", () => {
    const scene = new THREE.Scene();
    const dir = new THREE.DirectionalLight(0xffffff, 1);
    scene.add(dir);
    const cap = new ShadowCapability({ scene, renderer: makeFakeRenderer(), enabled: true });
    cap.syncLights([dir]);
    expect(dir.castShadow).toBe(true);
  });
});

describe("ShadowCapability — syncMeshes / applyMeshCasts", () => {
  beforeEach(() => { resetEnvState(); });

  it("enabled 时对 roots mesh 快照并置 true；重复调用还原旧快照不累积", () => {
    const { scene, cap } = setup();
    const m1 = makeMesh(scene, true, true);
    cap.setEnabled(true);
    cap.syncMeshes([m1]);
    expect(m1.castShadow).toBe(true);
    const m2 = makeMesh(scene, false, false);
    cap.syncMeshes([m2]);
    expect(m1.castShadow).toBe(true);
    expect(m2.castShadow).toBe(true);
    cap.setEnabled(false);
    expect(m2.castShadow).toBe(false);
    expect(m2.receiveShadow).toBe(false);
  });

  it("disabled 时 syncMeshes 仅还原之前快照", () => {
    const { scene, cap } = setup();
    const m1 = makeMesh(scene);
    cap.setEnabled(true);
    cap.syncMeshes([m1]);
    expect(m1.castShadow).toBe(true);
    cap.setEnabled(false);
    expect(m1.castShadow).toBe(false);
    const m2 = makeMesh(scene);
    cap.syncMeshes([m2]);
    expect(m2.castShadow).toBe(false);
  });

  it("applyMeshCasts 等价 syncMeshes", () => {
    const { scene, cap } = setup();
    const m1 = makeMesh(scene);
    cap.setEnabled(true);
    cap.applyMeshCasts([m1]);
    expect(m1.castShadow).toBe(true);
    expect(m1.receiveShadow).toBe(true);
    cap.setEnabled(false);
    expect(m1.castShadow).toBe(false);
  });

  it("嵌套子树 mesh 全部处理（traverse 递归）", () => {
    const { scene, cap } = setup();
    const group = new THREE.Group();
    const inner = makeMesh(group);
    scene.add(group);
    cap.setEnabled(true);
    cap.syncMeshes([group]);
    expect(inner.castShadow).toBe(true);
  });
});

describe("ShadowCapability — enabled 状态下参数直改", () => {
  beforeEach(() => { resetEnvState(); });

  it("setBias 直改灯 shadow.bias（含 spot）", () => {
    const { lights, cap } = setup({ spot: true });
    cap.setEnabled(true);
    cap.setBias(-0.002);
    expect(cap.getBias()).toBe(-0.002);
    expect(lights.dir.shadow.bias).toBe(-0.002);
    expect(lights.spot!.shadow.bias).toBe(-0.002);
  });

  it("setNormalBias 直改灯 shadow.normalBias", () => {
    const { lights, cap } = setup({ spot: true });
    cap.setEnabled(true);
    cap.setNormalBias(0.08);
    expect(cap.getNormalBias()).toBe(0.08);
    expect(lights.dir.shadow.normalBias).toBe(0.08);
    expect(lights.spot!.shadow.normalBias).toBe(0.08);
  });

  it("setCameraSize 直改方向灯相机视锥", () => {
    const { lights, cap } = setup();
    cap.setEnabled(true);
    cap.setCameraSize(40);
    const cam = lights.dir.shadow.camera as THREE.OrthographicCamera;
    expect(cam.left).toBe(-40);
    expect(cam.right).toBe(40);
    expect(lights.dir.shadow.needsUpdate).toBe(true);
  });

  it("setSoft 直改 renderer.shadowMap.type", () => {
    const { renderer, cap } = setup();
    cap.setEnabled(true);
    cap.setSoft(true);
    expect(renderer.shadowMap.type).toBe(THREE.PCFSoftShadowMap);
    expect(renderer.shadowMap.needsUpdate).toBe(true);
    cap.setSoft(false);
    expect(renderer.shadowMap.type).toBe(THREE.BasicShadowMap);
  });

  it("setMapSize 合法值在 enabled 下触发 apply", () => {
    const { lights, cap } = setup();
    cap.setEnabled(true);
    cap.setMapSize(4096);
    expect(lights.dir.shadow.mapSize.x).toBe(4096);
  });

  it("disabled 时直改仅更新 envState 不碰灯", () => {
    const { lights, cap } = setup();
    cap.setEnabled(false);
    cap.setBias(-0.003);
    cap.setNormalBias(0.05);
    cap.setCameraSize(60);
    expect(cap.getBias()).toBe(-0.003);
    expect(lights.dir.shadow.bias).toBe(0);
  });
});

describe("ShadowCapability — 分辨率", () => {
  beforeEach(() => { resetEnvState(); });

  it("setMapSize 合法值", () => {
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    cap.setMapSize(2048);
    expect(cap.getMapSize()).toBe(2048);
    cap.setMapSize(4096);
    expect(cap.getMapSize()).toBe(4096);
  });

  it("setMapSize 非法值回退默认", () => {
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    cap.setMapSize(3000);
    expect(cap.getMapSize()).toBe(envState.shadowMapSize);
  });
});

describe("ShadowCapability — 软硬切换 / bias / cameraSize（disabled 基础读写）", () => {
  beforeEach(() => { resetEnvState(); });

  it("setSoft 切换", () => {
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    cap.setSoft(true);
    expect(cap.isSoft()).toBe(true);
    cap.setSoft(false);
    expect(cap.isSoft()).toBe(false);
  });

  it("setBias 读写", () => {
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    cap.setBias(-0.001);
    expect(cap.getBias()).toBe(-0.001);
  });

  it("setNormalBias 读写", () => {
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    cap.setNormalBias(0.05);
    expect(cap.getNormalBias()).toBe(0.05);
  });

  it("setCameraSize 限制 [5, 80]", () => {
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    cap.setCameraSize(30);
    expect(cap.getCameraSize()).toBe(30);
    cap.setCameraSize(3);
    expect(cap.getCameraSize()).toBe(5);
    cap.setCameraSize(100);
    expect(cap.getCameraSize()).toBe(80);
  });
});

describe("ShadowCapability — 持久化", () => {
  beforeEach(() => { localStorage.clear(); resetEnvState(); });
  afterEach(() => { localStorage.clear(); });

  it("saveState / loadState 完整周期", () => {
    setEnvState({ shadowMapSize: 2048, shadowType: "soft", shadowBias: -0.001, shadowNormalBias: 0.05, shadowCameraSize: 20 }, { source: 'manual' });
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer(), enabled: true });
    cap.saveState();
    resetEnvState();
    const cap2 = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    cap2.loadState();
    expect(cap2.isEnabled()).toBe(true);
    expect(cap2.getMapSize()).toBe(2048);
    expect(cap2.isSoft()).toBe(true);
    expect(cap2.getBias()).toBe(-0.001);
    expect(cap2.getNormalBias()).toBe(0.05);
    expect(cap2.getCameraSize()).toBe(20);
  });

  it("loadState 空存储时保持默认值", () => {
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    cap.loadState();
    expect(cap.getMapSize()).toBe(2048);
  });

  it("loadState 兼容旧 soft 字段", () => {
    localStorage.setItem("ysm-scene-cap-shadow", JSON.stringify({ enabled: true, soft: true, mapSize: 2048, bias: -0.001, normalBias: 0.02, cameraSize: 15 }));
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    cap.loadState();
    expect(cap.isEnabled()).toBe(true);
    expect(cap.isSoft()).toBe(true);
    expect(cap.getMapSize()).toBe(2048);
  });

  it("loadState 类型不匹配字段跳过（mapSize/bias 传字符串）", () => {
    localStorage.setItem("ysm-scene-cap-shadow", JSON.stringify({ mapSize: "big", bias: null, cameraSize: "40" }));
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    cap.loadState();
    expect(cap.getMapSize()).toBe(envState.shadowMapSize);
    expect(cap.getBias()).toBe(envState.shadowBias);
    expect(cap.getCameraSize()).toBe(envState.shadowCameraSize);
  });

  it("loadState 非法 type 且无 soft 字段保持默认 hard", () => {
    localStorage.setItem("ysm-scene-cap-shadow", JSON.stringify({ type: "blur", enabled: true }));
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    cap.loadState();
    expect(cap.isSoft()).toBe(false);
    expect(cap.isEnabled()).toBe(true);
  });

  it("loadState(enabled=true) 触发 apply 开启 shadowMap", () => {
    const scene = new THREE.Scene();
    const dir = new THREE.DirectionalLight(0xffffff, 1);
    scene.add(dir);
    const renderer = makeFakeRenderer();
    localStorage.setItem("ysm-scene-cap-shadow", JSON.stringify({ enabled: true, type: "soft", mapSize: 2048 }));
    const cap = new ShadowCapability({ scene, renderer });
    cap.syncLights([dir]);
    cap.loadState();
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(renderer.shadowMap.type).toBe(THREE.PCFSoftShadowMap);
    expect(dir.shadow.mapSize.x).toBe(2048);
  });
});

describe("ShadowCapability — getMenuNodes 结构（节点化后 group 由 folder 表达）", () => {
  beforeEach(() => { resetEnvState(); });

  it("非总开关节点全部嵌套在参数组 folder 内（节点化后 group 由 folder 承载）", () => {
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    const nodes = cap.getMenuNodes();
    expect(nodes[0]!.id).toBe("shadow-enabled");
    const folder = nodes[1]!;
    expect(folder.kind).toBe("folder");
    const childIds = folder.children!.map((c) => c.id);
    expect(childIds).toContain("shadow-soft");
    expect(childIds).toContain("shadow-map-size");
    expect(childIds).toContain("shadow-bias");
    expect(childIds).toContain("shadow-normal-bias");
    expect(childIds).toContain("shadow-camera-size");
    expect(folder.labelKey).toBe("preview.shadowGroupParams");
  });

  it("toggle 开关同步状态（节点 control 闭包）", () => {
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    const nodes = cap.getMenuNodes();
    const enabledNode = nodes.find((n) => n.id === "shadow-enabled")!;
    enabledNode.control!.set!(true);
    expect(cap.isEnabled()).toBe(true);
    enabledNode.control!.set!(false);
    expect(cap.isEnabled()).toBe(false);
  });

  it("分辨率选择同步（节点 control 闭包）", () => {
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    const folder = cap.getMenuNodes()[1]!;
    const mapSizeNode = folder.children!.find((c) => c.id === "shadow-map-size")!;
    mapSizeNode.control!.set!("2048");
    expect(cap.getMapSize()).toBe(2048);
  });

  it("软阴影开关同步（节点 control 闭包）", () => {
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    const folder = cap.getMenuNodes()[1]!;
    const softNode = folder.children!.find((c) => c.id === "shadow-soft")!;
    softNode.control!.set!(true);
    expect(cap.isSoft()).toBe(true);
  });

  it("bias / normalBias / cameraSize 滑块同步（节点 control 闭包）", () => {
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    const folder = cap.getMenuNodes()[1]!;
    folder.children!.find((c) => c.id === "shadow-bias")!.control!.set!(-0.002);
    folder.children!.find((c) => c.id === "shadow-normal-bias")!.control!.set!(0.06);
    folder.children!.find((c) => c.id === "shadow-camera-size")!.control!.set!(25);
    expect(cap.getBias()).toBe(-0.002);
    expect(cap.getNormalBias()).toBe(0.06);
    expect(cap.getCameraSize()).toBe(25);
  });
});

describe("ShadowCapability — getMenuNodes（ADR-195 刀2 cap 直产节点）", () => {
  beforeEach(() => { resetEnvState(); });

  function newCap() {
    return new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
  }

  it("完整树 = shadow-enabled 平铺 toggle + 参数组 folder（soft/select/3 slider）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.kind).toBe("toggle");
    expect(nodes[0]!.id).toBe("shadow-enabled");
    expect(nodes[0]!.hintKey).toBe("preview.shadowEnabledHint");
    nodes[0]!.control!.set!(true);
    expect(cap.isEnabled()).toBe(true);
    const folder = nodes[1]!;
    expect(folder.kind).toBe("folder");
    expect(folder.labelKey).toBe("preview.shadowGroupParams");
    expect(folder.children!.map((c) => c.id)).toEqual([
      "shadow-soft",
      "shadow-map-size",
      "shadow-bias",
      "shadow-normal-bias",
      "shadow-camera-size",
    ]);
    expect(folder.children!.map((c) => c.kind)).toEqual([
      "toggle",
      "select",
      "slider",
      "slider",
      "slider",
    ]);
  });

  it("hintKey 节点字段透传（shadow-map-size 等）", () => {
    const cap = newCap();
    const folder = cap.getMenuNodes()[1]!;
    const mapSize = folder.children!.find((c) => c.id === "shadow-map-size")!;
    expect(mapSize.hintKey).toBe("preview.shadowMapSizeDesc");
    expect(mapSize.control!.options!.length).toBe(4);
    mapSize.control!.set!("2048");
    expect(cap.getMapSize()).toBe(2048);
  });

  it("slider 节点读写闭包直连 cap", () => {
    const cap = newCap();
    const folder = cap.getMenuNodes()[1]!;
    const bias = folder.children!.find((c) => c.id === "shadow-bias")!;
    expect(bias.control!.get!(undefined)).toBe(cap.getBias());
    bias.control!.set!(0.002);
    expect(cap.getBias()).toBe(0.002);
  });
});

describe("ShadowCapability — envState 默认值完整", () => {
  beforeEach(() => { resetEnvState(); });

  it("默认值字段齐全", () => {
    expect(envState.shadowEnabled).toBe(true);
    expect(envState.shadowType).toBe("hard");
    expect(envState.shadowMapSize).toBe(2048);
    expect(typeof envState.shadowBias).toBe("number");
    expect(typeof envState.shadowNormalBias).toBe("number");
    expect(typeof envState.shadowCameraSize).toBe("number");
  });
});
