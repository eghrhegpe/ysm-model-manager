// ===== sidebar 渲染层 =====

import { currentRepoType } from "@/features/repo/repo-rtype.ts";
import { stagger } from "@/utils/animation/stagger.ts";
import type { SidebarInstance } from "./data.ts";
import { emptyInstanceStateHTML, instanceCardHeaderHTML, loadErrorStateHTML } from "./tpl.ts";

// 渲染所有整合包卡片到容器
export function renderVersionCards(container: HTMLElement, instances: SidebarInstance[]): void {
  container.innerHTML = "";
  if (!instances.length) {
    // ADR-190 D1a：HTML 模板归 tpl.ts（本文件只做 DOM 组装与状态分流）
    container.innerHTML = emptyInstanceStateHTML();
    // ADR-308 D2：空态不是 option 列表——摘掉 listbox role（tpl 初始声明），
    // 避免读屏把「无匹配整合包 + 配置按钮」念成空 listbox；有实例时恢复
    container.removeAttribute("role");
    return;
  }
  // ADR-308 D2：结构性 option 角色（交互态 roving tabindex/aria-selected 由 bindRoving 管）；
  // 统一 tabindex=-1——键盘入口唯一性（恰一 tabindex 0）由 _renderCards 尾部 syncIndex 布局保证
  container.setAttribute("role", "listbox");
  // 2026-10 批量插入（与 stagger 封顶同批的「卡卡」收口）：原逐张 appendChild 到**已连接**容器，
  // N 张卡 = N 次 DOM 插入各自的布局失效；改 DocumentFragment 一次落位。
  // ⚠️ 这条是纯机制优化、**可观测行为不变**（卡片数/idx/延迟照旧），故不设机制断言：
  // happy-dom 下两条口径都无区分度（fragment 插入被展开成每子节点一条 childList 记录；
  // 共享 appendChild 致 spy 的 mock.instances 一律记成容器）——勿再花时间补「假锁」。
  const frag = document.createDocumentFragment();
  instances.forEach((ins, idx) => {
    const card = document.createElement("div");
    card.className = "instance-card";
    card.setAttribute("role", "option");
    card.setAttribute("tabindex", "-1");
    card.setAttribute("aria-selected", "false");
    card.dataset.idx = String(idx);
    // P1 修复（2026-10 锐评）：卡片同时携带实例名——拖拽 drop 等**跨渲染**消费者
    // 按名称在最新实例列表里解析目标；数组下标在 sidebar 重载/实例增删后会静默
    // 指向错误的整合包（把模型推进另一个包）。
    card.dataset.name = ins.name;
    // 入场阶梯延迟：走共享原语 stagger()（40ms/张、300ms 封顶）。
    // ⚠️ 不可退回 `idx * 40` 无封顶——`.instance-card` 的 animation 带 `both` 填充，
    // 延迟期间卡片停在 from 态（透明/位移），包多时（MMD 用户常几十个）下半屏要等
    // 一秒以上才出现，且每次 stats:refresh 整列表重建都会重演一次 = 「卡卡」直因；
    // 站点卡片（app-content/site/render.ts）早已用同口径封顶。
    card.style.animationDelay = `${stagger(idx, 40)}ms`;
    card.innerHTML = instanceCardHeaderHTML(
      ins.name,
      ins.synced,
      ins.missing,
      ins.extra,
      idx,
      ins.hasMod,
      ins.rtype || currentRepoType(),
    );
    frag.appendChild(card);
  });
  container.appendChild(frag);
}

/** 加载失败态（P0 修复 2026-10：与空列表态**分流**）。
 *  loader 失败时由 `_reload` 渲染本态——错误文案 + `role=alert` + 重试入口；
 *  **不得**复用 `renderVersionCards([])` 的空态（那会把一次读取失败误导成
 *  「没安装整合包」，用户还会去点配目录按钮查一个不存在的问题）。
 *  重试监听自挂自摘（返回 cleanup）：首帧即失败时 `bindCardEvents` 尚未绑定，
 *  不能依赖其列表事件委托。 */
export function renderLoadError(container: HTMLElement, onRetry: () => void): () => void {
  container.innerHTML = loadErrorStateHTML();
  // ADR-308 D2 同口径：失败态不是 option 列表——摘掉 listbox role，别让读屏把
  // 「加载失败 + 重试」念成空 listbox
  container.removeAttribute("role");
  const btn = container.querySelector("[data-sidebar-retry]") as HTMLElement | null;
  const onClick = (): void => onRetry();
  btn?.addEventListener("click", onClick);
  return () => btn?.removeEventListener("click", onClick);
}
