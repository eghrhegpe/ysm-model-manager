// ===== <app-sidebar> 入口 =====
import { bus } from "../../bus.js";
import { dbg } from "../../utils/debug.js";
import { sidebarCSS } from "./sidebar-css.js";
import { headerHTML, footerHTML, listContainerHTML } from "./tpl.js";
import { renderVersionCards } from "./render.js";
import { bindCardEvents, bindFooter } from "./events.js";
import { loadInstances } from "./loader.js";

// 持久化勾选状态（跨重新渲染保持）
const _checkedSet = new Set();

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
    this._cardCleanup = null; // bindCardEvents 清理函数
    this._docClickHandler = null; // document click 清理
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
          resourcepack: "资源包",
          shaderpack: "光影包",
          "create-blueprint": "蓝图",
          litematic: "投影",
        };
        btn.textContent = "⬇️ 一键安装" + (labels[this._rtype] || "资源");
      }
    }
  }

  async connectedCallback() {
    this._renderLayout();

    // 监听刷新事件（300ms 防抖，防止短时间内多次重载）
    this._unsubs.push(
      bus.on("stats:refresh", () => {
        clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => this._reload(), 300);
      }),
    );

    // 监听全局 subtab 类型切换 → 重新加载该类型的统计
    this._unsubs.push(
      bus.on("repo:rtype-changed", async (rtype) => {
        if (rtype && rtype !== this._rtype) {
          this._rtype = rtype;
          clearTimeout(this._debounceTimer);
          this._debounceTimer = setTimeout(() => this._reload(), 100);
        }
      }),
    );

    // 绑定全选 + 同步所选
    this._bindSelectAll();
    this._bindSyncSelected();

    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._reload(), 50);
  }

  _bindSelectAll() {
    const cb = this._root.getElementById("sb-select-all");
    if (!cb) return;
    cb.addEventListener("change", () => {
      const checked = cb.checked;
      this._root.querySelectorAll(".chk").forEach((c) => {
        c.checked = checked;
        const idx = parseInt(c.dataset.idx, 10);
        if (!isNaN(idx) && this._instances[idx]) {
          if (checked) _checkedSet.add(this._instances[idx].name);
          else _checkedSet.delete(this._instances[idx].name);
        }
      });
    });
  }

  // 渲染后恢复勾选 + 监听新 checkbox
  _restoreCheckboxes() {
    this._root.querySelectorAll(".chk").forEach((c) => {
      const idx = parseInt(c.dataset.idx, 10);
      if (!isNaN(idx) && this._instances[idx]) {
        c.checked = _checkedSet.has(this._instances[idx].name);
        c.addEventListener("change", () => {
          if (c.checked) _checkedSet.add(this._instances[idx].name);
          else _checkedSet.delete(this._instances[idx].name);
        });
      }
    });
  }

  _bindSyncSelected() {
    const pushBtn = this._root.querySelector(".sidebar-push-selected");
    const pushMenu = this._root.getElementById("sidebar-push-menu");
    const pullBtn = this._root.querySelector(".sidebar-pull-selected");
    const pullMenu = this._root.getElementById("sidebar-pull-menu");
    if (!pushBtn || !pushMenu || !pullBtn || !pullMenu) return;

    // 关闭所有下拉菜单
    const closeAllMenus = () => {
      pushMenu.style.display = "none";
      pullMenu.style.display = "none";
    };

    // 点击按钮切换菜单（stopPropagation 防止冒泡到 document 后被 Shadow DOM 边界改写 e.target）
    pushBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasOpen = pushMenu.style.display === "block";
      closeAllMenus();
      if (!wasOpen) pushMenu.style.display = "block";
    });
    pullBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasOpen = pullMenu.style.display === "block";
      closeAllMenus();
      if (!wasOpen) pullMenu.style.display = "block";
    });
    // 菜单内点击也阻止冒泡
    pushMenu.addEventListener("click", (e) => e.stopPropagation());
    pullMenu.addEventListener("click", (e) => e.stopPropagation());
    // 点击其他地方关闭
    this._docClickHandler = () => closeAllMenus();
    document.addEventListener("click", this._docClickHandler);

    const getSelected = () => {
      const sel = [];
      this._root.querySelectorAll(".chk:checked").forEach((c) => {
        const idx = parseInt(c.dataset.idx, 10);
        if (!isNaN(idx) && this._instances[idx])
          sel.push(this._instances[idx].name);
      });
      return sel;
    };

    const allTypes = [
      "ysm", "mmd-skin", "vrchat-avatar",
      "resourcepack", "shaderpack", "create-blueprint", "litematic",
    ];
    const resolveTypes = (t) => (t === "all" ? allTypes : [t]);

    // 推送：emit sync:download:missing
    pushMenu.addEventListener("click", (e) => {
      const item = e.target.closest(".dd-item");
      if (!item) return;
      const selected = getSelected();
      if (!selected.length) {
        bus.emit("toast:show", { msg: "请先勾选要推送的整合包", duration: 2000, type: "info" });
        return;
      }
      closeAllMenus();
      pushBtn.textContent = "⏳";
      pushBtn.disabled = true;
      (async () => {
        for (const insName of selected) {
          for (const rt of resolveTypes(item.dataset.syncType)) {
            await new Promise((resolve) => {
              bus.emit("sync:download:missing", { instanceName: insName, rtype: rt });
              bus.on("sync:download:done", resolve, { once: true });
              setTimeout(resolve, 10000);
            });
          }
        }
        pushBtn.textContent = "⬆️ 推送所选 ▾";
        pushBtn.disabled = false;
      })();
    });

    // 拉取：调用 PullResourceFromInstance
    pullMenu.addEventListener("click", async (e) => {
      const item = e.target.closest(".dd-item");
      if (!item) return;
      const selected = getSelected();
      if (!selected.length) {
        bus.emit("toast:show", { msg: "请先勾选要拉取的整合包", duration: 2000, type: "info" });
        return;
      }
      closeAllMenus();
      pullBtn.textContent = "⏳";
      pullBtn.disabled = true;
      let totalPulled = 0;
      try {
        const { PullResourceFromInstance } = await import("../../../wailsjs/go/main/App.js");
        for (const insName of selected) {
          for (const rt of resolveTypes(item.dataset.syncType)) {
            const n = await PullResourceFromInstance(rt, insName);
            totalPulled += n;
          }
        }
        if (totalPulled > 0) {
          bus.emit("toast:show", { msg: `✅ 拉取完成，共 ${totalPulled} 个文件`, duration: 2500 });
        } else {
          bus.emit("toast:show", { msg: "📭 没有可拉取的文件（实例中无多余资源）", duration: 2500, type: "info" });
        }
        bus.emit("stats:refresh");
        bus.emit("tree:reload");
      } catch (e) {
        bus.emit("toast:show", { msg: "❌ 拉取失败: " + (e?.message || e), duration: 3000, type: "error" });
      }
      pullBtn.textContent = "⬇️ 拉取所选 ▾";
      pullBtn.disabled = false;
    });
  }

  _renderCards() {
    const container = this._root.getElementById("vg");
    if (!container) return;
    renderVersionCards(container, this._instances);
    // 先清理旧的事件监听，再绑定新的（防止重复累积）
    if (this._cardCleanup) {
      this._cardCleanup();
      this._cardCleanup = null;
    }
    this._cardCleanup = bindCardEvents(this._root, this._instances);
    this._restoreCheckboxes();
  }

  async _reload() {
    if (this._loading) return;
    this._loading = true;
    try {
      this._instances = await loadInstances(this._rtype);
      dbg(
        "sidebar",
        "_reload 完成, 实例数:",
        this._instances.length,
        "rtype:",
        this._rtype,
        "首个:",
        this._instances[0]
          ? {
              name: this._instances[0].name,
              synced: this._instances[0].synced,
              missing: this._instances[0].missing,
            }
          : "无",
      );
    } catch (e) {
      dbg("sidebar", "_reload 失败:", e);
      this._instances = [];
    } finally {
      this._loading = false;
    }
    this._renderCards();
    bindFooter(this._root, this._instances);
  }

  disconnectedCallback() {
    this._unsubs.forEach((fn) => fn());
    // 清理 DOM 事件监听
    if (this._cardCleanup) {
      this._cardCleanup();
      this._cardCleanup = null;
    }
    if (this._docClickHandler) {
      document.removeEventListener("click", this._docClickHandler);
      this._docClickHandler = null;
    }
  }

  _renderLayout() {
    this._root.innerHTML = headerHTML() + listContainerHTML() + footerHTML();
  }
}
customElements.define("app-sidebar", AppSidebar);
