// @vitest-environment node
// ===== 截图灯光提取测试（ADR-266-d1）=====
// 数据层锁两条同构义务：
//  ① 「预览有光柱 ⟺ 截图含光柱」——含最阴的一条：能力总闸关时灯对象仍在、`getSpotLightForCone`
//     照样命中，若不过总闸就出「预览全黑、截图立着一根光柱」的新破洞；
//  ② 输出设置镜像——toneMapping / 曝光 / 色彩空间逐字段等于活跃预览 renderer 现值
//     （历史只抄了 outputColorSpace，两侧恰好同为 SRGB 才没露馅）。
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as THREE from "three";
import { DEFAULT_LIGHT_PARAMS } from "@/preview-3d/caps/light-params.ts";
import type { LightParams } from "@/preview-3d/caps/light-params.ts";

const { host, stub } = vi.hoisted(() => ({
  host: { renderer: null as unknown },
  stub: {
    cap: undefined as unknown,
    /** IBL 供图判据的**桩值**——注意这不是 mock 掉 `isIblActive` 本身：
     *  桩挂在 registry 的 `getById` 上，经被测代码真实调用的 `isIblActive()` 读出来。
     *  [锐评 2026-10-08 P0] 原桩把 `isSkyEnvironmentOn: () => stub.skyEnv` 整个替换掉被测依赖，
     *  于是「判据读的是谁」这个真正的病灶**结构性不可见**：把判据换成恒false 全测试仍绿，
     *  而生产里正因此让截图比预览亮一档。现改为只桩**被查对象**，判据函数本身参与执行。 */
    iblOn: false,
    /** 同时桩一个 sky cap：它的 isSkyIblSelfHoldEnabled 应被忽略（IBL 判据不问 sky）。 */
    skyEnvOn: false,
  },
}));

vi.mock("@/preview-3d/adapters/shared-infra.ts", () => ({ sceneInfraHost: host }));
vi.mock("@/preview-3d/caps/scene-capability-registry.ts", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/preview-3d/caps/scene-capability-registry.ts")
  >();
  // ⚠️ 不能只 `...actual` 后整体替换 sceneCapabilityRegistry：`isIblActive` 是**原模块内
  // 定义的函数**，其闭包已捕获原始单例对象，替换导出名对它无效（实测让位永不生效）。
  // 故改为**就地代理**原单例的 getById——判据函数本身仍是原实现、真跑，只把「被查对象」换成桩。
  const realRegistry = actual.sceneCapabilityRegistry as unknown as {
    getById: (id: string) => unknown;
  };
  realRegistry.getById = (id: string) => {
    if (id === "light") return stub.cap;
    if (id === "environment") return { isEnabled: () => stub.iblOn } as unknown;
    if (id === "sky") return { isSkyIblSelfHoldEnabled: () => stub.skyEnvOn } as unknown;
    return undefined;
  };
  return actual;
});

import { toScreenshotLights } from "./screenshot-lights.ts";

const SPOT_PARAMS = { ...DEFAULT_LIGHT_PARAMS.key, type: "spot" as const, enabled: true };

function makeParams(): LightParams {
  return {
    key: { ...SPOT_PARAMS },
    fill: { ...DEFAULT_LIGHT_PARAMS.fill },
    rim: { ...DEFAULT_LIGHT_PARAMS.rim },
    ambient: { color: 0xffffff, intensity: 0.4 },
    volumetric: { ...DEFAULT_LIGHT_PARAMS.volumetric, enabled: true },
  };
}

/** 假 light cap：只实现 toScreenshotLights 消费的四个入口 */
function makeCap(over: {
  enabled?: boolean;
  params?: LightParams;
  driving?: { which: "key" | "fill" | "rim" } | null;
} = {}) {
  const params = over.params ?? makeParams();
  return {
    isEnabled: () => over.enabled ?? true,
    getTargetHeight: () => 8,
    getParams: () => params,
    getSpotLightForCone: () =>
      over.driving === undefined ? { which: "key" as const } : over.driving,
  };
}

beforeEach(() => {
  stub.cap = makeCap();
  stub.iblOn = false;
  stub.skyEnvOn = false;
  host.renderer = null;
});

