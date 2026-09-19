// preview-menu-cap-controls.ts — 能力控件通用渲染器（从 preview-menu.ts 拆出避免 env 循环依赖）。
// 独立模块只依赖 ui-header-toggle / i18n / PreviewControlDef 类型，供 preview-menu.ts 与
// preview-menu-env.ts 共用。
//
// [ADR-195 刀 2.5 / 增量2a] 投影反转 + 通道收窄：简单控件（slider/toggle/select/color）渲染实现
// 只吃统一 CapControlView（PreviewControlDef 的读取子集），由 render.ts 的 spec→view 适配器直供；
// renderCapControls 的 controls 通道收窄为复杂件专用（button/image/timeline/histogram/preset-thumb），
// 复杂渲染器直吃 PreviewControlDef 全字段——原 def→view 适配（capControlToView）随之退役。单一渲染实现，薄适配，无中间类型。

import { tOf } from "@/core/i18n/t.ts";
import type { PreviewControlDef } from "@/preview-3d/caps/scene-capability.ts";
import { installOnceStyles } from "@/preview-3d/infra/overlay-style-bridge.ts";
import { ARIA_ATTR, ROLE, SLIDER_BAR_CLASS } from "@/preview-3d/menu/schema/dom-contract.ts";
import { createHeaderToggle } from "@/preview-3d/menu/shell/header-toggle.ts";
import { DragSliderController } from "@/preview-3d/menu/shell/slider-controller.ts";
import { MENU_BTN_CSS, MENU_SECTION_CSS } from "@/preview-3d/menu/style/menu-styles.ts";
import type { PreviewSnapshot } from "@/preview-3d/state/preview-state.ts";
import { clampPct } from "@/utils/base/pure/clamp.ts";

/**
 * [ADR-195 刀 2.5] 控件渲染统一视图：五个简单控件（divider/toggle/slider/select/color）
 * 渲染实现的读取面（PreviewControlDef 子集）。node spec 经 render.ts 的 specToCapControlView
 * 适配为本视图。简单控件渲染器（renderCapToggle/Slider/Select/Color）只吃本视图，
 * 不再依赖已收窄为复杂件专用的 PreviewControlDef（增量2a）——单一渲染实现，薄适配，无中间类型。
 */
export interface CapControlView {
  id: string;
  labelKey: string;
  fallback: string;
  hintKey?: string;
  getValue(): unknown;
  setValue(v: number | string | boolean): void;
  onChange?(v: number | string | boolean): void;
  /** slider 专属 */
  slider?: {
    min: number;
    max: number;
    step: number;
    unit?: string;
    numeric?: boolean;
    onCommit?: (v: number) => void;
  };
  /** select 专属 */
  select?: Array<{ value: string; label: string; labelKey?: string }>;
}

/**
 * 控件 label 统一取值（与 render.ts 的 rmLabel 同构——回退标准全仓唯一）：
 *   labelKey 非空 → tOf 三级回退（当前包 → 兜底包 → 裸 key）；
 *   labelKey 为空 → fallback 明文（动态数据名：表情名 / 材质名 / 角色名）。
 * 入参取最小结构面（labelKey + fallback），简单件（CapControlView）与复杂件
 * （PreviewControlDef）通吃。
 * ⚠️ fallback 由 nodeControlToView 从 `node.label ?? node.id` 装入（menu-node-types
 * 「label 只装动态数据明文」条款的唯一消费者），**必须在渲染层读**：此前各渲染器只读
 * labelKey，只写 label 的声明式节点（morphNodes 表情开关）拿到空 key → tOf("") 原样
 * 回退成空串 → 整列表情有开关无文字（2026-09 修复）。
 */
export function capLabel(v: { labelKey: string; fallback: string }): string {
  return v.labelKey ? tOf(v.labelKey) : v.fallback;
}

/** i18n 安全取值走 tOf（ADR-207 D3）：PreviewControlDef.labelKey/group/hintKey 为
 *  数据字段（string）+ 原文兜底，无编译期收窄；字面量 key 站点请用 tr（拼错报红）。 */
