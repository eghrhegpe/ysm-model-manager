// [doc:architecture] ui-slider-controller — 统一滑块输入控制器
// 封装 mousedown→mousemove→mouseup 拖拽、键盘方向键步进、游标点击跳转逻辑。
// 供 addSliderRow / addColorSliderRow / addVector3SliderRow / addModeSlider 共用。
// 自 MikuMikuAR 迁移：依赖改为 utils/base 下的 disposable 与 clamp。

import { clamp01 } from "@/utils/base/clamp.ts";
import { addDisposableListener, type Disposable } from "@/utils/base/disposable.ts";

export interface DragSliderOptions {
  /** 当前值（内部可变） */
  value: number;
  min: number;
  max: number;
  step: number;
  /**
   * 吸附粒度；若设 snap=0.05，则值域对齐到 0.05 的整数倍（Math.round(v/snap)*snap）。
   * 默认 undefined 表示不吸附，依赖 step 本身。
   */
  snap?: number;
  onChange?: (v: number) => void;
  onDragEnd?: (v: number) => void;
}

export class DragSliderController {
  private opts: DragSliderOptions;

  // 拖拽状态
  private dragging = false;
  private dragRect: DOMRect | null = null;
  private moveDisp: Disposable | null = null;
  private endDisp: Disposable | null = null;
  // pointer 主路径接管标志：真实交互 pointerdown 置位，mousedown 兜底分支跳过（防双触发）
  private pointerDown = false;

  constructor(opts: DragSliderOptions) {
    this.opts = opts;
  }

  /** 动态更新当前值（builder 重建或外部重置时调用） */
  setValue(v: number): void {
    this.opts.value = v;
  }

  /** 绑定 DOM 并注册事件，返回 Disposable */
  bind(el: HTMLElement): Disposable {
    const onMouseDown = (e: MouseEvent): void => {
      // pointer 主路径互斥：真实鼠标交互 pointerdown 先于 mousedown 派发，
      // pointerActive 期间 mousedown 兜底分支跳过（防双触发）。
      // 无 pointer 支持的环境（或测试直接派发 mouse 事件）走本兜底路径。
      if (this.pointerDown) {
        return;
      }
      this.startDrag(e);
      // 先释放旧 document 监听再注册：mouseup 丢失（窗口外释放/切应用）
      // 后再次 mousedown 会直接覆盖引用，旧监听永久滞留并跨滑块串扰（幽灵调值）。
      this.moveDisp?.dispose();
      this.endDisp?.dispose();
      this.moveDisp = addDisposableListener(document, "mousemove", this.onDragMove);
      this.endDisp = addDisposableListener(document, "mouseup", this.onDragEnd);
    };

    const onPointerDown = (e: PointerEvent): void => {
      // 触屏/笔/鼠标统一入口（pointer 是 mouse 超集）：本交互由 pointer 路径接管
      this.pointerDown = true;
      this.startDrag(e);
      this.moveDisp?.dispose();
      this.endDisp?.dispose();
      this.moveDisp = addDisposableListener(document, "pointermove", this.onDragMove);
      this.endDisp = addDisposableListener(document, "pointerup", this.onPointerUp);
      // 指针捕获：拖出元素后 move/up 仍持续派发（timeline 控件同款先例）；
      // 不支持的环境（happy-dom）no-op，document 级监听已保证可达
      try {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      } catch {
        /* 捕获失败不阻断：document 监听兜底 */
      }
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      this.handleKeyDown(e);
    };

    // 点击游标区域（mousedown 以外的 click）直接跳转
    el.addEventListener("click", this.onElClick);

    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointercancel", this.onPointerCancel);
    el.addEventListener("keydown", onKeyDown);

    return {
      dispose: (): void => {
        el.removeEventListener("mousedown", onMouseDown);
        el.removeEventListener("pointerdown", onPointerDown);
        el.removeEventListener("pointercancel", this.onPointerCancel);
        el.removeEventListener("keydown", onKeyDown);
        el.removeEventListener("click", this.onElClick);
        this.moveDisp?.dispose();
        this.endDisp?.dispose();
        this.moveDisp = null;
        this.endDisp = null;
        this.pointerDown = false;
        this.dragRect = null;
        this.dragging = false;
      },
    };
  }

