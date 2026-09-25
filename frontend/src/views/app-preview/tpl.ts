// ===== preview HTML 模板 =====

import { t } from "@/core/i18n/t.ts";
import { DECODE_SOURCE } from "@/preview-3d/decoder/utils.ts";
import { esc } from "@/utils/html/html.ts";
import { resolveIcon } from "@/utils/icon/resolve.ts";
import { UI_ICONS, type UiIconName } from "@/utils/icon/ui-icons.ts";
import { extOf } from "@/utils/resource/types.ts";

/** 模型统计元数据（modelDetailHTML 入参） */
export interface ModelDetailMeta {
  name?: string;
  author?: string;
  version?: string;
  bones?: number;
  textures?: number;
  animations?: number;
  vertices?: number;
  faces?: number;
  hasError?: boolean;
  errorMsg?: string;
}

/** 模型详情面板（仓库页面） */
export function modelDetailHTML(meta: ModelDetailMeta | null): string {
  if (!meta) {
    return `<div class="content" id="preview-content">
<h3>${UI_ICONS.file} ${t("preview.modelInfo")}</h3>
<div class="dp-placeholder">
  <div class="big-icon"></div>
  <div class="dp-hint">${t("preview.clickFileHint")}</div>
  <div class="dp-hints">
    <span>${UI_ICONS.gem} ${t("preview.ysmModel")}</span>
    <span>${UI_ICONS.character} ${t("preview.mmdSkin")}</span>
    <span>${UI_ICONS.vrHeadset} ${t("preview.vrcAvatar")}</span>
    <span>${UI_ICONS.appearance} ${t("preview.resourcePack")}</span>
  </div>
</div>
</div>`;
  }
  if (meta.hasError) {
    const errMsg = meta.errorMsg || t("preview.unknownError");
    return `<div class="content" id="preview-content">
<h3>${UI_ICONS.file} ${t("preview.modelInfo")}</h3>
<div class="err">${UI_ICONS.warning} ${errMsg}</div>
</div>`;
  }
  return `<div class="content" id="preview-content">
<h3>${UI_ICONS.file} ${t("preview.modelInfo")}</h3>
<div class="md-row"><span class="md-label">${t("preview.nameLabel")}</span><span class="md-value">${esc(meta.name || "-")}</span></div>
<div class="md-row"><span class="md-label">${t("preview.authorLabel")}</span><span class="md-value">${esc(meta.author || "-")}</span></div>
<div class="md-row"><span class="md-label">${t("preview.versionLabel")}</span><span class="md-value">${esc(meta.version || "-")}</span></div>
<div class="md-divider"></div>
<div class="md-row"><span class="md-label">${UI_ICONS.bone} ${t("preview.label.bones")}</span><span class="md-value">${meta.bones || 0}</span></div>
<div class="md-row"><span class="md-label">${UI_ICONS.image} ${t("preview.texturesLabel")}</span><span class="md-value">${meta.textures || 0}</span></div>
<div class="md-row"><span class="md-label">${UI_ICONS.video} ${t("preview.animationsLabel")}</span><span class="md-value">${meta.animations || 0}</span></div>
<div class="md-row"><span class="md-label">${UI_ICONS.collision} ${t("preview.verticesLabel")}</span><span class="md-value">${(meta.vertices || 0).toLocaleString()}</span></div>
<div class="md-row"><span class="md-label">◻️ ${t("preview.facesLabel")}</span><span class="md-value">${(meta.faces || 0).toLocaleString()}</span></div>
</div>`;
}

// ===== 页面骨架四件套（3a 收口：原散在 card-shell/detail/maid/litematic/router 的
// 手写 preview-content 壳 / dp-placeholder 占位 / tab 壳逐份复制，统一由此出口） =====

/** 占位块大图标槽 */
export function bigIconHTML(icon: string): string {
  return `<div class="big-icon">${icon}</div>`;
}

/** 占位 hint 行：string = 标准 dp-hint；对象形态可挂 attrs（maid head 行内样式特化） */
export type PlaceholderHint = string | { html: string; attrs?: string };

