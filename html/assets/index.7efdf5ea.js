(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const a of document.querySelectorAll('link[rel="modulepreload"]'))s(a);new MutationObserver(a=>{for(const o of a)if(o.type==="childList")for(const r of o.addedNodes)r.tagName==="LINK"&&r.rel==="modulepreload"&&s(r)}).observe(document,{childList:!0,subtree:!0});function n(a){const o={};return a.integrity&&(o.integrity=a.integrity),a.referrerpolicy&&(o.referrerPolicy=a.referrerpolicy),a.crossorigin==="use-credentials"?o.credentials="include":a.crossorigin==="anonymous"?o.credentials="omit":o.credentials="same-origin",o}function s(a){if(a.ep)return;a.ep=!0;const o=n(a);fetch(a.href,o)}})();const C=`
:host {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
}
.hdr { padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,.06); }
.hdr-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.hdr-label { font-size: 12px; font-weight: 600; color: #a6adc8; flex: 1; }
.hdr-btn {
  padding: 3px 8px; border-radius: 4px;
  border: 1px solid rgba(255,255,255,.08);
  background: transparent; color: #cdd6f4;
  cursor: pointer; font-size: 10px; font-family: inherit;
  transition: all .2s;
}
.hdr-btn:hover { background: #2a2a42; }
.hdr-btn.accent { background: #7c83ff33; color: #7c83ff; border-color: #7c83ff55; }
.hdr-btn.accent:hover { background: #7c83ff55; }
.hdr-btn.flash { background: #a6e3a133; border-color: #a6e3a155; }
.srch-row { display: flex; align-items: center; gap: 6px; }
.srch-inp {
  flex: 1; padding: 5px 8px; border-radius: 6px;
  border: 1px solid rgba(255,255,255,.08); background: #181825;
  color: #cdd6f4; font-size: 11px; outline: none; font-family: inherit;
}
.srch-inp::placeholder { color: #6c7086; }
.sort-sel {
  padding: 5px 6px; border-radius: 5px;
  border: 1px solid rgba(255,255,255,.08); background: #181825;
  color: #cdd6f4; font-size: 10px; outline: none; font-family: inherit; cursor: pointer;
}
.tag { font-size: 7px; background: #f9a82633; color: #f9a826; padding: 0 4px; border-radius: 3px; margin-left: 2px; }
.list { flex: 1; overflow-y: auto; padding: 6px 8px; }
.list::-webkit-scrollbar { width: 4px; }
.list::-webkit-scrollbar-thumb { background: rgba(255,255,255,.1); border-radius: 2px; }
.empty { text-align: center; padding: 40px 16px; font-size: 12px; color: #6c7086; line-height: 1.8; }
.empty .big { font-size: 36px; margin-bottom: 8px; }
.fh { display: flex; align-items: center; gap: 4px; padding: 3px 4px; border-radius: 4px; cursor: pointer; font-size: 11px; transition: background .12s; }
.fh:hover { background: #2a2a42; }
.fh .ar { font-size: 7px; color: #6c7086; width: 10px; transition: transform .12s; flex-shrink: 0; }
.fh .ar.open { transform: rotate(90deg); }
.fh .nm { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #a6adc8; }
.fh .nm mark { background: #f9a82644; color: #f9a826; border-radius: 2px; padding: 0 2px; }
.fh.locked { opacity: .5; }
.fh.locked .nm { color: #585b70; }
.ch { padding-left: 16px; }
.fl { display: flex; align-items: center; gap: 6px; padding: 3px 4px; border-radius: 4px; font-size: 11px; transition: all .15s; cursor: default; }
.fl:hover { background: #2a2a42; }
.fl .ck { width: 12px; height: 12px; border-radius: 3px; border: 1px solid rgba(255,255,255,.15); background: transparent; cursor: pointer; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 8px; transition: all .15s; }
.fl .ck.on { background: #7c83ff; border-color: #7c83ff; }
.fl .nm { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #cdd6f4; }
.fl .nm mark { background: #f9a82644; color: #f9a826; border-radius: 2px; padding: 0 2px; }
.fl .sz { font-size: 9px; color: #6c7086; white-space: nowrap; }
.fl .dt { font-size: 9px; color: #585b70; white-space: nowrap; margin-left: 4px; }
.fl.ban { opacity: .5; }
.fl.flash { background: #a6e3a122; }
.ficon { font-size: 10px; }
.ftr { padding: 8px 12px; border-top: 1px solid rgba(255,255,255,.06); display: flex; gap: 6px; align-items: center; }
.ftr .stat { font-size: 10px; color: #6c7086; margin-right: auto; }
`;function $(){return`<div class="hdr">
<div class="hdr-row">
<span class="hdr-label">\u{1F4E6} \u4ED3\u5E93</span>
<button class="hdr-btn" id="btn-ea">\u2705 \u5168\u90E8\u542F\u7528 <span class="tag">\u9884\u544A</span></button>
<button class="hdr-btn" id="btn-da">\u26D4 \u5168\u90E8\u7981\u7528 <span class="tag">\u9884\u544A</span></button>
<button class="hdr-btn accent" id="btn-st">\u25B6\uFE0F \u540C\u6B65\u72B6\u6001 <span class="tag">\u9884\u544A</span></button>
</div>
<div class="srch-row">
<input class="srch-inp" id="srch" type="text" placeholder="\u{1F50D} \u641C\u7D22\u6A21\u578B\u540D\u79F0" autocomplete="off">
<select class="sort-sel" id="sort">
<option value="name">\u540D\u79F0</option>
<option value="size">\u5927\u5C0F</option>
<option value="date">\u65E5\u671F</option>
</select>
</div>
</div>`}function H(){return`<div class="ftr">
<span class="stat" id="ftr-stat">\u5171 0 \u9879</span>
<button class="hdr-btn" id="btn-repo">\u{1F4C1} \u9009\u62E9\u4ED3\u5E93\u76EE\u5F55</button>
<button class="hdr-btn" id="btn-dedup">\u{1F517} \u53BB\u91CD <span class="tag">\u9884\u544A</span></button>
<button class="hdr-btn" id="btn-trash">\u{1F5D1}\uFE0F \u56DE\u6536\u7AD9</button>
<div style="flex:1"></div>
<button class="hdr-btn" id="btn-pv">\u25C0 \u9884\u89C8</button>
</div>`}function w(e,t){return`<div class="empty"><div class="big">${e}</div>${t}</div>`}function b(e){return(e||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function B(e,t){const n=b(e);if(!t)return n;const s=t.toLowerCase(),a=e.toLowerCase().indexOf(s);if(a===-1)return n;const o=b(e.substring(0,a)),r=b(e.substring(a,a+t.length)),i=b(e.substring(a+t.length));return o+"<mark>"+r+"</mark>"+i}function A(e){return!e&&e!==0?"":e<1024?e+" B":e<1048576?(e/1024).toFixed(1)+" KB":(e/1048576).toFixed(1)+" MB"}function I(e){if(!e)return"";const t=new Date(e),n=new Date;return t.toDateString()===n.toDateString()?t.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):(n-t)/864e5<7?["\u65E5","\u4E00","\u4E8C","\u4E09","\u56DB","\u4E94","\u516D"][t.getDay()]+" "+t.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):t.toLocaleDateString([],{month:"short",day:"numeric"})}function P(e){const t=(e.split(".").pop()||"").toLowerCase();return t==="ysm"?"\u{1F48E}":["zip","rar","7z","tar","gz"].includes(t)?"\u{1F4E6}":["png","jpg","jpeg","gif","webp","bmp"].includes(t)?"\u{1F5BC}\uFE0F":["txt","md","json","xml","yml","yaml","cfg","conf","ini"].includes(t)?"\u{1F4C4}":"\u{1F9CA}"}function O(e,t,n){const s=[...e].sort((r,i)=>t==="size"?(i.size||0)-(r.size||0):t==="date"?(i.modTime||0)-(r.modTime||0):r.name.localeCompare(i.name)),a=(n||"").trim().toLowerCase(),o={};return s.forEach(r=>{if(a&&!r.name.toLowerCase().includes(a))return;const i=r.path.replace(/\\/g,"/").split("/");let d=o;for(let c=0;c<i.length-1;c++)!i[c]||(d[i[c]]||(d[i[c]]={}),d=d[i[c]]);d[i[i.length-1]]={_e:r}}),o}function L(e,t){if(!t||!e)return!1;for(const n of Object.keys(e)){const s=e[n];if(s._e){if(s._e.name.toLowerCase().includes(t))return!0}else if(n.toLowerCase().includes(t)||L(s,t))return!0}return!1}function D(e){const t=e.length,n=e.filter(a=>!a.banned).length,s=e.reduce((a,o)=>a+(o.size||0),0);return{total:t,enabled:n,totalSize:s}}function R(e,t,n,s){const a=g(e.path),o=g(e.fullPath||e.path),r=e.banned?"":" on",i=e.banned?"":"\u2713";return`<div class="fl${e.banned?" ban":""}" data-path="${a}" data-fullpath="${o}">
<span class="ck${r}" data-path="${a}" data-fullpath="${o}">${i}</span>
<span class="ficon">${n}</span>
<span class="nm">${t}</span>
<span class="sz">${j(e.size)}</span>${s?`<span class="dt">${s}</span>`:""}</div>`}function F(e,t,n,s){const a=s?"\u{1F512}":"\u{1F4C1}",o=s?"#585b70":"#a6adc8",r=s?" locked":"",i=n?"\u25BC":"\u25B6",d=n?" open":"";return`<div class="fh${r}" data-dir="${g(t)}">
<span class="ar${d}">${i}</span>
<span class="nm" style="color:${o}">${a} ${g(e)}</span></div>
<div class="ch" style="display:${n?"block":"none"}">`}function g(e){return(e||"").replace(/"/g,"&quot;").replace(/</g,"&lt;")}function j(e){return!e&&e!==0?"":e<1024?e+" B":e<1048576?(e/1024).toFixed(1)+" KB":(e/1048576).toFixed(1)+" MB"}function N(e,t,n,s,a){if(!t.length){e.innerHTML=w("\u{1F4C1}","\u6682\u65E0\u6A21\u578B\u6587\u4EF6");return}const o=O(t,s,n),r=T(o,"",n,s,a);if(!r){e.innerHTML=w("\u{1F50D}","\u672A\u627E\u5230\u5339\u914D\u7684\u6587\u4EF6");return}e.innerHTML=r}function q(e,t){if(!e)return;const n=D(t);e.textContent=`\u5171 ${n.total} \u9879 (\u5DF2\u542F\u7528 ${n.enabled}) \xB7 ${A(n.totalSize)}`}function T(e,t,n,s,a){const o=!!(n||"").trim(),r=Object.keys(e).sort((d,c)=>{const u=!e[d]._e,p=!e[c]._e;if(u&&!p)return-1;if(!u&&p)return 1;const f=e[d]._e,l=e[c]._e;return s==="size"?((l==null?void 0:l.size)||0)-((f==null?void 0:f.size)||0):s==="date"?((l==null?void 0:l.modTime)||0)-((f==null?void 0:f.modTime)||0):d.localeCompare(c)});let i="";return r.forEach(d=>{const c=e[d],u=t?t+"/"+d:d;if(c._e){const p=c._e;if(o&&!p.name.toLowerCase().includes(n.toLowerCase()))return;const f=o?B(p.name,n):p.name,l=p.modTime?I(p.modTime):"",y=P(p.name);i+=R(p,f,y,l)}else{const p=d.startsWith("_"),f=o||!!a[u],l=o?L(c,n.toLowerCase()):!1;i+=F(d,u,f||o&&l,p),i+=T(c,u,n,s,a),i+="</div>"}}),i}function m(e){!e||(e.classList.add("flash"),setTimeout(()=>e.classList.remove("flash"),400))}function U(e,t){e.querySelectorAll(".fh").forEach(n=>{n.onclick=s=>{s.stopPropagation();const a=n.nextElementSibling,o=n.querySelector(".ar");if(!a)return;const r=a.style.display!=="none";a.style.display=r?"none":"block",o.classList.toggle("open",!r),t._dirOpen[n.dataset.dir]=!r,localStorage.setItem("at_dirs",JSON.stringify(t._dirOpen))}}),e.querySelectorAll(".ck").forEach(n=>{n.onclick=s=>{s.stopPropagation();const a=n.classList.contains("on");n.classList.toggle("on"),n.textContent=n.classList.contains("on")?"\u2713":"";const o=n.closest(".fl");o&&o.classList.add("flash"),setTimeout(()=>o==null?void 0:o.classList.remove("flash"),400);const r=n.dataset.path,i=n.dataset.fullpath||r;bus.emit("entry:toggle",{path:i,relPath:r,enabled:!a})}}),e.querySelectorAll(".fl").forEach(n=>{n.oncontextmenu=s=>{var i,d,c;s.preventDefault();const a=((d=(i=n.querySelector(".nm"))==null?void 0:i.textContent)==null?void 0:d.replace(/^\S+\s/,""))||"",o=!((c=n.querySelector(".ck"))!=null&&c.classList.contains("on")),r=n.dataset.fullpath||n.dataset.path;bus.emit("ctx:show",{x:s.clientX,y:s.clientY,path:r,relPath:n.dataset.path,name:a,banned:o})}})}function Y(e,t){var a,o,r,i,d,c,u,p,f;const n=l=>e.getElementById(l),s=()=>t._renderTree();(a=n("srch"))==null||a.addEventListener("input",l=>{t._search=l.target.value,s()}),(o=n("sort"))==null||o.addEventListener("change",l=>{t._sort=l.target.value,s()}),(r=n("btn-repo"))==null||r.addEventListener("click",()=>bus.emit("dir:select-repo")),(i=n("btn-dedup"))==null||i.addEventListener("click",()=>bus.emit("entries:dedup")),(d=n("btn-trash"))==null||d.addEventListener("click",()=>bus.emit("recycle:open")),(c=n("btn-pv"))==null||c.addEventListener("click",()=>bus.emit("preview:toggle")),(u=n("btn-ea"))==null||u.addEventListener("click",()=>{m(n("btn-ea")),t._entries.forEach(l=>{l.banned=!1}),s()}),(p=n("btn-da"))==null||p.addEventListener("click",()=>{m(n("btn-da")),t._entries.forEach(l=>{l.banned=!0}),s()}),(f=n("btn-st"))==null||f.addEventListener("click",()=>m(n("btn-st")))}function K(e){return window.go.main.App.IsFileBanned(e)}function J(){return window.go.main.App.LoadAppConfig()}function W(e,t,n){return window.go.main.App.SaveAppConfig(e,t,n)}function G(e){return window.go.main.App.ScanModelEntries(e)}function V(){return window.go.main.App.SelectDirectory()}function X(e){return window.go.main.App.ToggleModelEnable(e)}async function E(){const e=await J(),t=e.repoRoot||e.RepoRoot||"";if(!t)return null;const n=await G(t);if(!n||!n.length)return null;const s=[];for(const a of n){let o=!1;try{o=await K(a.Path)}catch{}let r=a.Path;t&&a.Path.startsWith(t)&&(r=a.Path.slice(t.length).replace(/^[/\\]+/,"")),s.push({name:a.Name,path:r,fullPath:a.Path,size:a.Size,modTime:a.ModTime,banned:o})}return{repoRoot:t,entries:s}}function h(){const e=Date.now();return[{name:"steve_skin.ysm",path:"steve_skin.ysm",size:1258291,modTime:e-864e5,banned:!1},{name:"alex_deluxe.ysm",path:"alex/alex_deluxe.ysm",size:2516582,modTime:e-1728e5,banned:!1},{name:"alex_head.ysm",path:"alex/alex_head.ysm",size:524288,modTime:e-1728e5,banned:!1},{name:"dragon_armor.zip",path:"dragon/dragon_armor.zip",size:3984588,modTime:e-36e5,banned:!1},{name:"dragon_wings.ysm",path:"dragon/dragon_wings.ysm",size:2202009,modTime:e-72e5,banned:!1},{name:"neon_sword.ysm",path:"weapons/neon_sword.ysm",size:1572864,modTime:e,banned:!1},{name:"magic_staff.zip",path:"weapons/magic_staff.zip",size:4404019,modTime:e-72e5,banned:!1},{name:"photon_body.ysm",path:"photon/photon_body.ysm",size:2202009,modTime:e-432e5,banned:!1},{name:"old_model.ysm",path:"_disabled/old_model.ysm",size:943718,modTime:e-6048e5,banned:!0},{name:"custom_hat.ysm",path:"custom/custom_hat.ysm",size:838860,modTime:e-2592e5,banned:!1},{name:"steve_2d.ysm",path:"custom/steve_2d.ysm",size:314572,modTime:e-5e5,banned:!1}]}function Q(e){const t=[];return t.push(bus.on("entry:toggle",async({path:n})=>{try{await X(n)}catch{}await _(e)})),t.push(bus.on("dir:select-repo",async()=>{try{const n=await V();if(!n)return;await W(n,"","copy"),e._repoRoot=n,await _(e)}catch{e._entries=h(),e._renderTree()}})),t.push(bus.on("entries:dedup",()=>{bus.emit("toast:show",{msg:"\u{1F517} \u53BB\u91CD\u529F\u80FD\u5F00\u53D1\u4E2D",duration:2e3,type:"info"})})),t.push(bus.on("recycle:open",()=>{bus.emit("toast:show",{msg:"\u{1F5D1}\uFE0F \u56DE\u6536\u7AD9\u529F\u80FD\u5F00\u53D1\u4E2D",duration:2e3,type:"info"})})),t}async function _(e){try{const t=await E();t?(e._repoRoot=t.repoRoot,e._entries=t.entries):e._entries=h()}catch{e._entries=h()}e._renderTree()}class Z extends HTMLElement{constructor(){super(),this._root=this.attachShadow({mode:"open"}),this._root.adoptedStyleSheets=[new CSSStyleSheet],this._root.adoptedStyleSheets[0].replaceSync(C),this._entries=[],this._search="",this._sort="name",this._dirOpen={},this._repoRoot=""}async connectedCallback(){try{Object.assign(this._dirOpen,JSON.parse(localStorage.getItem("at_dirs")||"{}"))}catch{}this._renderLayout(),Y(this._root,this),this._unsubs=Q(this),await this._load(),this._renderTree()}disconnectedCallback(){var t;(t=this._unsubs)==null||t.forEach(n=>n==null?void 0:n())}async _load(){try{const t=await E();t?(this._repoRoot=t.repoRoot,this._entries=t.entries):this._entries=h()}catch{this._entries=h()}}_renderLayout(){this._root.innerHTML=$()+'<div class="list" id="tree"><div class="empty"><div class="big">\u{1F4C1}</div>\u6682\u65E0\u6A21\u578B\u6587\u4EF6</div></div>'+H()}_renderTree(){const t=this._root.getElementById("tree");N(t,this._entries,this._search,this._sort,this._dirOpen),U(t,this),q(this._root.getElementById("ftr-stat"),this._entries)}}customElements.define("app-tree",Z);const ee=`
:host {
  display: flex; flex-direction: column;
  background: #11111b;
  border-right: 1px solid rgba(255,255,255,.06);
  width: 280px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
}
.header { padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,.06); }
.header-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.header-label { font-size: 12px; font-weight: 600; color: #a6adc8; text-transform: uppercase; letter-spacing: .5px; flex: 1; }
.header-stat { font-size: 10px; color: #6c7086; }
.search-input {
  width: 100%; padding: 5px 8px; border-radius: 6px;
  border: 1px solid rgba(255,255,255,.08); background: #181825;
  color: #cdd6f4; font-size: 11px; outline: none; font-family: inherit;
}
.search-input::placeholder { color: #6c7086; }
.list { flex: 1; overflow-y: auto; padding: 4px 6px; }
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
`;function te(){return`<div class="header">
<div class="header-row">
<span class="header-label">\u{1F4C2} \u7248\u672C\u5217\u8868</span>
<span class="header-stat" id="ver-stat">4\u4E2A\u6574\u5408\u5305</span>
</div>
<input class="search-input" id="ver-search" type="text" placeholder="\u{1F50D} \u641C\u7D22\u6574\u5408\u5305" autocomplete="off" autocapitalize="off">
</div>`}function ne(){return`<div class="footer">
<button class="footer-btn" id="btn-mc">\u{1F3AE} \u6307\u5B9A\u6E38\u620F\u8DEF\u5F84</button>
</div>`}function se(){return'<div class="list" id="vg"></div>'}function ae(e,t,n){const s=[];return t>0&&s.push(`<span class="tag green">\u2705 ${t}</span>`),n>0&&s.push(`<span class="tag red">\u2B07\uFE0F ${n}</span>`),`<div class="vc-header">
<span class="arrow">\u25B6</span>
<span class="name">\u{1F4E6} ${M(e)}</span>
${s.join("")}
</div>`}function x(e,t){return`<div class="sec-title">${e} (${t})</div>`}function v(e,t,n){return`<div class="row"><span class="dot" style="background:${e}"></span><span class="rn">${M(t)}</span><span class="sz">${n}</span></div>`}function M(e){return(e||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}const oe=[{name:"\u6211\u7684\u6574\u5408\u5305",synced:3,missing:1,extra:2,items:{synced:[{name:"steve_skin.ysm",size:"1.2 MB"},{name:"alex_deluxe.ysm",size:"2.4 MB"},{name:"neon_sword.ysm",size:"1.5 MB"}],missing:[{name:"dragon_armor.zip",size:"3.8 MB"}],extra:[{name:"custom_hat.ysm",size:"0.8 MB"},{name:"old_hat.ysm",size:"0.3 MB"}]}},{name:"\u5149\u5F71\u6D4B\u8BD5\u5305",synced:1,missing:2,extra:0,items:{synced:[],missing:[],extra:[]}},{name:"\u7A7A\u5C9B\u751F\u5B58",synced:5,missing:0,extra:0,items:{synced:[],missing:[],extra:[]}},{name:"RPG \u5192\u9669",synced:2,missing:3,extra:0,items:{synced:[],missing:[],extra:[]}}];function re(e,t){e.innerHTML="",t.forEach((n,s)=>{const a=document.createElement("div");a.className="vc",a.dataset.idx=s,a.innerHTML=ae(n.name,n.synced,n.missing),e.appendChild(a);const o=document.createElement("div");o.className="vc-body",o.style.display=s===0?"":"none",o.innerHTML=ie(n),e.appendChild(o)})}function ie(e){let t="";return e.items.synced.length&&(t+=x("\u2705 \u5DF2\u540C\u6B65",e.items.synced.length),e.items.synced.forEach(n=>{t+=v("#a6e3a1",n.name,n.size)})),e.items.missing.length&&(t+=x("\u2B07\uFE0F \u7F3A\u5931",e.items.missing.length),e.items.missing.forEach(n=>{t+=v("#f38ba8",n.name,n.size)})),e.items.extra.length&&(t+=x("\u{1F4E4} \u989D\u5916",e.items.extra.length),e.items.extra.forEach(n=>{t+=v("#f9a826",n.name,n.size)})),t}function de(e){e.querySelectorAll(".vc-header").forEach(t=>{t.onclick=()=>{const n=t.nextElementSibling,s=t.querySelector(".arrow");n&&n.classList.contains("vc-body")&&(n.style.display=n.style.display==="none"?"":"none",s.classList.toggle("open"))}})}function ce(e){const t=e.getElementById("ver-search");t&&(t.oninput=n=>{bus.emit("ver:search",{keyword:n.target.value})})}function le(e){const t=e.getElementById("btn-mc");t&&(t.onclick=()=>bus.emit("dir:select-mc"))}function pe(e,t){t.push(bus.on("versions:updated",({instances:n})=>{const s=e.getElementById("ver-stat");s&&(s.textContent=`${n.length}\u4E2A\u6574\u5408\u5305`)}))}class fe extends HTMLElement{constructor(){super(),this._root=this.attachShadow({mode:"open"}),this._root.adoptedStyleSheets=[new CSSStyleSheet],this._root.adoptedStyleSheets[0].replaceSync(ee),this._instances=oe,this._unsubs=[]}connectedCallback(){this._renderLayout(),re(this._root.getElementById("vg"),this._instances),de(this._root),ce(this._root),le(this._root),pe(this._root,this._unsubs)}disconnectedCallback(){this._unsubs.forEach(t=>t())}_renderLayout(){this._root.innerHTML=te()+se()+ne()}}customElements.define("app-sidebar",fe);const ue=`
:host {
  display: flex; flex-direction: column;
  background: #11111b;
  border-left: 1px solid rgba(255,255,255,.06);
  width: 200px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
}
.content { padding: 12px; }
h3 { font-size: 12px; font-weight: 600; color: #a6adc8; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 10px; }
.stat-row { font-size: 11px; color: #cdd6f4; padding: 3px 0; display: flex; justify-content: space-between; }
.stat-row .label { color: #6c7086; }
.stat-row .value { color: #fff; font-weight: 500; }
.stat-row .value.accent { color: #7c83ff; }
.divider { border: none; border-top: 1px solid rgba(255,255,255,.06); margin: 8px 0; }
.btn-group { display: flex; flex-direction: column; gap: 4px; }
.btn {
  padding: 6px 0; border-radius: 6px;
  border: 1px solid rgba(255,255,255,.08); background: transparent;
  color: #cdd6f4; cursor: pointer; font-size: 11px; font-family: inherit; transition: background .12s;
}
.btn:hover { background: #2a2a42; }
.btn.accent { background: #7c83ff33; color: #7c83ff; border-color: #7c83ff55; }
.btn.accent:hover { background: #7c83ff55; }
.btn.warn { background: #f9a82622; color: #f9a826; border-color: #f9a82655; }
.btn .tag { font-size: 7px; background: #f9a82633; color: #f9a826; padding: 0 4px; border-radius: 3px; margin-left: 4px; }
`;function he(){return`<div class="content">
<h3>\u{1F4CA} \u7EDF\u8BA1</h3>
<div class="stat-row"><span class="label">\u4ED3\u5E93\u6A21\u578B</span><span class="value" id="s-repo">0</span></div>
<div class="stat-row"><span class="label">\u6574\u5408\u5305\u6570</span><span class="value" id="s-ver">0</span></div>
<div class="stat-row"><span class="label">\u5B8C\u5168\u540C\u6B65</span><span class="value" id="s-ok">0</span></div>
<div class="stat-row"><span class="label">\u5F85\u4E0A\u4F20</span><span class="value accent" id="s-pending">0</span></div>
<hr class="divider">
<div class="btn-group">
<button class="btn" id="btn-refresh">\u{1F504} \u5237\u65B0</button>
<button class="btn warn" id="btn-upload">\u{1F4E4} \u4E0A\u4F20\u5F85\u4E0A\u4F20</button>
<button class="btn" id="btn-logs">\u{1F4CB} \u65E5\u5FD7</button>
</div>
</div>`}const be={repo:6,ver:4,ok:2,tot:4,pending:2};function k(e,t){const n=s=>e.getElementById(s);n("s-repo")&&(n("s-repo").textContent=t.repo),n("s-ver")&&(n("s-ver").textContent=t.ver),n("s-ok")&&(n("s-ok").textContent=t.ok),n("s-tot")&&(n("s-tot").textContent=t.tot),n("s-pending")&&(n("s-pending").textContent=t.pending)}function ge(e){var t,n,s;(t=e.getElementById("btn-refresh"))==null||t.addEventListener("click",()=>bus.emit("stats:refresh")),(n=e.getElementById("btn-upload"))==null||n.addEventListener("click",()=>bus.emit("stats:upload")),(s=e.getElementById("btn-logs"))==null||s.addEventListener("click",()=>bus.emit("stats:logs"))}function me(e,t,n){n.push(bus.on("stats:updated",s=>{s&&Object.assign(t,s),bus.emit("_preview:needs-update")}))}class xe extends HTMLElement{constructor(){super(),this._root=this.attachShadow({mode:"open"}),this._root.adoptedStyleSheets=[new CSSStyleSheet],this._root.adoptedStyleSheets[0].replaceSync(ue),this._stats={...be},this._unsubs=[]}connectedCallback(){this._renderLayout(),ge(this._root),me(this._root,this._stats,this._unsubs),this._unsubs.push(bus.on("_preview:needs-update",()=>{k(this._root,this._stats)})),k(this._root,this._stats)}disconnectedCallback(){this._unsubs.forEach(t=>t())}_renderLayout(){this._root.innerHTML=he()}}customElements.define("app-preview",xe);const ve=`
:host { display:flex; flex-direction:column; flex:1; overflow:hidden; font-family:-apple-system,sans-serif; background:#1e1e2e; }
.page { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.section-title { font-size:14px; font-weight:600; color:#fff; padding:16px 16px 8px; }
.card-row { display:flex; gap:12px; padding:0 16px; }
.stat-card { flex:1; background:#181825; border:1px solid rgba(255,255,255,.06); border-radius:10px; padding:14px; }
.stat-card .num { font-size:24px; font-weight:700; color:#7c83ff; }
.stat-card .label { font-size:11px; color:#6c7086; margin-top:2px; }
.stat-card .sub { font-size:10px; color:#a6adc8; margin-top:6px; }
.placeholder-box { flex:1; display:flex; align-items:center; justify-content:center; flex-direction:column; color:#6c7086; font-size:12px; gap:8px; }
.placeholder-box .big { font-size:48px; }
.ptag { font-size:9px; background:#f9a82633; color:#f9a826; padding:2px 8px; border-radius:4px; }
.repo-layout { flex:1; display:flex; overflow:hidden; height:100%; }
.repo-layout app-sidebar { width:280px; flex-shrink:0; }
.settings-group { padding:0 16px; }
.setting-row { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:#181825; border-radius:6px; margin-bottom:4px; font-size:12px; }
.setting-row .label { color:#cdd6f4; }
.setting-row .value { color:#6c7086; }
`;function S(){return`<div style="flex:1;display:flex;flex-direction:column;overflow-y:auto">
<div class="section-title">\u{1F3E0} \u4EEA\u8868\u76D8</div>
<div class="card-row">
<div class="stat-card"><div class="num">6</div><div class="label">\u4ED3\u5E93\u6A21\u578B</div><div class="sub">\u5DF2\u542F\u7528: 5</div></div>
<div class="stat-card"><div class="num">4</div><div class="label">\u6574\u5408\u5305</div><div class="sub">\u5B8C\u5168\u540C\u6B65: 2</div></div>
<div class="stat-card"><div class="num">2</div><div class="label">\u5F85\u5904\u7406</div><div class="sub">\u5F85\u4E0A\u4F20: 2</div></div>
<div class="stat-card"><div class="num">\u2014</div><div class="label">\u6708\u540C\u6B65</div><div class="sub"><span class="ptag">\u9884\u544A</span></div></div>
</div>
<div style="padding:16px">
<div style="font-size:11px;color:#6c7086;margin-bottom:8px">\u6700\u8FD1\u4F7F\u7528\u7684\u6574\u5408\u5305</div>
<div style="display:flex;gap:8px">
<div style="background:#181825;border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:10px;font-size:11px;flex:1"><b>\u{1F4E6} \u6211\u7684\u6574\u5408\u5305</b><br><span style="color:#6c7086">\u2705 \u5DF2\u540C\u6B65 3/4</span></div>
<div style="background:#181825;border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:10px;font-size:11px;flex:1"><b>\u{1F4E6} \u5149\u5F71\u6D4B\u8BD5\u5305</b><br><span style="color:#f38ba8">\u2B07\uFE0F \u7F3A\u5931 2/3</span></div>
</div>
</div>
</div>`}function ye(){return'<div class="repo-layout"><app-tree></app-tree></div>'}function we(){return'<div class="repo-layout"><app-sidebar></app-sidebar><app-preview></app-preview></div>'}function _e(){return`<div style="flex:1;overflow-y:auto">
<div class="section-title">\u2699\uFE0F \u8BBE\u7F6E</div>
<div class="settings-group">
<div class="setting-row"><span class="label">\u{1F3AE} \u6E38\u620F\u8DEF\u5F84</span><span class="value">\u672A\u8BBE\u7F6E <span class="ptag" style="margin-left:4px">\u9884\u544A</span></span></div>
<div class="setting-row"><span class="label">\u{1F4C1} \u4ED3\u5E93\u8DEF\u5F84</span><span class="value">\u672A\u8BBE\u7F6E <span class="ptag" style="margin-left:4px">\u9884\u544A</span></span></div>
<div class="setting-row"><span class="label">\u{1F319} \u4E3B\u9898</span><span class="value">\u6697\u8272</span></div>
<div class="setting-row"><span class="label">\u{1F517} \u94FE\u63A5\u6A21\u5F0F</span><span class="value">\u786C\u94FE\u63A5 <span class="ptag" style="margin-left:4px">\u9884\u544A</span></span></div>
</div>
</div>`}function z(e,t){return`<div class="placeholder-box"><div class="big">${e}</div><div>${t}</div><span class="ptag">\u9884\u544A</span></div>`}class ke extends HTMLElement{constructor(){super(),this._root=this.attachShadow({mode:"open"}),this._root.adoptedStyleSheets=[new CSSStyleSheet],this._root.adoptedStyleSheets[0].replaceSync(ve),this._current="dashboard"}connectedCallback(){this._unsub=bus.on("nav:change",({page:t})=>{this._current=t,bus.emit("nav:changed",{page:t}),this._render()}),this._render()}disconnectedCallback(){this._unsub&&this._unsub()}_render(){let t="";switch(this._current){case"dashboard":t=S();break;case"repository":t=ye();break;case"instances":t=we();break;case"downloads":t=z("\u2B07\uFE0F","\u4E0B\u8F7D\u4E0E\u66F4\u65B0");break;case"diagnostics":t=z("\u{1F6E0}\uFE0F","\u8BCA\u65AD\u4E0E\u51B2\u7A81\u68C0\u6D4B");break;case"settings":t=_e();break;default:t=S()}this._root.innerHTML=`<div class="page">${t}</div>`}}customElements.define("app-content",ke);
