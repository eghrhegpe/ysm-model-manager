// ===== [ADR-315 后续 · 行数红线治理] 波浪 shader 注入（Gerstner 位移 + 解析法线 +
//      fragment 微细节法线 + 圆角衰减 + 倒影混合）=====
// 自 water-capability.ts 沿真缝拆出：纯函数 + GLSL 注入串 + 六锚点守卫，**零类态依赖**——
// 实例量（波纹时钟 / 倒影载体）经 WaterShaderCtx 显式传入，与 water-reflect.ts 同口径。
// 行为零变更（纯搬运，不重构任何数值）；cap 侧 buildCtx 仅装配 ctx 并转发。
// 治理背景：ADR-315 拆三刀后红线锁 860 行，倒影子系统 / 锐评注释持续回弹至 931 行超限
// （node scripts/check-file-lines.ts），故把本最大真缝（~289 行）抽出锁红。
//
// 2026-09-19（微细节法线 GPU 化，ADR-271）：原 CPU 256² DataTexture + normalMap 槽整条链路已移除，
// fragment 改按世界水平坐标程序化求三组方向沟槽的偏导。收益有二：
//   ① 改 waterSize 不再重算 65536 像素（主线程零开销）；
//   ② 微细节不再受贴图分辨率与插值的限制，getNormalMap/generateNormalMap/缓存字段全部退场。

import * as THREE from "three";
import { assertRevisionRange, reportPatchIssue } from "@/preview-3d/shader-patches/patch-guard.ts";
import { envState } from "@/preview-3d/state/env-state.ts";
import { clampPoolRoundness } from "./water-body-strategies.ts";
import { effectiveWaveHeight } from "./water-params.ts";
import { applyReflectionUniforms, type WaterReflectState } from "./water-reflect.ts";
import {
  FILM_WETNESS_ALPHA_BASE,
  WATER_WAVE_SEGMENTS,
  WAVE_AA_FULL_VERTS,
  WAVE_AA_MIN_VERTS,
  WAVE_DEGENERATE_WA,
  WAVE_STEEP_SIZE_REF,
  WAVE_STEEP_SUM_LIMIT,
} from "./water-state.ts";

/** 波浪材质构造所需的实例态（cap 侧装配传入；本模块不持有 cap 引用） */
export interface WaterShaderCtx {
  /** 逐帧推进的波纹时钟（cap.waterTime，update 驱动） */
  waterTime: { value: number };
  /** ADR-297 倒影载体状态；reflector 为 null = 尚未懒建 */
  reflect: WaterReflectState;
  /** 倒影是否活跃（cap.reflectionActive() 现算，含 SSR 抑制 / 强度 / 透明门）。
   *  ⚠️ 必须是**惰性 getter**：原实现在 onBeforeCompile（编译期）才判定，而非材质构造期——
   *  传布尔值会把判定提前到 build 时刻，行为漂移。 */
  reflectionActive: () => boolean;
}

/** 波浪材质（film 顶 / pool 顶共用，避免技术分叉）。
 *  @param opts.forPool 是否为池体顶面（决定 transmission/thickness/clearcoat 与 film 的
 *    alpha 单源 = 浓度 × FILM_WETNESS_ALPHA_BASE，刻意不读 waterOpacity——解耦理由见 water-state.ts）
 *  @param opts.hasWallCeiling 形态是否有池壁顶（决定浪高上钳是否生效，见 ADR-319 D1 P2-2） */
