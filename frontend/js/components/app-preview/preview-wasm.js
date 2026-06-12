// ===== WASM 解码层 =====
// 从 index.js 拆分：.ysm 文件的前端 WASM 解码逻辑
import { devLog } from "./preview-utils.js";
import {
  buildStdYsgpFromTextVariant,
  stripYsgpTextHeader,
} from "./preview-utils.js";
import { cacheGet, cacheSet } from "../../utils/preview-cache.js";
import { parseBedrockGeometryFromJSON } from "./utils.js";
import { parseBedrockAnimationJSON } from "../../utils/animation.js";

/**
 * 通过前端 WASM 解码 .ysm，返回 { texture, geometry, animations }
 * 不依赖组件实例（无 this 引用），可独立调用
 */
export async function decodeYsmViaWasm(modelPath) {
  const cached = cacheGet(modelPath);
  if (cached?.geometry) return cached;
  try {
    devLog("[YSM] 加载 WASM 模块...");
    const { initYSMParser, decodeYsmFileFromMemory, decodeYsmFile } =
      await import("../../wasm/ysm-parser.js");
    const ok = await initYSMParser();
    console.log(`[YSM] WASM init: ${ok ? "✅" : "❌"}`);
    if (!ok) return null;

    devLog("[YSM] 读取文件...");
    const { ReadFileBytes } = await import("../../../wailsjs/go/main/App.js");
    let bytes = await ReadFileBytes(modelPath);
    if (typeof bytes === "string") {
      const raw = atob(bytes);
      const len = raw.length;
      const arr = new Uint8Array(len);
      for (let i = 0; i < len; i++) arr[i] = raw.charCodeAt(i);
      bytes = arr;
    } else if (!(bytes instanceof Uint8Array)) {
      bytes = new Uint8Array(bytes);
    }
    devLog(`[YSM] 读取 ${bytes?.length || 0} bytes`);
    if (!bytes?.length) return null;

    // 先快路径：decodeYsmFileFromMemory（对标准 V2/V1 文件秒出）
    let files;
    try {
      files = await decodeYsmFileFromMemory(bytes);
      if (files?.length) {
        console.log(`[YSM] ✅ 原始字节解码成功: ${files.length} 文件`);
      }
    } catch (_) {}

    // 快路径失败 → 尝试 MEMFS（callMain，能处理 V3 文本头部等特殊格式）
    if (!files?.length) {
      console.log("[YSM] 原始字节解码失败，尝试 MEMFS 文件路径解码...");
      try {
        files = await decodeYsmFile(bytes);
        if (files?.length) {
          console.log(`[YSM] ✅ MEMFS 解码成功: ${files.length} 文件`);
        }
      } catch (e2) {
        console.log(`[YSM] MEMFS 解码异常: ${e2?.message}`);
      }
    }

    // MEMFS 也失败 → 尝试剥离文本头部后重建
    if (!files?.length) {
      for (const tryVer of [null, 3]) {
        const rebuilt = stripYsgpTextHeader(bytes, tryVer);
        if (rebuilt === bytes || !rebuilt) continue;
        const verLabel = tryVer ? `V${tryVer}` : "V2(自动)";
        console.log(`[YSM] 原始解码失败，尝试剥离文本头部(${verLabel})...`);
        try {
          files = await decodeYsmFileFromMemory(rebuilt);
          if (files?.length) {
            console.log(
              `[YSM] ✅ 剥离头部(${verLabel})后解码成功: ${files.length} 文件`,
            );
            break;
          }
        } catch (e3) {
          console.log(`[YSM] 剥离${verLabel}解码异常: ${e3?.message}`);
        }
      }
    }

    if (!files?.length) {
      console.log("[YSM] 内存解析返回空（跳过 callMain 直接回退 Go CLI）");
    }
    console.log(`[YSM] 输出 ${files?.length || 0} 文件`);
    if (files?.length) {
      console.log(`[YSM] 文件: ${files.map((f) => f.path).join(", ")}`);
    }
    if (!files?.length) {
      console.log("[YSM] ❌ WASM 解码失败，无输出文件");
      return null;
    }

    // 读取 ysm.json 获取纹理顺序和模型顺序
    let ysmTexOrder = null;
    let ysmModelOrder = null;
    let ysmDefaultTex = null;
    const ysmMeta = files.find((f) => f.path.endsWith("ysm.json"));
    if (ysmMeta) {
      try {
        const txt = new TextDecoder().decode(ysmMeta.data);
        const json = JSON.parse(txt);
        ysmTexOrder = json?.files?.player?.texture;
        ysmModelOrder = Array.isArray(json?.files?.player?.model)
          ? json.files.player.model
          : json?.files?.player?.model
            ? [json.files.player.model]
            : null;
        ysmDefaultTex = json?.properties?.default_texture || null;
        if (ysmTexOrder)
          console.log(
            `[YSM] ysm.json 纹理列表:`,
            ysmTexOrder
              .map((t) => (typeof t === "string" ? t : t?.uv || t?.path))
              .filter(Boolean),
            `默认纹理: ${ysmDefaultTex || "无"}`,
          );
      } catch (e) {
        /* ignore */
      }
    }

    // 收集所有纹理文件（跳过 avatar/ 目录）
    const textures = {};
    const texNameMap = {};
    const texLowerMap = {};
    const texDimensions = {};
    let maxTexW = 0,
      maxTexH = 0;
    for (const f of files) {
      if (!(f.path.endsWith(".png") || f.path.endsWith(".jpg"))) continue;
      if (f.path.startsWith("avatar/") || f.path.startsWith("avatar\\")) {
        console.log(`[YSM] 跳过头像: ${f.path}`);
        continue;
      }
      const blob = new Blob([f.data]);
      const key = f.path
        .split("/")
        .pop()
        .split("\\")
        .pop()
        .replace(/\.\w+$/, "");
      textures[key] = URL.createObjectURL(blob);
      texNameMap[key] = f.path;
      texLowerMap[key.toLowerCase()] = key;
      const arr = new Uint8Array(f.data);
      let texW = 0,
        texH = 0;
      if (arr[0] === 0x89 && arr[1] === 0x50 && arr[2] === 0x4e) {
        texW = (arr[16] << 24) | (arr[17] << 16) | (arr[18] << 8) | arr[19];
        texH = (arr[20] << 24) | (arr[21] << 16) | (arr[22] << 8) | arr[23];
      } else if (arr[0] === 0xff && arr[1] === 0xd8) {
        for (let i = 2; i < Math.min(arr.length - 8, 4096); i++) {
          if (arr[i] === 0xff && (arr[i + 1] & 0xf0) === 0xc0) {
            texH = (arr[i + 5] << 8) | arr[i + 6];
            texW = (arr[i + 7] << 8) | arr[i + 8];
            break;
          }
        }
      }
      if (texW > 0 && texH > 0) {
        texDimensions[key] = { w: texW, h: texH };
        if (texW > maxTexW) maxTexW = texW;
        if (texH > maxTexH) maxTexH = texH;
      }
      devLog(
        `[YSM] 纹理: ${f.path} → key="${key}"${texDimensions[key] ? ` (${texDimensions[key].w}×${texDimensions[key].h})` : ""}`,
      );
    }

    const matchTexKey = (tn) => {
      if (!tn) return null;
      if (textures[tn]) return tn;
      const lower = tn.toLowerCase();
      return texLowerMap[lower] || null;
    };

    let orderedTexKeys = Object.keys(textures);
    if (ysmTexOrder) {
      let ordered = [];
      for (const t of ysmTexOrder) {
        const path = typeof t === "string" ? t : t?.uv || t?.path || "";
        const tn = path
          .split("/")
          .pop()
          .replace(/\.\w+$/, "");
        const matched = matchTexKey(tn);
        if (matched) ordered.push(matched);
      }
      for (const k of Object.keys(textures)) {
        if (!ordered.includes(k)) ordered.push(k);
      }
      if (ysmDefaultTex) {
        const defKey = matchTexKey(
          ysmDefaultTex
            .split("/")
            .pop()
            .replace(/\.\w+$/, ""),
        );
        if (defKey && ordered.includes(defKey) && ordered[0] !== defKey) {
          ordered = [defKey, ...ordered.filter((k) => k !== defKey)];
        }
      }
      orderedTexKeys = ordered;
    }

    // 构建模型文件→纹理索引映射
    const modelTexIdxMap = new Map();
    if (ysmModelOrder) {
      for (let i = 0; i < ysmModelOrder.length; i++) {
        const mp = ysmModelOrder[i];
        const mn = (typeof mp === "string" ? mp : mp?.path || mp?.name || "")
          .split("/")
          .pop()
          .split("\\")
          .pop();
        if (mn) {
          modelTexIdxMap.set(mn, Math.min(i, orderedTexKeys.length - 1));
        }
      }
    }

    // 解析模型文件，合并骨骼
    let geometry = null;
    const allBones = [];
    const processedModels = new Set();
    const texMappingLog = [];

    const processModelFile = (f, forcedTexIdx) => {
      if (!f || processedModels.has(f.path)) return;
      processedModels.add(f.path);
      devLog(`[YSM] 解析 ${f.path}...`);
      try {
        const jsonStr = new TextDecoder().decode(f.data);
        const parsedRoot = JSON.parse(jsonStr);
        const rootKeys = Object.keys(parsedRoot);
        const geoKey = rootKeys.find(
          (k) => k.includes("minecraft:geometry") || k.includes("geometry"),
        );
        if (geoKey) {
          const geoArr = parsedRoot[geoKey];
          if (Array.isArray(geoArr) && geoArr.length > 0) {
            const hasBones = !!geoArr[0]?.bones?.length;
            console.log(
              `[YSM] JSON 调试: rootKeys=[${rootKeys}], geometryKey="${geoKey}", bones=${geoArr[0]?.bones?.length || 0}`,
            );
            if (!hasBones)
              console.log(`[YSM] JSON 前200字符: ${jsonStr.slice(0, 200)}`);
          }
        }
        const parsed = parseBedrockGeometryFromJSON(jsonStr);
        if (!parsed?.bones?.length) return;
        devLog(
          `[YSM] ✅ ${f.path}: ${parsed.bones.length}骨 ${parsed.cubeCount}方`,
        );

        const texIdx = forcedTexIdx ?? 0;
        const texKey =
          orderedTexKeys.length > texIdx
            ? orderedTexKeys[texIdx]
            : orderedTexKeys[0] || null;
        const texUrl = texKey ? textures[texKey] : null;

        let uvMaxW = 2,
          uvMaxH = 2;
        for (const b of parsed.bones) {
          for (const c of b.cubes || []) {
            const [sx, sy, sz] = c.size;
            if (Array.isArray(c.uv) && c.uv.length >= 2) {
              const [u, v] = c.uv;
              const maxU = u + 2 * (Math.abs(sx) + Math.abs(sz));
              const maxV = v + Math.abs(sy) + Math.abs(sz);
              if (maxU > uvMaxW) uvMaxW = maxU;
              if (maxV > uvMaxH) uvMaxH = maxV;
            } else if (c.faceUV) {
              try {
                const fd = JSON.parse(c.faceUV);
                for (const fn of [
                  "east",
                  "west",
                  "up",
                  "down",
                  "south",
                  "north",
                ]) {
                  const f = fd[fn];
                  if (!f?.uv) continue;
                  const fw = Math.abs(f.uv_size?.[0] || 0);
                  const fh = Math.abs(f.uv_size?.[1] || 0);
                  const uEnd = f.uv[0] + fw;
                  const vEnd = f.uv[1] + fh;
                  if (uEnd > uvMaxW) uvMaxW = uEnd;
                  if (vEnd > uvMaxH) uvMaxH = vEnd;
                }
              } catch {}
            }
          }
        }

        const texDim = texKey ? texDimensions[texKey] : null;
        const actualTexW = texDim ? texDim.w : 0;
        const actualTexH = texDim ? texDim.h : 0;
        const boneTexW = Math.max(actualTexW, parsed.texWidth, uvMaxW) || 64;
        const boneTexH = Math.max(actualTexH, parsed.texHeight, uvMaxH) || 64;

        texMappingLog.push({
          file: f.path.split("/").pop().split("\\").pop(),
          texKey: texKey || "—",
          texIdx,
          pngSize: actualTexW > 0 ? `${actualTexW}×${actualTexH}` : "—",
          geoSize:
            parsed.texWidth > 0
              ? `${parsed.texWidth}×${parsed.texHeight}`
              : "—",
          uvSize: `${uvMaxW}×${uvMaxH}`,
          finalSize: `${boneTexW}×${boneTexH}`,
        });
        for (const b of parsed.bones) {
          b._texIdx = texIdx;
          b._texUrl = texUrl;
          b._texWidth = boneTexW;
          b._texHeight = boneTexH;
        }
        allBones.push(...parsed.bones);
        if (!geometry) {
          geometry = parsed;
        } else {
          geometry.boneCount += parsed.boneCount;
          geometry.cubeCount += parsed.cubeCount;
          if (parsed.texWidth > geometry.texWidth)
            geometry.texWidth = parsed.texWidth;
          if (parsed.texHeight > geometry.texHeight)
            geometry.texHeight = parsed.texHeight;
        }
      } catch (e) {
        devLog(`[YSM] ❌ ${f.path}: ${e?.message}`);
      }
    };

    // 第一轮：按 ysmModelOrder 顺序处理
    if (ysmModelOrder) {
      const texKeyToIdx = {};
      orderedTexKeys.forEach((k, i) => {
        texKeyToIdx[k] = i;
      });
      for (const mp of ysmModelOrder) {
        const mn = (typeof mp === "string" ? mp : mp?.path || mp?.name || "")
          .split("/")
          .pop()
          .split("\\")
          .pop();
        if (!mn) continue;
        const lowerBase = mn.replace(/\.json$/i, "").toLowerCase();
        let matchedKey = null;
        for (const k of Object.keys(texKeyToIdx)) {
          if (
            k.toLowerCase().includes(lowerBase) ||
            lowerBase.includes(k.toLowerCase())
          ) {
            matchedKey = k;
            break;
          }
        }
        const texIdx = matchedKey != null ? (texKeyToIdx[matchedKey] ?? 0) : 0;
        const f = files.find(
          (ff) =>
            ff.path.endsWith("/" + mn) ||
            ff.path.endsWith("\\" + mn) ||
            ff.path === mn,
        );
        if (f) processModelFile(f, texIdx);
      }
    }
    // 第二轮：处理未匹配的模型文件
    for (const f of files) {
      if (!f.path.startsWith("models/")) continue;
      const modelName = f.path.split("/").pop();
      const matched = ysmModelOrder?.some((mp) => {
        const mn = (typeof mp === "string" ? mp : mp?.path || mp?.name || "")
          .split("/")
          .pop();
        return mn === modelName;
      });
      if (!matched) processModelFile(f, 0);
    }

    if (!geometry && files?.length > 0) {
      console.log(`[YSM] ⚠️ WASM 解码成功但几何体解析为空，回退 Go CLI`);
      return null;
    }

    if (geometry) {
      geometry.bones = allBones;
      geometry.textures = orderedTexKeys
        .map((k) => textures[k])
        .filter(Boolean);
      geometry.texture =
        orderedTexKeys.length > 0 ? textures[orderedTexKeys[0]] : null;
      if (maxTexW > geometry.texWidth) geometry.texWidth = maxTexW;
      if (maxTexH > geometry.texHeight) geometry.texHeight = maxTexH;
      geometry._texMappingLog = texMappingLog;
    }

    // 解析动画
    const animations = [];
    for (const f of files) {
      if (!f.path.startsWith("animations/") || !f.path.endsWith(".json"))
        continue;
      devLog(`[YSM] 动画 ${f.path}...`);
      try {
        const jsonStr = new TextDecoder().decode(f.data);
        const { clips } = parseBedrockAnimationJSON(jsonStr);
        if (clips.length > 0) animations.push(...clips);
      } catch (e) {
        devLog(`[YSM] ❌ ${f.path}: ${e?.message}`);
      }
    }

    const texUrl =
      geometry?.texture ||
      (orderedTexKeys.length > 0 ? textures[orderedTexKeys[0]] : null) ||
      null;
    cacheSet(modelPath, { texture: texUrl, geometry, animations });
    return { texture: texUrl, geometry, animations };
  } catch (e) {
    devLog(`[YSM] ❌ ${e?.message || e}`);
    return null;
  }
}
