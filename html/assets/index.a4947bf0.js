(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))o(s);new MutationObserver(s=>{for(const a of s)if(a.type==="childList")for(const i of a.addedNodes)i.tagName==="LINK"&&i.rel==="modulepreload"&&o(i)}).observe(document,{childList:!0,subtree:!0});function n(s){const a={};return s.integrity&&(a.integrity=s.integrity),s.referrerpolicy&&(a.referrerPolicy=s.referrerpolicy),s.crossorigin==="use-credentials"?a.credentials="include":s.crossorigin==="anonymous"?a.credentials="omit":a.credentials="same-origin",a}function o(s){if(s.ep)return;s.ep=!0;const a=n(s);fetch(s.href,a)}})();const tt=`
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
`;function et(){return`<div class="hdr">
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
</div>`}function nt(){return`<div class="ftr">
<span class="stat" id="ftr-stat">\u5171 0 \u9879</span>
<button class="hdr-btn" id="btn-repo">\u{1F4C1} \u9009\u62E9\u4ED3\u5E93\u76EE\u5F55</button>
<button class="hdr-btn" id="btn-dedup">\u{1F517} \u53BB\u91CD <span class="tag">\u9884\u544A</span></button>
<button class="hdr-btn" id="btn-trash">\u{1F5D1}\uFE0F \u56DE\u6536\u7AD9</button>
<div style="flex:1"></div>
<button class="hdr-btn" id="btn-pv">\u25C0 \u9884\u89C8</button>
</div>`}function O(t,e){return`<div class="empty"><div class="big">${t}</div>${e}</div>`}function k(t){return(t||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function ot(t,e){const n=k(t);if(!e)return n;const o=e.toLowerCase(),s=t.toLowerCase().indexOf(o);if(s===-1)return n;const a=k(t.substring(0,s)),i=k(t.substring(s,s+e.length)),r=k(t.substring(s+e.length));return a+"<mark>"+i+"</mark>"+r}function at(t){return!t&&t!==0?"":t<1024?t+" B":t<1048576?(t/1024).toFixed(1)+" KB":(t/1048576).toFixed(1)+" MB"}function it(t){if(!t)return"";const e=new Date(t),n=new Date;return e.toDateString()===n.toDateString()?e.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):(n-e)/864e5<7?["\u65E5","\u4E00","\u4E8C","\u4E09","\u56DB","\u4E94","\u516D"][e.getDay()]+" "+e.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):e.toLocaleDateString([],{month:"short",day:"numeric"})}function rt(t){const e=(t.split(".").pop()||"").toLowerCase();return e==="ysm"?"\u{1F48E}":["zip","rar","7z","tar","gz"].includes(e)?"\u{1F4E6}":["png","jpg","jpeg","gif","webp","bmp"].includes(e)?"\u{1F5BC}\uFE0F":["txt","md","json","xml","yml","yaml","cfg","conf","ini"].includes(e)?"\u{1F4C4}":"\u{1F9CA}"}function ct(t,e,n,o){const s=S(t.path),a=S(t.fullPath||t.path),i=t.banned?"":" on",r=t.banned?"":"\u2713";return`<div class="fl${t.banned?" ban":""}" data-path="${s}" data-fullpath="${a}">
<span class="ck${i}" data-path="${s}" data-fullpath="${a}">${r}</span>
<span class="ficon">${n}</span>
<span class="nm">${e}</span>
<span class="sz">${dt(t.size)}</span>${o?`<span class="dt">${o}</span>`:""}</div>`}function lt(t,e,n,o){const s=o?"\u{1F512}":"\u{1F4C1}",a=o?"#585b70":"#a6adc8",i=o?" locked":"",r=n?"\u25BC":"\u25B6",c=n?" open":"";return`<div class="fh${i}" data-dir="${S(e)}">
<span class="ar${c}">${r}</span>
<span class="nm" style="color:${a}">${s} ${S(t)}</span></div>
<div class="ch" style="display:${n?"block":"none"}">`}function S(t){return(t||"").replace(/"/g,"&quot;").replace(/</g,"&lt;")}function dt(t){return!t&&t!==0?"":t<1024?t+" B":t<1048576?(t/1024).toFixed(1)+" KB":(t/1048576).toFixed(1)+" MB"}function pt(t,e,n){const o={},s=(n||"").trim().toLowerCase();return[...t].sort((i,r)=>{if(e==="name")return i.name.localeCompare(r.name);if(e==="size"){const c=i.size||0;return(r.size||0)-c}if(e==="date"){const c=i.modTime||0;return(r.modTime||0)-c}return 0}).forEach(i=>{if(!i||!i.path)return;const r=i.path;if(s&&!r.toLowerCase().includes(s))return;const c=r.replace(/\\/g,"/").split("/");let l=o;for(let d=0;d<c.length-1;d++)!c[d]||(l[c[d]]||(l[c[d]]={}),l=l[c[d]]);const p=c[c.length-1];p&&(l[p]={_e:i})}),o}function U(t,e,n,o,s){const a=!!(n||"").trim(),i=Object.keys(t).sort((c,l)=>{const p=!t[c]._e,d=!t[l]._e;if(p&&!d)return-1;if(!p&&d)return 1;const u=t[c]._e,f=t[l]._e;return o==="size"?((f==null?void 0:f.size)||0)-((u==null?void 0:u.size)||0):o==="date"?((f==null?void 0:f.modTime)||0)-((u==null?void 0:u.modTime)||0):c.localeCompare(l)});let r="";return i.forEach(c=>{const l=t[c],p=e?e+"/"+c:c;if(l._e){const d=l._e;if(a&&!d.name.toLowerCase().includes(n.toLowerCase()))return;const u=a?ot(d.name,n):d.name,f=d.modTime?it(d.modTime):"";r+=ct(d,u,rt(d.name),f)}else{const d=c.startsWith("_"),u=a||!!s[p];r+=lt(c,p,u,d),r+=U(l,p,n,o,s),r+="</div>"}}),r}function ut(t,e,n,o,s){if(!e.length){t.innerHTML=O("\u{1F4C1}","\u6682\u65E0\u6A21\u578B\u6587\u4EF6");return}const a=pt(e,o,n),i=U(a,"",n,o,s);if(!i){t.innerHTML=O("\u{1F50D}","\u672A\u627E\u5230\u5339\u914D\u7684\u6587\u4EF6");return}t.innerHTML=i}function ft(t,e){if(!t)return;let n=0,o=0,s=0;e.forEach(a=>{n++,a.banned||o++,s+=a.size||0}),t.textContent=`\u5171 ${n} \u9879 (\u5DF2\u542F\u7528 ${o}) \xB7 ${at(s)}`}function N(t){!t||(t.classList.add("flash"),setTimeout(()=>t.classList.remove("flash"),400))}function B(t,e,n,o,s,a){return window.go.main.App.AddImportLog(t,e,n,o,s,a)}function W(t){return window.go.main.App.AnalyzeYSMModel(t)}function gt(t){return window.go.main.App.CheckFileExists(t)}function mt(t){return window.go.main.App.ClearCustomDir(t)}function ht(){return window.go.main.App.ClearImportLogs()}function bt(t){return window.go.main.App.CountLinkedModels(t)}function xt(t){return window.go.main.App.CreateDir(t)}function vt(t){return window.go.main.App.DeduplicateCustomDir(t)}function yt(t){return window.go.main.App.DeleteFromRecycle(t)}function wt(t){return window.go.main.App.EmptyRecycleBin(t)}function _t(t){return window.go.main.App.GetGlobalCustomDir(t)}function kt(){return window.go.main.App.GetImportLogs()}function J(t,e){return window.go.main.App.GetInstanceStatus(t,e)}function St(){return window.go.main.App.GetLinkMode()}function Lt(){return window.go.main.App.GetMinecraftPath()}function Et(){return window.go.main.App.GetWindowPosition()}function Tt(t){return window.go.main.App.HasYSMMod(t)}function Mt(t,e){return window.go.main.App.ImportModelFile(t,e)}function zt(t,e){return window.go.main.App.InstallModelFile(t,e)}function Ct(t,e){return window.go.main.App.InstallModelTo(t,e)}function Rt(t,e){return window.go.main.App.InstallModelWithOverlay(t,e)}function K(t){return window.go.main.App.IsFileBanned(t)}function At(t){return window.go.main.App.IsSymlink(t)}function It(t){return window.go.main.App.ListFileNames(t)}function $t(t){return window.go.main.App.ListRecycleBin(t)}function D(t){return window.go.main.App.ListVersionInstances(t)}function w(){return window.go.main.App.LoadAppConfig()}function Bt(t,e){return window.go.main.App.MoveModelFile(t,e)}function Dt(t){return window.go.main.App.MoveToRecycle(t)}function Ht(t){return window.go.main.App.MoveToRecycleEx(t)}function Pt(t){return window.go.main.App.OpenFolder(t)}function Ft(t,e){return window.go.main.App.RestoreFromRecycle(t,e)}function H(t,e,n){return window.go.main.App.SaveAppConfig(t,e,n)}function Ot(t,e,n,o){return window.go.main.App.SaveWindowPosition(t,e,n,o)}function Nt(t){return window.go.main.App.ScanCustomModels(t)}function P(t){return window.go.main.App.ScanModelEntries(t)}function F(){return window.go.main.App.SelectDirectory()}function jt(t){return window.go.main.App.SetLinkMode(t)}function Gt(t){return window.go.main.App.SetRepoRoot(t)}function qt(t,e){return window.go.main.App.SyncCustomToRepo(t,e)}function Vt(t,e){return window.go.main.App.SyncModelToggleStatus(t,e)}function _(t){return window.go.main.App.ToggleModelEnable(t)}const b=Object.freeze(Object.defineProperty({__proto__:null,AddImportLog:B,AnalyzeYSMModel:W,CheckFileExists:gt,ClearCustomDir:mt,ClearImportLogs:ht,CountLinkedModels:bt,CreateDir:xt,DeduplicateCustomDir:vt,DeleteFromRecycle:yt,EmptyRecycleBin:wt,GetGlobalCustomDir:_t,GetImportLogs:kt,GetInstanceStatus:J,GetLinkMode:St,GetMinecraftPath:Lt,GetWindowPosition:Et,HasYSMMod:Tt,ImportModelFile:Mt,InstallModelFile:zt,InstallModelTo:Ct,InstallModelWithOverlay:Rt,IsFileBanned:K,IsSymlink:At,ListFileNames:It,ListRecycleBin:$t,ListVersionInstances:D,LoadAppConfig:w,MoveModelFile:Bt,MoveToRecycle:Dt,MoveToRecycleEx:Ht,OpenFolder:Pt,RestoreFromRecycle:Ft,SaveAppConfig:H,SaveWindowPosition:Ot,ScanCustomModels:Nt,ScanModelEntries:P,SelectDirectory:F,SetLinkMode:jt,SetRepoRoot:Gt,SyncCustomToRepo:qt,SyncModelToggleStatus:Vt,ToggleModelEnable:_},Symbol.toStringTag,{value:"Module"}));function Yt(t,e){t.querySelectorAll(".fh").forEach(n=>{n.onclick=o=>{o.stopPropagation();const s=n.nextElementSibling,a=n.querySelector(".ar");if(!s)return;const i=s.style.display!=="none";s.style.display=i?"none":"block",a.classList.toggle("open",!i),e._dirOpen[n.dataset.dir]=!i,localStorage.setItem("at_dirs",JSON.stringify(e._dirOpen))}}),t.querySelectorAll(".ck").forEach(n=>{n.onclick=async o=>{o.stopPropagation(),n.classList.contains("on"),n.classList.toggle("on"),n.textContent=n.classList.contains("on")?"\u2713":"";const s=n.closest(".fl");s&&s.classList.add("flash"),setTimeout(()=>s==null?void 0:s.classList.remove("flash"),400);const a=n.dataset.fullpath||n.dataset.path;try{await _(a),await e._load(),e._renderTree(),bus.emit("stats:refresh")}catch{n.classList.toggle("on"),n.textContent=n.classList.contains("on")?"\u2713":""}}}),t.querySelectorAll(".fh").forEach(n=>{n.oncontextmenu=o=>{o.preventDefault(),o.stopPropagation(),bus.emit("ctx:show",{x:o.clientX,y:o.clientY,type:"dir",dir:n.dataset.dir})}}),t.querySelectorAll(".fl").forEach(n=>{n.oncontextmenu=o=>{var c,l;o.preventDefault(),o.stopPropagation();const s=!((c=n.querySelector(".ck"))!=null&&c.classList.contains("on")),a=n.dataset.fullpath||n.dataset.path,i=n.querySelector(".nm"),r=((l=i==null?void 0:i.textContent)==null?void 0:l.replace(/^\S+\s/,""))||"";bus.emit("ctx:show",{x:o.clientX,y:o.clientY,type:"file",path:a,banned:s,name:r})}})}function Ut(t,e){var s,a,i,r,c,l,p,d,u;const n=f=>t.getElementById(f),o=()=>e._renderTree();(s=n("srch"))==null||s.addEventListener("input",f=>{e._search=f.target.value,o()}),(a=n("sort"))==null||a.addEventListener("change",f=>{e._sort=f.target.value,o()}),(i=n("btn-repo"))==null||i.addEventListener("click",()=>bus.emit("dir:select-repo")),(r=n("btn-dedup"))==null||r.addEventListener("click",()=>bus.emit("entries:dedup")),(c=n("btn-trash"))==null||c.addEventListener("click",()=>bus.emit("recycle:open")),(l=n("btn-pv"))==null||l.addEventListener("click",()=>bus.emit("preview:toggle")),(p=n("btn-ea"))==null||p.addEventListener("click",()=>{N(n("btn-ea")),e._entries.forEach(f=>{f.banned=!1}),o()}),(d=n("btn-da"))==null||d.addEventListener("click",()=>{N(n("btn-da")),e._entries.forEach(f=>{f.banned=!0}),o()}),(u=n("btn-st"))==null||u.addEventListener("click",()=>{bus.emit("sync:toggle-status")})}async function X(){const t=await w(),e=t.repoRoot||t.RepoRoot||"";if(!e)return null;const n=await P(e);if(!n||!n.length)return null;const o=[];for(const s of n){let a=!1;try{a=await K(s.Path)}catch{}let i=s.Path;e&&s.Path.startsWith(e)&&(i=s.Path.slice(e.length).replace(/^[/\\]+/,"")),o.push({name:s.Name,path:i,fullPath:s.Path,size:s.Size,modTime:s.ModTime,banned:a})}return{repoRoot:e,entries:o}}function y(){const t=Date.now();return[{name:"steve_skin.ysm",path:"steve_skin.ysm",size:1258291,modTime:t-864e5,banned:!1},{name:"alex_deluxe.ysm",path:"alex/alex_deluxe.ysm",size:2516582,modTime:t-1728e5,banned:!1},{name:"alex_head.ysm",path:"alex/alex_head.ysm",size:524288,modTime:t-1728e5,banned:!1},{name:"dragon_armor.zip",path:"dragon/dragon_armor.zip",size:3984588,modTime:t-36e5,banned:!1},{name:"dragon_wings.ysm",path:"dragon/dragon_wings.ysm",size:2202009,modTime:t-72e5,banned:!1},{name:"neon_sword.ysm",path:"weapons/neon_sword.ysm",size:1572864,modTime:t,banned:!1},{name:"magic_staff.zip",path:"weapons/magic_staff.zip",size:4404019,modTime:t-72e5,banned:!1},{name:"photon_body.ysm",path:"photon/photon_body.ysm",size:2202009,modTime:t-432e5,banned:!1},{name:"old_model.ysm",path:"_disabled/old_model.ysm",size:943718,modTime:t-6048e5,banned:!0},{name:"custom_hat.ysm",path:"custom/custom_hat.ysm",size:838860,modTime:t-2592e5,banned:!1},{name:"steve_2d.ysm",path:"custom/steve_2d.ysm",size:314572,modTime:t-5e5,banned:!1}]}const Wt="modulepreload",Jt=function(t){return"/"+t},j={},x=function(e,n,o){if(!n||n.length===0)return e();const s=document.getElementsByTagName("link");return Promise.all(n.map(a=>{if(a=Jt(a),a in j)return;j[a]=!0;const i=a.endsWith(".css"),r=i?'[rel="stylesheet"]':"";if(!!o)for(let p=s.length-1;p>=0;p--){const d=s[p];if(d.href===a&&(!i||d.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${a}"]${r}`))return;const l=document.createElement("link");if(l.rel=i?"stylesheet":Wt,i||(l.as="script",l.crossOrigin=""),l.href=a,document.head.appendChild(l),i)return new Promise((p,d)=>{l.addEventListener("load",p),l.addEventListener("error",()=>d(new Error(`Unable to preload CSS for ${a}`)))})})).then(()=>e())};function Kt(t){const e=[];return e.push(bus.on("entry:toggle",async({path:n})=>{try{await _(n)}catch{}await E(t),bus.emit("stats:refresh")})),e.push(bus.on("dir:select-repo",async()=>{try{const n=await F();if(!n)return;await H(n,"","copy"),t._repoRoot=n,await E(t),bus.emit("stats:refresh")}catch{t._entries=y(),t._renderTree()}})),e.push(bus.on("entries:dedup",()=>{bus.emit("toast:show",{msg:"\u{1F517} \u53BB\u91CD\u529F\u80FD\u5F00\u53D1\u4E2D",duration:2e3,type:"info"})})),e.push(bus.on("recycle:open",()=>{bus.emit("toast:show",{msg:"\u{1F5D1}\uFE0F \u56DE\u6536\u7AD9\u529F\u80FD\u5F00\u53D1\u4E2D",duration:2e3,type:"info"})})),e.push(bus.on("batch:enable",({dir:n})=>{G(t,n,!0)})),e.push(bus.on("batch:disable",({dir:n})=>{G(t,n,!1)})),e.push(bus.on("sync:toggle-status",async()=>{try{const n=await w(),o=n.repoRoot||n.RepoRoot||"",s=n.mcRoot||n.McRoot||"";if(!o||!s){bus.emit("toast:show",{msg:"\u8BF7\u5148\u914D\u7F6E\u6E38\u620F\u76EE\u5F55\u548C\u4ED3\u5E93\u76EE\u5F55",duration:3e3,type:"warn"});return}const a=await D(s);if(!a||!a.length){bus.emit("toast:show",{msg:"\u6CA1\u6709\u627E\u5230\u6574\u5408\u5305",duration:2e3,type:"info"});return}let i=0,r=0;const c=[];for(const l of a)if(!!l.Exists)try{const{SyncModelToggleStatus:p}=await x(()=>Promise.resolve().then(()=>b),void 0),d=await p(l.CustomDir,o),u=d&&(d.r0||d[0])||0,f=d&&(d.r1||d[1])||0;(u>0||f>0)&&(i+=u,r+=f)}catch(p){c.push(`${l.Name}: ${String(p)}`)}await B("sync-status","\u540C\u6B65\u72B6\u6001 ("+a.filter(l=>l.Exists).length+" \u4E2A\u6574\u5408\u5305)",o,0,c.length?"failed":"success","\u7981\u7528 "+i+" \u542F\u7528 "+r+(c.length?" | \u9519\u8BEF: "+c.join("; "):"")),bus.emit("toast:show",{msg:`\u2705 \u540C\u6B65\u5B8C\u6210\uFF1A\u7981\u7528 ${i} \u9879\uFF0C\u542F\u7528 ${r} \u9879`,duration:3e3,type:"success"}),await E(t),bus.emit("stats:refresh"),bus.emit("logs:refresh")}catch(n){await B("sync-status","\u540C\u6B65\u5931\u8D25",repoRoot||"",0,"failed",String(n)),bus.emit("toast:show",{msg:`\u540C\u6B65\u5931\u8D25: ${String(n)}`,duration:8e3,type:"error"}),bus.emit("logs:refresh")}})),e}async function E(t){try{const e=await X();e?(t._repoRoot=e.repoRoot,t._entries=e.entries):t._entries=y()}catch{t._entries=y()}t._renderTree()}async function G(t,e,n){const o=e.replace(/\\/g,"/"),s=t._entries.filter(r=>r.path&&r.path.startsWith(o));if(!s.length)return;let a=0,i=0;for(const r of s)if(r.banned!==!n)try{await _(r.fullPath),r.banned=!n,a++}catch{i++}a>0&&(t._renderTree(),bus.emit("stats:refresh")),bus.emit("toast:show",{msg:`\u6279\u91CF${n?"\u542F\u7528":"\u7981\u7528"}: ${a} \u6210\u529F, ${i} \u5931\u8D25`,duration:3e3,type:i>0?"warn":"success"})}class Xt extends HTMLElement{constructor(){super(),this._root=this.attachShadow({mode:"open"}),this._root.adoptedStyleSheets=[new CSSStyleSheet],this._root.adoptedStyleSheets[0].replaceSync(tt),this._entries=[],this._search="",this._sort="name",this._dirOpen={},this._repoRoot=""}async connectedCallback(){try{Object.assign(this._dirOpen,JSON.parse(localStorage.getItem("at_dirs")||"{}"))}catch{}this._renderLayout(),Ut(this._root,this),this._unsubs=Kt(this),await this._load(),this._renderTree()}disconnectedCallback(){var e;(e=this._unsubs)==null||e.forEach(n=>n==null?void 0:n())}async _load(){try{const e=await X();e?(this._repoRoot=e.repoRoot,this._entries=e.entries):this._entries=y()}catch{this._entries=y()}}_renderLayout(){this._root.innerHTML=et()+'<div class="list" id="tree"><div class="empty"><div class="big">\u{1F4C1}</div>\u6682\u65E0\u6A21\u578B\u6587\u4EF6</div></div>'+nt()}_renderTree(){const e=this._root.getElementById("tree");ut(e,this._entries,this._search,this._sort,this._dirOpen),Yt(e,this),ft(this._root.getElementById("ftr-stat"),this._entries)}}customElements.define("app-tree",Xt);const Qt=`
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
`;function Zt(){return`<div class="header">
<div class="header-row">
<span class="header-label">\u{1F4C2} \u7248\u672C\u5217\u8868</span>
<span class="header-stat" id="ver-stat">4\u4E2A\u6574\u5408\u5305</span>
</div>
<input class="search-input" id="ver-search" type="text" placeholder="\u{1F50D} \u641C\u7D22\u6574\u5408\u5305" autocomplete="off" autocapitalize="off">
</div>`}function te(){return`<div class="footer">
<button class="footer-btn" id="btn-mc">\u{1F3AE} \u6307\u5B9A\u6E38\u620F\u8DEF\u5F84</button>
</div>`}function ee(){return'<div class="list" id="vg"></div>'}function ne(t,e,n,o,s=!1){let a="";o==="complete"?a='<span class="tag green">\u2705</span>':o==="extra"?a='<span class="tag orange">\u{1F4E4}</span>':o==="missing"&&(a='<span class="tag red">\u2B07\uFE0F</span>');const i=[];return e>0&&i.push(`<span class="tag green">\u2705 ${e}</span>`),n>0&&i.push(`<span class="tag red">\u2B07\uFE0F ${n}</span>`),`<div class="vc-header">
<span class="${s?"arrow open":"arrow"}">\u25B6</span>
${a}
<span class="name">\u{1F4E6} ${Q(t)}</span>
${i.join("")}
</div>`}function T(t,e){return`<div class="sec-title">${t} (${e})</div>`}function M(t,e,n,o){const s=o?`<span class="link-icon">${o}</span>`:"";return`<div class="row"><span class="dot" style="background:${t}"></span><span class="rn">${Q(e)}</span>${s}<span class="sz">${n}</span></div>`}function Q(t){return(t||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function se(t,e){t.innerHTML="",e.forEach((n,o)=>{const s=document.createElement("div");s.className="vc",s.dataset.idx=o;const a=o===0;s.innerHTML=ne(n.name,n.synced,n.missing,n.status,a),t.appendChild(s);const i=document.createElement("div");i.className="vc-body",i.style.display=a?"":"none",i.innerHTML=oe(n),t.appendChild(i)})}function oe(t){let e="";return t.items.synced.length&&(e+=T("\u2705 \u5DF2\u540C\u6B65",t.items.synced.length),t.items.synced.forEach(n=>{e+=M("#a6e3a1",n.name,n.size,n.linkType)})),t.items.missing.length&&(e+=T("\u2B07\uFE0F \u7F3A\u5931",t.items.missing.length),t.items.missing.forEach(n=>{e+=M("#f38ba8",n.name,n.size,"")})),t.items.extra.length&&(e+=T("\u{1F4E4} \u989D\u5916",t.items.extra.length),t.items.extra.forEach(n=>{e+=M("#f9a826",n.name,n.size,"")})),e}function ae(t){t.querySelectorAll(".vc-context-menu").forEach(e=>e.remove()),t.querySelectorAll(".vc").forEach(e=>{const n=e.querySelector(".vc-header"),o=e.nextElementSibling;!n||!o||!o.classList.contains("vc-body")||(n.onclick=()=>{const s=n.querySelector(".arrow");o.style.display=o.style.display==="none"?"":"none",s&&s.classList.toggle("open")},n.oncontextmenu=s=>{s.preventDefault(),s.stopPropagation();const a=n.querySelector(".name"),i=a?a.textContent.replace(/^📦\s*/,""):"";bus.emit("ctx:show",{x:s.clientX,y:s.clientY,type:"instance",instanceName:i})})})}function ie(t,e){const n=t.getElementById("ver-search");n&&(n.oninput=o=>{const s=o.target.value.toLowerCase().trim();e._search=s,e._renderCards()})}function re(t){const e=t.getElementById("btn-mc");e&&(e.onclick=()=>bus.emit("dir:select-mc"))}async function ce(){bus.emit("loading:start");try{const t=await w(),e=t.mcRoot||t.McRoot||"",n=t.repoRoot||t.RepoRoot||"";if(!e||!n)return null;const o=await P(n),s=new Set;o.forEach(l=>s.add(l.Name.replace(/\.ban$/i,"")));const a=await D(e);if(!a||!a.length)return null;const i=await J(e,n),r={};return(i||[]).forEach(l=>{r[l.Name]=l}),a.map(l=>{const p=r[l.Name]||{},d=p.Missing||[],u=p.Extra||[],f=new Set(d.map(g=>g.replace(/\.ban$/i,""))),h=new Set(u.map(g=>g.replace(/\.ban$/i,""))),L=[];return s.forEach(g=>{!f.has(g)&&!h.has(g)&&L.push(g)}),{name:l.Name,exists:l.Exists,hasYSM:p.HasYSM,status:p.Status||"missing",synced:L.length,missing:d.length,extra:u.length,items:{synced:L.slice(0,20).map(g=>{const v=z(g,p.Files);return{name:g,size:"",linkType:v}}),missing:d.slice(0,20).map(g=>{const v=z(g,p.Files);return{name:g,size:"",linkType:v}}),extra:u.slice(0,20).map(g=>{const v=z(g,p.Files);return{name:g,size:"",linkType:v}})}}})}finally{bus.emit("loading:end")}}function z(t,e){if(!e||!e.length)return"";const n=e.find(o=>o.Name===t);return n?n.LinkType==="symlink"||n.LinkType==="hardlink"?"\u{1F517}":"\u{1F4CB}":""}function q(){return[{name:"\u6211\u7684\u6574\u5408\u5305",synced:3,missing:1,extra:2,items:{synced:[{name:"steve_skin.ysm",size:"1.2 MB"},{name:"alex_deluxe.ysm",size:"2.4 MB"},{name:"neon_sword.ysm",size:"1.5 MB"}],missing:[{name:"dragon_armor.zip",size:"3.8 MB"}],extra:[{name:"custom_hat.ysm",size:"0.8 MB"},{name:"old_hat.ysm",size:"0.3 MB"}]}},{name:"\u5149\u5F71\u6D4B\u8BD5\u5305",synced:1,missing:2,extra:0,items:{synced:[],missing:[],extra:[]}},{name:"\u7A7A\u5C9B\u751F\u5B58",synced:5,missing:0,extra:0,items:{synced:[],missing:[],extra:[]}},{name:"RPG \u5192\u9669",synced:2,missing:3,extra:0,items:{synced:[],missing:[],extra:[]}}]}class le extends HTMLElement{constructor(){super(),this._root=this.attachShadow({mode:"open"}),this._root.adoptedStyleSheets=[new CSSStyleSheet],this._root.adoptedStyleSheets[0].replaceSync(Qt),this._instances=[],this._unsubs=[],this._search=""}async connectedCallback(){this._renderLayout(),this._unsubs.push(bus.on("dir:select-mc",async()=>{try{const e=await F();if(!e)return;const n=await w();await H(n.repoRoot||"",e,n.linkMode||"copy")}catch{}await this._reload()})),this._unsubs.push(bus.on("stats:refresh",async()=>{await this._reload()})),await this._reload()}_renderCards(){const e=this._root.getElementById("vg");if(!e)return;const n=this._search,o=n?this._instances.filter(s=>s.name.toLowerCase().includes(n)):this._instances;se(e,o),ae(this._root)}async _reload(){try{const n=await ce();n?this._instances=n:this._instances=q()}catch{this._instances=q()}const e=this._root.getElementById("ver-stat");e&&(e.textContent=`${this._instances.length}\u4E2A\u6574\u5408\u5305`),this._renderCards(),ie(this._root,this),re(this._root)}disconnectedCallback(){this._unsubs.forEach(e=>e())}_renderLayout(){this._root.innerHTML=Zt()+ee()+te()}}customElements.define("app-sidebar",le);const de=`
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
`;function pe(){return`<div class="tabs">
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
</div>`}function C(t){return!t||t.hasError?`<div class="content" id="preview-content">
<h3>\u{1F4C4} \u6A21\u578B\u4FE1\u606F</h3>
<div class="err">\u26A0\uFE0F ${t?t.errorMsg:"\u672A\u77E5\u9519\u8BEF"}</div>
</div>`:`<div class="content" id="preview-content">
<h3>\u{1F4C4} \u6A21\u578B\u4FE1\u606F</h3>
<div class="md-row"><span class="md-label">\u540D\u79F0</span><span class="md-value">${R(t.name||"-")}</span></div>
<div class="md-row"><span class="md-label">\u4F5C\u8005</span><span class="md-value">${R(t.author||"-")}</span></div>
<div class="md-row"><span class="md-label">\u7248\u672C</span><span class="md-value">${R(t.version||"-")}</span></div>
<div class="md-divider"></div>
<div class="md-row"><span class="md-label">\u{1F9B4} \u9AA8\u9ABC</span><span class="md-value">${t.bones||0}</span></div>
<div class="md-row"><span class="md-label">\u{1F5BC}\uFE0F \u8D34\u56FE</span><span class="md-value">${t.textures||0}</span></div>
<div class="md-row"><span class="md-label">\u{1F3AC} \u52A8\u753B</span><span class="md-value">${t.animations||0}</span></div>
<div class="md-row"><span class="md-label">\u{1F53A} \u9876\u70B9</span><span class="md-value">${(t.vertices||0).toLocaleString()}</span></div>
<div class="md-row"><span class="md-label">\u25FB\uFE0F \u9762</span><span class="md-value">${(t.faces||0).toLocaleString()}</span></div>
</div>`}function R(t){return(t||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}const ue={repo:0,ver:0,ok:0,tot:0,pending:0};function V(t,e){const n=o=>t.getElementById(o);n("s-repo")&&(n("s-repo").textContent=e.repo),n("s-ver")&&(n("s-ver").textContent=e.ver),n("s-ok")&&(n("s-ok").textContent=e.ok),n("s-tot")&&(n("s-tot").textContent=e.tot),n("s-pending")&&(n("s-pending").textContent=e.pending)}function fe(t){var n,o,s,a;(n=t.getElementById("btn-install-missing"))==null||n.addEventListener("click",()=>{bus.emit("stats:install-missing")}),(o=t.getElementById("btn-upload-extra"))==null||o.addEventListener("click",()=>{bus.emit("stats:upload-extra")}),(s=t.getElementById("btn-refresh-stat"))==null||s.addEventListener("click",()=>{bus.emit("stats:refresh")});const e=t.querySelectorAll(".tab");e.forEach(i=>{i.addEventListener("click",()=>{const r=i.dataset.tab;e.forEach(p=>p.classList.toggle("active",p===i));const c=t.getElementById("tab-stat"),l=t.getElementById("tab-log");c&&(c.style.display=r==="stat"?"":"none"),l&&(l.style.display=r==="log"?"":"none"),r==="log"&&bus.emit("logs:refresh")})}),(a=t.getElementById("btn-clear-logs"))==null||a.addEventListener("click",async()=>{const{ClearImportLogs:i}=await x(()=>Promise.resolve().then(()=>b),void 0);await i(),bus.emit("logs:refresh"),bus.emit("toast:show",{msg:"\u{1F5D1}\uFE0F \u65E5\u5FD7\u5DF2\u6E05\u7A7A",duration:2e3,type:"info"})})}function ge(t,e,n){n.push(bus.on("stats:updated",o=>{o&&Object.assign(e,o),bus.emit("_preview:needs-update")}))}class me extends HTMLElement{constructor(){super(),this._root=this.attachShadow({mode:"open"}),this._root.adoptedStyleSheets=[new CSSStyleSheet],this._root.adoptedStyleSheets[0].replaceSync(de),this._stats={...ue},this._unsubs=[],this._mode="stat"}static get observedAttributes(){return["mode"]}attributeChangedCallback(e,n,o){e==="mode"&&(this._mode=o==="model"?"model":"stat",this._root.isConnected&&this._render())}connectedCallback(){this._mode=this.getAttribute("mode")==="model"?"model":"stat",this._render(),this._mode==="stat"&&(ge(this._root,this._stats,this._unsubs),this._unsubs.push(bus.on("_preview:needs-update",()=>{V(this._root,this._stats)})),this._unsubs.push(bus.on("stats:refresh",()=>{this._loadRealStats()})),this._unsubs.push(bus.on("logs:refresh",()=>{this._loadLogs()})),this._loadRealStats(),this._loadLogs()),this._mode==="model"&&this._unsubs.push(bus.on("model:select",async({path:e})=>{this._showModelDetail(e)}))}disconnectedCallback(){this._unsubs.forEach(e=>e())}_render(){this._mode==="stat"?(this._root.innerHTML=pe(),fe(this._root)):this._root.innerHTML=C(null)}async _loadRealStats(){bus.emit("loading:start");try{const{LoadAppConfig:e,GetInstanceStatus:n,ScanModelEntries:o}=await x(()=>Promise.resolve().then(()=>b),void 0),s=await e(),a=s.mcRoot||s.McRoot||"",i=s.repoRoot||s.RepoRoot||"",r=await o(i),c=r?r.length:0;let l=0,p=0,d=0;if(a&&i){const u=await n(a,i);u&&(l=u.length,u.forEach(f=>{f.Status==="complete"?p++:f.Status==="extra"&&d++}))}this._stats={repo:c,ver:l,ok:p,tot:l,pending:d},V(this._root,this._stats)}catch{}finally{bus.emit("loading:end")}}async _showModelDetail(e){this._root.innerHTML='<div class="content" id="preview-content"><h3>\u{1F4C4} \u6A21\u578B\u4FE1\u606F</h3><div class="stat-row"><span class="label">\u52A0\u8F7D\u4E2D...</span></div></div>';try{const{AnalyzeYSMModel:n}=await x(()=>Promise.resolve().then(()=>b),void 0),o=await n(e);this._root.innerHTML=C(o)}catch(n){this._root.innerHTML=C({hasError:!0,errorMsg:String(n)})}}async _loadLogs(){try{const{GetImportLogs:e}=await x(()=>Promise.resolve().then(()=>b),void 0),n=await e(),o=this._root.getElementById("log-list");if(!o)return;if(!n||!n.length){o.innerHTML='<div class="stat-row"><span class="label">\u6682\u65E0\u65E5\u5FD7</span></div>';return}const s=n.slice(-200).reverse().map(a=>{const i=a.Status==="success"?"success":a.Status==="failed"?"failed":"skipped",r=a.Status==="success"?"\u2705":a.Status==="failed"?"\u274C":"\u23ED\uFE0F",c=a.Timestamp?new Date(a.Timestamp).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"",l=a.ModelName+(a.ErrorMsg?": "+a.ErrorMsg:"");return`<div class="log-entry">
<span class="log-status ${i}">${r}</span>
<span class="log-msg">${this._esc(l)}</span>
<span class="log-time">${c}</span>
</div>`}).join("");o.innerHTML=s}catch{}}_esc(e){return(e||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}}customElements.define("app-preview",me);const he=`
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
`;function Y(){return`<div style="flex:1;display:flex;flex-direction:column;overflow-y:auto">
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
</div>`}function be(){return'<div class="repo-layout"><app-tree></app-tree><app-preview mode="model"></app-preview></div>'}function xe(){return'<div class="repo-layout"><app-sidebar></app-sidebar><app-preview mode="stat"></app-preview></div>'}function ve(){return`<div style="flex:1;overflow-y:auto">
<div class="section-title">\u2699\uFE0F \u8BBE\u7F6E</div>
<div class="settings-group">
<div class="setting-row"><span class="label">\u{1F3AE} \u6E38\u620F\u8DEF\u5F84</span><span class="value">\u672A\u8BBE\u7F6E <span class="ptag" style="margin-left:4px">\u9884\u544A</span></span></div>
<div class="setting-row"><span class="label">\u{1F4C1} \u4ED3\u5E93\u8DEF\u5F84</span><span class="value">\u672A\u8BBE\u7F6E <span class="ptag" style="margin-left:4px">\u9884\u544A</span></span></div>
<div class="setting-row"><span class="label">\u{1F319} \u4E3B\u9898</span><span class="value">\u6697\u8272</span></div>
<div class="setting-row"><span class="label">\u{1F517} \u94FE\u63A5\u6A21\u5F0F</span><span class="value">\u786C\u94FE\u63A5 <span class="ptag" style="margin-left:4px">\u9884\u544A</span></span></div>
</div>
</div>`}function ye(t,e){return`<div class="placeholder-box"><div class="big">${t}</div><div>${e}</div><span class="ptag">\u9884\u544A</span></div>`}function we(){return`<div class="diag-wrapper">
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
</div>`}let A,I,$;class _e extends HTMLElement{constructor(){super(),this._root=this.attachShadow({mode:"open"}),this._root.adoptedStyleSheets=[new CSSStyleSheet],this._root.adoptedStyleSheets[0].replaceSync(he),this._current="dashboard"}connectedCallback(){this._unsub=bus.on("nav:change",({page:e})=>{this._current=e,bus.emit("nav:changed",{page:e}),this._render()}),bus.on("stats:upload",()=>this._handleUpload()),x(()=>Promise.resolve().then(()=>b),void 0).then(e=>{A=e.LoadAppConfig,I=e.GetInstanceStatus,$=e.SyncCustomToRepo}),this._render()}disconnectedCallback(){this._unsub&&this._unsub()}async _handleUpload(){if(!(!A||!I||!$))try{const e=await A(),n=e.mcRoot||e.McRoot||"",o=e.repoRoot||e.RepoRoot||"";if(!n||!o)return;const s=await I(n,o);if(!s||!s.length)return;let a=0;for(const i of s){if(!i.Extra||i.Extra.length===0)continue;const r=await $(i.CustomDir,o);a+=r}bus.emit("stats:refresh")}catch{}}_render(){let e="";switch(this._current){case"dashboard":e=Y();break;case"repository":e=be();break;case"instances":e=xe();break;case"downloads":e=ye("\u2B07\uFE0F","\u4E0B\u8F7D\u4E0E\u66F4\u65B0");break;case"diagnostics":e=we();break;case"settings":e=ve();break;default:e=Y()}this._root.innerHTML=`<div class="page">${e}</div>`,this._current==="diagnostics"&&this._initDiagnostics()}_initDiagnostics(){var n,o,s;const e=this._root;e.querySelectorAll(".diag-btn[data-diag]").forEach(a=>{a.addEventListener("click",()=>{const i=a.dataset.diag;e.querySelectorAll(".diag-btn[data-diag]").forEach(r=>r.classList.toggle("active",r===a)),e.getElementById("diag-log").style.display=i==="log"?"":"none",e.getElementById("diag-conflict").style.display=i==="conflict"?"":"none",i==="log"&&this._loadDiagnosticsLogs()})}),(n=e.getElementById("diag-refresh"))==null||n.addEventListener("click",()=>this._loadDiagnosticsLogs()),(o=e.getElementById("diag-clear"))==null||o.addEventListener("click",async()=>{const{ClearImportLogs:a}=await x(()=>Promise.resolve().then(()=>b),void 0);await a(),this._loadDiagnosticsLogs(),bus.emit("toast:show",{msg:"\u{1F5D1}\uFE0F \u65E5\u5FD7\u5DF2\u6E05\u7A7A",duration:2e3,type:"info"})}),(s=e.getElementById("diag-scan-conflict"))==null||s.addEventListener("click",()=>this._scanConflicts()),this._loadDiagnosticsLogs()}async _loadDiagnosticsLogs(){const e=this._root.getElementById("diag-log-list");if(!!e)try{const{GetImportLogs:n}=await x(()=>Promise.resolve().then(()=>b),void 0),o=await n();if(!o||!o.length){e.innerHTML='<div class="stat-row" style="padding:12px;color:#6c7086;font-size:11px">\u6682\u65E0\u65E5\u5FD7</div>';return}e.innerHTML=o.slice(-500).reverse().map(s=>{const a=s.Status==="success"?"success":s.Status==="failed"?"failed":"skipped",i=s.Status==="success"?"\u2705":s.Status==="failed"?"\u274C":"\u23ED\uFE0F",r=s.Timestamp?new Date(s.Timestamp).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"",c=s.ModelName+(s.TargetDir?" \u2192 "+s.TargetDir:"")+(s.ErrorMsg?": "+s.ErrorMsg:"");return`<div class="log-row">
<span class="log-status ${a}">${i}</span>
<span class="log-msg">${this._esc(c)}</span>
<span class="log-time">${r}</span>
</div>`}).join("")}catch{e.innerHTML='<div class="stat-row" style="padding:12px;color:#f38ba8;font-size:11px">\u52A0\u8F7D\u65E5\u5FD7\u5931\u8D25</div>'}}async _scanConflicts(){const e=this._root.getElementById("diag-conflict-list");if(!!e){e.innerHTML='<div class="stat-row" style="padding:12px;color:#6c7086;font-size:11px">\u626B\u63CF\u4E2D...</div>';try{const{LoadAppConfig:n,ListVersionInstances:o,ScanModelEntries:s}=await x(()=>Promise.resolve().then(()=>b),void 0),a=await n(),i=a.mcRoot||a.McRoot||"";if(!i){e.innerHTML='<div class="stat-row" style="padding:12px;color:#f38ba8;font-size:11px">\u8BF7\u5148\u8BBE\u7F6E\u6E38\u620F\u8DEF\u5F84</div>';return}const r=await o(i);if(!r||!r.length){e.innerHTML='<div class="stat-row" style="padding:12px;color:#6c7086;font-size:11px">\u6CA1\u6709\u627E\u5230\u6574\u5408\u5305</div>';return}const c={};for(const u of r){if(!u.Exists)continue;const f=await s(u.CustomDir);c[u.Name]=(f||[]).map(h=>({name:h.Name.replace(/\.ban$/i,"")}))}const l={};for(const[u,f]of Object.entries(c))for(const h of f)l[h.name]||(l[h.name]=[]),l[h.name].push(u);const p=Object.entries(l).filter(([,u])=>u.length>1).sort((u,f)=>f[1].length-u[1].length);if(!p.length){e.innerHTML='<div class="stat-row" style="padding:12px;color:#a6e3a1;font-size:11px">\u2705 \u672A\u68C0\u6D4B\u5230\u6587\u4EF6\u540D\u51B2\u7A81</div>';return}let d=`<div class="stat-row" style="padding:8px 12px;color:#f38ba8;font-size:11px">\u26A0\uFE0F \u53D1\u73B0 ${p.length} \u4E2A\u6587\u4EF6\u5B58\u5728\u4E8E\u591A\u4E2A\u6574\u5408\u5305</div>`;p.slice(0,50).forEach(([u,f])=>{d+=`<div class="conflict-row">
<span class="conflict-name">${this._esc(u)}</span>
<span class="conflict-ver">${f.length} \u4E2A\u6574\u5408\u5305</span>
</div>`,f.forEach(h=>{d+=`<div class="conflict-ins">&nbsp;&nbsp;\u{1F4E6} ${this._esc(h)}</div>`})}),p.length>50&&(d+=`<div class="stat-row" style="padding:8px 12px;color:#6c7086;font-size:10px">...\u8FD8\u6709 ${p.length-50} \u4E2A</div>`),e.innerHTML=d}catch(n){e.innerHTML=`<div class="stat-row" style="padding:12px;color:#f38ba8;font-size:11px">\u626B\u63CF\u5931\u8D25: ${this._esc(String(n))}</div>`}}}_esc(e){return(e||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}}customElements.define("app-content",_e);document.getElementById("btn-enable-all").addEventListener("click",()=>{tree.querySelectorAll(".ti:not(.open) > .ar").forEach(t=>{var e;return(e=t.closest(".ti"))==null?void 0:e.click()})});document.getElementById("btn-disable-all").addEventListener("click",()=>{tree.querySelectorAll(".ti.open > .ar").forEach(t=>{var e;return(e=t.closest(".ti.open"))==null?void 0:e.click()})});document.getElementById("btn-sync-all").addEventListener("click",async()=>{if(!mcRoot||!repoRoot){showToast("\u8BF7\u5148\u9009\u62E9\u4ED3\u5E93\u548C\u6E38\u620F\u76EE\u5F55");return}(statuses||[]).filter(e=>e.HasYSM).reduce((e,n)=>e+(n.Missing?n.Missing.length:0),0)>0?await doSyncMissing():await doSyncAll()});document.getElementById("btn-recycle").addEventListener("click",()=>openRecycleDialog());document.getElementById("btn-logs").addEventListener("click",()=>openLogDialog());document.getElementById("btn-settings").addEventListener("click",()=>openSettingsDialog());document.getElementById("btn-refresh").addEventListener("click",()=>loadAll());document.getElementById("btn-dedup").addEventListener("click",()=>doDeduplicate());document.getElementById("btn-sync-toggle").addEventListener("click",async()=>{if(!mcRoot||!repoRoot){showToast("\u8BF7\u5148\u9009\u62E9\u4ED3\u5E93\u548C\u6E38\u620F\u76EE\u5F55");return}st.textContent="\u23F3 \u540C\u6B65\u72B6\u6001\u4E2D...";try{statuses=await window.go.main.App.GetInstanceStatus(mcRoot,repoRoot),renderVersions(),updateInstallBtn(),st.textContent="\u5C31\u7EEA",showToast("\u2705 \u540C\u6B65\u72B6\u6001\u5DF2\u5237\u65B0")}catch(t){showToast("\u540C\u6B65\u72B6\u6001\u5237\u65B0\u5931\u8D25: "+(t.message||t)),st.textContent="\u274C \u5931\u8D25"}});document.getElementById("btn-upload").addEventListener("click",async()=>{if(!mcRoot||!repoRoot){showToast("\u8BF7\u5148\u9009\u62E9\u4ED3\u5E93\u548C\u6E38\u620F\u76EE\u5F55");return}const t=new Set(entries.map(a=>a.Name)),e=[];if(statuses.forEach(a=>{a.Extra&&a.Extra.forEach(i=>{if(!t.has(i)){const r=instances.find(c=>c.Name===a.Name);e.push({name:i,customDir:r?r.CustomDir:""})}})}),!e.length){showToast("\u6CA1\u6709\u5F85\u4E0A\u4F20\u7684\u6A21\u578B\uFF0C\u8BF7\u5148\u540C\u6B65");return}if(!await showConfirm("\u5C06 "+e.length+" \u4E2A\u5F85\u4E0A\u4F20\u6A21\u578B\u4E0A\u4F20\u5230\u4ED3\u5E93\uFF1F"))return;st.textContent="\u23F3 \u4E0A\u4F20\u4E2D...";let n=0,o=0;const s=[];for(const a of e){if(!a.customDir){o++,s.push({name:a.name,type:"fail"});continue}try{await window.go.main.App.SyncCustomToRepo(a.customDir,repoRoot)>0?(n++,s.push({name:a.name,type:"success"})):(o++,s.push({name:a.name,type:"fail",detail:"\u4ED3\u5E93\u5DF2\u6709\u540C\u540D\u6587\u4EF6"}))}catch(i){o++,s.push({name:a.name,type:"fail",detail:i.message||"\u672A\u77E5\u9519\u8BEF"})}}showSummaryDialog("\u{1F4E4} \u4E0A\u4F20\u5B8C\u6210",n,0,o,null,s),entries=await window.go.main.App.ScanModelEntries(repoRoot),buildTree(),mcRoot&&await refreshAll()});document.getElementById("ver-search").addEventListener("input",()=>renderVersions());document.getElementById("ysm-only").addEventListener("change",()=>renderVersions());searchInput.addEventListener("input",()=>{buildTree()});sortSelect.addEventListener("change",()=>{buildTree()});document.getElementById("btn-repo").addEventListener("click",async()=>{const t=await window.go.main.App.SelectDirectory();!t||(repoRoot=t,window.go.main.App.SetRepoRoot(t),localStorage.setItem("repoRoot",t),document.getElementById("btn-repo").textContent="\u{1F4C1} "+t,await Z(),await loadAll())});document.getElementById("btn-mc").addEventListener("click",async()=>{const t=await window.go.main.App.SelectDirectory();!t||(mcRoot=t,localStorage.setItem("mcRoot",t),document.getElementById("btn-mc").textContent="\u{1F3AE} "+t,await Z(),repoRoot&&await loadAll())});async function Z(){const t=localStorage.getItem("linkMode")||"";try{await window.go.main.App.SaveAppConfig(repoRoot,mcRoot,t)}catch(e){console.error("\u914D\u7F6E\u4FDD\u5B58\u5931\u8D25:",e)}}const m=t=>document.querySelector(t);m("#search-input");m("#st");m("#tree");m("#vg");m("#s-repo");m("#s-ver");m("#s-ok");m("#s-tot");m("#ver-search");m("#sort-select");m("#ysm-only");new Set(JSON.parse(localStorage.getItem("expandedFolders")||"[]"));bus.on("ctx:show",({x:t,y:e,type:n,instanceName:o,path:s,banned:a,dir:i,name:r})=>{if(n==="instance"){bus.emit("menu:show",{x:t,y:e,items:[{label:"\u{1F4E6} "+o,icon:"\u{1F4E6}",onClick:()=>{}},{divider:!0},{label:"\u{1F4E5} \u5B89\u88C5\u6A21\u578B",onClick:()=>bus.emit("instance:install",{name:o})},{label:"\u{1F504} \u540C\u6B65\u72B6\u6001",onClick:()=>bus.emit("instance:sync",{name:o})},{label:"\u{1F5D1}\uFE0F \u6E05\u7A7A\u76EE\u5F55",danger:!0,onClick:()=>bus.emit("instance:clear",{name:o})}]});return}if(n==="file"){bus.emit("menu:show",{x:t,y:e,items:[{label:a?"\u2705 \u542F\u7528":"\u26D4 \u7981\u7528",icon:a?"\u2705":"\u26D4",onClick:async()=>{try{await _(s),bus.emit("stats:refresh");const c=document.querySelector("app-tree");c&&(await c._load(),c._renderTree())}catch{}}},{label:"\u{1F4C4} \u6A21\u578B\u8BE6\u60C5",icon:"\u{1F4C4}",onClick:async()=>{try{const c=await W(s);bus.emit("model:select",{path:s,meta:c})}catch{bus.emit("model:select",{path:s})}}},{label:"\u{1F4C2} \u6253\u5F00\u6240\u5728\u6587\u4EF6\u5939",icon:"\u{1F4C2}",onClick:()=>{const c=s.substring(0,s.lastIndexOf("\\"));window.go.main.App.OpenFolder(c||s)}}]});return}if(n==="dir"){bus.emit("menu:show",{x:t,y:e,items:[{label:"\u2705 \u5168\u90E8\u542F\u7528",icon:"\u2705",onClick:()=>bus.emit("batch:enable",{dir:i})},{label:"\u26D4 \u5168\u90E8\u7981\u7528",icon:"\u26D4",onClick:()=>bus.emit("batch:disable",{dir:i})}]});return}});
