// ===== tpl-settings-about.ts — 设置页「关于 + 鸣谢」tab 模板（从 tpl-settings.ts 拆出，ADR-040 P1）=====
// 2026-10 菜单收口：「鸣谢」原为独立 tab，纯只读展示不值得占一个菜单槽（设置菜单的槽位
// 语义契约 = 回答"这里能配置什么"）——降级为「关于」tab 的下段小节；「关于」含真实设置
// （更新检查间隔/检查更新/版本）保留 tab。设置页 6 tab → 4 tab（与「解析」并入「操作」同批）。
import { type LocaleKey, t } from "@/core/i18n/t.ts";
import { GH_DOCS, GH_RELEASES, GH_REPO } from "@/utils/base/pure/gh-links.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { stgCard } from "./stg-card.ts";

/** About 节（「关于」tab 上段：版本卡 / 更新检查 / 特性 / 技术栈 / 链接 / 快速开始）。
 *  不再挂「关于」节标题：tab 名即 About，再挂同名大标题是纯装饰（与「解析」tab 同名
 *  标题同类问题，2026-10 菜单收口一并消）。首组卡改 B 式 .stg-section 供 16px 顶距
 *  （.stg-page 契约 padding:0 20px 16px，顶部零垫——间距必须由组自身提供）。 */
export function aboutSection(): string {
  return `<div class="stg-grid stg-section" style="margin-bottom:12px">
  <div class="stg-card">
    <div class="stg-card-hdr" style="display:flex;align-items:center;gap:8px">
      <span>${UI_ICONS.info} ${t("about.appName")}</span>
      <span id="set-version" style="font-size:var(--fs-lg);font-weight:700;color:var(--accent)">${t("common.loading")}</span>
    </div>
    <div class="stg-card-body" style="display:flex;flex-direction:column;gap:8px">
      <button class="btn-base sm stg-btn" id="set-check-update">${UI_ICONS.refresh} ${t("about.checkUpdate")}</button>
      <div class="setting-row" style="margin:0;padding:var(--sp-1) 0;background:none;border-radius:0">
        <span style="font-size:var(--fs-sm);color:var(--muted)">${UI_ICONS.clock} ${t("settings.updateCheck.title")}</span>
        <select id="set-update-check" class="stg-select" style="width:auto;font-size:var(--fs-sm);padding:var(--btn-padding-xs)">
          <option value="21600000">${t("settings.updateCheck.option6h")}</option>
          <option value="43200000">${t("settings.updateCheck.option12h")}</option>
          <option value="86400000">${t("settings.updateCheck.option24h")}</option>
          <option value="0">${t("settings.updateCheck.off")}</option>
        </select>
      </div>
    </div>
  </div>
</div>

<div style="display:flex;gap:12px;margin-bottom:12px">
  <div style="flex:2;background:var(--surf);border:1px solid var(--bd);border-radius:var(--radius-lg);padding:10px 14px;animation:fadeSlideUp var(--tr-enter) both;animation-delay:60ms">
    <div style="font-size:var(--fs-md);font-weight:600;margin-bottom:6px">${UI_ICONS.tools} ${t("about.features")}</div>
    <div class="stg-desc">
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

  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:var(--radius-lg);padding:10px 14px;animation:fadeSlideUp var(--tr-enter) both;animation-delay:90ms">
    <div style="font-size:var(--fs-md);font-weight:600;margin-bottom:6px">${UI_ICONS.gem} ${t("about.techStack")}</div>
    <div class="stg-desc">
      <div>${UI_ICONS.bullet} ${t("about.tech1")}</div>
      <div>${UI_ICONS.bullet} ${t("about.tech2")}</div>
      <div>${UI_ICONS.bullet} Web Components + Shadow DOM</div>
      <div>${UI_ICONS.bullet} ${t("about.tech4")}</div>
      <div>${UI_ICONS.bullet} ${t("about.tech5")}</div>
      <div>${UI_ICONS.bullet} ${t("about.tech6")}</div>
    </div>
  </div>
</div>

<div style="display:flex;gap:12px;margin-bottom:12px">
  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:var(--radius-lg);padding:10px 14px;animation:fadeSlideUp var(--tr-enter) both;animation-delay:120ms">
    <div style="font-size:var(--fs-md);font-weight:600;margin-bottom:6px">${UI_ICONS.package} ${t("about.links")}</div>
    <div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.8">
      <div>${UI_ICONS.github} ${t("about.ghRepo")}：<a href="${GH_REPO}" target="_blank" style="color:var(--accent)">eghrhegpe/ysm-model-manager</a></div>
      <div>${UI_ICONS.clipboard} ${t("about.releases")}：<a href="${GH_RELEASES}" target="_blank" style="color:var(--accent)">${t("about.releasesLink")}</a></div>
      <div>${UI_ICONS.book} ${t("about.docs")}：<a href="${GH_DOCS}" target="_blank" style="color:var(--accent)">${t("about.docsLink")}</a></div>
      <div>${UI_ICONS.file} ${t("about.config")}：<code>${t("about.configPath")}</code></div>
    </div>
  </div>

  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:var(--radius-lg);padding:10px 14px;animation:fadeSlideUp var(--tr-enter) both;animation-delay:150ms">
    <div style="font-size:var(--fs-md);font-weight:600;margin-bottom:6px">${UI_ICONS.hint} ${t("about.quickStart")}</div>
    <div class="stg-desc">
      <div>1. ${t("about.qs1")}</div>
      <div>2. ${t("about.qs2")}</div>
      <div>3. ${t("about.qs3")}</div>
      <div>4. ${t("about.qs4")}</div>
      <div>5. ${t("about.qs5")}</div>
    </div>
  </div>
</div>`;
}

