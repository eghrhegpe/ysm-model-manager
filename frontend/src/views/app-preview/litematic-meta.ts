import { renderFormattedText } from "../../utils/format/mc-format.ts";
import { esc } from "../../utils/dom/html.ts";
import { safeErrorMessage } from "../../utils/safe-error-msg.ts";
import { extOf, VOXEL_RPC_BY_EXT } from "../../utils/resource/types.ts";
import { getApp } from "../../backend/app.ts";
import { safeGet, safeSet } from "../../utils/dom/storage.ts";
import type { PreviewRoot } from "./utils.ts";
import { createLitematic3D, cleanupVoxel3D } from "./litematic-3d.ts";
import { t } from "../../core/i18n/t.ts";
import { GenGuard } from "./gen-guard.ts";

function fmtTime(ms: number): string {
  if (!ms || ms <= 0) return "未知";
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// P2 修复：模块级代际守卫——showLitematic 独立于 app-preview 的 _previewGen，
// await Go 解析期间用户切到别的模型时，慢结果不得写进新模型的 #preview-detail
const litematicGuard = new GenGuard();

/**
 * P2 修复（code_review）：任意新预览派发时推进代际——原守卫只在
 * showLitematic 自身递增，litematic A 解析中切到 YSM B（走 detailGen）
 * 不触碰它 → A 迟到仍写进 B 的 #preview-detail（跨类型污染）。index.ts 的
 * model:select 回调开头调用本函数，使所有新选择都作废在途 litematic 结果。
 */
export function invalidateLitematicPreview(): void {
  litematicGuard.invalidate();
}

function shortName(name: string): string {
  return (name || "").replace(/^minecraft:/, "");
}

function blockColorHTML(name: string): string {
  const map: Record<string, string> = {
    stone: "#7F7F7F", dirt: "#9B6B3D", grass_block: "#7C9E4C", sand: "#DFD3A8",
    gravel: "#807F7D", cobblestone: "#6F6F6F", sandstone: "#D8CCA5",
    oak_planks: "#BA8E4A", spruce_planks: "#735C3C", birch_planks: "#D9CB9E",
    oak_log: "#8E7B56", spruce_log: "#4A3928", oak_leaves: "#4C8E2E",
    water: "#3F76E4", lava: "#CF5300", glass: "#BFD9EF", bricks: "#9E5E44",
    obsidian: "#1A1024", bedrock: "#404040", coal_ore: "#6B6B6B",
    iron_ore: "#C6A28B", gold_ore: "#D0AA37", diamond_ore: "#6FE0DF",
    redstone_ore: "#B52B24", lapis_ore: "#254D9E", emerald_ore: "#2DB74B",
    netherrack: "#6F3236", glowstone: "#C4B168", soul_sand: "#453326",
    end_stone: "#D9D7A2", purpur_block: "#A87DA8", prismarine: "#64A396",
    coal_block: "#343434", iron_block: "#D8D8D8", gold_block: "#F9E14B",
    diamond_block: "#5DE5E5", netherite_block: "#44342B", deepslate: "#4F4E52",
    tuff: "#5F645A", blackstone: "#2D2C33", basalt: "#484A4C",
    white_concrete: "#D0D5D9", orange_concrete: "#DF6200",
    light_blue_concrete: "#2A93CD", yellow_concrete: "#F1B021",
    lime_concrete: "#60B91C", pink_concrete: "#D47489", gray_concrete: "#3E4147",
    light_gray_concrete: "#828282", cyan_concrete: "#157788",
    purple_concrete: "#7B2EAE", blue_concrete: "#2D3291",
    brown_concrete: "#5F453B", green_concrete: "#4B572B", red_concrete: "#932922",
    black_concrete: "#0F1117",
  };
  if (map[name]) return map[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(h) % 360}, 50%, 60%)`;
}

/** 方块统计条目 */
interface BlockStat {
  name: string;
  count: number;
}

function renderBlockList(stats: BlockStat[] | undefined): string {
  if (!stats || !stats.length) return `<div style="color:var(--muted);font-size:var(--fs-sm)">${t("preview.noBlockData")}</div>`;
  let total = 0;
  for (const s of stats) total += s.count;
  const rows = stats
    .map((s) => {
      const color = blockColorHTML(shortName(s.name));
      return `<div class="lt-block-row"><span class="lt-color-swatch" style="background:${color}"></span><span class="lt-block-name">${esc(shortName(s.name))}</span><span class="lt-block-count">${t("preview.blockCount", { n: s.count })}</span></div>`;
    })
    .join("");
  return `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:var(--fs-xs);color:var(--muted)"><span>${t("preview.uniqueBlocks", { n: stats.length })}</span><span>${t("preview.totalBlocks", { n: total.toLocaleString() })}</span></div><div class="lt-material-list">${rows}</div>`;
}