/** 居中占位块（加载 / 错误 / 空态通用容器，CSS 见 css.ts .dp-placeholder*）。
 *  lead：首元素**原样 HTML**——标准用法传 bigIconHTML(icon)；maid 封面态传裸 <img>。
 *  hints：多条 dp-hint（内容原样 HTML，调用方自行 esc）。head：紧凑头部变体。 */
export function placeholderHTML(opts: {
  lead?: string;
  hints?: PlaceholderHint[];
  head?: boolean;
}): string {
  const cls = opts.head ? "dp-placeholder dp-placeholder--head" : "dp-placeholder";
  const hints = (opts.hints ?? [])
    .map((h) =>
      typeof h === "string"
        ? `<div class="dp-hint">${h}</div>`
        : `<div class="dp-hint"${h.attrs ? ` ${h.attrs}` : ""}>${h.html}</div>`,
    )
    .join("");
  return `<div class="${cls}">${opts.lead ?? ""}${hints}</div>`;
}

/** 标准读取失败占位（warning 图标 + 「读取失败: <消息>」）；message 为原始文本，内部转义 */
export function errorPlaceholderHTML(message: string): string {
  return placeholderHTML({
    lead: bigIconHTML(UI_ICONS.warning),
    hints: [`${t("preview.readFailed")}: ${esc(message)}`],
  });
}

/** 预览页统一骨架：#preview-content > h3(icon + title) + body。title 内部转义，body 原样 */
export function pageShellHTML(opts: { icon: string; title: string; body: string }): string {
  return `<div class="content" id="preview-content">
  <h3>${opts.icon} ${esc(opts.title)}</h3>
  ${opts.body}
</div>`;
}

/** Tab 描述（key 同时派生面板 id：#preview-<key>） */
export interface PreviewTabSpec {
  key: string;
  icon: string;
  label: string;
}

/** 多 Tab 预览页骨架（YSM 详情/投影共用）：tab-row + 每 key 一个 #preview-<key> 面板，
 *  非激活面板带 style="display:none"；fabHTML 尾挂在壳外（litematic 3D FAB）。
 *  点击事件用 utils.ts 的 bindPreviewTabs(root, storageKey) 绑定。 */
export function tabbedShellHTML(opts: {
  tabs: PreviewTabSpec[];
  active: string;
  panes: Array<{ key: string; body: string }>;
  fabHTML?: string;
}): string {
  const tabBtns = opts.tabs
    .map(
      (tab) =>
        `    <button class="pv-tab ${opts.active === tab.key ? "pv-tab-active" : "pv-tab-inactive"}" data-tab="${tab.key}">${tab.icon} ${esc(tab.label)}</button>`,
    )
    .join("\n");
  const panes = opts.panes
    .map(
      (p) =>
        `  <div id="preview-${p.key}"${opts.active !== p.key ? ' style="display:none"' : ""}>${p.body}</div>`,
    )
    .join("\n");
  return `<div class="content" id="preview-content">
  <div class="pv-tab-row">
${tabBtns}
  </div>
${panes}
</div>${opts.fabHTML ?? ""}`;
}

/** 模型统计卡片（statsCardHTML 入参的几何视图） */
export interface StatsCardModel {
  boneCount: number;
  cubeCount: number;
  texWidth?: number;
  texHeight?: number;
  textures?: unknown[];
  /** 纹理文件名（去扩展名），与 textures 同序（区分角色纹理/独立模型用） */
  textureNames?: string[];
  /** 纹理分类：player = 角色可切换皮肤；projectile/vehicle/arrow = 独立模型组件专属 */
  textureCategories?: string[];
  /** L0 清单角色（多角色包内切换用）：name + texSlot（对应 textures 下标） */
  subModels?: Array<{ name: string; texSlot?: number }>;
  /** 子模型数量（多角色包）：extraCount = texCount - subCount（而非固定 -1）。
   *  默认1（单模型），多角色包时传 subModels.length */
  subCount?: number;
  /** 逐组件统计数据（从3D spec 对齐）：bone/cube 按组件拆分，与3D roles 面板一致。
   *  有数据时渲染组件化统计行替代聚合 boneCount/cubeCount。 */
  componentCounts?: Array<{ name: string; bones: number; cubes: number }>;
  /** Go FileInventory 权威归属清单（go/types/bedrock.go）。非空时渲染「包内文件」行 */
  fileInventory?: {
    animations?: string[];
    controllers?: string[];
    langFiles?: string[];
    incFiles?: string[];
    legacyModels?: string[];
    avatars?: string[];
  };
  /** 解码器来源**码**（`DECODE_SOURCE`，由解码器盖章）。展示层按码查表渲染
   *  「SVG 图标 + i18n 文案」；未识别的码（如旧缓存里遗留的展示文案）不渲染，避免漏出裸串。 */
  _decodedBy?: string;
}

