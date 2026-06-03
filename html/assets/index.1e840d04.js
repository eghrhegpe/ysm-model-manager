(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))o(s);new MutationObserver(s=>{for(const a of s)if(a.type==="childList")for(const i of a.addedNodes)i.tagName==="LINK"&&i.rel==="modulepreload"&&o(i)}).observe(document,{childList:!0,subtree:!0});function n(s){const a={};return s.integrity&&(a.integrity=s.integrity),s.referrerpolicy&&(a.referrerPolicy=s.referrerpolicy),s.crossorigin==="use-credentials"?a.credentials="include":s.crossorigin==="anonymous"?a.credentials="omit":a.credentials="same-origin",a}function o(s){if(s.ep)return;s.ep=!0;const a=n(s);fetch(s.href,a)}})();const J=`
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
`;function X(){return`<div class="hdr">
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
</div>`}function Q(){return`<div class="ftr">
<span class="stat" id="ftr-stat">\u5171 0 \u9879</span>
<button class="hdr-btn" id="btn-repo">\u{1F4C1} \u9009\u62E9\u4ED3\u5E93\u76EE\u5F55</button>
<button class="hdr-btn" id="btn-dedup">\u{1F517} \u53BB\u91CD <span class="tag">\u9884\u544A</span></button>
<button class="hdr-btn" id="btn-trash">\u{1F5D1}\uFE0F \u56DE\u6536\u7AD9</button>
<div style="flex:1"></div>
<button class="hdr-btn" id="btn-pv">\u25C0 \u9884\u89C8</button>
</div>`}function I(e,t){return`<div class="empty"><div class="big">${e}</div>${t}</div>`}function b(e){return(e||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function Z(e,t){const n=b(e);if(!t)return n;const o=t.toLowerCase(),s=e.toLowerCase().indexOf(o);if(s===-1)return n;const a=b(e.substring(0,s)),i=b(e.substring(s,s+t.length)),r=b(e.substring(s+t.length));return a+"<mark>"+i+"</mark>"+r}function ee(e){return!e&&e!==0?"":e<1024?e+" B":e<1048576?(e/1024).toFixed(1)+" KB":(e/1048576).toFixed(1)+" MB"}function te(e){if(!e)return"";const t=new Date(e),n=new Date;return t.toDateString()===n.toDateString()?t.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):(n-t)/864e5<7?["\u65E5","\u4E00","\u4E8C","\u4E09","\u56DB","\u4E94","\u516D"][t.getDay()]+" "+t.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):t.toLocaleDateString([],{month:"short",day:"numeric"})}function ne(e){const t=(e.split(".").pop()||"").toLowerCase();return t==="ysm"?"\u{1F48E}":["zip","rar","7z","tar","gz"].includes(t)?"\u{1F4E6}":["png","jpg","jpeg","gif","webp","bmp"].includes(t)?"\u{1F5BC}\uFE0F":["txt","md","json","xml","yml","yaml","cfg","conf","ini"].includes(t)?"\u{1F4C4}":"\u{1F9CA}"}function se(e,t,n){const o=[...e].sort((i,r)=>t==="size"?(r.size||0)-(i.size||0):t==="date"?(r.modTime||0)-(i.modTime||0):i.name.localeCompare(r.name)),s=(n||"").trim().toLowerCase(),a={};return o.forEach(i=>{if(s&&!i.name.toLowerCase().includes(s))return;const r=i.path.replace(/\\/g,"/").split("/");let l=a;for(let c=0;c<r.length-1;c++)!r[c]||(l[r[c]]||(l[r[c]]={}),l=l[r[c]]);l[r[r.length-1]]={_e:i}}),a}function G(e,t){if(!t||!e)return!1;for(const n of Object.keys(e)){const o=e[n];if(o._e){if(o._e.name.toLowerCase().includes(t))return!0}else if(n.toLowerCase().includes(t)||G(o,t))return!0}return!1}function oe(e){const t=e.length,n=e.filter(s=>!s.banned).length,o=e.reduce((s,a)=>s+(a.size||0),0);return{total:t,enabled:n,totalSize:o}}function ae(e,t,n,o){const s=x(e.path),a=x(e.fullPath||e.path),i=e.banned?"":" on",r=e.banned?"":"\u2713";return`<div class="fl${e.banned?" ban":""}" data-path="${s}" data-fullpath="${a}">
<span class="ck${i}" data-path="${s}" data-fullpath="${a}">${r}</span>
<span class="ficon">${n}</span>
<span class="nm">${t}</span>
<span class="sz">${re(e.size)}</span>${o?`<span class="dt">${o}</span>`:""}</div>`}function ie(e,t,n,o){const s=o?"\u{1F512}":"\u{1F4C1}",a=o?"#585b70":"#a6adc8",i=o?" locked":"",r=n?"\u25BC":"\u25B6",l=n?" open":"";return`<div class="fh${i}" data-dir="${x(t)}">
<span class="ar${l}">${r}</span>
<span class="nm" style="color:${a}">${s} ${x(e)}</span></div>
<div class="ch" style="display:${n?"block":"none"}">`}function x(e){return(e||"").replace(/"/g,"&quot;").replace(/</g,"&lt;")}function re(e){return!e&&e!==0?"":e<1024?e+" B":e<1048576?(e/1024).toFixed(1)+" KB":(e/1048576).toFixed(1)+" MB"}function ce(e,t,n,o,s){if(!t.length){e.innerHTML=I("\u{1F4C1}","\u6682\u65E0\u6A21\u578B\u6587\u4EF6");return}const a=se(t,o,n),i=j(a,"",n,o,s);if(!i){e.innerHTML=I("\u{1F50D}","\u672A\u627E\u5230\u5339\u914D\u7684\u6587\u4EF6");return}e.innerHTML=i}function le(e,t){if(!e)return;const n=oe(t);e.textContent=`\u5171 ${n.total} \u9879 (\u5DF2\u542F\u7528 ${n.enabled}) \xB7 ${ee(n.totalSize)}`}function j(e,t,n,o,s){const a=!!(n||"").trim(),i=Object.keys(e).sort((l,c)=>{const u=!e[l]._e,d=!e[c]._e;if(u&&!d)return-1;if(!u&&d)return 1;const f=e[l]._e,p=e[c]._e;return o==="size"?((p==null?void 0:p.size)||0)-((f==null?void 0:f.size)||0):o==="date"?((p==null?void 0:p.modTime)||0)-((f==null?void 0:f.modTime)||0):l.localeCompare(c)});let r="";return i.forEach(l=>{const c=e[l],u=t?t+"/"+l:l;if(c._e){const d=c._e;if(a&&!d.name.toLowerCase().includes(n.toLowerCase()))return;const f=a?Z(d.name,n):d.name,p=d.modTime?te(d.modTime):"",g=ne(d.name);r+=ae(d,f,g,p)}else{const d=l.startsWith("_"),f=a||!!s[u],p=a?G(c,n.toLowerCase()):!1;r+=ie(l,u,f||a&&p,d),r+=j(c,u,n,o,s),r+="</div>"}}),r}function y(e){!e||(e.classList.add("flash"),setTimeout(()=>e.classList.remove("flash"),400))}function de(e,t){e.querySelectorAll(".fh").forEach(n=>{n.onclick=o=>{o.stopPropagation();const s=n.nextElementSibling,a=n.querySelector(".ar");if(!s)return;const i=s.style.display!=="none";s.style.display=i?"none":"block",a.classList.toggle("open",!i),t._dirOpen[n.dataset.dir]=!i,localStorage.setItem("at_dirs",JSON.stringify(t._dirOpen))}}),e.querySelectorAll(".ck").forEach(n=>{n.onclick=o=>{o.stopPropagation();const s=n.classList.contains("on");n.classList.toggle("on"),n.textContent=n.classList.contains("on")?"\u2713":"";const a=n.closest(".fl");a&&a.classList.add("flash"),setTimeout(()=>a==null?void 0:a.classList.remove("flash"),400);const i=n.dataset.path,r=n.dataset.fullpath||i;bus.emit("entry:toggle",{path:r,relPath:i,enabled:!s})},n.ondblclick=()=>{const o=n.dataset.fullpath||n.dataset.path;o&&bus.emit("model:select",{path:o})}}),e.querySelectorAll(".fl").forEach(n=>{n.oncontextmenu=o=>{var r,l,c;o.preventDefault();const s=((l=(r=n.querySelector(".nm"))==null?void 0:r.textContent)==null?void 0:l.replace(/^\S+\s/,""))||"",a=!((c=n.querySelector(".ck"))!=null&&c.classList.contains("on")),i=n.dataset.fullpath||n.dataset.path;bus.emit("ctx:show",{x:o.clientX,y:o.clientY,path:i,relPath:n.dataset.path,name:s,banned:a})}})}function pe(e,t){var s,a,i,r,l,c,u,d,f;const n=p=>e.getElementById(p),o=()=>t._renderTree();(s=n("srch"))==null||s.addEventListener("input",p=>{t._search=p.target.value,o()}),(a=n("sort"))==null||a.addEventListener("change",p=>{t._sort=p.target.value,o()}),(i=n("btn-repo"))==null||i.addEventListener("click",()=>bus.emit("dir:select-repo")),(r=n("btn-dedup"))==null||r.addEventListener("click",()=>bus.emit("entries:dedup")),(l=n("btn-trash"))==null||l.addEventListener("click",()=>bus.emit("recycle:open")),(c=n("btn-pv"))==null||c.addEventListener("click",()=>bus.emit("preview:toggle")),(u=n("btn-ea"))==null||u.addEventListener("click",()=>{y(n("btn-ea")),t._entries.forEach(p=>{p.banned=!1}),o()}),(d=n("btn-da"))==null||d.addEventListener("click",()=>{y(n("btn-da")),t._entries.forEach(p=>{p.banned=!0}),o()}),(f=n("btn-st"))==null||f.addEventListener("click",()=>y(n("btn-st")))}function ue(e,t,n,o,s,a){return window.go.main.App.AddImportLog(e,t,n,o,s,a)}function fe(e){return window.go.main.App.AnalyzeYSMModel(e)}function me(e){return window.go.main.App.CheckFileExists(e)}function he(e){return window.go.main.App.ClearCustomDir(e)}function ge(){return window.go.main.App.ClearImportLogs()}function be(e){return window.go.main.App.CountLinkedModels(e)}function xe(e){return window.go.main.App.CreateDir(e)}function ve(e){return window.go.main.App.DeduplicateCustomDir(e)}function we(e){return window.go.main.App.DeleteFromRecycle(e)}function ye(e){return window.go.main.App.EmptyRecycleBin(e)}function _e(e){return window.go.main.App.GetGlobalCustomDir(e)}function Se(){return window.go.main.App.GetImportLogs()}function N(e,t){return window.go.main.App.GetInstanceStatus(e,t)}function ke(){return window.go.main.App.GetLinkMode()}function Le(){return window.go.main.App.GetMinecraftPath()}function Me(){return window.go.main.App.GetWindowPosition()}function Ce(e){return window.go.main.App.HasYSMMod(e)}function Te(e,t){return window.go.main.App.ImportModelFile(e,t)}function ze(e,t){return window.go.main.App.InstallModelFile(e,t)}function Ee(e,t){return window.go.main.App.InstallModelTo(e,t)}function Ae(e,t){return window.go.main.App.InstallModelWithOverlay(e,t)}function Y(e){return window.go.main.App.IsFileBanned(e)}function Re(e){return window.go.main.App.IsSymlink(e)}function $e(e){return window.go.main.App.ListFileNames(e)}function Ie(e){return window.go.main.App.ListRecycleBin(e)}function q(e){return window.go.main.App.ListVersionInstances(e)}function v(){return window.go.main.App.LoadAppConfig()}function He(e,t){return window.go.main.App.MoveModelFile(e,t)}function Be(e){return window.go.main.App.MoveToRecycle(e)}function Pe(e){return window.go.main.App.MoveToRecycleEx(e)}function De(e){return window.go.main.App.OpenFolder(e)}function Fe(e,t){return window.go.main.App.RestoreFromRecycle(e,t)}function A(e,t,n){return window.go.main.App.SaveAppConfig(e,t,n)}function Oe(e,t,n,o){return window.go.main.App.SaveWindowPosition(e,t,n,o)}function Ge(e){return window.go.main.App.ScanCustomModels(e)}function R(e){return window.go.main.App.ScanModelEntries(e)}function $(){return window.go.main.App.SelectDirectory()}function je(e){return window.go.main.App.SetLinkMode(e)}function Ne(e){return window.go.main.App.SetRepoRoot(e)}function Ye(e,t){return window.go.main.App.SyncCustomToRepo(e,t)}function qe(e,t){return window.go.main.App.SyncModelToggleStatus(e,t)}function U(e){return window.go.main.App.ToggleModelEnable(e)}const z=Object.freeze(Object.defineProperty({__proto__:null,AddImportLog:ue,AnalyzeYSMModel:fe,CheckFileExists:me,ClearCustomDir:he,ClearImportLogs:ge,CountLinkedModels:be,CreateDir:xe,DeduplicateCustomDir:ve,DeleteFromRecycle:we,EmptyRecycleBin:ye,GetGlobalCustomDir:_e,GetImportLogs:Se,GetInstanceStatus:N,GetLinkMode:ke,GetMinecraftPath:Le,GetWindowPosition:Me,HasYSMMod:Ce,ImportModelFile:Te,InstallModelFile:ze,InstallModelTo:Ee,InstallModelWithOverlay:Ae,IsFileBanned:Y,IsSymlink:Re,ListFileNames:$e,ListRecycleBin:Ie,ListVersionInstances:q,LoadAppConfig:v,MoveModelFile:He,MoveToRecycle:Be,MoveToRecycleEx:Pe,OpenFolder:De,RestoreFromRecycle:Fe,SaveAppConfig:A,SaveWindowPosition:Oe,ScanCustomModels:Ge,ScanModelEntries:R,SelectDirectory:$,SetLinkMode:je,SetRepoRoot:Ne,SyncCustomToRepo:Ye,SyncModelToggleStatus:qe,ToggleModelEnable:U},Symbol.toStringTag,{value:"Module"}));async function W(){const e=await v(),t=e.repoRoot||e.RepoRoot||"";if(!t)return null;const n=await R(t);if(!n||!n.length)return null;const o=[];for(const s of n){let a=!1;try{a=await Y(s.Path)}catch{}let i=s.Path;t&&s.Path.startsWith(t)&&(i=s.Path.slice(t.length).replace(/^[/\\]+/,"")),o.push({name:s.Name,path:i,fullPath:s.Path,size:s.Size,modTime:s.ModTime,banned:a})}return{repoRoot:t,entries:o}}function h(){const e=Date.now();return[{name:"steve_skin.ysm",path:"steve_skin.ysm",size:1258291,modTime:e-864e5,banned:!1},{name:"alex_deluxe.ysm",path:"alex/alex_deluxe.ysm",size:2516582,modTime:e-1728e5,banned:!1},{name:"alex_head.ysm",path:"alex/alex_head.ysm",size:524288,modTime:e-1728e5,banned:!1},{name:"dragon_armor.zip",path:"dragon/dragon_armor.zip",size:3984588,modTime:e-36e5,banned:!1},{name:"dragon_wings.ysm",path:"dragon/dragon_wings.ysm",size:2202009,modTime:e-72e5,banned:!1},{name:"neon_sword.ysm",path:"weapons/neon_sword.ysm",size:1572864,modTime:e,banned:!1},{name:"magic_staff.zip",path:"weapons/magic_staff.zip",size:4404019,modTime:e-72e5,banned:!1},{name:"photon_body.ysm",path:"photon/photon_body.ysm",size:2202009,modTime:e-432e5,banned:!1},{name:"old_model.ysm",path:"_disabled/old_model.ysm",size:943718,modTime:e-6048e5,banned:!0},{name:"custom_hat.ysm",path:"custom/custom_hat.ysm",size:838860,modTime:e-2592e5,banned:!1},{name:"steve_2d.ysm",path:"custom/steve_2d.ysm",size:314572,modTime:e-5e5,banned:!1}]}function Ue(e){const t=[];return t.push(bus.on("entry:toggle",async({path:n})=>{try{await U(n)}catch{}await H(e)})),t.push(bus.on("dir:select-repo",async()=>{try{const n=await $();if(!n)return;await A(n,"","copy"),e._repoRoot=n,await H(e)}catch{e._entries=h(),e._renderTree()}})),t.push(bus.on("entries:dedup",()=>{bus.emit("toast:show",{msg:"\u{1F517} \u53BB\u91CD\u529F\u80FD\u5F00\u53D1\u4E2D",duration:2e3,type:"info"})})),t.push(bus.on("recycle:open",()=>{bus.emit("toast:show",{msg:"\u{1F5D1}\uFE0F \u56DE\u6536\u7AD9\u529F\u80FD\u5F00\u53D1\u4E2D",duration:2e3,type:"info"})})),t}async function H(e){try{const t=await W();t?(e._repoRoot=t.repoRoot,e._entries=t.entries):e._entries=h()}catch{e._entries=h()}e._renderTree()}class We extends HTMLElement{constructor(){super(),this._root=this.attachShadow({mode:"open"}),this._root.adoptedStyleSheets=[new CSSStyleSheet],this._root.adoptedStyleSheets[0].replaceSync(J),this._entries=[],this._search="",this._sort="name",this._dirOpen={},this._repoRoot=""}async connectedCallback(){try{Object.assign(this._dirOpen,JSON.parse(localStorage.getItem("at_dirs")||"{}"))}catch{}this._renderLayout(),pe(this._root,this),this._unsubs=Ue(this),await this._load(),this._renderTree()}disconnectedCallback(){var t;(t=this._unsubs)==null||t.forEach(n=>n==null?void 0:n())}async _load(){try{const t=await W();t?(this._repoRoot=t.repoRoot,this._entries=t.entries):this._entries=h()}catch{this._entries=h()}}_renderLayout(){this._root.innerHTML=X()+'<div class="list" id="tree"><div class="empty"><div class="big">\u{1F4C1}</div>\u6682\u65E0\u6A21\u578B\u6587\u4EF6</div></div>'+Q()}_renderTree(){const t=this._root.getElementById("tree");ce(t,this._entries,this._search,this._sort,this._dirOpen),de(t,this),le(this._root.getElementById("ftr-stat"),this._entries)}}customElements.define("app-tree",We);const Ve=`
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
.vc-header .tag.orange { background: #f9a82622; color: #f9a826; }
.vc-body { padding: 2px 10px 8px; }
.vc-body .sec-title { font-size: 9px; color: #6c7086; padding: 4px 2px 2px; text-transform: uppercase; letter-spacing: .5px; }
.vc-body .row {
  display: flex; align-items: center; gap: 6px; padding: 2px 6px;
  border-radius: 4px; font-size: 10px; transition: background .12s;
}
.vc-body .row:hover { background: #2a2a42; }
.vc-body .row .dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.vc-body .row .rn { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vc-body .row .link-icon { font-size: 9px; margin-right: 4px; flex-shrink: 0; }
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
</div>`}function Je(){return`<div class="footer">
<button class="footer-btn" id="btn-mc">\u{1F3AE} \u6307\u5B9A\u6E38\u620F\u8DEF\u5F84</button>
</div>`}function Xe(){return'<div class="list" id="vg"></div>'}function Qe(e,t,n,o,s=!1){let a="";o==="complete"?a='<span class="tag green">\u2705</span>':o==="extra"?a='<span class="tag orange">\u{1F4E4}</span>':o==="missing"&&(a='<span class="tag red">\u2B07\uFE0F</span>');const i=[];return t>0&&i.push(`<span class="tag green">\u2705 ${t}</span>`),n>0&&i.push(`<span class="tag red">\u2B07\uFE0F ${n}</span>`),`<div class="vc-header">
<span class="${s?"arrow open":"arrow"}">\u25B6</span>
${a}
<span class="name">\u{1F4E6} ${V(e)}</span>
${i.join("")}
</div>`}function _(e,t){return`<div class="sec-title">${e} (${t})</div>`}function S(e,t,n,o){const s=o?`<span class="link-icon">${o}</span>`:"";return`<div class="row"><span class="dot" style="background:${e}"></span><span class="rn">${V(t)}</span>${s}<span class="sz">${n}</span></div>`}function V(e){return(e||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function Ze(e,t){e.innerHTML="",t.forEach((n,o)=>{const s=document.createElement("div");s.className="vc",s.dataset.idx=o;const a=o===0;s.innerHTML=Qe(n.name,n.synced,n.missing,n.status,a),e.appendChild(s);const i=document.createElement("div");i.className="vc-body",i.style.display=a?"":"none",i.innerHTML=et(n),e.appendChild(i)})}function et(e){let t="";return e.items.synced.length&&(t+=_("\u2705 \u5DF2\u540C\u6B65",e.items.synced.length),e.items.synced.forEach(n=>{t+=S("#a6e3a1",n.name,n.size,n.linkType)})),e.items.missing.length&&(t+=_("\u2B07\uFE0F \u7F3A\u5931",e.items.missing.length),e.items.missing.forEach(n=>{t+=S("#f38ba8",n.name,n.size)})),e.items.extra.length&&(t+=_("\u{1F4E4} \u989D\u5916",e.items.extra.length),e.items.extra.forEach(n=>{t+=S("#f9a826",n.name,n.size)})),t}function tt(e){e.querySelectorAll(".vc-context-menu").forEach(t=>t.remove()),e.querySelectorAll(".vc").forEach(t=>{const n=t.querySelector(".vc-header"),o=t.nextElementSibling;!n||!o||!o.classList.contains("vc-body")||(n.onclick=()=>{const s=n.querySelector(".arrow");o.style.display=o.style.display==="none"?"":"none",s&&s.classList.toggle("open")},n.ondblclick=()=>{const s=n.querySelector(".name"),a=s?s.textContent.replace(/^📦\s*/,""):"";bus.emit("instance:select",{name:a})},n.oncontextmenu=s=>{s.preventDefault();const a=n.querySelector(".name"),i=a?a.textContent.replace(/^📦\s*/,""):"";bus.emit("ctx:show",{x:s.clientX,y:s.clientY,type:"instance",instanceName:i})})})}function nt(e,t){const n=e.getElementById("ver-search");n&&(n.oninput=o=>{const s=o.target.value.toLowerCase().trim();t._search=s,t._renderCards()})}function st(e){const t=e.getElementById("btn-mc");t&&(t.onclick=()=>bus.emit("dir:select-mc"))}async function ot(){bus.emit("loading:start");try{const e=await v(),t=e.mcRoot||e.McRoot||"",n=e.repoRoot||e.RepoRoot||"";if(!t||!n)return null;const o=await R(n),s=new Set;o.forEach(c=>s.add(c.Name.replace(/\.ban$/i,"")));const a=await q(t);if(!a||!a.length)return null;const i=await N(t,n),r={};return(i||[]).forEach(c=>{r[c.Name]=c}),a.map(c=>{const u=r[c.Name]||{},d=u.Missing||[],f=u.Extra||[],p=new Set(d.map(m=>m.replace(/\.ban$/i,""))),g=new Set(f.map(m=>m.replace(/\.ban$/i,""))),w=[];return s.forEach(m=>{!p.has(m)&&!g.has(m)&&w.push(m)}),{name:c.Name,exists:c.Exists,hasYSM:u.HasYSM,status:u.Status||"missing",synced:w.length,missing:d.length,extra:f.length,items:{synced:w.slice(0,20).map(m=>{const K=at(m,u.Files);return{name:m,size:"",linkType:K}}),missing:d.slice(0,20).map(m=>({name:m,size:""})),extra:f.slice(0,20).map(m=>({name:m,size:""}))}}})}finally{bus.emit("loading:end")}}function at(e,t){if(!t||!t.length)return"";const n=t.find(o=>o.Name===e);return n?n.LinkType==="symlink"||n.LinkType==="hardlink"?"\u{1F517}":"\u{1F4CB}":""}function B(){return[{name:"\u6211\u7684\u6574\u5408\u5305",synced:3,missing:1,extra:2,items:{synced:[{name:"steve_skin.ysm",size:"1.2 MB"},{name:"alex_deluxe.ysm",size:"2.4 MB"},{name:"neon_sword.ysm",size:"1.5 MB"}],missing:[{name:"dragon_armor.zip",size:"3.8 MB"}],extra:[{name:"custom_hat.ysm",size:"0.8 MB"},{name:"old_hat.ysm",size:"0.3 MB"}]}},{name:"\u5149\u5F71\u6D4B\u8BD5\u5305",synced:1,missing:2,extra:0,items:{synced:[],missing:[],extra:[]}},{name:"\u7A7A\u5C9B\u751F\u5B58",synced:5,missing:0,extra:0,items:{synced:[],missing:[],extra:[]}},{name:"RPG \u5192\u9669",synced:2,missing:3,extra:0,items:{synced:[],missing:[],extra:[]}}]}class it extends HTMLElement{constructor(){super(),this._root=this.attachShadow({mode:"open"}),this._root.adoptedStyleSheets=[new CSSStyleSheet],this._root.adoptedStyleSheets[0].replaceSync(Ve),this._instances=[],this._unsubs=[],this._search=""}async connectedCallback(){this._renderLayout(),this._unsubs.push(bus.on("dir:select-mc",async()=>{try{const t=await $();if(!t)return;const n=await v();await A(n.repoRoot||"",t,n.linkMode||"copy")}catch{}await this._reload()})),this._unsubs.push(bus.on("stats:refresh",async()=>{await this._reload()})),await this._reload()}_renderCards(){const t=this._root.getElementById("vg");if(!t)return;const n=this._search,o=n?this._instances.filter(s=>s.name.toLowerCase().includes(n)):this._instances;Ze(t,o),tt(this._root)}async _reload(){try{const n=await ot();n?this._instances=n:this._instances=B()}catch{this._instances=B()}const t=this._root.getElementById("ver-stat");t&&(t.textContent=`${this._instances.length}\u4E2A\u6574\u5408\u5305`),this._renderCards(),nt(this._root,this),st(this._root)}disconnectedCallback(){this._unsubs.forEach(t=>t())}_renderLayout(){this._root.innerHTML=Ke()+Xe()+Je()}}customElements.define("app-sidebar",it);const rt="modulepreload",ct=function(e){return"/"+e},P={},E=function(t,n,o){if(!n||n.length===0)return t();const s=document.getElementsByTagName("link");return Promise.all(n.map(a=>{if(a=ct(a),a in P)return;P[a]=!0;const i=a.endsWith(".css"),r=i?'[rel="stylesheet"]':"";if(!!o)for(let u=s.length-1;u>=0;u--){const d=s[u];if(d.href===a&&(!i||d.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${a}"]${r}`))return;const c=document.createElement("link");if(c.rel=i?"stylesheet":rt,i||(c.as="script",c.crossOrigin=""),c.href=a,document.head.appendChild(c),i)return new Promise((u,d)=>{c.addEventListener("load",u),c.addEventListener("error",()=>d(new Error(`Unable to preload CSS for ${a}`)))})})).then(()=>t())},lt=`
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
`;function dt(){return`<div class="content" id="preview-content">
<h3>\u{1F4CA} \u7EDF\u8BA1</h3>
<div class="stat-row"><span class="label">\u4ED3\u5E93\u6A21\u578B</span><span class="value" id="s-repo">0</span></div>
<div class="stat-row"><span class="label">\u6574\u5408\u5305\u6570</span><span class="value" id="s-ver">0</span></div>
<div class="stat-row"><span class="label">\u5B8C\u5168\u540C\u6B65</span><span class="value" id="s-ok">0</span></div>
<div class="stat-row"><span class="label">\u5F85\u4E0A\u4F20</span><span class="value accent" id="s-pending">0</span></div>
<hr class="divider">
<div class="btn-group">
<button class="btn" id="btn-install">\u{1F4E5} \u4E0B\u8F7D\u6574\u5408\u5305 <span class="tag">\u9884\u544A</span></button>
<button class="btn warn" id="btn-upload">\u{1F4E4} \u4E0A\u4F20\u5F85\u4E0A\u4F20</button>
</div>
</div>`}function k(e){return!e||e.hasError?`<div class="content" id="preview-content">
<h3>\u{1F4C4} \u6A21\u578B\u4FE1\u606F</h3>
<div class="err">\u26A0\uFE0F ${e?e.errorMsg:"\u672A\u77E5\u9519\u8BEF"}</div>
</div>`:`<div class="content" id="preview-content">
<h3>\u{1F4C4} \u6A21\u578B\u4FE1\u606F</h3>
<div class="md-row"><span class="md-label">\u540D\u79F0</span><span class="md-value">${L(e.name||"-")}</span></div>
<div class="md-row"><span class="md-label">\u4F5C\u8005</span><span class="md-value">${L(e.author||"-")}</span></div>
<div class="md-row"><span class="md-label">\u7248\u672C</span><span class="md-value">${L(e.version||"-")}</span></div>
<div class="md-divider"></div>
<div class="md-row"><span class="md-label">\u{1F9B4} \u9AA8\u9ABC</span><span class="md-value">${e.bones||0}</span></div>
<div class="md-row"><span class="md-label">\u{1F5BC}\uFE0F \u8D34\u56FE</span><span class="md-value">${e.textures||0}</span></div>
<div class="md-row"><span class="md-label">\u{1F3AC} \u52A8\u753B</span><span class="md-value">${e.animations||0}</span></div>
<div class="md-row"><span class="md-label">\u{1F53A} \u9876\u70B9</span><span class="md-value">${(e.vertices||0).toLocaleString()}</span></div>
<div class="md-row"><span class="md-label">\u25FB\uFE0F \u9762</span><span class="md-value">${(e.faces||0).toLocaleString()}</span></div>
</div>`}function L(e){return(e||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}const pt={repo:6,ver:4,ok:2,tot:4,pending:2};function D(e,t){const n=o=>e.getElementById(o);n("s-repo")&&(n("s-repo").textContent=t.repo),n("s-ver")&&(n("s-ver").textContent=t.ver),n("s-ok")&&(n("s-ok").textContent=t.ok),n("s-tot")&&(n("s-tot").textContent=t.tot),n("s-pending")&&(n("s-pending").textContent=t.pending)}function ut(e){var t;(t=e.getElementById("btn-upload"))==null||t.addEventListener("click",async()=>{bus.emit("stats:upload")})}function ft(e,t,n){n.push(bus.on("stats:updated",o=>{o&&Object.assign(t,o),bus.emit("_preview:needs-update")}))}class mt extends HTMLElement{constructor(){super(),this._root=this.attachShadow({mode:"open"}),this._root.adoptedStyleSheets=[new CSSStyleSheet],this._root.adoptedStyleSheets[0].replaceSync(lt),this._stats={...pt},this._unsubs=[],this._mode="stat"}static get observedAttributes(){return["mode"]}attributeChangedCallback(t,n,o){t==="mode"&&(this._mode=o==="model"?"model":"stat",this._root.isConnected&&this._render())}connectedCallback(){this._mode=this.getAttribute("mode")==="model"?"model":"stat",this._render(),this._mode==="stat"&&(ft(this._root,this._stats,this._unsubs),this._unsubs.push(bus.on("_preview:needs-update",()=>{D(this._root,this._stats)})),this._unsubs.push(bus.on("stats:refresh",()=>{this._loadRealStats()})),this._loadRealStats()),this._mode==="model"&&this._unsubs.push(bus.on("model:select",async({path:t})=>{this._showModelDetail(t)}))}disconnectedCallback(){this._unsubs.forEach(t=>t())}_render(){this._mode==="stat"?(this._root.innerHTML=dt(),ut(this._root)):this._root.innerHTML=k(null)}async _loadRealStats(){bus.emit("loading:start");try{const{LoadAppConfig:t,GetInstanceStatus:n,ScanModelEntries:o}=await E(()=>Promise.resolve().then(()=>z),void 0),s=await t(),a=s.mcRoot||s.McRoot||"",i=s.repoRoot||s.RepoRoot||"",r=await o(i),l=r?r.length:0;let c=0,u=0,d=0;if(a&&i){const f=await n(a,i);f&&(c=f.length,f.forEach(p=>{p.Status==="complete"?u++:p.Status==="extra"&&d++}))}this._stats={repo:l,ver:c,ok:u,tot:c,pending:d},D(this._root,this._stats)}catch{}finally{bus.emit("loading:end")}}async _showModelDetail(t){this._root.innerHTML='<div class="content" id="preview-content"><h3>\u{1F4C4} \u6A21\u578B\u4FE1\u606F</h3><div class="stat-row"><span class="label">\u52A0\u8F7D\u4E2D...</span></div></div>';try{const{AnalyzeYSMModel:n}=await E(()=>Promise.resolve().then(()=>z),void 0),o=await n(t);this._root.innerHTML=k(o)}catch(n){this._root.innerHTML=k({hasError:!0,errorMsg:String(n)})}}}customElements.define("app-preview",mt);const ht=`
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
</div>`}function O(e,t){return`<div class="placeholder-box"><div class="big">${e}</div><div>${t}</div><span class="ptag">\u9884\u544A</span></div>`}let M,C,T;class vt extends HTMLElement{constructor(){super(),this._root=this.attachShadow({mode:"open"}),this._root.adoptedStyleSheets=[new CSSStyleSheet],this._root.adoptedStyleSheets[0].replaceSync(ht),this._current="dashboard"}connectedCallback(){this._unsub=bus.on("nav:change",({page:t})=>{this._current=t,bus.emit("nav:changed",{page:t}),this._render()}),bus.on("stats:upload",()=>this._handleUpload()),E(()=>Promise.resolve().then(()=>z),void 0).then(t=>{M=t.LoadAppConfig,C=t.GetInstanceStatus,T=t.SyncCustomToRepo}),this._render()}disconnectedCallback(){this._unsub&&this._unsub()}async _handleUpload(){if(!(!M||!C||!T))try{const t=await M(),n=t.mcRoot||t.McRoot||"",o=t.repoRoot||t.RepoRoot||"";if(!n||!o)return;const s=await C(n,o);if(!s||!s.length)return;let a=0;for(const i of s){if(!i.Extra||i.Extra.length===0)continue;const r=await T(i.CustomDir,o);a+=r}bus.emit("stats:refresh")}catch{}}_render(){let t="";switch(this._current){case"dashboard":t=F();break;case"repository":t=gt();break;case"instances":t=bt();break;case"downloads":t=O("\u2B07\uFE0F","\u4E0B\u8F7D\u4E0E\u66F4\u65B0");break;case"diagnostics":t=O("\u{1F6E0}\uFE0F","\u8BCA\u65AD\u4E0E\u51B2\u7A81\u68C0\u6D4B");break;case"settings":t=xt();break;default:t=F()}this._root.innerHTML=`<div class="page">${t}</div>`}}customElements.define("app-content",vt);bus.on("ctx:show",({x:e,y:t,type:n,instanceName:o,path:s,name:a,banned:i})=>{if(n==="instance"){bus.emit("menu:show",{x:e,y:t,items:[{label:`\u{1F4E6} ${o}`,icon:"\u{1F4CC}",onClick:()=>bus.emit("instance:select",{name:o})},{divider:!0},{label:"\u{1F4E5} \u5B89\u88C5\u6A21\u578B",icon:"\u{1F4E5}",onClick:()=>bus.emit("instance:install",{name:o})},{label:"\u{1F504} \u540C\u6B65\u72B6\u6001",icon:"\u{1F504}",onClick:()=>bus.emit("instance:sync",{name:o})},{label:"\u{1F5D1}\uFE0F \u6E05\u7A7A\u76EE\u5F55",icon:"\u{1F5D1}\uFE0F",danger:!0,onClick:()=>bus.emit("instance:clear",{name:o})}]});return}});
