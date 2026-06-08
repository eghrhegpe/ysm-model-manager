/**
 * 动画播放器 — RAF 循环 + 时间管理
 * 与 animation.js 的 evaluateClip 配合使用
 */
import { evaluateClip } from "./animation.js";

export class AnimationPlayer {
  /**
   * @param {AnimationClip[]} clips
   * @param {object[]} [boneHierarchy] - [{name, parent}] 用于层级变换传播
   */
  constructor(clips = [], boneHierarchy = null) {
    this.clips = clips;
    this._boneHierarchy = boneHierarchy;
    this._currentIndex = -1; // -1 = 未选择
    this._time = 0;
    this._speed = 1;
    this._playing = false;
    this._lastTimestamp = 0;
    this._rafId = null;

    /** @type {Map<string, {rotation, position, scale}> | null} */
    this._currentTransforms = null;

    /** 回调：每帧更新时调用 */
    this.onUpdate = null;
    /** 回调：动画循环结束或播放停止 */
    this.onStop = null;
  }

  get currentClip() {
    return this._currentIndex >= 0 ? this.clips[this._currentIndex] : null;
  }

  get currentIndex() {
    return this._currentIndex;
  }

  get time() {
    return this._time;
  }

  get playing() {
    return this._playing;
  }

  get speed() {
    return this._speed;
  }

  get length() {
    return this.currentClip?.length || 0;
  }

  /** 是否有可播放的动画 */
  get hasAnimations() {
    return this.clips.length > 0;
  }

  /** 获取动画名称列表 */
  get clipNames() {
    return this.clips.map((c) => c.name);
  }

  /**
   * 播放下标为 index 的动画
   * @param {number} index
   * @param {number} [startTime]
   */
  play(index, startTime = 0) {
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

  stop() {
    this._playing = false;
    this._cancelRAF();
    this._currentTransforms = null;
    this.onStop?.();
  }

  pause() {
    this._playing = false;
    this._cancelRAF();
  }

  resume() {
    if (this._currentIndex < 0) return;
    this._playing = true;
    this._lastTimestamp = performance.now();
    this._scheduleRAF();
  }

  setSpeed(s) {
    this._speed = Math.max(0.1, Math.min(10, s));
  }

  /** 跳转到指定时间 */
  seek(t) {
    const clip = this.currentClip;
    if (!clip) return;
    this._time = clip.loop
      ? ((t % clip.length) + clip.length) % clip.length
      : Math.max(0, Math.min(t, clip.length));
    this._tick();
  }

  /** 选择前一个动画 */
  prevClip() {
    if (this.clips.length === 0) return;
    const i =
      this._currentIndex <= 0 ? this.clips.length - 1 : this._currentIndex - 1;
    this.play(i);
  }

  /** 选择下一个动画 */
  nextClip() {
    if (this.clips.length === 0) return;
    const i =
      this._currentIndex >= this.clips.length - 1 ? 0 : this._currentIndex + 1;
    this.play(i);
  }

  // ---- 内部 ----

  _scheduleRAF() {
    this._cancelRAF();
    this._rafId = requestAnimationFrame((ts) => this._loop(ts));
  }

  _cancelRAF() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _loop(timestamp) {
    if (!this._playing) return;

    const dt = (timestamp - this._lastTimestamp) / 1000; // 秒
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
  _tick() {
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
      this._boneHierarchy,
    );
    this.onUpdate?.(this._currentTransforms, displayTime, clip);
  }

  /** 获取当前骨骼变换 */
  getCurrentTransforms() {
    return this._currentTransforms;
  }
}
