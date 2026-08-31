// ===== <app-preview> 入口 =====
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import { bus } from "../../bus.ts";
import { previewCSS } from "./css.ts";
import { WebComponentBase } from "../../utils/dom/web-component-base.ts";
import { refreshAdoptedStyleSheets } from "../../utils/dom/css-hmr.ts";
// 模块级样式表（HMR 热更新回注入用：export 给 hot.accept 拿新实例）。
// 环境守卫对齐 ui-components-styles.ts：node/happy-dom 无 CSSStyleSheet 时返回
// 占位对象（replaceSync no-op）避免 import 即崩；浏览器恒走真实分支。
const appPreviewStyle: CSSStyleSheet = (() => {
  if (typeof CSSStyleSheet === "undefined") {
    return { replaceSync: () => {} } as unknown as CSSStyleSheet;
  }
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(previewCSS);
  return sheet;
})();
import { RESOURCE_TYPES, isYsmWasmPreview, extOf } from "../../utils/resource/types.ts";
import { modelDetailHTML } from "./tpl.ts";
import {
  cacheGet,
  cacheSet,
  cacheSetEvictHandler,
  collectBlobUrls,
} from "../../preview-3d/decoder/cache.ts";
import { getApp } from "../../backend/app.ts";
import { isWebPlatform } from "../../backend/platform-web.ts";
import { t } from "../../core/i18n/t.ts";
import type { PreviewCtx } from "./utils.ts";
import type { DecodedYsm } from "../../preview-3d/decoder/utils.ts";
import { GenGuard } from "./gen-guard.ts";
import { decodeYsmViaWasm } from "../../preview-3d/decoder/wasm-decode.ts";
import { showModelDetail, showResourcePack, showShaderpack, showSimplePreview } from "./detail.ts";
import { showVrmMeta, showMmdPreview, showScenePreview, showMorphPreview, showStagePreview, showFbxPreview } from "./detail-3d.ts";
import { showLitematic, cleanupLitematic3D, invalidateLitematicPreview } from "./litematic-meta.ts";
import { cleanupVrm3D, invalidateVrmPreview } from "./vrm-3d.ts";
import { cleanupMmd3D, invalidateMmdPreview } from "./mmd-3d.ts";
import { cleanupScene3D, invalidateScenePreview } from "./scene-3d.ts";
import { cleanupPack3D, invalidatePackPreview } from "./pack-3d.ts";
import { cleanupEmpty3D, invalidateEmptyPreview } from "./empty-3d.ts";
import { cleanupMaid3D, invalidateMaidPreview, showMaidPreview } from "./maid-3d.ts";
import { closeActive3DOverlay } from "./skeleton.ts";
import { esc } from "../../utils/dom/html.ts";
import type { BedrockGeometry } from "../../preview-3d/decoder/geometry.ts";

/** 预览 show 函数签名：ctx + path + 类型元信息（icon/label） */
type PreviewShowFn = (
  ctx: PreviewCtx,
  path: string,
  meta: { icon: string; label: string },
) => void;

/**
 * 类型 → show 派发映射表（ADR-072 D2：把 index.ts 手写 if 链替换为注册表驱动查表）。
 * 新增格式 = 注册表一条目 + 这里一行，不再改 _showModelDetail 的 if 链。
 * VRC 的 .vrm（3D meta 卡）/ .vrca/.zip（简单预览）分支收进 handler 内部。
 */
