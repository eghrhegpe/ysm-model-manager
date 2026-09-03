// ===== 骨骼渲染逻辑 =====
// 纯 DOM 创建/HTML 生成函数，不含事件绑定
import { safeGet } from "../../utils/dom/storage.ts";
import type { BedrockGeometry } from "../../preview-3d/decoder/geometry.ts";
import { esc } from "../../utils/dom/html.ts";
import { safeUrl } from "../../utils/format/summarize.ts";
import { getApp } from "../../backend/app.ts";
import { statsCardHTML } from "./tpl.ts";
import { buildBoneNamesText } from "./bone-names.ts";
import { renderMultiAngle } from "../../preview-3d/screenshot-render.ts";
import { toScreenshotLights } from "../../preview-3d/screenshot-lights.ts";
import { decodeYsmViaWasm } from "../../preview-3d/decoder/wasm-decode.ts";
import { t } from "../../core/i18n/t.ts";
import type { PreviewRoot, YsmDecoder, PreviewDebugger } from "./utils.ts";
import type { Model3DSpec } from "../../../bindings/ysm-model-manager/go/threejs/models.ts";
// P1 修复（ADR-040）：fill3DPanel 已拆至 skeleton-fill-panel.ts，此处 re-export 兼容
export { fill3DPanel } from "./skeleton-fill-panel.ts";

/**
 * 创建 2D 骨骼画布并异步加载纹理
 */
export async function setup2DCanvas(
  container: HTMLElement,
  model: BedrockGeometry & { texture?: string | null; _modelPath?: string },
): Promise<{ canvas: HTMLCanvasElement; textureImg: HTMLImageElement | null }> {
  const canvas = document.createElement("canvas");
  canvas.width = 180;
  canvas.height = 180;
  canvas.className = "pv-canvas";
  container.appendChild(canvas);

  let textureImg: HTMLImageElement | null = null;
  if (model.texture) {
    textureImg = new Image();
    await new Promise((r) => {
      textureImg!.onload = r;
      textureImg!.onerror = () => { textureImg = null; r(null); };
      textureImg!.src = model.texture as string;
    });
  }
  return { canvas, textureImg };
}

/**
 * 构建骨骼名开关行（不含放大按钮，放大按钮由调用方单独添加）
 */
export function buildToggleRow(
  container: HTMLElement,
): {
  toggleRow: HTMLElement;
  eyeBtn: HTMLButtonElement;
  eyeHint: HTMLSpanElement;
  getLabelsOn: () => boolean;
  setLabelsOn: (v: boolean) => void;
} {
  const toggleRow = document.createElement("div");
  toggleRow.className = "pv-toggle-row";
  const eyeBtn = document.createElement("button");
  eyeBtn.className = "pv-btn";
  const savedState = safeGet("ysm_showBoneLabels") !== "false";
  let _labelsOn = savedState;
  eyeBtn.innerHTML = _labelsOn ? `👁 ${t("preview.field.boneNames")}` : `👁‍🗨 ${t("preview.field.boneNames")}`;
  eyeBtn.title = "切换骨骼名称显示";
  const eyeHint = document.createElement("span");
  eyeHint.className = "pv-hint";
  eyeHint.textContent = _labelsOn ? t("preview.on") : t("preview.off");
  toggleRow.appendChild(eyeBtn);
  toggleRow.appendChild(eyeHint);
  container.appendChild(toggleRow);

  return {
    toggleRow,
    eyeBtn,
    eyeHint,
    getLabelsOn: () => _labelsOn,
    setLabelsOn: (v: boolean) => {
      _labelsOn = v;
      eyeBtn.innerHTML = _labelsOn ? `👁 ${t("preview.field.boneNames")}` : `👁‍🗨 ${t("preview.field.boneNames")}`;
      eyeHint.textContent = _labelsOn ? t("preview.on") : t("preview.off");
    },
  };
}

/** spec.models[] → 逐组件统计投影（骨骼 = bones.length；立方体 = Σ bones[]._cubeCount）。
 *  详情卡模型结构蓝卡与 3D「组件」下拉共用同一 spec 视图（ADR-160：详情统计 = spec 投影）；
 *  无组件返回 []，调用方回落聚合口径。 */
