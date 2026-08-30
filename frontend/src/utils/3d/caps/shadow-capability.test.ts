// @vitest-environment node
// ===== ShadowCapability 测试（utils/3d/caps/shadow-capability.ts）=====
// 覆盖：构造默认值、apply 完整管线（真实 three 灯对象 + fake renderer）、还原管线、
// collectLights 去重、setPreset、跨能力注入、syncMeshes、enabled 参数直改、持久化、getMenuControls。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import {
  ShadowCapability,
  DEFAULT_SHADOW_PARAMS,
  SHADOW_PRESETS,
} from "./shadow-capability.ts";
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
  // collectLights 只认 lightCap/legacyLights 两个来源，模拟 mount-preview-core 的 syncLights 接线
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
  it("只认 lightCap/legacyLights 两个来源：场景里未接线的灯不被纳入阴影配置", () => {
    const scene = new THREE.Scene();
    const renderer = makeFakeRenderer();
    const wired = new THREE.DirectionalLight(0xffffff, 1);
    const stray = new THREE.DirectionalLight(0xffffff, 0.3); // 适配器自行加入场景、未经接线
    scene.add(wired, stray);
    const cap = new ShadowCapability({ scene, renderer, enabled: true });
    cap.syncLights([wired]); // 仅接线 wired
    expect(wired.castShadow).toBe(true);
    // 设计语义：不遍历场景，避免误伤适配器自带灯——未接线的灯保持原状、不被改写
    expect(stray.castShadow).toBe(false);
  });

  it("lightCap 注入的灯即使不在 syncLights 缓存里也会被纳入", () => {
    const scene = new THREE.Scene();
    const renderer = makeFakeRenderer();
    const lightCap = new LightCapability({ scene, renderer });
    const cap = new ShadowCapability({ scene, renderer, enabled: true });
    cap.setLightCap(lightCap);
    // LightCapability 的三盏方向灯全部被纳入（未调 syncLights）
    for (const dl of lightCap.getDirectionalLights()) {
      expect(dl.castShadow).toBe(true);
    }
  });
});

describe("ShadowCapability — 构造与默认值", () => {
  it("构造默认值完整", () => {
    const { scene, renderer } = { scene: new THREE.Scene(), renderer: makeFakeRenderer() };
    const cap = new ShadowCapability({ scene, renderer });
    expect(cap.isEnabled()).toBe(false);
    expect(cap.getMapSize()).toBe(1024);
    expect(cap.isSoft()).toBe(false); // "hard" ≠ soft
    expect(cap.getBias()).toBe(-0.0005);
    expect(cap.getNormalBias()).toBe(0.02);
    expect(cap.getCameraSize()).toBe(15);
  });

  it("enabled:true 初始启用", () => {
    const { scene, renderer } = { scene: new THREE.Scene(), renderer: makeFakeRenderer() };
    const cap = new ShadowCapability({ scene, renderer, enabled: true });
    expect(cap.isEnabled()).toBe(true);
  });

  it("params 覆盖生效", () => {
    const { scene, renderer } = { scene: new THREE.Scene(), renderer: makeFakeRenderer() };
    const cap = new ShadowCapability({ scene, renderer, params: { mapSize: 2048, type: "soft", cameraSize: 20 } });
    expect(cap.getMapSize()).toBe(2048);
    expect(cap.isSoft()).toBe(true);
    expect(cap.getCameraSize()).toBe(20);
  });

  it("未传 enabled 时回落 params.enabled", () => {
    const { scene, renderer } = { scene: new THREE.Scene(), renderer: makeFakeRenderer() };
    const cap = new ShadowCapability({ scene, renderer, params: { enabled: true } });
    expect(cap.isEnabled()).toBe(true);
  });
});

