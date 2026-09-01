// ===== 3D 入口详情（ADR-072 D3：detail.ts 按资源域拆分）=====
// showVrmMeta / showMmdPreview 是「3D 入口卡」（meta 信息 + FAB 进 3D），与 2D 详情
// （showModelDetail/showResourcePack/showShaderpack）分离；共享代际 detailGen 从
// detail.ts 导出复用，保证跨文件快速切换时在途请求互相作废。

import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import { getApp } from "../../backend/app.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { renderFormattedText } from "../../utils/format/mc-format.ts";
import { esc } from "../../utils/dom/html.ts";
import { promoteTitleIfPresent } from "../../utils/dom/tooltip.ts";
import { safeErrorMessage } from "../../utils/safe-error-msg.ts";
import { readVrmMeta } from "../../preview-3d/adapters/vrm-adapter.ts";
import { readPmxStats } from "../../preview-3d/adapters/mmd-detail-stats.ts";
import { createVrm3D } from "./vrm-3d.ts";
import { createMmd3D } from "./mmd-3d.ts";
import { createFbx3D } from "./fbx-3d.ts";
import { resolveFbxSiblings } from "./fbx-siblings.ts";
import { createScene3D } from "./scene-3d.ts";
import { resolveMmdSiblings } from "./mmd-siblings.ts";
import { resolveSceneSiblings, resolveMorphSiblings } from "./siblings.ts";
import { resolveStageSiblings } from "./stage-siblings.ts";
import { detailGen } from "./detail.ts";
import { t } from "../../core/i18n/t.ts";
import { bus } from "../../bus.ts";
import type { PreviewCtx } from "./utils.ts";

