// ===== 资源管理器 Web Component =====
// 通用资源管理（资源包/光影包/未来类型）
// 使用: <app-resource-manager rtype="resourcepack"></app-resource-manager>

import { sidebarHTML, itemHTML, detailHTML, placeholderHTML, type PackMetaDetail } from "./tpl.ts";
import { bus } from "../../bus.ts";
import { RESOURCE_TYPES } from "../../utils/resource-types.ts";
import { getApp } from "../../wails/app.ts";
import { esc } from "../../utils/dom.ts";

/** 资源类型配置（resource_types.json 条目视图） */
interface ResourceTypeConfig {
  id: string;
  name?: string;
  icon?: string;
  actions?: string[];
  extensions?: string[];
  installDir?: string;
  isDir?: boolean;
}

/** 资源列表项 */
interface PackEntry {
  name: string;
  path: string;
  enabled: boolean;
}

const STORE: { _config: ResourceTypeConfig[] | null } = {
  _config: null,
}; // 模块级缓存（rtype → config）

async function _loadConfig(forceRefresh?: boolean): Promise<ResourceTypeConfig[]> {
  if (!forceRefresh && STORE._config) return STORE._config;
  const { LoadResourceTypes } = await getApp();
  const raw = await LoadResourceTypes();
  try {
    const parsed = JSON.parse(raw) as { resourceTypes?: ResourceTypeConfig[] };
    STORE._config = parsed.resourceTypes || [];
  } catch {
    STORE._config = [];
  }
  return STORE._config;
}

// 监听配置刷新事件（如用户修改了自定义资源类型）
bus.on("config:resource-types-changed", () => {
  STORE._config = null;
  // 通知所有已创建的组件实例重新初始化
  document.querySelectorAll("app-resource-manager").forEach((el) => {
    (el as AppResourceManager)._init && (el as AppResourceManager)._init();
  });
});

function _findType(rtype: string): ResourceTypeConfig | undefined {
  return (STORE._config || []).find((t) => t.id === rtype);
}

function _esc(s: unknown): string {
  return esc(String(s ?? ""));
}