/** 投影元数据（ReadLitematicMeta/ReadNbtStructure/ReadSchematic 返回 JSON 的兼容视图） */
interface LitematicMeta {
  name?: string;
  author?: string;
  version?: number;
  minecraftDataVersion?: number;
  description?: string;
  timeCreated?: number;
  timeModified?: number;
  totalBlocks?: number;
  blockCount?: number;
  totalVolume?: number;
  regionCount?: number;
  entityCount?: number;
  tileEntityCount?: number;
  enclosingSize?: number[];
  size?: number[];
  blockStats?: BlockStat[];
  paletteStats?: BlockStat[];
  previewImage?: string;
  dataVersion?: number;
  [key: string]: unknown;
}

/** 解析投影元数据：按扩展名分发 Go 读取 + 校验，无法解析抛错（litematic 解析语义） */
async function parseLitematicMeta(ext: string, path: string): Promise<LitematicMeta> {
  const { ReadLitematicMeta, ReadNbtStructure, ReadSchematic } = await getApp();
  let meta: LitematicMeta;
  if (ext === ".nbt") {
    meta = JSON.parse((await ReadNbtStructure(path)) || "{}") as LitematicMeta;
    if (!meta || (!meta.size && !meta.blockCount)) throw new Error("无法解析");
  } else if (ext === ".schematic") {
    meta = JSON.parse((await ReadSchematic(path)) || "{}") as LitematicMeta;
    if (!meta || (!meta.size && !meta.blockCount)) throw new Error("无法解析");
  } else {
    meta = JSON.parse((await ReadLitematicMeta(path)) || "{}") as LitematicMeta;
    if (!meta || (!meta.name && !meta.author && meta.totalBlocks === undefined)) throw new Error("无法解析");
  }
  return meta;
}

/** 渲染详情面板：代际守卫 + field/extra 拼接 + detailDiv innerHTML（litematic 详情语义） */
function renderLitematicDetail(
  ctx: PreviewRoot,
  meta: LitematicMeta,
  ext: string,
  basename: string,
  gen: number,
): void {
  const sizeArr = meta.enclosingSize || meta.size;
  const sizeStr = sizeArr ? `${sizeArr[0] || 0} × ${sizeArr[1] || 0} × ${sizeArr[2] || 0}` : "未知";

  const previewImgHTML = meta.previewImage
    ? `<img src="${esc(meta.previewImage)}" alt="preview" style="width:140px;height:140px;object-fit:contain;border-radius:6px;border:1px solid var(--bd);align-self:center;image-rendering:pixelated">`
    : "";

  function field(label: string, value: unknown): string {
    return value
      ? `<div class="lt-meta-row"><span class="lt-meta-label">${label}</span><span>${esc(String(value))}</span></div>`
      : "";
  }

  const detailDiv = ctx.root.getElementById("preview-detail");
  if (!detailDiv) return;
  // P2 修复：await Go 解析后比对代际——慢 litematic A 迟到不得污染已切换的 B
  if (litematicGuard.stale(gen)) return;
  let extra = "";
  if (ext === ".nbt" || ext === ".schematic") {
    extra = `${field(t("preview.dataVersion"), meta.dataVersion)}${field(t("preview.formatVersion"), meta.version)}${field(t("preview.nameLabel"), meta.name)}${field(t("preview.authorLabel"), meta.author)}`;
  } else {
    extra = `${field(t("preview.nameLabel"), meta.name)}${field(t("preview.authorLabel"), meta.author)}${field(t("preview.createdAt"), meta.timeCreated ? fmtTime(meta.timeCreated) : "")}${field(t("preview.modifiedAt"), meta.timeModified ? fmtTime(meta.timeModified) : "")}<div class="lt-meta-row"><span class="lt-meta-label">${t("preview.formatVersion")}</span><span>Litematica v${meta.version || "?"} · MC Data v${meta.minecraftDataVersion || "?"}</span></div>${field(t("preview.description"), meta.description)}`;
  }
  detailDiv.innerHTML = `<h3>📋 ${t("preview.blueprintDetail")}</h3>
    <div style="padding:12px;display:flex;flex-direction:column;gap:6px;font-size:var(--fs-sm)">
      ${previewImgHTML}
      <div><strong>${renderFormattedText(basename || "")}</strong></div>
      ${extra}
      <div style="margin:4px 0;border-top:1px solid var(--bd)"></div>
      <div class="lt-meta-row"><span class="lt-meta-label">${t("preview.nonAirBlocks")}</span><span>${t("preview.blockCount", { n: (meta.totalBlocks || meta.blockCount || 0).toLocaleString() })}</span></div>
      <div class="lt-meta-row"><span class="lt-meta-label">${t("preview.totalVolume")}</span><span>${t("preview.cubeUnit", { n: (meta.totalVolume || 0).toLocaleString() })}</span></div>
      <div class="lt-meta-row"><span class="lt-meta-label">${t("preview.boundingBox")}</span><span>${sizeStr}</span></div>
      ${ext !== ".nbt" && ext !== ".schematic" ? `<div class="lt-meta-row"><span class="lt-meta-label">${t("preview.regionCount")}</span><span>${meta.regionCount || 0}</span></div>` : ""}
      ${meta.entityCount !== undefined ? `<div class="lt-meta-row"><span class="lt-meta-label">${t("preview.entityCount")}</span><span>${meta.entityCount}</span></div>` : ""}
      ${meta.tileEntityCount !== undefined ? `<div class="lt-meta-row"><span class="lt-meta-label">${t("preview.blockEntity")}</span><span>${meta.tileEntityCount}</span></div>` : ""}
    </div>`;
}

