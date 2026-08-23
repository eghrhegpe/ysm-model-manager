import { t } from "../../core/i18n/t.ts";
import { esc } from "../../utils/dom/html.ts";

export function ysmHubHTML(): string {
  return `
    <style>
      .ysmhub-page { height:100%; display:flex; flex-direction:column; overflow:hidden; background:var(--bg); }
      .ysmhub-toolbar { display:flex; align-items:center; gap:8px; padding:10px 14px; border-bottom:1px solid var(--bd); flex-shrink:0; }
      .ysmhub-title { font-size:16px; font-weight:600; color:var(--txt); margin-right:4px; white-space:nowrap; }
      .ysmhub-search { flex:1; min-width:120px; background:var(--surf); color:var(--txt); border:1px solid var(--bd); border-radius:5px; padding:7px 9px; font:inherit; }
      .ysmhub-sort { background:var(--surf); color:var(--txt); border:1px solid var(--bd); border-radius:5px; padding:7px 6px; font:inherit; }
      .ysmhub-content { flex:1; min-height:0; overflow:auto; padding:14px; }
      .ysmhub-status { color:var(--muted); font-size:12px; padding:24px; text-align:center; }
      .ysmhub-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); gap:12px; }
      .ysmhub-card { overflow:hidden; cursor:pointer; border:1px solid var(--bd); border-radius:8px; background:var(--surf); transition:transform .15s ease,border-color .15s ease; }
      .ysmhub-card:hover { transform:translateY(-2px); border-color:var(--accent); }
      .ysmhub-cover { width:100%; aspect-ratio:16/10; display:block; object-fit:cover; background:linear-gradient(135deg,var(--hover),var(--surf)); }
      .ysmhub-card-body { padding:9px 10px 10px; }
      .ysmhub-card-title { color:var(--txt); font-size:13px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .ysmhub-card-desc { color:var(--muted); font-size:11px; line-height:1.45; height:32px; overflow:hidden; margin-top:4px; }
      .ysmhub-card-meta { color:var(--muted); display:flex; gap:8px; font-size:10px; margin-top:8px; }
      .ysmhub-detail { max-width:860px; margin:0 auto; }
      .ysmhub-detail-head { display:flex; gap:16px; align-items:flex-start; }
      .ysmhub-detail-copy { flex:1; min-width:0; }
      .ysmhub-detail-cover { width:280px; max-width:42%; aspect-ratio:16/10; object-fit:cover; border-radius:8px; background:var(--hover); }
      .ysmhub-detail-title { color:var(--txt); font-size:20px; font-weight:650; margin:2px 0 8px; }
      .ysmhub-detail-desc { color:var(--muted); font-size:12px; line-height:1.6; white-space:pre-wrap; }
      .ysmhub-detail-section { margin-top:18px; border-top:1px solid var(--bd); padding-top:12px; }
      .ysmhub-section-title { color:var(--txt); font-size:13px; font-weight:600; margin-bottom:4px; }
      .ysmhub-version { display:flex; align-items:center; gap:10px; padding:9px 0; border-bottom:1px solid color-mix(in srgb,var(--bd) 60%,transparent); }
      .ysmhub-version-name { flex:1; color:var(--txt); font-size:12px; }
      .ysmhub-tags,.ysmhub-links { display:flex; flex-wrap:wrap; gap:6px; color:var(--muted); font-size:11px; }
      .ysmhub-tags span { border:1px solid var(--bd); border-radius:999px; padding:2px 7px; }
      .ysmhub-links a { color:var(--accent); }
      .ysmhub-back { margin-right:2px; }
      @media (max-width:700px) { .ysmhub-toolbar { flex-wrap:wrap; } .ysmhub-title { width:100%; } .ysmhub-detail-head { flex-direction:column; } .ysmhub-detail-cover { max-width:none; width:100%; } }
    </style>
    <div class="ysmhub-page">
      <div class="ysmhub-toolbar">
        <span class="ysmhub-title">${esc(t("nav.ysmhub"))}</span>
        <input id="ysmhub-search" class="ysmhub-search" placeholder="${esc(t("hub.searchPlaceholder"))}" autocomplete="off">
        <select id="ysmhub-sort" class="ysmhub-sort" aria-label="${esc(t("hub.sortLabel"))}">
          <option value="newest">${esc(t("hub.sortNewest"))}</option>
          <option value="recently_updated">${esc(t("hub.sortUpdated"))}</option>
          <option value="most_downloaded">${esc(t("hub.sortDownloaded"))}</option>
          <option value="most_liked">${esc(t("hub.sortLiked"))}</option>
        </select>
        <button id="ysmhub-search-btn" class="btn-base accent">${esc(t("common.search"))}</button>
        <button id="ysmhub-login-btn" class="btn-base sm">${esc(t("hub.login"))}</button>
      </div>
      <div id="ysmhub-content" class="ysmhub-content">
        <div class="ysmhub-status">${esc(t("hub.loading"))}</div>
      </div>
    </div>`;
}