describe("toScreenshotLights — 光柱同构（预览有 ⟺ 截图有）", () => {
  it("无 light cap → undefined（渲染方回退标准灯）", () => {
    stub.cap = undefined;
    expect(toScreenshotLights()).toBeUndefined();
  });

  it("总闸开 + 有驱动 spot + 体积光开 → volumetric 块带槽位/实例参数/体积光参数", () => {
    const lights = toScreenshotLights()!;
    expect(lights.volumetric).not.toBeNull();
    expect(lights.volumetric!.slot).toBe("key");
    expect(lights.volumetric!.spot).toEqual(SPOT_PARAMS);
    expect(lights.volumetric!.params.enabled).toBe(true);
  });

  it("总闸开但无启用的驱动 spot → volumetric 为 null（预览无光柱）", () => {
    stub.cap = makeCap({ driving: null });
    expect(toScreenshotLights()!.volumetric).toBeNull();
  });

  it("总闸关 → 全黑且 volumetric 为 null（灯对象仍存活，必须过总闸）", () => {
    stub.cap = makeCap({ enabled: false });
    const lights = toScreenshotLights()!;
    expect(lights.ambient.intensity).toBe(0);
    expect(lights.key.enabled).toBe(false);
    expect(lights.fill.enabled).toBe(false);
    expect(lights.rim.enabled).toBe(false);
    expect(lights.volumetric).toBeNull();
  });

  it("体积光关（其余照旧）→ volumetric 块仍在但 params.enabled=false（截图侧按双门不产锥）", () => {
    const params = makeParams();
    params.volumetric = { ...params.volumetric, enabled: false };
    stub.cap = makeCap({ params });
    const lights = toScreenshotLights()!;
    expect(lights.volumetric?.params.enabled).toBe(false);
  });

  // [S1 ambient 分支] 让位系数 ×0.5 是共享单源；输入从 getParams 取，不写死字面量——
  // 改默认环境光强度时本用例不得因字面量过期而假红/假绿。
  it("IBL 在场 → ambient ×0.5 让位（输入读 getParams，防字面量漂移）", () => {
    const params = makeParams();
    params.ambient = { color: 0x123456, intensity: 0.4 };
    stub.cap = makeCap({ params });
    stub.iblOn = true;
    const lights = toScreenshotLights()!;
    expect(lights.ambient.intensity).toBeCloseTo(params.ambient.intensity * 0.5, 10);
    // 颜色不被让位影响（只让强度）
    expect(lights.ambient.color).toBe(params.ambient.color);
  });

  it("IBL 缺席 → ambient ×1（让位关）", () => {
    const params = makeParams();
    params.ambient = { color: 0xffffff, intensity: 0.4 };
    stub.cap = makeCap({ params });
    stub.iblOn = false;
    expect(toScreenshotLights()!.ambient.intensity).toBeCloseTo(params.ambient.intensity, 10);
  });

  // [锐评 2026-10-08 P0] 本轮病灶的回归锁：IBL 判据必须问 environment cap，
  // 不得问 sky 的 skyEnvironment（后者已自宣退役，只门控天空自持兜底路）。
  // 判据问错的后果 = 默认路径（envSource=preset + skyEnvironment=false）下
  // 预览 ×0.5、截图 ×1.0，**截图比预览亮一档**（该文件自陈要防的 WYSIWYG 破洞）。
  // 本例是「新旧判据取值相反」的判别样本：若实现退回读 sky 开关，本例即红。
  it("[P0] sky 的退役开关为 false 而 env 在场启用 → 仍须让位（判据问 env 不问 sky）", () => {
    const params = makeParams();
    params.ambient = { color: 0xffffff, intensity: 0.4 };
    stub.cap = makeCap({ params });
    stub.iblOn = true;
    stub.skyEnvOn = false; // 退役开关关：旧实现会据此判「IBL 不在场」而不让位
    expect(toScreenshotLights()!.ambient.intensity).toBeCloseTo(params.ambient.intensity * 0.5, 10);
  });

  it("[P0] env 关闭而 sky 的退役开关为 true → 不得让位（反向判别样本）", () => {
    const params = makeParams();
    params.ambient = { color: 0xffffff, intensity: 0.4 };
    stub.cap = makeCap({ params });
    stub.iblOn = false;
    stub.skyEnvOn = true; // 退役开关开：旧实现会误判「IBL 在场」而错误让位
    expect(toScreenshotLights()!.ambient.intensity).toBeCloseTo(params.ambient.intensity, 10);
  });
});

describe("toScreenshotLights — 输出设置镜像（ADR-266-d1 D2）", () => {
  it("三项输出设置逐字段等于预览 renderer 现值", () => {
    host.renderer = {
      toneMapping: THREE.ACESFilmicToneMapping,
      toneMappingExposure: 0.55,
      outputColorSpace: THREE.SRGBColorSpace,
    };
    expect(toScreenshotLights()!.output).toEqual({
      toneMapping: THREE.ACESFilmicToneMapping,
      exposure: 0.55,
      outputColorSpace: THREE.SRGBColorSpace,
    });
  });

  it("pp 接管 toneMapping（如 cineon）时镜像跟随，不写死 ACES", () => {
    host.renderer = {
      toneMapping: THREE.CineonToneMapping,
      toneMappingExposure: 1.2,
      outputColorSpace: THREE.SRGBColorSpace,
    };
    expect(toScreenshotLights()!.output!.toneMapping).toBe(THREE.CineonToneMapping);
    expect(toScreenshotLights()!.output!.exposure).toBeCloseTo(1.2, 6);
  });

  it("无活跃预览 renderer → output 为 null（无现值可镜像，离屏保持自身默认）", () => {
    host.renderer = null;
    expect(toScreenshotLights()!.output).toBeNull();
  });
});
