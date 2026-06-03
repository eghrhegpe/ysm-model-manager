// ===== <app-tree> — 仓库树（中央主区域） =====

class AppTree extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._entries = [];
    this._search = "";
    this._sort = "name";
    this._dirOpen = {};
  }

  connectedCallback() {
    this._entries = [
      {
        name: "steve_skin.ysm",
        path: "steve_skin.ysm",
        size: 1258291,
        modTime: Date.now() - 86400000,
        banned: false,
      },
      {
        name: "alex_deluxe.ysm",
        path: "alex/alex_deluxe.ysm",
        size: 2516582,
        modTime: Date.now() - 172800000,
        banned: false,
      },
      {
        name: "alex_head.ysm",
        path: "alex/alex_head.ysm",
        size: 524288,
        modTime: Date.now() - 86400000 * 2,
        banned: false,
      },
      {
        name: "dragon_armor.zip",
        path: "dragon/dragon_armor.zip",
        size: 3984588,
        modTime: Date.now() - 3600000,
        banned: false,
      },
      {
        name: "dragon_wings.ysm",
        path: "dragon/dragon_wings.ysm",
        size: 2202009,
        modTime: Date.now() - 7200000,
        banned: false,
      },
      {
        name: "neon_sword.ysm",
        path: "weapons/neon_sword.ysm",
        size: 1572864,
        modTime: Date.now(),
        banned: false,
      },
      {
        name: "magic_staff.zip",
        path: "weapons/magic_staff.zip",
        size: 4404019,
        modTime: Date.now() - 7200000,
        banned: false,
      },
      {
        name: "photon_body.ysm",
        path: "photon/photon_body.ysm",
        size: 2202009,
        modTime: Date.now() - 43200000,
        banned: false,
      },
      {
        name: "old_model.ysm",
        path: "_disabled/old_model.ysm",
        size: 943718,
        modTime: Date.now() - 604800000,
        banned: true,
      },
      {
        name: "custom_hat.ysm",
        path: "custom/custom_hat.ysm",
        size: 838860,
        modTime: Date.now() - 259200000,
        banned: false,
      },
      {
        name: "steve_2d.ysm",
        path: "custom/steve_2d.ysm",
        size: 314572,
        modTime: Date.now() - 500000,
        banned: false,
      },
    ];
    try {
      Object.assign(
        this._dirOpen,
        JSON.parse(localStorage.getItem("at_dirs") || "{}"),
      );
    } catch (e) {
      /* ignore */
    }
    this.render();
    this._renderTree();
  }

  disconnectedCallback() {}

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:flex; flex-direction:column; flex:1; overflow:hidden; font-family:-apple-system,sans-serif; }
        .hdr { padding:10px 12px; border-bottom:1px solid rgba(255,255,255,.06); }
        .hdr-row { display:flex; align-items:center; gap:6px; margin-bottom:6px; }
        .hdr-label { font-size:12px; font-weight:600; color:#a6adc8; flex:1; }
        .hdr-btn { padding:3px 8px; border-radius:4px; border:1px solid rgba(255,255,255,.08); background:transparent; color:#cdd6f4; cursor:pointer; font-size:10px; font-family:inherit; transition:all .2s; }
        .hdr-btn:hover { background:#2a2a42; }
        .hdr-btn.accent { background:#7c83ff33; color:#7c83ff; border-color:#7c83ff55; }
        .hdr-btn.accent:hover { background:#7c83ff55; }
        .hdr-btn.flash { background:#a6e3a133; border-color:#a6e3a155; }
        .srch-row { display:flex; align-items:center; gap:6px; }
        .srch-inp { flex:1; padding:5px 8px; border-radius:6px; border:1px solid rgba(255,255,255,.08); background:#181825; color:#cdd6f4; font-size:11px; outline:none; font-family:inherit; }
        .srch-inp::placeholder { color:#6c7086; }
        .sort-sel { padding:5px 6px; border-radius:5px; border:1px solid rgba(255,255,255,.08); background:#181825; color:#cdd6f4; font-size:10px; outline:none; font-family:inherit; cursor:pointer; }
        .tag { font-size:7px; background:#f9a82633; color:#f9a826; padding:0 4px; border-radius:3px; margin-left:2px; }
        .list { flex:1; overflow-y:auto; padding:6px 8px; }
        .list::-webkit-scrollbar { width:4px; }
        .list::-webkit-scrollbar-thumb { background:rgba(255,255,255,.1); border-radius:2px; }
        .empty { text-align:center; padding:40px 16px; font-size:12px; color:#6c7086; line-height:1.8; }
        .empty .big { font-size:36px; margin-bottom:8px; }

        /* 文件夹 */
        .fh { display:flex; align-items:center; gap:4px; padding:3px 4px; border-radius:4px; cursor:pointer; font-size:11px; transition:background .12s; }
        .fh:hover { background:#2a2a42; }
        .fh .ar { font-size:7px; color:#6c7086; width:10px; transition:transform .12s; flex-shrink:0; }
        .fh .ar.open { transform:rotate(90deg); }
        .fh .nm { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .fh .nm mark { background:#f9a82644; color:#f9a826; border-radius:2px; padding:0 2px; }
        .fh.locked { opacity:.5; }
        .fh.locked .nm { color:#585b70; }
        .ch { padding-left:16px; }

        /* 文件 */
        .fl { display:flex; align-items:center; gap:6px; padding:3px 4px; border-radius:4px; font-size:11px; transition:all .15s; cursor:default; }
        .fl:hover { background:#2a2a42; }
        .fl .ck { width:12px; height:12px; border-radius:3px; border:1px solid rgba(255,255,255,.15); background:transparent; cursor:pointer; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:8px; transition:all .15s; }
        .fl .ck.on { background:#7c83ff; border-color:#7c83ff; }
        .fl .nm { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#cdd6f4; }
        .fl .nm mark { background:#f9a82644; color:#f9a826; border-radius:2px; padding:0 2px; }
        .fl .sz { font-size:9px; color:#6c7086; white-space:nowrap; }
        .fl .dt { font-size:9px; color:#585b70; white-space:nowrap; margin-left:4px; }
        .fl.ban { opacity:.5; }
        .fl.flash { background:#a6e3a122; }

        /* 文件图标颜色 */
        .ficon { font-size:10px; }

        .ftr { padding:8px 12px; border-top:1px solid rgba(255,255,255,.06); display:flex; gap:6px; align-items:center; }
        .ftr .stat { font-size:10px; color:#6c7086; margin-right:auto; }
      </style>
      <div class="hdr">
        <div class="hdr-row">
          <span class="hdr-label">📦 仓库</span>
          <button class="hdr-btn" id="btn-ea">✅ 全部启用 <span class="tag">预告</span></button>
          <button class="hdr-btn" id="btn-da">⛔ 全部禁用 <span class="tag">预告</span></button>
          <button class="hdr-btn accent" id="btn-st">▶️ 同步状态 <span class="tag">预告</span></button>
        </div>
        <div class="srch-row">
          <input class="srch-inp" id="srch" type="text" placeholder="🔍 搜索模型名称" autocomplete="off">
          <select class="sort-sel" id="sort">
            <option value="name">名称</option>
            <option value="size">大小</option>
            <option value="date">日期</option>
          </select>
        </div>
      </div>
      <div class="list" id="tree">
        <div class="empty"><div class="big">📁</div>暂无模型文件</div>
      </div>
      <div class="ftr">
        <span class="stat" id="ftr-stat">共 0 项</span>
        <button class="hdr-btn" id="btn-repo">📁 选择仓库目录</button>
        <button class="hdr-btn" id="btn-dedup">🔗 去重 <span class="tag">预告</span></button>
        <button class="hdr-btn" id="btn-trash">🗑️ 回收站</button>
        <div style="flex:1"></div>
        <button class="hdr-btn" id="btn-pv">◀ 预览</button>
      </div>
    `;

    this.shadowRoot.getElementById("srch").oninput = (e) => {
      this._search = e.target.value;
      this._renderTree();
    };
    this.shadowRoot.getElementById("sort").onchange = (e) => {
      this._sort = e.target.value;
      this._renderTree();
    };
    this.shadowRoot.getElementById("btn-repo").onclick = () =>
      bus.emit("dir:select-repo");
    this.shadowRoot.getElementById("btn-dedup").onclick = () =>
      bus.emit("entries:dedup");
    this.shadowRoot.getElementById("btn-trash").onclick = () =>
      bus.emit("recycle:open");
    this.shadowRoot.getElementById("btn-pv").onclick = () =>
      bus.emit("preview:toggle");
    this.shadowRoot.getElementById("btn-ea").onclick = () => {
      this._flashBtn(this.shadowRoot.getElementById("btn-ea"));
      this._entries.forEach((e) => {
        e.banned = false;
      });
      this._renderTree();
    };
    this.shadowRoot.getElementById("btn-da").onclick = () => {
      this._flashBtn(this.shadowRoot.getElementById("btn-da"));
      this._entries.forEach((e) => {
        e.banned = true;
      });
      this._renderTree();
    };
    this.shadowRoot.getElementById("btn-st").onclick = () => {
      this._flashBtn(this.shadowRoot.getElementById("btn-st"));
    };
  }

  // ===== 构建树 =====
  _buildTree(entries) {
    const sorted = [...entries].sort((a, b) => {
      if (this._sort === "size") return (b.size || 0) - (a.size || 0);
      if (this._sort === "date") return (b.modTime || 0) - (a.modTime || 0);
      return a.name.localeCompare(b.name);
    });
    const query = (this._search || "").trim().toLowerCase();
    const root = {};
    sorted.forEach((e) => {
      if (query && !e.name.toLowerCase().includes(query)) return;
      const parts = e.path.replace(/\\/g, "/").split("/");
      let n = root;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!parts[i]) continue;
        if (!n[parts[i]]) n[parts[i]] = {};
        n = n[parts[i]];
      }
      n[parts[parts.length - 1]] = { _e: e };
    });
    return root;
  }

  // ===== 渲染树 =====
  _renderTree() {
    const c = this.shadowRoot.getElementById("tree");
    const hasQuery = !!(this._search || "").trim();
    if (!this._entries.length) {
      c.innerHTML =
        '<div class="empty"><div class="big">📁</div>暂无模型文件</div>';
      this._updateStat();
      return;
    }
    const root = this._buildTree(this._entries);
    const html = this._renderNode(root, "", hasQuery);
    if (!html) {
      c.innerHTML =
        '<div class="empty"><div class="big">🔍</div>未找到匹配的文件</div>';
      this._updateStat();
      return;
    }
    c.innerHTML = html;

    // 文件夹展开/折叠
    c.querySelectorAll(".fh").forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        const ch = el.nextElementSibling;
        const ar = el.querySelector(".ar");
        if (ch) {
          const open = ch.style.display !== "none";
          ch.style.display = open ? "none" : "block";
          ar.classList.toggle("open", !open);
          this._dirOpen[el.dataset.dir] = !open;
          localStorage.setItem("at_dirs", JSON.stringify(this._dirOpen));
        }
      };
    });

    // 复选框
    c.querySelectorAll(".ck").forEach((el) => {
      el.onclick = (ev) => {
        ev.stopPropagation();
        const wasOn = el.classList.contains("on");
        el.classList.toggle("on");
        el.textContent = el.classList.contains("on") ? "✓" : "";
        // 闪烁反馈
        const fl = el.closest(".fl");
        if (fl) {
          fl.classList.add("flash");
          setTimeout(() => fl.classList.remove("flash"), 400);
        }
        bus.emit("entry:toggle", { path: el.dataset.path, enabled: !wasOn });
      };
    });

    // 右键菜单
    c.querySelectorAll(".fl").forEach((el) => {
      el.oncontextmenu = (e) => {
        e.preventDefault();
        bus.emit("ctx:show", {
          x: e.clientX,
          y: e.clientY,
          path: el.dataset.path,
          name:
            el.querySelector(".nm")?.textContent?.replace(/^\S+\s/, "") || "",
          banned: !el.querySelector(".ck")?.classList.contains("on"),
        });
      };
    });

    this._updateStat();
  }

  _updateStat() {
    const total = this._entries.length;
    const enabled = this._entries.filter((e) => !e.banned).length;
    const totalSize = this._entries.reduce((s, e) => s + (e.size || 0), 0);
    const el = this.shadowRoot.getElementById("ftr-stat");
    if (el)
      el.textContent = `共 ${total} 项 (已启用 ${enabled}) · ${this._fmt(totalSize)}`;
  }

  _renderNode(node, dirPath, hasQuery) {
    const keys = Object.keys(node).sort((a, b) => {
      const aIsDir = !node[a]._e;
      const bIsDir = !node[b]._e;
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      const ea = node[a]._e,
        eb = node[b]._e;
      if (this._sort === "size") return (eb?.size || 0) - (ea?.size || 0);
      if (this._sort === "date") return (eb?.modTime || 0) - (ea?.modTime || 0);
      return a.localeCompare(b);
    });

    let h = "";
    const hasSearch = !!(this._search || "").trim();
    keys.forEach((k) => {
      const v = node[k];
      const full = dirPath ? dirPath + "/" + k : k;
      if (v._e) {
        const e = v._e;
        // 搜索过滤
        if (
          hasSearch &&
          !e.name.toLowerCase().includes(this._search.toLowerCase())
        )
          return;
        const nmHtml = hasSearch
          ? this._hl(e.name, this._search)
          : this._esc(e.name);
        const dateStr = e.modTime ? this._fmtDate(e.modTime) : "";
        const icon = this._fileIcon(e.name);
        h +=
          '<div class="fl' +
          (e.banned ? " ban" : "") +
          '" data-path="' +
          this._esc(e.path) +
          '">';
        h +=
          '<span class="ck' +
          (e.banned ? "" : " on") +
          '" data-path="' +
          this._esc(e.path) +
          '">' +
          (e.banned ? "" : "✓") +
          "</span>";
        h += '<span class="ficon">' + icon + "</span>";
        h += '<span class="nm">' + nmHtml + "</span>";
        h += '<span class="sz">' + this._fmt(e.size) + "</span>";
        if (dateStr) h += '<span class="dt">' + dateStr + "</span>";
        h += "</div>";
      } else {
        // 文件夹：是否包含匹配的文件？（搜索时自动展开）
        const isLocked = k.startsWith("_");
        const shouldOpen = hasQuery || !!this._dirOpen[full];
        const containsMatch = hasQuery
          ? this._folderContains(v, this._search.toLowerCase())
          : false;
        const isOpen = shouldOpen || (hasQuery && containsMatch);

        const folderIcon = isLocked ? "🔒" : "📁";
        const nmColor = isLocked ? "#585b70" : "#a6adc8";
        h +=
          '<div class="fh' +
          (isLocked ? " locked" : "") +
          '" data-dir="' +
          this._esc(full) +
          '">' +
          '<span class="ar' +
          (isOpen ? " open" : "") +
          '">' +
          (isOpen ? "▼" : "▶") +
          "</span>" +
          '<span class="nm" style="color:' +
          nmColor +
          '">' +
          folderIcon +
          " " +
          this._esc(k) +
          "</span></div>";
        h +=
          '<div class="ch" style="display:' +
          (isOpen ? "block" : "none") +
          '">';
        h += this._renderNode(v, full, hasQuery);
        h += "</div>";
      }
    });
    return h;
  }

  _folderContains(node, query) {
    if (!query || !node) return false;
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (v._e) {
        if (v._e.name.toLowerCase().includes(query)) return true;
      } else {
        if (k.toLowerCase().includes(query)) return true;
        if (this._folderContains(v, query)) return true;
      }
    }
    return false;
  }

  _fileIcon(name) {
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (ext === "ysm") return "💎";
    if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "📦";
    if (["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext)) return "🖼️";
    if (
      [
        "txt",
        "md",
        "json",
        "xml",
        "yml",
        "yaml",
        "cfg",
        "conf",
        "ini",
      ].includes(ext)
    )
      return "📄";
    return "🧊";
  }

  // ===== 工具函数 =====
  _esc(s) {
    return (s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  _hl(text, q) {
    const s = this._esc(text);
    if (!q) return s;
    const lq = q.toLowerCase();
    const idx = text.toLowerCase().indexOf(lq);
    if (idx === -1) return s;
    const before = this._esc(text.substring(0, idx));
    const match = this._esc(text.substring(idx, idx + q.length));
    const after = this._esc(text.substring(idx + q.length));
    return before + "<mark>" + match + "</mark>" + after;
  }

  _flashBtn(el) {
    if (!el) return;
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 400);
  }

  _fmt(b) {
    if (!b) return "";
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
    return (b / 1048576).toFixed(1) + " MB";
  }

  _fmtDate(ts) {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday)
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const diff = (now - d) / 86400000;
    if (diff < 7)
      return (
        ["日", "一", "二", "三", "四", "五", "六"][d.getDay()] +
        " " +
        d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      );
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
}
customElements.define("app-tree", AppTree);
