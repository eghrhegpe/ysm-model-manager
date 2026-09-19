// ===== <app-preview> 入口 =====
// 重构：God Object 拆分 — 路由分发 → preview-router.ts，注册表 → preview-registry.ts。
// 本类仅保留 Web Component 生命周期 + WASM 代理 + 调试。

import { bus } from "@/bus";
import { rememberModelPath } from "@/core/model-path-store.ts";
import { logError } from "@/utils/base/primitives/log.ts";
import { createShadowStyle } from "@/utils/dom/shadow-style.ts";
import { WebComponentBase } from "@/utils/dom/web-component-base.ts";
import { previewCSS } from "./css.ts";

// 模块级样式表（shadow 根装配，含 HMR 注册；见 utils/dom/shadow-style.ts）。
// 原 12 行「环境守卫 + new CSSStyleSheet + replaceSync」样板已收敛到该原语。
const appPreviewStyle = createShadowStyle(previewCSS, "app-preview");

import { t } from "@/core/i18n/t.ts";
import type { BedrockGeometry } from "@/preview-3d/decoder/geometry.ts";
import {
  cacheGet,
  cacheSet,
  cacheSetEvictHandler,
  collectBlobUrls,
} from "@/preview-3d/decoder/model-cache.ts";
import type { DecodedYsm } from "@/preview-3d/decoder/utils.ts";
import { decodeYsmViaWasm } from "@/preview-3d/decoder/wasm-decode.ts";
import { createLoadGuard, type LoadGuard } from "@/utils/async/load-guard.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { isYsmWasmPreview } from "@/utils/resource/types.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import { PREVIEW_CLEANUP, PREVIEW_INVALIDATE } from "./preview-registry.ts";
import { routeModelPreview, routePackInfo } from "./preview-router.ts";
import { closeActive3DOverlay } from "./skeleton.ts";
import { modelDetailHTML } from "./tpl.ts";
import type { PreviewCtx } from "./utils.ts";

// 注册缓存淘汰回调：释放 blob URL（Set 去重：重复 URL 只 revoke 一次，revoke 幂等无害）
cacheSetEvictHandler((_key, val) => {
  if (!val) return;
  const urls = collectBlobUrls(val);
  for (const u of urls) {
    if (u?.startsWith("blob:")) URL.revokeObjectURL(u);
  }
});

class AppPreview extends WebComponentBase implements PreviewCtx {
  root: ShadowRoot;
  unsubs: Array<() => void> = [];
  /** P3 修复：2D 拖拽的 AbortController，避免模块级单例在多实例场景下的竞态风险 */
  dragAbortCtrl: AbortController | null = null;
  /** P1 迁移：活跃 3D overlay 关闭钩子（原 skeleton.ts 模块级 _active3DClose） */
  active3DClose: (() => void) | null = null;
  /** 预览代际守卫：快速点 A（慢）→ B（快）时，丢弃过期加载的渲染，防并发覆盖 */
  private _previewGuard = createLoadGuard();
  /** 路由层访问预览守卫（PreviewRouterCtx.previewGuard） */
  get previewGuard(): LoadGuard {
    return this._previewGuard;
  }
  /** 详情代际守卫（实例级，多实例隔离防串扰） */
  detailGen = createLoadGuard();
  /** 3D 偏好状态（实例级，跨模型切换保留） */
  private _prefer3D = false;

  getPrefer3D(): boolean {
    return this._prefer3D;
  }

