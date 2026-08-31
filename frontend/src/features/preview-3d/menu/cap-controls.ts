// preview-menu-cap-controls.ts — 能力控件通用渲染器（从 preview-menu.ts 拆出避免 env 循环依赖）。
// 独立模块只依赖 ui-header-toggle / i18n / MenuControlDef 类型，供 preview-menu.ts 与
// preview-menu-env.ts 共用。
import { createHeaderToggle } from "../../../ui/ui-header-toggle.ts";
import { t } from "../../../core/i18n/t.ts";
import type { MenuControlDef } from "../caps/scene-capability.ts";
import type { PreviewSnapshot } from "../state/preview-state.ts";

/** i18n 安全取值：键缺失时回退，杜绝菜单项退化显示原始键名 */
const tr = (key: string, fallback: string): string => {
  const v = t(key);
  return v === key ? fallback : v;
};

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
  section.style.cssText = "border-top:1px solid rgba(255,255,255,0.08)";
  const header = document.createElement("div");
  header.className = "cap-section-header";
  header.style.cssText = "display:flex;align-items:center;gap:6px;padding:8px 10px;min-height:32px;cursor:pointer;user-select:none;font-size:11px;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:0.5px";
  const arrow = document.createElement("span");
  arrow.textContent = "▾";
  arrow.style.cssText = "font-size:10px;display:inline-block";
  const title = document.createElement("span");
  title.textContent = tr(group, group);
  header.append(arrow, title);
  const body = document.createElement("div");
  body.className = "cap-section-body";
  body.style.cssText = "display:block";
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

/** divider：无 group 挂顶层作组间视觉分隔；有 group 挂 body 内作组内分隔 */
function renderCapDivider(parent: HTMLElement): void {
  const hr = document.createElement("div");
  hr.style.cssText = "height:1px;background:rgba(255,255,255,0.12);margin:4px 10px";
  parent.appendChild(hr);
}

/** toggle：label + hint + 滑动开关 */
function renderCapToggle(parent: HTMLElement, c: MenuControlDef): void {
  const row = document.createElement("div");
  row.className = "slide-item";
  row.dataset.testid = "cap-" + c.id;
  row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px";
  const labelBox = document.createElement("div");
  labelBox.style.cssText = "flex:1;display:flex;align-items:center;gap:8px;min-width:0";
  const label = document.createElement("span");
  label.className = "slide-label";
  label.textContent = tr(c.labelKey, c.fallback);
  label.style.cssText = "font-size:12px";
  const hint = document.createElement("span");
  hint.style.cssText = "font-size:12px;color:rgba(255,255,255,0.5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
  hint.textContent = c.hintKey ? tr(c.hintKey, "") : "";
  labelBox.append(label, hint);
  const toggle = createHeaderToggle({
    value: c.getValue() as boolean,
    onChange: (v: boolean): void => c.setValue(v),
    bind: (): boolean => c.getValue() as boolean,
  });
  row.append(labelBox, toggle);
  parent.appendChild(row);
}

/**
 * slider 值格式化（renderCapSlider 与环境面板摘要行共用，防两端分叉）：
 *   unit="h" → HH:MM（小数进位分钟）／ unit="%" → 百分比（×100 取整）／
 *   其它 unit → 值+单位拼接 ／ 无 unit → toFixed(2)
 */
export function formatCapSliderValue(c: MenuControlDef, v: number): string {
  const u = c.slider?.unit;
  if (u === "h") return `${String(Math.floor(v)).padStart(2, "0")}:${String(Math.round((v % 1) * 60)).padStart(2, "0")}`;
  if (u === "%") return `${Math.round(v * 100)}%`;
  if (u) return `${v}${u}`;
  return v.toFixed(2);
}

