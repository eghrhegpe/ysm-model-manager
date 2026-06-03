(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))o(s);new MutationObserver(s=>{for(const a of s)if(a.type==="childList")for(const i of a.addedNodes)i.tagName==="LINK"&&i.rel==="modulepreload"&&o(i)}).observe(document,{childList:!0,subtree:!0});function n(s){const a={};return s.integrity&&(a.integrity=s.integrity),s.referrerpolicy&&(a.referrerPolicy=s.referrerpolicy),s.crossorigin==="use-credentials"?a.credentials="include":s.crossorigin==="anonymous"?a.credentials="omit":a.credentials="same-origin",a}function o(s){if(s.ep)return;s.ep=!0;const a=n(s);fetch(s.href,a)}})();const K=`
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
`;function V(){return`<div class="hdr">
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
</div>`}function J(){return`<div class="ftr">
<span class="stat" id="ftr-stat">\u5171 0 \u9879</span>
<button class="hdr-btn" id="btn-repo">\u{1F4C1} \u9009\u62E9\u4ED3\u5E93\u76EE\u5F55</button>
<button class="hdr-btn" id="btn-dedup">\u{1F517} \u53BB\u91CD <span class="tag">\u9884\u544A</span></button>
<button class="hdr-btn" id="btn-trash">\u{1F5D1}\uFE0F \u56DE\u6536\u7AD9</button>
<div style="flex:1"></div>
<button class="hdr-btn" id="btn-pv">\u25C0 \u9884\u89C8</button>
</div>`}function R(e,t){return`<div class="empty"><div class="big">${e}</div>${t}</div>`}function v(e){return(e||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function X(e,t){const n=v(e);if(!t)return n;const o=t.toLowerCase(),s=e.toLowerCase().indexOf(o);if(s===-1)return n;const a=v(e.substring(0,s)),i=v(e.substring(s,s+t.length)),c=v(e.substring(s+t.length));return a+"<mark>"+i+"</mark>"+c}function Q(e){return!e&&e!==0?"":e<1024?e+" B":e<1048576?(e/1024).toFixed(1)+" KB":(e/1048576).toFixed(1)+" MB"}function Z(e){if(!e)return"";const t=new Date(e),n=new Date;return t.toDateString()===n.toDateString()?t.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):(n-t)/864e5<7?["\u65E5","\u4E00","\u4E8C","\u4E09","\u56DB","\u4E94","\u516D"][t.getDay()]+" "+t.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):t.toLocaleDateString([],{month:"short",day:"numeric"})}function ee(e){const t=(e.split(".").pop()||"").toLowerCase();return t==="ysm"?"\u{1F48E}":["zip","rar","7z","tar","gz"].includes(t)?"\u{1F4E6}":["png","jpg","jpeg","gif","webp","bmp"].includes(t)?"\u{1F5BC}\uFE0F":["txt","md","json","xml","yml","yaml","cfg","conf","ini"].includes(t)?"\u{1F4C4}":"\u{1F9CA}"}function te(e,t,n){const o=[...e].sort((i,c)=>t==="size"?(c.size||0)-(i.size||0):t==="date"?(c.modTime||0)-(i.modTime||0):i.name.localeCompare(c.name)),s=(n||"").trim().toLowerCase(),a={};return o.forEach(i=>{if(s&&!i.name.toLowerCase().includes(s))return;const c=i.path.replace(/\\/g,"/").split("/");let d=a;for(let r=0;r<c.length-1;r++)!c[r]||(d[c[r]]||(d[c[r]]={}),d=d[c[r]]);d[c[c.length-1]]={_e:i}}),a}function O(e,t){if(!t||!e)return!1;for(const n of Object.keys(e)){const o=e[n];if(o._e){if(o._e.name.toLowerCase().includes(t))return!0}else if(n.toLowerCase().includes(t)||O(o,t))return!0}return!1}function ne(e){const t=e.length,n=e.filter(s=>!s.banned).length,o=e.reduce((s,a)=>s+(a.size||0),0);return{total:t,enabled:n,totalSize:o}}function se(e,t,n,o){const s=w(e.path),a=w(e.fullPath||e.path),i=e.banned?"":" on",c=e.banned?"":"\u2713";return`<div class="fl${e.banned?" ban":""}" data-path="${s}" data-fullpath="${a}">
<span class="ck${i}" data-path="${s}" data-fullpath="${a}">${c}</span>
<span class="ficon">${n}</span>
<span class="nm">${t}</span>
<span class="sz">${ae(e.size)}</span>${o?`<span class="dt">${o}</span>`:""}</div>`}function oe(e,t,n,o){const s=o?"\u{1F512}":"\u{1F4C1}",a=o?"#585b70":"#a6adc8",i=o?" locked":"",c=n?"\u25BC":"\u25B6",d=n?" open":"";return`<div class="fh${i}" data-dir="${w(t)}">
<span class="ar${d}">${c}</span>
<span class="nm" style="color:${a}">${s} ${w(e)}</span></div>
<div class="ch" style="display:${n?"block":"none"}">`}function w(e){return(e||"").replace(/"/g,"&quot;").replace(/</g,"&lt;")}function ae(e){return!e&&e!==0?"":e<1024?e+" B":e<1048576?(e/1024).toFixed(1)+" KB":(e/1048576).toFixed(1)+" MB"}function ie(e,t,n,o,s){if(!t.length){e.innerHTML=R("\u{1F4C1}","\u6682\u65E0\u6A21\u578B\u6587\u4EF6");return}const a=te(t,o,n),i=N(a,"",n,o,s);if(!i){e.innerHTML=R("\u{1F50D}","\u672A\u627E\u5230\u5339\u914D\u7684\u6587\u4EF6");return}e.innerHTML=i}function re(e,t){if(!e)return;const n=ne(t);e.textContent=`\u5171 ${n.total} \u9879 (\u5DF2\u542F\u7528 ${n.enabled}) \xB7 ${Q(n.totalSize)}`}function N(e,t,n,o,s){const a=!!(n||"").trim(),i=Object.keys(e).sort((d,r)=>{const f=!e[d]._e,l=!e[r]._e;if(f&&!l)return-1;if(!f&&l)return 1;const m=e[d]._e,p=e[r]._e;return o==="size"?((p==null?void 0:p.size)||0)-((m==null?void 0:m.size)||0):o==="date"?((p==null?void 0:p.modTime)||0)-((m==null?void 0:m.modTime)||0):d.localeCompare(r)});let c="";return i.forEach(d=>{const r=e[d],f=t?t+"/"+d:d;if(r._e){const l=r._e;if(a&&!l.name.toLowerCase().includes(n.toLowerCase()))return;const m=a?X(l.name,n):l.name,p=l.modTime?Z(l.modTime):"",g=ee(l.name);c+=se(l,m,g,p)}else{const l=d.startsWith("_"),m=a||!!s[f],p=a?O(r,n.toLowerCase()):!1;c+=oe(d,f,m||a&&p,l),c+=N(r,f,n,o,s),c+="</div>"}}),c}function M(e){!e||(e.classList.add("flash"),setTimeout(()=>e.classList.remove("flash"),400))}function ce(e,t){e.querySelectorAll(".fh").forEach(n=>{n.onclick=o=>{o.stopPropagation();const s=n.nextElementSibling,a=n.querySelector(".ar");if(!s)return;const i=s.style.display!=="none";s.style.display=i?"none":"block",a.classList.toggle("open",!i),t._dirOpen[n.dataset.dir]=!i,localStorage.setItem("at_dirs",JSON.stringify(t._dirOpen))}}),e.querySelectorAll(".ck").forEach(n=>{n.onclick=o=>{o.stopPropagation();const s=n.classList.contains("on");n.classList.toggle("on"),n.textContent=n.classList.contains("on")?"\u2713":"";const a=n.closest(".fl");a&&a.classList.add("flash"),setTimeout(()=>a==null?void 0:a.classList.remove("flash"),400);const i=n.dataset.path,c=n.dataset.fullpath||i;bus.emit("entry:toggle",{path:c,relPath:i,enabled:!s})},n.ondblclick=()=>{const o=n.dataset.fullpath||n.dataset.path;o&&bus.emit("model:select",{path:o})}}),e.querySelectorAll(".fl").forEach(n=>{n.oncontextmenu=o=>{var c,d,r;o.preventDefault();const s=((d=(c=n.querySelector(".nm"))==null?void 0:c.textContent)==null?void 0:d.replace(/^\S+\s/,""))||"",a=!((r=n.querySelector(".ck"))!=null&&r.classList.contains("on")),i=n.dataset.fullpath||n.dataset.path;bus.emit("ctx:show",{x:o.clientX,y:o.clientY,path:i,relPath:n.dataset.path,name:s,banned:a})}})}function de(e,t){var s,a,i,c,d,r,f,l,m;const n=p=>e.getElementById(p),o=()=>t._renderTree();(s=n("srch"))==null||s.addEventListener("input",p=>{t._search=p.target.value,o()}),(a=n("sort"))==null||a.addEventListener("change",p=>{t._sort=p.target.value,o()}),(i=n("btn-repo"))==null||i.addEventListener("click",()=>bus.emit("dir:select-repo")),(c=n("btn-dedup"))==null||c.addEventListener("click",()=>bus.emit("entries:dedup")),(d=n("btn-trash"))==null||d.addEventListener("click",()=>bus.emit("recycle:open")),(r=n("btn-pv"))==null||r.addEventListener("click",()=>bus.emit("preview:toggle")),(f=n("btn-ea"))==null||f.addEventListener("click",()=>{M(n("btn-ea")),t._entries.forEach(p=>{p.banned=!1}),o()}),(l=n("btn-da"))==null||l.addEventListener("click",()=>{M(n("btn-da")),t._entries.forEach(p=>{p.banned=!0}),o()}),(m=n("btn-st"))==null||m.addEventListener("click",()=>M(n("btn-st")))}function le(e,t,n,o,s,a){return window.go.main.App.AddImportLog(e,t,n,o,s,a)}function pe(e){return window.go.main.App.AnalyzeYSMModel(e)}function ue(e){return window.go.main.App.CheckFileExists(e)}function fe(e){return window.go.main.App.ClearCustomDir(e)}function me(){return window.go.main.App.ClearImportLogs()}function he(e){return window.go.main.App.CountLinkedModels(e)}function ge(e){return window.go.main.App.CreateDir(e)}function be(e){return window.go.main.App.DeduplicateCustomDir(e)}function xe(e){return window.go.main.App.DeleteFromRecycle(e)}function ve(e){return window.go.main.App.EmptyRecycleBin(e)}function we(e){return window.go.main.App.GetGlobalCustomDir(e)}function ye(){return window.go.main.App.GetImportLogs()}function j(e,t){return window.go.main.App.GetInstanceStatus(e,t)}function _e(){return window.go.main.App.GetLinkMode()}function Se(){return window.go.main.App.GetMinecraftPath()}function ke(){return window.go.main.App.GetWindowPosition()}function Me(e){return window.go.main.App.HasYSMMod(e)}function Le(e,t){return window.go.main.App.ImportModelFile(e,t)}function ze(e,t){return window.go.main.App.InstallModelFile(e,t)}function Te(e,t){return window.go.main.App.InstallModelTo(e,t)}function Ee(e,t){return window.go.main.App.InstallModelWithOverlay(e,t)}function G(e){return window.go.main.App.IsFileBanned(e)}function Ce(e){return window.go.main.App.IsSymlink(e)}function Ae(e){return window.go.main.App.ListFileNames(e)}function $e(e){return window.go.main.App.ListRecycleBin(e)}function Y(e){return window.go.main.App.ListVersionInstances(e)}function _(){return window.go.main.App.LoadAppConfig()}function Re(e,t){return window.go.main.App.MoveModelFile(e,t)}function Ie(e){return window.go.main.App.MoveToRecycle(e)}function He(e){return window.go.main.App.MoveToRecycleEx(e)}function Be(e){return window.go.main.App.OpenFolder(e)}function De(e,t){return window.go.main.App.RestoreFromRecycle(e,t)}function C(e,t,n){return window.go.main.App.SaveAppConfig(e,t,n)}function Fe(e,t,n,o){return window.go.main.App.SaveWindowPosition(e,t,n,o)}function Pe(e){return window.go.main.App.ScanCustomModels(e)}function y(e){return window.go.main.App.ScanModelEntries(e)}function A(){return window.go.main.App.SelectDirectory()}function Oe(e){return window.go.main.App.SetLinkMode(e)}function Ne(e){return window.go.main.App.SetRepoRoot(e)}function je(e,t){return window.go.main.App.SyncCustomToRepo(e,t)}function Ge(e,t){return window.go.main.App.SyncModelToggleStatus(e,t)}function q(e){return window.go.main.App.ToggleModelEnable(e)}const Ye=Object.freeze(Object.defineProperty({__proto__:null,AddImportLog:le,AnalyzeYSMModel:pe,CheckFileExists:ue,ClearCustomDir:fe,ClearImportLogs:me,CountLinkedModels:he,CreateDir:ge,DeduplicateCustomDir:be,DeleteFromRecycle:xe,EmptyRecycleBin:ve,GetGlobalCustomDir:we,GetImportLogs:ye,GetInstanceStatus:j,GetLinkMode:_e,GetMinecraftPath:Se,GetWindowPosition:ke,HasYSMMod:Me,ImportModelFile:Le,InstallModelFile:ze,InstallModelTo:Te,InstallModelWithOverlay:Ee,IsFileBanned:G,IsSymlink:Ce,ListFileNames:Ae,ListRecycleBin:$e,ListVersionInstances:Y,LoadAppConfig:_,MoveModelFile:Re,MoveToRecycle:Ie,MoveToRecycleEx:He,OpenFolder:Be,RestoreFromRecycle:De,SaveAppConfig:C,SaveWindowPosition:Fe,ScanCustomModels:Pe,ScanModelEntries:y,SelectDirectory:A,SetLinkMode:Oe,SetRepoRoot:Ne,SyncCustomToRepo:je,SyncModelToggleStatus:Ge,ToggleModelEnable:q},Symbol.toStringTag,{value:"Module"}));async function W(){const e=await _(),t=e.repoRoot||e.RepoRoot||"";if(!t)return null;const n=await y(t);if(!n||!n.length)return null;const o=[];for(const s of n){let a=!1;try{a=await G(s.Path)}catch{}let i=s.Path;t&&s.Path.startsWith(t)&&(i=s.Path.slice(t.length).replace(/^[/\\]+/,"")),o.push({name:s.Name,path:i,fullPath:s.Path,size:s.Size,modTime:s.ModTime,banned:a})}return{repoRoot:t,entries:o}}function h(){const e=Date.now();return[{name:"steve_skin.ysm",path:"steve_skin.ysm",size:1258291,modTime:e-864e5,banned:!1},{name:"alex_deluxe.ysm",path:"alex/alex_deluxe.ysm",size:2516582,modTime:e-1728e5,banned:!1},{name:"alex_head.ysm",path:"alex/alex_head.ysm",size:524288,modTime:e-1728e5,banned:!1},{name:"dragon_armor.zip",path:"dragon/dragon_armor.zip",size:3984588,modTime:e-36e5,banned:!1},{name:"dragon_wings.ysm",path:"dragon/dragon_wings.ysm",size:2202009,modTime:e-72e5,banned:!1},{name:"neon_sword.ysm",path:"weapons/neon_sword.ysm",size:1572864,modTime:e,banned:!1},{name:"magic_staff.zip",path:"weapons/magic_staff.zip",size:4404019,modTime:e-72e5,banned:!1},{name:"photon_body.ysm",path:"photon/photon_body.ysm",size:2202009,modTime:e-432e5,banned:!1},{name:"old_model.ysm",path:"_disabled/old_model.ysm",size:943718,modTime:e-6048e5,banned:!0},{name:"custom_hat.ysm",path:"custom/custom_hat.ysm",size:838860,modTime:e-2592e5,banned:!1},{name:"steve_2d.ysm",path:"custom/steve_2d.ysm",size:314572,modTime:e-5e5,banned:!1}]}function qe(e){const t=[];return t.push(bus.on("entry:toggle",async({path:n})=>{try{await q(n)}catch{}await I(e)})),t.push(bus.on("dir:select-repo",async()=>{try{const n=await A();if(!n)return;await C(n,"","copy"),e._repoRoot=n,await I(e)}catch{e._entries=h(),e._renderTree()}})),t.push(bus.on("entries:dedup",()=>{bus.emit("toast:show",{msg:"\u{1F517} \u53BB\u91CD\u529F\u80FD\u5F00\u53D1\u4E2D",duration:2e3,type:"info"})})),t.push(bus.on("recycle:open",()=>{bus.emit("toast:show",{msg:"\u{1F5D1}\uFE0F \u56DE\u6536\u7AD9\u529F\u80FD\u5F00\u53D1\u4E2D",duration:2e3,type:"info"})})),t}async function I(e){try{const t=await W();t?(e._repoRoot=t.repoRoot,e._entries=t.entries):e._entries=h()}catch{e._entries=h()}e._renderTree()}class We extends HTMLElement{constructor(){super(),this._root=this.attachShadow({mode:"open"}),this._root.adoptedStyleSheets=[new CSSStyleSheet],this._root.adoptedStyleSheets[0].replaceSync(K),this._entries=[],this._search="",this._sort="name",this._dirOpen={},this._repoRoot=""}async connectedCallback(){try{Object.assign(this._dirOpen,JSON.parse(localStorage.getItem("at_dirs")||"{}"))}catch{}this._renderLayout(),de(this._root,this),this._unsubs=qe(this),await this._load(),this._renderTree()}disconnectedCallback(){var t;(t=this._unsubs)==null||t.forEach(n=>n==null?void 0:n())}async _load(){try{const t=await W();t?(this._repoRoot=t.repoRoot,this._entries=t.entries):this._entries=h()}catch{this._entries=h()}}_renderLayout(){this._root.innerHTML=V()+'<div class="list" id="tree"><div class="empty"><div class="big">\u{1F4C1}</div>\u6682\u65E0\u6A21\u578B\u6587\u4EF6</div></div>'+J()}_renderTree(){const t=this._root.getElementById("tree");ie(t,this._entries,this._search,this._sort,this._dirOpen),ce(t,this),re(this._root.getElementById("ftr-stat"),this._entries)}}customElements.define("app-tree",We);const Ue=`
:host {
  display: flex; flex-direction: column;
  background: #11111b;
  border-right: 1px solid rgba(255,255,255,.06);
  flex: 1;
  min-width: 0;
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
`;function Ke(){return`<div class="header">
<div class="header-row">
<span class="header-label">\u{1F4C2} \u7248\u672C\u5217\u8868</span>
<span class="header-stat" id="ver-stat">4\u4E2A\u6574\u5408\u5305</span>
</div>
<input class="search-input" id="ver-search" type="text" placeholder="\u{1F50D} \u641C\u7D22\u6574\u5408\u5305" autocomplete="off" autocapitalize="off">
</div>`}function Ve(){return`<div class="footer">
<button class="footer-btn" id="btn-mc">\u{1F3AE} \u6307\u5B9A\u6E38\u620F\u8DEF\u5F84</button>
</div>`}function Je(){return'<div class="list" id="vg"></div>'}function Xe(e,t,n,o=!1){const s=[];return t>0&&s.push(`<span class="tag green">\u2705 ${t}</span>`),n>0&&s.push(`<span class="tag red">\u2B07\uFE0F ${n}</span>`),`<div class="vc-header">
<span class="${o?"arrow open":"arrow"}">\u25B6</span>
<span class="name">\u{1F4E6} ${U(e)}</span>
${s.join("")}
</div>`}function L(e,t){return`<div class="sec-title">${e} (${t})</div>`}function z(e,t,n){return`<div class="row"><span class="dot" style="background:${e}"></span><span class="rn">${U(t)}</span><span class="sz">${n}</span></div>`}function U(e){return(e||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function Qe(e,t){e.innerHTML="",t.forEach((n,o)=>{const s=document.createElement("div");s.className="vc",s.dataset.idx=o;const a=o===0;s.innerHTML=Xe(n.name,n.synced,n.missing,a),e.appendChild(s);const i=document.createElement("div");i.className="vc-body",i.style.display=a?"":"none",i.innerHTML=Ze(n),e.appendChild(i)})}function Ze(e){let t="";return e.items.synced.length&&(t+=L("\u2705 \u5DF2\u540C\u6B65",e.items.synced.length),e.items.synced.forEach(n=>{t+=z("#a6e3a1",n.name,n.size)})),e.items.missing.length&&(t+=L("\u2B07\uFE0F \u7F3A\u5931",e.items.missing.length),e.items.missing.forEach(n=>{t+=z("#f38ba8",n.name,n.size)})),e.items.extra.length&&(t+=L("\u{1F4E4} \u989D\u5916",e.items.extra.length),e.items.extra.forEach(n=>{t+=z("#f9a826",n.name,n.size)})),t}function et(e){e.querySelectorAll(".vc").forEach(t=>{const n=t.querySelector(".vc-header"),o=t.nextElementSibling;!n||!o||!o.classList.contains("vc-body")||(n.onclick=()=>{const s=n.querySelector(".arrow");o.style.display=o.style.display==="none"?"":"none",s&&s.classList.toggle("open")},n.ondblclick=()=>{const s=n.querySelector(".name"),a=s?s.textContent.replace(/^📦\s*/,""):"";bus.emit("instance:select",{name:a})})})}function tt(e){const t=e.getElementById("ver-search");t&&(t.oninput=n=>{bus.emit("ver:search",{keyword:n.target.value})})}function nt(e){const t=e.getElementById("btn-mc");t&&(t.onclick=()=>bus.emit("dir:select-mc"))}async function st(){const e=await _(),t=e.mcRoot||e.McRoot||"",n=e.repoRoot||e.RepoRoot||"";if(!t||!n)return null;const o=await y(n),s=new Set;o.forEach(r=>s.add(r.Name.replace(/\.ban$/i,"")));const a=await Y(t);if(!a||!a.length)return null;const i=await j(t,n),c={};return(i||[]).forEach(r=>{c[r.Name]=r}),a.map(r=>{const f=c[r.Name]||{},l=f.Missing||[],m=f.Extra||[];f.Disabled;const p=new Set(l.map(u=>u.replace(/\.ban$/i,""))),g=new Set(m.map(u=>u.replace(/\.ban$/i,""))),S=[];s.forEach(u=>{!p.has(u)&&!g.has(u)&&S.push(u)});const $=[];if(r.Exists)try{const u=y(r.CustomDir),b={};(u||[]).forEach(x=>{b[x.Name.replace(/\.ban$/i,"")]=x}),$.push(...u||[])}catch{}const k=u=>{const b=$.find(x=>x.Name.replace(/\.ban$/i,"")===u.replace(/\.ban$/i,""));return b?ot(b.Size):""};return{name:r.Name,exists:r.Exists,hasYSM:f.HasYSM,synced:S.length,missing:l.length,extra:m.length,items:{synced:S.slice(0,20).map(u=>({name:u,size:k(u)})),missing:l.slice(0,20).map(u=>({name:u,size:k(u)})),extra:m.slice(0,20).map(u=>({name:u,size:k(u)}))}}})}function ot(e){return!e&&e!==0?"":e<1024?e+" B":e<1048576?(e/1024).toFixed(1)+" KB":(e/1048576).toFixed(1)+" MB"}function H(){return[{name:"\u6211\u7684\u6574\u5408\u5305",synced:3,missing:1,extra:2,items:{synced:[{name:"steve_skin.ysm",size:"1.2 MB"},{name:"alex_deluxe.ysm",size:"2.4 MB"},{name:"neon_sword.ysm",size:"1.5 MB"}],missing:[{name:"dragon_armor.zip",size:"3.8 MB"}],extra:[{name:"custom_hat.ysm",size:"0.8 MB"},{name:"old_hat.ysm",size:"0.3 MB"}]}},{name:"\u5149\u5F71\u6D4B\u8BD5\u5305",synced:1,missing:2,extra:0,items:{synced:[],missing:[],extra:[]}},{name:"\u7A7A\u5C9B\u751F\u5B58",synced:5,missing:0,extra:0,items:{synced:[],missing:[],extra:[]}},{name:"RPG \u5192\u9669",synced:2,missing:3,extra:0,items:{synced:[],missing:[],extra:[]}}]}class at extends HTMLElement{constructor(){super(),this._root=this.attachShadow({mode:"open"}),this._root.adoptedStyleSheets=[new CSSStyleSheet],this._root.adoptedStyleSheets[0].replaceSync(Ue),this._instances=[],this._unsubs=[]}async connectedCallback(){this._renderLayout(),this._unsubs.push(bus.on("dir:select-mc",async()=>{try{const t=await A();if(!t)return;const n=await _();await C(n.repoRoot||"",t,n.linkMode||"copy")}catch{}await this._reload()})),await this._reload()}async _reload(){try{const t=await st();t?this._instances=t:this._instances=H()}catch{this._instances=H()}Qe(this._root.getElementById("vg"),this._instances),et(this._root),tt(this._root),nt(this._root)}disconnectedCallback(){this._unsubs.forEach(t=>t())}_renderLayout(){this._root.innerHTML=Ke()+Je()+Ve()}}customElements.define("app-sidebar",at);const it="modulepreload",rt=function(e){return"/"+e},B={},ct=function(t,n,o){if(!n||n.length===0)return t();const s=document.getElementsByTagName("link");return Promise.all(n.map(a=>{if(a=rt(a),a in B)return;B[a]=!0;const i=a.endsWith(".css"),c=i?'[rel="stylesheet"]':"";if(!!o)for(let f=s.length-1;f>=0;f--){const l=s[f];if(l.href===a&&(!i||l.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${a}"]${c}`))return;const r=document.createElement("link");if(r.rel=i?"stylesheet":it,i||(r.as="script",r.crossOrigin=""),r.href=a,document.head.appendChild(r),i)return new Promise((f,l)=>{r.addEventListener("load",f),r.addEventListener("error",()=>l(new Error(`Unable to preload CSS for ${a}`)))})})).then(()=>t())},dt=`
:host {
  display: flex; flex-direction: column;
  background: #11111b;
  border-left: 1px solid rgba(255,255,255,.06);
  width: 200px;
  flex-shrink: 0;
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
/* \u6A21\u578B\u8BE6\u60C5 */
.md-row { font-size: 11px; color: #cdd6f4; padding: 3px 0; display: flex; justify-content: space-between; }
.md-label { color: #6c7086; }
.md-value { color: #fff; font-weight: 500; }
.md-divider { border: none; border-top: 1px solid rgba(255,255,255,.06); margin: 8px 0; }
.err { font-size: 10px; color: #f38ba8; padding: 4px 0; }
`;function lt(){return`<div class="content" id="preview-content">
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
</div>`}function T(e){return!e||e.hasError?`<div class="content" id="preview-content">
<h3>\u{1F4C4} \u6A21\u578B\u4FE1\u606F</h3>
<div class="err">\u26A0\uFE0F ${e?e.errorMsg:"\u672A\u77E5\u9519\u8BEF"}</div>
</div>`:`<div class="content" id="preview-content">
<h3>\u{1F4C4} \u6A21\u578B\u4FE1\u606F</h3>
<div class="md-row"><span class="md-label">\u540D\u79F0</span><span class="md-value">${E(e.name||"-")}</span></div>
<div class="md-row"><span class="md-label">\u4F5C\u8005</span><span class="md-value">${E(e.author||"-")}</span></div>
<div class="md-row"><span class="md-label">\u7248\u672C</span><span class="md-value">${E(e.version||"-")}</span></div>
<div class="md-divider"></div>
<div class="md-row"><span class="md-label">\u{1F9B4} \u9AA8\u9ABC</span><span class="md-value">${e.bones||0}</span></div>
<div class="md-row"><span class="md-label">\u{1F5BC}\uFE0F \u8D34\u56FE</span><span class="md-value">${e.textures||0}</span></div>
<div class="md-row"><span class="md-label">\u{1F3AC} \u52A8\u753B</span><span class="md-value">${e.animations||0}</span></div>
<div class="md-row"><span class="md-label">\u{1F53A} \u9876\u70B9</span><span class="md-value">${(e.vertices||0).toLocaleString()}</span></div>
<div class="md-row"><span class="md-label">\u25FB\uFE0F \u9762</span><span class="md-value">${(e.faces||0).toLocaleString()}</span></div>
</div>`}function E(e){return(e||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}const pt={repo:6,ver:4,ok:2,tot:4,pending:2};function D(e,t){const n=o=>e.getElementById(o);n("s-repo")&&(n("s-repo").textContent=t.repo),n("s-ver")&&(n("s-ver").textContent=t.ver),n("s-ok")&&(n("s-ok").textContent=t.ok),n("s-tot")&&(n("s-tot").textContent=t.tot),n("s-pending")&&(n("s-pending").textContent=t.pending)}function ut(e){var t,n,o;(t=e.getElementById("btn-refresh"))==null||t.addEventListener("click",()=>bus.emit("stats:refresh")),(n=e.getElementById("btn-upload"))==null||n.addEventListener("click",()=>bus.emit("stats:upload")),(o=e.getElementById("btn-logs"))==null||o.addEventListener("click",()=>bus.emit("stats:logs"))}function ft(e,t,n){n.push(bus.on("stats:updated",o=>{o&&Object.assign(t,o),bus.emit("_preview:needs-update")}))}class mt extends HTMLElement{constructor(){super(),this._root=this.attachShadow({mode:"open"}),this._root.adoptedStyleSheets=[new CSSStyleSheet],this._root.adoptedStyleSheets[0].replaceSync(dt),this._stats={...pt},this._unsubs=[],this._mode="stat"}static get observedAttributes(){return["mode"]}attributeChangedCallback(t,n,o){t==="mode"&&(this._mode=o==="model"?"model":"stat",this._root.isConnected&&this._render())}connectedCallback(){this._mode=this.getAttribute("mode")==="model"?"model":"stat",this._render(),this._mode==="stat"&&(ft(this._root,this._stats,this._unsubs),this._unsubs.push(bus.on("_preview:needs-update",()=>{D(this._root,this._stats)})),D(this._root,this._stats)),this._mode==="model"&&this._unsubs.push(bus.on("model:select",async({path:t})=>{this._showModelDetail(t)}))}disconnectedCallback(){this._unsubs.forEach(t=>t())}_render(){this._mode==="stat"?(this._root.innerHTML=lt(),ut(this._root)):this._root.innerHTML=T(null)}async _showModelDetail(t){if(!!this._root.getElementById("preview-content")){this._root.innerHTML='<div class="content" id="preview-content"><h3>\u{1F4C4} \u6A21\u578B\u4FE1\u606F</h3><div class="stat-row"><span class="label">\u52A0\u8F7D\u4E2D...</span></div></div>';try{const{AnalyzeYSMModel:o}=await ct(()=>Promise.resolve().then(()=>Ye),void 0),s=await o(t);this._root.innerHTML=T(s)}catch(o){this._root.innerHTML=T({hasError:!0,errorMsg:String(o)})}}}}customElements.define("app-preview",mt);const ht=`
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
.settings-group { padding:0 16px; }
.setting-row { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:#181825; border-radius:6px; margin-bottom:4px; font-size:12px; }
.setting-row .label { color:#cdd6f4; }
.setting-row .value { color:#6c7086; }
`;function F(){return`<div style="flex:1;display:flex;flex-direction:column;overflow-y:auto">
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
</div>`}function gt(){return'<div class="repo-layout"><app-tree></app-tree><app-preview mode="model"></app-preview></div>'}function bt(){return'<div class="repo-layout"><app-sidebar></app-sidebar><app-preview mode="stat"></app-preview></div>'}function xt(){return`<div style="flex:1;overflow-y:auto">
<div class="section-title">\u2699\uFE0F \u8BBE\u7F6E</div>
<div class="settings-group">
<div class="setting-row"><span class="label">\u{1F3AE} \u6E38\u620F\u8DEF\u5F84</span><span class="value">\u672A\u8BBE\u7F6E <span class="ptag" style="margin-left:4px">\u9884\u544A</span></span></div>
<div class="setting-row"><span class="label">\u{1F4C1} \u4ED3\u5E93\u8DEF\u5F84</span><span class="value">\u672A\u8BBE\u7F6E <span class="ptag" style="margin-left:4px">\u9884\u544A</span></span></div>
<div class="setting-row"><span class="label">\u{1F319} \u4E3B\u9898</span><span class="value">\u6697\u8272</span></div>
<div class="setting-row"><span class="label">\u{1F517} \u94FE\u63A5\u6A21\u5F0F</span><span class="value">\u786C\u94FE\u63A5 <span class="ptag" style="margin-left:4px">\u9884\u544A</span></span></div>
</div>
</div>`}function P(e,t){return`<div class="placeholder-box"><div class="big">${e}</div><div>${t}</div><span class="ptag">\u9884\u544A</span></div>`}class vt extends HTMLElement{constructor(){super(),this._root=this.attachShadow({mode:"open"}),this._root.adoptedStyleSheets=[new CSSStyleSheet],this._root.adoptedStyleSheets[0].replaceSync(ht),this._current="dashboard"}connectedCallback(){this._unsub=bus.on("nav:change",({page:t})=>{this._current=t,bus.emit("nav:changed",{page:t}),this._render()}),this._render()}disconnectedCallback(){this._unsub&&this._unsub()}_render(){let t="";switch(this._current){case"dashboard":t=F();break;case"repository":t=gt();break;case"instances":t=bt();break;case"downloads":t=P("\u2B07\uFE0F","\u4E0B\u8F7D\u4E0E\u66F4\u65B0");break;case"diagnostics":t=P("\u{1F6E0}\uFE0F","\u8BCA\u65AD\u4E0E\u51B2\u7A81\u68C0\u6D4B");break;case"settings":t=xt();break;default:t=F()}this._root.innerHTML=`<div class="page">${t}</div>`}}customElements.define("app-content",vt);