/** P1 抽类迁移(2026-09):cap-controls 控件样式集中注入(幂等,renderCapControls 入口调用,
 *  覆盖 env.ts 直调 ×3 与 render.ts:543 委托的全部路径,不依赖 renderMenu 曾运行)。
 *  .cap-section-header/.cap-section-arrow 自 menu-styles.ts 共享常量引入（单一事实源，
 *  render.ts rmAppendFolder 消费同一常量——不再双源漂移）；.cc-btn 族同理由
 *  MENU_BTN_CSS 引入（render.ts 行内按钮也用它，曾经只有本栈注入 → 行路径拿不到）；
 *  cc-* 为本模块控件独有类
 *  (双类锚定压过 .slide-label/.setting-select)。 */
function ensureCapStyles(): void {
  installOnceStyles(
    "cap",
    `
.cap-section {
  border-top: 1px solid rgba(255,255,255,0.08);
}
${MENU_SECTION_CSS}
.cc-row { display:flex;align-items:center;gap:8px;padding:6px 10px; }
.cc-row-col { display:flex;flex-direction:column;gap:4px;padding:6px 10px; }
.cc-row-plain { padding:6px 10px; }
.cc-divider { height:1px;background:rgba(255,255,255,0.12);margin:4px 10px; }
.cc-labelbox { flex:1;display:flex;align-items:center;gap:8px;min-width:0; }
.slide-label.cc-label-xs { font-size:var(--fs-base); }
.slide-label.cc-label-grow { flex:1;font-size:var(--fs-md); }
.slide-label.cc-label-body { font-size:var(--fs-md);color:rgba(255,255,255,0.85); }
.slide-label.cc-label-dim { font-size:var(--fs-md);color:rgba(255,255,255,0.7); }
.cc-head { display:flex;justify-content:space-between;font-size:var(--fs-md);color:rgba(255,255,255,0.7); }
.cc-head-strong { display:flex;justify-content:space-between;font-size:var(--fs-md);color:rgba(255,255,255,0.85); }
.cc-hint { font-size:var(--fs-base);color:rgba(255,255,255,0.5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.cc-hint-45 { max-width:45%; }
.setting-select.cc-select { font-size:var(--fs-sm);padding:2px 4px; }
.cc-img-block { width:100%;border-radius:var(--radius-md);border:1px solid rgba(255,255,255,0.12);display:block; }
.cc-canvas-fill { width:100%;height:100%;display:block; }
.cc-canvas-auto { width:100%;height:auto;border-radius:var(--radius-md);border:1px solid rgba(255,255,255,0.12);display:block; }
.cc-picker { width:28px;height:20px;padding:0;border:1px solid rgba(255,255,255,0.2);border-radius:var(--radius-sm);cursor:pointer;background:transparent; }
.cc-band { position:relative;width:100%;border-radius:var(--radius-md);overflow:hidden;cursor:pointer;touch-action:none; }
.cc-marker { position:absolute;width:10px;height:10px;border-radius:50%;background:#fff4c2;border:1px solid rgba(0,0,0,0.3);box-shadow:0 0 6px rgba(255,244,194,0.8);transform:translate(-50%,-50%);pointer-events:none;transition:left 0.06s linear,top 0.06s linear; }
.cc-grid { display:flex;gap:6px;flex-wrap:wrap; }
.cc-thumb-btn { display:flex;flex-direction:column;align-items:center;gap:2px;background:transparent;border:2px solid rgba(255,255,255,0.12);border-radius:var(--radius-md);cursor:pointer;padding:2px; }
.cc-thumb-btn-active { border-color:var(--accent,#7c83ff);background:color-mix(in srgb,var(--accent) 15%,transparent); }
.cc-thumb-img { object-fit:cover;display:block;border-radius:var(--radius-sm);pointer-events:none;user-select:none; }
.cc-span-cap { font-size:var(--fs-micro);color:rgba(255,255,255,0.6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:72px; }
${MENU_BTN_CSS}
`,
  );
}

/** 分组折叠的 section 壳：header 点击切换展开/收起 */
interface CapSectionShell {
  section: HTMLElement;
  body: HTMLElement;
}

