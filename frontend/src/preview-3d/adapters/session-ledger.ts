// ===== 会话台账宿主（[ADR-227] P1 单例收敛：会话协调态模块级 let → 实例字段）=====
// 原 mount-preview-core 模块级可变状态（_gen 代际 / _mountSessionSeq 会话序号 /
// _handles 存活句柄表）收敛为 SessionLedgerHost 实例字段——与兄弟会话 A1
// （_globalPause → createPerceptionPauseRef）、RendererHost（render-loop）、
// SceneInfraHost（shared-infra）、PreviewShellHost（外壳）同一战役、同一步伐。
//
// 设计边界：3D 预览为「同一时刻单一全屏 overlay」的单例子系统——代际作废语义
// （invalidate 让在途加载失效）与 per-mount 会话序号必须是全应用一致的事实源，
// 故台账为单例实例（sessionLedger）；但状态均为实例字段，不再散落模块级 let，
// 未来若预览子系统整体实例化，台账可随之转为会话私有。
//
// 数组身份契约：handles 只可原地增删（push/splice/length=0），**禁止整体替换**——
// ctx.handles / switchCtx.handles 在装配期捕获该引用，换数组会让消费方看到旧表。
import type { PreviewHandle } from "./mount-preview-core.ts";

/** 存活会话条目（句柄 + 其所属代际；cooperate 模式下多模型各自独立一条） */
export interface LiveSessionEntry {
  handle: PreviewHandle;
  gen: number;
}

/**
 * 会话台账：代际计数（作废在途加载）+ 会话序号（per-mount 稳定 id）+ 存活句柄表。
 */
export class SessionLedgerHost {
  private _gen = 0;
  private _seq = 0;
  /** 所有已挂载的 PreviewHandle（cooperate 模式下多模型各自独立） */
  readonly handles: LiveSessionEntry[] = [];

  /** 开启一次 mount：分配新代际 + per-mount 会话 id 并返回。
   *  [Bug A] 每次 mount3D 自增；switchTo 走 switch-preview 复用外壳、不重新 mount，故不递增。
   *  适配器 build 经 ctx.sessionId 读取，供 per-scene schema key（ysm-model-{sid}）注册/注销对齐。 */
  beginSession(): { gen: number; sessionId: string } {
    this._gen++;
    this._seq++;
    return { gen: this._gen, sessionId: `s${this._seq}` };
  }

  /** 作废在途加载（对齐 invalidateVrmPreview / invalidateLitematicPreview） */
  invalidate(): void {
    this._gen++;
  }

  /** 当前代际（ctx.getGen 闭包读取；在途会话据此判定自身是否已失效） */
  gen(): number {
    return this._gen;
  }

  /** 最近一个已挂载会话的句柄（switchPreview / switchCtx.getHandle；coop 多会话下即最新提交者） */
  activeHandle(): PreviewHandle | null {
    return this.handles[this.handles.length - 1]?.handle ?? null;
  }

  /** 是否存在活跃会话（多模型同台追加的前置判定，ADR-093 T4） */
  hasActive(): boolean {
    return this.handles.length > 0;
  }

  /** 遍历用快照：handle.cleanup() → fullCleanup → finishSession 会从表内摘除自身，
   *  边遍历边删会跳元素（cooperate 多会话只清掉一半），故先复制一份 */
  snapshot(): LiveSessionEntry[] {
    return [...this.handles];
  }

  /** 原地清空句柄表（保数组身份，见首部契约） */
  clear(): void {
    this.handles.length = 0;
  }

  /** 重置会话序号（测试缝：重置后 sessionId 生成确定性可测，否则跨用例单调递增、
   *  断言 per-scene key 形状的测试会顺序依赖） */
  resetSeq(): void {
    this._seq = 0;
  }
}

/** 全局唯一会话台账（见首部「设计边界」：代际/序号需全应用一致） */
export const sessionLedger = new SessionLedgerHost();
