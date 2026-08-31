// ===== skeleton-fill-panel.ts — fill3DPanel（从 skeleton-render.ts 拆出，ADR-040 P1）=====
// 填充 3D 信息面板：统计 + 纹理 + 模型选择 + 骨骼列表 + 详情框
import { t } from "../../core/i18n/t.ts";
import { esc } from "../../utils/dom/html.ts";
import type { BoneSelectInfo } from "../../features/preview-3d/model3d.ts";
import type { BedrockGeometry } from "../../features/preview-3d/decoder/geometry.ts";
import type { Spec3D } from "../../features/preview-3d/model3d.ts";
import type { PreviewMenuNode } from "../../features/preview-3d/menu/node-types.ts";
import { multiModelSelectNode } from "../../features/preview-3d/menu/multi-model.ts";
import type { PreviewSnapshot } from "../../features/preview-3d/state/preview-state.ts";

/** fill3DPanel 需要的句柄子集（Model3DHandleX / YsmContentHandle 均满足——结构兼容） */
export interface PanelHandle {
  getModelGroupCount(): number;
  getBoneList(modelIdx?: number): Array<{ id: string; name: string; parentId?: string | null }>;
  setBoneVisible(name: string, visible: boolean): void;
  toggleBone(name: string): void;
  onBoneSelect: ((info: BoneSelectInfo) => void) | null;
  _boneDetailEl: HTMLElement | null;
}

/** fill3DPanel 的 model 入参结构（BedrockGeometry + 面板数理化扩展字段） */
type PanelModel = BedrockGeometry & {
  textures?: string[] | null;
  _modelPath?: string;
  textureNames?: string[];
  textureCategories?: string[];
  boneCount?: number;
  bones?: unknown[];
};

/** 创建带 dataset.testid 的 div */
function mkTestDiv(testid: string): HTMLDivElement {
  const d = document.createElement("div");
  d.dataset.testid = testid;
  return d;
}

export function fill3DPanel(
  panel: HTMLDivElement,
  model: PanelModel,
  texArr: import("three").Texture[],
  spec: Spec3D,
  _model3d: PanelHandle,
  modelSel: HTMLSelectElement,
): void {
  // 组件化统计 + 纹理（随 modelSel 切换；ADR-114 perComponent 专属/全局双向）
  const compTex = (spec as { componentTextures?: Record<string, string[]> }).componentTextures;
  const statsBox = mkTestDiv("model-stats");
  panel.appendChild(statsBox);
  const texBox = mkTestDiv("tex-box");
  panel.appendChild(texBox);

  // 渲染分派：随模型选择器当前值刷新（组件 change 渲染 + 初始渲染共用）
  const renderComponent = (rawIdx: number): void =>
    fillPanelComponent(statsBox, texBox, spec, compTex, texArr, model, rawIdx);
  const renderCurrent = (): void => {
    const v = parseInt(modelSel.value, 10);
    const rawIdx = Number.isInteger(v) ? v : 0;
    renderComponent(rawIdx);
  };
  modelSel.addEventListener("change", renderCurrent);

  // 模型选择器（多组件「All」为选中默认，options 此刻已就绪）
  buildModelSelector(modelSel, _model3d, spec);

  renderCurrent();

  // 骨骼列表/详情已移除——骨骼只走 id:"bones" 独立菜单项（makeBonePanelRenderer），
  // 与 MMD/VRM/FBX 对齐，消除 fill3DPanel 内嵌骨骼 section 与菜单 bones 项的重复入口。
}