/** slider：label + 当前值 + range 拖动 */
function renderCapSlider(parent: HTMLElement, c: MenuControlDef): void {
  const row = document.createElement("div");
  row.className = "slide-item";
  row.dataset.testid = "cap-" + c.id;
  row.style.cssText = "display:flex;flex-direction:column;gap:4px;padding:6px 10px";
  const head = document.createElement("div");
  head.style.cssText = "display:flex;justify-content:space-between;font-size:13px;color:rgba(255,255,255,0.7)";
  const name = document.createElement("span");
  name.className = "slide-label";
  name.textContent = tr(c.labelKey, c.fallback);
  const val = document.createElement("span");
  const numVal = c.getValue() as number;
  val.textContent = formatCapSliderValue(c, numVal);
  head.append(name, val);
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(c.slider?.min ?? 0);
  slider.max = String(c.slider?.max ?? 1);
  slider.step = String(c.slider?.step ?? 0.01);
  slider.value = String(numVal);
  slider.style.cssText = "width:100%;cursor:pointer;accent-color:var(--accent,#7c83ff)";
  slider.oninput = (): void => {
    const v = Number(slider.value);
    c.setValue(v);
    val.textContent = formatCapSliderValue(c, v);
  };
  // slider 提交（松手/change）：高频拖拽在 oninput 已写值，此处只做离散提交回调
  // （如 pixel-ratio 提交时 notify）。未声明 onCommit 的 slider 行为不变。
  slider.onchange = (): void => {
    c.slider?.onCommit?.(Number(slider.value));
  };
  row.append(head, slider);
  parent.appendChild(row);
}

/** select：label + 下拉选择 */
function renderCapSelect(parent: HTMLElement, c: MenuControlDef): void {
  const row = document.createElement("div");
  row.className = "slide-item";
  row.dataset.testid = "cap-" + c.id;
  row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px";
  const label = document.createElement("span");
  label.className = "slide-label";
  label.textContent = tr(c.labelKey, c.fallback);
  label.style.cssText = "flex:1;font-size:13px";
  const sel = document.createElement("select");
  sel.className = "setting-select";
  sel.style.cssText = "font-size:11px;padding:2px 4px";
  for (const opt of c.select ?? []) {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    sel.appendChild(o);
  }
  sel.value = String(c.getValue());
  sel.onchange = (): void => c.setValue(sel.value);
  row.append(label, sel);
  parent.appendChild(row);
}

