// ===== 测试自愈工具（test-utils/self-healing）=====
// 菜单表 = 单一事实来源时，测试不应硬编码期望值——菜单表增删项就应自动通过。
// 三个自愈函数：至少包含 / 反向不包含 / 从菜单项推导数据选择器。
// 所有函数依赖 vitest 的 expect，仅测试上下文使用。
import { expect } from "vitest";

/** 形如菜单项的定义（至少有 id；可选 dockGroup） */
export type MenuDefLike = { id: string; dockGroup?: string };

/**
 * 自愈断言：actual 至少包含 required（允许额外项）。
 * 用于菜单表增删项的场景：required 是"必须有的骨干项"，actual 可多可少。
 * @param actual  实际 id 列表
 * @param required 必需 id 列表
 * @param label   断言标识（失败时输出）
 */
export function expectContainsAtLeast(actual: string[], required: string[], label: string): void {
  const missing = required.filter((r) => !actual.includes(r));
  expect(missing, `${label} 缺必需项: ${missing.join(", ")}; 实际=${actual.join(",")}`).toEqual([]);
}

/**
 * 反向自愈断言：actual 不包含 forbidden。
 * 用于条件注入的反向校验（如无 VMD 应无 play 项）。
 * @param actual   实际 id 列表
 * @param forbidden 不应出现的 id 列表
 * @param label    断言标识
 */
export function expectNotContains(actual: string[], forbidden: string[], label: string): void {
  const present = actual.filter((a) => forbidden.includes(a));
  expect(present, `${label} 应不含: ${present.join(", ")}`).toEqual([]);
}

/**
 * 从菜单项推导 data-testid 选择器（`preview-${id}`）。
 * 菜单表 id 变更时选择器自动对齐，不再硬编码字符串数组。
 */
export function deriveTestIds<T extends MenuDefLike>(items: T[]): string[] {
  return items.map((d) => `preview-${d.id}`);
}

/**
 * 从菜单项列表提取 id 数组（已排序）。
 * 用于结构断言中"至少包含"的比较源。
 */
export function extractIds<T extends MenuDefLike>(items: T[]): string[] {
  return items.map((d) => d.id).sort();
}
