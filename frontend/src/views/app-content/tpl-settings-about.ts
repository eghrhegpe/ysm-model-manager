// ===== tpl-settings-about.ts — 设置页 About/Credits 标签页模板（从 tpl-settings.ts 拆出，ADR-040 P1）=====
import { t } from "../../core/i18n/t.ts";
import { GH_DOCS, GH_RELEASES, GH_REPO } from "../../utils/gh-links.ts";

/** About 标签页（版本/特性/技术栈/链接/快速上手） */
export function aboutHTML(): string {
  return `<!-- stg-tab-about -->
<div class="tab-body" id="stg-tab-about" style="display:none;overflow-y:auto">
<div class="stg-page" style="padding:16px 20px">

<div class="section-title stg-title">ℹ️ ${t("about.title")}</div>

<div class="stg-grid" style="margin-bottom:12px">
  <div class="stg-card">
    <div class="stg-card-hdr" style="display:flex;align-items:center;gap:8px">
      <span>ℹ️ ${t("about.version")}</span>
      <span id="set-version" style="font-size:var(--fs-lg);font-weight:700;color:var(--accent)">${t("common.loading")}</span>
    </div>
    <div class="stg-card-body" style="display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;align-items:center;gap:8px">
        <button class="btn-base sm stg-btn" id="set-check-update">🔄 ${t("about.checkUpdate")}</button>
        <button class="btn-base sm" id="set-releases" title="${t("about.openReleases")}">📋 ${t("about.releasePage")}</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted)">
        <span>🕐 ${t("settings.updateCheck.title")}:</span>
        <select id="set-update-check" class="stg-select" style="width:auto;font-size:11px;padding:2px 4px">
          <option value="21600000">${t("settings.updateCheck.option6h")}</option>
          <option value="43200000">${t("settings.updateCheck.option12h")}</option>
          <option value="86400000">${t("settings.updateCheck.option24h")}</option>
          <option value="0">🛑 ${t("settings.updateCheck.off")}</option>
        </select>
      </div>
    </div>
  </div>
</div>

<div style="display:flex;gap:12px;margin-bottom:12px">
  <div style="flex:2;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px;animation:card-in var(--tr-enter) both;animation-delay:60ms">
    <div style="font-size:13px;font-weight:600;margin-bottom:6px">🛠️ ${t("about.features")}</div>
    <div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.7">
      <b>${t("about.appName")}</b> ${t("about.intro")}
      <br><br>
      ✅ ${t("about.f1")}<br>
      ✅ ${t("about.f2")}<br>
      ✅ ${t("about.f3")}<br>
      ✅ ${t("about.f4")}<br>
      ✅ ${t("about.f5")}<br>
      ✅ ${t("about.f6")}<br>
      ✅ ${t("about.f7")}
    </div>
  </div>

  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px;animation:card-in var(--tr-enter) both;animation-delay:90ms">
    <div style="font-size:13px;font-weight:600;margin-bottom:6px">💎 ${t("about.techStack")}</div>
    <div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.7">
      <div>🔹 ${t("about.tech1")}</div>
      <div>🔹 ${t("about.tech2")}</div>
      <div>🔹 Web Components + Shadow DOM</div>
      <div>🔹 ${t("about.tech4")}</div>
      <div>🔹 ${t("about.tech5")}</div>
      <div>🔹 ${t("about.tech6")}</div>
    </div>
  </div>
</div>

<div style="display:flex;gap:12px;margin-bottom:12px">
  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px;animation:card-in var(--tr-enter) both;animation-delay:120ms">
    <div style="font-size:13px;font-weight:600;margin-bottom:6px">📦 ${t("about.links")}</div>
    <div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.8">
      <div>🐙 ${t("about.ghRepo")}：<a href="${GH_REPO}" target="_blank" style="color:var(--accent)">eghrhegpe/ysm-model-manager</a></div>
      <div>📋 ${t("about.releases")}：<a href="${GH_RELEASES}" target="_blank" style="color:var(--accent)">${t("about.releasesLink")}</a></div>
      <div>📖 ${t("about.docs")}：<a href="${GH_DOCS}" target="_blank" style="color:var(--accent)">${t("about.docsLink")}</a></div>
      <div>📄 ${t("about.config")}：<code>${t("about.configPath")}</code></div>
    </div>
  </div>

  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px;animation:card-in var(--tr-enter) both;animation-delay:150ms">
    <div style="font-size:13px;font-weight:600;margin-bottom:6px">💡 ${t("about.quickStart")}</div>
    <div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.7">
      <div>1. ${t("about.qs1")}</div>
      <div>2. ${t("about.qs2")}</div>
      <div>3. ${t("about.qs3")}</div>
      <div>4. ${t("about.qs4")}</div>
      <div>5. ${t("about.qs5")}</div>
    </div>
  </div>
</div>

</div>
</div>
<!-- /stg-tab-about -->`;
}

/** 特别鸣谢贡献者（改这里加人，i18n 描述 key 见 credits.*Contribute） */
const CONTRIBUTORS = [
  { name: "zuogeren1", github: "zuogeren1", descKey: "credits.zuogeren1Contribute" },
  { name: "JiangKaslana", github: "JiangKaslana", descKey: "credits.jiangkaslanaContribute" },
];

/** Credits 标签页（灵感来源/特别感谢） */
export function creditsHTML(): string {
  return `<!-- stg-tab-credits -->
<div class="tab-body" id="stg-tab-credits" style="display:none;overflow-y:auto">
<div class="stg-page" style="padding:16px 20px">

<div class="section-title stg-title">🎯 ${t("credits.inspiration")}</div>

<div style="display:flex;gap:12px">
  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px">
    <div style="font-size:13px;font-weight:600;margin-bottom:4px">⬇️ ${t("credits.download")}</div>
    <div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.5">
      <a href="https://github.com/LaoYutang/lytvpk" target="_blank" style="color:var(--accent)">LaoYutang/lytvpk</a><br>
      ${t("credits.downloadDesc")}
    </div>
  </div>
  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px">
    <div style="font-size:13px;font-weight:600;margin-bottom:4px">🎨 ${t("credits.render3d")}</div>
    <div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.5">
      <a href="https://github.com/DrAbcOfficial/YSMViewer" target="_blank" style="color:var(--accent)">DrAbcOfficial/YSMViewer</a><br>
      ${t("credits.render3dDesc")}
    </div>
  </div>
  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px">
    <div style="font-size:13px;font-weight:600;margin-bottom:4px">🔐 ${t("credits.parse")}</div>
    <div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.5">
      YSMParser.Core<br>
      ${t("credits.parseDesc")}
    </div>
  </div>
  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px">
    <div style="font-size:13px;font-weight:600;margin-bottom:4px">📦 ${t("credits.repo")}</div>
    <div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.5">
      Mod Organizer 2<br>
      ${t("credits.repoDesc")}
    </div>
  </div>
</div>

<div class="section-title stg-title stg-sub-title">🙏 ${t("credits.special")}</div>

<div style="display:flex;gap:12px">
  ${CONTRIBUTORS.map(c => `
  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px">
    <div style="font-size:13px;font-weight:600;margin-bottom:4px">👤 ${c.name}</div>
    <div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.5">
      ${t(c.descKey)}<br>
      <a href="https://github.com/${c.github}" target="_blank" style="color:var(--accent)">@${c.github}</a>
    </div>
  </div>`).join("")}
</div>

</div>
</div>
<!-- /stg-tab-credits -->`;
}