// ===== 内部辅助（从 skeleton-render.ts 复用）=====
function sec(label: string, border = true): HTMLDivElement {
  const d = document.createElement("div");
  d.className = "stat-section";
  d.dataset.testid = "stat-section";
  d.style.cssText = `font-weight:600;color:rgba(255,255,255,0.9);font-size:11px;margin-top:${border ? "12px" : "0"};margin-bottom:4px;border-top:${border ? "1px solid rgba(255,255,255,0.1)" : "none"};padding-top:${border ? "6px" : "0"}`;
  d.textContent = label;
  return d;
}
function iRow(k: string, v: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = "stat-row";
  d.dataset.testid = "stat-" + k.toLowerCase();
  d.style.cssText = "display:flex;justify-content:space-between;font-size:10px;color:rgba(255,255,255,0.6);padding:1px 0";
  // k/v 经 textContent 注入（innerHTML 拼接会把骨骼名/统计值中的
  // <>& 当 HTML 解析——注入/破版风险），span 样式保留（对齐 vrm-bone-ui field()）
  const kSpan = document.createElement("span");
  kSpan.textContent = k;
  const vSpan = document.createElement("span");
  vSpan.style.color = "rgba(255,255,255,0.9)";
  vSpan.textContent = v;
  d.appendChild(kSpan);
  d.appendChild(vSpan);
  return d;
}
// 纹理归一行：左侧名称（截断）；右侧区分「声明尺寸」与「加载尺寸」/
// 组件专属徽标。声明 = spec.models[i].textureWidth/Height（opt.decl），
// 加载 = tex.userData.imgWidth/imgHeight（实际位图；专属纹理无加载对象时只显示声明）。
function texRow(
  name: string,
  _slot: number,
  tex: import("three").Texture | null,
  opt: { cat?: string; ex?: boolean; decl?: string } = {},
): HTMLDivElement {
  const d = document.createElement("div");
  d.dataset.testid = "tex-row";
  d.style.cssText = "display:flex;justify-content:space-between;gap:6px;align-items:center;font-size:10px;color:rgba(255,255,255,0.7);padding:1px 0";
  const left = document.createElement("span");
  left.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0";
  left.textContent = name;
  d.appendChild(left);
  const right = document.createElement("span");
  right.style.cssText = "flex-shrink:0;color:rgba(255,255,255,0.5)";
  const declT = opt.decl ?? "?";
  if (opt.ex) {
    // 专属纹理无单独加载位图句柄 → 只给声明尺寸，避免「专属」看不出大小
    right.textContent = "专属 · 声明 " + declT;
  } else {
    const ud = (tex as unknown as { userData?: { imgWidth?: unknown; imgHeight?: unknown } })?.userData;
    const w = typeof ud?.imgWidth === "number" ? ud.imgWidth : null;
    const h = typeof ud?.imgHeight === "number" ? ud.imgHeight : null;
    const size = w !== null && h !== null ? w + "×" + h : "?";
    const catPart = opt.cat ? opt.cat + " · " : "";
    right.textContent = `${catPart}声明 ${declT} · 加载 ${size}`;
  }
  d.appendChild(right);
  return d;
}

// ===== fill3DPanel 拆出的包级流水线 =====

/**
 * 组件化统计 + 纹理填充（随模型选择器切换；ADR-114 perComponent 专属/全局双向）。
 * 数据源（贴合真实，非猜测）：
 *  - 归属判定 spec.componentTextures[name]（存在=组件专属，否则走全局槽）
 *  - 全局槽 = spec.models[i].meshGroups[].texIdx（Go 真实设置的全局槽；专属组件为本地 0）
 *  - 纹理信息 model.textures[i] / textureNames[i] / texArr[i]（尺寸/加载态）
 */
