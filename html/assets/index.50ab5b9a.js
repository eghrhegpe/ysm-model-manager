(function(){const n=document.createElement("link").relList;if(n&&n.supports&&n.supports("modulepreload"))return;for(const o of document.querySelectorAll('link[rel="modulepreload"]'))r(o);new MutationObserver(o=>{for(const s of o)if(s.type==="childList")for(const a of s.addedNodes)a.tagName==="LINK"&&a.rel==="modulepreload"&&r(a)}).observe(document,{childList:!0,subtree:!0});function t(o){const s={};return o.integrity&&(s.integrity=o.integrity),o.referrerpolicy&&(s.referrerPolicy=o.referrerpolicy),o.crossorigin==="use-credentials"?s.credentials="include":o.crossorigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function r(o){if(o.ep)return;o.ep=!0;const s=t(o);fetch(o.href,s)}})();const w=`
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
`;function v(){return`<div class="hdr">
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
</div>`}function k(){return`<div class="ftr">
<span class="stat" id="ftr-stat">\u5171 0 \u9879</span>
<button class="hdr-btn" id="btn-repo">\u{1F4C1} \u9009\u62E9\u4ED3\u5E93\u76EE\u5F55</button>
<button class="hdr-btn" id="btn-dedup">\u{1F517} \u53BB\u91CD <span class="tag">\u9884\u544A</span></button>
<button class="hdr-btn" id="btn-trash">\u{1F5D1}\uFE0F \u56DE\u6536\u7AD9</button>
<div style="flex:1"></div>
<button class="hdr-btn" id="btn-pv">\u25C0 \u9884\u89C8</button>
</div>`}function x(e,n){return`<div class="empty"><div class="big">${e}</div>${n}</div>`}function m(e){return(e||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function z(e,n){const t=m(e);if(!n)return t;const r=n.toLowerCase(),o=e.toLowerCase().indexOf(r);if(o===-1)return t;const s=m(e.substring(0,o)),a=m(e.substring(o,o+n.length)),i=m(e.substring(o+n.length));return s+"<mark>"+a+"</mark>"+i}function L(e){return!e&&e!==0?"":e<1024?e+" B":e<1048576?(e/1024).toFixed(1)+" KB":(e/1048576).toFixed(1)+" MB"}function T(e){if(!e)return"";const n=new Date(e),t=new Date;return n.toDateString()===t.toDateString()?n.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):(t-n)/864e5<7?["\u65E5","\u4E00","\u4E8C","\u4E09","\u56DB","\u4E94","\u516D"][n.getDay()]+" "+n.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):n.toLocaleDateString([],{month:"short",day:"numeric"})}function S(e){const n=(e.split(".").pop()||"").toLowerCase();return n==="ysm"?"\u{1F48E}":["zip","rar","7z","tar","gz"].includes(n)?"\u{1F4E6}":["png","jpg","jpeg","gif","webp","bmp"].includes(n)?"\u{1F5BC}\uFE0F":["txt","md","json","xml","yml","yaml","cfg","conf","ini"].includes(n)?"\u{1F4C4}":"\u{1F9CA}"}function E(e,n,t){const r=[...e].sort((a,i)=>n==="size"?(i.size||0)-(a.size||0):n==="date"?(i.modTime||0)-(a.modTime||0):a.name.localeCompare(i.name)),o=(t||"").trim().toLowerCase(),s={};return r.forEach(a=>{if(o&&!a.name.toLowerCase().includes(o))return;const i=a.path.replace(/\\/g,"/").split("/");let c=s;for(let l=0;l<i.length-1;l++)!i[l]||(c[i[l]]||(c[i[l]]={}),c=c[i[l]]);c[i[i.length-1]]={_e:a}}),s}function y(e,n){if(!n||!e)return!1;for(const t of Object.keys(e)){const r=e[t];if(r._e){if(r._e.name.toLowerCase().includes(n))return!0}else if(t.toLowerCase().includes(n)||y(r,n))return!0}return!1}function $(e){const n=e.length,t=e.filter(o=>!o.banned).length,r=e.reduce((o,s)=>o+(s.size||0),0);return{total:n,enabled:t,totalSize:r}}function C(e,n,t,r){const o=g(e.path),s=e.banned?"":" on",a=e.banned?"":"\u2713";return`<div class="fl${e.banned?" ban":""}" data-path="${o}">
<span class="ck${s}" data-path="${o}">${a}</span>
<span class="ficon">${t}</span>
<span class="nm">${n}</span>
<span class="sz">${M(e.size)}</span>${r?`<span class="dt">${r}</span>`:""}</div>`}function D(e,n,t,r){const o=r?"\u{1F512}":"\u{1F4C1}",s=r?"#585b70":"#a6adc8",a=r?" locked":"",i=t?"\u25BC":"\u25B6",c=t?" open":"";return`<div class="fh${a}" data-dir="${g(n)}">
<span class="ar${c}">${i}</span>
<span class="nm" style="color:${s}">${o} ${g(e)}</span></div>
<div class="ch" style="display:${t?"block":"none"}">`}function g(e){return(e||"").replace(/"/g,"&quot;").replace(/</g,"&lt;")}function M(e){return!e&&e!==0?"":e<1024?e+" B":e<1048576?(e/1024).toFixed(1)+" KB":(e/1048576).toFixed(1)+" MB"}function O(e,n,t,r,o){if(!n.length){e.innerHTML=x("\u{1F4C1}","\u6682\u65E0\u6A21\u578B\u6587\u4EF6");return}const s=E(n,r,t),a=_(s,"",t,r,o);if(!a){e.innerHTML=x("\u{1F50D}","\u672A\u627E\u5230\u5339\u914D\u7684\u6587\u4EF6");return}e.innerHTML=a}function H(e,n){if(!e)return;const t=$(n);e.textContent=`\u5171 ${t.total} \u9879 (\u5DF2\u542F\u7528 ${t.enabled}) \xB7 ${L(t.totalSize)}`}function _(e,n,t,r,o){const s=!!(t||"").trim(),a=Object.keys(e).sort((c,l)=>{const u=!e[c]._e,p=!e[l]._e;if(u&&!p)return-1;if(!u&&p)return 1;const f=e[c]._e,d=e[l]._e;return r==="size"?((d==null?void 0:d.size)||0)-((f==null?void 0:f.size)||0):r==="date"?((d==null?void 0:d.modTime)||0)-((f==null?void 0:f.modTime)||0):c.localeCompare(l)});let i="";return a.forEach(c=>{const l=e[c],u=n?n+"/"+c:c;if(l._e){const p=l._e;if(s&&!p.name.toLowerCase().includes(t.toLowerCase()))return;const f=s?z(p.name,t):p.name,d=p.modTime?T(p.modTime):"",b=S(p.name);i+=C(p,f,b,d)}else{const p=c.startsWith("_"),f=s||!!o[u],d=s?y(l,t.toLowerCase()):!1;i+=D(c,u,f||s&&d,p),i+=_(l,u,t,r,o),i+="</div>"}}),i}function h(e){!e||(e.classList.add("flash"),setTimeout(()=>e.classList.remove("flash"),400))}function B(e,n){e.querySelectorAll(".fh").forEach(t=>{t.onclick=r=>{r.stopPropagation();const o=t.nextElementSibling,s=t.querySelector(".ar");if(!o)return;const a=o.style.display!=="none";o.style.display=a?"none":"block",s.classList.toggle("open",!a),n._dirOpen[t.dataset.dir]=!a,localStorage.setItem("at_dirs",JSON.stringify(n._dirOpen))}}),e.querySelectorAll(".ck").forEach(t=>{t.onclick=r=>{r.stopPropagation();const o=t.classList.contains("on");t.classList.toggle("on"),t.textContent=t.classList.contains("on")?"\u2713":"";const s=t.closest(".fl");s&&s.classList.add("flash"),setTimeout(()=>s==null?void 0:s.classList.remove("flash"),400),bus.emit("entry:toggle",{path:t.dataset.path,enabled:!o})}}),e.querySelectorAll(".fl").forEach(t=>{t.oncontextmenu=r=>{var a,i,c;r.preventDefault();const o=((i=(a=t.querySelector(".nm"))==null?void 0:a.textContent)==null?void 0:i.replace(/^\S+\s/,""))||"",s=!((c=t.querySelector(".ck"))!=null&&c.classList.contains("on"));bus.emit("ctx:show",{x:r.clientX,y:r.clientY,path:t.dataset.path,name:o,banned:s})}})}function I(e,n){var o,s,a,i,c,l,u,p,f;const t=d=>e.getElementById(d),r=()=>n._renderTree();(o=t("srch"))==null||o.addEventListener("input",d=>{n._search=d.target.value,r()}),(s=t("sort"))==null||s.addEventListener("change",d=>{n._sort=d.target.value,r()}),(a=t("btn-repo"))==null||a.addEventListener("click",()=>bus.emit("dir:select-repo")),(i=t("btn-dedup"))==null||i.addEventListener("click",()=>bus.emit("entries:dedup")),(c=t("btn-trash"))==null||c.addEventListener("click",()=>bus.emit("recycle:open")),(l=t("btn-pv"))==null||l.addEventListener("click",()=>bus.emit("preview:toggle")),(u=t("btn-ea"))==null||u.addEventListener("click",()=>{h(t("btn-ea")),n._entries.forEach(d=>{d.banned=!1}),r()}),(p=t("btn-da"))==null||p.addEventListener("click",()=>{h(t("btn-da")),n._entries.forEach(d=>{d.banned=!0}),r()}),(f=t("btn-st"))==null||f.addEventListener("click",()=>h(t("btn-st")))}class j extends HTMLElement{constructor(){super(),this._root=this.attachShadow({mode:"open"}),this._root.adoptedStyleSheets=[new CSSStyleSheet],this._root.adoptedStyleSheets[0].replaceSync(w),this._entries=[],this._search="",this._sort="name",this._dirOpen={}}connectedCallback(){this._entries=[{name:"steve_skin.ysm",path:"steve_skin.ysm",size:1258291,modTime:Date.now()-864e5,banned:!1},{name:"alex_deluxe.ysm",path:"alex/alex_deluxe.ysm",size:2516582,modTime:Date.now()-1728e5,banned:!1},{name:"alex_head.ysm",path:"alex/alex_head.ysm",size:524288,modTime:Date.now()-1728e5,banned:!1},{name:"dragon_armor.zip",path:"dragon/dragon_armor.zip",size:3984588,modTime:Date.now()-36e5,banned:!1},{name:"dragon_wings.ysm",path:"dragon/dragon_wings.ysm",size:2202009,modTime:Date.now()-72e5,banned:!1},{name:"neon_sword.ysm",path:"weapons/neon_sword.ysm",size:1572864,modTime:Date.now(),banned:!1},{name:"magic_staff.zip",path:"weapons/magic_staff.zip",size:4404019,modTime:Date.now()-72e5,banned:!1},{name:"photon_body.ysm",path:"photon/photon_body.ysm",size:2202009,modTime:Date.now()-432e5,banned:!1},{name:"old_model.ysm",path:"_disabled/old_model.ysm",size:943718,modTime:Date.now()-6048e5,banned:!0},{name:"custom_hat.ysm",path:"custom/custom_hat.ysm",size:838860,modTime:Date.now()-2592e5,banned:!1},{name:"steve_2d.ysm",path:"custom/steve_2d.ysm",size:314572,modTime:Date.now()-5e5,banned:!1}];try{Object.assign(this._dirOpen,JSON.parse(localStorage.getItem("at_dirs")||"{}"))}catch{}this._renderLayout(),I(this._root,this),this._renderTree()}disconnectedCallback(){}_renderLayout(){this._root.innerHTML=v()+'<div class="list" id="tree"><div class="empty"><div class="big">\u{1F4C1}</div>\u6682\u65E0\u6A21\u578B\u6587\u4EF6</div></div>'+k()}_renderTree(){const n=this._root.getElementById("tree");O(n,this._entries,this._search,this._sort,this._dirOpen),B(n,this),H(this._root.getElementById("ftr-stat"),this._entries)}}customElements.define("app-tree",j);
