// ===== 地面贴图文件选择器（锐评 2026-10-09：从 GroundCapability 移出）=====
// 病灶：原 GroundCapability.openTexturePicker 在 cap 内直接碰 DOM
//（document.createElement("input")），与 ground-capability.ts:576 注释「cap 不直接碰 DOM」
// **矛盾**。cap 应保持纯 Three.js 状态层，DOM / 文件系统交互归 UI 层
//（对齐 environment-capability customHdr 口径：不持久化二进制）。
// 失败对用户可见：对齐 infra/preview-loading showLoadFailure —— bus 发 toast，带 {name}
// 参数 i18n 键，无硬编码 emoji（锐评 G-9 契约）。

import * as THREE from "three";
import { t } from "@/core/i18n/t.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { toast } from "@/utils/dom/toast.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";

/** 贴图接收方最小接口（structural typing）：满足即可被 picker 调用，
 *  避免本模块反向 import GroundCapability（否则 menu→picker→cap 循环依赖）。 */
export interface GroundTextureSink {
  acceptLoadedTexture(tex: THREE.Texture, name: string): void;
}

/** 弹系统文件选择器选地面贴图。成功回调 sink.acceptLoadedTexture；失败发 toast（{name} 插值）。
 *  单测不触发（内部走 TextureLoader.loadAsync 真实网络请求）——失败文案契约由
 *  ground-capability.test.ts [G-9] 直接断言 i18n 键兜底。 */
export function pickGroundTexture(sink: GroundTextureSink): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = (): void => {
    const file = input.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    new THREE.TextureLoader()
      .loadAsync(url)
      .then((tex) => sink.acceptLoadedTexture(tex, file.name))
      .catch(() => {
        dbg("ground-tex-load-fail", { name: file.name });
        toast(t("preview.groundMatLoadFailed", { name: file.name }), TOAST_MS.normal, "error");
      })
      .finally(() => URL.revokeObjectURL(url));
  };
  input.click();
}
