// ===== 资源管理器 Web Component =====
// 通用资源管理（材质包/光影包/未来类型）
// 使用: <app-resource-manager rtype="resourcepack"></app-resource-manager>

import { sidebarHTML, itemHTML, detailHTML, placeholderHTML } from "./tpl.js";

const STORE = {}; // 模块级缓存（rtype → config）

async function _loadConfig() {
  if (STORE._config) return STORE._config;
  const { LoadResourceTypes } = await import("../../../wailsjs/go/main/App.js");
  const raw = await LoadResourceTypes();
  try {
    const parsed = JSON.parse(raw);
    STORE._config = parsed.resourceTypes || [];
  } catch {
    STORE._config = [];
  }
  return STORE._config;
}

function _findType(rtype) {
  return (STORE._config || []).find((t) => t.id === rtype);
}

function _esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export class AppResourceManager extends HTMLElement {
  static get observedAttributes() {
    return ["rtype", "instance"];
  }

  constructor() {
    super();
    this._rtype = this.getAttribute("rtype") || "resourcepack";
    this._instance = this.getAttribute("instance") || "";
    this._typeLabel = "";
    this._typeIcon = "";
    this._actions = [];
    this._rpRoot = "";
    this._listEl = null;
    this._contentEl = null;
    this._packsCache = []; // 完整列表缓存（供搜索过滤）
  }

  async connectedCallback() {
    await this._init();
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (oldVal === newVal || !this.isConnected) return;
    if (name === "rtype") {
      this._rtype = newVal || "resourcepack";
      this._init();
    } else if (name === "instance") {
      this._instance = newVal || "";
      this._init();
    }
  }

  async _init() {
    await _loadConfig();
    const type = _findType(this._rtype);
    if (!type) {
      this.innerHTML =
        '<div style="padding:12px;color:var(--err)">⚠️ 未知资源类型: ' +
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
    } = await import("../../../wailsjs/go/main/App.js");

    // 实例隔离路径：当 instance 属性存在时，从 mcRoot + installDir 推导
    // 注意：整合包传的是版本目录名（如 "1.20.1-Fabric"），用 ListVersionInstances 查实际路径
    if (this._instance && type.installDir) {
      const { LoadAppConfig, ListVersionInstances } =
        await import("../../../wailsjs/go/main/App.js");
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
          let filePath;
          if (isZip) {
            filePath = await SelectImportZip();
          } else {
            const filter = type.name + "|" + exts.map((e) => "*" + e).join(";");
            filePath = await SelectImportFile(filter, "选择" + type.name);
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
    this._listEl.addEventListener("click", async (e) => {
      const item = e.target.closest(".rm-item");
      if (!item) return;

      // 切换
      if (this._actions.includes("toggle") && e.target.closest(".rm-toggle")) {
        await ToggleResourcePack(item.dataset.path);
        await this._loadList();
        return;
      }

      // 选中
      this._listEl
        .querySelectorAll(".rm-item")
        .forEach((el) => (el.style.background = ""));
      item.style.background = "var(--hover)";
      await this._showDetail(item.dataset.path, item.dataset.name);
    });

    // 搜索过滤
    const searchInput = this.querySelector(".rm-search");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        this._applyFilter(searchInput.value);
      });
    }

    await this._loadList();
  }

  async _loadList() {
    if (!this._listEl) return;
    const { ScanModelEntries, IsResourcePackEnabled } =
      await import("../../../wailsjs/go/main/App.js");
    const entries = await ScanModelEntries(this._rpRoot);
    // 从 resource_types.json 获取当前类型的扩展名列表
    const type = _findType(this._rtype);
    const exts = (type && type.extensions) || [".zip"];
    const packs = [];
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
    const searchInput = this.querySelector(".rm-search");
    const q = searchInput ? searchInput.value.toLowerCase().trim() : "";
    this._renderList(q);
  }

  _renderList(query) {
    if (!this._listEl) return;
    const filtered = query
      ? this._packsCache.filter((p) => p.name.toLowerCase().includes(query))
      : this._packsCache;
    const type = _findType(this._rtype);
    const typeIcon = (type && type.icon) || "📦";
    this._listEl.innerHTML = filtered
      .map((p) => itemHTML(p.path, p.name, p.enabled, typeIcon))
      .join("");
  }

  _applyFilter(value) {
    const q = value.toLowerCase().trim();
    this._renderList(q);
    // 清除详情面板的选中高亮
    this._listEl
      .querySelectorAll(".rm-item")
      .forEach((el) => (el.style.background = ""));
  }

  async _showDetail(path, name) {
    if (!this._contentEl) return;
    this._contentEl.innerHTML =
      '<div style="padding:12px;text-align:center;color:var(--muted)">⏳ 加载中...</div>';
    try {
      let meta = { pack_format: "?", description: "", thumbnail: null };
      let displayName = name;
      let enabled = true;

      if (this._rtype === "shaderpack") {
        // 光影包：从 lang/en_US.lang 提取显示名
        const { ReadShaderpackLang } =
          await import("../../../wailsjs/go/main/App.js");
        const jsonStr = await ReadShaderpackLang(path);
        const spMeta = JSON.parse(jsonStr);
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
          await import("../../../wailsjs/go/main/App.js");
        const jsonStr = await ReadPackMeta(path);
        meta = JSON.parse(jsonStr);
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
        const delBtn = this._contentEl.querySelector(".rm-del-btn");
        if (delBtn) {
          delBtn.addEventListener("click", async () => {
            if (!confirm("确定要删除 " + name + " 吗？")) return;
            try {
              // mmd-skin 是文件夹型资源（pmx/pmd + 纹理），删文件所在文件夹
              // 其他类型都是单文件，直接删文件
              const isDirModel = this._rtype === "mmd-skin";
              const { DeleteResourcePack, DeleteModelDir } =
                await import("../../../wailsjs/go/main/App.js");
              if (isDirModel) {
                await DeleteModelDir(path);
              } else {
                await DeleteResourcePack(path);
              }
              await this._loadList();
              this._contentEl.innerHTML =
                '<div class="dp-placeholder" style="display:flex;align-items:center;justify-content:center;flex-direction:column;color:var(--muted);font-size:12px;gap:8px;height:100%">' +
                '<div style="font-size:24px">📦</div>' +
                "<div>已删除</div>" +
                "</div>";
              this._toast("ok", "已删除");
            } catch (delErr) {
              this._toast("error", "删除失败", delErr.message);
            }
          });
        }
      }
    } catch (e) {
      this._contentEl.innerHTML =
        '<div style="padding:12px;color:var(--err)">⚠️ 读取失败: ' +
        _esc(e.message) +
        "</div>";
    }
  }

  _toast(type, title, msg) {
    const ev = new CustomEvent("toast", {
      bubbles: true,
      composed: true,
      detail: { type, title, message: msg },
    });
    this.dispatchEvent(ev);
  }
}

// 注册组件
if (!customElements.get("app-resource-manager")) {
  customElements.define("app-resource-manager", AppResourceManager);
}