function fillPanelComponent(
  statsBox: HTMLDivElement,
  texBox: HTMLDivElement,
  spec: Spec3D,
  compTex: Record<string, string[]> | undefined,
  texArr: import("three").Texture[],
  model: PanelModel,
  rawIdx: number,
): void {
  // ── 统计（全量汇总 or 单组件） ──
  statsBox.innerHTML = "";
  statsBox.appendChild(sec("📐 模型统计", false));
  let bones = 0;
  let cubes = 0;
  // 声明尺寸（spec 中的纹理声明值，区别于实际加载位图尺寸）——变量名与语义对齐
  let declW: number | string = "?";
  let declH: number | string = "?";
  if (rawIdx < 0) {
    for (const m of spec.models || []) {
      const mm = m as { bones?: Array<{ _cubeCount?: number }>; textureWidth?: number; textureHeight?: number };
      bones += mm.bones?.length || 0;
      for (const b of mm.bones || []) cubes += b._cubeCount || 0;
    }
    const m0 = spec.models?.[0] as { textureWidth?: number; textureHeight?: number } | undefined;
    declW = m0?.textureWidth ?? "?";
    declH = m0?.textureHeight ?? "?";
  } else {
    const mm = spec.models?.[rawIdx] as
      | { bones?: Array<{ _cubeCount?: number }>; textureWidth?: number; textureHeight?: number }
      | undefined;
    bones = mm?.bones?.length || 0;
    for (const b of mm?.bones || []) cubes += b._cubeCount || 0;
    declW = mm?.textureWidth ?? "?";
    declH = mm?.textureHeight ?? "?";
  }
  statsBox.appendChild(iRow("骨骼", bones + " 根"));
  statsBox.appendChild(iRow("立方体", cubes + " 个"));

  // ── 纹理（只显示当前组件的绑定） ──
  const eff = rawIdx < 0 ? 0 : rawIdx;
  const mg = spec.models?.[eff] as
    | { name?: string; id?: string; textureWidth?: number; textureHeight?: number; meshGroups?: Array<{ texIdx?: number }> }
    | undefined;
  const compName = mg?.name || mg?.id || "main";
  // 当前组件声明尺寸（组件专属/全局共享都可引用；专属组件是独立 model，此字段即其声明）
  const decl =
    typeof mg?.textureWidth === "number" && typeof mg?.textureHeight === "number"
      ? mg.textureWidth + "×" + mg.textureHeight
      : "?";
  texBox.innerHTML = "";

  // 当前组件绑定摘要行
  const cap = document.createElement("div");
  cap.dataset.testid = "tex-binding";
  cap.style.cssText = "display:flex;justify-content:space-between;font-size:10px;color:rgba(255,255,255,0.6);padding:1px 0;margin-bottom:2px";
  texBox.appendChild(cap);

  // 组件专属纹理（componentTextures 命中 → 本地槽，不占全局切换）
  const ex = mg ? compTex?.[compName] : undefined;
  if (mg && ex?.length) {
    cap.innerHTML = `<span>${t("skeleton.currentBinding", { name: esc(compName) })}</span><span style="color:rgba(255,255,255,0.9)">${t("skeleton.componentExclusive")}</span>`;
    const secEl = sec(`🎨 专属纹理 (${ex.length})`);
    secEl.dataset.testid = "tex-section";
    texBox.appendChild(secEl);
    ex.forEach((_uri, k) => {
      texBox.appendChild(texRow(compName + (ex.length > 1 ? " #" + (k + 1) : ""), k, null, { ex: true, decl }));
    });
    return;
  }

  // 全局共享：该组件 meshGroups.texIdx 去重；meshGroups 缺失（单组件/稀数据）
  // 回退到全部声明纹理（骨架测试同序断言：skin+tail 都在列，不吞信息）
  const slots: number[] = [];
  for (const msh of mg?.meshGroups || []) {
    const s = msh.texIdx;
    if (typeof s === "number" && s >= 0 && s < texArr.length && !slots.includes(s)) slots.push(s);
  }
  if (mg && slots.length === 0 && texArr.length > 0) {
    for (let i = 0; i < texArr.length; i++) slots.push(i);
  }
  cap.innerHTML = `<span>${t("skeleton.currentBinding", { name: esc(compName) })}</span><span style="color:rgba(255,255,255,0.9)">${t("skeleton.slots", { slots: slots.map((s) => "[" + s + "]").join(" ") || "—" })}</span>`;
  const secEl = sec(`🎨 纹理 (${slots.length})`);
  secEl.dataset.testid = "tex-section";
  texBox.appendChild(secEl);
  for (const s of slots) {
    const tex = texArr[s];
    const name = model.textureNames?.[s] || model.textures?.[s]?.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "") || "纹理 " + (s + 1);
    const cat = model.textureCategories?.[s] || "";
    texBox.appendChild(texRow(name, s, tex ?? null, { cat, decl }));
  }
}

/** 模型选择器选项装配（多组件才显示；防御 spec.models 与 getModelGroupCount 偶发不一致） */
function buildModelSelector(modelSel: HTMLSelectElement, _model3d: PanelHandle, spec: Spec3D): void {
  const mgCount = _model3d.getModelGroupCount();
  if (mgCount <= 1) return;
  modelSel.style.display = "";
  const allOpt = document.createElement("option");
  allOpt.value = "-1";
  allOpt.textContent = t("preview.allComponents");
  allOpt.selected = true;
  modelSel.appendChild(allOpt);
  for (let i = 0; i < mgCount; i++) {
    // 防御：spec.models 与 getModelGroupCount 偶发不一致（数据损坏/版本错配）
    // 时不得因 undefined 访问崩溃整个 3D 面板
    const mgItem = (spec.models?.[i] ?? {}) as { name?: string; id?: string; bones?: unknown[] };
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = (mgItem.name || mgItem.id || "model") + " (" + (mgItem.bones?.length || 0) + ")";
    modelSel.appendChild(opt);
  }
}

// fillBoneSection / renderBoneRows / buildBoneDetail 已随 fill3DPanel 内嵌骨骼移除而删除。
// 骨骼列表/详情只走 id:"bones" 独立菜单项（makeBonePanelRenderer），与 MMD/VRM/FBX 对齐。

// ===== [doc:adr-126-p5-c] YSM 模型面板声明式 schema（受控 builder 注册的落地）=====
// fill3DPanel 的命令式 DOM 构建 → 声明式节点：统计 field + 纹理 row + 组件选择 select。
// 组件切换走 previewState 的 ui.activeComponent（renderMenu select 分支读写），
// 消除「裸函数直接拼 DOM + 手写事件监听」的渲染逃生舱。

