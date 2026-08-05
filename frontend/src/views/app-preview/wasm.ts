// ===== WASM 解码层 =====
// 从 index.ts 拆分：.ysm 文件的前端 WASM 解码逻辑
import { devLog } from "./utils.ts";
import { stripYsgpTextHeader, type DecodedYsm } from "./utils.ts";
import { cacheGet, cacheSet } from "./cache.ts";
import { parseBedrockGeometryFromJSON, type BedrockGeometry } from "./geometry.ts";
import { parseBedrockAnimationJSON } from "../../utils/animation/animation.ts";
import { initYSMParser, decodeYsmFileFromMemory, decodeYsmFile } from "../../wasm/ysm-parser.ts";
import { getApp } from "../../wails/app.ts";

/** WASM 解码输出文件 */
interface DecodedFile {
  path: string;
  data: Uint8Array;
}

/** 纹理尺寸 */
interface TexDim {
  w: number;
  h: number;
}

/**
 * 通过前端 WASM 解码 .ysm，返回 { texture, geometry, animations }
 * 不依赖组件实例（无 this 引用），可独立调用
 */
export async function decodeYsmViaWasm(
  modelPath: string,
): Promise<DecodedYsm | null> {
  const cached = cacheGet(modelPath);
  const cachedGeo = cached?.geometry as BedrockGeometry | undefined;
  if (cachedGeo?.bones?.length) return cached as DecodedYsm;
  if (cached?._wasmFailed) return null;

  // 读文件（WASM 和 JSON 都需要，提升到外层作用域供两个 try 块共用）
  let bytes: Uint8Array | null = null;
  try {
    const { ReadFileBytes } = await getApp();
    // ReadFileBytes 绑定返回 base64 string | null（非 Uint8Array——原 JS 的
    // instanceof Uint8Array 分支是死代码，已清理）
    const raw = await ReadFileBytes(modelPath);
    if (raw) {
      const rawStr = atob(raw);
      const len = rawStr.length;
      const arr = new Uint8Array(len);
      for (let i = 0; i < len; i++) arr[i] = rawStr.charCodeAt(i);
      bytes = arr;
    } else {
      bytes = new Uint8Array(0);
    }
    devLog(`[YSM] 读取 ${bytes?.length || 0} bytes`);
    if (!bytes?.length) {
      cacheSet(modelPath, { _wasmFailed: true });
      return null;
    }

    // .json 文件直接解析，不需要 WASM
    if (/\.json$/i.test(modelPath)) {
      const text = new TextDecoder("utf-8").decode(bytes);
      const json = JSON.parse(text);
      const result = parseYsmJsonDirect(json);
      if (result) {
        if (result.authors?.length) {
          const dir = modelPath.replace(/\\/g, "/");
          const baseDir = dir.includes("/") ? dir.substring(0, dir.lastIndexOf("/")) : ".";
          for (const au of result.authors) {
            if (!au.avatarPath) continue;
            try {
              const avatarRel =
                au.avatarPath.startsWith("avatar/") || au.avatarPath.startsWith("avatar\\")
                  ? au.avatarPath
                  : "avatar/" + au.avatarPath;
              let avatarBytes: Uint8Array | null = null;
              const rawAvatar = await ReadFileBytes(baseDir + "/" + avatarRel);
              if (rawAvatar) {
                const rawStr = atob(rawAvatar);
                const len = rawStr.length;
                const arr = new Uint8Array(len);
                for (let i = 0; i < len; i++) arr[i] = rawStr.charCodeAt(i);
                avatarBytes = arr;
              }
              if (avatarBytes?.length) {
                const blob = new Blob([avatarBytes.buffer as ArrayBuffer]);
                au.avatarUrl = URL.createObjectURL(blob);
              }
            } catch (_e) {}
          }
        }
        cacheSet(modelPath, { ...result, _decodedBy: "🧠 JSON 直接解析" });
        // 异步缓存头像到 creators_cache/ 供创作者界面使用
        getApp()
          .then(({ CacheModelAvatars }) => CacheModelAvatars(modelPath))
          .catch(() => {});
        return result;
      }
      return null;
    }
  } catch (e) {
    devLog(`[YSM] ❌ ${e instanceof Error ? e.message : String(e)}`);
    cacheSet(modelPath, { _wasmFailed: true });
    return null;
  }

  if (!bytes) return null;

  // .ysm 文件 → 初始化 WASM 解码
  try {
    devLog("[YSM] 加载 WASM 模块...");
    const ok = await initYSMParser();
    console.log(`[YSM] WASM init: ${ok ? "✅" : "❌"}`);
    if (!ok) {
      cacheSet(modelPath, { _wasmFailed: true });
      return null;
    }

    // 先快路径：decodeYsmFileFromMemory（对标准 V2/V1 文件秒出）
    let files: DecodedFile[] = [];
    try {
      files = (await decodeYsmFileFromMemory(bytes)) || [];
      if (files?.length) {
        console.log(`[YSM] ✅ 原始字节解码成功: ${files.length} 文件`);
      }
    } catch (_) {}

    // 快路径失败 → 尝试 MEMFS（callMain，能处理 V3 文本头部等特殊格式）
    if (!files?.length) {
      console.log("[YSM] 原始字节解码失败，尝试 MEMFS 文件路径解码...");
      try {
        files = (await decodeYsmFile(bytes)) || [];
        if (files?.length) {
          console.log(`[YSM] ✅ MEMFS 解码成功: ${files.length} 文件`);
        }
      } catch (e2) {
        console.log(`[YSM] MEMFS 解码异常: ${e2 instanceof Error ? e2.message : String(e2)}`);
      }
    }

    // MEMFS 也失败 → 尝试剥离文本头部后重建
    if (!files?.length) {
      for (const tryVer of [null, 3]) {
        const rebuilt = stripYsgpTextHeader(bytes, tryVer ?? undefined);
        if (rebuilt === bytes || !rebuilt) continue;
        const verLabel = tryVer ? `V${tryVer}` : "V2(自动)";
        console.log(`[YSM] 原始解码失败，尝试剥离文本头部(${verLabel})...`);
        try {
          files = (await decodeYsmFileFromMemory(rebuilt)) || [];
          if (files?.length) {
            break;
          }
        } catch (e3) {
          console.log(`[YSM] 剥离${verLabel}解码异常: ${e3 instanceof Error ? e3.message : String(e3)}`);
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
      cacheSet(modelPath, { _wasmFailed: true });
      return null;
    }

    // 读取 ysm.json 获取纹理顺序和模型顺序
    let ysmTexOrder: unknown[] | null = null;
    let ysmModelOrder: unknown[] | null = null;
    let ysmDefaultTex: string | null = null;
    const ysmAuthors: Array<{
      name: string;
      role: string;
      avatarUrl: string | null;
      avatarPath: string;
    }> = [];
    // avatars 声明提前（原 JS 在 ysmMeta 块之后声明 → TDZ ReferenceError 被 catch 吞，
    // 导致 WASM 路径作者信息恒为空——顺带修复）
    const avatars: Record<string, string> = {};
    const ysmMeta = files.find((f) => f.path.endsWith("ysm.json"));
    if (ysmMeta) {
      try {
        const txt = new TextDecoder().decode(ysmMeta.data);
        const json = JSON.parse(txt) as {
          files?: { player?: { texture?: unknown; model?: unknown } };
          properties?: { default_texture?: string | null };
          metadata?: { authors?: Array<{ name?: string; role?: string; avatar?: string }> };
        };
        ysmTexOrder = json?.files?.player?.texture
          ? Array.isArray(json.files.player.texture)
            ? json.files.player.texture
            : [json.files.player.texture]
          : null;
        ysmModelOrder = Array.isArray(json?.files?.player?.model)
          ? json.files.player.model
          : json?.files?.player?.model
            ? [json.files.player.model]
            : null;
        ysmDefaultTex = json?.properties?.default_texture || null;
        // 解析作者信息
        if (json?.metadata?.authors) {
          for (const au of json.metadata.authors) {
            if (!au.name) continue;
            const avatarPath = au.avatar || "";
            const avatarKey = avatarPath.split(/[/\\]/).pop()?.replace(/\.\w+$/, "") || "";
            ysmAuthors.push({
              name: au.name,
              role: au.role || "",
              avatarUrl: avatars[avatarKey] || null,
              avatarPath: avatarPath,
            });
          }
        }
      } catch (e) {
        /* ignore */
      }
    }

    // 收集所有纹理文件（同时收集头像）
    const textures: Record<string, string> = {};
    const texNameMap: Record<string, string> = {};
    const texLowerMap: Record<string, string> = {};
    const texDimensions: Record<string, TexDim> = {};
    let maxTexW = 0,
      maxTexH = 0;
    for (const f of files) {
      if (!(f.path.endsWith(".png") || f.path.endsWith(".jpg"))) continue;
      if (f.path.startsWith("avatar/") || f.path.startsWith("avatar\\")) {
        const blob = new Blob([f.data.buffer as ArrayBuffer]);
        const name = f.path.split(/[/\\]/).pop()?.replace(/\.\w+$/, "") || "";
        avatars[name] = URL.createObjectURL(blob);
        continue;
      }
      const blob = new Blob([f.data.buffer as ArrayBuffer]);
      const key = f.path.split(/[/\\]/).pop()?.replace(/\.\w+$/, "") || "";
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
      const td = texDimensions[key];
      devLog(
        `[YSM] 纹理: ${f.path} → key="${key}"${
          td ? ` (${td.w}×${td.h})` : ""
        }`,
      );
    }

    const matchTexKey = (tn: string): string | null => {
      if (!tn) return null;
      if (textures[tn]) return tn;
      const lower = tn.toLowerCase();
      return texLowerMap[lower] || null;
    };

    let orderedTexKeys = Object.keys(textures);
    if (ysmTexOrder) {
      let ordered: string[] = [];
      for (const t of ysmTexOrder) {
        const path =
          typeof t === "string" ? t : (t as { uv?: string; path?: string })?.uv || (t as { path?: string })?.path || "";
        const tn = path.split("/").pop()?.replace(/\.\w+$/, "") || "";
        const matched = matchTexKey(tn);
        if (matched) ordered.push(matched);
      }
      // 仅使用 ysmTexOrder 显式声明的纹理，排除非贴图（头像/预览图）
      if (ysmDefaultTex) {
        const defKey = matchTexKey(ysmDefaultTex.split("/").pop()?.replace(/\.\w+$/, "") || "");
        if (defKey && ordered.includes(defKey) && ordered[0] !== defKey) {
          ordered = [defKey, ...ordered.filter((k) => k !== defKey)];
        }
      }
      orderedTexKeys = ordered;
    }

    // 构建模型文件→纹理索引映射
    const modelTexIdxMap = new Map<string, number>();
    if (ysmModelOrder) {
      for (let i = 0; i < ysmModelOrder.length; i++) {
        const mp = ysmModelOrder[i];
        const mn =
          (
            typeof mp === "string"
              ? mp
              : (mp as { path?: string; name?: string })?.path ||
                (mp as { name?: string })?.name ||
                ""
          )
            .split(/[/\\]/)
            .pop() || "";
        if (mn) {
          modelTexIdxMap.set(mn, Math.min(i, orderedTexKeys.length - 1));
        }
      }
    }

    // 解析模型文件，合并骨骼
    let geometry: BedrockGeometry | null = null;
    const allBones: BedrockGeometry["bones"] = [];
    const processedModels = new Set<string>();
    const texMappingLog: Array<Record<string, string | number>> = [];

    const processModelFile = (f: DecodedFile, forcedTexIdx?: number): void => {
      if (!f || processedModels.has(f.path)) return;
      processedModels.add(f.path);
      devLog(`[YSM] 解析 ${f.path}...`);
      try {
        const jsonStr = new TextDecoder().decode(f.data);
        const parsed = parseBedrockGeometryFromJSON(jsonStr);
        if (!parsed?.bones?.length) return;
        devLog(`[YSM] ✅ ${f.path}: ${parsed.bones.length}骨 ${parsed.cubeCount}方`);

        const texIdx = forcedTexIdx ?? 0;
        const texKey =
          orderedTexKeys.length > texIdx ? orderedTexKeys[texIdx] : orderedTexKeys[0] || null;
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
                const fd = JSON.parse(c.faceUV) as Record<
                  string,
                  { uv?: number[]; uv_size?: number[] }
                >;
                for (const fn of ["east", "west", "up", "down", "south", "north"]) {
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
          file: f.path.split(/[/\\]/).pop() || "",
          texKey: texKey || "—",
          texIdx,
          pngSize: actualTexW > 0 ? `${actualTexW}×${actualTexH}` : "—",
          geoSize: parsed.texWidth > 0 ? `${parsed.texWidth}×${parsed.texHeight}` : "—",
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
          if (parsed.texWidth > geometry.texWidth) geometry.texWidth = parsed.texWidth;
          if (parsed.texHeight > geometry.texHeight) geometry.texHeight = parsed.texHeight;
        }
      } catch (e) {
        devLog(`[YSM] ❌ ${f.path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    // 第一轮：按 ysmModelOrder 顺序处理
    if (ysmModelOrder) {
      const texKeyToIdx: Record<string, number> = {};
      orderedTexKeys.forEach((k, i) => {
        texKeyToIdx[k] = i;
      });
      for (const mp of ysmModelOrder) {
        const mn =
          (
            typeof mp === "string"
              ? mp
              : (mp as { path?: string; name?: string })?.path ||
                (mp as { name?: string })?.name ||
                ""
          )
            .split(/[/\\]/)
            .pop() || "";
        if (!mn) continue;
        const lowerBase = mn.replace(/\.json$/i, "").toLowerCase();
        let matchedKey: string | null = null;
        for (const k of Object.keys(texKeyToIdx)) {
          if (k.toLowerCase().includes(lowerBase) || lowerBase.includes(k.toLowerCase())) {
            matchedKey = k;
            break;
          }
        }
        const texIdx = matchedKey != null ? (texKeyToIdx[matchedKey] ?? 0) : 0;
        const f = files.find(
          (ff) => ff.path.endsWith("/" + mn) || ff.path.endsWith("\\" + mn) || ff.path === mn,
        );
        if (f) processModelFile(f, texIdx);
      }
    }
    // 第二轮：处理 models/ 目录下的未匹配模型文件
    for (const f of files) {
      if (!f.path.startsWith("models/")) continue;
      const modelName = f.path.split("/").pop();
      const matched = ysmModelOrder?.some((mp) => {
        const mn = (
          typeof mp === "string"
            ? mp
            : (mp as { path?: string; name?: string })?.path || (mp as { name?: string })?.name || ""
        )
          .split("/")
          .pop();
        return mn === modelName;
      });
      if (!matched) processModelFile(f, 0);
    }

    // 无 ysm.json → WASM 无法确定纹理映射，交 Go 处理（有启发式匹配）
    if (!geometry && !ysmMeta) {
      console.log("[YSM] 无 ysm.json 引导，移交 Go 确保纹理正确映射");
      cacheSet(modelPath, { _wasmFailed: true });
      return null;
    }

    if (!geometry && files?.length > 0) {
      console.log(`[YSM] ⚠️ WASM 解码成功但几何体解析为空，回退 Go CLI`);
      cacheSet(modelPath, { _wasmFailed: true });
      return null;
    }

    // TS 不追踪 processModelFile 闭包内的赋值，geometry 在 if 处被收窄为 never——
    // 用局部变量绕过（运行时语义不变）
    const geo = geometry as BedrockGeometry | null;
    if (geo) {
      geo.bones = allBones;
      geo.textures = orderedTexKeys.map((k) => textures[k]).filter(Boolean);
      geo.texture = orderedTexKeys.length > 0 ? textures[orderedTexKeys[0]] : null;
      if (maxTexW > geo.texWidth) geo.texWidth = maxTexW;
      if (maxTexH > geo.texHeight) geo.texHeight = maxTexH;
      geo._texMappingLog = texMappingLog;
    }

    // 解析动画
    const animations: unknown[] = [];
    for (const f of files) {
      if (!f.path.startsWith("animations/") || !f.path.endsWith(".json")) continue;
      devLog(`[YSM] 动画 ${f.path}...`);
      try {
        const jsonStr = new TextDecoder().decode(f.data);
        const { clips } = parseBedrockAnimationJSON(jsonStr);
        if (clips.length > 0) animations.push(...clips);
      } catch (e) {
        devLog(`[YSM] ❌ ${f.path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const texUrl =
      (geometry as BedrockGeometry | null)?.texture ||
      (orderedTexKeys.length > 0 ? textures[orderedTexKeys[0]] : null) ||
      null;
    const result: DecodedYsm = {
      texture: texUrl,
      geometry,
      animations,
      avatars,
      authors: ysmAuthors,
    };
    cacheSet(modelPath, { ...result, _decodedBy: "🧠 WASM 内置解码" });
    return result;
  } catch (e) {
    devLog(`[YSM] ❌ ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** 直接解析纯 JSON 格式的 ysm.json（解压后的 YSM 模型文件） */
function parseYsmJsonDirect(json: unknown): DecodedYsm | null {
  const obj = json as {
    spec?: unknown;
    files?: { player?: { model?: unknown; texture?: unknown } };
    metadata?: { authors?: Array<{ name?: string; role?: string; avatar?: string }> };
    properties?: { texture_width?: number; texture_height?: number; default_texture?: string | null };
    minecraft?: { geometry?: unknown[] };
    geometry?: { model?: unknown };
  };
  // ysm.json 格式（spec/metadata/files）
  if (obj?.spec !== undefined && obj?.files) {
    // 从 files.player.model 提取 geometry 信息
    const playerFiles = obj.files?.player;
    if (!playerFiles) return null;
    const modelFiles = Array.isArray(playerFiles.model)
      ? playerFiles.model
      : playerFiles.model
        ? [playerFiles.model]
        : [];
    const texFiles = Array.isArray(playerFiles.texture)
      ? playerFiles.texture
      : playerFiles.texture
        ? [playerFiles.texture]
        : [];
    // ysm.json 本身不含 geometry 数据（geometry 在 separate model json 中）
    // 返回一个占位 geometry，让后续的 Go AnalyzeBedrockModel 处理
    // 解析作者信息（用于头像显示）
    const authors = (obj?.metadata?.authors || [])
      .filter((a) => a.name)
      .map((a) => ({
        name: a.name as string,
        role: a.role || "",
        avatarUrl: null,
        avatarPath: a.avatar || "",
      }));
    return {
      texture: null,
      geometry: {
        bones: [],
        boneCount: 0,
        cubeCount: 0,
        texWidth: obj.properties?.texture_width || 64,
        texHeight: obj.properties?.texture_height || 64,
        textures: [],
        _ysmMeta: {
          modelFiles,
          texFiles,
          defaultTexture: obj.properties?.default_texture || null,
        },
      },
      animations: [],
      authors,
    };
  }

  // 标准 Bedrock geometry 格式（minecraft.geometry）
  const root = (obj?.minecraft?.geometry?.[0] || obj?.geometry?.model || obj) as {
    description?: { texture_width?: number; texture_height?: number };
    bones?: Array<{
      name?: string;
      pivot?: number[];
      parent?: string;
      rotation?: number[];
      cubes?: Array<{
        origin?: number[];
        size?: number[];
        pivot?: number[];
        rotation?: number[];
        uv?: number[];
        inflate?: number;
        mirror?: boolean;
      }>;
    }>;
  };
  const desc = root?.description || {};
  const texW = desc.texture_width || 64;
  const texH = desc.texture_height || 64;
  const bones = (root?.bones || []).map((b) => ({
    name: b.name || "",
    pivot: b.pivot || [0, 0, 0],
    parent: b.parent || "",
    rotation: b.rotation || [0, 0, 0],
    cubes: (b.cubes || []).map((c) => ({
      origin: c.origin || [0, 0, 0],
      size: c.size || [0, 0, 0],
      pivot: c.pivot || [0, 0, 0],
      rotation: c.rotation || [0, 0, 0],
      uv: c.uv || [0, 0],
      faceUV: "",
      texSlot: 0,
      inflate: c.inflate || 0,
      mirror: !!c.mirror,
    })),
  }));
  if (!bones.length) return null;
  return {
    texture: null,
    geometry: {
      bones,
      boneCount: bones.length,
      cubeCount: 0,
      texWidth: texW,
      texHeight: texH,
      textures: [],
    },
    animations: [],
  };
}