const PREVIEW_HANDLERS: Record<string, PreviewShowFn> = {
  // ADR-080：资源包详情卡（pack.mcmeta + pack.png）+ 🏗️ FAB 进 3D 模型预览。
  // 含 block/item 模型与否由 createPack3D 内部 ListPackModels 检测（无模型静默不打开），
  // 详情【不再自动触发 3D】——用户先看介绍，需要时点 FAB（原自动触发直接全屏 3D，
  // showResourcePack 从未渲染，看不到 pack.png/描述；P2 修复对齐 YSM/VRM/MMD 详情+FAB 模式）
  [RESOURCE_TYPES.PACK]: (ctx, path) => showResourcePack(ctx, path),
  [RESOURCE_TYPES.YSM]: (ctx, path) => showModelDetail(ctx, path),
  [RESOURCE_TYPES.MAID]: (ctx, path) => showMaidPreview(ctx, path),
  [RESOURCE_TYPES.LITEMATIC]: (ctx, path) => showLitematic(ctx, path),
  [RESOURCE_TYPES.BLUEPRINT]: (ctx, path) => showLitematic(ctx, path),
  [RESOURCE_TYPES.SHADER]: (ctx, path, meta) => showShaderpack(ctx, path, meta),
  // MMD 角色模型（EntityPlayer）— ADR-111：按 variants 分发，.vrm 走 VRM meta 卡
  [RESOURCE_TYPES.MMD]: (ctx, path, meta) => {
    if (extOf(path) === ".vrm") {
      showVrmMeta(ctx, path, meta);
    } else {
      showMmdPreview(ctx, path, meta);
    }
  },
  // MMD 独立顶级类型（后端 DetectResourceType 路径消歧命中时直接路由）
  "SceneModel": (ctx, path) => showScenePreview(ctx, path),
  "CustomMorph": (ctx, path) => showMorphPreview(ctx, path),
  "StageAnim": (ctx, path) => showStagePreview(ctx, path),
  "CustomAnim": (ctx, path, meta) => showSimplePreview(ctx, path, meta),
  "DefaultAnim": (ctx, path, meta) => showSimplePreview(ctx, path, meta),
  "DefaultMorph": (ctx, path, meta) => showSimplePreview(ctx, path, meta),
  "mmd-shader": (ctx, path, meta) => showSimplePreview(ctx, path, meta),
  // FBX 独立预览（ADR-112：模型 + 内嵌动画，物理落 CustomAnim 目录）
  "fbx": (ctx, path, meta) => showFbxPreview(ctx, path, meta),
};

// 注册缓存淘汰回调：释放 blob URL（Set 去重：重复 URL 只 revoke 一次，revoke 幂等无害）
cacheSetEvictHandler((key, val) => {
  if (!val) return;
  const urls = collectBlobUrls(val);
  for (const u of urls) {
    if (u?.startsWith("blob:")) URL.revokeObjectURL(u);
  }
});

