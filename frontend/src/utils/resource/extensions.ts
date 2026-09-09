// ===== 前端扩展名集中定义（类型化版 — ADR-014 P2）=====
// 静态默认值（拖拽等同步场景必须）
// 事实来源: resource_types.json（单一事实源，AGENTS.md 注册表优先）
// RESOURCE_EXTS 统一消费 schema.ts 的 allResourceTypes 派生（vite 构建期内联进 bundle，
// 运行时零外置依赖），消灭手写副本漂移；Go 端运行时直读 JSON（无静态 ResourceExts 表，
// go/types/extensions.go 全注册表驱动）。extensions.test.ts 双向对账保留作回归守护。
import { allResourceTypes, type ResourceType } from "./schema.ts";

/** 自定义类型守卫：仅收窄 extensions 为 string[] 的条目（as 断言的可验证替代） */
function hasExtensions(t: ResourceType): t is ResourceType & { extensions: string[] } {
  return Array.isArray(t.extensions) && t.extensions.every((e) => typeof e === "string");
}

/** 每种资源类型对应的扩展名（从 resource_types.json 派生，单一事实来源） */
export const RESOURCE_EXTS: Record<string, string[]> = Object.fromEntries(
  allResourceTypes
    .filter(hasExtensions)
    .map((t) => [t.id, t.extensions.map((e) => e.toLowerCase())]),
);

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
