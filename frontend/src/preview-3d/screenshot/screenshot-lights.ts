// ===== 截图灯光（ADR-136 第四刀归位）=====
// 原 views/app-preview/skeleton-render.ts:202 toScreenshotLights + screenshot-renderer.ts ScreenshotLights
// 归位 preview-3d——截图领域单一事实源，消灭「改一处两处同步」分叉。
//
// 从预览 LightCapability 提取截图灯光（仅 light cap 缺失才回退标准灯——三点全关是用户
// 刻意的暗场景，截图必须保持暗——[doc:adr-126-p5] 截图灯光割裂修复：所见即所得）。
import type * as THREE from "three";
import { sceneInfraHost } from "@/preview-3d/adapters/shared-infra.ts";
import { attenuateAmbientForSky } from "@/preview-3d/caps/light-math.ts";
import type { LightInstanceParams, VolumetricParams } from "@/preview-3d/caps/light-params.ts";
import {
  isIblActive,
  sceneCapabilityRegistry,
} from "@/preview-3d/caps/scene-capability-registry.ts";

/** 截图输出设置（渲染器输出三参数）——必须与活跃预览 renderer 逐字段一致。
 *  [ADR-266-d1 D2] 光柱 shader 内含 `<tonemapping_fragment>` + `<colorspace_fragment>`，
 *  走 renderer 注入的宏与 `toneMappingExposure` uniform；模型本体（MeshStandardMaterial）
 *  同受支配。历史实现只抄了 `outputColorSpace`（两侧恰好同为 SRGB 才没露馅），
 *  `toneMapping` 与曝光从未镜像——「预览 ACES × 0.5」对「离屏 NoToneMapping × 1.0」
 *  是既有隐性分叉，光柱入镜会把这条分叉放大成显性穿帮。
 *  不 export：消费者只经 `ScreenshotLights.output` 结构化读取，无需类型名（knip 零未引用导出）。 */
interface ScreenshotOutputSettings {
  toneMapping: THREE.ToneMapping;
  exposure: number;
  /** 类型取自 renderer 自身声明（本版 three 该属性为 `string`）——不写死 `ColorSpace`，
   *  免镜像层引入第二套类型口径 */
  outputColorSpace: THREE.WebGLRenderer["outputColorSpace"];
}

/** 体积光锥截图描述：驱动 spot 的槽位 + 该槽位实例参数 + 体积光参数。
 *  锥体由离屏场景经 `VolumetricCone` 重建（同一几何/shader 单源，ADR-266-d1 D1）——
 *  不写第二套「截图专用光柱」。`null` = 预览此刻无光柱（未开体积光 / 无启用的聚光灯 /
 *  能力总开关关）→ 截图同样不产锥（预览没有的东西，截图不许凭空出现）。 */
export interface ScreenshotVolumetric {
  /** 驱动槽位：来自 cap 的 `getSpotLightForCone()`（ADR-290：auto = 槽位顺序第一盏启用
   *  spot；显式槽位严格绑定不回落）——截图侧不重算驱动规则，防第二套选择逻辑分叉。 */
  slot: "key" | "fill" | "rim";
  /** 该槽位实例参数（锥角/半影/颜色 → 锥体几何与材质 uniform） */
  spot: LightInstanceParams;
  params: VolumetricParams;
}

/** 截图灯光描述（与预览 light-capability 三点布光同构——截图所见即所得）。
 *  `radius` = 预览的 targetHeight：灯位 = 模型中心 + 方位角/仰角 × radius，
 *  spot/point 属位置敏感光源，缺此值截图与预览会不一致。 */
export interface ScreenshotLights {
  ambient: { color: number; intensity: number };
  /** 灯光定位半径（预览 LightCapability.getTargetHeight()） */
  radius: number;
  key: LightInstanceParams;
  fill: LightInstanceParams;
  rim: LightInstanceParams;
  /** [ADR-266-d1] 体积光锥（预览此刻无光柱时为 null） */
  volumetric: ScreenshotVolumetric | null;
  /** [ADR-266-d1 D2] 输出设置镜像源；`null` = 无活跃预览 renderer（无「现值」可镜像，
   *  离屏保持自身默认——此时也没有预览可同构，不构成新分叉） */
  output: ScreenshotOutputSettings | null;
}

/** 从预览 LightCapability 提取截图灯光；cap 缺失 → undefined（渲染方回退标准灯） */
export function toScreenshotLights(): ScreenshotLights | undefined {
  const cap = sceneCapabilityRegistry.getById("light");
  if (!cap) return undefined;
  const p = cap.getParams();
  // [ADR-293] 总开关门禁：预览关总闸时场景无任何灯光（含 ambient 也被 detach），
  // 截图须同样全黑——旧实现不看 isEnabled()，预览全黑而截图灯火通明，WYSIWYG 破洞。
  const on = cap.isEnabled();
  // [ADR-266-d1] 锥体驱动源：总闸关 → 无光柱。⚠️ 必须过总闸再问驱动源：灯对象在 detach 后
  // 仍存活、`visible` 仍是各槽位 enabled，`getSpotLightForCone()` 照样命中——漏了这道门
  // 就会出现「预览全黑，截图却立着一根光柱」（新的 WYSIWYG 破洞）。
  const driving = on ? cap.getSpotLightForCone() : null;
  const renderer = sceneInfraHost.renderer;
  return {
    // 镜像预览的 PMREM 环境光衰减——截图与预览 ambient 同构：
    // 判据读组合根 isIblActive（IBL 真供图者 = env cap 在场且启用），系数/公式走
    // light-math 的 attenuateAmbientForSky 单源。
    // [锐评 2026-10-08 P0] 判据原读 isSkyEnvironmentOn（sky 的 skyEnvironment，已自宣退役），
    // 与预览侧 X-3 换过的判据分叉 ⇒ 默认路径（envSource=preset + skyEnvironment=false）
    // 截图比预览亮一档。本判据与预览共用同一个纯函数，换判据只此一处。
    ambient: {
      color: p.ambient.color,
      intensity: on ? attenuateAmbientForSky(p.ambient.intensity, isIblActive()) : 0,
    },
    radius: cap.getTargetHeight(),
    key: { ...p.key, enabled: p.key.enabled && on },
    fill: { ...p.fill, enabled: p.fill.enabled && on },
    rim: { ...p.rim, enabled: p.rim.enabled && on },
    volumetric: driving
      ? {
          slot: driving.which,
          // 驱动源已保证「该槽位是启用的 spot」→ 原参透传（enabled 必为 true）
          spot: p[driving.which],
          params: p.volumetric,
        }
      : null,
    output: renderer
      ? {
          toneMapping: renderer.toneMapping,
          exposure: renderer.toneMappingExposure,
          outputColorSpace: renderer.outputColorSpace,
        }
      : null,
  };
}
