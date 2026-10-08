// ===== Sky shader patch：给 Three 官方 Preetham Sky 追加解耦 uniforms =====
// [ADR-073] 复用 Three 官方 Sky（three/addons/objects/Sky.js），禁止自写大气散射 shader。
// 本模块只做「对官方 Sky.js fragmentShader 做字符串锚点替换 + 追加 uniforms」这一件事，
// 与 SkyCapability（scene 接入/管线）解耦，归位 shader-patches/（与 patch-guard 同域）。
//
// 从 caps/sky-capability.ts 拆出（2026-10-08）：原函数是顶级导出、与 SkyCapability 类无关，
// 拆出后 sky-capability.ts 专注能力核心，本模块专注 patch 机制。
//
// 复杂度治理（2026-10-08）：injectSkySunScalePatch 认知 22/嵌套 3 超黄档（>15），
// 拆为「uniform 守卫 + 四层幂等 patch 单元」——每层独立小函数、只做一件事，
// injectSkySunScalePatch 收敛为编排层（同步默认值 / 触发重编译）。
//
// 历史锚点失配审计节奏：three REVISION 变更后跑全量测试，按报错更新 assertRevisionRange
// 的 allowed 列表 + 下面各锚点字符串（见 sky-capability.test.ts / shader-patches 相关测试）。

import type * as THREE from "three";
import { envState } from "@/preview-3d/state/env-state.ts";
import { assertRevisionRange, reportPatchIssue } from "./patch-guard.ts";

/** sunIntensityScale / sunDiscScale 两字段的默认值来源 */
type SunScaleDefaults = { sunIntensityScale: number; sunDiscScale: number };

/** 官方 Sky fragmentShader 内已注入/应注入的 sunScale 相关标记（供幂等判断） */
type SunScaleMarks = {
  hasSunScaleUniform: boolean;
  hasDiscScaleUniform: boolean;
  hasSunScaleUse: boolean;
  hasDiscScaleUse: boolean;
  hasSunScaleDecl: boolean;
};

/** 读取 shader/uniform 层当前 sunScale 注入状态（幂等判断统一入口） */
function readSunScaleMarks(mat: THREE.ShaderMaterial): SunScaleMarks {
  return {
    hasSunScaleUniform: mat.uniforms.sunIntensityScale !== undefined,
    hasDiscScaleUniform: mat.uniforms.sunDiscScale !== undefined,
    hasSunScaleUse: /vSunE\s*\*\s*sunIntensityScale/.test(mat.fragmentShader),
    hasDiscScaleUse: /sunDiscScale\s*\*\s*760\.0/.test(mat.fragmentShader),
    hasSunScaleDecl: /uniform\s+float\s+sunIntensityScale\s*;/.test(mat.fragmentShader),
  };
}

/** 未注册的 uniform 追加到 uniforms 对象层（即使后续 shader 替换失败也不 crash 运行时） */
function ensureSunScaleUniforms(
  mat: THREE.ShaderMaterial,
  marks: SunScaleMarks,
  defaults: SunScaleDefaults,
): void {
  if (!marks.hasSunScaleUniform)
    mat.uniforms.sunIntensityScale = { value: defaults.sunIntensityScale };
  if (!marks.hasDiscScaleUniform) mat.uniforms.sunDiscScale = { value: defaults.sunDiscScale };
}

/** 2a) 追加 uniform 声明层：锚点插在 showSunDisc/time 之后，锚点失配走 r185/r186 兜底。 */
function ensureSunScaleDecl(mat: THREE.ShaderMaterial): boolean {
  if (/uniform\s+float\s+sunIntensityScale\s*;/.test(mat.fragmentShader)) return false;
  const before = mat.fragmentShader;
  const uniformDeclInjection = "\nuniform float sunIntensityScale;\nuniform float sunDiscScale;\n";
  mat.fragmentShader = mat.fragmentShader.replace(
    /(uniform\s+float\s+showSunDisc\s*;\s*\n\s*uniform\s+float\s+time\s*;)/,
    `$1${uniformDeclInjection}`,
  );
  if (mat.fragmentShader !== before) return true;

  // regex 未匹配（Three 未来版本可能调整 uniforms 顺序），做全局兜底：在 uniforms 块后第一个函数前插
  const fallbackIdx = mat.fragmentShader.indexOf("vec2 gradient( vec2 i )");
  if (fallbackIdx > 0) {
    mat.fragmentShader =
      mat.fragmentShader.slice(0, fallbackIdx) +
      "uniform float sunIntensityScale;\nuniform float sunDiscScale;\n" +
      mat.fragmentShader.slice(fallbackIdx);
    return true;
  }
  reportPatchIssue(
    "sky",
    "injectSkySunScalePatch 无法注入声明，跳过 shader patch。请检查 Three.js Sky.js fragmentShader 结构是否已变更。",
    "error",
  );
  return false;
}

/**
 * 2b) 解耦点 ①：`pow( vSunE * ( … ) * ( 1.0 - Fex )` → `pow( (vSunE * sunIntensityScale) * ( … ) * ( 1.0 - Fex )`。
 *
 * [锐评 P2-2] 锚定唯一上下文——`pow( vSunE * (` 在 Sky.js r186 出现两次（L262 base 项 /
 * L263 fresnel 项），原 String.replace 只替首个，靠「首个即正确项」的隐式约定活着；
 * three 重排两行即静默错挂。现连同 base 项独有的 `( 1.0 - Fex )` 尾部锚定。
 */