/** 显示 VRM meta 卡（名称/作者/许可/版本/缩略图 + FAB 进 3D，对齐 YSM 模式） */
export async function showVrmMeta(
  ctx: PreviewCtx,
  path: string,
  opts?: { icon?: string; label?: string },
): Promise<void> {
  const gen = detailGen.next();
  const icon = (opts && opts.icon) || "🥽";
  const label = (opts && opts.label) || t("preview.vrcAvatar");
  const basename = path.split(/[/\\]/).pop() || "";
  ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>${icon} ${label}</h3>
  <div class="dp-placeholder"><div class="big-icon">⏳</div><div class="dp-hint">${t("preview.parsing")}...</div></div>
</div>`;
  try {
    const App = await getApp();
    const meta = await readVrmMeta(path, App.ReadFileBytes);
    if (detailGen.stale(gen)) return; // 过期守卫：await 期间用户已切走
    if (!meta || (!meta.name && !meta.authors?.length)) {
      // 无 meta（非标准 VRM 或解析失败）→ 仅名称 + FAB
      ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>${icon} ${label}</h3>
  <div style="padding:12px;display:flex;flex-direction:column;gap:8px;font-size:var(--fs-sm)">
    <div><strong>${renderFormattedText(basename)}</strong></div>
    <button class="preview-fab" id="btn-vrm-3d" title="${t("preview.title3d")}" aria-label="${t("preview.title3d")}"><span class="preview-ic">🎨</span></button>
  </div>
</div>`;
    } else {
      const authors = meta.authors.filter(Boolean).join("、");
      const thumb = meta.thumbnail
        ? `<img src="${esc(meta.thumbnail)}" alt="thumbnail" style="width:128px;height:128px;object-fit:contain;border-radius:6px;border:1px solid var(--bd);align-self:center;image-rendering:pixelated">`
        : "";
      // VRM0 授权约束徽章
      const r = meta.restrictions;
      const badge = (label: string, ok: boolean | undefined, icon: string): string => {
        const v = ok === undefined ? "—" : ok ? "✅" : "❌";
        return `<span style="display:inline-flex;align-items:center;gap:2px;padding:1px 6px;border-radius:4px;background:rgba(255,255,255,0.06);font-size:11px;margin-right:4px"><span>${icon}</span>${label}:${v}</span>`;
      };
      const refBadge = r?.reference
        ? `<div style="color:var(--muted);font-size:var(--fs-xs);margin-top:4px">📎 ${t("preview.reference")}: ${esc(r.reference)}</div>`
        : "";
      // ADR-131 P2：readVrmMeta 顺带采集的渲染期统计（traverse 口径；标注「渲染实测」
      // 与 YSM 模型面板的 Go AnalyzeBedrockModel 口径区分，避免双口径困惑——审核建议 ②）
      const s = meta.stats;
      const statsRow = s && (s.meshCount > 0 || s.boneCount > 0)
        ? `<div style="display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:6px;padding:6px 8px;border-radius:6px;background:rgba(124,131,255,0.08);font-size:var(--fs-xs);color:var(--muted)">
            <span style="color:#7c83ff">📊 ${t("preview.stats.panel")}</span>
            <span>🦴 ${t("preview.stats.bones")}: <b>${s.boneCount}</b></span>
            <span>🧩 ${t("preview.stats.meshes")}: <b>${s.meshCount}</b></span>
            <span>🔺 ${t("preview.stats.triangles")}: <b>${s.triangleCount.toLocaleString()}</b></span>
            <span>🎨 ${t("preview.stats.materials")}: <b>${s.materialCount}</b></span>
            <span>🖼️ ${t("preview.stats.textures")}: <b>${s.textureCount}</b></span>
            <span>😊 ${t("preview.stats.morphs")}: <b>${s.morphCount}</b></span>
          </div>`
        : "";
      ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>${icon} ${label}</h3>
  <div style="padding:12px;display:flex;flex-direction:column;gap:8px;font-size:var(--fs-sm)">
    ${thumb}
    <div><strong>${renderFormattedText(meta.name || basename)}</strong></div>
    ${authors ? `<div style="color:var(--muted)">👤 ${esc(authors)}</div>` : ""}
    ${meta.version ? `<div style="color:var(--muted);font-size:var(--fs-xs)">版本: ${esc(meta.version)}</div>` : ""}
    ${meta.contact ? `<div style="color:var(--muted);font-size:var(--fs-xs)">📮 ${esc(meta.contact)}</div>` : ""}
    ${meta.license ? `<div style="color:var(--muted);font-size:var(--fs-xs)">📜 ${esc(meta.license)}</div>` : ""}
    ${refBadge}
    ${r ? `<div style="display:flex;flex-wrap:wrap;align-items:center;margin-top:2px">${badge("商用", r.commercial, "💰")}${badge("用户", r.allowedUser === "everyone", "👥")}${badge("性", r.sexual, "🔞")}${badge("暴力", r.violent, "⚔️")}</div>` : ""}
    ${statsRow}
    <button class="preview-fab" id="btn-vrm-3d" title="${t("preview.title3d")}" aria-label="${t("preview.title3d")}"><span class="preview-ic">🎨</span></button>
  </div>
</div>`;
    }
    const fab = ctx.root.querySelector<HTMLElement>("#btn-vrm-3d");
    if (fab) {
      promoteTitleIfPresent(fab);
      fab.onclick = (): void => {
        void createVrm3D(path);
      };
    }
  } catch (e) {
    if (detailGen.stale(gen)) return;
    ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>${icon} ${label}</h3>
  <div class="dp-placeholder"><div class="big-icon">⚠️</div><div class="dp-hint">${t("preview.readFailed")}: ${esc(safeErrorMessage(e))}</div></div>
</div>`;
  }
}

