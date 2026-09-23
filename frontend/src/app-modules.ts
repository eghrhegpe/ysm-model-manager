// ===== 所有 ES module 组件的统一入口 =====

import { prefetchStatsWorker } from "@/backend/browser-adapter.ts";
import { makeDiarySink } from "@/backend/diary-sink.ts";
import { installGlobalErrorListeners } from "@/backend/global-error-listeners.ts";
import { Window } from "@/backend/runtime.ts";
import { registerErrorDiary } from "@/core/error-diary.ts";
import { initI18n, setLocaleHost } from "@/core/i18n/locale.ts";
import { checkUpdateSilent } from "@/features/maintenance/version-updater.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { makeLocaleHost } from "@/utils/dom/locale-host.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { applyUIPrefs } from "@/views/app-content/settings/ui-prefs.ts";
import { registerCoiServiceWorker } from "@/workers/coi-sw.ts";
import { bus } from "./bus.ts";
import { revealMainWindow } from "./startup-reveal.ts";

// ===== 懒加载 Web Component（原 utils/module-loader.ts，单消费者 → 并入装配层）=====
/**
 * 懒加载 Web Component：统一动态 import + 加载失败 toast 反馈。
 * 收敛 5 处 `import(...).catch` 模板（app-tree/sidebar/content/resource-manager/sync-manager）。
 * 用字面量路径确保 Vite 构建时解析。
 */
export const loadView = (name: string, importer: () => Promise<unknown>): Promise<void> => {
  return importer()
    .then(() => undefined)
    .catch((e) => {
      console.warn(`[module] 组件加载失败: ${name}`, e);
      bus.emit("toast:show", {
        msg: `❌ ${friendlyError(e, "组件加载失败")}`,
        duration: TOAST_MS.long,
        type: "error",
      });
    });
};

// bus 已在 bus.ts 中挂载 window.bus，此处不再重复赋值

// 新版 Web Component（通过 ES Module 导入以支持 shadow DOM）
// 静态导入（浏览器加载失败时直接报错，不 try/catch 以免静默吞错）
// 注意：app-nav 的注册已移至 async IIFE 中，放在 initI18n() 之后，
// 避免首帧渲染时 i18n bundle 尚未加载导致 [i18n] 缺失 key 警告。
import "@/views/context-menu/index.ts";
import "@/views/app-toast/index.ts";

// Web Components 动态导入（使用字面量确保 Vite 能在构建时解析路径）
loadView("app-tree", () => import("@/views/app-tree/index.ts"));
loadView("app-sidebar", () => import("@/views/app-sidebar/index.ts"));
const appContentReady = loadView("app-content", () => import("@/views/app-content/index.ts"));
loadView("app-sync-manager", () => import("@/views/app-sync-manager/index.ts"));

//  窗口状态已由 Go 端 shutdown 保存，前端不再重复写入

// ===== 全局主题控制 =====

import { safeGet } from "@/utils/base/primitives/storage.ts";
// 2026-08-17 神桶拆分：normalizeTheme/applyTheme/initTheme 已移至 theme-core.ts
// （纯逻辑无顶层副作用，测试可独立 import）；本文件保留启动装配 + window 桥接。
import { applyTheme, applyThemeAuto, initTheme, normalizeTheme } from "./theme-core.ts";

export { applyTheme, initTheme, normalizeTheme };

// P3 修复（code_review）遗留说明：page-store 白名单曾桥接到 window 供 index.html
// 内联脚本复用；2026-08-29 审计确认内联脚本整段为死代码（emit("nav:change") 全项目
// 无监听、loading:* 全项目无发射器），已随 index.html 一并删除，桥接随之撤销。
// 初始页恢复唯一路径 = page-store.resolveInitialPage()。

// ===== 启动步骤统一装配 =====
// 收敛原 6 处「try/catch + console.warn + 可选 toast」样板：每步失败仅告警/提示，
// 不中断后续启动（渐进降级），finally 兜底窗口 reveal。
interface StartupStep {
  /** console.warn 标签（拼成 `[tag] 失败文案:`） */
  tag: string;
  /** 失败告警文案（不含标签前缀） */
  failMsg: string;
  /** 有 toast 则失败时弹 error toast（prefix 为 emoji 前缀，含尾随空格） */
  toast?: { prefix: string; fallback: string };
  run: () => unknown | Promise<unknown>;
}

async function runStartupSteps(steps: StartupStep[]): Promise<void> {
  for (const step of steps) {
    try {
      await step.run();
    } catch (e) {
      console.warn(`[${step.tag}] ${step.failMsg}`, e);
      if (step.toast) {
        bus.emit("toast:show", {
          msg: step.toast.prefix + friendlyError(e, step.toast.fallback),
          duration: TOAST_MS.long,
          type: "error",
        });
      }
    }
  }
}