/** 组件统计（按 activeComponent 聚合；-1 = All）：骨骼数 + 立方体数 + 组件名 */
export interface YsmModelStats {
  bones: number;
  cubes: number;
  /** 当前组件名（-1 = All 时为 "main" 或首个组件名） */
  compName: string;
}

/** 统计聚合（与 fillPanelComponent 同逻辑，抽为纯函数供 schema 与命令式共用） */
export function ysmModelStats(spec: Spec3D, rawIdx: number): YsmModelStats {
  let bones = 0;
  let cubes = 0;
  if (rawIdx < 0) {
    for (const m of spec.models || []) {
      const mm = m as { bones?: Array<{ _cubeCount?: number }> };
      bones += mm.bones?.length || 0;
      for (const b of mm.bones || []) cubes += b._cubeCount || 0;
    }
  } else {
    const mm = spec.models?.[rawIdx] as { bones?: Array<{ _cubeCount?: number }> } | undefined;
    bones = mm?.bones?.length || 0;
    for (const b of mm?.bones || []) cubes += b._cubeCount || 0;
  }
  const eff = rawIdx < 0 ? 0 : rawIdx;
  const mg = spec.models?.[eff] as { name?: string; id?: string } | undefined;
  return { bones, cubes, compName: mg?.name || mg?.id || "main" };
}

/** 当前组件纹理槽位（meshGroups.texIdx 去重；缺省回退全部声明纹理——与 fillPanelComponent 同逻辑） */
export function ysmModelTextureSlots(
  spec: Spec3D,
  rawIdx: number,
  texCount: number,
): number[] {
  const eff = rawIdx < 0 ? 0 : rawIdx;
  const mg = spec.models?.[eff] as { meshGroups?: Array<{ texIdx?: number }> } | undefined;
  const slots: number[] = [];
  for (const msh of mg?.meshGroups || []) {
    const s = msh.texIdx;
    if (typeof s === "number" && s >= 0 && s < texCount && !slots.includes(s)) slots.push(s);
  }
  if (mg && slots.length === 0 && texCount > 0) {
    for (let i = 0; i < texCount; i++) slots.push(i);
  }
  return slots;
}

/**
 * YSM 模型面板声明式节点（组件选择 + 统计 + 纹理）。
 * @param ctx YSM 控件上下文（model/spec/texArr）
 * @param snapshot 状态层快照（兼容保留：P4-D visibleWhen 谓词同构；组件下标不再读它）
 * @param sessionActiveComponent per-scene 组件选择会话态闭包（get/set 读写，-1 = All）——
 *   [doc:adr-126-p5-b→B2] activeComponent 从全局状态层收敛为适配器内会话态（对齐 litematic
 *   shell 闭包范式）：跨预览泄漏的模块级单值被多场景共享，maid generic 模式 clamp 会误伤
 *   同台 YSM 的残留下标。B2 收敛在 ysm 适配器内，对外 API 形态不变（状态层零改动）。
 *   组件切换副作用（showModelGroup）由 views 层 registerModelSchema 闭包驱动（本函数只产出节点）。
 */
