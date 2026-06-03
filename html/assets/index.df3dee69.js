(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))o(s);new MutationObserver(s=>{for(const a of s)if(a.type==="childList")for(const i of a.addedNodes)i.tagName==="LINK"&&i.rel==="modulepreload"&&o(i)}).observe(document,{childList:!0,subtree:!0});function n(s){const a={};return s.integrity&&(a.integrity=s.integrity),s.referrerpolicy&&(a.referrerPolicy=s.referrerpolicy),s.crossorigin==="use-credentials"?a.credentials="include":s.crossorigin==="anonymous"?a.credentials="omit":a.credentials="same-origin",a}function o(s){if(s.ep)return;s.ep=!0;const a=n(s);fetch(s.href,a)}})();const K=`
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
<button class="hdr-btn accent" id="btn-st">\u25B6\uFE0F \u540C\u6B65\u72B6\u6001</button>
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
</div>`}function D(t,e){return`<div class="empty"><div class="big">${t}</div>${e}</div>`}function y(t){return(t||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function Q(t,e){const n=y(t);if(!e)return n;const o=e.toLowerCase(),s=t.toLowerCase().indexOf(o);if(s===-1)return n;const a=y(t.substring(0,s)),i=y(t.substring(s,s+e.length)),r=y(t.substring(s+e.length));return a+"<mark>"+i+"</mark>"+r}function Z(t){return!t&&t!==0?"":t<1024?t+" B":t<1048576?(t/1024).toFixed(1)+" KB":(t/1048576).toFixed(1)+" MB"}function tt(t){if(!t)return"";const e=new Date(t),n=new Date;return e.toDateString()===n.toDateString()?e.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):(n-e)/864e5<7?["\u65E5","\u4E00","\u4E8C","\u4E09","\u56DB","\u4E94","\u516D"][e.getDay()]+" "+e.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):e.toLocaleDateString([],{month:"short",day:"numeric"})}function et(t){const e=(t.split(".").pop()||"").toLowerCase();return e==="ysm"?"\u{1F48E}":["zip","rar","7z","tar","gz"].includes(e)?"\u{1F4E6}":["png","jpg","jpeg","gif","webp","bmp"].includes(e)?"\u{1F5BC}\uFE0F":["txt","md","json","xml","yml","yaml","cfg","conf","ini"].includes(e)?"\u{1F4C4}":"\u{1F9CA}"}function nt(t,e,n){const o=[...t].sort((i,r)=>e==="size"?(r.size||0)-(i.size||0):e==="date"?(r.modTime||0)-(i.modTime||0):i.name.localeCompare(r.name)),s=(n||"").trim().toLowerCase(),a={};return o.forEach(i=>{if(s&&!i.name.toLowerCase().includes(s))return;const r=i.path.replace(/\\/g,"/").split("/");let l=a;for(let c=0;c<r.length-1;c++)!r[c]||(l[r[c]]||(l[r[c]]={}),l=l[r[c]]);l[r[r.length-1]]={_e:i}}),a}function G(t,e){if(!e||!t)return!1;for(const n of Object.keys(t)){const o=t[n];if(o._e){if(o._e.name.toLowerCase().includes(e))return!0}else if(n.toLowerCase().includes(e)||G(o,e))return!0}return!1}function st(t){const e=t.length,n=t.filter(s=>!s.banned).length,o=t.reduce((s,a)=>s+(a.size||0),0);return{total:e,enabled:n,totalSize:o}}function ot(t,e,n,o){const s=w(t.path),a=w(t.fullPath||t.path),i=t.banned?"":" on",r=t.banned?"":"\u2713";return`<div class="fl${t.banned?" ban":""}" data-path="${s}" data-fullpath="${a}">
<span class="ck${i}" data-path="${s}" data-fullpath="${a}">${r}</span>
<span class="ficon">${n}</span>
<span class="nm">${e}</span>
<span class="sz">${it(t.size)}</span>${o?`<span class="dt">${o}</span>`:""}</div>`}function at(t,e,n,o){const s=o?"\u{1F512}":"\u{1F4C1}",a=o?"#585b70":"#a6adc8",i=o?" locked":"",r=n?"\u25BC":"\u25B6",l=n?" open":"";return`<div class="fh${i}" data-dir="${w(e)}">
<span class="ar${l}">${r}</span>
<span class="nm" style="color:${a}">${s} ${w(t)}</span></div>
<div class="ch" style="display:${n?"block":"none"}">`}function w(t){return(t||"").replace(/"/g,"&quot;").replace(/</g,"&lt;")}function it(t){return!t&&t!==0?"":t<1024?t+" B":t<1048576?(t/1024).toFixed(1)+" KB":(t/1048576).toFixed(1)+" MB"}function rt(t,e,n,o,s){if(!e.length){t.innerHTML=D("\u{1F4C1}","\u6682\u65E0\u6A21\u578B\u6587\u4EF6");return}const a=nt(e,o,n),i=N(a,"",n,o,s);if(!i){t.innerHTML=D("\u{1F50D}","\u672A\u627E\u5230\u5339\u914D\u7684\u6587\u4EF6");return}t.innerHTML=i}function ct(t,e){if(!t)return;const n=st(e);t.textContent=`\u5171 ${n.total} \u9879 (\u5DF2\u542F\u7528 ${n.enabled}) \xB7 ${Z(n.totalSize)}`}function N(t,e,n,o,s){const a=!!(n||"").trim(),i=Object.keys(t).sort((l,c)=>{const d=!t[l]._e,f=!t[c]._e;if(d&&!f)return-1;if(!d&&f)return 1;const u=t[l]._e,p=t[c]._e;return o==="size"?((p==null?void 0:p.size)||0)-((u==null?void 0:u.size)||0):o==="date"?((p==null?void 0:p.modTime)||0)-((u==null?void 0:u.modTime)||0):l.localeCompare(c)});let r="";return i.forEach(l=>{const c=t[l],d=e?e+"/"+l:l;if(c._e){const f=c._e;if(a&&!f.name.toLowerCase().includes(n.toLowerCase()))return;const u=a?Q(f.name,n):f.name,p=f.modTime?tt(f.modTime):"",m=et(f.name);r+=ot(f,u,m,p)}else{const f=l.startsWith("_"),u=a||!!s[d],p=a?G(c,n.toLowerCase()):!1;r+=at(l,d,u||a&&p,f),r+=N(c,d,n,o,s),r+="</div>"}}),r}function B(t){!t||(t.classList.add("flash"),setTimeout(()=>t.classList.remove("flash"),400))}function lt(t,e){t.querySelectorAll(".fh").forEach(n=>{n.onclick=o=>{o.stopPropagation();const s=n.nextElementSibling,a=n.querySelector(".ar");if(!s)return;const i=s.style.display!=="none";s.style.display=i?"none":"block",a.classList.toggle("open",!i),e._dirOpen[n.dataset.dir]=!i,localStorage.setItem("at_dirs",JSON.stringify(e._dirOpen))}}),t.querySelectorAll(".ck").forEach(n=>{n.onclick=o=>{o.stopPropagation();const s=n.classList.contains("on");n.classList.toggle("on"),n.textContent=n.classList.contains("on")?"\u2713":"";const a=n.closest(".fl");a&&a.classList.add("flash"),setTimeout(()=>a==null?void 0:a.classList.remove("flash"),400);const i=n.dataset.path,r=n.dataset.fullpath||i;bus.emit("entry:toggle",{path:r,relPath:i,enabled:!s})}}),t.querySelectorAll(".fh").forEach(n=>{n.oncontextmenu=o=>{o.preventDefault(),o.stopPropagation(),bus.emit("ctx:show",{x:o.clientX,y:o.clientY,type:"dir",dir:n.dataset.dir})}}),t.querySelectorAll(".fl").forEach(n=>{n.oncontextmenu=o=>{var i;o.preventDefault(),o.stopPropagation();const s=!((i=n.querySelector(".ck"))!=null&&i.classList.contains("on")),a=n.dataset.fullpath||n.dataset.path;bus.emit("ctx:show",{x:o.clientX,y:o.clientY,type:"file",path:a,banned:s})}})}function dt(t,e){var s,a,i,r,l,c,d,f,u;const n=p=>t.getElementById(p),o=()=>e._renderTree();(s=n("srch"))==null||s.addEventListener("input",p=>{e._search=p.target.value,o()}),(a=n("sort"))==null||a.addEventListener("change",p=>{e._sort=p.target.value,o()}),(i=n("btn-repo"))==null||i.addEventListener("click",()=>bus.emit("dir:select-repo")),(r=n("btn-dedup"))==null||r.addEventListener("click",()=>bus.emit("entries:dedup")),(l=n("btn-trash"))==null||l.addEventListener("click",()=>bus.emit("recycle:open")),(c=n("btn-pv"))==null||c.addEventListener("click",()=>bus.emit("preview:toggle")),(d=n("btn-ea"))==null||d.addEventListener("click",()=>{B(n("btn-ea")),e._entries.forEach(p=>{p.banned=!1}),o()}),(f=n("btn-da"))==null||f.addEventListener("click",()=>{B(n("btn-da")),e._entries.forEach(p=>{p.banned=!0}),o()}),(u=n("btn-st"))==null||u.addEventListener("click",()=>{bus.emit("sync:toggle-status")})}function pt(t,e,n,o,s,a){return window.go.main.App.AddImportLog(t,e,n,o,s,a)}function ut(t){return window.go.main.App.AnalyzeYSMModel(t)}function ft(t){return window.go.main.App.CheckFileExists(t)}function gt(t){return window.go.main.App.ClearCustomDir(t)}function mt(){return window.go.main.App.ClearImportLogs()}function ht(t){return window.go.main.App.CountLinkedModels(t)}function bt(t){return window.go.main.App.CreateDir(t)}function xt(t){return window.go.main.App.DeduplicateCustomDir(t)}function vt(t){return window.go.main.App.DeleteFromRecycle(t)}function yt(t){return window.go.main.App.EmptyRecycleBin(t)}function wt(t){return window.go.main.App.GetGlobalCustomDir(t)}function _t(){return window.go.main.App.GetImportLogs()}function q(t,e){return window.go.main.App.GetInstanceStatus(t,e)}function kt(){return window.go.main.App.GetLinkMode()}function St(){return window.go.main.App.GetMinecraftPath()}function Lt(){return window.go.main.App.GetWindowPosition()}function Et(t){return window.go.main.App.HasYSMMod(t)}function Mt(t,e){return window.go.main.App.ImportModelFile(t,e)}function Tt(t,e){return window.go.main.App.InstallModelFile(t,e)}function zt(t,e){return window.go.main.App.InstallModelTo(t,e)}function Ct(t,e){return window.go.main.App.InstallModelWithOverlay(t,e)}function Y(t){return window.go.main.App.IsFileBanned(t)}function At(t){return window.go.main.App.IsSymlink(t)}function Rt(t){return window.go.main.App.ListFileNames(t)}function $t(t){return window.go.main.App.ListRecycleBin(t)}function R(t){return window.go.main.App.ListVersionInstances(t)}function v(){return window.go.main.App.LoadAppConfig()}function It(t,e){return window.go.main.App.MoveModelFile(t,e)}function Ht(t){return window.go.main.App.MoveToRecycle(t)}function Dt(t){return window.go.main.App.MoveToRecycleEx(t)}function Bt(t){return window.go.main.App.OpenFolder(t)}function Pt(t,e){return window.go.main.App.RestoreFromRecycle(t,e)}function $(t,e,n){return window.go.main.App.SaveAppConfig(t,e,n)}function Ft(t,e,n,o){return window.go.main.App.SaveWindowPosition(t,e,n,o)}function Ot(t){return window.go.main.App.ScanCustomModels(t)}function I(t){return window.go.main.App.ScanModelEntries(t)}function H(){return window.go.main.App.SelectDirectory()}function jt(t){return window.go.main.App.SetLinkMode(t)}function Gt(t){return window.go.main.App.SetRepoRoot(t)}function Nt(t,e){return window.go.main.App.SyncCustomToRepo(t,e)}function V(t,e){return window.go.main.App.SyncModelToggleStatus(t,e)}function U(t){return window.go.main.App.ToggleModelEnable(t)}const h=Object.freeze(Object.defineProperty({__proto__:null,AddImportLog:pt,AnalyzeYSMModel:ut,CheckFileExists:ft,ClearCustomDir:gt,ClearImportLogs:mt,CountLinkedModels:ht,CreateDir:bt,DeduplicateCustomDir:xt,DeleteFromRecycle:vt,EmptyRecycleBin:yt,GetGlobalCustomDir:wt,GetImportLogs:_t,GetInstanceStatus:q,GetLinkMode:kt,GetMinecraftPath:St,GetWindowPosition:Lt,HasYSMMod:Et,ImportModelFile:Mt,InstallModelFile:Tt,InstallModelTo:zt,InstallModelWithOverlay:Ct,IsFileBanned:Y,IsSymlink:At,ListFileNames:Rt,ListRecycleBin:$t,ListVersionInstances:R,LoadAppConfig:v,MoveModelFile:It,MoveToRecycle:Ht,MoveToRecycleEx:Dt,OpenFolder:Bt,RestoreFromRecycle:Pt,SaveAppConfig:$,SaveWindowPosition:Ft,ScanCustomModels:Ot,ScanModelEntries:I,SelectDirectory:H,SetLinkMode:jt,SetRepoRoot:Gt,SyncCustomToRepo:Nt,SyncModelToggleStatus:V,ToggleModelEnable:U},Symbol.toStringTag,{value:"Module"}));async function qt(){const t=await v(),e=t.repoRoot||t.RepoRoot||"";if(!e)return null;const n=await I(e);if(!n||!n.length)return null;const o=[];for(const s of n){let a=!1;try{a=await Y(s.Path)}catch{}let i=s.Path;e&&s.Path.startsWith(e)&&(i=s.Path.slice(e.length).replace(/^[/\\]+/,"")),o.push({name:s.Name,path:i,fullPath:s.Path,size:s.Size,modTime:s.ModTime,banned:a})}return{repoRoot:e,entries:o}}function A(){const t=Date.now();return[{name:"steve_skin.ysm",path:"steve_skin.ysm",size:1258291,modTime:t-864e5,banned:!1},{name:"alex_deluxe.ysm",path:"alex/alex_deluxe.ysm",size:2516582,modTime:t-1728e5,banned:!1},{name:"alex_head.ysm",path:"alex/alex_head.ysm",size:524288,modTime:t-1728e5,banned:!1},{name:"dragon_armor.zip",path:"dragon/dragon_armor.zip",size:3984588,modTime:t-36e5,banned:!1},{name:"dragon_wings.ysm",path:"dragon/dragon_wings.ysm",size:2202009,modTime:t-72e5,banned:!1},{name:"neon_sword.ysm",path:"weapons/neon_sword.ysm",size:1572864,modTime:t,banned:!1},{name:"magic_staff.zip",path:"weapons/magic_staff.zip",size:4404019,modTime:t-72e5,banned:!1},{name:"photon_body.ysm",path:"photon/photon_body.ysm",size:2202009,modTime:t-432e5,banned:!1},{name:"old_model.ysm",path:"_disabled/old_model.ysm",size:943718,modTime:t-6048e5,banned:!0},{name:"custom_hat.ysm",path:"custom/custom_hat.ysm",size:838860,modTime:t-2592e5,banned:!1},{name:"steve_2d.ysm",path:"custom/steve_2d.ysm",size:314572,modTime:t-5e5,banned:!1}]}function Yt(t){const e=[];return e.push(bus.on("entry:toggle",async({path:n})=>{try{await U(n)}catch{}await reload(t)})),e.push(bus.on("dir:select-repo",async()=>{try{const n=await H();if(!n)return;await $(n,"","copy"),t._repoRoot=n,await reload(t)}catch{t._entries=A(),t._renderTree()}})),e.push(bus.on("entries:dedup",()=>{bus.emit("toast:show",{msg:"\u{1F517} \u53BB\u91CD\u529F\u80FD\u5F00\u53D1\u4E2D",duration:2e3,type:"info"})})),e.push(bus.on("recycle:open",()=>{bus.emit("toast:show",{msg:"\u{1F5D1}\uFE0F \u56DE\u6536\u7AD9\u529F\u80FD\u5F00\u53D1\u4E2D",duration:2e3,type:"info"})})),e.push(bus.on("batch:enable",({dir:n})=>{batchToggle(t,n,!0)})),e.push(bus.on("batch:disable",({dir:n})=>{batchToggle(t,n,!1)})),e.push(bus.on("sync:toggle-status",async()=>{try{const n=await v(),o=n.repoRoot||n.RepoRoot||"",s=n.mcRoot||n.McRoot||"";if(!o||!s){bus.emit("toast:show",{msg:"\u8BF7\u5148\u914D\u7F6E\u6E38\u620F\u76EE\u5F55\u548C\u4ED3\u5E93\u76EE\u5F55",duration:3e3,type:"warn"});return}const a=await R(s);if(!a||!a.length){bus.emit("toast:show",{msg:"\u6CA1\u6709\u627E\u5230\u6574\u5408\u5305",duration:2e3,type:"info"});return}let i=0,r=0;for(const l of a){if(!l.Exists)continue;const[c,d]=await V(l.CustomDir,o);i+=c,r+=d}bus.emit("toast:show",{msg:`\u2705 \u540C\u6B65\u5B8C\u6210\uFF1A\u7981\u7528 ${i} \u9879\uFF0C\u542F\u7528 ${r} \u9879`,duration:3e3,type:"success"}),await reload(t)}catch(n){bus.emit("toast:show",{msg:`\u540C\u6B65\u5931\u8D25: ${String(n)}`,duration:3e3,type:"error"})}})),e}class Vt extends HTMLElement{constructor(){super(),this._root=this.attachShadow({mode:"open"}),this._root.adoptedStyleSheets=[new CSSStyleSheet],this._root.adoptedStyleSheets[0].replaceSync(K),this._entries=[],this._search="",this._sort="name",this._dirOpen={},this._repoRoot=""}async connectedCallback(){try{Object.assign(this._dirOpen,JSON.parse(localStorage.getItem("at_dirs")||"{}"))}catch{}this._renderLayout(),dt(this._root,this),this._unsubs=Yt(this),await this._load(),this._renderTree()}disconnectedCallback(){var e;(e=this._unsubs)==null||e.forEach(n=>n==null?void 0:n())}async _load(){try{const e=await qt();e?(this._repoRoot=e.repoRoot,this._entries=e.entries):this._entries=A()}catch{this._entries=A()}}_renderLayout(){this._root.innerHTML=X()+'<div class="list" id="tree"><div class="empty"><div class="big">\u{1F4C1}</div>\u6682\u65E0\u6A21\u578B\u6587\u4EF6</div></div>'+J()}_renderTree(){const e=this._root.getElementById("tree");rt(e,this._entries,this._search,this._sort,this._dirOpen),lt(e,this),ct(this._root.getElementById("ftr-stat"),this._entries)}}customElements.define("app-tree",Vt);const Ut=`
:host {
  display: flex; flex-direction: column;
  background: #11111b;
  border-right: 1px solid rgba(255,255,255,.06);
  flex: 1;
  min-width: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 12px;
}
.header { padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,.06); }
.header-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.header-label { font-size: 12px; font-weight: 600; color: #a6adc8; text-transform: uppercase; letter-spacing: .5px; flex: 1; }
.header-stat { font-size: 11px; color: #6c7086; }
.search-input {
  width: 100%; padding: 5px 8px; border-radius: 6px;
  border: 1px solid rgba(255,255,255,.08); background: #181825;
  color: #cdd6f4; font-size: 12px; outline: none; font-family: inherit;
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
.vc-header .arrow { font-size: 8px; color: #6c7086; transition: transform .15s; width: 10px; }
.vc-header .arrow.open { transform: rotate(90deg); }
.vc-header .name { flex: 1; font-size: 13px; font-weight: 600; color: #fff; }
.vc-header .tag { font-size: 10px; padding: 1px 5px; border-radius: 3px; }
.vc-header .tag.green { background: #a6e3a122; color: #a6e3a1; }
.vc-header .tag.red { background: #f38ba822; color: #f38ba8; }
.vc-header .tag.orange { background: #f9a82622; color: #f9a826; }
.vc-body { padding: 2px 10px 8px; }
.vc-body .sec-title { font-size: 10px; color: #6c7086; padding: 4px 2px 2px; text-transform: uppercase; letter-spacing: .5px; }
.vc-body .row {
  display: flex; align-items: center; gap: 6px; padding: 2px 6px;
  border-radius: 4px; font-size: 12px; transition: background .12s;
}
.vc-body .row:hover { background: #2a2a42; }
.vc-body .row .dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.vc-body .row .rn { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vc-body .row .status-icon { font-size: 10px; margin-right: 4px; flex-shrink: 0; }
.vc-body .row .link-icon { font-size: 10px; margin-right: 4px; flex-shrink: 0; }
.vc-body .row .sz { font-size: 11px; color: #6c7086; }
.footer { padding: 8px 12px; border-top: 1px solid rgba(255,255,255,.06); }
.footer-btn {
  width: 100%; padding: 6px 0; border-radius: 6px;
  border: 1px solid rgba(255,255,255,.08); background: transparent;
  color: #cdd6f4; cursor: pointer; font-size: 12px; font-family: inherit; transition: background .12s;
}
.footer-btn:hover { background: #2a2a42; }
`;function Wt(){return`<div class="header">
<div class="header-row">
<span class="header-label">\u{1F4C2} \u7248\u672C\u5217\u8868</span>
<span class="header-stat" id="ver-stat">4\u4E2A\u6574\u5408\u5305</span>
</div>
<input class="search-input" id="ver-search" type="text" placeholder="\u{1F50D} \u641C\u7D22\u6574\u5408\u5305" autocomplete="off" autocapitalize="off">
</div>`}function Kt(){return`<div class="footer">
<button class="footer-btn" id="btn-mc">\u{1F3AE} \u6307\u5B9A\u6E38\u620F\u8DEF\u5F84</button>
</div>`}function Xt(){return'<div class="list" id="vg"></div>'}function Jt(t,e,n,o,s=!1){let a="";o==="complete"?a='<span class="tag green">\u2705</span>':o==="extra"?a='<span class="tag orange">\u{1F4E4}</span>':o==="missing"&&(a='<span class="tag red">\u2B07\uFE0F</span>');const i=[];return e>0&&i.push(`<span class="tag green">\u2705 ${e}</span>`),n>0&&i.push(`<span class="tag red">\u2B07\uFE0F ${n}</span>`),`<div class="vc-header">
<span class="${s?"arrow open":"arrow"}">\u25B6</span>
${a}
<span class="name">\u{1F4E6} ${W(t)}</span>
${i.join("")}
</div>`}function k(t,e){return`<div class="sec-title">${t} (${e})</div>`}function S(t,e,n,o){const s=o?`<span class="link-icon">${o}</span>`:"";return`<div class="row"><span class="dot" style="background:${t}"></span><span class="rn">${W(e)}</span>${s}<span class="sz">${n}</span></div>`}function W(t){return(t||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function Qt(t,e){t.innerHTML="",e.forEach((n,o)=>{const s=document.createElement("div");s.className="vc",s.dataset.idx=o;const a=o===0;s.innerHTML=Jt(n.name,n.synced,n.missing,n.status,a),t.appendChild(s);const i=document.createElement("div");i.className="vc-body",i.style.display=a?"":"none",i.innerHTML=Zt(n),t.appendChild(i)})}function Zt(t){let e="";return t.items.synced.length&&(e+=k("\u2705 \u5DF2\u540C\u6B65",t.items.synced.length),t.items.synced.forEach(n=>{e+=S("#a6e3a1",n.name,n.size,n.linkType)})),t.items.missing.length&&(e+=k("\u2B07\uFE0F \u7F3A\u5931",t.items.missing.length),t.items.missing.forEach(n=>{e+=S("#f38ba8",n.name,n.size,"")})),t.items.extra.length&&(e+=k("\u{1F4E4} \u989D\u5916",t.items.extra.length),t.items.extra.forEach(n=>{e+=S("#f9a826",n.name,n.size,"")})),e}function te(t){t.querySelectorAll(".vc-context-menu").forEach(e=>e.remove()),t.querySelectorAll(".vc").forEach(e=>{const n=e.querySelector(".vc-header"),o=e.nextElementSibling;!n||!o||!o.classList.contains("vc-body")||(n.onclick=()=>{const s=n.querySelector(".arrow");o.style.display=o.style.display==="none"?"":"none",s&&s.classList.toggle("open")},n.oncontextmenu=s=>{s.preventDefault(),s.stopPropagation();const a=n.querySelector(".name"),i=a?a.textContent.replace(/^📦\s*/,""):"";bus.emit("ctx:show",{x:s.clientX,y:s.clientY,type:"instance",instanceName:i})})})}function ee(t,e){const n=t.getElementById("ver-search");n&&(n.oninput=o=>{const s=o.target.value.toLowerCase().trim();e._search=s,e._renderCards()})}function ne(t){const e=t.getElementById("btn-mc");e&&(e.onclick=()=>bus.emit("dir:select-mc"))}async function se(){bus.emit("loading:start");try{const t=await v(),e=t.mcRoot||t.McRoot||"",n=t.repoRoot||t.RepoRoot||"";if(!e||!n)return null;const o=await I(n),s=new Set;o.forEach(c=>s.add(c.Name.replace(/\.ban$/i,"")));const a=await R(e);if(!a||!a.length)return null;const i=await q(e,n),r={};return(i||[]).forEach(c=>{r[c.Name]=c}),a.map(c=>{const d=r[c.Name]||{},f=d.Missing||[],u=d.Extra||[],p=new Set(f.map(g=>g.replace(/\.ban$/i,""))),m=new Set(u.map(g=>g.replace(/\.ban$/i,""))),_=[];return s.forEach(g=>{!p.has(g)&&!m.has(g)&&_.push(g)}),{name:c.Name,exists:c.Exists,hasYSM:d.HasYSM,status:d.Status||"missing",synced:_.length,missing:f.length,extra:u.length,items:{synced:_.slice(0,20).map(g=>{const x=L(g,d.Files);return{name:g,size:"",linkType:x}}),missing:f.slice(0,20).map(g=>{const x=L(g,d.Files);return{name:g,size:"",linkType:x}}),extra:u.slice(0,20).map(g=>{const x=L(g,d.Files);return{name:g,size:"",linkType:x}})}}})}finally{bus.emit("loading:end")}}function L(t,e){if(!e||!e.length)return"";const n=e.find(o=>o.Name===t);return n?n.LinkType==="symlink"||n.LinkType==="hardlink"?"\u{1F517}":"\u{1F4CB}":""}function P(){return[{name:"\u6211\u7684\u6574\u5408\u5305",synced:3,missing:1,extra:2,items:{synced:[{name:"steve_skin.ysm",size:"1.2 MB"},{name:"alex_deluxe.ysm",size:"2.4 MB"},{name:"neon_sword.ysm",size:"1.5 MB"}],missing:[{name:"dragon_armor.zip",size:"3.8 MB"}],extra:[{name:"custom_hat.ysm",size:"0.8 MB"},{name:"old_hat.ysm",size:"0.3 MB"}]}},{name:"\u5149\u5F71\u6D4B\u8BD5\u5305",synced:1,missing:2,extra:0,items:{synced:[],missing:[],extra:[]}},{name:"\u7A7A\u5C9B\u751F\u5B58",synced:5,missing:0,extra:0,items:{synced:[],missing:[],extra:[]}},{name:"RPG \u5192\u9669",synced:2,missing:3,extra:0,items:{synced:[],missing:[],extra:[]}}]}class oe extends HTMLElement{constructor(){super(),this._root=this.attachShadow({mode:"open"}),this._root.adoptedStyleSheets=[new CSSStyleSheet],this._root.adoptedStyleSheets[0].replaceSync(Ut),this._instances=[],this._unsubs=[],this._search=""}async connectedCallback(){this._renderLayout(),this._unsubs.push(bus.on("dir:select-mc",async()=>{try{const e=await H();if(!e)return;const n=await v();await $(n.repoRoot||"",e,n.linkMode||"copy")}catch{}await this._reload()})),this._unsubs.push(bus.on("stats:refresh",async()=>{await this._reload()})),await this._reload()}_renderCards(){const e=this._root.getElementById("vg");if(!e)return;const n=this._search,o=n?this._instances.filter(s=>s.name.toLowerCase().includes(n)):this._instances;Qt(e,o),te(this._root)}async _reload(){try{const n=await se();n?this._instances=n:this._instances=P()}catch{this._instances=P()}const e=this._root.getElementById("ver-stat");e&&(e.textContent=`${this._instances.length}\u4E2A\u6574\u5408\u5305`),this._renderCards(),ee(this._root,this),ne(this._root)}disconnectedCallback(){this._unsubs.forEach(e=>e())}_renderLayout(){this._root.innerHTML=Wt()+Xt()+Kt()}}customElements.define("app-sidebar",oe);const ae="modulepreload",ie=function(t){return"/"+t},F={},b=function(e,n,o){if(!n||n.length===0)return e();const s=document.getElementsByTagName("link");return Promise.all(n.map(a=>{if(a=ie(a),a in F)return;F[a]=!0;const i=a.endsWith(".css"),r=i?'[rel="stylesheet"]':"";if(!!o)for(let d=s.length-1;d>=0;d--){const f=s[d];if(f.href===a&&(!i||f.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${a}"]${r}`))return;const c=document.createElement("link");if(c.rel=i?"stylesheet":ae,i||(c.as="script",c.crossOrigin=""),c.href=a,document.head.appendChild(c),i)return new Promise((d,f)=>{c.addEventListener("load",d),c.addEventListener("error",()=>f(new Error(`Unable to preload CSS for ${a}`)))})})).then(()=>e())},re=`
:host {
  display: flex; flex-direction: column;
  background: #11111b;
  border-left: 1px solid rgba(255,255,255,.06);
  width: 200px;
  flex-shrink: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 12px;
}
.tabs { display: flex; border-bottom: 1px solid rgba(255,255,255,.08); padding: 0; }
.tabs .tab {
  flex: 1; text-align: center; padding: 6px 0; cursor: pointer;
  font-size: 11px; color: #6c7086; transition: all .12s;
  border-bottom: 2px solid transparent;
}
.tabs .tab.active { color: #7c83ff; border-bottom-color: #7c83ff; }
.tabs .tab:hover { color: #cdd6f4; }
.content { padding: 12px; overflow-y: auto; flex: 1; }
h3 { font-size: 11px; font-weight: 600; color: #a6adc8; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 10px; }
.stat-row { font-size: 12px; color: #cdd6f4; padding: 3px 0; display: flex; justify-content: space-between; }
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
/* \u65E5\u5FD7\u6761\u76EE */
.log-entry {
  padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,.04);
  font-size: 10px; color: #cdd6f4; display: flex; gap: 4px;
}
.log-entry .log-status { flex-shrink: 0; width: 48px; text-align: center; font-size: 9px; padding: 1px 0; border-radius: 2px; }
.log-status.success { color: #a6e3a1; background: #a6e3a122; }
.log-status.failed { color: #f38ba8; background: #f38ba822; }
.log-status.skipped { color: #f9a826; background: #f9a82622; }
.log-entry .log-msg { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.log-entry .log-time { font-size: 8px; color: #6c7086; flex-shrink: 0; }
/* \u6A21\u578B\u8BE6\u60C5 */
.md-row { font-size: 12px; color: #cdd6f4; padding: 3px 0; display: flex; justify-content: space-between; }
.md-label { color: #6c7086; }
.md-value { color: #fff; font-weight: 500; }
.md-divider { border: none; border-top: 1px solid rgba(255,255,255,.06); margin: 8px 0; }
.err { font-size: 10px; color: #f38ba8; padding: 4px 0; }
`;function ce(){return`<div class="tabs">
<span class="tab active" data-tab="stat">\u{1F4CA} \u7EDF\u8BA1</span>
<span class="tab" data-tab="log">\u{1F4CB} \u65E5\u5FD7</span>
</div>
<div class="content" id="tab-stat">
<h3>\u{1F4CA} \u6A21\u578B\u7EDF\u8BA1</h3>
<div class="stat-row"><span class="label">\u{1F4E6} \u4ED3\u5E93\u6A21\u578B</span><span class="value" id="sv-repo">-</span></div>
<div class="stat-row"><span class="label">\u{1F4C2} \u6574\u5408\u5305</span><span class="value" id="sv-ver">-</span></div>
<div class="stat-row"><span class="label accent">\u2705 \u5B8C\u5168\u540C\u6B65</span><span class="value accent" id="sv-ok">-</span></div>
<hr class="divider">
<div class="stat-row"><span class="label">\u2B07\uFE0F \u5F85\u4E0B\u8F7D</span><span class="value" id="sv-miss">-</span></div>
<div class="stat-row"><span class="label">\u{1F4E4} \u5F85\u4E0A\u4F20</span><span class="value" id="sv-extra">-</span></div>
<hr class="divider">
<div class="btn-group">
<button class="btn accent" id="btn-install-missing">\u{1F4E5} \u4E0B\u8F7D\u7F3A\u5931</button>
<button class="btn warn" id="btn-upload-extra">\u{1F4E4} \u4E0A\u4F20\u5F85\u4E0A\u4F20</button>
<button class="btn" id="btn-refresh-stat">\u{1F504} \u5237\u65B0</button>
</div>
</div>
<div class="content" id="tab-log" style="display:none">
<h3>\u{1F4CB} \u64CD\u4F5C\u65E5\u5FD7</h3>
<div id="log-list"><div class="stat-row"><span class="label">\u6682\u65E0\u65E5\u5FD7</span></div></div>
<div class="btn-group" style="margin-top:8px">
<button class="btn" id="btn-clear-logs">\u{1F5D1}\uFE0F \u6E05\u7A7A\u65E5\u5FD7</button>
</div>
</div>`}function E(t){return!t||t.hasError?`<div class="content" id="preview-content">
<h3>\u{1F4C4} \u6A21\u578B\u4FE1\u606F</h3>
<div class="err">\u26A0\uFE0F ${t?t.errorMsg:"\u672A\u77E5\u9519\u8BEF"}</div>
</div>`:`<div class="content" id="preview-content">
<h3>\u{1F4C4} \u6A21\u578B\u4FE1\u606F</h3>
<div class="md-row"><span class="md-label">\u540D\u79F0</span><span class="md-value">${M(t.name||"-")}</span></div>
<div class="md-row"><span class="md-label">\u4F5C\u8005</span><span class="md-value">${M(t.author||"-")}</span></div>
<div class="md-row"><span class="md-label">\u7248\u672C</span><span class="md-value">${M(t.version||"-")}</span></div>
<div class="md-divider"></div>
<div class="md-row"><span class="md-label">\u{1F9B4} \u9AA8\u9ABC</span><span class="md-value">${t.bones||0}</span></div>
<div class="md-row"><span class="md-label">\u{1F5BC}\uFE0F \u8D34\u56FE</span><span class="md-value">${t.textures||0}</span></div>
<div class="md-row"><span class="md-label">\u{1F3AC} \u52A8\u753B</span><span class="md-value">${t.animations||0}</span></div>
<div class="md-row"><span class="md-label">\u{1F53A} \u9876\u70B9</span><span class="md-value">${(t.vertices||0).toLocaleString()}</span></div>
<div class="md-row"><span class="md-label">\u25FB\uFE0F \u9762</span><span class="md-value">${(t.faces||0).toLocaleString()}</span></div>
</div>`}function M(t){return(t||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}const le={repo:6,ver:4,ok:2,tot:4,pending:2};function O(t,e){const n=o=>t.getElementById(o);n("s-repo")&&(n("s-repo").textContent=e.repo),n("s-ver")&&(n("s-ver").textContent=e.ver),n("s-ok")&&(n("s-ok").textContent=e.ok),n("s-tot")&&(n("s-tot").textContent=e.tot),n("s-pending")&&(n("s-pending").textContent=e.pending)}function de(t){var n,o,s,a;(n=t.getElementById("btn-install-missing"))==null||n.addEventListener("click",()=>{bus.emit("stats:install-missing")}),(o=t.getElementById("btn-upload-extra"))==null||o.addEventListener("click",()=>{bus.emit("stats:upload-extra")}),(s=t.getElementById("btn-refresh-stat"))==null||s.addEventListener("click",()=>{bus.emit("stats:refresh")});const e=t.querySelectorAll(".tab");e.forEach(i=>{i.addEventListener("click",()=>{const r=i.dataset.tab;e.forEach(d=>d.classList.toggle("active",d===i));const l=t.getElementById("tab-stat"),c=t.getElementById("tab-log");l&&(l.style.display=r==="stat"?"":"none"),c&&(c.style.display=r==="log"?"":"none"),r==="log"&&bus.emit("logs:refresh")})}),(a=t.getElementById("btn-clear-logs"))==null||a.addEventListener("click",async()=>{const{ClearImportLogs:i}=await b(()=>Promise.resolve().then(()=>h),void 0);await i(),bus.emit("logs:refresh"),bus.emit("toast:show",{msg:"\u{1F5D1}\uFE0F \u65E5\u5FD7\u5DF2\u6E05\u7A7A",duration:2e3,type:"info"})})}function pe(t,e,n){n.push(bus.on("stats:updated",o=>{o&&Object.assign(e,o),bus.emit("_preview:needs-update")}))}class ue extends HTMLElement{constructor(){super(),this._root=this.attachShadow({mode:"open"}),this._root.adoptedStyleSheets=[new CSSStyleSheet],this._root.adoptedStyleSheets[0].replaceSync(re),this._stats={...le},this._unsubs=[],this._mode="stat"}static get observedAttributes(){return["mode"]}attributeChangedCallback(e,n,o){e==="mode"&&(this._mode=o==="model"?"model":"stat",this._root.isConnected&&this._render())}connectedCallback(){this._mode=this.getAttribute("mode")==="model"?"model":"stat",this._render(),this._mode==="stat"&&(pe(this._root,this._stats,this._unsubs),this._unsubs.push(bus.on("_preview:needs-update",()=>{O(this._root,this._stats)})),this._unsubs.push(bus.on("stats:refresh",()=>{this._loadRealStats()})),this._unsubs.push(bus.on("logs:refresh",()=>{this._loadLogs()})),this._loadRealStats(),this._loadLogs()),this._mode==="model"&&this._unsubs.push(bus.on("model:select",async({path:e})=>{this._showModelDetail(e)}))}disconnectedCallback(){this._unsubs.forEach(e=>e())}_render(){this._mode==="stat"?(this._root.innerHTML=ce(),de(this._root)):this._root.innerHTML=E(null)}async _loadRealStats(){bus.emit("loading:start");try{const{LoadAppConfig:e,GetInstanceStatus:n,ScanModelEntries:o}=await b(()=>Promise.resolve().then(()=>h),void 0),s=await e(),a=s.mcRoot||s.McRoot||"",i=s.repoRoot||s.RepoRoot||"",r=await o(i),l=r?r.length:0;let c=0,d=0,f=0;if(a&&i){const u=await n(a,i);u&&(c=u.length,u.forEach(p=>{p.Status==="complete"?d++:p.Status==="extra"&&f++}))}this._stats={repo:l,ver:c,ok:d,tot:c,pending:f},O(this._root,this._stats)}catch{}finally{bus.emit("loading:end")}}async _showModelDetail(e){this._root.innerHTML='<div class="content" id="preview-content"><h3>\u{1F4C4} \u6A21\u578B\u4FE1\u606F</h3><div class="stat-row"><span class="label">\u52A0\u8F7D\u4E2D...</span></div></div>';try{const{AnalyzeYSMModel:n}=await b(()=>Promise.resolve().then(()=>h),void 0),o=await n(e);this._root.innerHTML=E(o)}catch(n){this._root.innerHTML=E({hasError:!0,errorMsg:String(n)})}}async _loadLogs(){try{const{GetImportLogs:e}=await b(()=>Promise.resolve().then(()=>h),void 0),n=await e(),o=this._root.getElementById("log-list");if(!o)return;if(!n||!n.length){o.innerHTML='<div class="stat-row"><span class="label">\u6682\u65E0\u65E5\u5FD7</span></div>';return}const s=n.slice(-200).reverse().map(a=>{const i=a.Status==="success"?"success":a.Status==="failed"?"failed":"skipped",r=a.Status==="success"?"\u2705":a.Status==="failed"?"\u274C":"\u23ED\uFE0F",l=a.Timestamp?new Date(a.Timestamp).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"",c=a.ModelName+(a.ErrorMsg?": "+a.ErrorMsg:"");return`<div class="log-entry">
<span class="log-status ${i}">${r}</span>
<span class="log-msg">${this._esc(c)}</span>
<span class="log-time">${l}</span>
</div>`}).join("");o.innerHTML=s}catch{}}_esc(e){return(e||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}}customElements.define("app-preview",ue);const fe=`
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
/* \u8BCA\u65AD\u9875\u9762\uFF1A\u5DE6\u680F\u6309\u94AE + \u53F3\u680F\u4FE1\u606F */
.hdr-btn { padding:4px 8px; border-radius:4px; border:1px solid rgba(255,255,255,.08); background:transparent; color:#cdd6f4; cursor:pointer; font-size:11px; font-family:inherit; }
.hdr-btn:hover { background:#2a2a42; }
.hdr-btn.accent { background:#7c83ff33; color:#7c83ff; border-color:#7c83ff55; }
.log-row { padding:3px 16px; display:flex; gap:6px; font-size:11px; align-items:center; border-bottom:1px solid rgba(255,255,255,.03); }
.log-row .log-status { font-size:10px; width:20px; text-align:center; }
.log-row .log-msg { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#cdd6f4; }
.log-row .log-time { font-size:9px; color:#6c7086; flex-shrink:0; }
.conflict-row { padding:3px 16px; display:flex; justify-content:space-between; font-size:11px; color:#cdd6f4; }
.conflict-name { color:#f38ba8; }
.conflict-ver { color:#6c7086; }
.conflict-ins { font-size:10px; color:#a6adc8; }
.diag-wrapper { flex:1; display:flex; overflow:hidden; }
.diag-left { width:120px; flex-shrink:0; display:flex; flex-direction:column; border-right:1px solid rgba(255,255,255,.08); padding:8px; gap:4px; background:rgba(0,0,0,.08); }
.diag-btn { display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:6px; border:none; background:transparent; color:#a6adc8; font-size:12px; cursor:pointer; font-family:inherit; transition:all .12s; width:100%; text-align:left; }
.diag-btn:hover { background:rgba(255,255,255,.06); color:#cdd6f4; }
.diag-btn.active { background:#7c83ff22; color:#7c83ff; }
.diag-btn-icon { font-size:14px; width:20px; text-align:center; flex-shrink:0; }
.diag-btn-action { justify-content:center; padding:6px; font-size:13px; }
.diag-left-spacer { flex:1; }
.diag-right { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.diag-panel { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.diag-panel-header { display:flex; align-items:center; justify-content:space-between; padding:10px 16px; font-size:12px; font-weight:600; color:#cdd6f4; border-bottom:1px solid rgba(255,255,255,.06); flex-shrink:0; }
`;function j(){return`<div style="flex:1;display:flex;flex-direction:column;overflow-y:auto">
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
</div>`}function ge(){return'<div class="repo-layout"><app-tree></app-tree><app-preview mode="model"></app-preview></div>'}function me(){return'<div class="repo-layout"><app-sidebar></app-sidebar><app-preview mode="stat"></app-preview></div>'}function he(){return`<div style="flex:1;overflow-y:auto">
<div class="section-title">\u2699\uFE0F \u8BBE\u7F6E</div>
<div class="settings-group">
<div class="setting-row"><span class="label">\u{1F3AE} \u6E38\u620F\u8DEF\u5F84</span><span class="value">\u672A\u8BBE\u7F6E <span class="ptag" style="margin-left:4px">\u9884\u544A</span></span></div>
<div class="setting-row"><span class="label">\u{1F4C1} \u4ED3\u5E93\u8DEF\u5F84</span><span class="value">\u672A\u8BBE\u7F6E <span class="ptag" style="margin-left:4px">\u9884\u544A</span></span></div>
<div class="setting-row"><span class="label">\u{1F319} \u4E3B\u9898</span><span class="value">\u6697\u8272</span></div>
<div class="setting-row"><span class="label">\u{1F517} \u94FE\u63A5\u6A21\u5F0F</span><span class="value">\u786C\u94FE\u63A5 <span class="ptag" style="margin-left:4px">\u9884\u544A</span></span></div>
</div>
</div>`}function be(t,e){return`<div class="placeholder-box"><div class="big">${t}</div><div>${e}</div><span class="ptag">\u9884\u544A</span></div>`}function xe(){return`<div class="diag-wrapper">
<div class="diag-left">
<button class="diag-btn active" data-diag="log">
<span class="diag-btn-icon">\u{1F4CB}</span>
<span>\u64CD\u4F5C\u65E5\u5FD7</span>
</button>
<button class="diag-btn" data-diag="conflict">
<span class="diag-btn-icon">\u26A1</span>
<span>\u51B2\u7A81\u68C0\u6D4B</span>
</button>
<div class="diag-left-spacer"></div>
<button class="diag-btn diag-btn-action" id="diag-refresh">
<span>\u{1F504}</span>
</button>
<button class="diag-btn diag-btn-action" id="diag-clear">
<span>\u{1F5D1}\uFE0F</span>
</button>
</div>
<div class="diag-right">
<div class="diag-panel" id="diag-log">
<div class="diag-panel-header">
<span>\u{1F4CB} \u64CD\u4F5C\u65E5\u5FD7</span>
<button class="hdr-btn" id="diag-refresh2" style="display:none">\u{1F504}</button>
</div>
<div id="diag-log-list"><div class="stat-row" style="padding:12px;color:#6c7086;font-size:11px">\u6682\u65E0\u65E5\u5FD7</div></div>
</div>
<div class="diag-panel" id="diag-conflict" style="display:none">
<div class="diag-panel-header">
<span>\u26A1 \u51B2\u7A81\u68C0\u6D4B</span>
<button class="hdr-btn accent" id="diag-scan-conflict">\u26A1 \u5F00\u59CB\u626B\u63CF</button>
</div>
<div id="diag-conflict-list"><div class="stat-row" style="padding:12px;color:#6c7086;font-size:11px">\u70B9\u51FB\u300C\u5F00\u59CB\u626B\u63CF\u300D\u68C0\u6D4B\u6574\u5408\u5305\u51B2\u7A81</div></div>
</div>
</div>
</div>`}let T,z,C;class ve extends HTMLElement{constructor(){super(),this._root=this.attachShadow({mode:"open"}),this._root.adoptedStyleSheets=[new CSSStyleSheet],this._root.adoptedStyleSheets[0].replaceSync(fe),this._current="dashboard"}connectedCallback(){this._unsub=bus.on("nav:change",({page:e})=>{this._current=e,bus.emit("nav:changed",{page:e}),this._render()}),bus.on("stats:upload",()=>this._handleUpload()),b(()=>Promise.resolve().then(()=>h),void 0).then(e=>{T=e.LoadAppConfig,z=e.GetInstanceStatus,C=e.SyncCustomToRepo}),this._render()}disconnectedCallback(){this._unsub&&this._unsub()}async _handleUpload(){if(!(!T||!z||!C))try{const e=await T(),n=e.mcRoot||e.McRoot||"",o=e.repoRoot||e.RepoRoot||"";if(!n||!o)return;const s=await z(n,o);if(!s||!s.length)return;let a=0;for(const i of s){if(!i.Extra||i.Extra.length===0)continue;const r=await C(i.CustomDir,o);a+=r}bus.emit("stats:refresh")}catch{}}_render(){let e="";switch(this._current){case"dashboard":e=j();break;case"repository":e=ge();break;case"instances":e=me();break;case"downloads":e=be("\u2B07\uFE0F","\u4E0B\u8F7D\u4E0E\u66F4\u65B0");break;case"diagnostics":e=xe();break;case"settings":e=he();break;default:e=j()}this._root.innerHTML=`<div class="page">${e}</div>`,this._current==="diagnostics"&&this._initDiagnostics()}_initDiagnostics(){var n,o,s;const e=this._root;e.querySelectorAll(".diag-btn[data-diag]").forEach(a=>{a.addEventListener("click",()=>{const i=a.dataset.diag;e.querySelectorAll(".diag-btn[data-diag]").forEach(r=>r.classList.toggle("active",r===a)),e.getElementById("diag-log").style.display=i==="log"?"":"none",e.getElementById("diag-conflict").style.display=i==="conflict"?"":"none",i==="log"&&this._loadDiagnosticsLogs()})}),(n=e.getElementById("diag-refresh"))==null||n.addEventListener("click",()=>this._loadDiagnosticsLogs()),(o=e.getElementById("diag-clear"))==null||o.addEventListener("click",async()=>{const{ClearImportLogs:a}=await b(()=>Promise.resolve().then(()=>h),void 0);await a(),this._loadDiagnosticsLogs(),bus.emit("toast:show",{msg:"\u{1F5D1}\uFE0F \u65E5\u5FD7\u5DF2\u6E05\u7A7A",duration:2e3,type:"info"})}),(s=e.getElementById("diag-scan-conflict"))==null||s.addEventListener("click",()=>this._scanConflicts()),this._loadDiagnosticsLogs()}async _loadDiagnosticsLogs(){const e=this._root.getElementById("diag-log-list");if(!!e)try{const{GetImportLogs:n}=await b(()=>Promise.resolve().then(()=>h),void 0),o=await n();if(!o||!o.length){e.innerHTML='<div class="stat-row" style="padding:12px;color:#6c7086;font-size:11px">\u6682\u65E0\u65E5\u5FD7</div>';return}e.innerHTML=o.slice(-500).reverse().map(s=>{const a=s.Status==="success"?"success":s.Status==="failed"?"failed":"skipped",i=s.Status==="success"?"\u2705":s.Status==="failed"?"\u274C":"\u23ED\uFE0F",r=s.Timestamp?new Date(s.Timestamp).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"",l=s.ModelName+(s.TargetDir?" \u2192 "+s.TargetDir:"")+(s.ErrorMsg?": "+s.ErrorMsg:"");return`<div class="log-row">
<span class="log-status ${a}">${i}</span>
<span class="log-msg">${this._esc(l)}</span>
<span class="log-time">${r}</span>
</div>`}).join("")}catch{e.innerHTML='<div class="stat-row" style="padding:12px;color:#f38ba8;font-size:11px">\u52A0\u8F7D\u65E5\u5FD7\u5931\u8D25</div>'}}async _scanConflicts(){const e=this._root.getElementById("diag-conflict-list");if(!!e){e.innerHTML='<div class="stat-row" style="padding:12px;color:#6c7086;font-size:11px">\u626B\u63CF\u4E2D...</div>';try{const{LoadAppConfig:n,ListVersionInstances:o,ScanModelEntries:s}=await b(()=>Promise.resolve().then(()=>h),void 0),a=await n(),i=a.mcRoot||a.McRoot||"";if(!i){e.innerHTML='<div class="stat-row" style="padding:12px;color:#f38ba8;font-size:11px">\u8BF7\u5148\u8BBE\u7F6E\u6E38\u620F\u8DEF\u5F84</div>';return}const r=await o(i);if(!r||!r.length){e.innerHTML='<div class="stat-row" style="padding:12px;color:#6c7086;font-size:11px">\u6CA1\u6709\u627E\u5230\u6574\u5408\u5305</div>';return}const l={};for(const u of r){if(!u.Exists)continue;const p=await s(u.CustomDir);l[u.Name]=(p||[]).map(m=>({name:m.Name.replace(/\.ban$/i,"")}))}const c={};for(const[u,p]of Object.entries(l))for(const m of p)c[m.name]||(c[m.name]=[]),c[m.name].push(u);const d=Object.entries(c).filter(([,u])=>u.length>1).sort((u,p)=>p[1].length-u[1].length);if(!d.length){e.innerHTML='<div class="stat-row" style="padding:12px;color:#a6e3a1;font-size:11px">\u2705 \u672A\u68C0\u6D4B\u5230\u6587\u4EF6\u540D\u51B2\u7A81</div>';return}let f=`<div class="stat-row" style="padding:8px 12px;color:#f38ba8;font-size:11px">\u26A0\uFE0F \u53D1\u73B0 ${d.length} \u4E2A\u6587\u4EF6\u5B58\u5728\u4E8E\u591A\u4E2A\u6574\u5408\u5305</div>`;d.slice(0,50).forEach(([u,p])=>{f+=`<div class="conflict-row">
<span class="conflict-name">${this._esc(u)}</span>
<span class="conflict-ver">${p.length} \u4E2A\u6574\u5408\u5305</span>
</div>`,p.forEach(m=>{f+=`<div class="conflict-ins">&nbsp;&nbsp;\u{1F4E6} ${this._esc(m)}</div>`})}),d.length>50&&(f+=`<div class="stat-row" style="padding:8px 12px;color:#6c7086;font-size:10px">...\u8FD8\u6709 ${d.length-50} \u4E2A</div>`),e.innerHTML=f}catch(n){e.innerHTML=`<div class="stat-row" style="padding:12px;color:#f38ba8;font-size:11px">\u626B\u63CF\u5931\u8D25: ${this._esc(String(n))}</div>`}}}_esc(e){return(e||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}}customElements.define("app-content",ve);bus.on("ctx:show",({x:t,y:e,type:n,instanceName:o,path:s,banned:a,dir:i})=>{if(n==="instance"){bus.emit("menu:show",{x:t,y:e,items:[{label:o,icon:"\u{1F4E6}",onClick:()=>bus.emit("instance:select",{name:o})},{divider:!0},{label:"\u5B89\u88C5\u6A21\u578B",icon:"\u{1F4E5}",onClick:()=>bus.emit("instance:install",{name:o})},{label:"\u540C\u6B65\u72B6\u6001",icon:"\u{1F504}",onClick:()=>bus.emit("instance:sync",{name:o})},{label:"\u6E05\u7A7A\u76EE\u5F55",icon:"\u{1F5D1}\uFE0F",danger:!0,onClick:()=>bus.emit("instance:clear",{name:o})}]});return}if(n==="file"){bus.emit("menu:show",{x:t,y:e,items:[{label:a?"\u542F\u7528":"\u7981\u7528",icon:a?"\u2705":"\u26D4",onClick:()=>bus.emit("entry:toggle",{path:s})},{label:"\u6A21\u578B\u8BE6\u60C5",icon:"\u{1F4C4}",onClick:()=>bus.emit("model:select",{path:s})}]});return}if(n==="dir"){bus.emit("menu:show",{x:t,y:e,items:[{label:"\u5168\u90E8\u542F\u7528",icon:"\u2705",onClick:()=>bus.emit("batch:enable",{dir:i})},{label:"\u5168\u90E8\u7981\u7528",icon:"\u26D4",onClick:()=>bus.emit("batch:disable",{dir:i})}]});return}});