// 启动初始化
(async () => {
  try {
    await runStartupSteps([
      {
        tag: "error-diary",
        failMsg: "错误日志注册失败:",
        run: () => {
          // taken=false → 已有先前注册占位（装配层bug），sink 未生效，留痕告警
          const diaryHandle = registerErrorDiary(makeDiarySink());
          if (!diaryHandle.taken) {
            console.warn("[module] error-diary 注册未接管（已有先前注册？sink 未生效）");
          }
          installGlobalErrorListeners();
        },
      },
    ]);
    // ADR-079 M1：网页版注册 COI Service Worker（补 COOP/COEP → crossOriginIsolated，
    // 为 pthread WASM 铺路；渐进增强，失败静默降级单线程）——内部自捕获，保持裸调用。
    registerCoiServiceWorker();
    await runStartupSteps([
      {
        tag: "i18n",
        failMsg: "初始化失败，界面将缺翻译:",
        toast: { prefix: "⚠️ ", fallback: "语言资源加载失败" },
        run: () => {
          // ADR-210 D1：先接线 LocaleHost（DOM/网络副作用注入），再 initI18n（core 引擎无关）
          setLocaleHost(makeLocaleHost());
          return initI18n();
        },
      },
      {
        tag: "module",
        failMsg: "app-nav 加载失败:",
        toast: { prefix: "❌ ", fallback: "导航组件加载失败" },
        run: () => import("@/views/app-nav/index.ts"),
      },
      {
        tag: "theme",
        failMsg: "主题初始化失败:",
        toast: { prefix: "⚠️ ", fallback: "主题初始化失败" },
        // P3 修复：initTheme 应用定格主题后，按 theme-auto 重算（time 模式重启
        // 不再定格旧值——白天设 time 夜间重启仍亮色的病根治于此）
        run: async () => {
          await initTheme();
          applyThemeAuto();
        },
      },
      { tag: "ui-prefs", failMsg: "界面偏好应用失败:", run: applyUIPrefs },
    ]);
    checkUpdateSilent().catch((e) => console.warn("[updater] 静默检查失败:", e));
    // ADR-101 方向 A：Three.js 模块预加载（非阻塞，省掉首次 3D 预览 ~105ms 脚本编译）
    import("three").catch((e) => console.warn("[preload] three 预加载失败:", e));
    // 启动 2s 后后台预下载 stats.worker chunk（网页版）：让首次数值搜索不用等下载
    setTimeout(() => prefetchStatsWorker(), 2000);
  } finally {
    await appContentReady;
    await revealMainWindow(() => Window.Show());
  }
})();

// node 测试环境无 window，跳过系统主题跟随注册（浏览器语义不变）
if (typeof window !== "undefined") {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    // P3 修复（code_review）：裸调改 safeGet——隐私模式每次系统主题切换抛错 → 主题跟随静默失效
    const theme = safeGet("theme") || "system";
    if (theme === "system") {
      applyTheme("system");
      bus.emit("toast:show", {
        msg: `已跟随系统切换至${e.matches ? "深色" : "浅色"}主题`,
        duration: TOAST_MS.success,
        type: "info",
      });
    }
  });
}

// ===== F12 / Ctrl+Shift+I 打开 DevTools（仅开发/调试环境）=====
// 通过查询参数 ?dev=1 或 localStorage 标志启用
// P3 修复：localStorage 裸调在隐私模式抛错会中止模块求值——即使 ?dev=1 也无法启用
const _devtoolsFlag = safeGet("_devtools") === "1";
// node 测试环境无 window，短路跳过 devtools 判定（浏览器语义不变）
const _devMode =
  (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("dev")) ||
  _devtoolsFlag;
// 具名 handler：可被 unregisterDevtools 移除（测试反复求值本模块时，
// vi.resetModules 清模块缓存但不清 document 上残留的 listener，叠加注册
// 会导致跨用例污染——devtools「未启用」用例被前一个 _devMode=true 用例
// 残留的 listener 触发 Window.OpenDevTools()）。
const _devtoolsKeydown = (e: KeyboardEvent) => {
  if (e.key === "F12" || (e.ctrlKey && e.shiftKey && e.key === "I")) {
    e.preventDefault();
    try {
      Window.OpenDevTools();
    } catch (e) {
      // 仅开发/调试环境；失败留痕不中断（如 Wails 桥未就绪）
      console.warn("[app-modules] OpenDevTools 失败:", e);
    }
  }
};
if (_devMode && typeof document !== "undefined") {
  document.addEventListener("keydown", _devtoolsKeydown);
}
/** 测试清理钩子：移除 devtools keydown listener（生产环境无需调用）。 */
export function unregisterDevtools(): void {
  if (typeof document !== "undefined") {
    document.removeEventListener("keydown", _devtoolsKeydown);
  }
}