// ADR-161 §2.1：spec 契约单一镜像——统计侧直接锚定 Go 绑定 Model3DSpec，
// 不再经 Spec3D 镜像/unknown 袋（镜像缺 _cubeCount/textureWidth 曾逼出双层 as 谎言）。
export function componentCountsFromSpec(
  spec: Model3DSpec | null | undefined,
): Array<{ name: string; bones: number; cubes: number }> {
  const models = spec?.models || [];
  return models.map((m) => {
    const bones = m.bones ?? [];
    let cubes = 0;
    for (const b of bones) cubes += b._cubeCount || 0;
    return { name: m.name || m.id || "?", bones: bones.length, cubes };
  });
}

/**
 * 构建统计卡片（含作者列表）
 * 异步获取3D spec 以对齐3D面板逐组件数据源——bone/cube 按 spec.models[] 拆分，
 * 纹理尺寸取 spec 第一个组件的声明值（与3D面板一致）。
 */
export async function buildStatsCard(
  container: HTMLElement,
  model: BedrockGeometry & { _authors?: Array<{ avatarUrl?: string | null; name?: string; role?: string; bilibili?: string }>; _modelPath?: string },
  modelPath: string,
  _decodedBy: string,
  _ctx: PreviewRoot & YsmDecoder & PreviewDebugger,
): Promise<void> {
  const card = document.createElement("div");
  card.className = "pv-card";
  // 获取3D spec 以对齐3D面板数据源（逐组件 bone/cube + 声明纹理尺寸）
  let spec: Model3DSpec | null = null;
  try {
    const { GetModel3DSpec } = await getApp();
    spec = await GetModel3DSpec(modelPath);
  } catch {
    // spec 获取失败不阻断——回退到聚合数据
  }
  const componentCounts = componentCountsFromSpec(spec);
  // 纹理尺寸：取第一个组件的声明值（与3D面板对齐；spec 无数据时回退到 BedrockGeometry）
  const m0 = spec?.models?.[0];
  const texW = m0?.textureWidth ?? model.texWidth;
  const texH = m0?.textureHeight ?? model.texHeight;
  // 构造对齐3D面板的模型数据（逐组件 bone/cube + 声明纹理尺寸）
  const enrichedModel = {
    ...model,
    boneCount: componentCounts.length > 0 ? componentCounts.reduce((s, c) => s + c.bones, 0) : model.boneCount,
    cubeCount: componentCounts.length > 0 ? componentCounts.reduce((s, c) => s + c.cubes, 0) : model.cubeCount,
    texWidth: texW,
    texHeight: texH,
    componentCounts,
  };
  card.innerHTML = statsCardHTML(enrichedModel, modelPath);
  const authors: Array<{ avatarUrl?: string | null; name?: string; role?: string; bilibili?: string }> =
    model._authors || [];
  if (authors.length > 0) {
    const authorHtml =
      '<div class="pv-card-section-label" style="margin-top:6px">👥 ' + t("preview.authors") + '</div>' +
      authors
        .map(
          (au) => `<div style="display:flex;align-items:center;gap:6px;padding:3px 0">
        ${
          au.avatarUrl
            ? `<img src="${esc(au.avatarUrl)}" style="width:20px;height:20px;border-radius:50%;object-fit:cover;border:1px solid var(--bd)" onerror="this.style.display='none'">`
            : '<span style="width:20px;height:20px;border-radius:50%;background:var(--hover);display:inline-block"></span>'
        }
        <span style="font-size:11px;color:var(--txt)">${esc(au.name || "")}</span>
        ${
          au.role
            ? `<span style="font-size:var(--fs-xs);color:var(--muted)">(${esc(au.role)})</span>`
            : ""
        }
        ${
          au.bilibili
            ? `<a href="${esc(safeUrl(au.bilibili))}" target="_blank" style="color:var(--accent);text-decoration:none;font-size:11px" title="${esc(au.bilibili)}">📺</a>`
            : ""
        }
      </div>`,
        )
        .join("");
    card.innerHTML += authorHtml;
    // 顶部 ysm-author-avatars 小头像行已移除（2026-08-28）：作者头像/角色在统计卡作者
    // 列表内统一承载，不再向详情页顶部重复填充小头像（原 skeleton-render.ts 填充逻辑）
  }
  container.appendChild(card);
}

