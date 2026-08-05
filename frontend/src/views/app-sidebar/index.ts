// ===== <app-sidebar> 入口 =====
import { bus } from "../../bus.ts";
import { dbg } from "../../utils/debug/debug.ts";
import { RESOURCE_TYPES, RESOURCE_TYPE_LABELS, ALL_RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { sidebarCSS } from "./sidebar-css.ts";
import { headerHTML, footerHTML, listContainerHTML } from "./tpl.ts";
import { renderVersionCards } from "./render.ts";
import { bindCardEvents, bindFooter } from "./events.ts";
import { get } from "../../services/registry.ts";
import type { loadInstances } from "./loader.ts";
import type { SidebarInstance } from "./data.ts";
import { getApp } from "../../wails/app.ts";

// 持久化勾选状态（跨重新渲染保持），按 rtype 隔离避免类型切换串扰
const _checkedSets = new Map<string, Set<string>>();
function checkedSetFor(rtype: string): Set<string> {
  let s = _checkedSets.get(rtype);
  if (!s) {
    s = new Set<string>();
    _checkedSets.set(rtype, s);
  }
  return s;
}

class AppSidebar extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["rtype"];
  }

  private _root: ShadowRoot;
  private _instances: SidebarInstance[] = [];
  private _unsubs: Array<() => void> = [];
  private _rtype: string;
  private _cardCleanup: (() => void) | null = null;
  private _docClickHandler: (() => void) | null = null;
  private _syncInProgress = false; // 防止并发推送/拉取
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _loading = false;
  /** 重载代数：rtype 快速切换时用代数校验丢弃过期结果 */
  private _reloadGen = 0;
  /** _loading 进行中又有新请求 → 标记待补跑（完成后用最新 rtype 再跑一次） */
  private _pendingReload = false;

  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._root.adoptedStyleSheets = [new CSSStyleSheet()];
    this._root.adoptedStyleSheets[0].replaceSync(sidebarCSS);
    this._rtype = this.getAttribute("rtype") || RESOURCE_TYPES.YSM;
  }

  attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null): void {
    if (name === "rtype" && oldVal !== newVal && newVal) {
      this._rtype = newVal;
      this._reload();
      // 更新导入按钮文字
      const btn = this._root.querySelector(".sidebar-import-all");
      if (btn) {
        btn.textContent = "⬇️ 一键安装" + (RESOURCE_TYPE_LABELS[this._rtype] || "资源");
      }
    }
  }

  async connectedCallback(): Promise<void> {
    this._renderLayout();

    // 监听刷新事件（300ms 防抖，防止短时间内多次重载）
    this._unsubs.push(
      bus.on("stats:refresh", () => {
        clearTimeout(this._debounceTimer ?? undefined);
        this._debounceTimer = setTimeout(() => this._reload(), 300);
      }),
    );

    // 监听全局 subtab 类型切换 → 重新加载该类型的统计
    this._unsubs.push(
      bus.on("repo:rtype-changed", async (rtype) => {
        if (rtype && rtype !== this._rtype) {
          this._rtype = rtype;
          clearTimeout(this._debounceTimer ?? undefined);
          this._debounceTimer = setTimeout(() => this._reload(), 100);
        }
      }),
    );

    // 绑定全选 + 同步所选
    this._bindSelectAll();
    this._bindSyncSelected();

    clearTimeout(this._debounceTimer ?? undefined);
    this._debounceTimer = setTimeout(() => this._reload(), 50);
  }

  private _bindSelectAll(): void {
    const cb = this._root.getElementById("sb-select-all") as HTMLInputElement | null;
    if (!cb) return;
    cb.addEventListener("change", () => {
      const checked = cb.checked;
      const set = checkedSetFor(this._rtype);
      this._root.querySelectorAll(".chk").forEach((c) => {
        const input = c as HTMLInputElement;
        input.checked = checked;
        const idx = parseInt(input.dataset.idx || "", 10);
        if (!isNaN(idx) && this._instances[idx]) {
          if (checked) set.add(this._instances[idx].name);
          else set.delete(this._instances[idx].name);
        }
      });
    });
  }

  // 渲染后恢复勾选 + 监听新 checkbox
  private _restoreCheckboxes(): void {
    const set = checkedSetFor(this._rtype);
    this._root.querySelectorAll(".chk").forEach((c) => {
      const input = c as HTMLInputElement;
      const idx = parseInt(input.dataset.idx || "", 10);
      if (!isNaN(idx) && this._instances[idx]) {
        input.checked = set.has(this._instances[idx].name);
        input.addEventListener("change", () => {
          if (input.checked) set.add(this._instances[idx].name);
          else set.delete(this._instances[idx].name);
        });
      }
    });
  }

  private _bindSyncSelected(): void {
    const pushBtn = this._root.querySelector(".sidebar-push-selected") as HTMLButtonElement | null;
    const pushMenu = this._root.getElementById("sidebar-push-menu") as HTMLElement | null;
    const pullBtn = this._root.querySelector(".sidebar-pull-selected") as HTMLButtonElement | null;
    const pullMenu = this._root.getElementById("sidebar-pull-menu") as HTMLElement | null;
    if (!pushBtn || !pushMenu || !pullBtn || !pullMenu) return;

    // 关闭所有下拉菜单
    const closeAllMenus = (): void => {
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

    const getSelected = (): string[] => {
      const sel: string[] = [];
      this._root.querySelectorAll(".chk:checked").forEach((c) => {
        const input = c as HTMLInputElement;
        const idx = parseInt(input.dataset.idx || "", 10);
        if (!isNaN(idx) && this._instances[idx])
          sel.push(this._instances[idx].name);
      });
      return sel;
    };

    const resolveTypes = (t: string): string[] =>
      t === "all" ? ALL_RESOURCE_TYPES : [t];

    // 推送：emit sync:download:missing（带 correlation token 防交叉触发）
    pushMenu.addEventListener("click", (e) => {
      const target = e.target as HTMLElement | null;
      const item = target ? target.closest(".dd-item") : null;
      if (!item) return;
      const selected = getSelected();
      if (!selected.length) {
        bus.emit("toast:show", { msg: "请先勾选要推送的整合包", duration: 2000, type: "info" });
        return;
      }
      if (this._syncInProgress) return;
      this._syncInProgress = true;
      closeAllMenus();
      pushBtn.textContent = "⏳";
      pushBtn.disabled = true;
      (async () => {
        let failed = 0;
        try {
        const types = resolveTypes((item as HTMLElement).dataset.syncType || "all");
        for (const insName of selected) {
          const results = await Promise.allSettled(
            types.map((rt) => new Promise<unknown>((resolve, reject) => {
              const token = `${insName}:${rt}:${Date.now()}`;
              // timer 先声明再赋值：handler 内引用不在 TDZ（bus 同步 emit 场景安全）
              let timer: ReturnType<typeof setTimeout> | null = null;
              const unsub = bus.on("sync:download:done", (payload) => {
                if (payload?.token === token || payload?.instanceName === insName) {
                  unsub();
                  if (timer) clearTimeout(timer);
                  resolve(payload);
                }
              });
              timer = setTimeout(() => {
                unsub();
                reject(new Error(`推送超时: ${insName}/${rt}`));
              }, 30000);
              bus.emit("sync:download:missing", { instanceName: insName, rtype: rt, token });
            })),
          );
          results.forEach((r) => { if (r.status === "rejected") failed++; });
        }
        if (failed > 0) {
          bus.emit("toast:show", { msg: `⚠️ 推送完成，${failed} 个操作超时`, duration: 3000, type: "warn" });
        } else {
          bus.emit("toast:show", { msg: `✅ 推送完成：${selected.length} 个整合包`, duration: 2500 });
        }
        } catch (err) {
          bus.emit("toast:show", { msg: "❌ 推送失败: " + (err instanceof Error ? err.message : String(err)), duration: 3000, type: "error" });
        } finally {
          // 意外 throw 也必须恢复按钮与锁（陷阱 #3：按钮卡死根因）
          pushBtn.textContent = "⬆️ 推送所选 ▾";
          pushBtn.disabled = false;
          this._syncInProgress = false;
        }
      })();
    });

    // 拉取：调用 PullResourceFromInstance
    pullMenu.addEventListener("click", async (e) => {
      const target = e.target as HTMLElement | null;
      const item = target ? target.closest(".dd-item") : null;
      if (!item) return;
      const selected = getSelected();
      if (!selected.length) {
        bus.emit("toast:show", { msg: "请先勾选要拉取的整合包", duration: 2000, type: "info" });
        return;
      }
      if (this._syncInProgress) return;
      this._syncInProgress = true;
      closeAllMenus();
      pullBtn.textContent = "⏳";
      pullBtn.disabled = true;
      let totalPulled = 0;
      let failed = 0;
      try {
        const { PullResourceFromInstance } = await getApp();
        const types = resolveTypes((item as HTMLElement).dataset.syncType || "all");
        for (const insName of selected) {
          const results = await Promise.allSettled(
            types.map((rt) => PullResourceFromInstance(rt, insName)),
          );
          for (const r of results) {
            if (r.status === "fulfilled") totalPulled += r.value;
            else failed++;
          }
        }
        if (failed > 0) {
          bus.emit("toast:show", { msg: `⚠️ 拉取完成: ${totalPulled} 个文件, ${failed} 个失败`, duration: 3000, type: "warn" });
        } else if (totalPulled > 0) {
          bus.emit("toast:show", { msg: `✅ 拉取完成，共 ${totalPulled} 个文件`, duration: 2500 });
        } else {
          bus.emit("toast:show", { msg: "📭 没有可拉取的文件（实例中无多余资源）", duration: 2500, type: "info" });
        }
        bus.emit("stats:refresh");
        bus.emit("tree:reload");
      } catch (err) {
        bus.emit("toast:show", { msg: "❌ 拉取失败: " + (err instanceof Error ? err.message : String(err)), duration: 3000, type: "error" });
      } finally {
        // 意外 throw 也必须恢复按钮与锁（陷阱 #3：按钮卡死根因）
        pullBtn.textContent = "⬇️ 拉取所选 ▾";
        pullBtn.disabled = false;
        this._syncInProgress = false;
      }
    });
  }

  private _renderCards(): void {
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

  private async _reload(): Promise<void> {
    if (this._loading) {
      // 丢弃语义会导致 rtype 快速切换时 _instances 与 _rtype 错配：
      // 记下补跑请求，当前完成后用最新 rtype 再跑一次
      this._pendingReload = true;
      return;
    }
    this._loading = true;
    const gen = ++this._reloadGen;
    try {
      const instances = await get<typeof loadInstances>("loadInstances")(this._rtype);
      if (gen !== this._reloadGen) return; // 已被更新的重载取代，丢弃过期结果
      this._instances = instances;
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
      if (gen !== this._reloadGen) return;
      dbg("sidebar", "_reload 失败:", e);
      this._instances = [];
    } finally {
      this._loading = false;
    }
    if (gen !== this._reloadGen) return;
    this._renderCards();
    bindFooter(this._root, this._instances);
    if (this._pendingReload) {
      this._pendingReload = false;
      void this._reload();
    }
  }

  disconnectedCallback(): void {
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

  private _renderLayout(): void {
    this._root.innerHTML = headerHTML() + listContainerHTML() + footerHTML();
  }
}
// 注册组件（防 HMR/重复 import 时重复 define）
if (!customElements.get("app-sidebar")) {
  customElements.define("app-sidebar", AppSidebar);
}
