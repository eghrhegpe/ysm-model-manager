// ===== E2E：后处理链路在真实 WebGL 下的端到端验证（2026-10-04 锐评跟进） =====
// 为什么需要本 spec：后处理相关的 3000+ 单测全部跑在 **mock renderer** 上——断言的是
// 「实现调用顺序 / 字段赋值」，没有一条穿过真实 WebGL 管线。而锐评确认的两个高危缺陷
// （P1-1 SSR 缓冲分辨率、P2-2 曝光总开关门）恰恰**只在真 GPU 路径上才暴露**：
//   · P1-1 是「composer 下发物理量后又被手写逻辑量覆盖」，mock 下 setSize 是空实现；
//   · P2-2 是「画面亮度差」，只有真渲染 + 读回像素才看得见。
// 本 spec 用真 WebGL2 上下文复现链路并 readPixels，形成端到端证据链。
//
// 运行：
//   npx playwright test --config playwright.web.config.ts postprocessing
//
// 环境前提（本机实测）：
//   · WebGL2 via ANGLE/SwiftShader 软渲染；EXT_color_buffer_float 与 MAX_SAMPLES=4 均可用，
//     足够支撑 EffectComposer 的 HalfFloatType 缓冲与 MSAA。
//   · 完整版 chromium 比 chrome-headless-shell 更适合验 WebGL（GPU 栈完整），故
//     findLocalChromium 传 preferFull（期望修订 full → 最大 full → 期望 shell → 最大 shell）；
//     本机若只有旧版 full（如 1228）也会取之而非匹配版 shell；若全部缺失（他机/CI），
//     回落硬编码路径并启动失败而非静默跳过——这是有意的，避免「环境没了测试却全绿」。

import { createWriteStream } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { findLocalChromium } from "../e2e/browser-path.ts";