/** 分组折叠：同一 group 的控件归入一个可折叠 section（Map 查找表支持非连续同 group 归并），header 点击切换展开/收起。 */
// 返回新分组 section 的 body（group 为 undefined 时返回 null，直接挂 list 顶层无 section 包裹）。
function ensureCapSection(
  sectionMap: Map<string, CapSectionShell>,
  list: HTMLElement,
  group: string | undefined,
): HTMLElement | null {
  if (group === undefined) return null;
  const existing = sectionMap.get(group);
  if (existing) return existing.body;
  // 新分组：创建 section + header
  const section = document.createElement("div");
  section.className = "cap-section";
  const header = document.createElement("div");
  header.className = "cap-section-header";
  const arrow = document.createElement("span");
  arrow.textContent = "▾";
  arrow.className = "cap-section-arrow";
  const title = document.createElement("span");
  title.textContent = tOf(group);
  header.append(arrow, title);
  const body = document.createElement("div");
  body.className = "cap-section-body";
  // 动态豁免（P1 批次2 修正）：折叠态读写依赖内联 display（header 点击内联切 none/block，
  // preview-menu.test.ts:115 断言 style.display），初始展开态也须内联置 block——render.ts body 同款豁免。
  body.style.display = "block";
  let collapsed = false;
  header.onclick = (): void => {
    collapsed = !collapsed;
    body.style.display = collapsed ? "none" : "block";
    arrow.textContent = collapsed ? "▸" : "▾";
  };
  // 防御性：防止 header 点击冒泡到 SlideMenu 导航/关闭行为
  header.addEventListener("click", (e: MouseEvent): void => e.stopPropagation());
  section.append(header, body);
  list.appendChild(section);
  sectionMap.set(group, { section, body });
  return body;
}

/** toggle：label + hint + 滑动开关 */
export function renderCapToggle(parent: HTMLElement, v: CapControlView): void {
  const row = document.createElement("div");
  row.className = "slide-item cc-row";
  row.dataset.testid = `cap-${v.id}`;
  const labelBox = document.createElement("div");
  labelBox.className = "cc-labelbox";
  const label = document.createElement("span");
  label.className = "slide-label cc-label-xs";
  label.textContent = capLabel(v);
  const hint = document.createElement("span");
  hint.className = "cc-hint";
  hint.textContent = v.hintKey ? tOf(v.hintKey) : "";
  labelBox.append(label, hint);
  const toggle = createHeaderToggle({
    value: v.getValue() as boolean,
    onChange: (val: boolean): void => {
      v.setValue(val);
      // [控件原语归一] 通用副作用钩子（适配层可注入 refreshOnChange 语义）
      v.onChange?.(val);
    },
  });
  row.append(labelBox, toggle);
  // [能力移植 · addToggleRow] 整行点击切换：点 label/hint 区域 = 翻转开关。
  // target 落在 toggle 内时由 createHeaderToggle 原生 label 逻辑接管（防双触发，
  // 与 addToggleRow handleToggleRowClick 的 closest(".toggle") 守卫同款语义）。
  row.addEventListener("click", (e: MouseEvent): void => {
    if (toggle.contains(e.target as Node)) return;
    toggle.forceToggle();
  });
  parent.appendChild(row);
}

/**
 * slider 值格式化（renderCapSlider 与环境面板摘要行共用，防两端分叉）：
 *   unit="h" → HH:MM（小数进位分钟）／ unit="%" → 百分比（×100 取整）／
 *   其它 unit → 值+单位拼接 ／ 无 unit → toFixed(2)
 */
export function formatCapSliderValue(v: CapControlView, num: number): string {
  const u = v.slider?.unit;
  if (u === "h")
    return `${String(Math.floor(num)).padStart(2, "0")}:${String(Math.round((num % 1) * 60)).padStart(2, "0")}`;
  if (u === "%") return `${Math.round(num * 100)}%`;
  if (u) return `${num}${u}`;
  return num.toFixed(2);
}

/** slider：label + 当前值 + 自绘进度条（cs-bar 结构，DragSliderController 驱动）
 *  [能力移植 · ui-rows addSliderRow] cap 栈滑块从原生 input[type=range] 换为自绘
 *  cs-bar（fill 渐变 + thumb 细线 + 键盘 ←→/Home/End + pointer/触屏统一），
 *  保留 numeric 数字输入 + unit 格式化 + onCommit 提交钩子。 */