/**
 * 解码器来源码 → 徽标 HTML（ADR-238：结构槽图标走 SVG；文案走 i18n）。
 * 返回 "" = 无码或码未识别（不渲染空壳/裸串）。`t()` 用字面量键以吃类型检查。
 */
function decodeBadgeHTML(code: string | undefined): string {
  const badge = (icon: UiIconName, label: string): string =>
    `<span class="ysm-badge">${resolveIcon(icon)} ${esc(label)}</span>`;
  switch (code) {
    case DECODE_SOURCE.wasm:
      return badge("parser", t("preview.decodedBy.wasm"));
    case DECODE_SOURCE.json:
      return badge("parser", t("preview.decodedBy.json"));
    case DECODE_SOURCE.go:
      return badge("package", t("preview.decodedBy.go"));
    case DECODE_SOURCE.goSingle:
      return badge("package", t("preview.decodedBy.goSingle"));
    default:
      return "";
  }
}

/** 模型统计卡片 */
export function statsCardHTML(model: StatsCardModel, modelPath: string): string {
  // 派生显示格式：extOf 统一扩展名口径（G1 收口——原正则/endsWith 手写漂移点；
  // 语义保持：.7z 无独立格式归「其他」，zip 容器单列）
  const ext = extOf(modelPath);
  const fmt =
    ext === ".ysm"
      ? ".ysm"
      : ext === ".json"
        ? ".json (解压目录)"
        : ext === ".zip"
          ? ".zip"
          : "其他";
  // 解码器徽标挂在文件信息橙卡（2026-09-18 从 h3 标题行迁回，与格式信息同展）
  // 纹理分类统计（区分角色纹理 vs 独立模型组件纹理，2026-08-28）：
  // 统计卡「含 N 张额外纹理」口径不再把独立模型纹理混进角色纹理
  const cats = model.textureCategories || [];
  const roleTexCount = cats.filter((c) => c === "player").length;
  const compTexCount = cats.filter((c) => c && c !== "player").length;
  const componentCounts = model.componentCounts || [];
  const catSummary =
    roleTexCount > 0 || compTexCount > 0
      ? `<div class="pv-card-row" style="font-size:var(--fs-xs);color:var(--muted);padding:var(--pad-v-1)">${UI_ICONS.character} ${t("preview.roleTexCount", { role: roleTexCount, comp: compTexCount })}</div>`
      : "";
  // L0 清单角色区块（每角色：纹理标题 + 尺寸）
  const subs = model.subModels || [];
  const subRows =
    subs.length > 0
      ? subs
          .map((s) => {
            const texName = (model.textureNames || [])[s.texSlot ?? 0] || "—";
            return `<div style="display:flex;align-items:center;gap:6px;padding:var(--pad-v-2);font-size:var(--fs-sm)">
        <span style="font-weight:600;color:var(--txt)">${UI_ICONS.character} ${esc(s.name)}</span>
        <span style="color:var(--muted)">${esc(texName)}</span>
        ${model.texWidth && model.texHeight ? `<span style="color:var(--muted)">${model.texWidth}×${model.texHeight}px</span>` : ""}
      </div>`;
          })
          .join("")
      : "";
  const subBlock =
    subs.length > 0
      ? `<div class="pv-card-section pv-section-blue">
  <div class="pv-card-section-label">${UI_ICONS.character} ${t("preview.rolesList", { n: subs.length })}</div>
  ${subRows}
</div>`
      : "";
  // 多纹理概要（仅当存在额外纹理时）
  let texMapHtml = "";
  const texCount = model.textures?.length || 0;
  // extraCount：单模型 = texCount - 1（主纹理 + 额外层）；多角色包 = texCount - subCount（每角色绑定一张，额外层是剩余）
  const subCount = model.subCount || 1;
  const extraCount = texCount > subCount ? texCount - subCount : 0;
  if (extraCount > 0) {
    texMapHtml = `<div class="pv-card-row" style="font-size:var(--fs-xs);color:var(--muted);padding:var(--pad-v-1)">${UI_ICONS.attach} ${t("preview.extraTextures", { extra: extraCount, total: texCount })}</div>`;
  }
  // Go FileInventory 权威归属清单（zip 模型专属，文件夹模型无此字段）：
  // 非零类目渲染为「图标 + 计数」芯片，tooltip 携带权威文件路径——前端只展示不判定。
  // 图标填**语义名**（ADR-238/ADR-245：resolveIcon 解析为 SVG）；label 走 i18n
  //（原为硬编码中文，切语言后仍显示中文——与 JS 侧 UI 槽同族的 i18n 泄漏）。
  const inv = model.fileInventory;
  const invChips = [
    { icon: "video", label: t("preview.inventory.animations"), files: inv?.animations },
    { icon: "controls", label: t("preview.inventory.controllers"), files: inv?.controllers },
    { icon: "web", label: t("preview.inventory.langFiles"), files: inv?.langFiles },
    { icon: "parser", label: t("preview.inventory.legacyModels"), files: inv?.legacyModels },
    { icon: "image", label: t("preview.inventory.avatars"), files: inv?.avatars },
  ].flatMap((c) =>
    c.files?.length
      ? [
          {
            icon: resolveIcon(c.icon),
            label: `${c.label} ${c.files.length}`,
            title: c.files.join("\n"),
          },
        ]
      : [],
  );
  const invHtml =
    invChips.length > 0
      ? `<div class="pv-card-row" style="font-size:var(--fs-xs);color:var(--muted);padding:var(--pad-v-1);flex-wrap:wrap;gap:2px var(--sp-2)">${UI_ICONS.package} ${t("preview.inventory")}${invChips.map((c) => `<span title="${esc(c.title)}">${c.icon} ${esc(c.label)}</span>`).join("")}</div>`
      : "";
  return `
<div class="pv-card-section pv-section-blue">
  <div class="pv-card-section-label">${UI_ICONS.link} ${t("preview.modelStructure")}</div>
  ${
    componentCounts.length > 0
      ? componentCounts
          .map(
            (c) =>
              `<div class="pv-card-row" style="font-size:var(--fs-xs)"><span class="pv-stat-label" style="min-width:72px">${esc(c.name)}</span><span class="pv-card-val">${c.bones}</span> 骨骼 · <span class="pv-card-val">${c.cubes}</span> 立方体</div>`,
          )
          .join("")
      : `<div class="pv-card-row">
    <span class="pv-stat-label">${t("preview.label.boneCount")}</span><span class="pv-card-val">${model.boneCount}</span> ${t("preview.unit")}<br>
    <span class="pv-stat-label">${t("preview.cubesLabel")}</span><span class="pv-card-val">${model.cubeCount}</span> ${t("preview.unit")}
  </div>`
  }
</div>
${subBlock}
<div class="pv-card-section pv-section-green">
  <div class="pv-card-section-label">${UI_ICONS.image} ${t("preview.textureSize")}</div>
  <div class="pv-card-row">
     <span class="pv-card-val">${model.texWidth || "?"} × ${model.texHeight || "?"}</span> ${t("preview.px")}
  </div>
  ${catSummary}
  ${texMapHtml}
  ${invHtml}
</div>
<div class="pv-card-section pv-section-orange">
  <div class="pv-card-section-label">${UI_ICONS.save} ${t("preview.fileInfo")}</div>
  <div class="pv-card-row">${fmt}${decodeBadgeHTML(model._decodedBy)}</div>
</div>`;
}
