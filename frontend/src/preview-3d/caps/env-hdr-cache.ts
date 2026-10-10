// ===== 环境·自定义 HDR 缓存（ADR-091-d1 拆分，从 environment-capability.ts 下沉）=====
// 封装「用户选的自定义 HDR」四态（tex/name/loading/warnedMissing）+ 解码管线 + 缩略图。
// 纯资产生命周期：**不触碰 scene.environment / scene.background**（那归 env-ibl 管），
// 也不写 envState（通路键权威在 cap 侧 onPickCustomHdr/onClearCustomHdr）。
//
// 经验 637368：custom HDR 成功解码后存单例 DataTexture（HalfFloatType），preset 来回切换
// custom 时不重复解码；更换/清空 HDR 或 dispose 时 dispose 旧纹理 + revoke blob。

import * as THREE from "three";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { customHdrThumbnail } from "./env-pixels.ts";
import { ringLog } from "./scene-capability.ts";

/** 自定义 HDR 缓存（无 THREE.DOM 外依赖，纯生命周期容器） */
export class EnvHdrCache {
  /** RGBELoader 解码结果（DataTexture，HalfFloatType），dispose 时才释放 */
  private customHdrTex: THREE.DataTexture | null = null;
  /** 用户选的原始文件名（仅展示用，不持久化） */
  private customHdrName = "";
  /** 当前 HDR 是否正在异步加载（按钮禁用、失败会清空） */
  private customHdrLoading = false;
  /** 缩略图 dataURL 缓存（[S7-3] 2026-10-10：texture 早已缓存、缩略图仍每帧重算像素
   *  运算——补 memo，贴图变更/释放即失效） */
  private customHdrThumbMemo: { w: number; h: number; url: string } | null = null;
  /** 用户选 preset=custom 但无缓存时，是否已告警（避免重复刷屏） */
  private customHdrWarnedMissing = false;

  /** 解码结果（null = 无缓存）——cap 侧经此读，**只读**，写入只经 loadFromFile/dispose */
  get tex(): THREE.DataTexture | null {
    return this.customHdrTex;
  }

  get name(): string {
    return this.customHdrName;
  }

  get loading(): boolean {
    return this.customHdrLoading;
  }

  /** 无缓存告警已发过（cap 的 buildCustomHdrTex / loadState custom 裁决读它） */
  get warnedMissing(): boolean {
    return this.customHdrWarnedMissing;
  }

  set warnedMissing(v: boolean) {
    this.customHdrWarnedMissing = v;
  }

  /** 当前是否已有 custom HDR 缓存（按钮 hint / preset=custom 不告警） */
  has(): boolean {
    return this.customHdrTex !== null;
  }

  /** 把 customHdrTex（HalfFloatType DataTexture）降采样为缩略图 dataURL。
   *  流程：读半浮点 RGB → 块平均到 thumbW×thumbH → Reinhard tonemap → sRGB 8-bit →
   *  canvas.toDataURL。无自定义 HDR 时返回 null。
   *  像素运算已下沉 env-pixels.ts#customHdrThumbnail，本方法仅注入缓存状态。 */
  thumbnail(thumbW = 128, thumbH = 64): string | null {
    // [ADR-311-d1 判别样本 2026-10-09] 无缓存**短路返回 null**（不触像素运算）——
    // 原实现无条件调 `customHdrThumbnail(null, …)`，语义虽等价（env-pixels 处理 null）但徒增无谓运算
    if (!this.customHdrTex) return null;
    // [S7-3] 同尺寸 memo 命中直接返回（贴图不变则 dataURL 恒定，重算纯浪费）
    if (
      this.customHdrThumbMemo &&
      this.customHdrThumbMemo.w === thumbW &&
      this.customHdrThumbMemo.h === thumbH
    ) {
      return this.customHdrThumbMemo.url;
    }
    const url = customHdrThumbnail(this.customHdrTex, thumbW, thumbH);
    if (url) this.customHdrThumbMemo = { w: thumbW, h: thumbH, url };
    return url;
  }

  /**
   * 释放 custom HDR 纹理缓存（不动已挂 envRT/envTexture——PMREM 管线归 env-ibl 负责释放）。
   *  cap 的 dispose 与 onClearCustomHdr 都经此。
   */
  dispose(): void {
    if (this.customHdrTex) {
      this.customHdrTex.dispose();
      this.customHdrTex = null;
    }
    this.customHdrName = "";
    this.customHdrThumbMemo = null;
  }

  /**
   * 用 RGBELoader 从 File 解码 HDR 并写入缓存，成功返回 true，失败告警并返回 false。
   *
   * 经验：HDRLoader/RGBELoader.parse(buffer) 返回 TexData（{data,width,height}），
   * 要获得 DataTexture 要走基类 DataTextureLoader.load 的包装链路（负责 new DataTexture 并填
   * format/type/magFilter...）。所以把 File 转成 blob URL 再 loader.load()。
   */
  async loadFromFile(file: File): Promise<boolean> {
    this.customHdrLoading = true;
    let blobURL = "";
    try {
      blobURL = URL.createObjectURL(file);
      const loader = new RGBELoader();
      loader.setDataType(THREE.HalfFloatType);
      const tex = await new Promise<THREE.DataTexture>((resolve, reject) => {
        loader.load(
          blobURL,
          (t) => resolve(t),
          undefined,
          (err) => reject(err),
        );
      });
      tex.mapping = THREE.EquirectangularReflectionMapping; // 教训 433477：mapping 必设
      // HDR(RGBE) 解析出来是 Linear 空间，PMREMGenerator 对 Linear 输入需要显式标记
      tex.colorSpace = THREE.LinearSRGBColorSpace;
      tex.needsUpdate = true;
      // 替换旧缓存（先写新再放旧，避免引用悬空）
      const old = this.customHdrTex;
      this.customHdrTex = tex;
      this.customHdrName = file.name;
      this.customHdrThumbMemo = null; // [S7-3] 贴图变更 → 缩略图缓存失效
      if (old) old.dispose();
      this.customHdrWarnedMissing = false;
      return true;
    } catch (err) {
      ringLog(
        "env",
        `自定义 HDR 解码失败，保持当前渲染不动（通路键未拨回，画面维持旧内容）: ${err instanceof Error ? err.message : String(err)}`,
        "warn",
      );
      // 失败不保留中间缓存
      this.dispose();
      return false;
    } finally {
      if (blobURL) URL.revokeObjectURL(blobURL);
      this.customHdrLoading = false;
    }
  }
}