/** 显示 MMD 预览卡（文件名 + FAB 进 3D；PMX/PMD 无标准 meta 读取，保持简单形态） */
export async function showMmdPreview(
  ctx: PreviewCtx,
  path: string,
  opts?: { icon?: string; label?: string },
): Promise<void> {
  detailGen.invalidate(); // 无 await 也要作废在途的慢请求回写
  const gen = detailGen.next();
  const icon = (opts && opts.icon) || "🎭";
  const label = (opts && opts.label) || t("preview.mmdSkin");
  const basename = path.split(/[/\\]/).pop() || "";
  ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>${icon} ${label}</h3>
  <div style="padding:12px;display:flex;flex-direction:column;gap:8px;font-size:var(--fs-sm)">
    <div><strong>${renderFormattedText(basename || "")}</strong></div>
    <div id="mmd-stats-row"></div>
    <button class="preview-fab" id="btn-mmd-3d" title="${t("preview.title3d")}" aria-label="${t("preview.title3d")}"><span class="preview-ic">🎨</span></button>
  </div>
</div>`;
  const fab = ctx.root.querySelector<HTMLElement>("#btn-mmd-3d");
  if (fab) {
    promoteTitleIfPresent(fab);
    fab.onclick = (): void => {
      // 3D 内换模型（ADR-066 §5.6）：先取同类型候选列表，随 siblings 传入渲染 topBar 切换下拉
      void (async () => {
        const siblings = await resolveMmdSiblings();
        await createMmd3D(path, { siblings });
      })();
    };
  }
  // ADR-131 P2：异步补 PMX 文件统计（仅 .pmx；不阻塞基础卡渲染，gen 守卫过期丢弃）
  if (/\.pmx$/i.test(path)) {
    void (async () => {
      try {
        const App = await getApp();
        const stats = await readPmxStats(path, App.ReadFileBytes);
        if (detailGen.stale(gen) || !stats) return;
        const host = ctx.root.querySelector<HTMLElement>("#mmd-stats-row");
        if (!host) return;
        // 口径标注（审核建议 ②）：PMX 文件解析 vs 3D 渲染实测 vs YSM Go 口径三方区分
        host.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:6px;padding:6px 8px;border-radius:6px;background:rgba(124,131,255,0.08);font-size:var(--fs-xs);color:var(--muted)">
          <span style="color:#7c83ff">📊 ${t("preview.stats.file")}</span>
          <span>🔺 ${t("preview.stats.vertices")}: <b>${stats.vertices.toLocaleString()}</b></span>
          <span>◻️ ${t("preview.stats.faces")}: <b>${stats.faces.toLocaleString()}</b></span>
          <span>🦴 ${t("preview.stats.bones")}: <b>${stats.bones}</b></span>
          <span>🎨 ${t("preview.stats.materials")}: <b>${stats.materials}</b></span>
          <span>😊 ${t("preview.stats.morphs")}: <b>${stats.morphs}</b></span>
        </div>`;
      } catch { /* 统计读取失败静默：基础卡不受影响（详情卡降级约定） */ }
    })();
  }
}

/** 显示 FBX 预览卡（文件名 + FAB 进 3D；FBX 无标准 meta 读取，保持简单形态，ADR-112） */
export async function showFbxPreview(
  ctx: PreviewCtx,
  path: string,
  opts?: { icon?: string; label?: string },
): Promise<void> {
  detailGen.invalidate(); // 无 await 也要作废在途的慢请求回写
  const icon = (opts && opts.icon) || "🦴";
  const label = (opts && opts.label) || "FBX 模型/动画";
  const basename = path.split(/[/\\]/).pop() || "";
  ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>${icon} ${label}</h3>
  <div style="padding:12px;display:flex;flex-direction:column;gap:8px;font-size:var(--fs-sm)">
    <div><strong>${renderFormattedText(basename || "")}</strong></div>
    <button class="preview-fab" id="btn-fbx-3d" title="${t("preview.title3d")}" aria-label="${t("preview.title3d")}"><span class="preview-ic">🎨</span></button>
  </div>
</div>`;
  const fab = ctx.root.querySelector<HTMLElement>("#btn-fbx-3d");
  if (fab) {
    promoteTitleIfPresent(fab);
    fab.onclick = (): void => {
      // 3D 内换模型（ADR-066 §5.6）：先取同类型 FBX 候选列表，随 siblings 传入渲染 topBar 切换下拉
      void (async () => {
        const siblings = await resolveFbxSiblings();
        await createFbx3D(path, { siblings });
      })();
    };
  }
}

/** 显示场景 MMD 预览卡（独立入口，与角色模型完全隔离） */
export async function showScenePreview(
  ctx: PreviewCtx,
  path: string,
): Promise<void> {
  detailGen.invalidate();
  const basename = path.split(/[/\\]/).pop() || "";
  ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>🏗️ ${t("preview.sceneModel")}</h3>
  <div style="padding:12px;display:flex;flex-direction:column;gap:8px;font-size:var(--fs-sm)">
    <div><strong>${renderFormattedText(basename || "")}</strong></div>
    <div style="font-size:11px;color:var(--muted);display:flex;gap:4px;align-items:center">
      <span style="background:rgba(124,131,255,0.2);color:#7c83ff;padding:1px 6px;border-radius:4px;font-weight:500">SceneModel</span>
      <span>${t("preview.sceneModelLabel")}</span>
    </div>
    <button class="preview-fab" id="btn-scene-3d" title="${t("preview.title3d")}" aria-label="${t("preview.title3d")}" style="background:linear-gradient(135deg,#7c83ff 0%,#4a55d6 100%)"><span class="preview-ic">🏗️</span></button>
  </div>
</div>`;
  const fab = ctx.root.querySelector<HTMLElement>("#btn-scene-3d");
  if (fab) {
    promoteTitleIfPresent(fab);
    fab.onclick = (): void => {
      void (async () => {
        const siblings = await resolveSceneSiblings();
        await createScene3D(path, { siblings });
      })();
    };
  }
}