describe("ShadowCapability — apply 管线（真实灯对象）", () => {
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
      expect(dir.shadow.bias).toBe(DEFAULT_SHADOW_PARAMS.bias);
      expect(dir.shadow.normalBias).toBe(DEFAULT_SHADOW_PARAMS.normalBias);
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
    lights.spot!.distance = 20; // < 50 → far=50
    cap.setEnabled(true);
    const sp = lights.spot!;
    expect(sp.castShadow).toBe(true);
    expect(sp.shadow.mapSize.x).toBe(1024);
    expect(sp.shadow.bias).toBe(DEFAULT_SHADOW_PARAMS.bias);
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
    lights.dir.castShadow = false; // 原始 false
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    cap.setEnabled(true);
    expect(mesh.castShadow).toBe(true);
    expect(lights.dir.castShadow).toBe(true);

    cap.setEnabled(false);
    expect(mesh.castShadow).toBe(true); // mesh 原始 true → 还原为 true
    expect(mesh.receiveShadow).toBe(false);
    expect(lights.dir.castShadow).toBe(false);
    expect(lights.spot!.castShadow).toBe(false);
    expect(lights.dir.shadow.mapSize.x).toBe(512); // three 默认
    expect(lights.dir.shadow.bias).toBe(0);
    expect(renderer.shadowMap.enabled).toBe(false);
    expect(renderer.shadowMap.type).toBe(THREE.PCFSoftShadowMap);
  });

  it("不可见 spot 只快照不应用参数（visible=false 跳过）", () => {
    const { lights, cap } = setup({ spot: true });
    lights.spot!.visible = false;
    cap.setEnabled(true);
    expect(lights.spot!.castShadow).toBe(false); // 未被置 true
    cap.setEnabled(false);
    // 还原也不炸（快照存在但灯未动）
    expect(lights.spot!.castShadow).toBe(false);
  });

  it("多 spot（legacy 多盏）全部快照并还原", () => {
    const scene = new THREE.Scene();
    const renderer = makeFakeRenderer();
    const sp1 = new THREE.SpotLight(0xffffff, 1);
    const sp2 = new THREE.SpotLight(0xffffff, 1);
    sp1.castShadow = true; // 原始开阴影
    scene.add(sp1, sp2);
    const cap = new ShadowCapability({ scene, renderer });
    // legacy 传两盏（无方向灯，走 legacy spot 分支）
    cap.syncLights([sp1, sp2]);
    cap.setEnabled(true);
    expect(sp1.castShadow).toBe(true); // apply 后仍 true
    expect(sp2.castShadow).toBe(true);

    cap.setEnabled(false);
    expect(sp1.castShadow).toBe(true); // 还原原始值
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
    expect(cap.isEnabled()).toBe(true); // dispose 不改 enabled 标志
  });

  it("重复 apply 幂等（先清旧快照再应用）", () => {
    const { scene, lights, cap } = setup();
    const mesh = makeMesh(scene, true, true);
    cap.setEnabled(true);
    cap.apply(); // 第二次 apply：disableShadows → 还原 → 再应用
    expect(lights.dir.castShadow).toBe(true);
    expect(mesh.castShadow).toBe(true);
    cap.setEnabled(false);
    expect(mesh.castShadow).toBe(true); // 还原原值 true
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
  it("lightCap 优先提供灯（不经场景遍历）", () => {
    const scene = new THREE.Scene();
    const renderer = makeFakeRenderer();
    const external = new THREE.DirectionalLight(0xffffff, 1); // 不加进场景
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
    cap.syncLights([dir, spot]); // 与 lightCap 完全重复
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
    cap.setLightCap(stubLightCap([], null)); // lightCap 无 spot
    cap.syncLights([legacySpot]);
    cap.setEnabled(true);
    expect(legacySpot.castShadow).toBe(true);
    cap.setEnabled(false);
    expect(legacySpot.castShadow).toBe(false);
  });

  it("非方向灯/聚光灯的 legacy 灯被忽略", () => {
    const scene = new THREE.Scene();
    const renderer = makeFakeRenderer();
    const point = new THREE.PointLight(0xffffff, 1); // 两分支都不命中
    scene.add(point);
    const cap = new ShadowCapability({ scene, renderer });
    cap.syncLights([point as unknown as THREE.DirectionalLight]);
    cap.setEnabled(true);
    // PointLight 无 shadow.camera 正交/透视断言需求，仅不炸且不误改 castShadow 语义
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
  it("按 adapterId 映射预设（mmd→character：soft/1024/15）", () => {
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    cap.setPreset("mmd");
    expect(cap.isSoft()).toBe(true);
    expect(cap.getMapSize()).toBe(1024);
    expect(cap.getCameraSize()).toBe(15);
    // setPreset 只写 params；isEnabled 走构造期私有标志，不随预设翻转
    expect(cap.getParams().enabled).toBe(true);
    expect(cap.isEnabled()).toBe(false);
  });

  it("未知 adapterId 落回 default 预设", () => {
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    cap.setPreset("unknown-type");
    expect(cap.isSoft()).toBe(false); // default: hard
    expect(cap.isEnabled()).toBe(false);
  });

  it("loadState 后 setPreset 不覆盖用户会话配置", () => {
    localStorage.setItem("ysm-scene-cap-shadow", JSON.stringify({ enabled: true, type: "hard", mapSize: 4096 }));
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    cap.loadState();
    cap.setPreset("mmd");
    expect(cap.isSoft()).toBe(false); // 用户配置保留
    expect(cap.getMapSize()).toBe(4096);
  });

  it("SHADOW_PRESETS 覆盖所有预设键", () => {
    const expectedKeys = ["default", "prop", "small", "architecture", "scene", "character", "creature"];
    for (const k of expectedKeys) {
      expect(SHADOW_PRESETS[k]).toBeDefined();
    }
  });
});

describe("ShadowCapability — 跨能力注入", () => {
  it("enabled 时 setLightCap 立即 apply", () => {
    const scene = new THREE.Scene();
    const dir = new THREE.DirectionalLight(0xffffff, 1);
    scene.add(dir);
    const cap = new ShadowCapability({ scene, renderer: makeFakeRenderer(), enabled: true });
    expect(dir.castShadow).toBe(false); // 尚无灯
    cap.setLightCap(stubLightCap([dir], null));
    expect(dir.castShadow).toBe(true); // 注入即应用
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
  it("enabled 时对 roots mesh 快照并置 true；重复调用还原旧快照不累积", () => {
    const { scene, cap } = setup();
    const m1 = makeMesh(scene, true, true); // 原始全 true
    cap.setEnabled(true);
    cap.syncMeshes([m1]);
    expect(m1.castShadow).toBe(true);
    // 换一个新 root：旧 mesh 还原（回到 true），新 mesh 快照
    const m2 = makeMesh(scene, false, false);
    cap.syncMeshes([m2]);
    expect(m1.castShadow).toBe(true); // 还原原始值
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
    cap.setEnabled(false); // 还原
    expect(m1.castShadow).toBe(false);
    const m2 = makeMesh(scene); // disabled 下新 mesh 不动
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

  it("disabled 时直改仅更新 params 不碰灯", () => {
    const { lights, cap } = setup();
    cap.setEnabled(false); // 关闭后灯 shadow 已还原为快照原值
    cap.setBias(-0.003);
    cap.setNormalBias(0.05);
    cap.setCameraSize(60);
    expect(cap.getBias()).toBe(-0.003);
    expect(lights.dir.shadow.bias).toBe(0); // 未下发
  });
});

describe("ShadowCapability — 分辨率", () => {
  it("setMapSize 合法值", () => {
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    cap.setMapSize(2048);
    expect(cap.getMapSize()).toBe(2048);
    cap.setMapSize(4096);
    expect(cap.getMapSize()).toBe(4096);
  });

  it("setMapSize 非法值回退默认", () => {
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    cap.setMapSize(3000); // 不在 [512,1024,2048,4096] 中
    expect(cap.getMapSize()).toBe(DEFAULT_SHADOW_PARAMS.mapSize);
  });
});

describe("ShadowCapability — 软硬切换 / bias / cameraSize（disabled 基础读写）", () => {
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
    cap.setCameraSize(3); // clamp 到 5
    expect(cap.getCameraSize()).toBe(5);
    cap.setCameraSize(100); // clamp 到 80
    expect(cap.getCameraSize()).toBe(80);
  });
});

describe("ShadowCapability — 持久化", () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { localStorage.clear(); });

  it("saveState / loadState 完整周期", () => {
    const cap = new ShadowCapability({
      scene: new THREE.Scene(),
      renderer: makeFakeRenderer(),
      enabled: true,
      params: { mapSize: 2048, type: "soft", bias: -0.001, normalBias: 0.05, cameraSize: 20 },
    });
    cap.saveState();
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
    const cap = new ShadowCapability({
      scene: new THREE.Scene(),
      renderer: makeFakeRenderer(),
      params: { mapSize: 4096 },
    });
    cap.loadState();
    expect(cap.getMapSize()).toBe(4096);
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
    expect(cap.getMapSize()).toBe(DEFAULT_SHADOW_PARAMS.mapSize);
    expect(cap.getBias()).toBe(DEFAULT_SHADOW_PARAMS.bias);
    expect(cap.getCameraSize()).toBe(DEFAULT_SHADOW_PARAMS.cameraSize);
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

describe("ShadowCapability — getMenuControls 结构", () => {
  it("返回完整控件列表", () => {
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    const controls = cap.getMenuControls();
    expect(controls.length).toBeGreaterThanOrEqual(6);
    // 总开关
    const enabledCtrl = controls.find((c) => c.id === "shadow-enabled");
    expect(enabledCtrl).toBeDefined();
    expect(enabledCtrl!.kind).toBe("toggle");
    expect(enabledCtrl!.getValue()).toBe(false);
    // 分辨率选择器
    const mapSizeCtrl = controls.find((c) => c.id === "shadow-map-size");
    expect(mapSizeCtrl).toBeDefined();
    expect(mapSizeCtrl!.kind).toBe("select");
    expect(mapSizeCtrl!.select?.length).toBe(4);
    // 软阴影开关
    const softCtrl = controls.find((c) => c.id === "shadow-soft");
    expect(softCtrl).toBeDefined();
    expect(softCtrl!.kind).toBe("toggle");
    expect(softCtrl!.getValue()).toBe(false);
    // bias / normalBias / cameraSize 滑块
    expect(controls.find((c) => c.id === "shadow-bias")).toBeDefined();
    expect(controls.find((c) => c.id === "shadow-normal-bias")).toBeDefined();
    expect(controls.find((c) => c.id === "shadow-camera-size")).toBeDefined();
  });

  it("toggle 开关同步状态", () => {
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    const controls = cap.getMenuControls();
    const enabledCtrl = controls.find((c) => c.id === "shadow-enabled")!;
    enabledCtrl.setValue(true);
    expect(cap.isEnabled()).toBe(true);
    enabledCtrl.setValue(false);
    expect(cap.isEnabled()).toBe(false);
  });

  it("分辨率选择同步", () => {
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    const controls = cap.getMenuControls();
    const mapSizeCtrl = controls.find((c) => c.id === "shadow-map-size")!;
    mapSizeCtrl.setValue("2048");
    expect(cap.getMapSize()).toBe(2048);
  });

  it("软阴影开关同步", () => {
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    const softCtrl = cap.getMenuControls().find((c) => c.id === "shadow-soft")!;
    softCtrl.setValue(true);
    expect(cap.isSoft()).toBe(true);
  });

  it("bias / normalBias / cameraSize 滑块同步", () => {
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    const controls = cap.getMenuControls();
    controls.find((c) => c.id === "shadow-bias")!.setValue(-0.002);
    controls.find((c) => c.id === "shadow-normal-bias")!.setValue(0.06);
    controls.find((c) => c.id === "shadow-camera-size")!.setValue(25);
    expect(cap.getBias()).toBe(-0.002);
    expect(cap.getNormalBias()).toBe(0.06);
    expect(cap.getCameraSize()).toBe(25);
  });

  it("非总开关控件均含 group 字段", () => {
    const cap = new ShadowCapability({ scene: new THREE.Scene(), renderer: makeFakeRenderer() });
    const controls = cap.getMenuControls();
    controls.filter((c) => c.id !== "shadow-enabled").forEach((c) => {
      expect(c.group).toBeDefined();
      expect(c.group!.startsWith("preview.")).toBe(true);
    });
  });
});

describe("ShadowCapability — DEFAULT_SHADOW_PARAMS 默认值完整", () => {
  it("默认值字段齐全", () => {
    expect(DEFAULT_SHADOW_PARAMS.enabled).toBe(false);
    expect(DEFAULT_SHADOW_PARAMS.type).toBe("hard");
    expect(DEFAULT_SHADOW_PARAMS.mapSize).toBe(1024);
    expect(typeof DEFAULT_SHADOW_PARAMS.bias).toBe("number");
    expect(typeof DEFAULT_SHADOW_PARAMS.normalBias).toBe("number");
    expect(typeof DEFAULT_SHADOW_PARAMS.cameraSize).toBe("number");
  });
});
