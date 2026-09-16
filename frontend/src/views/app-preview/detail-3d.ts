// ===== 3D 入口详情（ADR-072 D3：detail.ts 按资源域拆分）=====
// showVrmMeta / showMmdPreview 是「3D 入口卡」（meta 信息 + FAB 进 3D），与 2D 详情
// （showModelDetail/showResourcePack/showShaderpack）分离；共享代际 detailGen 从
// detail.ts 导出复用，保证跨文件快速切换时在途请求互相作废。

import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { readPmxStats } from "@/preview-3d/adapters/mmd/mmd-detail-stats.ts";
import { readVrmMeta } from "@/preview-3d/adapters/vrm/vrm-adapter.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { promoteTitleIfPresent } from "@/utils/dom/tooltip.ts";
import { esc } from "@/utils/html/html.ts";
import { renderFormattedText } from "@/utils/html/mc-format.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import { showCard } from "./card-shell.ts";
import { openModel3DFullscreen } from "./preview-library.ts";
import { resolveMorphSiblings, resolveStageSiblings } from "./siblings.ts";
import type { DetailGenGuard, PreviewCtx } from "./utils.ts";

// ===== 六个 show 函数（统一为 CardShowConfig + showCard，壳见 ./card-shell.ts）=====

/** 显示 VRM meta 卡（名称/作者/许可/版本/缩略图 + FAB 进 3D，对齐 YSM 模式） */
export async function showVrmMeta(
  ctx: PreviewCtx & DetailGenGuard,
  path: string,
  opts?: { icon?: string; label?: string },
): Promise<void> {
  const icon = opts?.icon || "🥽";
  const label = opts?.label || t("preview.vrcAvatar");
  return showCard(ctx, path, {
    icon,
    label,
    fetchMeta: async (_ctx, path, App) => readVrmMeta(path, App.ReadFileBytes),
    renderCard: (_ctx, path, meta: unknown) => {
      const basename = path.split(/[/\\]/).pop() || "";
      const m = meta as Record<string, unknown> | null;
      if (!m || (!m.name && !(m.authors as string[])?.length)) {
        // 无 meta（非标准 VRM 或解析失败）→ 仅名称 + FAB
        return `<div class="content" id="preview-content">
  <h3>${icon} ${label}</h3>
  <div style="padding:12px;display:flex;flex-direction:column;gap:8px;font-size:var(--fs-sm)">
    <div><strong>${renderFormattedText(basename)}</strong></div>
    <button class="preview-fab" id="btn-vrm-3d" data-fab title="${t("preview.title3d")}" aria-label="${t("preview.title3d")}"><span class="preview-ic">${UI_ICONS.appearance}</span></button>
  </div>
</div>`;
      }
      const authors = (m.authors as string[] | undefined)?.filter(Boolean).join("、") ?? "";
      const thumb = (m.thumbnail as string | undefined)
        ? `<img src="${esc(m.thumbnail as string)}" alt="thumbnail" style="width:128px;height:128px;object-fit:contain;border-radius:var(--radius-md);border:1px solid var(--bd);align-self:center;image-rendering:pixelated">`
        : "";
      // VRM0 授权约束徽章
      const r = m.restrictions as Record<string, unknown> | undefined;
      const badge = (label: string, ok: boolean | undefined, icon: string): string => {
        const v = ok === undefined ? "—" : ok ? "✅" : "❌";
        return `<span style="display:inline-flex;align-items:center;gap:2px;padding:1px 6px;border-radius:var(--radius-sm);background:rgba(255,255,255,0.06);font-size:var(--fs-sm);margin-right:4px"><span>${icon}</span>${label}:${v}</span>`;
      };
      const refBadge = r?.reference
        ? `<div style="color:var(--muted);font-size:var(--fs-xs);margin-top:4px">${UI_ICONS.attach} ${t("preview.reference")}: ${esc(r.reference as string)}</div>`
        : "";
      // ADR-131 P2：readVrmMeta 顺带采集的渲染期统计（traverse 口径；标注「渲染实测」
      // 与 YSM 模型面板的 Go AnalyzeBedrockModel 口径区分，避免双口径困惑——审核建议 ②）
      const s = m.stats as Record<string, number> | undefined;
      const statsRow =
        s && (s.meshCount > 0 || s.boneCount > 0)
          ? `<div style="display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:6px;padding:6px 8px;border-radius:var(--radius-md);background:color-mix(in srgb,var(--accent) 8%,transparent);font-size:var(--fs-xs);color:var(--muted)">
            <span style="color:var(--accent)">${UI_ICONS.chart} ${t("preview.stats.panel")}</span>
            <span>${UI_ICONS.bone} ${t("preview.stats.bones")}: <b>${s.boneCount}</b></span>
            <span>${UI_ICONS.parser} ${t("preview.stats.meshes")}: <b>${s.meshCount}</b></span>
            <span>${UI_ICONS.collision} ${t("preview.stats.triangles")}: <b>${s.triangleCount.toLocaleString()}</b></span>
            <span>${UI_ICONS.appearance} ${t("preview.stats.materials")}: <b>${s.materialCount}</b></span>
            <span>${UI_ICONS.image} ${t("preview.stats.textures")}: <b>${s.textureCount}</b></span>
            <span>${UI_ICONS.avatar} ${t("preview.stats.morphs")}: <b>${s.morphCount}</b></span>
          </div>`
          : "";
      return `<div class="content" id="preview-content">
  <h3>${icon} ${label}</h3>
  <div style="padding:12px;display:flex;flex-direction:column;gap:8px;font-size:var(--fs-sm)">
    ${thumb}
    <div><strong>${renderFormattedText((m.name as string) || basename)}</strong></div>
    ${authors ? `<div style="color:var(--muted)">${UI_ICONS.author} ${esc(authors)}</div>` : ""}
    ${(m.version as string) ? `<div style="color:var(--muted);font-size:var(--fs-xs)">${t("preview.versionLabel")}: ${esc(m.version as string)}</div>` : ""}
    ${(m.contact as string) ? `<div style="color:var(--muted);font-size:var(--fs-xs)">${UI_ICONS.comment} ${esc(m.contact as string)}</div>` : ""}
    ${(m.license as string) ? `<div style="color:var(--muted);font-size:var(--fs-xs)">${UI_ICONS.script} ${esc(m.license as string)}</div>` : ""}
    ${refBadge}
    ${r ? `<div style="display:flex;flex-wrap:wrap;align-items:center;margin-top:2px">${badge(t("preview.vrmCommercial"), r.commercial as boolean, UI_ICONS.payment)}${badge(t("preview.allowedUser"), r.allowedUser === "everyone", UI_ICONS.users)}${badge(t("preview.sexual"), r.sexual as boolean, UI_ICONS.violent)}${badge(t("preview.violent"), r.violent as boolean, UI_ICONS.violent)}</div>` : ""}
    ${statsRow}
    <button class="preview-fab" id="btn-vrm-3d" data-fab title="${t("preview.title3d")}" aria-label="${t("preview.title3d")}"><span class="preview-ic">${UI_ICONS.appearance}</span></button>
  </div>
</div>`;
    },
    wireFab: (ctx, _path, fab) => {
      if (!fab) return;
      const cleanup = promoteTitleIfPresent(fab);
      if (cleanup && ctx.unsubs) ctx.unsubs.push(cleanup);
      fab.onclick = (): void => {
        // ADR-253 D2：与其他格式卡统一走路由入口，siblings 由路由按 rtype 自算兜底
        void openModel3DFullscreen(path);
      };
    },
  });
}

