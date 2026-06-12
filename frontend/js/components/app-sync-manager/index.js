// ===== 整合包同步管理器 =====
// 展示整合包内所有资源类型的同步状态（扁平列表，一次加载，前端过滤）
// 使用: <app-sync-manager instance="1.20.1-Fabric"></app-sync-manager>

import { bus } from "../../bus.js";
import {
  containerHTML,
  summaryHTML,
  itemHTML,
  emptyHTML,
  loadingHTML,
} from "./tpl.js";

const ESC = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export class AppSyncManager extends HTMLElement {
  static get observedAttributes() {
    return ["instance"];
  }

  constructor() {
    super();
    this._instance = "";
    this._allItems = []; // 原始数据（全部类型）
    this._filteredItems = []; // 当前过滤后
    this._selectedType = "all"; // "all" 或类型 ID
    this._searchQuery = "";
    this._statusFilter = "all"; // all / synced / missing / optional
    this._typeConfig = []; // 类型配置缓存
    this._loading = false;
    this._pusher = null; // 批量推送/拉取中的 abort 信号
  }

  connectedCallback() {
    this._instance = this.getAttribute("instance") || "";
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
    }
  }

  async _init() {
    this._loading = true;
    this.innerHTML = containerHTML(this._instance) + loadingHTML();

    // 加载类型配置 + 数据
    await this._loadTypeConfig();
    await this._loadData();

    this._loading = false;
    this._render();
    // _render 末尾已调用 _bindEvents()
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
    // 重建内容
    this.innerHTML = containerHTML();

    // 短标签映射
    const shortLabel = {
      ysm: "YSM",
      "mmd-skin": "MMD",
      "vrchat-avatar": "VRC",
      resourcepack: "材质包",
      shaderpack: "光影包",
      "create-blueprint": "蓝图",
    };

    // 构建类型标签（+ "全部" 标签）
    const tabsEl = this.querySelector(".sm-tabs");
    const summaryEl = this.querySelector(".sm-summary");
    const listEl = this.querySelector(".sm-list");
    const searchEl = this.querySelector(".sm-search");
    const filterEl = this.querySelector(".sm-status-filter");
    const pushAllBtn = this.querySelector(".sm-push-all-btn");
    const pullAllBtn = this.querySelector(".sm-pull-all-btn");
    if (!tabsEl || !summaryEl || !listEl) return;

    // — 类型标签（含 "全部"）—
    // 按类型分组统计
    const typeCounts = {};
    for (const t of this._typeConfig) {
      typeCounts[t.id] = { synced: 0, missing: 0, optional: 0, total: 0 };
    }
    for (const item of this._allItems) {
      const c = typeCounts[item.type];
      if (c) {
        c[item.status]++;
        c.total++;
      }
    }
    // 全局统计
    const globalCounts = { synced: 0, missing: 0, optional: 0 };
    for (const item of this._allItems) globalCounts[item.status]++;

    // 渲染标签（使用短标签）
    const allCount = this._allItems.length;
    let tabHtml =
      '<button class="sm-tab' +
      (this._selectedType === "all" ? " active" : "") +
      '" data-type="all" style="padding:3px 10px;border-radius:3px 3px 0 0;border:none;background:' +
      (this._selectedType === "all" ? "var(--surf)" : "transparent") +
      ";color:" +
      (this._selectedType === "all" ? "var(--accent)" : "var(--muted)") +
      ';cursor:pointer;font-family:inherit;font-size:var(--fs-sm);white-space:nowrap">📋 全部 (' +
      allCount +
      ")</button>";
    for (const t of this._typeConfig) {
      const c = typeCounts[t.id];
      const count = c ? c.total : 0;
      const active = this._selectedType === t.id;
      const label = shortLabel[t.id] || t.name;
      tabHtml +=
        '<button class="sm-tab' +
        (active ? " active" : "") +
        '" data-type="' +
        t.id +
        '" style="padding:3px 10px;border-radius:3px 3px 0 0;border:none;background:' +
        (active ? "var(--surf)" : "transparent") +
        ";color:" +
        (active ? "var(--accent)" : "var(--muted)") +
        ';cursor:pointer;font-family:inherit;font-size:var(--fs-sm);white-space:nowrap">' +
        (t.icon || "📦") +
        " " +
        label +
        (count > 0
          ? ' <span style="font-size:8px;opacity:0.7">(' + count + ")</span>"
          : "") +
        "</button>";
    }
    tabsEl.innerHTML = tabHtml;

    // — 统计摘要 —
    const curCounts =
      this._selectedType === "all"
        ? globalCounts
        : typeCounts[this._selectedType] || {
            synced: 0,
            missing: 0,
            optional: 0,
          };
    summaryEl.innerHTML = summaryHTML(curCounts);

    // — 筛选 —
    if (searchEl) searchEl.value = this._searchQuery;
    if (filterEl) filterEl.value = this._statusFilter;

    // — 列表 —
    this._applyFilter();
    this._renderList(listEl);

    // — 批量按钮 —
    const hasMissing =
      (this._selectedType === "all" ? globalCounts : curCounts).missing > 0;
    const hasOptional =
      (this._selectedType === "all" ? globalCounts : curCounts).optional > 0;
    if (pushAllBtn)
      pushAllBtn.style.display = hasMissing ? "inline-block" : "none";
    if (pullAllBtn)
      pullAllBtn.style.display = hasOptional ? "inline-block" : "none";

    // 恢复搜索框焦点（如果有搜索内容）
    if (this._searchQuery && searchEl) {
      searchEl.focus();
      searchEl.setSelectionRange(
        this._searchQuery.length,
        this._searchQuery.length,
      );
    }

    // 绑定事件（每次重建 DOM 后必须重新绑定）
    this._bindEvents();
  }

  _applyFilter() {
    let items = this._allItems;

    // 类型过滤
    if (this._selectedType !== "all") {
      items = items.filter((i) => i.type === this._selectedType);
    }

    // 状态过滤
    if (this._statusFilter !== "all") {
      items = items.filter((i) => i.status === this._statusFilter);
    }

    // 搜索
    if (this._searchQuery) {
      const q = this._searchQuery.toLowerCase();
      items = items.filter((i) => i.name.toLowerCase().includes(q));
    }

    this._filteredItems = items;
  }

  _renderList(listEl) {
    if (!listEl) return;
    if (this._filteredItems.length === 0) {
      listEl.innerHTML = emptyHTML(
        this._searchQuery || this._statusFilter !== "all"
          ? "未找到匹配的资源文件"
          : "该整合包暂无资源文件",
      );
      return;
    }
    listEl.innerHTML = this._filteredItems.map((it) => itemHTML(it)).join("");
  }

  _bindEvents() {
    const self = this;

    // 类型标签切换
    this.querySelectorAll(".sm-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._selectedType = btn.dataset.type;
        this._render();
      });
    });

    // 搜索
    const searchEl = this.querySelector(".sm-search");
    if (searchEl) {
      searchEl.addEventListener("input", () => {
        this._searchQuery = searchEl.value;
        this._applyFilter();
        this._renderList(this.querySelector(".sm-list"));
        // 同步更新摘要（只变列表，不重建整个视图）
        this._syncSummaryAndButtons();
      });
    }

    // 状态筛选
    const filterEl = this.querySelector(".sm-status-filter");
    if (filterEl) {
      filterEl.addEventListener("change", () => {
        this._statusFilter = filterEl.value;
        this._applyFilter();
        this._renderList(this.querySelector(".sm-list"));
      });
    }

    // 推送全部
    const pushAllBtn = this.querySelector(".sm-push-all-btn");
    if (pushAllBtn) {
      pushAllBtn.addEventListener("click", () => this._batchPush());
    }

    // 拉取全部
    const pullAllBtn = this.querySelector(".sm-pull-all-btn");
    if (pullAllBtn) {
      pullAllBtn.addEventListener("click", () => this._batchPull());
    }
  }

  _syncSummaryAndButtons() {
    // 搜索/筛选后更新摘要中 visible 的数量
    const summaryEl = this.querySelector(".sm-summary");
    const pushAllBtn = this.querySelector(".sm-push-all-btn");
    const pullAllBtn = this.querySelector(".sm-pull-all-btn");
    if (!summaryEl) return;

    // 重新计算当前可见的状态统计
    const counts = { synced: 0, missing: 0, optional: 0 };
    for (const item of this._filteredItems) counts[item.status]++;

    summaryEl.innerHTML = summaryHTML(counts);

    if (pushAllBtn) {
      pushAllBtn.style.display = counts.missing > 0 ? "inline-block" : "none";
    }
    if (pullAllBtn) {
      pullAllBtn.style.display = counts.optional > 0 ? "inline-block" : "none";
    }
  }

  async _batchPush() {
    const btn = this.querySelector(".sm-push-all-btn");
    if (!btn) return;
    btn.textContent = "⏳";
    btn.disabled = true;

    // 收集当前可见的 missing 文件，按类型分组
    const byType = {};
    for (const item of this._filteredItems) {
      if (item.status === "missing") {
        (byType[item.type] ||= []).push(item.path);
      }
    }

    let totalOk = 0;
    const { PushResourceToInstance } =
      await import("../../../wailsjs/go/main/App.js");

    for (const [rtype, paths] of Object.entries(byType)) {
      try {
        const n = await PushResourceToInstance(rtype, this._instance);
        totalOk += n || 0;
      } catch (e) {
        console.error("[sync-manager] push error", rtype, e);
      }
    }

    bus.emit("toast:show", {
      msg: "已推送 " + totalOk + " 个文件到整合包",
      duration: 3000,
      type: "success",
    });

    // 重新加载数据
    await this._loadData();
    this._render();
  }

  async _batchPull() {
    const btn = this.querySelector(".sm-pull-all-btn");
    if (!btn) return;
    btn.textContent = "⏳";
    btn.disabled = true;

    const byType = {};
    for (const item of this._filteredItems) {
      if (item.status === "optional") {
        (byType[item.type] ||= []).push(item.path);
      }
    }

    let totalOk = 0;
    const { PullResourceFromInstance } =
      await import("../../../wailsjs/go/main/App.js");

    for (const [rtype, paths] of Object.entries(byType)) {
      try {
        const n = await PullResourceFromInstance(rtype, this._instance);
        totalOk += n || 0;
      } catch (e) {
        console.error("[sync-manager] pull error", rtype, e);
      }
    }

    bus.emit("toast:show", {
      msg: "已拉取 " + totalOk + " 个文件到全局仓库",
      duration: 3000,
      type: "success",
    });

    await this._loadData();
    this._render();
  }
}

// 注册
customElements.define("app-sync-manager", AppSyncManager);
