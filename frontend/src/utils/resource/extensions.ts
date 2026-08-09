// ===== 前端扩展名集中定义（类型化版 — ADR-014 P2）=====
// 静态默认值（拖拽等同步场景必须）
// 事实来源: resource_types.json（单一事实源，AGENTS.md 注册表优先）
// Go 端运行时直读 JSON（无静态 ResourceExts 表，go/types/extensions.go 全注册表驱动）
// 前端↔JSON 一致性由 extensions.test.ts 双向对账守护（P2 修复，替代外部 type-consistency 退出码陷阱）
// 修改扩展名两步走: 1) 改 resource_types.json → 2) 改此处（P3 修复：原注释声称
// 「改 Go 侧 ResourceExts」三步流程，但 Go 侧无此符号，属误导——Go 运行时直读 JSON 无需手工改）

/** 每种资源类型对应的扩展名 */
export const RESOURCE_EXTS: Record<string, string[]> = {
  ysm: [".ysm", ".zip", ".7z", ".json"],
  "mmd-skin": [".pmx", ".pmd"],
  "vrchat-avatar": [".vrca", ".vrm"],
  resourcepack: [".zip"],
  shaderpack: [".zip"],
  "create-blueprint": [".nbt", ".schematic"],
  litematic: [".litematic"],
};

/** 所有支持的扩展名列表（去重，用于 UI 提示文案） */
export const ALL_EXTS: string[] = (() => {
  const seen = new Set<string>();
  const result: string[] = [];
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
export function getExts(rtype: string): string[] {
  return RESOURCE_EXTS[rtype] || [];
}

/** 检查扩展名是否被某资源类型支持 */
export function isSupportedExt(ext: string): boolean {
  return ALL_EXTS.includes(ext.toLowerCase());
}

/** 返回扩展名所属的资源类型 ID */
export function extBelongsTo(ext: string): string[] {
  const lower = ext.toLowerCase();
  const result: string[] = [];
  for (const [rtype, exts] of Object.entries(RESOURCE_EXTS)) {
    if (exts.includes(lower)) result.push(rtype);
  }
  return result;
}