/** button：label + 按钮（primary/ghost）+ 动态 hint；点击动作异步禁用防重复触发，stopPropagation 护栏在虚拟层不适用 */
function renderCapButton(parent: HTMLElement, c: MenuControlDef): void {
  const row = document.createElement("div");
  row.className = "slide-item";
  row.dataset.testid = "cap-" + c.id;
  row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px";
  const label = document.createElement("span");
  label.className = "slide-label";
  label.textContent = tr(c.labelKey, c.fallback);
  label.style.cssText = "flex:1;font-size:13px";
  const btn = document.createElement("button");
  const variant = c.button?.variant ?? "ghost";
  const accent = "var(--accent,#7c83ff)";
  btn.style.cssText =
    variant === "primary"
      ? `padding:4px 10px;font-size:11px;border:0;border-radius:6px;cursor:pointer;background:${accent};color:#fff;`
      : `padding:4px 10px;font-size:11px;border:1px solid rgba(255,255,255,0.2);border-radius:6px;cursor:pointer;background:transparent;color:rgba(255,255,255,0.85);`;
  btn.textContent = c.button?.textKey ? tr(c.button.textKey, c.fallback) : c.fallback;
  const hint = document.createElement("span");
  hint.style.cssText = "font-size:12px;color:rgba(255,255,255,0.5);max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
  const syncHint = (): void => {
    const v = c.button?.getHint ? c.button.getHint() : "";
    hint.textContent = v ?? (c.button?.hintKey ? tr(c.button.hintKey, "") : "");
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
function renderCapImage(parent: HTMLElement, c: MenuControlDef): void {
  const url = c.getValue() as string | null;
  if (!url) return; // 无内容时跳过（不占位）
  const row = document.createElement("div");
  row.className = "slide-item";
  row.style.cssText = "padding:6px 10px";
  const img = document.createElement("img");
  img.src = url;
  img.alt = tr(c.labelKey, c.fallback);
  img.style.cssText = "width:100%;border-radius:6px;border:1px solid rgba(255,255,255,0.12);display:block";
  row.appendChild(img);
  parent.appendChild(row);
}

/** color：label + 颜色选择器（number 0xRRGGBB ↔ "#rrggbb"） */
function renderCapColor(parent: HTMLElement, c: MenuControlDef): void {
  const row = document.createElement("div");
  row.className = "slide-item";
  row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px";
  const label = document.createElement("span");
  label.className = "slide-label";
  label.textContent = tr(c.labelKey, c.fallback);
  label.style.cssText = "flex:1;font-size:13px";
  const hex = c.getValue() as number;
  const toHexStr = (v: number): string => {
    const s = (v >>> 0).toString(16).padStart(6, "0").slice(-6);
    return `#${s}`;
  };
  const picker = document.createElement("input");
  picker.type = "color";
  picker.value = toHexStr(hex);
  picker.style.cssText = "width:28px;height:20px;padding:0;border:1px solid rgba(255,255,255,0.2);border-radius:4px;cursor:pointer;background:transparent";
  picker.oninput = (): void => {
    const h = picker.value; // "#rrggbb"
    c.setValue(parseInt(h.slice(1), 16));
  };
  row.append(label, picker);
  parent.appendChild(row);
}

/** timeline：昼夜色带 + 太阳位置标记 + 可拖动调 timeOfDay（pointer events 支持触屏） */
function renderCapTimeline(parent: HTMLElement, c: MenuControlDef): void {
  const row = document.createElement("div");
  row.className = "slide-item";
  row.style.cssText = "display:flex;flex-direction:column;gap:4px;padding:6px 10px";

  // 顶部：当前时间数字 + 标签
  const head = document.createElement("div");
  head.style.cssText = "display:flex;justify-content:space-between;font-size:13px;color:rgba(255,255,255,0.85)";
  const name = document.createElement("span");
  name.className = "slide-label";
  name.textContent = tr(c.labelKey, c.fallback);
  const val = document.createElement("span");
  const numVal = c.getValue() as number;
  const fmtTime = (h: number): string =>
    `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
  val.textContent = fmtTime(numVal);
  head.append(name, val);

  // 昼夜色带（0h 夜 → 6h 晨 → 12h 午 → 18h 暮 → 24h 夜）
  const bandH = 28;
  const band = document.createElement("div");
  band.style.cssText = `position:relative;width:100%;height:${bandH}px;border-radius:6px;overflow:hidden;cursor:pointer;touch-action:none`;
  const canvas = document.createElement("canvas");
  canvas.width = 240;
  canvas.height = bandH;
  canvas.style.cssText = "width:100%;height:100%;display:block";
  const cctx = canvas.getContext("2d");
  if (cctx) {
    // 简化昼夜渐变：黑→蓝→浅蓝→橙→深蓝→黑
    const stops = [
      { t: 0.0, c: "#04060f" },
      { t: 0.25, c: "#1a2b4a" }, // 6h 晨
      { t: 0.5, c: "#9bc4e8" },  // 12h 午
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
  marker.style.cssText = "position:absolute;width:10px;height:10px;border-radius:50%;background:#fff4c2;border:1px solid rgba(0,0,0,0.3);box-shadow:0 0 6px rgba(255,244,194,0.8);transform:translate(-50%,-50%);pointer-events:none;transition:left 0.1s,top 0.1s";

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
    try { band.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  band.addEventListener("pointercancel", (): void => {
    dragging = false;
  });

  row.append(head, band);
  parent.appendChild(row);
}

/** histogram：亮度直方图，16 个柱子，值 = number[] */
function renderCapHistogram(parent: HTMLElement, c: MenuControlDef): void {
  const raw = c.getValue();
  const data = Array.isArray(raw) ? (raw as number[]) : [];
  const row = document.createElement("div");
  row.className = "slide-item";
  row.style.cssText = "display:flex;flex-direction:column;gap:4px;padding:6px 10px";

  const label = document.createElement("span");
  label.className = "slide-label";
  label.textContent = tr(c.labelKey, c.fallback);
  label.style.cssText = "font-size:13px;color:rgba(255,255,255,0.85)";
  row.appendChild(label);

  const canvas = document.createElement("canvas");
  const W = 240, H = 48;
  canvas.width = W;
  canvas.height = H;
  canvas.style.cssText = "width:100%;height:auto;border-radius:6px;border:1px solid rgba(255,255,255,0.12);display:block";
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
function renderCapPresetThumb(parent: HTMLElement, c: MenuControlDef): void {
  const thumb = c.thumb;
  if (!thumb) return;
  const row = document.createElement("div");
  row.className = "slide-item";
  row.style.cssText = "display:flex;flex-direction:column;gap:4px;padding:6px 10px";
  const label = document.createElement("span");
  label.className = "slide-label";
  label.textContent = tr(c.labelKey, c.fallback);
  label.style.cssText = "font-size:13px;color:rgba(255,255,255,0.7)";
  row.appendChild(label);
  const grid = document.createElement("div");
  grid.style.cssText = "display:flex;gap:6px;flex-wrap:wrap";
  const activeVal = thumb.activeValue();
  for (const opt of thumb.options) {
    const btn = document.createElement("button");
    btn.style.cssText =
      "display:flex;flex-direction:column;align-items:center;gap:2px;background:transparent;border:2px solid rgba(255,255,255,0.12);border-radius:6px;cursor:pointer;padding:2px";
    const isActive = opt.value === activeVal;
    if (isActive) {
      btn.style.borderColor = "var(--accent,#7c83ff)";
      btn.style.background = "rgba(124,131,255,0.15)";
    }
    const img = document.createElement("img");
    const dataUrl = opt.getThumb();
    img.src = dataUrl ?? "";
    img.alt = opt.label;
    img.style.cssText = `width:${thumb.size}px;height:${Math.max(1, Math.floor(thumb.size / 2))}px;object-fit:cover;display:block;border-radius:4px`;
    if (!dataUrl) {
      // placeholder
      img.style.background = "rgba(255,255,255,0.08)";
      img.style.minWidth = `${thumb.size}px`;
    }
    const span = document.createElement("span");
    span.style.cssText = "font-size:9px;color:rgba(255,255,255,0.6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:72px";
    span.textContent = opt.label;
    btn.append(img, span);
    btn.onclick = (e: MouseEvent): void => {
      e.stopPropagation();
      thumb.onSelect(opt.value);
    };
    grid.appendChild(btn);
  }
  row.appendChild(grid);
  parent.appendChild(row);
}

/**
 * [doc:adr-125 P3] 枚举控件中的条件显隐谓词。
 *
 * 纯函数（不依赖注册表），供契约测试锁定「全仓共有几个隐藏逻辑、各自行为如何」——
 * 杜绝条件显隐散落各 cap 工厂内部而无集中清单的「隐藏逻辑无人知道」状况。
 *
 * P3 规定条件显隐只允许两种形式：
 *   1. cap 内 `visible`（必须基于自身 params，**禁止跨 cap 探查**）
 *   2. 声明式节点上的 `visibleWhen(s)`（吃状态层快照的纯函数）
 * 禁止在 schema 构建期以 `if (cap)` 做条件插入（声明期求值 → cap 后创建则永不可见）。
 */
export function collectVisiblePredicates(controls: MenuControlDef[]): MenuControlDef[] {
  return controls.filter((c) => typeof c.visible === "function");
}

export function renderCapControls(
  list: HTMLElement,
  controls: MenuControlDef[],
  snapshot?: PreviewSnapshot,
): void {
  // 分组折叠 sectionMap 贯穿全循环：同一 group 的控件归入同一可折叠 section，header 点击切换展开/收起。
  // kind 分派：divider 无 group 挂顶层作组间分隔；其余控件挂 (target ?? list)（有 group 挂 body，无 group 挂顶层）。签名不可动，本函数只做纯分派。
  const sectionMap = new Map<string, CapSectionShell>();
  for (const c of controls) {
    if (c.visible && !c.visible()) continue; // A 轨：条件隐藏控件（闭包依赖 cap params）跳过
    // B 轨：状态层快照谓词 visibleWhen(s)——吃 previewSnapshot()，与 A 轨 AND（皆通过才显示）
    if (c.visibleWhen && snapshot && !c.visibleWhen(snapshot)) continue;
    const parent = ensureCapSection(sectionMap, list, c.group) ?? list;
    switch (c.kind) {
      case "divider": renderCapDivider(parent); break;
      case "toggle": renderCapToggle(parent, c); break;
      case "slider": renderCapSlider(parent, c); break;
      case "select": renderCapSelect(parent, c); break;
      case "button": renderCapButton(parent, c); break;
      case "image": renderCapImage(parent, c); break;
      case "color": renderCapColor(parent, c); break;
      case "timeline": renderCapTimeline(parent, c); break;
      case "histogram": renderCapHistogram(parent, c); break;
      case "preset-thumb": renderCapPresetThumb(parent, c); break;
    }
  }
}