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
        faceUV = JSON.stringify(c.uv);
      }
      cubes.push({
        origin: c.origin || [0, 0, 0],
        size: c.size || [1, 1, 1],
        pivot: c.pivot || [0, 0, 0],
        uv,
        faceUV,
      });
    }
    bones.push({
      name: b.name,
      parent: b.parent || null,
      pivot: b.pivot || [0, 0, 0],
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
