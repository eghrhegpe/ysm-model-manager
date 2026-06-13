// ===== 前端扩展名集中定义 =====
// 与 go/types/extensions.go 和 resource_types.json 保持同步
// 新增扩展名时需同时更新三处

/** 每种资源类型对应的扩展名 */
export const RESOURCE_EXTS = {
  ysm: [".ysm", ".zip", ".7z", ".json"],
  "mmd-skin": [".pmx", ".pmd"],
  "vrchat-avatar": [".vrca", ".vrm"],
  resourcepack: [".zip"],
  shaderpack: [".zip"],
  "create-blueprint": [".nbt", ".schematic"],
};

/** 所有支持的扩展名列表（去重，用于 UI 提示文案） */
export const ALL_EXTS = (() => {
  const seen = new Set();
  const result = [];
  for (const exts of Object.values(RESOURCE_EXTS)) {
    for (const e of exts) {
      if (!seen.has(e)) {
        seen.add(e);
        result.push(e);
      }
    }
  }
  return result;
})();

/** 获取某资源类型支持的扩展名 */
export function getExts(rtype) {
  return RESOURCE_EXTS[rtype] || [];
}

/** 检查扩展名是否被某资源类型支持 */
export function isSupportedExt(ext) {
  return ALL_EXTS.includes(ext.toLowerCase());
}

/** 返回扩展名所属的资源类型 ID */
export function extBelongsTo(ext) {
  const lower = ext.toLowerCase();
  const result = [];
  for (const [rtype, exts] of Object.entries(RESOURCE_EXTS)) {
    if (exts.includes(lower)) result.push(rtype);
  }
  return result;
}
