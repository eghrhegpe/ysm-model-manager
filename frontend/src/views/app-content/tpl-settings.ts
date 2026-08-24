// ===== tpl-settings.ts — settingsHTML 页面模板（从 tpl.ts 拆出，ADR-040 P1 第2轮拆分）=====
// basic + ui 标签页在此；about + credits 已拆至 tpl-settings-about.ts
import { t } from "../../core/i18n/t.ts";
import { isViewerMode } from "../../utils/dom/android-bridge.ts";
import { aboutHTML, creditsHTML } from "./tpl-settings-about.ts";

export function settingsHTML(): string {
  // 查看器模式守卫（ADR-046/049）：Android 与网页版均无 Minecraft Java 版/
  // 无整合包概念、无本地文件系统配置（网页版虚拟根 /web 固定），隐藏
  // 「游戏根目录」「链接模式」「文件存储路径」卡片（绑定均有 null 守卫，安全）
  const isViewer = isViewerMode();
  const gameRootCard = isViewer
    ? ""
    : `<div class="stg-card" style="animation-delay:0ms">
      <div class="stg-card-hdr" style="display:flex;align-items:center;justify-content:space-between">🎮 ${t("settings.paths.gameRoot")}<button class="btn-base sm" id="set-mc-detect">🔍 ${t("settings.paths.autoSearch")}</button></div>
      <div class="stg-card-body">
        <div class="stg-card-val" id="set-mc-path">${t("common.loading")}</div>
        <div class="stg-card-desc">${t("settings.paths.gameRootDesc")}</div>
      </div>
    </div>`;
  const launcherCard = isViewer
    ? ""
    : `<div class="stg-card" style="animation-delay:30ms">
      <div class="stg-card-hdr" style="display:flex;align-items:center;justify-content:space-between">🚀 ${t("settings.launcher.title")}<button class="btn-base sm" id="set-launcher-detect">🔍 ${t("settings.launcher.detect")}</button></div>
      <div class="stg-card-body">
        <div class="stg-card-val" id="set-launcher-path">${t("settings.launcher.notConfigured")}</div>
        <div class="stg-card-desc">${t("settings.launcher.desc")}</div>
        <div id="set-launcher-results" style="margin-top:7px;font-size:var(--fs-sm);color:var(--muted)"></div>
      </div>
    </div>`;
  const linkCard = isViewer
    ? ""
    : `<div class="stg-card" style="animation-delay:60ms">
      <div class="stg-card-hdr" style="display:flex;align-items:center;justify-content:space-between">
        <span class="label" style="font-size:13px;font-weight:600">🔗 ${t("settings.links.title")}</span>
        <button id="set-relink" class="btn-base sm">🔄 ${t("settings.links.reapply")}</button>
      </div>
      <div class="stg-card-body">
        <select id="set-link-mode" class="stg-select" style="width:100%;margin-bottom:6px">
          <option value="copy">📋 ${t("settings.links.copy")}</option>
          <option value="hardlink" selected>🔗 ${t("settings.links.hardlink")} ✅</option>
          <option value="symlink">🔗 ${t("settings.links.symlink")}</option>
        </select>
        <div id="lm-hint-copy" style="display:none;font-size:var(--fs-sm);color:var(--muted);padding:2px 0">${t("settings.links.copyHint")}</div>
        <div id="lm-hint-hardlink" style="display:none;font-size:var(--fs-sm);color:var(--muted);padding:2px 0">${t("settings.links.hardlinkHint")}</div>
        <div id="lm-hint-symlink" style="display:none;font-size:var(--fs-sm);color:var(--muted);padding:2px 0"><span style="color:var(--status-error)">${t("settings.links.symlinkHint")}</span></div>
      </div>
    </div>`;
  return `<div class="repo-wrap">
<div class="repo-tabs">
<button class="stg-tab active" data-tab="basic">⚙️ ${t("settings.basic")}</button>
<button class="stg-tab" data-tab="ui">🎨 ${t("settings.appearance")}</button>
<button class="stg-tab" data-tab="parser">🧩 ${t("settings.parser")}</button>
<button class="stg-tab" data-tab="about">ℹ️ ${t("settings.about")}</button>
<button class="stg-tab" data-tab="credits">🙏 ${t("settings.credits")}</button>
</div>
<!-- stg-tab-basic -->
<div class="repo-tab-body" id="stg-tab-basic" style="overflow-y:auto">
<div class="stg-page" style="padding:16px 20px">

<div class="section-title stg-title">⚙️ ${t("settings.paths.title")}</div>

<div class="stg-grid">
    <!-- Row 1: 三栏 — 游戏根目录 + 链接模式 + 下载镜像源（查看器模式隐藏全部） -->
    ${gameRootCard}
    ${launcherCard}
    ${linkCard}
    ${isViewer ? "" : `
    <div class="stg-card" style="animation-delay:120ms">
      <div class="stg-card-hdr">
        <span class="label" style="font-size:13px;font-weight:600">🌐 ${t("settings.mirror.title")}</span>
      </div>
      <div class="stg-card-body">
        <select id="set-mirror" class="stg-select" style="width:100%;margin-bottom:6px">
          <option value="">🌍 ${t("settings.mirror.directOption")}</option>
          <option value="jsdelivr">⚡ ${t("settings.mirror.jsdelivrOption")}</option>
          <option value="githubapi">🐙 GitHub API</option>
        </select>
        <div id="mirror-hint-direct" style="font-size:var(--fs-sm);color:var(--muted);padding:2px 0;line-height:1.5">${t("settings.mirror.directHint")}</div>
        <div id="mirror-hint-jsdelivr" style="display:none;font-size:var(--fs-sm);color:var(--muted);padding:2px 0;line-height:1.5">${t("settings.mirror.jsdelivrHint")}</div>
        <div id="mirror-hint-githubapi" style="display:none;font-size:var(--fs-sm);color:var(--muted);padding:2px 0;line-height:1.5">${t("settings.mirror.githubapiHint")}</div>
      </div>
    </div>
    `}
    ${isViewer ? "" : ""}
  </div>

  <!-- Row 2: 文件存储路径（桌面）/ 网页版文件来源（viewer）——查看器模式隐藏本地路径配置，改为 FSA 授权（ADR-049 能力门控缺口补齐） -->
  ${isViewer ? `
  <div class="stg-card" id="stg-web-repo-card" style="margin-top:8px;animation-delay:180ms">
    <div class="stg-card-hdr">📁 ${t("settings.webRepo.title")}</div>
    <div class="stg-card-body">
      <div class="stg-card-desc">${t("settings.webRepo.desc")}</div>
      <button class="btn" id="web-repo-auth-btn" style="margin-top:8px;font-size:11px;padding:4px 12px">📂 ${t("settings.webRepo.authorize")}</button>
      <div id="web-repo-auth-status" style="font-size:10px;color:var(--muted);margin-top:6px;line-height:1.5"></div>
    </div>
  </div>
  ` : `
  <div class="stg-card" id="stg-files-card" style="margin-top:8px;animation-delay:180ms">
    <div class="stg-card-hdr" style="display:flex;align-items:center;justify-content:space-between">📁 ${t("settings.storage.title")}<button class="btn" id="set-advanced-toggle" style="font-size:9px;padding:2px 8px">📂 ${t("settings.storage.expand")} ▸</button></div>
    <div class="stg-card-body">
      <div class="stg-card-val" id="set-files-root">${t("common.loading")}</div>
      <div class="stg-card-desc">${t("settings.storage.desc")}</div>
      <div id="set-advanced-panel" style="display:none;margin-top:8px;padding-top:8px;border-top:1px solid var(--bd)">
        <div style="font-size:10px;color:var(--muted);margin-bottom:6px">${t("settings.path.customHint")}</div>
        <div class="stg-grid" id="set-advanced-grid"></div>
      </div>
    </div>
  </div>
  `}

<!-- 语言 -->
<div class="section-title stg-title" style="margin-top:12px">🌐 ${t("settings.language")}</div>
<div class="stg-card" style="animation-delay:240ms">
  <div class="stg-card-body" style="display:flex;align-items:center;gap:8px">
    <select id="set-lang" class="stg-select" style="width:auto">
      <option value="zh-CN">简体中文</option>
      <option value="en">English</option>
      <option value="ja">日本語</option>
    </select>
    <span style="font-size:10px;color:var(--muted)">${t("settings.languageDesc")}</span>
  </div>
</div>

</div>
</div>
<!-- /stg-tab-basic -->

<!-- stg-tab-ui -->
<div class="repo-tab-body" id="stg-tab-ui" style="display:none;overflow-y:auto">
<div class="stg-page" style="padding:16px 20px">

<div class="section-title stg-title">🌙 ${t("settings.theme.title")}</div>

<!-- 主题卡片：直接展示 -->
<div class="settings-group" style="margin-bottom:12px;animation:card-in var(--tr-enter) both;animation-delay:0ms">
  <div class="setting-row" style="flex-direction:column;align-items:stretch;gap:8px">
    <span class="label">🎨 ${t("settings.theme.select")}</span>
    <div class="theme-picker" id="theme-picker">
      <div class="theme-card" data-theme="warm">
        <div style="display:flex;gap:2px;margin-bottom:2px">
          <span style="width:8px;height:8px;border-radius:50%;background:#8b4513"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#a0866a"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#d4a574"></span>
        </div>
        <span style="font-size:10px;font-weight:600;color:#5d4037">☀️ ${t("settings.theme.warm")}</span>
      </div>
      <div class="theme-card" data-theme="sakura">
        <div style="display:flex;gap:2px;margin-bottom:2px">
          <span style="width:8px;height:8px;border-radius:50%;background:#d81b60"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#f5b8cc"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#fce4ec"></span>
        </div>
        <span style="font-size:10px;font-weight:600;color:#5d4037">🌸 ${t("settings.theme.sakura")}</span>
      </div>
      <div class="theme-card" data-theme="mint">
        <div style="display:flex;gap:2px;margin-bottom:2px">
          <span style="width:8px;height:8px;border-radius:50%;background:#D5F5E3"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#A2D9CE"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#76D7C4"></span>
        </div>
        <span style="font-size:10px;font-weight:600;color:#2c3e3a">🍃 ${t("settings.theme.mint")}</span>
      </div>
      <div class="theme-card" data-theme="pro">
        <div style="display:flex;gap:2px;margin-bottom:2px">
          <span style="width:8px;height:8px;border-radius:50%;background:#ff8a65"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#b0bec5"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#757575"></span>
        </div>
        <span style="font-size:10px;font-weight:600;color:#e0e0e0">⚪ ${t("settings.theme.pro")}</span>
      </div>
      <div class="theme-card" data-theme="cyber">
        <div style="display:flex;gap:2px;margin-bottom:2px">
          <span style="width:8px;height:8px;border-radius:50%;background:#9575cd"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#66d9ef"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#f1fa8c"></span>
        </div>
        <span style="font-size:10px;font-weight:600;color:#e0d5f5">🌙 ${t("settings.theme.cyber")}</span>
      </div>
      <div class="theme-card" data-theme="ocean">
        <div style="display:flex;gap:2px;margin-bottom:2px">
          <span style="width:8px;height:8px;border-radius:50%;background:#5c6bc0"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#7986cb"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#9fa8da"></span>
        </div>
        <span style="font-size:10px;font-weight:600;color:#c5d8e8">🌊 ${t("settings.theme.ocean")}</span>
      </div>
    </div>
  </div>
</div>

<!-- 自动切换：独立一栏 -->
<div class="settings-group" style="margin-bottom:12px;animation:card-in var(--tr-enter) both;animation-delay:60ms">
  <div class="setting-row">
    <span class="label">🕐 ${t("settings.theme.autoTitle")}</span>
    <select id="theme-auto" class="stg-select" style="width:auto">
      <option value="off">${t("settings.theme.autoOff")}</option>
      <option value="system">${t("settings.theme.autoSystem")}</option>
      <option value="time">${t("settings.theme.autoTime")}</option>
    </select>
  </div>
</div>

<div class="section-title stg-title stg-sub-title">📐 ${t("settings.font.title")}</div>

<div style="display:flex;gap:12px">
  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px;animation:card-in var(--tr-enter) both;animation-delay:60ms">
    <div class="setting-row" style="margin:0 0 6px;padding:4px 0">
      <span class="label" style="font-size:13px;font-weight:600">📏 ${t("settings.fontSize")}</span>
    </div>
    <select id="set-font-size" class="stg-select" style="width:100%;margin-bottom:4px">
      <option value="small">🔹 ${t("settings.fontSize.small")}</option>
      <option value="normal" selected>🔸 ${t("settings.fontSize.normal")}</option>
      <option value="large">🔺 ${t("settings.fontSize.large")}</option>
    </select>
    <div id="set-size-preview" style="display:flex;gap:8px;font-size:var(--fs-sm);color:var(--muted);padding:2px 0">
      <span>${t("settings.ui.body")} <b id="sz-base" style="color:var(--txt)">12px</b></span>
      <span>${t("settings.ui.buttonGap")} <b id="sz-space" style="color:var(--txt)">5px</b></span>
      <span>${t("settings.ui.buttonHeight")} <b id="sz-btn-h" style="color:var(--txt)">23px</b></span>
    </div>
    <div class="stg-hint" style="font-size:var(--fs-sm);color:var(--muted);padding:0">${t("settings.fontSizeHint")}</div>
  </div>

  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px;animation:card-in var(--tr-enter) both;animation-delay:90ms">
    <div class="setting-row" style="margin:0 0 6px;padding:4px 0">
      <span class="label" style="font-size:13px;font-weight:600">🃏 ${t("settings.font.creatorFont")}</span>
    </div>
    <select id="set-display-font" class="stg-select" style="width:100%;margin-bottom:6px">
      <option value="kaiti" selected>🖌️ ${t("settings.font.kaiti")}</option>
      <option value="system">📝 ${t("settings.font.systemFont")}</option>
    </select>
    <div class="stg-hint" style="font-size:var(--fs-sm);color:var(--muted);padding:0">${t("settings.fontHint")}</div>
  </div>

  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px;animation:card-in var(--tr-enter) both;animation-delay:120ms">
    <div class="setting-row" style="margin:0 0 6px;padding:4px 0">
      <span class="label" style="font-size:13px;font-weight:600">💳 ${t("settings.density")}</span>
    </div>
    <select id="set-card-density" class="stg-select" style="width:100%;margin-bottom:6px">
      <option value="compact" selected>📦 ${t("settings.density.compact")}</option>
      <option value="normal">📦 ${t("settings.density.normal")}</option>
    </select>
    <div class="stg-hint" style="font-size:var(--fs-sm);color:var(--muted);padding:0">${t("settings.densityHint")}</div>
  </div>
</div>

<div class="section-title stg-title stg-sub-title">⚡ ${t("settings.animation.title")}</div>

<div class="settings-group" style="margin-bottom:12px;animation:card-in var(--tr-enter) both;animation-delay:180ms">
  <div class="setting-row">
    <span class="label">✨ ${t("settings.animation.enable")}</span>
    <label class="stg-label" style="gap:8px">
      <input type="checkbox" id="set-animations" checked> ${t("settings.animation.enableCheck")}
    </label>
  </div>
  <div class="stg-hint">${t("settings.animation.hint")}</div>
</div>

<div class="settings-group" style="margin-bottom:12px;animation:card-in var(--tr-enter) both;animation-delay:210ms">
  <div class="setting-row">
    <span class="label">🏠 ${t("settings.defaultPage")}</span>
    <select id="set-default-page" class="stg-select">
      <option value="instances">🎮 ${t("settings.defaultPage.instances")}</option>
      <option value="workshop">🎨 ${t("settings.defaultPage.workshop")}</option>
      <option value="repository">📦 ${t("settings.defaultPage.repository")}</option>
    </select>
  </div>
  <div class="stg-hint">${t("settings.defaultPageHint")}</div>
</div>

<div class="section-title stg-title stg-sub-title">🕹️ ${t("settings.preview3d.title")}</div>

<div class="settings-group" style="margin-bottom:12px;animation:card-in var(--tr-enter) both;animation-delay:240ms">
  <div class="setting-row">
    <span class="label">🎥 ${t("settings.preview3d.camSpeed")}</span>
    <input type="range" id="td-camspeed" min="2" max="200" value="20" style="flex:1;accent-color:var(--accent,#7c83ff)">
    <span id="td-camspeed-val" style="min-width:28px;text-align:right;color:var(--txt)">20</span>
  </div>
  <div class="stg-hint">${t("settings.preview3d.camSpeedHint")}</div>
</div>

<div class="settings-group" style="margin-bottom:12px;animation:card-in var(--tr-enter) both;animation-delay:270ms">
  <div class="setting-row">
    <span class="label">🔄 ${t("settings.preview3d.rotMode")}</span>
    <select id="td-rotmode" class="stg-select" style="width:auto">
      <option value="orbit">${t("settings.preview3d.orbit")}</option>
      <option value="free">${t("settings.preview3d.free")}</option>
    </select>
  </div>
  <div class="stg-hint">${t("settings.preview3d.rotModeHint")}</div>
</div>

<div class="settings-group" style="margin-bottom:12px;animation:card-in var(--tr-enter) both;animation-delay:300ms">
  <div class="setting-row" style="align-items:flex-start;flex-direction:column;gap:8px">
    <span class="label">🎮 ${t("settings.preview3d.keymap")}</span>
    <div id="td-keymap-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px 14px;width:100%"></div>
  </div>
  <div class="stg-hint">${t("settings.preview3d.keymapHint")}</div>
  <div style="margin-top:8px"><button class="btn-base sm" id="td-keymap-reset">↩️ ${t("settings.preview3d.resetKeys")}</button></div>
</div>

</div>
</div>
<!-- /stg-tab-ui -->

<!-- stg-tab-parser -->
<div class="repo-tab-body" id="stg-tab-parser" style="display:none;overflow-y:auto">
<div class="stg-page" style="padding:16px 20px">

<div class="section-title stg-title">🧩 ${t("settings.parser")}</div>
<div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.7;margin-bottom:12px">${t("settings.parserDesc")}</div>

<div class="settings-group" style="margin-bottom:12px;animation:card-in var(--tr-enter) both;animation-delay:0ms">
  <div class="setting-row">
    <span class="label">🧩 ${t("settings.preview3d.fbxWorker")}</span>
    <label class="stg-label" style="gap:8px">
      <input type="checkbox" id="set-fbx-worker"> ${t("settings.preview3d.workerCheck")}
    </label>
  </div>
  <div class="stg-hint">${t("settings.preview3d.fbxWorkerHint")}</div>
</div>

<div class="settings-group" style="margin-bottom:12px;animation:card-in var(--tr-enter) both;animation-delay:30ms">
  <div class="setting-row">
    <span class="label">🎯 ${t("settings.preview3d.frustumCull")}</span>
    <label class="stg-label" style="gap:8px">
      <input type="checkbox" id="set-frustum-cull"> ${t("settings.preview3d.workerCheck")}
    </label>
  </div>
  <div class="stg-hint">${t("settings.preview3d.frustumCullHint")}</div>
</div>

<div class="settings-group" style="margin-bottom:12px;animation:card-in var(--tr-enter) both;animation-delay:60ms">
  <div class="setting-row">
    <span class="label">🧩 ${t("settings.preview3d.mmdWorker")}</span>
    <label class="stg-label" style="gap:8px">
      <input type="checkbox" id="set-mmd-worker"> ${t("settings.preview3d.workerCheck")}
    </label>
  </div>
  <div class="stg-hint">${t("settings.preview3d.mmdWorkerHint")}</div>
</div>

</div>
</div>
<!-- /stg-tab-parser -->

${aboutHTML()}
${creditsHTML()}

</div>`;
}
