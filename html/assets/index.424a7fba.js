(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))a(s);new MutationObserver(s=>{for(const o of s)if(o.type==="childList")for(const r of o.addedNodes)r.tagName==="LINK"&&r.rel==="modulepreload"&&a(r)}).observe(document,{childList:!0,subtree:!0});function n(s){const o={};return s.integrity&&(o.integrity=s.integrity),s.referrerpolicy&&(o.referrerPolicy=s.referrerpolicy),s.crossorigin==="use-credentials"?o.credentials="include":s.crossorigin==="anonymous"?o.credentials="omit":o.credentials="same-origin",o}function a(s){if(s.ep)return;s.ep=!0;const o=n(s);fetch(s.href,o)}})();const N=`
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
`;function j(){return`<div class="hdr">
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
</div>`}function q(){return`<div class="ftr">
<span class="stat" id="ftr-stat">\u5171 0 \u9879</span>
<button class="hdr-btn" id="btn-repo">\u{1F4C1} \u9009\u62E9\u4ED3\u5E93\u76EE\u5F55</button>
<button class="hdr-btn" id="btn-dedup">\u{1F517} \u53BB\u91CD <span class="tag">\u9884\u544A</span></button>
<button class="hdr-btn" id="btn-trash">\u{1F5D1}\uFE0F \u56DE\u6536\u7AD9</button>
<div style="flex:1"></div>
<button class="hdr-btn" id="btn-pv">\u25C0 \u9884\u89C8</button>
</div>`}function M(e,t){return`<div class="empty"><div class="big">${e}</div>${t}</div>`}function v(e){return(e||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function Y(e,t){const n=v(e);if(!t)return n;const a=t.toLowerCase(),s=e.toLowerCase().indexOf(a);if(s===-1)return n;const o=v(e.substring(0,s)),r=v(e.substring(s,s+t.length)),i=v(e.substring(s+t.length));return o+"<mark>"+r+"</mark>"+i}function U(e){return!e&&e!==0?"":e<1024?e+" B":e<1048576?(e/1024).toFixed(1)+" KB":(e/1048576).toFixed(1)+" MB"}function K(e){if(!e)return"";const t=new Date(e),n=new Date;return t.toDateString()===n.toDateString()?t.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):(n-t)/864e5<7?["\u65E5","\u4E00","\u4E8C","\u4E09","\u56DB","\u4E94","\u516D"][t.getDay()]+" "+t.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):t.toLocaleDateString([],{month:"short",day:"numeric"})}function G(e){const t=(e.split(".").pop()||"").toLowerCase();return t==="ysm"?"\u{1F48E}":["zip","rar","7z","tar","gz"].includes(t)?"\u{1F4E6}":["png","jpg","jpeg","gif","webp","bmp"].includes(t)?"\u{1F5BC}\uFE0F":["txt","md","json","xml","yml","yaml","cfg","conf","ini"].includes(t)?"\u{1F4C4}":"\u{1F9CA}"}function V(e,t,n){const a=[...e].sort((r,i)=>t==="size"?(i.size||0)-(r.size||0):t==="date"?(i.modTime||0)-(r.modTime||0):r.name.localeCompare(i.name)),s=(n||"").trim().toLowerCase(),o={};return a.forEach(r=>{if(s&&!r.name.toLowerCase().includes(s))return;const i=r.path.replace(/\\/g,"/").split("/");let d=o;for(let c=0;c<i.length-1;c++)!i[c]||(d[i[c]]||(d[i[c]]={}),d=d[i[c]]);d[i[i.length-1]]={_e:r}}),o}function A(e,t){if(!t||!e)return!1;for(const n of Object.keys(e)){const a=e[n];if(a._e){if(a._e.name.toLowerCase().includes(t))return!0}else if(n.toLowerCase().includes(t)||A(a,t))return!0}return!1}function J(e){const t=e.length,n=e.filter(s=>!s.banned).length,a=e.reduce((s,o)=>s+(o.size||0),0);return{total:t,enabled:n,totalSize:a}}function W(e,t,n,a){const s=y(e.path),o=y(e.fullPath||e.path),r=e.banned?"":" on",i=e.banned?"":"\u2713";return`<div class="fl${e.banned?" ban":""}" data-path="${s}" data-fullpath="${o}">
<span class="ck${r}" data-path="${s}" data-fullpath="${o}">${i}</span>
<span class="ficon">${n}</span>
<span class="nm">${t}</span>
<span class="sz">${Q(e.size)}</span>${a?`<span class="dt">${a}</span>`:""}</div>`}function X(e,t,n,a){const s=a?"\u{1F512}":"\u{1F4C1}",o=a?"#585b70":"#a6adc8",r=a?" locked":"",i=n?"\u25BC":"\u25B6",d=n?" open":"";return`<div class="fh${r}" data-dir="${y(t)}">
<span class="ar${d}">${i}</span>
<span class="nm" style="color:${o}">${s} ${y(e)}</span></div>
<div class="ch" style="display:${n?"block":"none"}">`}function y(e){return(e||"").replace(/"/g,"&quot;").replace(/</g,"&lt;")}function Q(e){return!e&&e!==0?"":e<1024?e+" B":e<1048576?(e/1024).toFixed(1)+" KB":(e/1048576).toFixed(1)+" MB"}function Z(e,t,n,a,s){if(!t.length){e.innerHTML=M("\u{1F4C1}","\u6682\u65E0\u6A21\u578B\u6587\u4EF6");return}const o=V(t,a,n),r=R(o,"",n,a,s);if(!r){e.innerHTML=M("\u{1F50D}","\u672A\u627E\u5230\u5339\u914D\u7684\u6587\u4EF6");return}e.innerHTML=r}function ee(e,t){if(!e)return;const n=J(t);e.textContent=`\u5171 ${n.total} \u9879 (\u5DF2\u542F\u7528 ${n.enabled}) \xB7 ${U(n.totalSize)}`}function R(e,t,n,a,s){const o=!!(n||"").trim(),r=Object.keys(e).sort((d,c)=>{const h=!e[d]._e,f=!e[c]._e;if(h&&!f)return-1;if(!h&&f)return 1;const u=e[d]._e,l=e[c]._e;return a==="size"?((l==null?void 0:l.size)||0)-((u==null?void 0:u.size)||0):a==="date"?((l==null?void 0:l.modTime)||0)-((u==null?void 0:u.modTime)||0):d.localeCompare(c)});let i="";return r.forEach(d=>{const c=e[d],h=t?t+"/"+d:d;if(c._e){const f=c._e;if(o&&!f.name.toLowerCase().includes(n.toLowerCase()))return;const u=o?Y(f.name,n):f.name,l=f.modTime?K(f.modTime):"",g=G(f.name);i+=W(f,u,g,l)}else{const f=d.startsWith("_"),u=o||!!s[h],l=o?A(c,n.toLowerCase()):!1;i+=X(d,h,u||o&&l,f),i+=R(c,h,n,a,s),i+="</div>"}}),i}function k(e){!e||(e.classList.add("flash"),setTimeout(()=>e.classList.remove("flash"),400))}function te(e,t){e.querySelectorAll(".fh").forEach(n=>{n.onclick=a=>{a.stopPropagation();const s=n.nextElementSibling,o=n.querySelector(".ar");if(!s)return;const r=s.style.display!=="none";s.style.display=r?"none":"block",o.classList.toggle("open",!r),t._dirOpen[n.dataset.dir]=!r,localStorage.setItem("at_dirs",JSON.stringify(t._dirOpen))}}),e.querySelectorAll(".ck").forEach(n=>{n.onclick=a=>{a.stopPropagation();const s=n.classList.contains("on");n.classList.toggle("on"),n.textContent=n.classList.contains("on")?"\u2713":"";const o=n.closest(".fl");o&&o.classList.add("flash"),setTimeout(()=>o==null?void 0:o.classList.remove("flash"),400);const r=n.dataset.path,i=n.dataset.fullpath||r;bus.emit("entry:toggle",{path:i,relPath:r,enabled:!s})}}),e.querySelectorAll(".fl").forEach(n=>{n.oncontextmenu=a=>{var i,d,c;a.preventDefault();const s=((d=(i=n.querySelector(".nm"))==null?void 0:i.textContent)==null?void 0:d.replace(/^\S+\s/,""))||"",o=!((c=n.querySelector(".ck"))!=null&&c.classList.contains("on")),r=n.dataset.fullpath||n.dataset.path;bus.emit("ctx:show",{x:a.clientX,y:a.clientY,path:r,relPath:n.dataset.path,name:s,banned:o})}})}function ne(e,t){var s,o,r,i,d,c,h,f,u;const n=l=>e.getElementById(l),a=()=>t._renderTree();(s=n("srch"))==null||s.addEventListener("input",l=>{t._search=l.target.value,a()}),(o=n("sort"))==null||o.addEventListener("change",l=>{t._sort=l.target.value,a()}),(r=n("btn-repo"))==null||r.addEventListener("click",()=>bus.emit("dir:select-repo")),(i=n("btn-dedup"))==null||i.addEventListener("click",()=>bus.emit("entries:dedup")),(d=n("btn-trash"))==null||d.addEventListener("click",()=>bus.emit("recycle:open")),(c=n("btn-pv"))==null||c.addEventListener("click",()=>bus.emit("preview:toggle")),(h=n("btn-ea"))==null||h.addEventListener("click",()=>{k(n("btn-ea")),t._entries.forEach(l=>{l.banned=!1}),a()}),(f=n("btn-da"))==null||f.addEventListener("click",()=>{k(n("btn-da")),t._entries.forEach(l=>{l.banned=!0}),a()}),(u=n("btn-st"))==null||u.addEventListener("click",()=>k(n("btn-st")))}function se(e,t){return window.go.main.App.GetInstanceStatus(e,t)}function ae(e){return window.go.main.App.IsFileBanned(e)}function oe(e){return window.go.main.App.ListVersionInstances(e)}function T(){return window.go.main.App.LoadAppConfig()}function P(e,t,n){return window.go.main.App.SaveAppConfig(e,t,n)}function L(e){return window.go.main.App.ScanModelEntries(e)}function D(){return window.go.main.App.SelectDirectory()}function re(e){return window.go.main.App.ToggleModelEnable(e)}async function F(){const e=await T(),t=e.repoRoot||e.RepoRoot||"";if(!t)return null;const n=await L(t);if(!n||!n.length)return null;const a=[];for(const s of n){let o=!1;try{o=await ae(s.Path)}catch{}let r=s.Path;t&&s.Path.startsWith(t)&&(r=s.Path.slice(t.length).replace(/^[/\\]+/,"")),a.push({name:s.Name,path:r,fullPath:s.Path,size:s.Size,modTime:s.ModTime,banned:o})}return{repoRoot:t,entries:a}}function b(){const e=Date.now();return[{name:"steve_skin.ysm",path:"steve_skin.ysm",size:1258291,modTime:e-864e5,banned:!1},{name:"alex_deluxe.ysm",path:"alex/alex_deluxe.ysm",size:2516582,modTime:e-1728e5,banned:!1},{name:"alex_head.ysm",path:"alex/alex_head.ysm",size:524288,modTime:e-1728e5,banned:!1},{name:"dragon_armor.zip",path:"dragon/dragon_armor.zip",size:3984588,modTime:e-36e5,banned:!1},{name:"dragon_wings.ysm",path:"dragon/dragon_wings.ysm",size:2202009,modTime:e-72e5,banned:!1},{name:"neon_sword.ysm",path:"weapons/neon_sword.ysm",size:1572864,modTime:e,banned:!1},{name:"magic_staff.zip",path:"weapons/magic_staff.zip",size:4404019,modTime:e-72e5,banned:!1},{name:"photon_body.ysm",path:"photon/photon_body.ysm",size:2202009,modTime:e-432e5,banned:!1},{name:"old_model.ysm",path:"_disabled/old_model.ysm",size:943718,modTime:e-6048e5,banned:!0},{name:"custom_hat.ysm",path:"custom/custom_hat.ysm",size:838860,modTime:e-2592e5,banned:!1},{name:"steve_2d.ysm",path:"custom/steve_2d.ysm",size:314572,modTime:e-5e5,banned:!1}]}function ie(e){const t=[];return t.push(bus.on("entry:toggle",async({path:n})=>{try{await re(n)}catch{}await C(e)})),t.push(bus.on("dir:select-repo",async()=>{try{const n=await D();if(!n)return;await P(n,"","copy"),e._repoRoot=n,await C(e)}catch{e._entries=b(),e._renderTree()}})),t.push(bus.on("entries:dedup",()=>{bus.emit("toast:show",{msg:"\u{1F517} \u53BB\u91CD\u529F\u80FD\u5F00\u53D1\u4E2D",duration:2e3,type:"info"})})),t.push(bus.on("recycle:open",()=>{bus.emit("toast:show",{msg:"\u{1F5D1}\uFE0F \u56DE\u6536\u7AD9\u529F\u80FD\u5F00\u53D1\u4E2D",duration:2e3,type:"info"})})),t}async function C(e){try{const t=await F();t?(e._repoRoot=t.repoRoot,e._entries=t.entries):e._entries=b()}catch{e._entries=b()}e._renderTree()}class ce extends HTMLElement{constructor(){super(),this._root=this.attachShadow({mode:"open"}),this._root.adoptedStyleSheets=[new CSSStyleSheet],this._root.adoptedStyleSheets[0].replaceSync(N),this._entries=[],this._search="",this._sort="name",this._dirOpen={},this._repoRoot=""}async connectedCallback(){try{Object.assign(this._dirOpen,JSON.parse(localStorage.getItem("at_dirs")||"{}"))}catch{}this._renderLayout(),ne(this._root,this),this._unsubs=ie(this),await this._load(),this._renderTree()}disconnectedCallback(){var t;(t=this._unsubs)==null||t.forEach(n=>n==null?void 0:n())}async _load(){try{const t=await F();t?(this._repoRoot=t.repoRoot,this._entries=t.entries):this._entries=b()}catch{this._entries=b()}}_renderLayout(){this._root.innerHTML=j()+'<div class="list" id="tree"><div class="empty"><div class="big">\u{1F4C1}</div>\u6682\u65E0\u6A21\u578B\u6587\u4EF6</div></div>'+q()}_renderTree(){const t=this._root.getElementById("tree");Z(t,this._entries,this._search,this._sort,this._dirOpen),te(t,this),ee(this._root.getElementById("ftr-stat"),this._entries)}}customElements.define("app-tree",ce);const de=`
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
`;function le(){return`<div class="header">
<div class="header-row">
<span class="header-label">\u{1F4C2} \u7248\u672C\u5217\u8868</span>
<span class="header-stat" id="ver-stat">4\u4E2A\u6574\u5408\u5305</span>
</div>
<input class="search-input" id="ver-search" type="text" placeholder="\u{1F50D} \u641C\u7D22\u6574\u5408\u5305" autocomplete="off" autocapitalize="off">
</div>`}function pe(){return`<div class="footer">
<button class="footer-btn" id="btn-mc">\u{1F3AE} \u6307\u5B9A\u6E38\u620F\u8DEF\u5F84</button>
</div>`}function fe(){return'<div class="list" id="vg"></div>'}function ue(e,t,n){const a=[];return t>0&&a.push(`<span class="tag green">\u2705 ${t}</span>`),n>0&&a.push(`<span class="tag red">\u2B07\uFE0F ${n}</span>`),`<div class="vc-header">
<span class="arrow">\u25B6</span>
<span class="name">\u{1F4E6} ${O(e)}</span>
${a.join("")}
</div>`}function S(e,t){return`<div class="sec-title">${e} (${t})</div>`}function z(e,t,n){return`<div class="row"><span class="dot" style="background:${e}"></span><span class="rn">${O(t)}</span><span class="sz">${n}</span></div>`}function O(e){return(e||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function he(e,t){e.innerHTML="",t.forEach((n,a)=>{const s=document.createElement("div");s.className="vc",s.dataset.idx=a,s.innerHTML=ue(n.name,n.synced,n.missing),e.appendChild(s);const o=document.createElement("div");o.className="vc-body",o.style.display=a===0?"":"none",o.innerHTML=be(n),e.appendChild(o)})}function be(e){let t="";return e.items.synced.length&&(t+=S("\u2705 \u5DF2\u540C\u6B65",e.items.synced.length),e.items.synced.forEach(n=>{t+=z("#a6e3a1",n.name,n.size)})),e.items.missing.length&&(t+=S("\u2B07\uFE0F \u7F3A\u5931",e.items.missing.length),e.items.missing.forEach(n=>{t+=z("#f38ba8",n.name,n.size)})),e.items.extra.length&&(t+=S("\u{1F4E4} \u989D\u5916",e.items.extra.length),e.items.extra.forEach(n=>{t+=z("#f9a826",n.name,n.size)})),t}function ge(e){e.querySelectorAll(".vc-header").forEach(t=>{t.onclick=()=>{const n=t.nextElementSibling,a=t.querySelector(".arrow");n&&n.classList.contains("vc-body")&&(n.style.display=n.style.display==="none"?"":"none",a.classList.toggle("open"))}})}function me(e){const t=e.getElementById("ver-search");t&&(t.oninput=n=>{bus.emit("ver:search",{keyword:n.target.value})})}function xe(e){const t=e.getElementById("btn-mc");t&&(t.onclick=()=>bus.emit("dir:select-mc"))}async function ve(){const e=await T(),t=e.mcRoot||e.McRoot||"",n=e.repoRoot||e.RepoRoot||"";if(!t||!n)return null;const a=await L(n),s=new Set;a.forEach(c=>s.add(c.Name.replace(/\.ban$/i,"")));const o=await oe(t);if(!o||!o.length)return null;const r=await se(t,n),i={};return(r||[]).forEach(c=>{i[c.Name]=c}),o.map(c=>{const h=i[c.Name]||{},f=h.Missing||[],u=h.Extra||[];h.Disabled;const l=new Set(f.map(p=>p.replace(/\.ban$/i,""))),g=new Set(u.map(p=>p.replace(/\.ban$/i,""))),w=[];s.forEach(p=>{!l.has(p)&&!g.has(p)&&w.push(p)});const E=[];if(c.Exists)try{const p=L(c.CustomDir),m={};(p||[]).forEach(x=>{m[x.Name.replace(/\.ban$/i,"")]=x}),E.push(...p||[])}catch{}const _=p=>{const m=E.find(x=>x.Name.replace(/\.ban$/i,"")===p.replace(/\.ban$/i,""));return m?ye(m.Size):""};return{name:c.Name,exists:c.Exists,hasYSM:h.HasYSM,synced:w.length,missing:f.length,extra:u.length,items:{synced:w.slice(0,20).map(p=>({name:p,size:_(p)})),missing:f.slice(0,20).map(p=>({name:p,size:_(p)})),extra:u.slice(0,20).map(p=>({name:p,size:_(p)}))}}})}function ye(e){return!e&&e!==0?"":e<1024?e+" B":e<1048576?(e/1024).toFixed(1)+" KB":(e/1048576).toFixed(1)+" MB"}function $(){return[{name:"\u6211\u7684\u6574\u5408\u5305",synced:3,missing:1,extra:2,items:{synced:[{name:"steve_skin.ysm",size:"1.2 MB"},{name:"alex_deluxe.ysm",size:"2.4 MB"},{name:"neon_sword.ysm",size:"1.5 MB"}],missing:[{name:"dragon_armor.zip",size:"3.8 MB"}],extra:[{name:"custom_hat.ysm",size:"0.8 MB"},{name:"old_hat.ysm",size:"0.3 MB"}]}},{name:"\u5149\u5F71\u6D4B\u8BD5\u5305",synced:1,missing:2,extra:0,items:{synced:[],missing:[],extra:[]}},{name:"\u7A7A\u5C9B\u751F\u5B58",synced:5,missing:0,extra:0,items:{synced:[],missing:[],extra:[]}},{name:"RPG \u5192\u9669",synced:2,missing:3,extra:0,items:{synced:[],missing:[],extra:[]}}]}class we extends HTMLElement{constructor(){super(),this._root=this.attachShadow({mode:"open"}),this._root.adoptedStyleSheets=[new CSSStyleSheet],this._root.adoptedStyleSheets[0].replaceSync(de),this._instances=[],this._unsubs=[]}async connectedCallback(){this._renderLayout(),this._unsubs.push(bus.on("dir:select-mc",async()=>{try{const t=await D();if(!t)return;const n=await T();await P(n.repoRoot||"",t,n.linkMode||"copy")}catch{}await this._reload()})),await this._reload()}async _reload(){try{const t=await ve();t?this._instances=t:this._instances=$()}catch{this._instances=$()}he(this._root.getElementById("vg"),this._instances),ge(this._root),me(this._root),xe(this._root)}disconnectedCallback(){this._unsubs.forEach(t=>t())}_renderLayout(){this._root.innerHTML=le()+fe()+pe()}}customElements.define("app-sidebar",we);const _e=`
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
`;function ke(){return`<div class="content">
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
</div>`}const Se={repo:6,ver:4,ok:2,tot:4,pending:2};function H(e,t){const n=a=>e.getElementById(a);n("s-repo")&&(n("s-repo").textContent=t.repo),n("s-ver")&&(n("s-ver").textContent=t.ver),n("s-ok")&&(n("s-ok").textContent=t.ok),n("s-tot")&&(n("s-tot").textContent=t.tot),n("s-pending")&&(n("s-pending").textContent=t.pending)}function ze(e){var t,n,a;(t=e.getElementById("btn-refresh"))==null||t.addEventListener("click",()=>bus.emit("stats:refresh")),(n=e.getElementById("btn-upload"))==null||n.addEventListener("click",()=>bus.emit("stats:upload")),(a=e.getElementById("btn-logs"))==null||a.addEventListener("click",()=>bus.emit("stats:logs"))}function Le(e,t,n){n.push(bus.on("stats:updated",a=>{a&&Object.assign(t,a),bus.emit("_preview:needs-update")}))}class Te extends HTMLElement{constructor(){super(),this._root=this.attachShadow({mode:"open"}),this._root.adoptedStyleSheets=[new CSSStyleSheet],this._root.adoptedStyleSheets[0].replaceSync(_e),this._stats={...Se},this._unsubs=[]}connectedCallback(){this._renderLayout(),ze(this._root),Le(this._root,this._stats,this._unsubs),this._unsubs.push(bus.on("_preview:needs-update",()=>{H(this._root,this._stats)})),H(this._root,this._stats)}disconnectedCallback(){this._unsubs.forEach(t=>t())}_renderLayout(){this._root.innerHTML=ke()}}customElements.define("app-preview",Te);const Ee=`
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
`;function B(){return`<div style="flex:1;display:flex;flex-direction:column;overflow-y:auto">
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
</div>`}function Me(){return'<div class="repo-layout"><app-tree></app-tree></div>'}function Ce(){return'<div class="repo-layout"><app-sidebar></app-sidebar><app-preview></app-preview></div>'}function $e(){return`<div style="flex:1;overflow-y:auto">
<div class="section-title">\u2699\uFE0F \u8BBE\u7F6E</div>
<div class="settings-group">
<div class="setting-row"><span class="label">\u{1F3AE} \u6E38\u620F\u8DEF\u5F84</span><span class="value">\u672A\u8BBE\u7F6E <span class="ptag" style="margin-left:4px">\u9884\u544A</span></span></div>
<div class="setting-row"><span class="label">\u{1F4C1} \u4ED3\u5E93\u8DEF\u5F84</span><span class="value">\u672A\u8BBE\u7F6E <span class="ptag" style="margin-left:4px">\u9884\u544A</span></span></div>
<div class="setting-row"><span class="label">\u{1F319} \u4E3B\u9898</span><span class="value">\u6697\u8272</span></div>
<div class="setting-row"><span class="label">\u{1F517} \u94FE\u63A5\u6A21\u5F0F</span><span class="value">\u786C\u94FE\u63A5 <span class="ptag" style="margin-left:4px">\u9884\u544A</span></span></div>
</div>
</div>`}function I(e,t){return`<div class="placeholder-box"><div class="big">${e}</div><div>${t}</div><span class="ptag">\u9884\u544A</span></div>`}class He extends HTMLElement{constructor(){super(),this._root=this.attachShadow({mode:"open"}),this._root.adoptedStyleSheets=[new CSSStyleSheet],this._root.adoptedStyleSheets[0].replaceSync(Ee),this._current="dashboard"}connectedCallback(){this._unsub=bus.on("nav:change",({page:t})=>{this._current=t,bus.emit("nav:changed",{page:t}),this._render()}),this._render()}disconnectedCallback(){this._unsub&&this._unsub()}_render(){let t="";switch(this._current){case"dashboard":t=B();break;case"repository":t=Me();break;case"instances":t=Ce();break;case"downloads":t=I("\u2B07\uFE0F","\u4E0B\u8F7D\u4E0E\u66F4\u65B0");break;case"diagnostics":t=I("\u{1F6E0}\uFE0F","\u8BCA\u65AD\u4E0E\u51B2\u7A81\u68C0\u6D4B");break;case"settings":t=$e();break;default:t=B()}this._root.innerHTML=`<div class="page">${t}</div>`}}customElements.define("app-content",He);
