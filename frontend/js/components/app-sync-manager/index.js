// ===== 整合包同步管理器 =====
// 展示整合包内所有资源类型的同步状态（扁平列表，一次加载，前端过滤）
// 使用: <app-sync-manager instance="1.20.1-Fabric"></app-sync-manager>

import { bus } from "../../bus.js";
import { friendlyError } from "../../utils/errors.js";
import {
  containerHTML,
  summaryHTML,
  itemHTML,
  statusTabHTML,
  emptyHTML,
  loadingHTML,
} from "./tpl.js";

const ESC = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// 跨实例记住上次选中的类型（整合包间共享）
let _lastSelectedType = "ysm";

export class AppSyncManager extends HTMLElement {
  static get observedAttributes() {
    return ["instance", "default-type"];
  }

  constructor() {
    super();
    this._instance = "";
    this._defaultType = "ysm";
    this._allItems = [];
    this._filteredItems = [];
    this._selectedType = "ysm";
    this._statusFilter = "all";
    this._typeConfig = [];
    this._loading = false;
    this._pusher = null;
  }

  connectedCallback() {
    this._instance = this.getAttribute("instance") || "";
    this._defaultType = this.getAttribute("default-type") || "ysm";
    this._selectedType = _lastSelectedType || this._defaultType;
    if (!this._instance) {
      this.innerHTML =
        '<div style="padding:12px;color:var(--err)">⚠️ 未指定整合包</div>';
      return;
    }
    this._init();
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (oldVal === newVal || !this.isConnected) return;
    if (name === "instance") {
      this._instance = newVal || "";
      if (this._instance) this._init();
    } else if (name === "default-type") {
      this._defaultType = newVal || "ysm";
    }
  }

  async _init() {
    this._loading = true;
    this.innerHTML = containerHTML() + loadingHTML();

    await this._loadTypeConfig();
    await this._loadData();

    this._loading = false;
    try {
      this._render();
    } catch (e) {
      console.error("[sync-manager] _render 出错:", e);
      // 保留加载界面不消失也至少显示错误提示
      this.innerHTML +=
        '<div style="padding:12px;color:var(--err)">渲染失败: ' +
        ESC(String(e)) +
        "</div>";
    }

    // 监听刷新
    const unsub = bus.on("stats:refresh", () => {
      console.log("[sync-manager] stats:refresh 收到");
      this._loadData().then(() => {
        console.log(
          "[sync-manager] _loadData 完成, items:",
          this._allItems ? this._allItems.length : 0,
        );
        if (this._allItems && this._allItems.length) {
          const counts = {};
          this._allItems.forEach((i) => {
            counts[i.status] = (counts[i.status] || 0) + 1;
          });
          console.log("[sync-manager] 重渲染, 计数:", counts);
          this._render();
        }
      });
    });
    this._unsubs = this._unsubs || [];
    this._unsubs.push(unsub);
  }

  disconnectedCallback() {
    if (this._unsubs) this._unsubs.forEach((fn) => fn());
  }

  async _loadTypeConfig() {
    const { LoadResourceTypes } =
      await import("../../../wailsjs/go/main/App.js");
    try {
      const raw = await LoadResourceTypes();
      const parsed = JSON.parse(raw);
      this._typeConfig = parsed.resourceTypes || [];
    } catch {
      this._typeConfig = [];
    }
  }

  async _loadData() {
    const { GetInstanceSyncStatus } =
      await import("../../../wailsjs/go/main/App.js");
    try {
      const json = await GetInstanceSyncStatus(this._instance);
      this._allItems = JSON.parse(json) || [];
    } catch {
      this._allItems = [];
    }
  }

