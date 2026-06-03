// ===== <app-sidebar> — 左侧栏（整合包列表） =====

class AppSidebar extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this._unsubs = [];
    this._unsubs.push(bus.on('versions:updated', ({ instances }) => {
      const statEl = this.shadowRoot.getElementById('ver-stat');
      if (statEl) statEl.textContent = `${instances.length}个整合包`;
    }));
    this.render();
  }

  disconnectedCallback() {
    this._unsubs.forEach(fn => fn());
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: flex;
          flex-direction: column;
          background: #11111b;
          border-right: 1px solid rgba(255,255,255,.06);
          width: 280px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
        }
        .header {
          padding: 10px 12px;
          border-bottom: 1px solid rgba(255,255,255,.06);
        }
        .header-row {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 6px;
        }
        .header-label {
          font-size: 12px;
          font-weight: 600;
          color: #a6adc8;
          text-transform: uppercase;
          letter-spacing: .5px;
          flex: 1;
        }
        .header-stat { font-size: 10px; color: #6c7086; }
        .search-input {
          width: 100%; padding: 5px 8px; border-radius: 6px;
          border: 1px solid rgba(255,255,255,.08); background: #181825;
          color: #cdd6f4; font-size: 11px; outline: none; font-family: inherit;
        }
        .search-input::placeholder { color: #6c7086; }
        .list {
          flex: 1; overflow-y: auto; padding: 4px 6px;
        }
        .list::-webkit-scrollbar { width: 4px; }
        .list::-webkit-scrollbar-thumb { background: rgba(255,255,255,.1); border-radius: 2px; }
        .vc {
          background: #181825; border: 1px solid rgba(255,255,255,.06);
          border-radius: 8px; margin-bottom: 6px; overflow: hidden;
        }
        .vc-header {
          display: flex; align-items: center; gap: 6px; padding: 8px 10px;
          cursor: pointer; transition: background .12s;
        }
        .vc-header:hover { background: #2a2a42; }
        .vc-header .arrow { font-size: 7px; color: #6c7086; transition: transform .15s; width: 10px; }
        .vc-header .arrow.open { transform: rotate(90deg); }
        .vc-header .name { flex: 1; font-size: 12px; font-weight: 600; color: #fff; }
        .vc-header .tag { font-size: 9px; padding: 1px 5px; border-radius: 3px; }
        .vc-header .tag.green { background: #a6e3a122; color: #a6e3a1; }
        .vc-header .tag.red { background: #f38ba822; color: #f38ba8; }
        .vc-body { padding: 2px 10px 8px; }
        .vc-body .sec-title { font-size: 9px; color: #6c7086; padding: 4px 2px 2px; text-transform: uppercase; letter-spacing: .5px; }
        .vc-body .row {
          display: flex; align-items: center; gap: 6px; padding: 2px 6px;
          border-radius: 4px; font-size: 10px; transition: background .12s;
        }
        .vc-body .row:hover { background: #2a2a42; }
        .vc-body .row .dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
        .vc-body .row .rn { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .vc-body .row .sz { font-size: 9px; color: #6c7086; }
        .footer { padding: 8px 12px; border-top: 1px solid rgba(255,255,255,.06); }
        .footer-btn {
          width: 100%; padding: 6px 0; border-radius: 6px;
          border: 1px solid rgba(255,255,255,.08); background: transparent;
          color: #cdd6f4; cursor: pointer; font-size: 11px; font-family: inherit; transition: background .12s;
        }
        .footer-btn:hover { background: #2a2a42; }
      </style>
      <div class="header">
        <div class="header-row">
          <span class="header-label">📂 版本列表</span>
          <span class="header-stat" id="ver-stat">4个整合包</span>
        </div>
        <input class="search-input" id="ver-search" type="text" placeholder="🔍 搜索整合包" autocomplete="off" autocapitalize="off">
      </div>
      <div class="list" id="vg">
        <div class="vc">
          <div class="vc-header">
            <span class="arrow open">▶</span>
            <span class="name">📦 我的整合包</span>
            <span class="tag green">✅ 3</span>
            <span class="tag red">⬇️ 1</span>
          </div>
          <div class="vc-body">
            <div class="sec-title">✅ 已同步 (3)</div>
            <div class="row"><span class="dot" style="background:#a6e3a1"></span><span class="rn">steve_skin.ysm</span><span class="sz">1.2 MB</span></div>
            <div class="row"><span class="dot" style="background:#a6e3a1"></span><span class="rn">alex_deluxe.ysm</span><span class="sz">2.4 MB</span></div>
            <div class="row"><span class="dot" style="background:#a6e3a1"></span><span class="rn">neon_sword.ysm</span><span class="sz">1.5 MB</span></div>
            <div class="sec-title">⬇️ 缺失 (1)</div>
            <div class="row"><span class="dot" style="background:#f38ba8"></span><span class="rn">dragon_armor.zip</span><span class="sz">3.8 MB</span></div>
            <div class="sec-title">📤 额外 (2)</div>
            <div class="row"><span class="dot" style="background:#f9a826"></span><span class="rn">custom_hat.ysm</span><span class="sz">0.8 MB</span></div>
            <div class="row"><span class="dot" style="background:#f9a826"></span><span class="rn">old_hat.ysm</span><span class="sz">0.3 MB</span></div>
          </div>
        </div>
        <div class="vc">
          <div class="vc-header">
            <span class="arrow">▶</span>
            <span class="name">📦 光影测试包</span>
            <span class="tag green">✅ 1</span>
            <span class="tag red">⬇️ 2</span>
          </div>
        </div>
        <div class="vc">
          <div class="vc-header">
            <span class="arrow">▶</span>
            <span class="name">📦 空岛生存</span>
            <span class="tag green">✅ 5</span>
          </div>
        </div>
        <div class="vc">
          <div class="vc-header">
            <span class="arrow">▶</span>
            <span class="name">📦 RPG 冒险</span>
            <span class="tag green">✅ 2</span>
            <span class="tag red">⬇️ 3</span>
          </div>
        </div>
      </div>
      <div class="footer">
        <button class="footer-btn" id="btn-mc">🎮 指定游戏路径</button>
      </div>
    `;

    // 卡片展开/折叠
    this.shadowRoot.querySelectorAll('.vc-header').forEach(hdr => {
      hdr.onclick = () => {
        const body = hdr.nextElementSibling;
        const arrow = hdr.querySelector('.arrow');
        if (body && body.classList.contains('vc-body')) {
          body.style.display = body.style.display === 'none' ? '' : 'none';
          arrow.classList.toggle('open');
        }
      };
    });
    // 隐藏未展开卡片的 body
    this.shadowRoot.querySelectorAll('.vc-body').forEach((body, i) => {
      if (i > 0) body.style.display = 'none';
    });

    this.shadowRoot.getElementById('ver-search').oninput = (e) => {
      bus.emit('ver:search', { keyword: e.target.value });
    };
    this.shadowRoot.getElementById('btn-mc').onclick = () => {
      bus.emit('dir:select-mc');
    };
  }
}
customElements.define('app-sidebar', AppSidebar);
