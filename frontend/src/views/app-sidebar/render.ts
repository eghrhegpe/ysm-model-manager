// ===== sidebar 渲染层 =====

import { t } from "@/core/i18n/t.ts";
import { currentRepoType } from "@/features/repo/repo-rtype.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import type { SidebarInstance } from "./data.ts";
import { instanceCardHeaderHTML } from "./tpl.ts";

// 渲染所有整合包卡片到容器
export function renderVersionCards(container: HTMLElement, instances: SidebarInstance[]): void {
  container.innerHTML = "";
  if (!instances.length) {
    // 空态就地配 mcRoot：自动搜索覆盖标准布局，HMCL/PCL 检测覆盖分离实例目录
    // （原设置页「🎮 HMCL / PCL」按钮搬家至此，用户在哪遇到问题就在哪解决）
    container.innerHTML = `
      <div class="ws-empty" style="padding:var(--sp-5);text-align:center">${UI_ICONS.inboxEmpty} ${t("sidebar.noMatchInstances")}
        <div style="margin-top:12px;display:flex;gap:6px;justify-content:center">
          <button class="btn-base sm" data-sidebar-mc-search>${UI_ICONS.search} ${t("settings.paths.autoSearch")}</button>
          <button class="btn-base sm" data-sidebar-launcher-detect>${UI_ICONS.game} HMCL / PCL</button>
        </div>
      </div>`;
    // ADR-308 D2：空态不是 option 列表——摘掉 listbox role（tpl 初始声明），
    // 避免读屏把「无匹配整合包 + 配置按钮」念成空 listbox；有实例时恢复
    container.removeAttribute("role");
    return;
  }
  // ADR-308 D2：结构性 option 角色（交互态 roving tabindex/aria-selected 由 bindRoving 管）；
  // 统一 tabindex=-1——键盘入口唯一性（恰一 tabindex 0）由 _renderCards 尾部 syncIndex 布局保证
  container.setAttribute("role", "listbox");
  instances.forEach((ins, idx) => {
    const card = document.createElement("div");
    card.className = "instance-card";
    card.setAttribute("role", "option");
    card.setAttribute("tabindex", "-1");
    card.setAttribute("aria-selected", "false");
    card.dataset.idx = String(idx);
    card.style.animationDelay = `${idx * 40}ms`;
    card.innerHTML = instanceCardHeaderHTML(
      ins.name,
      ins.synced,
      ins.missing,
      ins.extra,
      ins.status,
      idx,
      ins.hasMod,
      ins.rtype || currentRepoType(),
    );
    container.appendChild(card);
  });
}