  _render() {
    try {
      this.innerHTML = containerHTML();
    } catch (e) {
      console.error("[sync-manager] _render 设置 innerHTML 失败:", e);
      return;
    }

    const modelTypes = ["ysm", "mmd-skin", "vrchat-avatar"];
    const resourceTypes = ["resourcepack", "shaderpack", "create-blueprint"];
    const shortLabel = {
      ysm: "YSM",
      "mmd-skin": "MMD",
      "vrchat-avatar": "VRC",
      resourcepack: "材质包",
      shaderpack: "光影包",
      "create-blueprint": "蓝图",
    };

    const tabsEl = this.querySelector(".sm-tabs");
    const statusTabsEl = this.querySelector(".sm-status-tabs");
    const summaryEl = this.querySelector(".sm-summary");
    const listEl = this.querySelector(".sm-list");
    if (!tabsEl || !statusTabsEl || !summaryEl || !listEl) {
      console.warn("[sync-manager] _render DOM 查询失败, 放弃渲染");
      return;
    }

    // — 类型统计 —
    const typeCounts = {};
    for (const t of this._typeConfig) {
      typeCounts[t.id] = {
        synced: 0,
        missing: 0,
        disabled: 0,
        optional: 0,
        legacy: 0,
        total: 0,
      };
    }
    for (const item of this._allItems) {
      const c = typeCounts[item.type];
      if (c) {
        c[item.status]++;
        c.total++;
      }
    }
    const globalCounts = {
      synced: 0,
      missing: 0,
      disabled: 0,
      optional: 0,
      legacy: 0,
    };
    for (const item of this._allItems) globalCounts[item.status]++;

    // — 类型标签（分组：模型类 | 资源类）—
    const renderGroup = (types, sep) => {
      let html = "";
      for (const id of types) {
        const t = this._typeConfig.find((c) => c.id === id);
        if (!t) continue;
        const c = typeCounts[id];
        const count = c ? c.total : 0;
        const active = this._selectedType === id;
        html +=
          '<button class="sm-tab' +
          (active ? " active" : "") +
          '" data-type="' +
          id +
          '" style="padding:var(--pad-tab) 14px;border-radius:5px 5px 0 0;border:none;background:' +
          (active ? "var(--surf)" : "transparent") +
          ";color:" +
          (active ? "var(--accent)" : "var(--muted)") +
          ';cursor:pointer;font-family:inherit;font-size:var(--fs-tab);white-space:nowrap">' +
          (t.icon || "📦") +
          " " +
          (shortLabel[id] || t.name) +
          (count > 0
            ? ' <span style="font-size:var(--fs-xs);opacity:0.7">' +
              "(" +
              count +
              ")</span>"
            : "") +
          "</button>";
      }
      if (sep) html += '<span style="color:var(--bd);padding:0 2px">│</span>';
      return html;
    };
    tabsEl.innerHTML =
      renderGroup(modelTypes, true) + renderGroup(resourceTypes, false);

    // — 状态筛选标签 —
    const curCounts = this._selectedType
      ? typeCounts[this._selectedType] || globalCounts
      : globalCounts;
    const statusDefs = [
      [
        "all",
        "📊 全部",
        this._selectedType ? curCounts.total || 0 : this._allItems.length,
      ],
      ["synced", "✅ 已同步", curCounts.synced || 0],
      ["missing", "⬇️ 待推送", curCounts.missing || 0],
      ["disabled", "⛔ 已禁用", curCounts.disabled || 0],
      ["optional", "📤 可拉取", curCounts.optional || 0],
      ["legacy", "🔗 旧仓库遗留", curCounts.legacy || 0],
    ];
    statusTabsEl.innerHTML = statusDefs
      .map(([id, label, count]) =>
        statusTabHTML(id, label, count, this._statusFilter === id),
      )
      .join("");

    // — 摘要 —
    summaryEl.innerHTML = summaryHTML({
      synced: curCounts.synced || 0,
      missing: curCounts.missing || 0,
      optional: curCounts.optional || 0,
    });

    // — 列表 —
    this._applyFilter();
    this._renderList(listEl);

    // — 事件绑定 —
    this._bindEvents();
  }

  _applyFilter() {
    let items = this._allItems;
    if (this._selectedType) {
      items = items.filter((i) => i.type === this._selectedType);
    }
    if (this._statusFilter !== "all") {
      items = items.filter((i) => i.status === this._statusFilter);
    }
    this._filteredItems = items;
  }

  _renderList(listEl) {
    if (!listEl) return;
    if (this._filteredItems.length === 0) {
      const statusLabels = {
        all: "",
        synced: "已同步",
        missing: "待推送",
        disabled: "已禁用",
        optional: "可拉取",
        legacy: "旧仓库遗留",
      };
      const hint =
        this._statusFilter !== "all"
          ? "未找到 " + (statusLabels[this._statusFilter] || "") + " 的资源文件"
          : "该整合包暂无资源文件";
      listEl.innerHTML = emptyHTML(hint);
      return;
    }
    listEl.innerHTML = this._filteredItems.map((it) => itemHTML(it)).join("");
  }

  _bindEvents() {
    // 类型标签切换
    this.querySelectorAll(".sm-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._selectedType = btn.dataset.type;
        _lastSelectedType = this._selectedType;
        this._statusFilter = "all";
        bus.emit("repo:rtype-changed", this._selectedType);
        this._render();
      });
    });

    // 状态标签切换
    this.querySelectorAll(".sm-status-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._statusFilter = btn.dataset.status;
        this._render();
      });
    });

    // 单行按钮
    this.querySelectorAll(".sm-item-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const row = btn.closest("[data-path]");
        if (!row) return;
        const path = row.dataset.path;
        const action = btn.dataset.action;
        if (action === "push") this._pushSingleFile(path);
        else if (action === "pull") this._pullSingleFile(path);
      });
    });
  }

  async _pushSingleFile(path) {
    const { PushSingleResourceToInstance } =
      await import("../../../wailsjs/go/main/App.js");
    try {
      await PushSingleResourceToInstance(
        this._selectedType,
        this._instance,
        path,
      );
      bus.emit("toast:show", { msg: "✅ 已推送", duration: 2000 });
      await this._loadData();
      this._render();
      bus.emit("stats:refresh");
    } catch (e) {
      bus.emit("toast:show", {
        msg: "❌ " + friendlyError(e),
        duration: 3000,
        type: "error",
      });
    }
  }

  async _pullSingleFile(path) {
    const rtype = this._selectedType;
    const { PullSingleResourceFromInstance } =
      await import("../../../wailsjs/go/main/App.js");
    try {
      await PullSingleResourceFromInstance(rtype, path, this._instance);
      bus.emit("toast:show", { msg: "✅ 已拉取", duration: 2000 });
      await this._loadData();
      this._render();
      bus.emit("stats:refresh");
    } catch (e) {
      bus.emit("toast:show", {
        msg: "❌ " + friendlyError(e),
        duration: 3000,
        type: "error",
      });
    }
  }
}

// 注册
customElements.define("app-sync-manager", AppSyncManager);