export function renderCapSlider(parent: HTMLElement, v: CapControlView): void {
  const row = document.createElement("div");
  row.className = "slide-item cc-row-col";
  row.dataset.testid = `cap-${v.id}`;
  const head = document.createElement("div");
  head.className = "cc-head";
  const name = document.createElement("span");
  name.className = "slide-label";
  name.textContent = capLabel(v);
  const val = document.createElement("span");
  head.append(name, val);

  const min = v.slider?.min ?? 0;
  const max = v.slider?.max ?? 1;
  const step = v.slider?.step ?? 0.01;
  const numVal = v.getValue() as number;
  const range = max - min;

  // 自绘进度条（.cs-bar + .cs-fill + .cs-thumb；样式随 componentsStyleSheet 已进 overlay）
  const bar = document.createElement("div");
  bar.className = SLIDER_BAR_CLASS;
  bar.tabIndex = 0;
  bar.setAttribute("role", ROLE.slider);
  bar.setAttribute(ARIA_ATTR.label, capLabel(v));
  bar.setAttribute(ARIA_ATTR.valuemin, String(min));
  bar.setAttribute(ARIA_ATTR.valuemax, String(max));
  bar.setAttribute(ARIA_ATTR.valuenow, String(numVal));
  bar.dataset.step = String(step); // aria 无 step 标准属性，作测试钩子
  const fill = document.createElement("div");
  fill.className = "cs-fill";
  const thumb = document.createElement("div");
  thumb.className = "cs-thumb";
  bar.append(fill, thumb);

  const updateDisplay = (n: number): void => {
    val.textContent = formatCapSliderValue(v, n);
    const pct = range > 0 ? clampPct(((n - min) / range) * 100) : 0;
    fill.style.width = `${pct}%`;
    thumb.style.left = `${pct}%`;
    bar.setAttribute(ARIA_ATTR.valuenow, String(n));
    if (num) num.value = String(n);
  };

  const controller = new DragSliderController({
    value: numVal,
    min,
    max,
    step,
    onChange: (n: number): void => {
      updateDisplay(n);
      v.setValue(n);
      // [控件原语归一] 通用副作用钩子（适配层可注入 refreshOnChange 语义）
      v.onChange?.(n);
    },
    onDragEnd: (n: number): void => {
      // 提交（松手/键盘步进/单击跳转）：高频拖拽已实时写值，此处只做离散提交
      // （如 pixel-ratio 提交时 notify）。未声明 onCommit 的 slider 行为不变。
      v.slider?.onCommit?.(n);
    },
  });
  controller.bind(bar);
  // [行为对齐] 单击轨道跳转（onElClick）只触发 onChange；补 onCommit 提交钩子，
  // 对齐原生 input[type=range] 的 change 语义（点击轨道后 change 触发 onCommit，
  // 如 pixel-ratio 提交时 notify）。onElClick 先更新 aria-valuenow，后注册监听读新值。
  bar.addEventListener("click", () => {
    v.slider?.onCommit?.(Number(bar.getAttribute(ARIA_ATTR.valuenow)));
  });

  // [控件原语归一] numeric：旁挂数字输入框（双向联动，onchange 走 min/max clamp——litematic 分层语义）
  let num: HTMLInputElement | null = null;
  if (v.slider?.numeric) {
    num = document.createElement("input");
    num.type = "number";
    num.min = String(min);
    num.max = String(max);
    num.step = String(step);
    num.value = String(numVal);
    num.className = "rm-range-num";
    // const 收窄替代非空断言：num 在 if 块内确定存在，捕获为 numEl 供闭包引用（TS 对 const 收窄生效）
    const numEl = num;
    numEl.onchange = (): void => {
      const n = Number(numEl.value);
      const cur = Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : numVal;
      numEl.value = String(cur);
      controller.setValue(cur);
      updateDisplay(cur);
      v.setValue(cur);
      v.onChange?.(cur);
    };
  }

  updateDisplay(numVal);
  row.append(head, bar);
  if (num) row.append(num);
  parent.appendChild(row);
}

