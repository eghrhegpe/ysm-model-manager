// ===== 动画播放器（类型化版 — ADR-014 P2）=====
// RAF 循环 + 时间管理，与 animation.js 的 evaluateClip 配合使用
import { evaluateClip, type AnimationClip, type BoneTransform } from "./animation.ts";

/** 骨骼层级节点（用于层级变换传播） */
export interface BoneNode {
  name: string;
  parent?: string | null;
}

export class AnimationPlayer {
  clips: AnimationClip[];
  _boneHierarchy: BoneNode[] | null;
  _currentIndex: number; // -1 = 未选择
  _time: number;
  _speed: number;
  _playing: boolean;
  _lastTimestamp: number;
  _rafId: number | null;

  /** 当前帧骨骼变换 Map（boneName → transform） */
  _currentTransforms: Map<string, BoneTransform> | null;

  /** 回调：每帧更新时调用 */
  onUpdate: ((transforms: Map<string, BoneTransform> | null, time: number, clip: AnimationClip) => void) | null;
  /** 回调：动画循环结束或播放停止 */
  onStop: (() => void) | null;

  /**
   * @param clips 动画剪辑列表
   * @param boneHierarchy 骨骼层级 [{name, parent}]，用于层级变换传播
   */
  constructor(clips: AnimationClip[] = [], boneHierarchy: BoneNode[] | null = null) {
    this.clips = clips;
    this._boneHierarchy = boneHierarchy;
    this._currentIndex = -1; // -1 = 未选择
    this._time = 0;
    this._speed = 1;
    this._playing = false;
    this._lastTimestamp = 0;
    this._rafId = null;

    this._currentTransforms = null;

    /** 回调：每帧更新时调用 */
    this.onUpdate = null;
    /** 回调：动画循环结束或播放停止 */
    this.onStop = null;
  }

  get currentClip(): AnimationClip | null {
    return this._currentIndex >= 0 ? this.clips[this._currentIndex] ?? null : null;
  }

  get currentIndex(): number {
    return this._currentIndex;
  }

  get time(): number {
    return this._time;
  }

  get playing(): boolean {
    return this._playing;
  }

  get speed(): number {
    return this._speed;
  }

  get length(): number {
    return this.currentClip?.length || 0;
  }

  /** 是否有可播放的动画 */
  get hasAnimations(): boolean {
    return this.clips.length > 0;
  }

  /** 获取动画名称列表 */
  get clipNames(): string[] {
    return this.clips.map((c) => c.name);
  }

  /**
   * 播放下标为 index 的动画
   * @param index 动画下标
   * @param startTime 起始时间
   */
  play(index: number, startTime = 0): void {
    if (index < 0 || index >= this.clips.length) {
      this.stop();
      return;
    }
    this._currentIndex = index;
    this._time = startTime;
    this._playing = true;
    this._lastTimestamp = performance.now();
    this._tick();
    this._scheduleRAF();
  }

  stop(): void {
    this._playing = false;
    this._cancelRAF();
    this._currentTransforms = null;
    this.onStop?.();
  }

  pause(): void {
    this._playing = false;
    this._cancelRAF();
  }

  resume(): void {
    if (this._currentIndex < 0) return;
    this._playing = true;
    this._lastTimestamp = performance.now();
    this._scheduleRAF();
  }

  setSpeed(s: number): void {
    this._speed = Math.max(0.1, Math.min(10, s));
  }

  /** 跳转到指定时间 */
  seek(t: number): void {
    const clip = this.currentClip;
    if (!clip) return;
    this._time = clip.loop
      ? ((t % clip.length) + clip.length) % clip.length
      : Math.max(0, Math.min(t, clip.length));
    this._tick();
  }

  /** 选择前一个动画 */
  prevClip(): void {
    if (this.clips.length === 0) return;
    const i =
      this._currentIndex <= 0 ? this.clips.length - 1 : this._currentIndex - 1;
    this.play(i);
  }

  /** 选择下一个动画 */
  nextClip(): void {
    if (this.clips.length === 0) return;
    const i =
      this._currentIndex >= this.clips.length - 1 ? 0 : this._currentIndex + 1;
    this.play(i);
  }

  // ---- 内部 ----

  _scheduleRAF(): void {
    this._cancelRAF();
    this._rafId = requestAnimationFrame((ts) => this._loop(ts));
  }

  _cancelRAF(): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _loop(timestamp: number): void {
    if (!this._playing) return;

    const dt = Math.min((timestamp - this._lastTimestamp) / 1000, 0.1); // 秒，上限 100ms 防切回跳变
    this._lastTimestamp = timestamp;

    if (this._speed > 0) {
      this._time += dt * this._speed;
    }

    const clip = this.currentClip;

    // 检查是否播放完毕
    if (clip && !clip.loop && this._time >= clip.length) {
      this._time = clip.length;
      this._tick();
      // 非循环动画播完后自动停止
      this.stop();
      return;
    }

    this._tick();
    this._scheduleRAF();
  }

  /** 计算当前帧的骨骼变换，并通知 onUpdate */
  _tick(): void {
    const clip = this.currentClip;
    if (!clip) {
      this._currentTransforms = null;
      return;
    }
    // 显示用时间：循环动画取模，非循环动画 clamp
    const displayTime =
      clip.loop && clip.length > 0
        ? ((this._time % clip.length) + clip.length) % clip.length
        : Math.min(this._time, clip.length);
    this._currentTransforms = evaluateClip(
      clip,
      this._time,
      this._boneHierarchy ?? undefined,
    );
    this.onUpdate?.(this._currentTransforms, displayTime, clip);
  }

  /** 获取当前骨骼变换 */
  getCurrentTransforms(): Map<string, BoneTransform> | null {
    return this._currentTransforms;
  }
}