/** 显示 MMD 预览卡（文件名 + FAB 进 3D；PMX/PMD 无标准 meta 读取，保持简单形态） */
export async function showMmdPreview(
  ctx: PreviewCtx & DetailGenGuard,
  path: string,
  opts?: { icon?: string; label?: string },
): Promise<void> {
  const icon = opts?.icon || "🎭";
  const label = opts?.label || t("preview.mmdSkin");
  return showCard(ctx, path, {
    icon,
    label,
    renderCard: (_ctx, path) => {
      const basename = path.split(/[/\\]/).pop() || "";
      return `<div class="content" id="preview-content">
  <h3>${icon} ${label}</h3>
  <div style="padding:12px;display:flex;flex-direction:column;gap:8px;font-size:var(--fs-sm)">
    <div><strong>${renderFormattedText(basename)}</strong></div>
    <div id="mmd-stats-row"></div>
    <button class="preview-fab" id="btn-mmd-3d" data-fab title="${t("preview.title3d")}" aria-label="${t("preview.title3d")}"><span class="preview-ic">${UI_ICONS.appearance}</span></button>
  </div>
</div>`;
    },
    wireFab: (ctx, _path, fab) => {
      if (!fab) return;
      const cleanup = promoteTitleIfPresent(fab);
      if (cleanup && ctx.unsubs) ctx.unsubs.push(cleanup);
      fab.onclick = (): void => {
        // 3D 内换模型（ADR-066 §5.6 + ADR-253 D2）：siblings 由 3D 入口按 rtype 自算兜底，
        // 此处不再手算——与导航栏 FAB 走同一条路径，消除「谁点的按钮决定下拉有无」。
        void openModel3DFullscreen(path);
      };
    },
    // ADR-131 P2：异步补 PMX 文件统计（仅 .pmx；不阻塞基础卡渲染，gen 守卫过期丢弃）
    postRender: (ctx, path, gen) => {
      if (/\.pmx$/i.test(path)) {
        void (async () => {
          try {
            const App = await backendGetApp();
            const stats = await readPmxStats(path, App.ReadFileBytes);
            if (ctx.detailGen.stale(gen) || !stats) return;
            const host = ctx.root.querySelector<HTMLElement>("#mmd-stats-row");
            if (!host) return;
            // 口径标注（审核建议 ②）：PMX 文件解析 vs 3D 渲染实测 vs YSM Go 口径三方区分
            host.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:6px;padding:6px 8px;border-radius:var(--radius-md);background:color-mix(in srgb,var(--accent) 8%,transparent);font-size:var(--fs-xs);color:var(--muted)">
              <span style="color:var(--accent)">${UI_ICONS.chart} ${t("preview.stats.file")}</span>
              <span>${UI_ICONS.collision} ${t("preview.stats.vertices")}: <b>${stats.vertices.toLocaleString()}</b></span>
              <span>◻️ ${t("preview.stats.faces")}: <b>${stats.faces.toLocaleString()}</b></span>
              <span>${UI_ICONS.bone} ${t("preview.stats.bones")}: <b>${stats.bones}</b></span>
              <span>${UI_ICONS.appearance} ${t("preview.stats.materials")}: <b>${stats.materials}</b></span>
              <span>${UI_ICONS.avatar} ${t("preview.stats.morphs")}: <b>${stats.morphs}</b></span>
            </div>`;
          } catch {
            /* 统计读取失败静默：基础卡不受影响（详情卡降级约定） */
          }
        })();
      }
    },
  });
}

/** 显示 FBX 预览卡（文件名 + FAB 进 3D；FBX 无标准 meta 读取，保持简单形态，ADR-112） */
export async function showFbxPreview(
  ctx: PreviewCtx & DetailGenGuard,
  path: string,
  opts?: { icon?: string; label?: string },
): Promise<void> {
  const icon = opts?.icon || "🦴";
  const label = opts?.label || t("preview.fbxModel");
  return showCard(ctx, path, {
    icon,
    label,
    renderCard: (_ctx, path) => {
      const basename = path.split(/[/\\]/).pop() || "";
      return `<div class="content" id="preview-content">
  <h3>${icon} ${label}</h3>
  <div style="padding:12px;display:flex;flex-direction:column;gap:8px;font-size:var(--fs-sm)">
    <div><strong>${renderFormattedText(basename)}</strong></div>
    <button class="preview-fab" id="btn-fbx-3d" data-fab title="${t("preview.title3d")}" aria-label="${t("preview.title3d")}"><span class="preview-ic">${UI_ICONS.appearance}</span></button>
  </div>
</div>`;
    },
    wireFab: (ctx, _path, fab) => {
      if (!fab) return;
      const cleanup = promoteTitleIfPresent(fab);
      if (cleanup && ctx.unsubs) ctx.unsubs.push(cleanup);
      fab.onclick = (): void => {
        // ADR-253 D2：siblings 由 3D 入口按 rtype 自算兜底（原手算 resolveFbxSiblings 已删）。
        void openModel3DFullscreen(path);
      };
    },
  });
}

/** 显示场景 MMD 预览卡（独立入口，与角色模型完全隔离） */
export async function showScenePreview(
  ctx: PreviewCtx & DetailGenGuard,
  path: string,
): Promise<void> {
  return showCard(ctx, path, {
    icon: "build",
    label: t("preview.sceneModel"),
    renderCard: (_ctx, path) => {
      const basename = path.split(/[/\\]/).pop() || "";
      return `<div class="content" id="preview-content">
  <h3>${UI_ICONS.build} ${t("preview.sceneModel")}</h3>
  <div style="padding:12px;display:flex;flex-direction:column;gap:8px;font-size:var(--fs-sm)">
    <div><strong>${renderFormattedText(basename)}</strong></div>
    <div style="font-size:var(--fs-sm);color:var(--muted);display:flex;gap:4px;align-items:center">
      <span style="background:color-mix(in srgb,var(--accent) 20%,transparent);color:var(--accent);padding:1px 6px;border-radius:var(--radius-sm);font-weight:500">${esc(RESOURCE_TYPES.SCENE)}</span>
      <span>${t("preview.sceneModelLabel")}</span>
    </div>
    <button class="preview-fab" id="btn-scene-3d" data-fab title="${t("preview.title3d")}" aria-label="${t("preview.title3d")}" style="background:linear-gradient(135deg,var(--accent) 0%,color-mix(in srgb,var(--accent) 65%,#000) 100%)"><span class="preview-ic">${UI_ICONS.build}</span></button>
  </div>
</div>`;
    },
    wireFab: (ctx, _path, fab) => {
      if (!fab) return;
      const cleanup = promoteTitleIfPresent(fab);
      if (cleanup && ctx.unsubs) ctx.unsubs.push(cleanup);
      fab.onclick = (): void => {
        // ADR-253 D2：siblings 由 3D 入口按 rtype 自算兜底（原手算 resolveSceneSiblings 已删）。
        void openModel3DFullscreen(path);
      };
    },
  });
}

/** 显示 CustomMorph 预览卡（VPD 表情姿势 + 兄弟列表 + 应用 FAB） */
export async function showMorphPreview(
  ctx: PreviewCtx & DetailGenGuard,
  path: string,
): Promise<void> {
  const basename = path.split(/[/\\]/).pop() || "";
  return showCard(ctx, path, {
    icon: "avatar",
    label: t("preview.customMorph"),
    renderCard: (_ctx, path) => {
      const basename = path.split(/[/\\]/).pop() || "";
      return `<div class="content" id="preview-content">
  <h3>${UI_ICONS.avatar} ${t("preview.customMorph")}</h3>
  <div style="padding:12px;display:flex;flex-direction:column;gap:8px;font-size:var(--fs-sm)">
    <div><strong>${renderFormattedText(basename)}</strong></div>
    <div style="font-size:var(--fs-sm);color:var(--muted);display:flex;gap:4px;align-items:center;flex-wrap:wrap">
      <span style="background:color-mix(in srgb,var(--muted) 18%,transparent);color:var(--muted);padding:1px 6px;border-radius:var(--radius-sm);font-weight:500">${esc(RESOURCE_TYPES.CUSTOM_MORPH)}</span>
      <span>${t("preview.vpdPose")}</span>
      <span style="background:color-mix(in srgb,var(--muted) 18%,transparent);color:var(--muted);padding:1px 6px;border-radius:var(--radius-sm)">${t("preview.singleFrameMorph")}</span>
    </div>
    <div id="morph-siblings" style="max-height:160px;overflow-y:auto;border:1px solid var(--bd);border-radius:var(--radius-md);padding:6px;margin-top:4px"></div>
    <button class="preview-fab" id="btn-morph-apply" data-fab title="${t("preview.applyMorph")}" aria-label="${t("preview.applyMorph")}" style="background:linear-gradient(135deg,var(--status-success) 0%,color-mix(in srgb,var(--status-success) 65%,#000) 100%)"><span class="preview-ic">${UI_ICONS.avatar}</span></button>
  </div>
</div>`;
    },
    wireFab: (ctx, _path, fab) => {
      if (!fab) return;
      const cleanup = promoteTitleIfPresent(fab);
      if (cleanup && ctx.unsubs) ctx.unsubs.push(cleanup);
      fab.onclick = (): void => {
        // P2: morph:apply 零订阅，删发射；保留 toast 反馈
        bus.emit("toast:show", {
          msg: t("preview.morphApplySent", { name: basename }),
          duration: TOAST_MS.success,
          type: "info",
        });
      };
    },
    // 加载兄弟列表
    postRender: (ctx, path) => {
      void (async () => {
        try {
          const siblings = await resolveMorphSiblings();
          const container = ctx.root.querySelector<HTMLElement>("#morph-siblings");
          if (container && siblings.length > 0) {
            const items = siblings
              .map((p) => {
                const name = p.split(/[/\\]/).pop() || p;
                const active = p === path;
                // 高亮/hover 走注入的 .morph-item 样式（内联 style 表达不了 :hover；
                // 旧写法「;font-weight:600}hover:background:...」缺分号 + hover: 前缀非法，
                // 连 font-weight 一起被并成一条声明整体丢弃）
                return `<div class="morph-item${active ? " active" : ""}" data-path="${esc(p)}">
                  <span style="font-size:var(--fs-xs);color:var(--muted)">◉</span>
                  <span>${esc(name)}</span>
                </div>`;
              })
              .join("");
            container.innerHTML = `<div style="color:var(--muted);font-size:var(--fs-sm);margin-bottom:4px">${t("preview.allMorphCount", { n: siblings.length })}</div>${items}`;
            // 点击兄弟列表项切换
            container.querySelectorAll<HTMLElement>(".morph-item").forEach((el) => {
              el.onclick = () => {
                const p = el.dataset.path || "";
                bus.emit("model:select", {
                  path: p,
                  isDir: false,
                  rtype: RESOURCE_TYPES.CUSTOM_MORPH,
                });
              };
            });
          } else if (container) {
            container.innerHTML = `<div style="color:var(--muted);font-size:var(--fs-sm);padding:4px">${t("preview.noOtherMorph")}</div>`;
          }
        } catch {
          /* 兄弟列表加载失败不阻断 */
        }
      })();
    },
  });
}

/** 显示 StageAnim 预览卡（舞台包：VMD + 音频 + 配置） */
export async function showStagePreview(
  ctx: PreviewCtx & DetailGenGuard,
  path: string,
): Promise<void> {
  const basename = path.split(/[/\\]/).pop() || "";
  return showCard(ctx, path, {
    icon: "voice",
    label: t("preview.stageAnim"),
    renderCard: (_ctx, path) => {
      const basename = path.split(/[/\\]/).pop() || "";
      return `<div class="content" id="preview-content">
  <h3>${UI_ICONS.voice} ${t("preview.stageAnim")}</h3>
  <div style="padding:12px;display:flex;flex-direction:column;gap:8px;font-size:var(--fs-sm)">
    <div><strong>${renderFormattedText(basename)}</strong></div>
    <div style="font-size:var(--fs-sm);color:var(--muted);display:flex;gap:4px;align-items:center;flex-wrap:wrap">
      <span style="background:color-mix(in srgb,var(--warning,#ffa050) 18%,transparent);color:var(--warning,#ffa050);padding:1px 6px;border-radius:var(--radius-sm);font-weight:500">${esc(RESOURCE_TYPES.STAGE)}</span>
      <span>${t("preview.stagePerformanceLabel")}</span>
    </div>
    <div id="stage-contents" style="max-height:200px;overflow-y:auto;border:1px solid var(--bd);border-radius:var(--radius-md);padding:6px;margin-top:4px"></div>
    <button class="preview-fab" id="btn-stage-load" data-fab title="${t("preview.loadStage")}" aria-label="${t("preview.loadStage")}" style="background:linear-gradient(135deg,var(--warning,#ffa050) 0%,color-mix(in srgb,var(--warning,#ffa050) 65%,#000) 100%)"><span class="preview-ic">${UI_ICONS.voice}</span></button>
  </div>
</div>`;
    },
    wireFab: (ctx, _path, fab) => {
      if (!fab) return;
      const cleanup = promoteTitleIfPresent(fab);
      if (cleanup && ctx.unsubs) ctx.unsubs.push(cleanup);
      fab.onclick = (): void => {
        // P2: stage:load 零订阅，删发射；保留 toast 反馈
        bus.emit("toast:show", {
          msg: t("preview.stageLoadSent", { name: basename }),
          duration: TOAST_MS.success,
          type: "info",
        });
      };
    },
    // 加载舞台内容
    postRender: (ctx, _path) => {
      void (async () => {
        try {
          const contents = await resolveStageSiblings();
          const container = ctx.root.querySelector<HTMLElement>("#stage-contents");
          if (container) {
            if (contents.length === 0) {
              container.innerHTML = `<div style="color:var(--muted);font-size:var(--fs-sm);padding:4px">${t("preview.stageEmpty")}</div>`;
            } else {
              const vmdCount = contents.filter((c) => c.kind === "vmd").length;
              const audioCount = contents.filter((c) => c.kind === "audio").length;
              const configCount = contents.filter((c) => c.kind === "config").length;
              container.innerHTML =
                `<div style="color:var(--muted);font-size:var(--fs-sm);margin-bottom:6px">${UI_ICONS.chart} ${t("preview.stageContents", { vmd: vmdCount, audio: audioCount, config: configCount })}</div>` +
                contents
                  .map((c) => {
                    const name = c.path.split(/[/\\]/).pop() || c.path;
                    const icon =
                      c.kind === "vmd"
                        ? "🎬"
                        : c.kind === "audio"
                          ? "🎵"
                          : c.kind === "config"
                            ? "⚙️"
                            : "📄";
                    const color =
                      c.kind === "vmd"
                        ? "var(--warning,#ffa050)"
                        : c.kind === "audio"
                          ? "var(--accent)"
                          : "var(--muted)";
                    return `<div class="stage-item" data-path="${esc(c.path)}" style="padding:3px 6px;cursor:pointer;border-radius:var(--radius-sm);font-size:var(--fs-base);display:flex;align-items:center;gap:6px;border-left:3px solid ${color}">
                      <span>${icon}</span>
                      <span>${esc(name)}</span>
                      <span style="color:var(--muted);font-size:var(--fs-xs);margin-left:auto">${c.kind}</span>
                    </div>`;
                  })
                  .join("");
              // 点击舞台项切换
              container.querySelectorAll<HTMLElement>(".stage-item").forEach((el) => {
                el.onclick = () => {
                  const p = el.dataset.path || "";
                  bus.emit("model:select", { path: p, isDir: false, rtype: RESOURCE_TYPES.STAGE });
                };
              });
            }
          }
        } catch {
          /* 舞台内容加载失败不阻断 */
        }
      })();
    },
  });
}
