// ===== sidebar 渲染层 =====
import { instanceCardHeaderHTML } from "./tpl.ts";
import type { SidebarInstance } from "./data.ts";
import { t } from "../../core/i18n/t.ts";
import { currentRepoType } from "../../features/repo-rtype.ts";

// 渲染所有整合包卡片到容器
export function renderVersionCards(
  container: HTMLElement,
  instances: SidebarInstance[],
): void {
  container.innerHTML = "";
  if (!instances.length) {
    // 空态就地配 mcRoot：自动搜索覆盖标准布局，HMCL/PCL 检测覆盖分离实例目录
    // （原设置页「🎮 HMCL / PCL」按钮搬家至此，用户在哪遇到问题就在哪解决）
    container.innerHTML = `
      <div class="ws-empty" style="padding:24px;text-align:center">🔍 ${t("sidebar.noMatchInstances")}
        <div style="margin-top:12px;display:flex;gap:6px;justify-content:center">
          <button class="btn-base sm" data-sidebar-mc-search>🔍 ${t("settings.paths.autoSearch")}</button>
          <button class="btn-base sm" data-sidebar-launcher-detect>🎮 HMCL / PCL</button>
        </div>
      </div>`;
    return;
  }
  instances.forEach((ins, idx) => {
    const card = document.createElement("div");
    card.className = "instance-card";
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