  setPrefer3D(v: boolean): void {
    this._prefer3D = v;
  }

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
    this.root.adoptedStyleSheets = [appPreviewStyle.sheet];
  }

  connectedCallback(): void {
    this._render();

    // 跨生命周期防累积（对齐 app-tree:107 的 connected 重置范式）
    this.unsubs = [];
    this.unsubs.push(
      bus.on("model:select", async ({ path, isDir, rtype }) => {
        this._previewGuard.invalidate();
        // 统一同步「最近选中模型」——纯副作用：fire-and-forget + 失败静默
        if (!isDir && path) {
          rememberModelPath(path);
        }
        closeActive3DOverlay(this);
        // P2 修复：任意新选择作废在途渲染——防跨类型污染
        PREVIEW_INVALIDATE.forEach((fn) => {
          fn();
        });
        try {
          if (isDir) {
            await routePackInfo(this, path);
          } else {
            await routeModelPreview(this, path, rtype);
          }
        } catch (e) {
          logError("preview", "加载失败", e);
          this.root.innerHTML =
            '<div class="content"><div class="dp-placeholder"><div class="big-icon">' +
            UI_ICONS.warning +
            '</div><div class="dp-hint">' +
            t("preview.loadFailed") +
            "</div></div></div>";
        }
      }),
    );
  }

  disconnectedCallback(): void {
    // 切页：作废在飞预览渲染（代际守卫）
    this._previewGuard.invalidate();
    // P3 修复：清理拖拽 AbortController，防止跨实例竞态
    this.dragAbortCtrl?.abort();
    this.dragAbortCtrl = null;
    // 快照遍历：先换新数组再遍历快照
    const unsubs = this.unsubs;
    this.unsubs = [];
    unsubs.forEach((fn) => {
      fn();
    });
    // 清理体素 3D（WebGL renderer + rAF 循环）：防切页后 GPU 资源残留
    PREVIEW_CLEANUP.forEach((fn) => {
      fn();
    });
  }

  private _render(): void {
    this.root.innerHTML = modelDetailHTML(null);
  }

  /** 自动匹配缩略图：查缓存 → .ysm/.json 走 WASM → Go 兜底 */
  async loadPreviewImage(modelPath: string): Promise<string | null> {
    // 查缓存（模块级，跨组件生命周期持久）
    const cached = cacheGet(modelPath);
    if (cached?.texture) return cached.texture;
    const cachedGeo = cached?.geometry as BedrockGeometry | undefined;
    if (cachedGeo?.texture) return cachedGeo.texture;

    // .ysm 或 .json（解压的 ysm.json）走前端 WASM 解码；.zip/.7z 容器由下方 Go 兜底（ADR-066 解墙）
    if (isYsmWasmPreview(modelPath)) {
      const decoded = await this.decodeYsmViaWasm(modelPath);
      if (decoded?.texture) {
        cacheSet(modelPath, { ...decoded });
        return decoded.texture;
      }
      if (decoded?.geometry) {
        // 有 geometry 数据（含 _ysmMeta）但无纹理，缓存以备 _loadModel2D 使用
        cacheSet(modelPath, { ...decoded });
      }
      // WASM 完全失败 → 不缓存空条目，直接走 Go 兜底
    }
    try {
      const { FindPreviewImage, ExtractPreviewTexture } = await backendGetApp();
      const loose = await FindPreviewImage(modelPath);
      if (loose) {
        cacheSet(modelPath, { texture: loose });
        return loose;
      }
      const tex = await ExtractPreviewTexture(modelPath);
      if (tex) cacheSet(modelPath, { texture: tex });
      return tex || null;
    } catch (_) {
      return null;
    }
  }

  /** 通过前端 WASM 解码 .ysm，返回 { texture, geometry }（缓存复用） */
  async decodeYsmViaWasm(modelPath: string): Promise<DecodedYsm | null> {
    return decodeYsmViaWasm(modelPath);
  }

  /** 在预览区追加调试小字 */
  appendDebug(container: HTMLElement | null, msg: string): void {
    try {
      const el = container || this.root.getElementById("preview-content") || this.root;
      const dbg = document.createElement("div");
      dbg.className = "pv-debug";
      dbg.textContent = msg;
      el.appendChild(dbg);
    } catch (_) {
      /* appendDebug 仅调试辅助：失败静默，不影响预览主流程 */
    }
  }
}

// 注册组件（防 HMR/重复 import 时重复 define）
if (typeof customElements !== "undefined" && !customElements.get("app-preview")) {
  customElements.define("app-preview", AppPreview);
}
// HMR 热更新：仅 previewCSS（./css.ts）变更时热刷 shadow 样式表；其余依赖变更落到 Vite 整页重载。
appPreviewStyle.acceptHmr(import.meta.hot, "./css.ts", "previewCSS");