export function buildWaveWaterMaterial(opts: {
  forPool: boolean;
  hasWallCeiling: boolean;
  ctx: WaterShaderCtx;
}): THREE.MeshPhysicalMaterial {
  const { forPool, hasWallCeiling, ctx } = opts;
  // [shader-patch 守卫] REVISION 断言：water 锚点是渲染管线稳定 chunk 标记，给宽松范围
  // [185,190)，升级审计后再收窄。失配即 throw → registry 工厂兜底使本 cap 缺失，拒绝静默降级。
  // [锐评 2026-10-04 第三轮 五笔账⑤] 失败哲学（刻意不对称，勿"统一"）：
  //  · REVISION 失配 = **前提崩塌**（渲染管线 chunk 结构未知，注入串全部可能错位）——此时
  //    warn+兜底渲染等于输出一坨无法归因的坏画面，故 **throw → cap 缺失 → 显式可发现**；
  //  · 六锚点失配 = **局部漂移**（REVISION 改写范围仍吻合，仅个别 chunk 标记动了）——水面
  //    退化为"波浪在摆但细节/倒影缺位"，画面仍可用，故 warn 保现场供诊断，不升级为 throw。
  //  两个失败模式代价不同（整 cap 不可渲染 vs 单项特效缺失），处理强度随之不同。
  assertRevisionRange({
    module: "water-patch",
    allowed: ["185", "186", "187", "188", "189"],
  });
  // 升级到 MeshPhysicalMaterial：pool 模式用 transmission/thickness 体现「水体厚度感」，film 仍降级为原视觉
  const mat = new THREE.MeshPhysicalMaterial({
    color: envState.waterColor,
    transparent: true,
    // [锐评回归 2026-10-04] film 的 alpha **单源** = 浓度 × 基准常量（刻意不读 waterOpacity；
    // 解耦理由见 water-state.ts|FILM_WETNESS_ALPHA_BASE：否则 pool 调过不透明度再切 film，同一浓度值浓淡会变）
    opacity: forPool ? envState.waterOpacity : FILM_WETNESS_ALPHA_BASE * envState.waterWetness,
    roughness: 0.15,
    metalness: forPool ? 0.0 : 0.3,
    depthWrite: false,
    transmission: forPool ? envState.waterClarity : 0,
    // ADR-257：语义重述为「容器内水的光程」——由容器深度派生，随 poolHeight 变化、
    // 不随 waterLevel 变化（它是容器属性，不描述水面位置）。
    thickness: forPool ? Math.max(0.01, envState.waterPoolHeight * 0.5) : 0,
    clearcoat: forPool ? 0.8 : 0,
    clearcoatRoughness: 0.1,
  });

  mat.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms): void => {
    mat.userData.shader = shader;
    shader.uniforms.uTime = ctx.waterTime;
    shader.uniforms.uRoundness = {
      value: forPool ? clampPoolRoundness(envState.waterPoolRoundness) : 0,
    };
    shader.uniforms.uHalfSize = { value: envState.waterSize / 2 };
    shader.uniforms.uSize = { value: envState.waterSize };
    shader.uniforms.uChoppiness = { value: envState.waterChoppiness };
    // ADR-319 D1：浪高入参数（钳后值）——原写死 min(0.6·0.82^i/freq, 0.5)，浪高无用户入口
    // [锐评 2026-10-04 P2-2] 上钳由形态能力旗标 hasWallCeiling 决定（不再用 forPool 兼职：
    // 两者不是同一维——未来 ocean 可能「有体积光学但无壁」）。无壁形态无上钳：无条件套会让水位过默认池深即静默死平
    shader.uniforms.uWaveHeight = { value: effectiveWaveHeight(hasWallCeiling) };
    // 微细节法线强度（原 normalScale 槽位的替代；值域 0-1，由 water 组键 `waterNormalStrength`
    // 驱动——菜单控件 water-normal-strength；旧「ground-normal-strength 驱动」为水面拆分前口径）
    shader.uniforms.uDetailStrength = { value: envState.waterNormalStrength };
    shader.uniforms.uBaseOpacity = { value: mat.opacity };
    // ADR-297 倒影三件套：贴图 + 镜面投影矩阵 + 权重。默认 0 = 混合块整体跳过——
    // 开关只翻 uniform，不触发 program 重编译；值由 renderReflection 逐帧驱动。
    shader.uniforms.uReflTex = { value: null as THREE.Texture | null };
    shader.uniforms.uReflMatrix = { value: new THREE.Matrix4() };
    shader.uniforms.uReflStrength = { value: 0 };
    // [ADR-297] 新材质编译入场时若镜像已在场（如形态切换后的重编译），同一拍即重绑
    // 三 uniform——不等下一帧 renderReflection 补挂，倒影零滞后。
    const refl = ctx.reflect.reflector;
    if (refl && ctx.reflectionActive()) {
      applyReflectionUniforms(shader, refl, ctx.reflect);
    }
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
         uniform float uTime;
         uniform float uSize;
         uniform float uHalfSize;
         uniform float uBaseOpacity;
         uniform float uRoundness;
         uniform float uChoppiness;
         uniform float uWaveHeight;
         varying vec3 vWorldPos_wave;
         varying vec2 vWaveSlope_wave;
         const int GERSTNER_COUNT = 6;
         float hash11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
         // Gerstner 余摆线：返回**物体空间位移**；out 物体空间法线。
         // 方向/相位由 wave index hash 播种，freq*=1.19 amp*=0.82 几何级数；
         // 陡度钳制 per-wave σ·k ≤ 0.8/N → Σ ≤ 0.8 防自交。
         //
         // ⚠️ 尺度约定（2026-09-18 实证修正，两处换算缺一不可）：
         // 波场定义在世界水平尺度上——p = position.xy * uSize 即世界水平坐标（水面 mesh 为
         // 单位平面 × scale(uSize,uSize,1)，故局部 1 单位 = 世界 uSize 单位；高度轴 scale.z=1 同尺度）。
         //   · 位移：水平分量是**世界量**，加进局部坐标前须 /sizeSafe；高度分量 scale.z=1 无需换算。
         //   · 法线：解析式给出的是「世界水平偏导」，而 objectNormal 必须是**物体空间法线**——
         //     各向异性缩放经 normalMatrix（逆缩放）还原，故水平分量须 ×sizeSafe。
         // 修正前二者同时漏换算（几何法线偏离解析值平均 94°、最大 179°＝大面积翻面；
         // 修正后 2.4°/7.0°，仅剩一阶近似残差）——数值实证脚本与结论见 ADR-257 §6.4。
         vec3 gerstner(vec2 p, out vec3 nrm) {
           vec3 disp = vec3(0.0);
           nrm = vec3(0.0);
           // 防除零：/uSize 遇 0 会产生 NaN 几何，故取正下界；setter（≥1）与 loadState 恢复
           // 另有入口钳制（两道防线，语义不同：此处只求非零）。
           float sizeSafe = max(uSize, 0.001);
            // 采样抗锯齿（2026-09-22）：顶点间距 = uSize / 分段数（唯一事实源
            // WATER_WAVE_SEGMENTS，几何装配与此处同源）。波长 λ 的可呈现性取决于每波长
            // 顶点数 λ/s：逼近奈奎斯特极限 2 时欠采样混叠成游走摩尔纹（300 m 大水面
            // 高频波频闪的病灶）。逐波淡出：≥${WAVE_AA_FULL_VERTS} 顶点/波长全保留，
            // ${WAVE_AA_MIN_VERTS}–${WAVE_AA_FULL_VERTS} 之间线性消退。
            // ⚠️「1‰ 下界」只保证 aa 本身非零，**不保证 wa > 0**（uWaveHeight=0 时 amp 恒 0）——
            // wa 的除零防线是下方的退化门（WAVE_DEGENERATE_WA）；原注释称「1‰ 下界保 wa 恒 > 0」
            // 与事实不符，锐评 2026-10-04 P0-1 订正。
            // 另注（P1-3①）：D2 锚定域宽后 λ/spacing = ${WATER_WAVE_SEGMENTS}/(4·1.19^i) 与 uSize 无关，
            // 六波最小 6.70 ≥ ${WAVE_AA_FULL_VERTS} ⇒ 本淡出当前**恒为 1**（惰性保险，非活功能）；
            // 分段数压到 ≤57 才会真正淡出高频。数值判据见 water-capability.test.ts。
            float spacing = sizeSafe / float(${WATER_WAVE_SEGMENTS});
           for (int i = 0; i < GERSTNER_COUNT; i++) {
             float fi = float(i);
             float ang = hash11(fi + 1.0) * 6.2831853;
             vec2 dir = vec2(cos(ang), sin(ang));
             // ADR-319 D2 频谱锚定域宽：λ_i = uSize/(4·1.19^i) → freq = 2π·1.19^i·4/uSize。
             // 原 freq=0.25·1.19^i 把 λ 钉死世界 [10.5, 25.1] m，与尺寸滑块（10–300 m）脱钩：
             // size=10 六波全超域宽、size=300 六波全被 aa 淡出（探针实测两端各 0 条在窗口内）。
             // 归一后每波长顶点数 λ/间距 = 分段数/(4·1.19^i)，与 uSize 无关，全域六波恒可呈现。
             float freq = 6.2831853 * pow(1.19, fi) * 4.0 / sizeSafe;
             // ADR-319 D1 浪高入参数：Σ_i amp_i = uWaveHeight（0.26 归一 + 0.82 级数衰减）。
             // 钳后值由 effectiveWaveHeight 在 CPU 侧算好下发（water-params.ts），此处只消费。
             float amp = uWaveHeight * 0.26 * pow(0.82, fi);
             // 衰减须在 wa/steep 派生之前：位移 / 解析法线 / 泡沫 Jacobian 同源于 amp，
             // 一处淡出三处一致（法线不会声称一个位移里不存在的高频斜率）。
             float waveLen = 6.2831853 / freq;
             float aa = max(smoothstep(${WAVE_AA_MIN_VERTS.toFixed(1)}, ${WAVE_AA_FULL_VERTS.toFixed(1)}, waveLen / spacing), 0.001);
             amp *= aa;
             float speed = sqrt(9.8 * freq);
             float wa = freq * amp;
             // [锐评 2026-10-04 P0-1] 退化门：uWaveHeight=0（浪高滑杆 min / 水位归零 / pool 水位≥池深）
             // ⇒ amp=0 ⇒ wa=0 ⇒ 下方 0.8/(wa·N) 得 +∞ ⇒ steep·amp = ∞×0 = NaN（顶点坐标与解析法线
             // 双双污染 ⇒ 水面整块消失）。本波既无位移也无法线贡献，整波跳过；跳过后 nrm 保持
             // (0,0,1)、位移为 0 —— 平面水 + 正确法线，静水态由此真正可达。
             if (wa <= ${WAVE_DEGENERATE_WA.toExponential(1)}) { continue; }
             // [锐评 2026-10-04 P1-1] 波陡反归一：D2 让 λ ∝ uSize ⇒ 未反归一时水平位移
             // steep·amp ∝ 1/freq ∝ uSize、且与浪高解耦（实测 size 10→300 水平摆动 0.036→1.091 m，
             // 而垂直总振幅恒 0.060 m ⇒ 大水面被「横向揉皱」）。乘 WAVE_STEEP_SIZE_REF/uSize 后，
             // 基准尺寸档观感零变化、尺寸域水平摆动恒定；小尺寸越过自交上界时由 steepCap 接管
             // （物理约束：波长太短本就不允许那么大水平摆动，非漂移）。
             float steepScale = ${WAVE_STEEP_SIZE_REF.toFixed(1)} / sizeSafe;
             // clamp 是**纵深防御**（锐评 P1-3②）：choppiness ∈ [0,1]（schema range）时输入恰在
             // [0, 上界] 内、恒不夹住；只有越界值（存档直写 / 未来放宽 range）才真正把
             // Σσk 钳回 WAVE_STEEP_SUM_LIMIT。域内恒等 + 域外夹住两条数值判据见其测试。
             float steepCap = ${WAVE_STEEP_SUM_LIMIT} / (wa * float(GERSTNER_COUNT));
             float steep = clamp(uChoppiness * ${WAVE_STEEP_SUM_LIMIT} / (wa * float(GERSTNER_COUNT)) * steepScale, 0.0, steepCap);
             float phase = freq * dot(dir, p) - speed * uTime;
             float c = cos(phase), s = sin(phase);
             disp.x += steep * amp * dir.x * c / sizeSafe;
             disp.y += steep * amp * dir.y * c / sizeSafe;
             disp.z += amp * s;
             // 法线偏导：世界水平偏导 -Σ D·WA·C → 物体空间须 ×size；高度轴 -Σ Q·WA·S 同尺度
             nrm.x -= dir.x * wa * c * sizeSafe;
             nrm.y -= dir.y * wa * c * sizeSafe;
             nrm.z -= steep * wa * s;
           }
           nrm.z += 1.0;
           nrm = normalize(nrm);
           return disp;
         }`,
    );
    // 解析法线覆盖：必须在 beginnormal_vertex **之后**（objectNormal 由该 chunk 声明）、
    // defaultnormal_vertex **之前**（后者经 normalMatrix 变换并对背面翻转）。
    // 此处只能用 position 属性——transformed 尚未在 begin_vertex 定义。
    // gerstner 交付的 nrm 已是物体空间法线（尺度换算见其头注），可直接赋给 objectNormal。
    shader.vertexShader = shader.vertexShader.replace(
      "#include <beginnormal_vertex>",
      `#include <beginnormal_vertex>
         {
           vec3 ysmWaveNormal;
           gerstner(position.xy * uSize, ysmWaveNormal);
           objectNormal = ysmWaveNormal;
           vWaveSlope_wave = ysmWaveNormal.xy;
         }`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
         vec2 wpos = transformed.xy * uSize;
         vec3 gWaveNormalUnused;
         vec3 gdisp = gerstner(wpos, gWaveNormalUnused);
         transformed.x += gdisp.x;
         transformed.y += gdisp.y;
         transformed.z += gdisp.z;
         vec4 worldPosWave = modelMatrix * vec4(transformed, 1.0);
         vWorldPos_wave = worldPosWave.xyz;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
         uniform float uRoundness;
         uniform float uHalfSize;
         uniform float uBaseOpacity;
         uniform float uDetailStrength;
         uniform sampler2D uReflTex;
         uniform mat4 uReflMatrix;
         uniform float uReflStrength;
         varying vec3 vWorldPos_wave;
         varying vec2 vWaveSlope_wave;`,
    );
    // 微细节法线（GPU 程序化，替代原 256² CPU DataTexture + normalMap 槽）：
    // 三组方向正弦沟槽求偏导，参数与原 generateNormalMap 逐项同源（0.08/0.8、0.05/1.1、0.03/1.6）——
    // 搬迁只换执行位置，不换谱线，故观感连续。
    // p 取世界水平坐标 ×2：复刻原贴图的世界映射（覆盖 [-uSize, uSize]，宽 2×size）。
    // 注入点必须在 normal_fragment_maps **之后**——fragment 的 normal 是**视图空间**量，
    // 由 three 在 normal_fragment_begin 产出、normal_fragment_maps 消费完毕后方可使用。
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_maps>",
      `#include <normal_fragment_maps>
         {
           vec2 dp = vWorldPos_wave.xz * 2.0;
           vec2 dd1 = normalize(vec2(1.0, 0.3));
           vec2 dd2 = normalize(vec2(-0.4, 1.0));
           vec2 dd3 = normalize(vec2(0.2, -0.8));
           // [锐评 2026-10-04 第三轮 五笔账①] 细节频率反归一（audit P1-1 配套句 192「细节频率
           // 按 sizeRef/uSize 归一」补落地）：三组沟槽原**恒世界米制**（dp 即世界水平坐标，频率
           // 参数 0.8/1.1/1.6 rad 唯一，λ 恒 3.9–7.9 m 与 uSize 解耦）——主谱 D2 已锚定域宽
           // （λ ∝ uSize），细节层却是孤立绝对波带：size=10 时粗沟槽比整个水面还长（细节近乎
           // 不存在）、size=300 时与主谱差一个数量级。乘 WAVE_STEEP_SIZE_REF/uSize
           // （fragment 无 uSize 声明，经 uHalfSize=uSize/2 推导）后 λ ∝ uSize 与主谱同基准；
           // 基准档（80 m）因子 = 1 观感零变化——与 P1-1 主谱反归一同一纪律
           // （WAVE_STEEP_SIZE_REF = schema waterSize 默认值，二者同源断言见 water-state.ts）。
           float detailFreqScale = ${WAVE_STEEP_SIZE_REF.toFixed(1)} / max(uHalfSize * 2.0, 0.001);
           float dh1 = 0.08 * cos(dot(dp, dd1) * 0.8 * detailFreqScale);
           float dh2 = 0.05 * cos(dot(dp, dd2) * 1.1 * detailFreqScale);
           float dh3 = 0.03 * cos(dot(dp, dd3) * 1.6 * detailFreqScale);
           float dhdx = dh1 * dd1.x * 0.8 * detailFreqScale + dh2 * dd2.x * 1.1 * detailFreqScale + dh3 * dd3.x * 1.6 * detailFreqScale;
           float dhdz = dh1 * dd1.y * 0.8 * detailFreqScale + dh2 * dd2.y * 1.1 * detailFreqScale + dh3 * dd3.y * 1.6 * detailFreqScale;
           // 扰动先在世界空间构造（水面朝上，切向即水平面），再经 viewMatrix 送入视图空间
           vec3 detailWorld = vec3(-dhdx, 0.0, -dhdz) * uDetailStrength;
           normal = normalize(normal + (viewMatrix * vec4(detailWorld, 0.0)).xyz);
         }`,
    );
    shader.fragmentShader = shader.fragmentShader.replace("void main() {", "void main() {\n");
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      `#include <dithering_fragment>
         // 圆角边缘衰减：抬到函数作用域算一次——alpha 与倒影权重共用（倒影边缘=水体边缘，同步淡出）
         float fade = 1.0;
         if (uRoundness > 0.0) {
           vec2 p = vWorldPos_wave.xz;
           float md = max(abs(p.x), abs(p.y));
           float edge = uHalfSize - uRoundness * uHalfSize;
           fade = 1.0 - smoothstep(edge, uHalfSize, md);
           gl_FragColor.a *= fade;
         }
         // [ADR-319 D3(b)] 碎波泡沫通道已删除——原判据 J ≤ 0（波面自交）与陡度钳制 Σσk ≤ 0.8（probe steepSum = 0.8·choppiness）在数学上互斥：新尺度下 J_min 实测 0.656（chopp=0.5）/ 0.379（拖满），J ≤ 0 占比恒 0.00%。改走相对压缩判据 smoothstep(0.75,0.45,J) 拖满时虽可达（0.379 < 0.75），但要重写判据 + 按 choppiness 归一 + 加可见性门——给一条从没工作过的通道做第二次手术，不如删除；判据设计权留给未来真要做泡沫的那一次（ADR-319 §2 D3b）。
         // [ADR-319 D3(b)] 碎波泡沫通道已删除
         // ADR-297 水面模型倒影：世界坐标投影进镜像相机裁剪空间采样反射 RT——uReflMatrix
         // 已含官方 bias（末位右乘 M⁻¹ 剥回世界口径）→ 除 w 即 uv。RT 内容为线性空间
         // （three 仅对 canvas 输出做 tone map），采样值过同源 linearToOutputTexel 编到
         // 与已过 colorspace 的底色同域再混。uReflStrength=0 整块跳过：开关只翻 uniform。
         if (uReflStrength > 0.0) {
           vec4 rc = uReflMatrix * vec4(vWorldPos_wave, 1.0);
           if (rc.w > 0.0) {
             // Gerstner 解析斜率（物体空间切向，与光照法线同源）扰动 uv：倒影随波摆动
             vec2 ruv = clamp(rc.xy / rc.w + vWaveSlope_wave * 0.08, vec2(0.002), vec2(0.998));
             vec3 refl = linearToOutputTexel(vec4(texture2D(uReflTex, ruv).rgb, 1.0)).rgb;
             // fresnel：掠射增强反射，正视保持水体通透（权重下限 0.25）
             float ndv = 1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
             float rw = min(uReflStrength * fade * (0.25 + 0.75 * ndv * ndv * ndv), 1.0);
             gl_FragColor.rgb = mix(gl_FragColor.rgb, refl, rw);
           }
         }
         gl_FragColor.a = min(gl_FragColor.a, uBaseOpacity);`,
    );
    // [shader-patch 守卫] 注入检测：多次无条件 replace 原本零检测（失配全静默）。
    // 现检查六处关键符号是否落地——vertex 的 wave 函数 / beginnormal 的法线覆盖 /
    // begin_vertex 的位移注入 / fragment common 独有声明 / 微细节法线覆写 /
    // 倒影混合块，任一缺失即告警（console 兜底），不再静默降级。
    // [锐评 P1-2] begin_vertex 位移锚点：原 vertexOk 查 common 注入（函数定义），
    // begin_vertex 失配时位移静默丢失（「法线在摆、水面在僵」）而检测全绿。
    const vertexOk = shader.vertexShader.includes("vec3 gerstner(");
    const normalOk = shader.vertexShader.includes("objectNormal = ysmWaveNormal;");
    const dispOk = shader.vertexShader.includes("transformed.z += gdisp.z;");
    // [锐评 P2-1] fragOk 改查 common 独有串——uRoundness 在 common 声明与 dithering
    // 使用两处出现，common 失配时 dithering 仍在致漏报；uReflTex 是 common 独有。
    const fragOk = shader.fragmentShader.includes("uniform sampler2D uReflTex;");
    // 微细节法线落地检查：normal 覆写点在场（贴图链路已删，此处失配即是静默丢细节）
    const detailOk = shader.fragmentShader.includes("normal = normalize(normal +");
    // [ADR-297] 倒影混合块落地检查：失配 = 倒影静默消失，与其余四项同病
    const reflOk = shader.fragmentShader.includes("if (uReflStrength > 0.0) {");
    if (!vertexOk || !normalOk || !dispOk || !fragOk || !detailOk || !reflOk) {
      reportPatchIssue(
        "water",
        `water onBeforeCompile 锚点失配（vertex=${vertexOk ? "ok" : "miss"} normal=${normalOk ? "ok" : "miss"} disp=${dispOk ? "ok" : "miss"} fragment=${fragOk ? "ok" : "miss"} detail=${detailOk ? "ok" : "miss"} refl=${reflOk ? "ok" : "miss"}），水面波浪法线 / 位移 / 微细节 / 圆角 / 倒影 / 透明度 clamp 可能失效。请检查 three 渲染管线 chunk 标记是否变更。`,
        "warn",
      );
    }
  };
  mat.needsUpdate = true;
  return mat;
}
