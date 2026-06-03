// ===== <app-tree> — 仓库树（中央主区域） =====

class AppTree extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this._entries = [
      { name: 'steve_skin.ysm', path: 'steve_skin.ysm', size: 1258291, banned: false },
      { name: 'alex_deluxe.ysm', path: 'alex/alex_deluxe.ysm', size: 2516582, banned: false },
      { name: 'alex_head.ysm', path: 'alex/alex_head.ysm', size: 524288, banned: false },
      { name: 'dragon_armor.zip', path: 'dragon/dragon_armor.zip', size: 3984588, banned: false },
      { name: 'neon_sword.ysm', path: 'weapons/neon_sword.ysm', size: 1572864, banned: false },
      { name: 'old_model.ysm', path: '_disabled/old_model.ysm', size: 943718, banned: true },
    ];
    this._dirOpen = {};
    this.render();
    this._renderTree();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:flex; flex-direction:column; flex:1; overflow:hidden; font-family:sans-serif; }
        .header { padding:10px 12px; border-bottom:1px solid rgba(255,255,255,.06); }
        .header-row { display:flex; align-items:center; gap:6px; margin-bottom:6px; }
        .header-label { font-size:12px; font-weight:600; color:#a6adc8; flex:1; }
        .list { flex:1; overflow-y:auto; padding:6px 8px; }
        .fh { display:flex; align-items:center; gap:4px; padding:3px 4px; border-radius:4px; cursor:pointer; font-size:11px; }
        .fh:hover { background:#2a2a42; }
        .fh .ar { font-size:7px; color:#6c7086; width:10px; }
        .ch { padding-left:16px; }
        .file { display:flex; align-items:center; gap:6px; padding:3px 4px; border-radius:4px; font-size:11px; }
        .file:hover { background:#2a2a42; }
        .file .nm { flex:1; color:#cdd6f4; }
        .file .sz { font-size:9px; color:#6c7086; }
        .file.ban { opacity:.5; }
        .file .check { width:12px; height:12px; border-radius:3px; border:1px solid rgba(255,255,255,.15); background:transparent; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; font-size:8px; }
        .file .check.on { background:#7c83ff; border-color:#7c83ff; }
        .footer { padding:8px 12px; border-top:1px solid rgba(255,255,255,.06); display:flex; gap:6px; }
      </style>
      <div class="header">
        <div class="header-row">
          <span class="header-label">📦 仓库</span>
        </div>
      </div>
      <div class="list" id="tree"></div>
    `;
  }

  _renderTree() {
    const c = this.shadowRoot.getElementById('tree');
    if (!this._entries.length) {
      c.innerHTML = '<div style="padding:20px;color:#6c7086;font-size:12px">仓库为空</div>';
      return;
    }
    const root = {};
    this._entries.forEach(e => {
      const parts = e.path.replace(/\\/g,'/').split('/');
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!parts[i]) continue;
        if (!node[parts[i]]) node[parts[i]] = {};
        node = node[parts[i]];
      }
      node[parts[parts.length-1]] = { _entry: e };
    });
    c.innerHTML = this._buildHTML(root, '');
    c.querySelectorAll('.fh').forEach(el => {
      el.onclick = e => {
        e.stopPropagation();
        const ch = el.nextElementSibling;
        const ar = el.querySelector('.ar');
        if (ch) {
          const open = ch.style.display !== 'none';
          ch.style.display = open ? 'none' : 'block';
          ar.textContent = open ? '▶' : '▼';
        }
      };
    });
    c.querySelectorAll('.check').forEach(el => {
      el.onclick = ev => { ev.stopPropagation(); };
    });
  }

  _buildHTML(node, path) {
    const keys = Object.keys(node).sort((a,b) => {
      const aIsDir = !node[a]._entry;
      const bIsDir = !node[b]._entry;
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return a.localeCompare(b);
    });
    let h = '';
    keys.forEach(k => {
      const v = node[k];
      const full = path ? path + '/' + k : k;
      if (v._entry) {
        const e = v._entry;
        h += '<div class="file' + (e.banned ? ' ban' : '') + '">';
        h += '<span class="check' + (e.banned ? '' : ' on') + '">' + (e.banned ? '' : '✓') + '</span>';
        h += '<span class="nm">🧊 ' + this._esc(e.name) + '</span>';
        h += '<span class="sz">' + this._fmt(e.size) + '</span></div>';
      } else {
        h += '<div class="fh"><span class="ar">▶</span><span>📁 ' + this._esc(k) + '</span></div>';
        h += '<div class="ch" style="display:none">' + this._buildHTML(v, full) + '</div>';
      }
    });
    return h;
  }

  _esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  _fmt(b) { if (!b) return ''; if (b<1024) return b+' B'; if (b<1048576) return (b/1024).toFixed(1)+' KB'; return (b/1048576).toFixed(1)+' MB'; }
}
customElements.define('app-tree', AppTree);