class AppPreview extends WebComponentBase implements PreviewCtx {
  root: ShadowRoot;
  unsubs: Array<() => void> = [];
  private _typeCache: Array<{ id: string; name?: string; icon?: string }> = [];
  private _typeReg: Record<string, { id: string; name?: string; icon?: string }> | null = null;
  /** 预览代际守卫：快速点 A（慢）→ B（快）时，丢弃过期加载的渲染，防并发覆盖 */
  private _previewGuard = new GenGuard();

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
    this.root.adoptedStyleSheets = [appPreviewStyle];
  }

  connectedCallback(): void {
    this._render();

    this._preloadTypeRegistry();
    this.unsubs.push(
      bus.on("model:select", async ({ path, isDir, rtype }) => {
        this._previewGuard.invalidate(); // 代际计数：子方法 await 后校验 gen !== _previewGen 即丢弃过期渲染
        // 统一同步「最近选中模型」（左下角 3D 预览按钮的 path 来源）：所有 model:select
        // 发射点（app-tree/仓库元老/回收站/去重/morph·stage 切换）都更新，避免旧路径残留
        // 导致 3D 预览打开错误模型或误报类型不支持。纯副作用：fire-and-forget + 失败静默，
        // 绝不 await 阻塞预览主流程（测试实证：动态 import 挂起会吞掉后续 _showModelDetail）
        if (!isDir && path) {
          void import("../app-content/init-pages.ts")
            .then(({ rememberModelPath }) => rememberModelPath(path))
            .catch(() => { /* rememberModelPath 失败不影响预览 */ });
        }
        // P2 修复（审核）：切换模型前关闭活跃的 3D 全屏 overlay（挂 body、不随 shadow
        // DOM 重建消失）。后台 model:select（导入队列/回收站自动选择）触发时不清旧层会
        // 双全屏叠加 + 旧 renderer 死屏残留。closeActive3DOverlay 保留 _prefer3D，
        // 新模型 loadModel2D 仍会按设计自动弹 3D（skeleton.ts:64）。
        closeActive3DOverlay();
        // P2 修复（code_review）：任意新选择作废在途 litematic 解析——
        // litematicGen 只在 showLitematic 自身递增，切到 YSM/资源包（走 _detailGen）
        // 不触碰它，litematic A 迟到会写进 B 的 #preview-detail（跨类型污染）
        invalidateLitematicPreview();
        invalidateVrmPreview();
        invalidateMmdPreview();
        invalidateScenePreview();
        invalidatePackPreview();
        invalidateEmptyPreview();
        invalidateMaidPreview();
        try {
          if (isDir) {
            await this._showPackInfo(path);
          } else {
            await this._showModelDetail(path, rtype);
          }
        } catch (e) {
          console.error("[preview] 加载失败:", e);
          this.root.innerHTML =
            '<div class="content"><div class="dp-placeholder"><div class="big-icon">⚠️</div><div class="dp-hint">' + t("preview.loadFailed") + '</div></div></div>';
        }
      }),
    );
  }

  disconnectedCallback(): void {
    // 快照遍历：unsub 内部可能 splice 自身（如 close3D 的 P3 修复），
    // 用 slice() 防止 forEach 遍历中移除元素导致跳项
    this.unsubs.slice().forEach((fn) => fn());
    // 清理体素 3D（WebGL renderer + rAF 循环）：防切页后 GPU 资源残留
    cleanupLitematic3D();
    cleanupVrm3D();
    cleanupMmd3D();
    cleanupScene3D();
    cleanupPack3D();
    cleanupEmpty3D();
    cleanupMaid3D();
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
        cacheSet(modelPath, { ...decoded, _decodedBy: "🧠 WASM 内置解码" });
        return decoded.texture;
      }
      if (decoded?.geometry) {
        // 有 geometry 数据（含 _ysmMeta）但无纹理，缓存以备 _loadModel2D 使用
        // （无 _wasmTried 标记：Go 兜底成功会覆盖缓存，标记无消费方——P4 清理）
        cacheSet(modelPath, { ...decoded });
      }
      // WASM 完全失败 → 不缓存空条目，直接走 Go 兜底（兜底结果由下方 cacheSet 落缓存）
    }
    try {
      const { FindPreviewImage, ExtractPreviewTexture } =
        await getApp();
      const loose = await FindPreviewImage(modelPath);
      if (loose) {
        cacheSet(modelPath, { texture: loose, _decodedBy: "" });
        return loose;
      }
      const tex = await ExtractPreviewTexture(modelPath);
      if (tex) cacheSet(modelPath, { texture: tex, _decodedBy: "" });
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
      const el =
        container || this.root.getElementById("preview-content") || this.root;
      const dbg = document.createElement("div");
      dbg.className = "pv-debug";
      dbg.textContent = msg;
      el.appendChild(dbg);
    } catch (_) {}
  }

  private async _preloadTypeRegistry(): Promise<void> {
    try {
      const { LoadResourceTypes } = await getApp();
      const raw = await LoadResourceTypes();
      const reg = JSON.parse(raw) as { resourceTypes?: Array<{ id: string; name?: string; icon?: string }> };
      this._typeCache = reg.resourceTypes || [];
    } catch (e) { console.warn("[preview] LoadResourceTypes:", e); }
  }

  private async _showModelDetail(path: string, rtypeHint?: string): Promise<void> {
    const gen = this._previewGuard.current;
    // ADR-071 M1：web 端 .7z 明确"暂不支持"（识别为 ysm 但 WASM/解压均无法处理——
    // 显示文件名即可，不尝试解析报错；替代原"点击预览必失败"）
    if (extOf(path) === ".7z" && isWebPlatform()) {
      bus.emit("toast:show", {
        msg: t("preview.web7zUnsupported"),
        duration: TOAST_MS.normal,
        type: "warn",
      });
      showSimplePreview(this, path, this._typeMeta(RESOURCE_TYPES.YSM));
      return;
    }
    // 检测文件类型——发射点已分类（model:select 携带 rtype）时优先用，避免歧义扩展名重复探测
    let rtype = rtypeHint || "";
    if (!rtype) {
      try {
        const { DetectResourceType } = await getApp();
        rtype = (await DetectResourceType(path)) || "";
      } catch (e) { console.warn("[preview] DetectResourceType:", e); }
    }
    // 过期守卫：await 期间用户已点其他文件，丢弃本次分流
    if (this._previewGuard.stale(gen)) return;
    // ADR-072 D2：注册表驱动查表派发——新增格式 = 注册表一条目 + PREVIEW_HANDLERS 一行，
    // 不再改 if 链。识别不出（空 rtype）不再假装 YSM（ADR-082 续）：toast 提示 + 简单预览，
    // 让用户知道文件类型未被识别，而非静默走 YSM 解析路径。
    if (!rtype) {
      bus.emit("toast:show", {
        msg: t("preview.unrecognizedType"),
        duration: TOAST_MS.normal,
        type: "warn",
      });
      showSimplePreview(this, path, { icon: "❓", label: t("preview.unrecognizedType") });
      return;
    }
    const handler = PREVIEW_HANDLERS[rtype];
    if (handler) {
      handler(this, path, this._typeMeta(rtype));
    } else {
      showSimplePreview(this, path, this._typeMeta(rtype));
    }
  }

  private _typeMeta(rtype: string): { icon: string; label: string } {
    if (!this._typeReg) {
      this._typeReg = {};
      for (const t of this._typeCache || []) this._typeReg[t.id] = t;
    }
    const def = this._typeReg[rtype];
    return { icon: def?.icon || "📦", label: def?.name || rtype };
  }

  /** 显示资源包信息（pack.mcmeta + pack.png）——直连 showResourcePack，无包装层 */
  private async _showPackInfo(dirPath: string): Promise<void> {
    const gen = this._previewGuard.current;
    this.root.innerHTML = `<div class="content" id="preview-content"><h3>📦 ${t("preview.pack")}</h3><div class="dp-placeholder"><div class="big-icon">⏳</div></div></div>`;
    try {
      const { GetPackInfo } = await getApp();
      const pack = await GetPackInfo(dirPath);
      // 过期守卫：await 期间用户已点其他文件，丢弃本次渲染
      if (this._previewGuard.stale(gen)) return;
      if (!pack || (!pack.name && !pack.description)) {
        const folderName = dirPath.split(/[/\\]/).filter(Boolean).pop() || dirPath;
        this.root.innerHTML = `<div class="content" id="preview-content"><h3>📁 ${t("preview.folder")}</h3><div class="model-detail-title" style="font-size:13px;font-weight:600">${esc(folderName)}</div><div class="dp-placeholder" style="padding:12px 0"><div class="dp-hint">${t("preview.folderNoInfo")}</div></div></div>`;
        return;
      }
      this.root.innerHTML = `<div class="content" id="preview-content">
<h3>📦 ${t("preview.pack")}</h3>
${pack.imageBase64 ? `<div class="preview-thumb"><img src="${esc(pack.imageBase64)}" alt="封面"></div>` : ""}
<div class="model-detail-title" style="font-size:14px;font-weight:700">${esc(pack.name || "")}</div>
${pack.description ? `<div style="font-size:11px;color:var(--txt);margin-top:6px;line-height:1.6">${esc(pack.description)}</div>` : ""}
</div>`;
    } catch (err) {
      // P2 修复：catch 分支同样比对代际——A 目录 GetPackInfo 失败迟到时
      // 若用户已切到 B，不得把「无法读取整合包信息」覆盖到 B 的预览
      if (this._previewGuard.stale(gen)) return;
      this.root.innerHTML = `<div class="content" id="preview-content"><h3>📁 ${t("preview.folder")}</h3><div class="dp-placeholder"><div class="big-icon">📁</div><div class="dp-hint">${t("preview.packReadFailed")}</div></div></div>`;
    }
  }

}
// 注册组件（防 HMR/重复 import 时重复 define）
if (typeof customElements !== "undefined" && !customElements.get("app-preview")) {
  customElements.define("app-preview", AppPreview);
}
// HMR 热更新：仅 previewCSS（./css.ts）变更时热刷 shadow 样式表；其余依赖变更落到 Vite 整页重载。
// 之前用无参 accept(cb) 自接受，把整棵子树（含 3D 预览 mount-preview-core/vrm-bone-ui 等）都吞成
// 该边界，回调又只重挂样式表 → 隔壁改样式/加按钮不刷新（只报 index.ts 一个更新点）。
import.meta.hot?.accept("./css.ts", (newCssMod) => {
  refreshAdoptedStyleSheets(newCssMod?.previewCSS, "app-preview");
});