function injectSunScaleUse(mat: THREE.ShaderMaterial): boolean {
  if (/vSunE\s*\*\s*sunIntensityScale/.test(mat.fragmentShader)) return false;
  const before = mat.fragmentShader;
  const baseAnchor =
    "pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * ( 1.0 - Fex )";
  mat.fragmentShader = mat.fragmentShader.replace(
    baseAnchor,
    "pow( (vSunE * sunIntensityScale) * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * ( 1.0 - Fex )",
  );
  if (mat.fragmentShader !== before) return true;

  // 本层需补但锚点失配（无论 uniform 已注册与否——半残修复同样可能被外部破坏
  // 挡住）→ 留痕 + console 兜底，消除「静默半残」失效缝隙
  reportPatchIssue(
    "sky",
    "injectSkySunScalePatch 解耦点①（vSunE 缩放）替换失败：锚点失配。请检查 Three.js Sky.js fragmentShader 结构是否已变更。",
    "error",
  );
  return false;
}

/**
 * 2c) 解耦点 ②：r186 `sundiscColor = ( 760.0 * sundisc ) * …` → sundisc 前乘 sunDiscScale
 * （r185 老锚点 `19000.0 * Fex` 已随 three r186 重构失配，2026-09-26 升级审计适配）。
 */
function injectDiscScaleUse(mat: THREE.ShaderMaterial): boolean {
  if (/sunDiscScale\s*\*\s*760\.0/.test(mat.fragmentShader)) return false;
  const before = mat.fragmentShader;
  mat.fragmentShader = mat.fragmentShader.replace(
    "vec3 sundiscColor = ( 760.0 * sundisc )",
    "vec3 sundiscColor = ( sunDiscScale * 760.0 * sundisc )",
  );
  if (mat.fragmentShader !== before) return true;

  reportPatchIssue(
    "sky",
    "injectSkySunScalePatch 解耦点②（太阳盘缩放）替换失败：锚点失配。请检查 Three.js Sky.js fragmentShader 结构是否已变更。",
    "error",
  );
  return false;
}

/**
 * 在 fragmentShader 上做四层幂等替换（声明 + 两处乘法层 + 太阳盘乘法层）。
 * 返回是否有改动（true → 调用方置 `mat.needsUpdate = true` 触发重编译）。
 * 声明层未匹配则跳过使用层（防未声明编译错）。
 */
function applySunScaleShaderPatch(mat: THREE.ShaderMaterial, marks: SunScaleMarks): boolean {
  // 声明必须先于使用（GLSL 顺序）；声明层未匹配则跳过使用层防编译错
  if (!marks.hasSunScaleDecl) {
    if (!ensureSunScaleDecl(mat)) return false;
  }
  const patchedUse = injectSunScaleUse(mat);
  const patchedDisc = injectDiscScaleUse(mat);
  return patchedUse || patchedDisc;
}

/**
 * 给 Three 官方 Sky 材质注入 sunIntensityScale / sunDiscScale 两个解耦 uniforms。
 *
 * **为何需要**：官方 Sky.js 的太阳强度/太阳盘尺寸硬编码在 fragmentShader 里，
 * 不能随 envState 调参。本函数做字符串锚点替换追加两个 uniform 与乘法层，
 * 使天空亮度（sunIntensityScale）与太阳盘尺寸（sunDiscScale）可独立控制。
 *
 * **设计要点**：
 * - 幂等：分字段独立守卫（uniform 已注册 + shader 已含对应乘法），半残状态自动补全；
 * - 锚点失配显式化：替换失败走 reportPatchIssue 留痕 + console（不静默失效）；
 * - 声明必须先于使用（GLSL 顺序），声明层未匹配则跳过使用层防编译错；
 * - 有改动才触发重编译（`mat.needsUpdate = true`）。
 *
 * @param mat 官方 Sky 的 ShaderMaterial（Sky.js 构造的 mesh.material）
 * @param defaults 默认值，通常取自 envState.skySunIntensityScale / envState.skySunDiscScale
 */
export function injectSkySunScalePatch(
  mat: THREE.ShaderMaterial,
  defaults: SunScaleDefaults = {
    sunIntensityScale: envState.skySunIntensityScale,
    sunDiscScale: envState.skySunDiscScale,
  },
): void {
  // [shader-patch 守卫] three 升级到未审计 REVISION 时显式抛错（锚点失配静默降级 → 显式化）
  assertRevisionRange({ module: "sky-patch", allowed: ["186"] });
  // 分字段幂等守卫（审计①：原「双字段整体短路」有半残缺口——uniform 已注册但乘法
  // 缺失时误判已注入 → 永不补全，静默半残）。现按字段各自校验：字段视为已注入
  // 仅当「uniform 存在 且 shader 已含对应乘法」。半残状态（uniform 在、乘法缺）下次
  // 调用自动补全乘法层；锚点彻底失配时 ringLog 留痕（消除静默失效缝隙）。
  const marks = readSunScaleMarks(mat);
  if (
    marks.hasSunScaleUniform &&
    marks.hasDiscScaleUniform &&
    marks.hasSunScaleUse &&
    marks.hasDiscScaleUse
  ) {
    // 完全注入 → 只确保默认值同步到 uniforms（不改 shader，避免重编译）
    mat.uniforms.sunIntensityScale.value = defaults.sunIntensityScale;
    mat.uniforms.sunDiscScale.value = defaults.sunDiscScale;
    return;
  }

  ensureSunScaleUniforms(mat, marks, defaults);
  // ② patch fragmentShader：按"声明必须先于使用"的 GLSL 顺序三层独立幂等替换。
  //    每一层都做 contains 判断，避免重复替换。
  if (applySunScaleShaderPatch(mat, marks)) mat.needsUpdate = true;
}
