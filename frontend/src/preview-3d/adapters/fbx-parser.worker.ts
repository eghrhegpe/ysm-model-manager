// ===== FBX 解析 Worker（ADR-112）=====
// 复用 three 官方 FBXLoader（three/addons 子路径，与主线程 fbx-adapter 同源，
// 版本随 node_modules 走；ADR-171 已删 preview-3d/vendor/fbx 副本），
// worker 内无权访问 DOM：FBXLoader.parse(FBXBuffer) 在 worker 中产出 THREE.Group，
// 再经 fbxSceneToData 序列化为纯数据回主线程（主线程凭 FbxSceneData 重建场景）。
//
// 纹理：FBXLoader.loadTexture 经 manager.getHandler(`.${extension}`) 命中 loader 后
// 调用 loader.load(fileName)。worker 内无 <img>/ImageBitmap（无 DOM）不能真正解码，
// 注册代理 handler 拦截全部扩展名 → 返回占位纹理 + captureTextureName 登记文件名，
// 主线程按文件名（texUrlMap）用 blob URL 重建真实纹理。

import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { fbxSceneToData, captureTextureName, type FbxSceneData } from "./fbx-scene-to-data.ts";
import { safeErrorMessage } from "../../utils/safe-error-msg.ts";

/** 主线程 → Worker 请求 */
export interface FbxParseRequest {
  id: number;
  bytes: ArrayBuffer; // FBX 文件二进制（transferable）
}

/** Worker → 主线程响应 */
export interface FbxParseResponse {
  id: number;
  ok: boolean;
  data?: FbxSceneData;
  error?: string;
}

/** 纹理文件名捕获 handler（继承 Loader 满足基类成员要求，FBXLoader.loadTexture 会调用） */
class TextureNameProxyLoader extends THREE.Loader {
  override load(url: string, onLoad?: (tex: THREE.Texture) => void): THREE.Texture {
    const tex = new THREE.Texture();
    // 内嵌纹理（data:/blob: URI）已在场景内、主线程无需磁盘读取——取 basename 会得到
    // base64 载荷的垃圾片段，texUrlMap 按它查磁盘必失败 → 内嵌纹理 ASCII FBX 静默丢纹理
    // （主线程 blob 路径正常，worker 路径分叉，审核 P3）
    if (!/^(data|blob):/i.test(url)) {
      const fileName = url.split(/[\\/]/).pop() ?? url;
      captureTextureName(tex, fileName);
    }
    onLoad?.(tex);
    return tex;
  }
}

/** 匹配扩展名（.png/.jpg/.tga/.dds/...），保证任何纹理都被捕获而非走 DOM 解码——
 *  正则须匹配「文件名末尾扩展名」而非锚定开头：FBXLoader 以 `.${extension}`
 *  （点前缀扩展名）查 getHandler，旧 `/^\./` 恰能命中该形态，但对「完整文件名」
 *  形态（texture.png）失配，属侥幸覆盖；`/\.\w+$/i` 两种形态均命中（codereview 批次2） */
function createTextureCaptureManager(): THREE.LoadingManager {
  const manager = new THREE.LoadingManager();
  manager.addHandler(/\.\w+$/i, new TextureNameProxyLoader());
  return manager;
}

// ===== Worker 消息处理 =====
self.onmessage = (e: MessageEvent<FbxParseRequest>) => {
  const { id, bytes } = e.data;
  try {
    const loader = new FBXLoader(createTextureCaptureManager());
    const group = loader.parse(bytes, "") as THREE.Group & { animations: THREE.AnimationClip[] };
    const data = fbxSceneToData(group);

    // 转移所有 TypedArray 底层 buffer（避免大模型结构化拷贝）
    const transferables: Transferable[] = [];
    const pushBuffer = (arr: { buffer: ArrayBufferLike } | undefined): void => {
      if (arr) transferables.push(arr.buffer as ArrayBuffer);
    };
    for (const nd of data.nodes) {
      if (!nd.isMesh || !nd.mesh) continue;
      const g = nd.mesh.geometry;
      pushBuffer(g.position);
      pushBuffer(g.normal);
      pushBuffer(g.uv);
      pushBuffer(g.uv2);
      pushBuffer(g.color);
      pushBuffer(g.skinIndex);
      pushBuffer(g.skinWeight);
      pushBuffer(g.index);
      for (const mt of g.morphTargets ?? []) pushBuffer(mt.positions);
      if (nd.mesh.skeleton) {
        pushBuffer(nd.mesh.skeleton.boneInverses);
        pushBuffer(nd.mesh.skeleton.bindMatrix);
      }
    }
    for (const clip of data.animations) {
      for (const track of clip.tracks) {
        pushBuffer(track.times);
        pushBuffer(track.values);
      }
    }
    const resp: FbxParseResponse = { id, ok: true, data };
    (self as unknown as Worker).postMessage(resp, transferables);
  } catch (err) {
    const resp: FbxParseResponse = { id, ok: false, error: safeErrorMessage(err) };
    (self as unknown as Worker).postMessage(resp);
  }
};

export {};