/** select：label + 下拉选择（[控件原语归一] 收编 rmAppendSelect：onChange 钩子） */
export function renderCapSelect(parent: HTMLElement, v: CapControlView): void {
  const row = document.createElement("div");
  row.className = "slide-item cc-row";
  row.dataset.testid = `cap-${v.id}`;
  const label = document.createElement("span");
  label.className = "slide-label cc-label-grow";
  label.textContent = capLabel(v);
  const sel = document.createElement("select");
  sel.className = "setting-select cc-select";
  for (const opt of v.select ?? []) {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.labelKey ? tOf(opt.labelKey) : opt.label;
    sel.appendChild(o);
  }
  sel.value = String(v.getValue());
  sel.onchange = (): void => {
    const sv = sel.value;
    v.setValue(sv);
    // [控件原语归一] 通用副作用钩子（适配层可注入 refreshOnChange 语义）
    v.onChange?.(sv);
  };
  row.append(label, sel);
  parent.appendChild(row);
}

/** button：label + 按钮（primary/ghost）+ 动态 hint；点击动作异步禁用防重复触发，stopPropagation 护栏在虚拟层不适用 */
function renderCapButton(parent: HTMLElement, c: PreviewControlDef): void {
  const row = document.createElement("div");
  row.className = "slide-item cc-row";
  row.dataset.testid = `cap-${c.id}`;
  const label = document.createElement("span");
  label.className = "slide-label cc-label-grow";
  label.textContent = capLabel(c);
  const btn = document.createElement("button");
  const variant = c.button?.variant ?? "ghost";
  btn.className = variant === "primary" ? "cc-btn cc-btn-primary" : "cc-btn cc-btn-ghost";
  btn.textContent = c.button?.textKey ? tOf(c.button.textKey) : c.fallback;
  const hint = document.createElement("span");
  hint.className = "cc-hint cc-hint-45";
  const syncHint = (): void => {
    const v = c.button?.getHint ? c.button.getHint() : "";
    hint.textContent = v ?? (c.button?.hintKey ? tOf(c.button.hintKey) : "");
  };
  syncHint();
  let disabled = c.button?.disabled?.() ?? false;
  btn.disabled = disabled;
  btn.style.opacity = disabled ? "0.5" : "1";
  btn.onclick = async (): Promise<void> => {
    if (!c.button?.action) return;
    if (btn.disabled) return;
    btn.disabled = true;
    btn.style.opacity = "0.5";
    try {
      await c.button.action();
    } finally {
      disabled = c.button?.disabled?.() ?? false;
      btn.disabled = disabled;
      btn.style.opacity = disabled ? "0.5" : "1";
      syncHint();
    }
  };
  row.append(label, btn, hint);
  parent.appendChild(row);
}

/** image：全宽图片；无内容时跳过（不占位） */
function renderCapImage(parent: HTMLElement, c: PreviewControlDef): void {
  const url = c.getValue() as string | null;
  if (!url) return; // 无内容时跳过（不占位）
  const row = document.createElement("div");
  row.className = "slide-item cc-row-plain";
  row.dataset.testid = `cap-${c.id}`;
  const img = document.createElement("img");
  img.src = url;
  img.alt = capLabel(c);
  img.className = "cc-img-block";
  row.appendChild(img);
  parent.appendChild(row);
}

/** color：label + 颜色选择器（number 0xRRGGBB ↔ "#rrggbb"） */
export function renderCapColor(parent: HTMLElement, v: CapControlView): void {
  const row = document.createElement("div");
  row.className = "slide-item cc-row";
  row.dataset.testid = `cap-${v.id}`;
  const label = document.createElement("span");
  label.className = "slide-label cc-label-grow";
  label.textContent = capLabel(v);
  const hex = v.getValue() as number;
  const toHexStr = (val: number): string => {
    const s = (val >>> 0).toString(16).padStart(6, "0").slice(-6);
    return `#${s}`;
  };
  const picker = document.createElement("input");
  picker.type = "color";
  picker.value = toHexStr(hex);
  picker.className = "cc-picker";
  picker.oninput = (): void => {
    const h = picker.value; // "#rrggbb"
    v.setValue(parseInt(h.slice(1), 16));
  };
  row.append(label, picker);
  parent.appendChild(row);
}