// ===== 控制台 debugGetSpec 钩子（ADR-214）=====
// 开发/调试环境挂载 window.debugGetSpec(path) 获取 Go spec 骨骼数据。
// 职责纯度：debug.ts 是叶子工具不应绑桥，钩子生命周期由装配层管理。
// 复用 _devMode 判定（?dev=1 / _devtools），不发明第二个 debug 开关。
// 注意：不与 declare global 合并——app-modules 已 import Window from runtime.ts，
// 同名 interface 会触发 noRedeclare；此处用类型断言绕过。
if (_devMode && typeof window !== "undefined") {
  import("@/utils/debug/debug.ts")
    .then(({ isDebugEnabled }) => {
      if (!isDebugEnabled()) return;
      (window as unknown as { debugGetSpec: (path?: string) => Promise<unknown> }).debugGetSpec =
        async (path?: string): Promise<unknown> => {
          try {
            const { getApp } = await import("@/backend/app.ts");
            const { GetModel3DSpec } = await getApp();
            const spec = await GetModel3DSpec(path || "");
            // 动态导入 dbg 避免循环依赖
            const { dbg } = await import("@/utils/debug/debug.ts");
            dbg("model3d", "spec:", spec);
            return spec;
          } catch (e) {
            console.error("[DEBUG]", e);
            return null;
          }
        };
    })
    .catch((e) => console.warn("[app-modules] debugGetSpec 挂载失败:", e));
}

// ===== 控制台 3D GPU 预算标定钩子（ADR-214 同款装配层模式）=====
// 开发/调试环境挂载 window.ysmCalibrateGpuBudget(ms) / ysmResetGpuBudget()——
// 采样真机 GPU 峰值反推预算并落 localStorage；`resolveGpuLoadLimits` 消费它，
// 故标定**真的改变拦截线**（不是打印一个建议数字就完事）。
// 职责纯度：标定纯逻辑是 infra 叶子（不绑 window），钩子生命周期归装配层——
// 与 debugGetSpec 同规矩，且不污染 mount3D 热路径。
// 采样源经 getter 惰性读取：renderer 只在 3D 会话存活，装配期尚无实例。
if (_devMode && typeof window !== "undefined") {
  import("@/utils/debug/debug.ts")
    .then(async ({ isDebugEnabled }) => {
      if (!isDebugEnabled()) return;
      const [{ installGpuCalibrationHook, makeGpuSampler }, { sceneInfraHost }, { textureCache }] =
        await Promise.all([
          import("@/preview-3d/infra/gpu-load-calibrate.ts"),
          import("@/preview-3d/adapters/shared-infra.ts"),
          import("@/preview-3d/texture/texture-cache.ts"),
        ]);
      installGpuCalibrationHook(
        makeGpuSampler(
          () => sceneInfraHost.renderer,
          () => textureCache.getTotalBytes(),
        ),
      );
    })
    .catch((e) => console.warn("[app-modules] ysmCalibrateGpuBudget 挂载失败:", e));
}

// ===== 控制台后处理常驻成本探针钩子（ADR-214 同款装配层模式）=====
// 开发/调试环境挂载 window.ysmPostprocProbe({framesPerArm, warmup}) —— A/B 交替采帧，
// 量化 ADR-250 §2.2「composer 常驻」在**关闭**后处理时的每帧 GPU 代价与常驻显存。
// 职责纯度：探针纯逻辑是 infra 叶子（不绑 window），钩子生命周期归装配层——
// 与 ysmCalibrateGpuBudget 同规矩；采样需活跃 3D 会话，故走惰性动态 import。
// ⚠️ 读数前先确认 ppEnabled=false（报告 taxMeaningful 会自证）：开着后处理跑出来的
// 差值含 bloom/ssao/ssr 实效果，是「后处理全部成本」而非常驻税。
if (_devMode && typeof window !== "undefined") {
  import("@/utils/debug/debug.ts")
    .then(async ({ isDebugEnabled }) => {
      if (!isDebugEnabled()) return;
      const { runPostprocCostProbe } = await import("@/preview-3d/infra/postproc-cost-probe.ts");
      (
        window as unknown as {
          ysmPostprocProbe: (o?: { framesPerArm?: number; warmup?: number }) => Promise<unknown>;
        }
      ).ysmPostprocProbe = async (o?: {
        framesPerArm?: number;
        warmup?: number;
      }): Promise<unknown> => {
        const report = await runPostprocCostProbe(o ?? {});
        return report ?? { error: "无活跃 3D 会话（scene/camera/renderer 未就绪）" };
      };
    })
    .catch((e) => console.warn("[app-modules] ysmPostprocProbe 挂载失败:", e));
}