export class AppResourceManager extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["rtype", "instance"];
  }

  private _rtype: string;
  private _instance: string;
  private _typeLabel = "";
  private _typeIcon = "";
  private _actions: string[] = [];
  private _rpRoot = "";
  private _listEl: HTMLElement | null = null;
  private _contentEl: HTMLElement | null = null;
  private _packsCache: PackEntry[] = []; // 完整列表缓存（供搜索过滤）
  private _initGen = 0; // generation 守卫：rtype/instance 连变时作废在途 _init 的回写

  constructor() {
    super();
    this._rtype = this.getAttribute("rtype") || RESOURCE_TYPES.PACK;
    this._instance = this.getAttribute("instance") || "";
  }

  async connectedCallback(): Promise<void> {
    await this._init();
  }

  attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null): void {
    if (oldVal === newVal || !this.isConnected) return;
    if (name === "rtype") {
      this._rtype = newVal || RESOURCE_TYPES.PACK;
      this._init();
    } else if (name === "instance") {
      this._instance = newVal || "";
      this._init();
    }
  }

  async _init(): Promise<void> {
    const gen = ++this._initGen;
    await _loadConfig();
    if (gen !== this._initGen) return; // 过期：已有更新的 _init 发起
    const type = _findType(this._rtype);
    if (!type) {
      this.innerHTML =
        '<div style="padding:12px;color:var(--paid)">⚠️ 未知资源类型: ' +
        _esc(this._rtype) +
        "</div>";
      return;
    }
    this._typeLabel = type.name || this._rtype;
    this._typeIcon = type.icon || "📦";
    this._actions = type.actions || [
      "import",
      "toggle",
      "delete",
      "openFolder",
    ];

    const {
      GetRepoRoot,
      ReadPackMeta,
      ScanModelEntries,
      ToggleResourcePack,
      IsResourcePackEnabled,
      SelectImportZip,
      SelectImportFile,
      ImportByType,
      DeleteResourcePack,
      OpenFolder,
    } = await getApp();
    if (gen !== this._initGen) return;

    // 实例隔离路径：当 instance 属性存在时，从 mcRoot + installDir 推导
    // 注意：整合包传的是版本目录名（如 "1.20.1-Fabric"），用 ListVersionInstances 查实际路径
    if (this._instance && type.installDir) {
      const { LoadAppConfig, ListVersionInstances } =
        await getApp();
      const cfg = await LoadAppConfig();
      const mcRoot = cfg.mcRoot || "";
      if (mcRoot) {
        const all = await ListVersionInstances(mcRoot);
        const match = (all || []).find((i) => i.Name === this._instance);
        if (match) {
          this._rpRoot =
            match.VersionDir +
            "/" +
            type.installDir.replace("{instance}", this._instance);
        } else {
          this._rpRoot =
            mcRoot +
            "/" +
            type.installDir.replace("{instance}", this._instance);
        }
      } else {
        this._rpRoot = "";
      }
    } else {
      this._rpRoot = await GetRepoRoot(this._rtype);
    }
    if (gen !== this._initGen) return;
    if (!this._rpRoot) {
      this.innerHTML =
        '<div class="dp-placeholder" style="display:flex;align-items:center;justify-content:center;flex-direction:column;color:var(--muted);font-size:12px;gap:8px;height:100%">' +
        '<div style="font-size:24px">⚠️</div>' +
        "<div>未设置" +
        _esc(this._typeLabel) +
        "路径</div>" +
        '<div style="font-size:10px">请先在设置页配置' +
        _esc(this._typeLabel) +
        "目录</div>" +
        "</div>";
      return;
    }

    this.innerHTML =
      '<div class="repo-layout" style="height:100%">' +
      sidebarHTML(this._rpRoot, this._actions, this._typeLabel) +
      '<div class="rm-content" style="flex:1;overflow-y:auto;padding:12px">' +
      placeholderHTML(this._typeLabel) +
      "</div>" +
      "</div>";

    this._listEl = this.querySelector(".rm-list");
    this._contentEl = this.querySelector(".rm-content");

    // 绑定操作
    if (this._actions.includes("import")) {
      this.querySelector(".rm-import-btn")?.addEventListener(
        "click",
        async () => {
          const type = _findType(this._rtype);
          const exts = (type && type.extensions) || [".zip"];
          const isZip = exts.every((e) => e === ".zip");
          let filePath: string;
          if (isZip) {
            filePath = await SelectImportZip();
          } else {
            const filter = (type ? type.name : "") + "|" + exts.map((e) => "*" + e).join(";");
            filePath = await SelectImportFile(filter, "选择" + (type ? type.name : ""));
          }
          if (!filePath) return;
          const errMsg = await ImportByType(this._rtype, filePath);
          if (errMsg) {
            this._toast("error", "导入失败", errMsg);
            return;
          }
          await this._loadList();
          this._toast(
            "ok",
            "导入成功",
            "已复制到 " + this._typeLabel + " 目录",
          );
        },
      );
    }

    if (this._actions.includes("openFolder")) {
      this.querySelector(".rm-open-btn")?.addEventListener(
        "click",
        async () => {
          await OpenFolder(this._rpRoot);
        },
      );
    }

    // 列表点击
    this._listEl?.addEventListener("click", async (e) => {
      const target = e.target as HTMLElement | null;
      const item = target ? target.closest(".rm-item") : null;
      if (!item) return;

      // 切换
      if (this._actions.includes("toggle") && target && target.closest(".rm-toggle")) {
        await ToggleResourcePack((item as HTMLElement).dataset.path || "");
        await this._loadList();
        return;
      }

      // 选中
      this._listEl
        ?.querySelectorAll(".rm-item")
        .forEach((el) => (el as HTMLElement).style.background = "");
      (item as HTMLElement).style.background = "var(--hover)";
      await this._showDetail(
        (item as HTMLElement).dataset.path || "",
        (item as HTMLElement).dataset.name || "",
      );
    });

    // 搜索过滤
    const searchInput = this.querySelector(".rm-search") as HTMLInputElement | null;
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        this._applyFilter(searchInput.value);
      });
    }

    if (gen === this._initGen) await this._loadList();
  }

  async _loadList(): Promise<void> {
    if (!this._listEl) return;
    const { ScanModelEntries, IsResourcePackEnabled } =
      await getApp();
    const entries = await ScanModelEntries(this._rpRoot);
    // 从 resource_types.json 获取当前类型的扩展名列表
    const type = _findType(this._rtype);
    const exts = (type && type.extensions) || [".zip"];
    const packs: PackEntry[] = [];
    for (const e of entries || []) {
      const name = e.Name || "";
      const fullPath = e.Path || "";
      const lower = name.toLowerCase();
      // .disabled 后缀处理：去后缀后判断扩展名
      const baseName = lower.replace(/\.disabled$/, "");
      const matches = exts.some((ext) => baseName.endsWith(ext));
      if (!matches) continue;
      if (this._actions.includes("toggle")) {
        const enabled = await IsResourcePackEnabled(fullPath);
        packs.push({
          name: name.replace(/\.disabled$/i, ""),
          path: fullPath,
          enabled,
        });
      } else {
        packs.push({ name, path: fullPath, enabled: true });
      }
    }
    if (!packs.length) {
      this._packsCache = [];
      this._listEl.innerHTML =
        '<div style="padding:12px;text-align:center;color:var(--muted)">📭 暂无' +
        _esc(this._typeLabel) +
        "</div>";
      return;
    }
    this._packsCache = packs;
    // 如果有搜索关键字，应用过滤
    const searchInput = this.querySelector(".rm-search") as HTMLInputElement | null;
    const q = searchInput ? searchInput.value.toLowerCase().trim() : "";
    this._renderList(q);
  }

  _renderList(query: string): void {
    if (!this._listEl) return;
    const filtered = query
      ? this._packsCache.filter((p) => p.name.toLowerCase().includes(query))
      : this._packsCache;
    const type = _findType(this._rtype);
    const typeIcon = (type && type.icon) || "📦";
    this._listEl.innerHTML = filtered
      .map((p, i) => itemHTML(p.path, p.name, p.enabled, typeIcon, i))
      .join("");
  }

  _applyFilter(value: string): void {
    const q = value.toLowerCase().trim();
    this._renderList(q);
    // 清除选中高亮
    this._listEl
      ?.querySelectorAll(".rm-item")
      .forEach((el) => (el as HTMLElement).style.background = "");
    // 清除详情面板，避免显示与当前列表不匹配的内容
    if (this._contentEl) {
      const typeLabel = this._typeLabel || "";
      this._contentEl.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;flex-direction:column;color:var(--muted);font-size:12px;gap:8px;height:100%">' +
        '<div style="font-size:24px">🔍</div>' +
        "<div>搜索中...</div>" +
        "</div>";
    }
  }

  async _showDetail(path: string, name: string): Promise<void> {
    if (!this._contentEl) return;
    // 重启入场动画
    this._contentEl.style.animation = "none";
    this._contentEl.innerHTML =
      '<div style="padding:12px;text-align:center;color:var(--muted)">⏳ 加载中...</div>';
    this._contentEl.offsetHeight;
    this._contentEl.style.animation = "";
    try {
      // pack_format 不设（shaderpack 无此概念）；describeVersionRange 对 undefined 兜底输出 "?"
      let meta: PackMetaDetail = { description: "", thumbnail: null };
      let displayName = name;
      let enabled = true;

      if (this._rtype === RESOURCE_TYPES.SHADER) {
        // 光影包：从 lang/en_US.lang 提取显示名
        const { ReadShaderpackLang } =
          await getApp();
        const jsonStr = await ReadShaderpackLang(path);
        const spMeta = JSON.parse(jsonStr) as { name?: string; entries?: Record<string, string> };
        if (spMeta.name) displayName = spMeta.name;
        const entries = spMeta.entries || {};
        // 取前几条 option 描述作为简介
        const descs = Object.entries(entries)
          .filter(([k]) => k.includes(".comment"))
          .slice(0, 3)
          .map(([, v]) => v.replace(/§[0-9a-fklmnor]/g, ""))
          .filter(Boolean);
        meta.description = descs.length
          ? descs.join("\n")
          : `📦 光影包 (${Object.keys(entries).length} 项配置)`;
      } else {
        const { ReadPackMeta, IsResourcePackEnabled } =
          await getApp();
        const jsonStr = await ReadPackMeta(path);
        meta = JSON.parse(jsonStr) as PackMetaDetail;
        if (this._actions.includes("toggle")) {
          enabled = await IsResourcePackEnabled(path);
        }
      }

      this._contentEl.innerHTML = detailHTML(
        displayName,
        meta,
        enabled,
        path,
        this._typeLabel,
        this._actions,
      );

      // 删除
      if (this._actions.includes("delete")) {
        const delBtn = this._contentEl.querySelector(".rm-del-btn") as HTMLElement | null;
        if (delBtn) {
          delBtn.addEventListener("click", async () => {
            if (!confirm("确定要删除 " + name + " 吗？")) return;
            try {
              // 从配置读取 isDir 字段，文件夹型资源（如 mmd-skin/vrchat-avatar）删整个目录
              const type = _findType(this._rtype);
              const isDirModel = type && type.isDir;
              const { DeleteResourcePack, DeleteModelDir } =
                await getApp();
              if (isDirModel) {
                await DeleteModelDir(path);
              } else {
                await DeleteResourcePack(path);
              }
              await this._loadList();
              if (this._contentEl) {
                this._contentEl.innerHTML =
                  '<div class="dp-placeholder" style="display:flex;align-items:center;justify-content:center;flex-direction:column;color:var(--muted);font-size:12px;gap:8px;height:100%">' +
                  '<div style="font-size:24px">📦</div>' +
                  "<div>已删除</div>" +
                  "</div>";
              }
              this._toast("ok", "已删除");
            } catch (delErr) {
              this._toast("error", "删除失败", delErr instanceof Error ? delErr.message : String(delErr));
            }
          });
        }
      }
    } catch (e) {
      if (this._contentEl) {
        this._contentEl.innerHTML =
          '<div style="padding:12px;color:var(--paid)">⚠️ 读取失败: ' +
          _esc(e instanceof Error ? e.message : e) +
          "</div>";
      }
    }
  }

  /** 统一反馈出口：直接走类型化事件总线（不再派发游离 DOM `toast` 事件） */
  private _toast(type: string, title: string, msg?: string): void {
    bus.emit("toast:show", {
      msg: title + (msg ? ": " + msg : ""),
      type: (type || "info") as "info" | "success" | "error" | "warn",
      duration: 3000,
    });
  }
}

// 注册组件
if (!customElements.get("app-resource-manager")) {
  customElements.define("app-resource-manager", AppResourceManager);
}