/**
 * 构建导出骨骼名按钮行
 */
export function buildBoneExportRow(
  container: HTMLElement,
  model: BedrockGeometry & { boneCount?: number; bones?: Array<{ id: string; name: string; parentId?: string }> },
  modelPath: string,
): void {
  const boneRow = document.createElement("div");
  boneRow.className = "pv-toggle-row";
  const boneBtn = document.createElement("button");
  boneBtn.className = "pv-btn";
  boneBtn.textContent = "📋 " + t("preview.action.exportBoneNames");
  boneBtn.title = "导出骨骼名称为文本文件";
  const boneHint = document.createElement("span");
  boneHint.className = "pv-hint";
  boneHint.textContent = `${model.boneCount} ${t("preview.section.bones")}`;
  boneBtn.onclick = (): void => {
    const lines = buildBoneNamesText(modelPath, model.boneCount ?? 0, model.bones || []);
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.download = (modelPath.split(/[/\\]/).pop() || "model") + "_bones.txt";
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  };
  boneRow.appendChild(boneBtn);
  boneRow.appendChild(boneHint);
  container.appendChild(boneRow);
}

/**
 * 截图保存内部逻辑（供 3D overlay 使用）
 */
export async function saveScreenshot(
  model: BedrockGeometry & {
    textures?: string[] | null;
    componentTextures?: Record<string, string[]>;
    _modelPath?: string;
  },
  key: string,
  setShotState: (icon: string) => void,
  screenshotFn?: () => Promise<string | null>,
): Promise<void> {
  const { SaveScreenshotFile } = await getApp();
  const p = (model._modelPath || "screenshot").replace(/\\/g, "/");
  const base = p.split("/").pop()?.replace(/\.\w+$/, "") || "";
  if (key === "current") {
    let b64: string | null;
    if (screenshotFn) {
      // ADR-052 P3：首选活跃渲染器截图（实时、当前视角）
      b64 = await screenshotFn();
    } else {
      // fallback：无活跃渲染器时复用 renderMultiAngle 取 front 帧
      b64 = await renderFrontFrame(model);
    }
    if (!b64) {
      // 抛错而非静默吞错：让消费者统一 catch（setIcon ❌ + toast），
      // 否则用户只见 ❌ 无原因（陷阱 #3 静类：异步失败须可观测）
      throw new Error("截图返回空（3D 渲染尚未就绪）");
    }
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    await SaveScreenshotFile(base + "_" + ts + ".png", b64);
  } else if (key === "all") {
    for (const k of ["front", "45", "side", "back45"]) await saveScreenshot(model, k, setShotState, screenshotFn);
  } else {
    // 按请求视角渲染对应帧（renderFrame 内 renderMultiAngle 返回 front/45/side/back45
    // 并按 key 匹配 name——审查 P1：误用 renderFrontFrame 会让 45/side/back45 全部
    // 保存 front 帧，文件名与内容错位）
    const b64 = await renderFrame(model, key);
    if (!b64) return;
    await SaveScreenshotFile(base + "_" + key + ".png", b64);
  }
  setShotState("\u2705");
  setTimeout(() => setShotState("\u{1F4F7}"), 2000);
}

/** 无活跃渲染器时复用 renderMultiAngle 渲染指定视角帧（front/45/side/back45/all 共用；key 传 "front" 等） */
async function renderFrame(model: BedrockGeometry & { textures?: string[] | null; componentTextures?: Record<string, string[]>; _modelPath?: string }, key: string): Promise<string | null> {
  const texUrls =
    model.textures && model.textures.length > 1
      ? model.textures
      : [model.texture || ""];
  const results = await renderMultiAngle(model._modelPath || "", texUrls, {
    size: 512,
    componentTextures: model.componentTextures,
    lights: toScreenshotLights(),
    decodeYsm: decodeYsmViaWasm, // ADR-136：features 不反向 import views，WASM 兜底由视图层注入
  });
  if (!results) return null;
  const hit = results.find((r) => r.name === key);
  return hit?.base64 ?? null;
}

/** 无活跃渲染器 fallback：取 front 帧 base64（key === "current" 分支） */
async function renderFrontFrame(model: Parameters<typeof renderFrame>[0]): Promise<string | null> {
  return renderFrame(model, "front");
}