/** timeline：昼夜色带 + 太阳位置标记 + 可拖动调 timeOfDay（pointer events 支持触屏） */
function renderCapTimeline(parent: HTMLElement, c: PreviewControlDef): void {
  const row = document.createElement("div");
  row.className = "slide-item cc-row-col";
  row.dataset.testid = `cap-${c.id}`;

  // 顶部：当前时间数字 + 标签
  const head = document.createElement("div");
  head.className = "cc-head-strong";
  const name = document.createElement("span");
  name.className = "slide-label";
  name.textContent = capLabel(c);
  const val = document.createElement("span");
  const numVal = c.getValue() as number;
  const fmtTime = (h: number): string =>
    `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
  val.textContent = fmtTime(numVal);
  head.append(name, val);

  // 昼夜色带（0h 夜 → 6h 晨 → 12h 午 → 18h 暮 → 24h 夜）
  const bandH = 28;
  const band = document.createElement("div");
  band.className = "cc-band";
  band.style.height = `${bandH}px`; // 动态插值拆出(P1):静态走 cc-band 类,height 运行时赋值
  const canvas = document.createElement("canvas");
  canvas.width = 240;
  canvas.height = bandH;
  canvas.className = "cc-canvas-fill";
  const cctx = canvas.getContext("2d");
  if (cctx) {
    // 简化昼夜渐变：黑→蓝→浅蓝→橙→深蓝→黑
    const stops = [
      { t: 0.0, c: "#04060f" },
      { t: 0.25, c: "#1a2b4a" }, // 6h 晨
      { t: 0.5, c: "#9bc4e8" }, // 12h 午
      { t: 0.75, c: "#ff8a5c" }, // 18h 暮
      { t: 1.0, c: "#04060f" },
    ];
    const grad = cctx.createLinearGradient(0, 0, canvas.width, 0);
    for (const s of stops) grad.addColorStop(s.t, s.c);
    cctx.fillStyle = grad;
    cctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // 太阳位置标记（顶部圆点，y 由 elevation 决定）
  const marker = document.createElement("div");
  marker.className = "cc-marker";

  const updateMarker = (hour: number): void => {
    const h = ((hour % 24) + 24) % 24;
    // 昼夜对称：12h 太阳最高（y=4px），0h/24h 最低（y=bandH-4px）
    const dayProg = Math.sin(((h - 6) / 12) * Math.PI); // -1~1
    const xPct = (h / 24) * 100;
    const yPx = bandH / 2 - dayProg * (bandH / 2 - 4);
    marker.style.left = `${xPct}%`;
    marker.style.top = `${yPx}px`;
  };
  updateMarker(numVal);

  band.append(canvas, marker);

  // 拖动处理（pointer events，支持触屏）
  let dragging = false;
  const setFromPointer = (clientX: number): void => {
    const rect = band.getBoundingClientRect();
    const px = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const hour = (px / rect.width) * 24;
    c.setValue(hour);
    val.textContent = fmtTime(hour);
    updateMarker(hour);
  };
  band.addEventListener("pointerdown", (e: PointerEvent): void => {
    dragging = true;
    band.setPointerCapture(e.pointerId);
    setFromPointer(e.clientX);
  });
  band.addEventListener("pointermove", (e: PointerEvent): void => {
    if (!dragging) return;
    setFromPointer(e.clientX);
  });
  band.addEventListener("pointerup", (e: PointerEvent): void => {
    dragging = false;
    try {
      band.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  });
  band.addEventListener("pointercancel", (): void => {
    dragging = false;
  });

  row.append(head, band);
  parent.appendChild(row);
}

/** histogram：亮度直方图，16 个柱子，值 = number[] */
function renderCapHistogram(parent: HTMLElement, c: PreviewControlDef): void {
  const raw = c.getValue();
  const data = Array.isArray(raw) ? (raw as number[]) : [];
  const row = document.createElement("div");
  row.className = "slide-item cc-row-col";
  row.dataset.testid = `cap-${c.id}`;

  const label = document.createElement("span");
  label.className = "slide-label cc-label-body";
  label.textContent = capLabel(c);
  row.appendChild(label);

  const canvas = document.createElement("canvas");
  const W = 240,
    H = 48;
  canvas.width = W;
  canvas.height = H;
  canvas.className = "cc-canvas-auto";
  const hctx = canvas.getContext("2d");
  if (hctx) {
    // 清背景
    hctx.fillStyle = "rgba(0,0,0,0.3)";
    hctx.fillRect(0, 0, W, H);
    if (data.length > 0) {
      const max = Math.max(...data, 1);
      const barW = W / data.length;
      for (let i = 0; i < data.length; i++) {
        const barH = (data[i] / max) * (H - 4);
        const x = i * barW;
        const y = H - barH;
        // 渐变：低亮度偏蓝，高亮度偏白
        const t = i / Math.max(1, data.length - 1);
        const r = Math.round(t * 255);
        const g = Math.round(t * 255);
        const b = Math.round(120 + t * 135);
        hctx.fillStyle = `rgb(${r},${g},${b})`;
        hctx.fillRect(x + 1, y, Math.max(1, barW - 2), barH);
      }
    }
  }
  row.appendChild(canvas);
  parent.appendChild(row);
}

/** preset-thumb：缩略图网格，每张图是程序化 equirect 截图；无 thumb 配置时跳过 */
function renderCapPresetThumb(parent: HTMLElement, c: PreviewControlDef): void {
  const thumb = c.thumb;
  if (!thumb) return;
  const row = document.createElement("div");
  row.className = "slide-item cc-row-col";
  row.dataset.testid = `cap-${c.id}`;
  // [预设冗余标签] hideLabel = 外层已有折叠头承载标题，不再渲染内部重复 label 行
  if (!thumb.hideLabel) {
    const label = document.createElement("span");
    label.className = "slide-label cc-label-dim";
    label.textContent = capLabel(c);
    row.appendChild(label);
  }
  const grid = document.createElement("div");
  grid.className = "cc-grid";
  let activeBtn: HTMLButtonElement | null = null;
  const activeVal = thumb.activeValue();
  for (const opt of thumb.options) {
    const btn = document.createElement("button");
    btn.className = "cc-thumb-btn";
    // [点击层叠防护] 显式置于所属行之上，避免容器层的 hover/active 视觉层抢事件焦点
    btn.style.position = "relative";
    btn.style.zIndex = "1";
    const isActive = opt.value === activeVal;
    if (isActive) activeBtn = btn;
    if (isActive) btn.classList.add("cc-thumb-btn-active");
    const img = document.createElement("img");
    const dataUrl = opt.getThumb();
    img.src = dataUrl ?? "";
    img.alt = opt.labelKey ? tOf(opt.labelKey) : opt.label;
    img.className = "cc-thumb-img"; // 尺寸动态(P1 豁免)拆内联:width/height 运行时赋值
    img.style.width = `${thumb.size}px`;
    img.style.height = `${Math.max(1, Math.floor(thumb.size / 2))}px`;
    if (!dataUrl) {
      // placeholder
      img.style.background = "rgba(255,255,255,0.08)";
      img.style.minWidth = `${thumb.size}px`;
    }
    const span = document.createElement("span");
    span.className = "cc-span-cap";
    span.textContent = opt.labelKey ? tOf(opt.labelKey) : opt.label;
    btn.append(img, span);
    btn.onclick = (e: MouseEvent): void => {
      e.stopPropagation();
      // [active 即时切换] 本地维护高亮：把 cc-thumb-btn-active 从旧按钮移到当前点击按钮，
      // 不依赖外部 menu.refresh 是否命中本 DOM（否则点了 preset 但 active 边框不动，形似「点不中」）。
      if (activeBtn !== btn) {
        activeBtn?.classList.remove("cc-thumb-btn-active");
        btn.classList.add("cc-thumb-btn-active");
        activeBtn = btn;
      }
      thumb.onSelect(opt.value);
    };
    grid.appendChild(btn);
  }
  row.appendChild(grid);
  parent.appendChild(row);
}

/**
 * 枚举控件中的条件显隐谓词（B 轨 visibleWhen 唯一形式）。
 *
 * 纯函数（不依赖注册表），供契约测试锁定「全仓共有几个隐藏逻辑、各自行为如何」——
 * 杜绝条件显隐散落各 cap 工厂内部而无集中清单的「隐藏逻辑无人知道」状况。
 *
 * ⚠️ **本函数无生产调用方，且这是有意为之——请勿以「孤儿导出」为由删除**：
 * 它是 ADR-128 §5「死穴二」的 cap 级对偶锚点。`menu-graph.ts|collectNodePredicates`
 * 负责**节点级**谓词枚举，本函数负责**控件级**枚举，两者语义严格区分、不可混用
 * （menu-graph.ts 顶部与 menu-node-types.ts 均有交叉引用注释）。删除本函数会让
 * 「cap 控件条件显隐」失去集中枚举入口，只剩测试里的散点断言。
 *
 * 消费方：`preview-state.test.ts`（契约测试，断言枚举结果），非生产代码。
 *
 * [铁律收口] 2026-09 A 轨 `visible` 闭包已整体删除：条件显隐只允许 visibleWhen（吃状态层快照
 * 的纯函数，不摸 cap 实例）。collectVisiblePredicates 现只收 visibleWhen——与
 * AGENTS.md「3d菜单只允许 visibleWhen」对齐。
 */
export function collectVisiblePredicates(controls: PreviewControlDef[]): PreviewControlDef[] {
  return controls.filter((c) => typeof c.visibleWhen === "function");
}

/** 单控件渲染分派（code_review ADR-195 #6：仅 renderCapControls 循环体自用——
 *  复杂控件走 controls 通道由 renderCapControls 整组渲染而非单控件委托，无外部消费者，
 *  故不导出；如需单控件委托再恢复 export）。
 *  与 renderCapControls 循环体共享同一分派臂（exhaustive switch 单源），
 *  保证「整组渲染」与「单控件委托渲染」视觉/行为零分歧。
 *  [ADR-195 增量2a] 通道收窄为复杂件专用：仅 button/image/timeline/histogram/preset-thumb
 *  五臂（均直吃 PreviewControlDef，全字段承载）。简单 kind（divider/toggle/slider/select/color）
 *  已从 PreviewControlKind 移除——简单件走节点原生渲染，capControlToView 随之退役。 */
function renderCapControlSingle(parent: HTMLElement, c: PreviewControlDef): void {
  switch (c.kind) {
    case "button":
      renderCapButton(parent, c);
      break;
    case "image":
      renderCapImage(parent, c);
      break;
    case "timeline":
      renderCapTimeline(parent, c);
      break;
    case "histogram":
      renderCapHistogram(parent, c);
      break;
    case "preset-thumb":
      renderCapPresetThumb(parent, c);
      break;
    default: {
      const _unhandled: never = c.kind;
      console.warn(`[preview-menu] 未处理的控件 kind: ${_unhandled as string}`);
    }
  }
}

export function renderCapControls(
  list: HTMLElement,
  controls: PreviewControlDef[],
  snapshot?: PreviewSnapshot,
): void {
  ensureCapStyles();
  // 分组折叠 sectionMap 贯穿全循环：同一 group 的控件归入同一可折叠 section，header 点击切换展开/收起。
  // kind 分派：divider 无 group 挂顶层作组间分隔；其余控件挂 (target ?? list)（有 group 挂 body，无 group 挂顶层）。签名不可动，本函数只做纯分派。
  const sectionMap = new Map<string, CapSectionShell>();
  for (const c of controls) {
    // B 轨唯一：状态层快照谓词 visibleWhen(s)——[铁律收口] A 轨 visible 闭包已删除（2026-09），
    // 条件显隐只允许 visibleWhen。无 snapshot 传入（纯 DOM 冒烟/早期调用）时跳过求值保留渲染。
    if (c.visibleWhen && snapshot && !c.visibleWhen(snapshot)) continue;
    const parent = ensureCapSection(sectionMap, list, c.group) ?? list;
    renderCapControlSingle(parent, c);
  }
}