/** 显示 CustomMorph 预览卡（VPD 表情姿势 + 兄弟列表 + 应用 FAB） */
export async function showMorphPreview(
  ctx: PreviewCtx,
  path: string,
): Promise<void> {
  detailGen.invalidate();
  const basename = path.split(/[/\\]/).pop() || "";
  ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>😊 ${t("preview.customMorph")}</h3>
  <div style="padding:12px;display:flex;flex-direction:column;gap:8px;font-size:var(--fs-sm)">
    <div><strong>${renderFormattedText(basename || "")}</strong></div>
    <div style="font-size:11px;color:var(--muted);display:flex;gap:4px;align-items:center;flex-wrap:wrap">
      <span style="background:rgba(100,100,100,0.2);color:#aaa;padding:1px 6px;border-radius:4px;font-weight:500">CustomMorph</span>
      <span>${t("preview.vpdPose")}</span>
      <span style="background:rgba(100,100,100,0.2);color:#aaa;padding:1px 6px;border-radius:4px">${t("preview.singleFrameMorph")}</span>
    </div>
    <div id="morph-siblings" style="max-height:160px;overflow-y:auto;border:1px solid var(--bd);border-radius:6px;padding:6px;margin-top:4px"></div>
    <button class="preview-fab" id="btn-morph-apply" title="${t("preview.applyMorph")}" aria-label="${t("preview.applyMorph")}" style="background:linear-gradient(135deg,#50c878 0%,#2ea043 100%)"><span class="preview-ic">😊</span></button>
  </div>
</div>`;
  // 加载兄弟列表
  try {
    const siblings = await resolveMorphSiblings();
    const container = ctx.root.querySelector<HTMLElement>("#morph-siblings");
    if (container && siblings.length > 0) {
      const items = siblings.map((p) => {
        const name = p.split(/[/\\]/).pop() || p;
        const active = p === path;
        // 高亮/hover 走注入的 .morph-item 样式（内联 style 表达不了 :hover；
        // 旧写法「;font-weight:600}hover:background:...」缺分号 + hover: 前缀非法，
        // 连 font-weight 一起被并成一条声明整体丢弃）
        return `<div class="morph-item${active ? " active" : ""}" data-path="${esc(p)}">
          <span style="font-size:10px;color:var(--muted)">◉</span>
          <span>${esc(name)}</span>
        </div>`;
      }).join("");
      container.innerHTML = `<style>
  .morph-item{padding:4px 6px;cursor:pointer;border-radius:4px;font-size:12px;display:flex;align-items:center;gap:6px}
  .morph-item:hover{background:rgba(255,255,255,0.05)}
  .morph-item.active{background:rgba(80,200,120,0.15);color:#50c878;font-weight:600}
</style><div style="color:var(--muted);font-size:11px;margin-bottom:4px">${t("preview.allMorphCount", { n: siblings.length })}</div>${items}`;
      // 点击兄弟列表项切换
      container.querySelectorAll<HTMLElement>(".morph-item").forEach((el) => {
        el.onclick = () => {
          const p = el.dataset.path || "";
          bus.emit("model:select", { path: p, isDir: false, rtype: RESOURCE_TYPES.CUSTOM_MORPH });
        };
      });
    } else if (container) {
      container.innerHTML = `<div style="color:var(--muted);font-size:11px;padding:4px">${t("preview.noOtherMorph")}</div>`;
    }
  } catch { /* 兄弟列表加载失败不阻断 */ }
  // 应用 FAB
  const fab = ctx.root.querySelector<HTMLElement>("#btn-morph-apply");
  if (fab) {
    promoteTitleIfPresent(fab);
    fab.onclick = (): void => {
      // P2: morph:apply 零订阅，删发射；保留 toast 反馈
      bus.emit("toast:show", {
        msg: `😊 已发送应用请求：${basename}`,
        duration: TOAST_MS.success,
        type: "info",
      });
    };
  }
}

/** 显示 StageAnim 预览卡（舞台包：VMD + 音频 + 配置） */
export async function showStagePreview(
  ctx: PreviewCtx,
  path: string,
): Promise<void> {
  detailGen.invalidate();
  const basename = path.split(/[/\\]/).pop() || "";
  ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>🎤 ${t("preview.stageAnim")}</h3>
  <div style="padding:12px;display:flex;flex-direction:column;gap:8px;font-size:var(--fs-sm)">
    <div><strong>${renderFormattedText(basename || "")}</strong></div>
    <div style="font-size:11px;color:var(--muted);display:flex;gap:4px;align-items:center;flex-wrap:wrap">
      <span style="background:rgba(255,160,80,0.2);color:#ffa050;padding:1px 6px;border-radius:4px;font-weight:500">StageAnim</span>
      <span>${t("preview.stagePerformanceLabel")}</span>
    </div>
    <div id="stage-contents" style="max-height:200px;overflow-y:auto;border:1px solid var(--bd);border-radius:6px;padding:6px;margin-top:4px"></div>
    <button class="preview-fab" id="btn-stage-load" title="${t("preview.loadStage")}" aria-label="${t("preview.loadStage")}" style="background:linear-gradient(135deg,#ffa050 0%,#e67e22 100%)"><span class="preview-ic">🎤</span></button>
  </div>
</div>`;
  // 加载舞台内容
  try {
    const contents = await resolveStageSiblings();
    const container = ctx.root.querySelector<HTMLElement>("#stage-contents");
    if (container) {
      if (contents.length === 0) {
        container.innerHTML = `<div style="color:var(--muted);font-size:11px;padding:4px">${t("preview.stageEmpty")}</div>`;
      } else {
        const vmdCount = contents.filter((c) => c.kind === "vmd").length;
        const audioCount = contents.filter((c) => c.kind === "audio").length;
        const configCount = contents.filter((c) => c.kind === "config").length;
        container.innerHTML = `<div style="color:var(--muted);font-size:11px;margin-bottom:6px">📊 ${t("preview.stageContents", { vmd: vmdCount, audio: audioCount, config: configCount })}</div>` +
          contents.map((c) => {
            const name = c.path.split(/[/\\]/).pop() || c.path;
            const icon = c.kind === "vmd" ? "🎬" : c.kind === "audio" ? "🎵" : c.kind === "config" ? "⚙️" : "📄";
            const color = c.kind === "vmd" ? "#ffa050" : c.kind === "audio" ? "#80c0ff" : "#c0c0c0";
            return `<div class="stage-item" data-path="${esc(c.path)}" style="padding:3px 6px;cursor:pointer;border-radius:4px;font-size:12px;display:flex;align-items:center;gap:6px;border-left:3px solid ${color}">
              <span>${icon}</span>
              <span>${esc(name)}</span>
              <span style="color:var(--muted);font-size:10px;margin-left:auto">${c.kind}</span>
            </div>`;
          }).join("");
        // 点击舞台项切换
        container.querySelectorAll<HTMLElement>(".stage-item").forEach((el) => {
          el.onclick = () => {
            const p = el.dataset.path || "";
            bus.emit("model:select", { path: p, isDir: false, rtype: RESOURCE_TYPES.STAGE });
          };
        });
      }
    }
  } catch { /* 舞台内容加载失败不阻断 */ }
  // 加载舞台 FAB
  const fab = ctx.root.querySelector<HTMLElement>("#btn-stage-load");
  if (fab) {
    promoteTitleIfPresent(fab);
    fab.onclick = (): void => {
      // P2: stage:load 零订阅，删发射；保留 toast 反馈
      bus.emit("toast:show", {
        msg: `🎤 已发送舞台加载请求：${basename}`,
        duration: TOAST_MS.success,
        type: "info",
      });
    };
  }
}