/** 渲染材料清单面板：materialDiv + renderBlockList（litematic 材料语义） */
function renderLitematicMaterial(ctx: PreviewRoot, meta: LitematicMeta): void {
  const blockStats = meta.blockStats || meta.paletteStats;
  const materialDiv = ctx.root.getElementById("preview-material");
  if (!materialDiv) return;
  materialDiv.innerHTML = `<h3>🧱 ${t("preview.materialList")}</h3>
	    <div style="padding:12px;font-size:var(--fs-sm)">
	      ${renderBlockList(blockStats)}
	    </div>`;
}

/** 显示投影文件详情面板（tab 布局） */
export async function showLitematic(
  ctx: PreviewRoot,
  path: string,
): Promise<void> {
  const gen = litematicGuard.next();
  const basename = path.split(/[/\\]/).pop() || "";
  const savedTab = safeGet("lt_previewTab") || "detail";

  ctx.root.innerHTML = `<div class="content" id="preview-content">
  <div class="pv-tab-row">
    <button class="pv-tab ${savedTab === "detail" ? "pv-tab-active" : "pv-tab-inactive"}" data-tab="detail">📋 ${t("preview.detailTab")}</button>
    <button class="pv-tab ${savedTab === "material" ? "pv-tab-active" : "pv-tab-inactive"}" data-tab="material">🧱 ${t("preview.materialList")}</button>
  </div>
  <div id="preview-detail"${savedTab !== "detail" ? ' style="display:none"' : ""}>
    <div class="dp-placeholder"><div class="big-icon">⏳</div><div class="dp-hint">${t("preview.parsingLitematica")}...</div></div>
  </div>
  <div id="preview-material"${savedTab !== "material" ? ' style="display:none"' : ""}></div>
</div>
<button class="preview-fab" id="btn-lt-3d" title="${t("preview.title3d")}" aria-label="${t("preview.title3d")}"><span class="preview-ic">🎨</span></button>`;

  // Tab 切换
  const switchTab = (tab: string): void => {
    safeSet("lt_previewTab", tab);
    ctx.root.querySelectorAll(".pv-tab").forEach((btn) => {
      const isActive = (btn as HTMLElement).dataset.tab === tab;
      btn.classList.toggle("pv-tab-active", isActive);
      btn.classList.toggle("pv-tab-inactive", !isActive);
    });
    const detail = ctx.root.getElementById("preview-detail");
    const material = ctx.root.getElementById("preview-material");
    if (detail) detail.style.display = tab === "detail" ? "" : "none";
    if (material) material.style.display = tab === "material" ? "" : "none";
  };
  ctx.root.querySelectorAll(".pv-tab").forEach((btn) => {
    (btn as HTMLElement).onclick = (): void => switchTab((btn as HTMLElement).dataset.tab || "");
  });

  // 3D FAB 按钮（对齐 YSM/VRM/MMD 的 preview-fab 标配形态，ADR-072 D3；
  // 原 tab 式 #btn-lt-3d-tab 未并入 FAB 体系，P2 统一）
  const btn3d = ctx.root.getElementById("btn-lt-3d") as HTMLButtonElement | null;
  const ext = extOf(path);

  try {
    const meta = await parseLitematicMeta(ext, path);
    renderLitematicDetail(ctx, meta, ext, basename, gen);
    renderLitematicMaterial(ctx, meta);

    if (btn3d) {
      // 按扩展名单点映射体素 RPC（ADR-066 解墙）；web 端由 web-fs.ts 的
      // Get*VoxelData TS 实现提供数据（ADR-070 M2 voxel-parse.ts 平移）。
      // FAB 形态无按钮级 loading 态（3D 全屏 overlay 自带加载占位），对齐 VRM/MMD；
      // catch 防 unhandled rejection（陷阱 #3：异步点击不得产生未处理拒绝）
      const voxelFn = VOXEL_RPC_BY_EXT[ext] || "GetLitematicVoxelData";
      btn3d.onclick = (): void => {
        createLitematic3D(path, voxelFn).catch((e) => console.warn("[preview] litematic3D:", e));
      };
    }
  } catch (e) {
    // P2 修复：catch 分支同样比对代际——失败迟到不得覆盖已切换模型
    if (litematicGuard.stale(gen)) return;
    const detailDiv = ctx.root.getElementById("preview-detail");
    if (detailDiv) {
      detailDiv.innerHTML = `<div class="dp-placeholder"><div class="big-icon">⚠️</div><div class="dp-hint">${t("preview.readFailed")}: ${esc(safeErrorMessage(e))}</div></div>`;
    }
  }
}

/** 组件销毁时清理体素 3D（转发至 litematic-3d，避免 index 静态依赖 Three.js 渲染模块） */
export function cleanupLitematic3D(): void {
  cleanupVoxel3D();
}
