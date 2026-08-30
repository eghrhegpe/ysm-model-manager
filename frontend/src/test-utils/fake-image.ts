// ===== 可控 Image 测试辅助（ADR-035 测试基础设施）=====
// src setter 同步触发 onload/onerror（happy-dom 无真实网络），供各测试 stubGlobal("Image", ...)。
// 从 model3d-loader.test.ts 抽出共享，避免多份复制（ADR-136 第四刀 jscpd 去重）。
export class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 64;
  naturalHeight = 32;
  complete = false;
  _src = "";
  _fail = false;
  /** 指定 URL 触发 onerror（部分失败场景：如 ["b.png"]） */
  _failUrls: string[] = [];
  set src(u: string) {
    this._src = u;
    this.complete = true; // 先标记完成，避免 loadTextures 等待循环悬死
    if (this._fail || this._failUrls.includes(u)) this.onerror?.();
    else this.onload?.();
  }
  get src(): string {
    return this._src;
  }
}
