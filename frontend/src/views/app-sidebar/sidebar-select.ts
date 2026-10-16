// ===== app-sidebar 勾选状态持久化（sync-flow.ts 拆分出，锐评 P1-2）=====
// 原 sync-flow.ts 同时承担「勾选持久化 / 下拉控制器 / push 编排 / pull 编排 / 结果浮层 /
// 按钮 loading」6 类职责，测试要 mock 六种子系统。本模块只留勾选集合读写 + 按 data-name
// 解析实例名，供 bindSelectAll / pruneCheckedSets / restoreCheckboxes / getSelected 共用。

import { logWarn } from "@/utils/base/primitives/log.ts";
import type { SidebarInstance } from "./data.ts";

// 持久化勾选状态（跨重新渲染保持），按 rtype 隔离避免类型切换串扰
// 通过 getter 注入实例属性，生命周期随组件（见 sync.test.ts）
function checkedSetFor(rtype: string, getCheckedSets: () => Map<string, Set<string>>): Set<string> {
  const checkedSets = getCheckedSets();
  let s = checkedSets.get(rtype);
  if (!s) {
    s = new Set<string>();
    checkedSets.set(rtype, s);
  }
  return s;
}

/** P0 修复（2026-10-16 锐评）：从勾选框解析实例名——**一律按 data-name 从 DOM 读**，
 *  禁用 data-idx 回查实例数组。stats:refresh 重渲染后 data-idx 会与 `_instances` 快照错位
 *  （实例增删后未 reload 的窗口），下标会把 B 包文件推到 A 包；与 `render.ts:38` 的
 *  `card.dataset.name`、`pack-dnd.ts` 按 data-name 解析（历史「拖拽指向错误包」修复）同口径。 */
export function instanceNameOf(cb: Element): string | null {
  return cb.closest("[data-name]")?.getAttribute("data-name") ?? null;
}

/** 读回当前勾选的实例名（按 data-name，与 bindSelectAll / restoreCheckboxes 同口径） */
export function getSelected(root: ShadowRoot, instances: SidebarInstance[]): string[] {
  const sel: string[] = [];
  const live = new Set(instances.map((i) => i.name));
  root.querySelectorAll(".chk:checked").forEach((c) => {
    const input = c as HTMLInputElement;
    const name = instanceNameOf(c);
    // 名字不在最新实例列表 → 卡片已失效（增删后未 reload），不静默推送，避免误装
    if (!name || !live.has(name)) {
      logWarn("sync-flow", "getSelected: 勾选项未命中实例名，跳过", { idx: input.dataset.idx });
      return;
    }
    sel.push(name);
  });
  return sel;
}

// ---------- bindSelectAll ----------
/**
 * 全选勾选框绑定（**只在 connectedCallback 绑一次**，故两个随渲染变化的值必须以
 * getter 注入而非按值捕获——2026-10 修复「全选跨 reload 蒸发」：原实现按值收
 * `rtype`/`instances`，绑定点在 connectedCallback，彼时 `_instances` 还是初始 `[]`，
 * 而 `_reload` 换的是**新数组引用**，捕获的旧引用永远是空数组 → `instances[idx]`
 * 恒 undefined → 全选只改 DOM、从未写入勾选集合，任何一次 reload 后选择即丢；
 * `rtype` 同理：按值捕获会在切换类型后把勾选写进旧类型的集合）。
 */
export function bindSelectAll(
  root: ShadowRoot,
  getRtype: () => string,
  getInstances: () => SidebarInstance[],
  getCheckedSets: () => Map<string, Set<string>>,
): void {
  const cb = root.getElementById("sb-select-all") as HTMLInputElement | null;
  if (!cb) return;
  cb.addEventListener("change", () => {
    const checked = cb.checked;
    const instances = getInstances();
    const set = checkedSetFor(getRtype(), getCheckedSets);
    const live = new Set(instances.map((i) => i.name));
    root.querySelectorAll(".chk").forEach((c) => {
      const input = c as HTMLInputElement;
      input.checked = checked;
      // P0 修复（2026-10-16 锐评）：按 data-name 解析，与 getSelected/restoreCheckboxes 同口径
      const name = instanceNameOf(c);
      if (!name || !live.has(name)) return;
      if (checked) set.add(name);
      else set.delete(name);
    });
  });
}

// ---------- pruneCheckedSets ----------
/** 修剪勾选集合里的**幽灵名**（P1 修复 2026-10 锐评）：集合按 rtype 存实例名，
 *  实例被删除后名字永远留在集合里——同名实例再现时会被静默勾选，集合也只涨不消。
 *  每次成功 reload 后按最新实例列表修剪。
 *  ⚠️ 保守口径：空列表**不修剪**——`loadInstances` 在 mcRoot 未配置时也返回 []，
 *  那不是「实例全被删了」，剪掉会丢用户的选择（失败态另有 renderLoadError 分流，
 *  根本不走到这里）。 */
export function pruneCheckedSets(
  rtype: string,
  instances: SidebarInstance[],
  getCheckedSets: () => Map<string, Set<string>>,
): void {
  const set = getCheckedSets().get(rtype);
  if (!set || set.size === 0) return;
  if (!instances.length) return;
  const live = new Set(instances.map((i) => i.name));
  set.forEach((name) => {
    if (!live.has(name)) set.delete(name);
  });
}

// ---------- restoreCheckboxes ----------
export function restoreCheckboxes(
  root: ShadowRoot,
  rtype: string,
  instances: SidebarInstance[],
  getCheckedSets: () => Map<string, Set<string>>,
): void {
  const set = checkedSetFor(rtype, getCheckedSets);
  // P0 修复（2026-10-16 锐评）：按 data-name 解析实例名（禁 data-idx 回查数组），
  // change 监听用绑定时刻的名字字符串，与 getSelected/bindSelectAll 同口径
  const live = new Set(instances.map((i) => i.name));
  root.querySelectorAll(".chk").forEach((c) => {
    const input = c as HTMLInputElement;
    const name = instanceNameOf(c);
    if (!name || !live.has(name)) return;
    input.checked = set.has(name);
    input.addEventListener("change", () => {
      if (input.checked) set.add(name);
      else set.delete(name);
    });
  });
}