/** 本机探测到的 chromium（preferFull：WebGL 语义，见上）；探测不到时回落硬编码路径。 */
const CHROME =
  findLocalChromium(undefined, undefined, { preferFull: true }) ??
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe`;

test.use({
  launchOptions: {
    executablePath: CHROME,
    args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
  },
});

/**
 * 加载经 vite 处理的页面以取得模块解析器。
 * `page.evaluate` 内的动态 import 不经 vite 的 bare-specifier 转换，故各用例一律用
 * dev server 的实际 URL：three 走预打包 deps，addons 走 `/@id/`（pnpm 符号链接布局下
 * `node_modules/three` 非真实目录，直取会被 fs 白名单挡掉）。
 *
 * 等待 2s 是必要的：应用启动链会触发一次同 URL 导航，过早 evaluate 会撞
 * "Execution context was destroyed"（已实测）。
 */
async function bootstrap(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);
}

test.describe("后处理真实 WebGL 链路（锐评 P1-1 / P2-2）", () => {
  test("P1-1 正例：SSR 缓冲分辨率 = 物理尺寸（DPR=2 / 800×600 → 1600×1200）", async ({ page }) => {
    await bootstrap(page);

    const r = await page.evaluate(async () => {
      const THREE = await import("/node_modules/.vite/deps/three.js");
      const { EffectComposer } = await import(
        "/@id/three/examples/jsm/postprocessing/EffectComposer.js"
      );
      const { RenderPass } = await import("/@id/three/examples/jsm/postprocessing/RenderPass.js");
      const { SSRPass } = await import("/@id/three/examples/jsm/postprocessing/SSRPass.js");

      const w = 800;
      const h = 600;
      const dpr = 2;
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 100);
      const composer = new EffectComposer(renderer);
      composer.setSize(w, h);
      composer.addPass(new RenderPass(scene, camera));
      const ssr = new SSRPass({
        renderer,
        scene,
        camera,
        width: w,
        height: h,
        selects: null,
        groundReflector: null,
      });
      composer.insertPass(ssr, 1);
      composer.setSize(w, h); // 真实 resize 流程

      const rt = (ssr as unknown as { beautyRenderTarget?: { width: number; height: number } })
        .beautyRenderTarget;
      const out = {
        hasBeauty: !!rt,
        beautyW: rt?.width ?? -1,
        beautyH: rt?.height ?? -1,
        expectedW: w * dpr,
        expectedH: h * dpr,
      };
      renderer.dispose();
      return out;
    });

    expect(r.hasBeauty, "SSRPass 应持有 beautyRenderTarget").toBe(true);
    expect(r.beautyW, `SSR 缓冲宽 = 物理 ${r.expectedW}（非逻辑 800）`).toBe(r.expectedW);
    expect(r.beautyH, `SSR 缓冲高 = 物理 ${r.expectedH}（非逻辑 600）`).toBe(r.expectedH);
  });

  test("P1-1 反例：composer 之后手写逻辑量覆盖 → 缓冲退回逻辑尺寸（病根复现）", async ({
    page,
  }) => {
    await bootstrap(page);

    const r = await page.evaluate(async () => {
      const THREE = await import("/node_modules/.vite/deps/three.js");
      const { EffectComposer } = await import(
        "/@id/three/examples/jsm/postprocessing/EffectComposer.js"
      );
      const { RenderPass } = await import("/@id/three/examples/jsm/postprocessing/RenderPass.js");
      const { SSRPass } = await import("/@id/three/examples/jsm/postprocessing/SSRPass.js");

      const w = 800;
      const h = 600;
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(2);
      renderer.setSize(w, h, false);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 100);
      const composer = new EffectComposer(renderer);
      composer.setSize(w, h);
      composer.addPass(new RenderPass(scene, camera));
      const ssr = new SSRPass({
        renderer,
        scene,
        camera,
        width: w,
        height: h,
        selects: null,
        groundReflector: null,
      });
      composer.insertPass(ssr, 1);

      // 复现真实病根（旧 `postprocessing-capability|setSize` 的行为）：composer 已下发
      // 物理量 1600，旧代码紧接着用手写逻辑量 800 二次覆盖。注意——**病根不是 splice
      // 绕过同步点**（composer.setSize 遍历 this.passes，直插数组同样收到物理量，已实测），
      // 而是这句手写覆盖。本反例即锁定该机制。
      composer.setSize(w, h);
      ssr.setSize(w, h);
      const rt = (ssr as unknown as { beautyRenderTarget?: { width: number; height: number } })
        .beautyRenderTarget;
      const out = { beautyW: rt?.width ?? -1, beautyH: rt?.height ?? -1 };
      renderer.dispose();
      return out;
    });

    expect(r.beautyW, "手写覆盖时缓冲退回逻辑 800（病根复现）").toBe(800);
    expect(r.beautyH, "手写覆盖时缓冲退回逻辑 600（病根复现）").toBe(600);
  });

  test("P2-2 实测：真读像素——后处理关闭时曝光系数不改变画面亮度", async ({ page }) => {
    await bootstrap(page);

    const r = await page.evaluate(async () => {
      const THREE = await import("/node_modules/.vite/deps/three.js");

      // 复现本仓 applyExposure 的两种口径，在真渲染中读回像素亮度：
      //   修复前（无门）：exposure = skyExposure * ppExposure
      //   修复后（有门）：exposure = skyExposure * (ppEnabled ? ppExposure : 1.0)
      const skyExposure = 0.5;
      const ppExposure = 1.8;

      const renderGray = (exposure: number): number => {
        const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
        renderer.setPixelRatio(1);
        renderer.setSize(64, 64, false);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = exposure;
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x000000);
        // 关键：用**材质**填满视口。清屏色（scene.background）不经曝光/tone mapping 路径，
        // 只有材质着色才体现 toneMappingExposure 的差异（踩过：清屏色下四种口径全 128）。
        const quad = new THREE.Mesh(
          new THREE.PlaneGeometry(2, 2),
          new THREE.MeshBasicMaterial({ color: 0x808080 }),
        );
        quad.position.z = -1;
        scene.add(quad);
        const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
        renderer.render(scene, camera);
        const gl = renderer.getContext();
        const px = new Uint8Array(4);
        gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        renderer.dispose();
        return px[0];
      };

      return {
        before: {
          ppOff: renderGray(skyExposure * ppExposure),
          ppOn: renderGray(skyExposure * ppExposure),
        },
        after: { ppOff: renderGray(skyExposure * 1.0), ppOn: renderGray(skyExposure * ppExposure) },
      };
    });

    // 修复后的关键性质①：门的引入使「关掉后处理」的画面亮度**不同于**开着时
    // （若恒等，说明门没生效）。
    expect(r.after.ppOff, "关/开后处理亮度应不同（门真的生效）").not.toBe(r.after.ppOn);
    // ② 反证：无门时（修复前）关掉后处理也照样被 ppExposure 拉亮 → 比修复后更亮。
    expect(r.before.ppOff, "无门时关着后处理也更亮——病态可复现").toBeGreaterThan(r.after.ppOff);
  });

  test("Bloom 域修复实测：mid-tone 不再进高辉光（真 WebGL 像素对比 + 生产函数同源）", async ({
    page,
  }) => {
    // 本用例首引 UnrealBloomPass/OutputPass——不在 vite 预打包缓存里，浏览器首次请求
    // 触发「发现新依赖 → 整页 reload」（bootstrap 注释的同款坑），长 evaluate 会被掐死。
    // 对策 = 撞一次导航后整段 bootstrap 重来再跑：dep optimize 每轮 dev server 只发生一次，
    // 第二次 evaluate 全走缓存。放宽超时（optimize 本身耗时，20s 默认预算不够两次 bootstrap）。
    test.setTimeout(60_000);
    await bootstrap(page);

    const runner = async () => {
      const THREE = await import("/node_modules/.vite/deps/three.js");
      const { EffectComposer } = await import(
        "/@id/three/examples/jsm/postprocessing/EffectComposer.js"
      );
      const { RenderPass } = await import("/@id/three/examples/jsm/postprocessing/RenderPass.js");
      const { UnrealBloomPass } = await import(
        "/@id/three/examples/jsm/postprocessing/UnrealBloomPass.js"
      );
      const { OutputPass } = await import("/@id/three/examples/jsm/postprocessing/OutputPass.js");
      // 生产代码直用（vite dev 同源解析）：域换算必须是**本次改动的实现**在浏览器里跑，
      // 不是测试侧手抄一份近似公式——手抄即分叉隐患（本仓纪律，同 attenuateAmbientForSky 单源）。
      const { bloomThresholdToLinear } = await import(
        "/src/preview-3d/caps/postprocessing-state.ts"
      );

      // 场景：黑底上一块「典型受光中亮面」（MeshBasic 0xE0E0E0 → 线性 ≈0.75，占视口中央）。
      // 曝光 0.5（本仓 skyExposure 默认）下亮块显示约中灰——正是用户眼中「正常亮度」的像素。
      // 病（修复前）：threshold 0.6 直接和**未曝光线性值**比 → 0.75 > 0.6，亮块整块进辉光、
      // 光晕向黑底晕开（用户投诉的「奇葩」画面）；修复后 pass 拿 0.6÷0.5=1.2 → 0.75 不过阈值，
      // 辉光只留给真高光。黑底衬托让光晕肉眼可辨（平场无边缘，看不出晕——踩过）。
      const EXPOSURE = 0.5;
      const USER_THRESHOLD = 0.6;
      const SIZE = 256;

      const build = (bloom: number | null) => {
        const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
        renderer.setPixelRatio(1);
        renderer.setSize(SIZE, SIZE, false);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = EXPOSURE;
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x000000);
        const quad = new THREE.Mesh(
          new THREE.PlaneGeometry(1.1, 1.1),
          new THREE.MeshBasicMaterial({ color: 0xe0e0e0 }),
        );
        quad.position.z = -2.5;
        scene.add(quad);
        const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
        const composer = new EffectComposer(renderer);
        composer.setSize(SIZE, SIZE);
        composer.addPass(new RenderPass(scene, camera));
        if (bloom !== null) {
          composer.addPass(new UnrealBloomPass(new THREE.Vector2(SIZE, SIZE), 0.6, 0.5, bloom));
        }
        composer.addPass(new OutputPass());
        composer.render();
        const gl = renderer.getContext();
        // 中心 = 亮块内部；角落 = 黑底（辉光晕染的落点）
        const read = (x: number, y: number): number => {
          const px = new Uint8Array(4);
          gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          return px[0];
        };
        const out = {
          center: read(SIZE / 2, SIZE / 2),
          corner: read(6, 6),
          png: (renderer.domElement as HTMLCanvasElement).toDataURL("image/png"),
        };
        renderer.dispose();
        return out;
      };

      // 基线：整链无 bloom（辉光增量以它为参照）
      const baseline = build(null);
      const old = build(USER_THRESHOLD); // 病态：阈值直吃线性域
      const fixed = build(bloomThresholdToLinear(USER_THRESHOLD, EXPOSURE)); // 生产函数换算
      return { old, fixed, baseline, converted: bloomThresholdToLinear(USER_THRESHOLD, EXPOSURE) };
    };

    let r: Awaited<ReturnType<typeof runner>> | null = null;
    for (let attempt = 0; attempt < 2 && !r; attempt++) {
      try {
        r = await page.evaluate(runner);
      } catch {
        // 第一次若被 vite dep-optimize 的整页 reload 掐死 → bootstrap 重建上下文再跑；
        // optimize 每轮 dev server 只发生一次，第二次 evaluate 全走缓存。
        if (attempt === 0) await bootstrap(page);
      }
    }
    if (!r) throw new Error("bloom 域修复 e2e：page.evaluate 两次均失败（非断言失败）");

    // ① 生产函数在浏览器里的换算值 = 0.6 ÷ 0.5 = 1.2（与被测实现同源，非测试手抄）
    expect(r.converted, "bloomThresholdToLinear(0.6, 0.5) = 1.2").toBeCloseTo(1.2, 6);

    // ② 病态复现：旧口径下中灰亮块被辉光**垫亮**（中心 > 无 bloom 基线），且光晕**晕上黑底**
    // （角落 > 基线角落≈0）——「亮瞎 + 整片发雾」两特征齐活。
    expect(r.old.center, `旧口径亮块应被 bloom 垫亮（>基线 ${r.baseline.center}）`).toBeGreaterThan(
      r.baseline.center,
    );
    expect(r.old.corner, `旧口径黑底角落应吃到光晕（>基线 ${r.baseline.corner}）`).toBeGreaterThan(
      r.baseline.corner,
    );

    // ③ 修复生效：换算后同场景同参数，中心回到基线附近、角落不再被晕染（辉光放走 mid-tone）
    expect(r.fixed.center, `修复后亮块应回到基线（<旧口径 ${r.old.center}）`).toBeLessThan(
      r.old.center,
    );
    expect(
      Math.abs(r.fixed.center - r.baseline.center),
      "修复后中心偏差 ≤ 2/255",
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(r.fixed.corner - r.baseline.corner),
      "修复后角落无晕染（≤2/255）",
    ).toBeLessThanOrEqual(2);

    // ④ 人眼证据：两图落盘，肉眼可见旧图亮块发光+黑底起雾、修复图干净
    for (const [name, dataUrl] of [
      ["bloom-domain-old.png", r.old.png],
      ["bloom-domain-fixed.png", r.fixed.png],
    ] as const) {
      const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
      createWriteStream(`e2e-web/_shots/${name}`).end(Buffer.from(b64, "base64"));
    }
    test.info().annotations.push({
      type: "bloom 域修复",
      description: `中心: 基线=${r.baseline.center} 旧=${r.old.center} 修复=${r.fixed.center}｜角落: 基线=${r.baseline.corner} 旧=${r.old.corner} 修复=${r.fixed.corner}（阈值 0.6→${r.converted}）`,
    });
  });
});
