// ===== preview 工具函数（纯函数，无组件依赖） =====

export const DEFAULT_STATS = { repo: 0, ver: 0, ok: 0, tot: 0, pending: 0 };

/** 从 JSON 字符串解析 Bedrock geometry */
export function parseBedrockGeometryFromJSON(jsonStr) {
  const raw = JSON.parse(jsonStr);
  const geo = raw?.["minecraft:geometry"]?.[0];
  if (!geo?.bones?.length) return null;
  const bones = [];
  let cubeCount = 0;
  for (const b of geo.bones) {
    const cubes = [];
    for (const c of b.cubes || []) {
      let uv = [0, 0];
      let faceUV = "";
      if (Array.isArray(c.uv)) {
        uv = c.uv;
      } else if (typeof c.uv === "string" && c.uv.startsWith("{")) {
        faceUV = c.uv;
      } else if (typeof c.uv === "object" && c.uv !== null) {
        // 某些模型 UV 是对象格式（如 {uv:[0,0], uv_size:[16,16]}）
        // 优先取内层 uv 数组作为 expandBoxUV
        if (Array.isArray(c.uv.uv)) {
          uv = c.uv.uv;
        }
        faceUV = JSON.stringify(c.uv);
      }
      // 每个方块可指定纹理槽索引（YSMViewer 据此区分主纹理与发光/覆盖层）
      const texSlot = typeof c.texture === "number" ? c.texture : 0;
      // 统一对象→数组格式（某些导出工具输出 {x,y,z} 对象而非数组）
      const toArr = (v) => {
        if (!v) return [0, 0, 0];
        if (Array.isArray(v)) return v;
        if (typeof v === "object") return [v.x || 0, v.y || 0, v.z || 0];
        return [0, 0, 0];
      };
      cubes.push({
        origin: toArr(c.origin),
        size: toArr(c.size),
        pivot: toArr(c.pivot),
        rotation: toArr(c.rotation),
        uv,
        faceUV,
        texSlot,
      });
    }
    // pivot 统一为数组格式（某些导出工具输出 {x,y,z} 对象）
    let pivot = b.pivot;
    if (pivot && !Array.isArray(pivot) && typeof pivot === "object") {
      pivot = [pivot.x || 0, pivot.y || 0, pivot.z || 0];
    }
    bones.push({
      name: b.name,
      parent: b.parent || null,
      pivot: pivot || [0, 0, 0],
      rotation: b.rotation || [0, 0, 0],
      cubes,
    });
    cubeCount += cubes.length;
  }
  return {
    boneCount: bones.length,
    cubeCount,
    texWidth: geo.description?.texture_width || 0,
    texHeight: geo.description?.texture_height || 0,
    bones,
  };
}