export function buildYsmModelSchema(
  ctx: {
    model: PanelModel;
    spec: Spec3D;
    texArr: import("three").Texture[];
  },
  snapshot: PreviewSnapshot,
  sessionActiveComponent?: { get: () => number; set: (n: number) => void },
): PreviewMenuNode[] {
  // 会话态真源 = 闭包（per-scene）；缺省（旧调用/测试）回退快照读 ui.activeComponent（兼容）
  const rawIdxRaw =
    sessionActiveComponent?.get() ??
    (typeof snapshot["ui.activeComponent"] === "number" ? (snapshot["ui.activeComponent"] as number) : -1);
  const mgCount = ctx.spec.models?.length ?? 0;
  // clamp：组件数变化后的陈旧下标（≥ mgCount）视为 -1（All）——防 stats 聚合越界 + select 无匹配项
  const rawIdx = rawIdxRaw >= mgCount ? -1 : rawIdxRaw;
  const { bones, cubes, compName } = ysmModelStats(ctx.spec, rawIdx);
  const slots = ysmModelTextureSlots(ctx.spec, rawIdx, ctx.texArr.length);

  // 组件选择（多组件才显示；-1 = All 选项恒在）
  // [doc:adr-132] 迁 multiModelSelectNode 统一原语（对齐 MMD zip/资源包）：
  // entries 首项 "-1" = All（「全部组件」），其余为组件下标；get/set 走 per-scene 会话态闭包
  // （sessionActiveComponent，6b080b33 Bug B 范式）；refreshOnChange 切档后 stats/纹理行重建。
  // 注意：显式 `mgCount > 1` 守卫——「-1 = All」恒选项使 entries 恒 ≥2，不能依赖原语的
  // 单候选 null 判断（单组件时也不显示 select，对齐旧语义）。
  // 快照回退（审核修复）：get 与 rawIdxRaw 同表达式——闭包缺省（旧调用/测试）时读
  // snapshot["ui.activeComponent"]，面板内部口径一致（select 显示 = stats/纹理聚合行）；
  // set 在闭包缺省时无写入目标（snapshot 只读）→ 静默 no-op，legacy 路径为只读展示。
  const nodes: PreviewMenuNode[] = [];
  if (mgCount > 1) {
    const allLabel = t("preview.allComponents");
    const select = multiModelSelectNode({
      nodeId: "ysm-component-select",
      labelKey: "preview.component",
      fallback: "组件",
      refreshOnChange: true,
      entries: [
        { id: "-1", label: allLabel === "preview.allComponents" ? "全部组件" : allLabel },
        ...(ctx.spec.models ?? []).map((mg, i) => ({
          id: String(i),
          label: `${(mg as { name?: string; id?: string })?.name || (mg as { id?: string })?.id || "model"} (${(mg as { bones?: unknown[] })?.bones?.length ?? 0})`,
        })),
      ],
      activeId: (): string =>
        String(
          sessionActiveComponent?.get() ??
            (typeof snapshot["ui.activeComponent"] === "number" ? (snapshot["ui.activeComponent"] as number) : -1),
        ),
      onSelect: (id: string): void => {
        sessionActiveComponent?.set(Number.isFinite(Number(id)) ? Number(id) : -1);
      },
    });
    if (select) nodes.push(select);
  }

  // 统计
  nodes.push(
    { id: "ysm-stats-bones", kind: "field", labelKey: "preview.section.bones", fallback: "骨骼", value: `${bones} 根` },
    { id: "ysm-stats-cubes", kind: "field", labelKey: "preview.cubesLabel", fallback: "立方体", value: `${cubes} 个` },
  );

  // 纹理行（当前组件绑定）
  // [doc:adr-126-p5] ADR-114 专属纹理回归（P5-A review P2）：componentTextures[compName] 命中
  // → 渲染专属纹理行（对齐旧 fillPanelComponent 语义），否则走全局槽（meshGroups.texIdx 去重）
  const compTex = (ctx.spec as { componentTextures?: Record<string, string[]> }).componentTextures;
  const declM = ctx.spec.models?.[rawIdx < 0 ? 0 : rawIdx] as
    | { textureWidth?: number; textureHeight?: number }
    | undefined;
  const decl =
    typeof declM?.textureWidth === "number" && typeof declM?.textureHeight === "number"
      ? `${declM.textureWidth}×${declM.textureHeight}`
      : "?";
  const exclusive = rawIdx >= 0 && rawIdx < mgCount ? compTex?.[compName] : undefined;
  if (exclusive?.length) {
    exclusive.forEach((_uri, k) => {
      nodes.push({
        id: `ysm-tex-ex-${k}`,
        kind: "row",
        labelKey: `${compName}${exclusive.length > 1 ? ` #${k + 1}` : ""}`,
        fallback: `${compName}${exclusive.length > 1 ? ` #${k + 1}` : ""}`,
        value: `专属纹理 声明 ${decl}`,
      });
    });
  } else {
    for (const s of slots) {
      const tex = ctx.texArr[s];
      const name = ctx.model.textureNames?.[s]
        || ctx.model.textures?.[s]?.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "")
        || `纹理 ${s + 1}`;
      const cat = ctx.model.textureCategories?.[s] || "";
      const ud = (tex as unknown as { userData?: { imgWidth?: unknown; imgHeight?: unknown } })?.userData;
      const w = typeof ud?.imgWidth === "number" ? ud.imgWidth : null;
      const h = typeof ud?.imgHeight === "number" ? ud.imgHeight : null;
      const size = w !== null && h !== null ? `${w}×${h}` : "?";
      nodes.push({
        id: `ysm-tex-${s}`,
        kind: "row",
        labelKey: name,
        fallback: name,
        value: `${cat ? cat + " · " : ""}声明 ${decl} · 加载 ${size}`,
      });
    }
  }

  return nodes;
}