/** 灵感来源（改这里加项；i18n 见 credits.* + 对应外链） */
const INSPIRATIONS = [
  {
    titleKey: "credits.download",
    descKey: "credits.downloadDesc",
    icon: UI_ICONS.download,
    link: "https://github.com/LaoYutang/lytvpk",
    linkText: "LaoYutang/lytvpk",
  },
  {
    titleKey: "credits.render3d",
    descKey: "credits.render3dDesc",
    icon: UI_ICONS.appearance,
    link: "https://github.com/DrAbcOfficial/YSMViewer",
    linkText: "DrAbcOfficial/YSMViewer",
  },
  {
    titleKey: "credits.parse",
    descKey: "credits.parseDesc",
    icon: UI_ICONS.lockClosed,
    link: "",
    linkText: "YSMParser.Core",
  },
  {
    titleKey: "credits.repo",
    descKey: "credits.repoDesc",
    icon: UI_ICONS.package,
    link: "",
    linkText: "Mod Organizer 2",
  },
] as const satisfies ReadonlyArray<{
  titleKey: LocaleKey;
  descKey: LocaleKey;
  icon: string;
  link?: string;
  linkText: string;
}>;

/** 特别鸣谢贡献者（改这里加人，i18n 描述 key 见 credits.*Contribute） */
const CONTRIBUTORS = [
  { name: "zuogeren1", github: "zuogeren1", descKey: "credits.zuogeren1Contribute" },
  { name: "JiangKaslana", github: "JiangKaslana", descKey: "credits.jiangkaslanaContribute" },
] as const satisfies ReadonlyArray<{ name: string; github: string; descKey: LocaleKey }>;

/** 灵感来源卡片组：stg-grid 平铺 + stgCard 正典卡（设置页样式范式契约） */
function renderInspirations(): string {
  const cards = INSPIRATIONS.map((it, i) => {
    const linkHtml = it.link
      ? `<br><a href="${it.link}" target="_blank" style="color:var(--accent)">${it.linkText}</a>`
      : `<br>${it.linkText}`;
    return stgCard(
      it.icon,
      t(it.titleKey),
      `<div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.5">${t(it.descKey)}${linkHtml}</div>`,
      { header: { titleSize: "md" }, delayMs: 60 * (i + 1) },
    );
  }).join("");
  return `<div class="section-title stg-title">${UI_ICONS.target} ${t("credits.inspiration")}</div>
<div class="stg-grid">${cards}</div>`;
}

/** 贡献者卡片组：stg-grid 平铺 + stgCard 正典卡（数组驱动，加人只改 CONTRIBUTORS） */
function renderContributors(): string {
  const cards = CONTRIBUTORS.map((c, i) =>
    stgCard(
      UI_ICONS.user,
      c.name,
      `<div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.5">
      ${t(c.descKey)}<br>
      <a href="https://github.com/${c.github}" target="_blank" style="color:var(--accent)">@${c.github}</a>
    </div>`,
      { header: { titleSize: "md" }, delayMs: 60 * (i + 1) },
    ),
  ).join("");
  return `<div class="section-title stg-title">${UI_ICONS.thanks} ${t("credits.special")}</div>
<div class="stg-grid">${cards}</div>`;
}

/** Credits 小节（「关于」tab 下段：灵感来源 + 特别鸣谢，2026-10 自独立 tab 降级）。
 *  顶部挂「鸣谢」节标题与上方 About 节分界（.section-title A 式自带 16px 顶距单供）；
 *  纯只读展示，tab 内滚动到底才到，零操作成本。 */
export function creditsSection(): string {
  return `<div class="section-title stg-title">${UI_ICONS.thanks} ${t("settings.credits")}</div>
${renderInspirations()}
${renderContributors()}`;
}

/** 「关于 + 鸣谢」合并 tab 体（.stg-page 壳由本函数产出；renderTabs 的 about 项 body 直用，
 *  不再外包 stg-page——与 basic/ui/ops 的 `<div class="stg-page">…</div>` 外包口径互补不叠加）。 */
export function aboutPageBody(): string {
  return `<div class="stg-page">
${aboutSection()}
${creditsSection()}
</div>`;
}
