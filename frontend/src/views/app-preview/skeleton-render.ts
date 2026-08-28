// ===== 骨骼渲染逻辑 =====
// 纯 DOM 创建/HTML 生成函数，不含事件绑定
import { safeGet } from "../../utils/dom/storage.ts";
import type { BedrockGeometry } from "./geometry.ts";
import { esc } from "../../utils/dom/html.ts";
import { safeUrl } from "../../utils/format/summarize.ts";
import { getApp } from "../../backend/app.ts";
import { statsCardHTML } from "./tpl.ts";
import { buildBoneNamesText } from "./bone-names.ts";
import { renderMultiAngle } from "./screenshot-renderer.ts";
import { t } from "../../core/i18n/t.ts";
import { sec, iRow, buildDepthMap } from "./skeleton-utils.ts";
import type { PreviewRoot, YsmDecoder, PreviewDebugger } from "./utils.ts";
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
      textureImg!.onerror = r;
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

/**
 * 构建统计卡片（含作者列表）
 */
export function buildStatsCard(
  container: HTMLElement,
  model: BedrockGeometry & { _authors?: Array<{ avatarUrl?: string | null; name?: string; role?: string; bilibili?: string }>; _modelPath?: string },
  modelPath: string,
  _decodedBy: string,
  ctx: PreviewRoot & YsmDecoder & PreviewDebugger,
): void {
  const card = document.createElement("div");
  card.className = "pv-card";
  card.innerHTML = statsCardHTML(model, modelPath);
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
      const texUrls =
        model.textures && model.textures.length > 1
          ? model.textures
          : [model.texture || ""];
      const results = await renderMultiAngle(model._modelPath || "", texUrls, {
        size: 512,
        componentTextures: model.componentTextures,
      });
      b64 = results?.[0]?.base64 ?? null;
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
    const texUrls =
      model.textures && model.textures.length > 1
        ? model.textures
        : [model.texture || ""];
    const results = await renderMultiAngle(model._modelPath || "", texUrls, {
      size: 512,
      componentTextures: model.componentTextures,
    });
    if (!results) return;
    const hit = results.find((r) => r.name === key);
    if (hit) await SaveScreenshotFile(base + "_" + key + ".png", hit.base64);
  }
  setShotState("\u2705");
  setTimeout(() => setShotState("\u{1F4F7}"), 2000);
}
