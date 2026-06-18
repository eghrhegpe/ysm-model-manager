import { renderFormattedText } from "../../utils/mc-format.js";

const esc = (s) =>
  (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function fmtTime(ms) {
  if (!ms || ms <= 0) return "未知";
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function shortName(name) {
  return (name || "").replace(/^minecraft:/, "");
}

function blockColorHTML(name) {
  const map = {
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

function renderBlockList(stats) {
  if (!stats || !stats.length) return '<div style="color:var(--muted);font-size:var(--fs-sm)">无方块数据</div>';
  let total = 0;
  for (const s of stats) total += s.count;
  const rows = stats.map((s) => {
    const color = blockColorHTML(shortName(s.name));
    return `<div class="lt-block-row"><span class="lt-color-swatch" style="background:${color}"></span><span class="lt-block-name">${esc(shortName(s.name))}</span><span class="lt-block-count">${s.count} 个</span></div>`;
  }).join("");
  return `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:var(--fs-xs);color:var(--muted)"><span>共 ${stats.length} 种方块</span><span>合计 ${total.toLocaleString()} 个</span></div><div class="lt-material-list">${rows}</div>`;
}

/** 显示投影文件详情面板（tab 布局） */
export async function showLitematic(ctx, path) {
  const basename = path.split("/").pop().split("\\").pop();
  const savedTab = localStorage.getItem("lt_previewTab") || "detail";

  ctx._root.innerHTML = `<div class="content" id="preview-content">
  <div class="ysm-tab-row">
    <button class="preview-tab ysm-tab ${savedTab === "detail" ? "ysm-tab-active" : "ysm-tab-inactive"}" data-tab="detail">📋 详情</button>
    <button class="preview-tab ysm-tab ${savedTab === "material" ? "ysm-tab-active" : "ysm-tab-inactive"}" data-tab="material">🧱 材料列表</button>
    <button class="ysm-tab ysm-tab-inactive" id="btn-lt-3d-tab" title="3D 预览">🎨 3D</button>
  </div>
  <div id="preview-detail"${savedTab !== "detail" ? ' style="display:none"' : ""}>
    <div class="dp-placeholder"><div class="big-icon">⏳</div><div class="dp-hint">正在解析投影文件...</div></div>
  </div>
  <div id="preview-material"${savedTab !== "material" ? ' style="display:none"' : ""}></div>
</div>`;

  // Tab 切换
  const switchTab = (tab) => {
    localStorage.setItem("lt_previewTab", tab);
    ctx._root.querySelectorAll(".preview-tab").forEach((btn) => {
      const isActive = btn.dataset.tab === tab;
      btn.classList.toggle("ysm-tab-active", isActive);
      btn.classList.toggle("ysm-tab-inactive", !isActive);
    });
    const detail = ctx._root.getElementById("preview-detail");
    const material = ctx._root.getElementById("preview-material");
    if (detail) detail.style.display = tab === "detail" ? "" : "none";
    if (material) material.style.display = tab === "material" ? "" : "none";
  };
  ctx._root.querySelectorAll(".preview-tab").forEach((btn) => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });

  // 3D tab 按钮
  const btn3dTab = ctx._root.getElementById("btn-lt-3d-tab");
  const isNbt = /\.nbt$/i.test(path);
  const isSch = /\.schematic$/i.test(path);
  const label = isSch ? "schematic" : isNbt ? "nbt" : "litematic";

  try {
    const { ReadLitematicMeta, ReadNbtStructure, ReadSchematic } = await import("../../../wailsjs/go/main/App.js");
    let meta;
    if (isNbt) {
      meta = JSON.parse(await ReadNbtStructure(path) || "{}");
      if (!meta || (!meta.size && !meta.blockCount)) throw new Error("无法解析");
    } else if (isSch) {
      meta = JSON.parse(await ReadSchematic(path) || "{}");
      if (!meta || (!meta.size && !meta.blockCount)) throw new Error("无法解析");
    } else {
      meta = JSON.parse(await ReadLitematicMeta(path) || "{}");
      if (!meta || (!meta.name && !meta.author && meta.totalBlocks === undefined)) throw new Error("无法解析");
    }

    const sizeArr = meta.enclosingSize || meta.size;
    const sizeStr = sizeArr ? `${sizeArr[0] || 0} × ${sizeArr[1] || 0} × ${sizeArr[2] || 0}` : "未知";
    const blockStats = meta.blockStats || meta.paletteStats;

    const previewImgHTML = meta.previewImage
      ? `<img src="${meta.previewImage}" alt="preview" style="width:140px;height:140px;object-fit:contain;border-radius:6px;border:1px solid var(--bd);align-self:center;image-rendering:pixelated">`
      : "";

    function field(label, value) {
      return value ? `<div class="lt-meta-row"><span class="lt-meta-label">${label}</span><span>${esc(String(value))}</span></div>` : "";
    }

    const detailDiv = ctx._root.getElementById("preview-detail");
    if (detailDiv) {
      let extra = "";
      if (isNbt || isSch) {
        extra = `${field("数据版本", meta.dataVersion)}${field("格式版本", meta.version)}${field("名称", meta.name)}${field("作者", meta.author)}`;
      } else {
        extra = `${field("名称", meta.name)}${field("作者", meta.author)}${field("创建时间", meta.timeCreated ? fmtTime(meta.timeCreated) : "")}${field("修改时间", meta.timeModified ? fmtTime(meta.timeModified) : "")}<div class="lt-meta-row"><span class="lt-meta-label">格式版本</span><span>Litematica v${meta.version || "?"} · MC Data v${meta.minecraftDataVersion || "?"}</span></div>${field("描述", meta.description)}`;
      }
      detailDiv.innerHTML = `<h3>📋 蓝图详情</h3>
    <div style="padding:12px;display:flex;flex-direction:column;gap:6px;font-size:var(--fs-sm)">
      ${previewImgHTML}
      <div><strong>${renderFormattedText(basename)}</strong></div>
      ${extra}
      <div style="margin:4px 0;border-top:1px solid var(--bd)"></div>
      <div class="lt-meta-row"><span class="lt-meta-label">非空气方块</span><span>${(meta.totalBlocks || meta.blockCount || 0).toLocaleString()} 个</span></div>
      <div class="lt-meta-row"><span class="lt-meta-label">总体积</span><span>${(meta.totalVolume || 0).toLocaleString()} 方块</span></div>
      <div class="lt-meta-row"><span class="lt-meta-label">包围盒</span><span>${sizeStr}</span></div>
      ${!isNbt && !isSch ? `<div class="lt-meta-row"><span class="lt-meta-label">区域数</span><span>${meta.regionCount || 0}</span></div>` : ""}
      ${meta.entityCount !== undefined ? `<div class="lt-meta-row"><span class="lt-meta-label">实体数量</span><span>${meta.entityCount}</span></div>` : ""}
      ${meta.tileEntityCount !== undefined ? `<div class="lt-meta-row"><span class="lt-meta-label">方块实体</span><span>${meta.tileEntityCount}</span></div>` : ""}
    </div>`;
    }

    const materialDiv = ctx._root.getElementById("preview-material");
    if (materialDiv) {
      materialDiv.innerHTML = `<h3>🧱 材料列表</h3>
	    <div style="padding:12px;font-size:var(--fs-sm)">
	      ${renderBlockList(blockStats)}
	    </div>`;
    }

    if (btn3dTab) {
      const voxelFn = isNbt ? "GetNbtVoxelData" : isSch ? "GetSchematicVoxelData" : "GetLitematicVoxelData";
      btn3dTab.onclick = async () => {
        btn3dTab.textContent = "⏳";
        btn3dTab.disabled = true;
        try {
          const { createLitematic3D } = await import("./preview-litematic-3d.js");
          await createLitematic3D(path, voxelFn);
        } finally {
          btn3dTab.textContent = "🎨 3D";
          btn3dTab.disabled = false;
        }
      };
    }
  } catch (e) {
    const detailDiv = ctx._root.getElementById("preview-detail");
    if (detailDiv) {
      detailDiv.innerHTML = `<div class="dp-placeholder"><div class="big-icon">⚠️</div><div class="dp-hint">读取失败: ${esc(e.message)}</div></div>`;
    }
  }
}