  // -------------------------------------------------------------------------
  // 内部事件处理器（使用箭头函数，保证 removeEventListener 能正确匹配）
  // -------------------------------------------------------------------------

  /** 拖拽启动公共逻辑（mousedown/pointerdown 共用）：preventDefault + 聚焦 + 快照 rect */
  private startDrag(e: MouseEvent | PointerEvent): void {
    e.preventDefault();
    (e.currentTarget as HTMLElement).focus();
    this.dragRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.dragging = false;
  }

  private readonly onPointerUp = (e: PointerEvent): void => {
    this.pointerDown = false;
    this.onDragEnd(e);
  };

  /** pointercancel（系统手势抢占，如滚动接管）：复位状态，防后续 pointerup 误判 */
  private readonly onPointerCancel = (): void => {
    this.pointerDown = false;
    this.moveDisp?.dispose();
    this.endDisp?.dispose();
    this.moveDisp = null;
    this.endDisp = null;
    this.dragRect = null;
    this.dragging = false;
  };

  private readonly onElClick = (e: MouseEvent): void => {
    e.preventDefault();
    // no stopPropagation — 允许 click 冒泡到 .cs-row
    const el = e.currentTarget as HTMLElement;
    this.setValueFromClientX(e.clientX, el.getBoundingClientRect());
  };

  private readonly onDragMove = (e: MouseEvent): void => {
    if (!this.dragging) {
      this.dragging = true;
    }
    e.preventDefault();
    if (this.dragRect) {
      this.setValueFromClientX(e.clientX, this.dragRect);
    }
  };

  private readonly onDragEnd = (e: MouseEvent): void => {
    this.moveDisp?.dispose();
    this.endDisp?.dispose();
    this.moveDisp = null;
    this.endDisp = null;

    if (!this.dragging && this.dragRect) {
      // 快速单击（非拖拽）：跳转到点击位置
      this.setValueFromClientX(e.clientX, this.dragRect);
    }
    this.dragRect = null;
    this.dragging = false;
    this.opts.onDragEnd?.(this.opts.value);
  };

  // -------------------------------------------------------------------------
  // 计算 & 步进
  // -------------------------------------------------------------------------

  /**
   * 统一拖拽/单击计算：基于 el.getBoundingClientRect() 将 clientX 映射为 value。
   */
  private setValueFromClientX(clientX: number, rect: DOMRect): void {
    const x = (clientX - rect.left) / rect.width;
    const raw = this.opts.min + clamp01(x) * (this.opts.max - this.opts.min);
    const snapped = this.snapToStep(raw);
    const clamped = Math.max(this.opts.min, Math.min(this.opts.max, snapped));
    if (clamped !== this.opts.value) {
      this.opts.value = clamped;
      this.opts.onChange?.(clamped);
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    // 倍数：ctrl > shift > default
    const mult = e.ctrlKey ? 100 : e.shiftKey ? 10 : 1;
    const delta = this.opts.step * mult;

    let next: number;
    // 仅 ←→ 调值。↑↓ 让给菜单列表遍历（滑块聚焦时上下键移动焦点，
    // 而非调值），符合 WAI-ARIA slider 允许仅水平键的规范，避免与菜单导航抢键。
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        next = Math.max(this.opts.min, this.snapToStep(this.opts.value - delta));
        break;
      case "ArrowRight":
        e.preventDefault();
        next = Math.min(this.opts.max, this.snapToStep(this.opts.value + delta));
        break;
      case "Home":
        e.preventDefault();
        next = this.opts.min;
        break;
      case "End":
        e.preventDefault();
        next = this.opts.max;
        break;
      default:
        return;
    }

    if (next !== this.opts.value) {
      this.opts.value = next;
      this.opts.onChange?.(next);
      this.opts.onDragEnd?.(next);
    }
  }

  private snapToStep(v: number): number {
    const { step, snap } = this.opts;
    if (snap !== undefined && Number.isFinite(snap) && snap > 0) {
      // 值域吸附：snap 通常为 step 的整数倍
      return Math.round(v / snap) * snap;
    }
    if (step && Number.isFinite(step)) {
      // 步进吸附
      const precision = 1 / step;
      return Math.round(v * precision) / precision;
    }
    return v;
  }
}
