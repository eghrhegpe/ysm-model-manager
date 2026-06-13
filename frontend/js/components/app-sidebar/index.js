// ===== <app-sidebar> 入口 =====
import { bus } from "../../bus.js";
import { sidebarCSS } from "./sidebar-css.js";
import {
  headerHTML,
  footerHTML,
  listContainerHTML,
  vcHeaderHTML,
} from "./tpl.js";
import { renderVersionCards } from "./render.js";
import { bindCardEvents, bindFooter } from "./events.js";
import { bindInstanceActions } from "./actions.js";
import { loadInstances } from "./loader.js";

class AppSidebar extends HTMLElement {
  static get observedAttributes() {
    return ["rtype"];
  }

  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._root.adoptedStyleSheets = [new CSSStyleSheet()];
    this._root.adoptedStyleSheets[0].replaceSync(sidebarCSS);
    this._instances = [];
    this._unsubs = [];
    this._rtype = this.getAttribute("rtype") || "ysm";
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (name === "rtype" && oldVal !== newVal && newVal) {
      this._rtype = newVal;
      this._reload();
      // 更新导入按钮文字
      const btn = this._root.querySelector(".sidebar-import-all");
      if (btn) {
        const labels = {
          ysm: "模型",
          "mmd-skin": "MMD",
          "vrchat-avatar": "VRC",
          resourcepack: "材质包",
          shaderpack: "光影包",
          "create-blueprint": "蓝图",
        };
        btn.textContent = "⬇️ 一键安装" + (labels[this._rtype] || "资源");
      }
    }
  }

  async connectedCallback() {
    this._renderLayout();

    // 监听刷新事件
    this._unsubs.push(
      bus.on("stats:refresh", async () => {
        await this._reload();
      }),
    );

    // 监听 sync-manager 的类型切换（只更新卡片数字，不刷新列表）
    this._unsubs.push(
      bus.on("sidebar:rtype-changed", async ({ rtype }) => {
        this._rtype = rtype || "ysm";
        await this._updateCardStats(this._rtype);
      }),
    );

    // 绑定全选 + 同步所选
    this._bindSelectAll();
    this._bindSyncSelected();

    await this._reload();
  }

  _bindSelectAll() {
    const cb = this._root.getElementById("sb-select-all");
    if (!cb) return;
    cb.addEventListener("change", () => {
      const checked = cb.checked;
      this._root.querySelectorAll(".chk").forEach((c) => (c.checked = checked));
    });
  }

  _bindSyncSelected() {
    const btn = this._root.querySelector(".sidebar-sync-selected");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const selected = [];
      this._root.querySelectorAll(".chk:checked").forEach((c) => {
        const idx = parseInt(c.dataset.idx, 10);
        if (!isNaN(idx) && this._instances[idx])
          selected.push(this._instances[idx].name);
      });
      if (!selected.length) {
        bus.emit("toast:show", {
          msg: "请先勾选要同步的整合包",
          duration: 2000,
          type: "info",
        });
        return;
      }
      btn.textContent = "⏳";
      btn.disabled = true;
      (async () => {
        let totalOk = 0,
          totalFail = 0;
        for (const insName of selected) {
          await new Promise((resolve) => {
            bus.emit("sync:download-missing", {
              instanceName: insName,
              rtype: this._rtype,
            });
            bus.on(
              "sync:download:done",
              () => {
                bus.off("sync:download:done");
                resolve();
              },
              { once: true },
            );
            // 超时兜底
            setTimeout(resolve, 10000);
          });
        }
        btn.textContent = "⬇️ 同步所选";
        btn.disabled = false;
      })();
    });
  }

  _renderCards() {
    const container = this._root.getElementById("vg");
    if (!container) return;
    renderVersionCards(container, this._instances);
    bindCardEvents(this._root, this._instances);
  }

  async _reload() {
    try {
      this._instances = await loadInstances(this._rtype);
    } catch (_) {
      this._instances = [];
    }

    this._renderCards();
    bindFooter(this._root, this._instances);
  }

  /** 只更新卡片数字和底部统计，不重建列表 */
  async _updateCardStats(rtype) {
    const newData = await loadInstances(rtype).catch(() => []);
    if (!newData.length) return;
    // 就地更新每张卡片的头部 HTML（用 name 匹配，不依赖索引顺序）
    const container = this._root.getElementById("vg");
    if (!container) return;
    const vcs = container.querySelectorAll(".vc");
    newData.forEach((ins) => {
      const vc = Array.from(vcs).find(
        (v) =>
          v.querySelector(".name")?.textContent?.replace(/^📦\s*/, "") ===
          ins.name,
      );
      if (!vc) return;
      const oldHdr = vc.querySelector(".vc-header");
      if (!oldHdr) return;
      const idx = parseInt(vc.dataset.idx, 10);
      const newHdrHTML = vcHeaderHTML(
        ins.name,
        ins.synced,
        ins.missing,
        ins.extra,
        ins.status,
        false,
        idx,
        ins.hasMod,
        ins.rtype || rtype,
      );
      oldHdr.outerHTML = newHdrHTML;
    });
    // 更新底部统计
    bindFooter(this._root, newData);
    // 重新绑定卡片内按钮（outerHTML 后事件丢失）
    bindInstanceActions(this._root, newData);
    // 重排卡片顺序匹配 newData 排序
    const container2 = this._root.getElementById("vg");
    if (container2) {
      newData.forEach((ins) => {
        const vc = Array.from(container2.children).find(
          (v) =>
            v.querySelector(".name")?.textContent?.replace(/^📦\s*/, "") ===
            ins.name,
        );
        if (vc) container2.appendChild(vc); // move to end in correct order
      });
    }
    // 更新实例数据引用（供右键菜单等使用）
    this._instances = newData;
  }

  disconnectedCallback() {
    this._unsubs.forEach((fn) => fn());
  }

  _renderLayout() {
    this._root.innerHTML = headerHTML() + listContainerHTML() + footerHTML();
  }
}
customElements.define("app-sidebar", AppSidebar);
