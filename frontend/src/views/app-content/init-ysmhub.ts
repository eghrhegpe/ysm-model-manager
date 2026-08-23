import { bus } from "../../bus.ts";
import { getApp } from "../../backend/app.ts";
import { t } from "../../core/i18n/t.ts";
import { esc } from "../../utils/dom/html.ts";
import {
  downloadYSMHubModel,
  getYSMHubModel,
  listYSMHubModels,
  loginYSMHub,
  type YSMHubModel,
  type YSMHubVersion,
} from "../../services/ysmhub.ts";

interface HubHost { _root: ShadowRoot; _unsubs: Array<() => void> }

function listen(target: EventTarget, type: string, handler: EventListener, unsubs: Array<() => void>): void {
  target.addEventListener(type, handler);
  unsubs.push(() => target.removeEventListener(type, handler));
}

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function errorMessage(error: unknown): string {
  return text((error as Error)?.message || error);
}

function descriptionText(model: YSMHubModel): string {
  const raw = text(model.short_description || model.description || model.description_html || t("hub.noDescription"));
  return raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function labelOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return text(item.name || item.label || item.title || item.url);
  }
  return "";
}

function safeExternalURL(value: unknown): string {
  const raw = text(value).trim();
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function coverHTML(model: YSMHubModel, cls: string): string {
  const url = text(model.cover_image_url).trim();
  if (!url) return `<div class="${cls}" aria-label="${esc(t("hub.noCover"))}"></div>`;
  return `<img class="${cls}" src="${esc(url)}" alt="${esc(model.title || t("hub.modelAlt"))}" loading="lazy" onerror="this.style.display='none'">`;
}

function modelCard(model: YSMHubModel, index: number): string {
  const title = text(model.title || model.slug || model.id);
  const desc = descriptionText(model);
  return `<article class="ysmhub-card" data-hub-slug="${esc(model.slug)}" style="animation-delay:${Math.min(index * 25, 300)}ms">
    ${coverHTML(model, "ysmhub-cover")}
    <div class="ysmhub-card-body">
      <div class="ysmhub-card-title" title="${esc(title)}">${esc(title)}</div>
      <div class="ysmhub-card-desc">${esc(desc)}</div>
      <div class="ysmhub-card-meta"><span>↓ ${Number(model.download_count || 0)}</span><span>◉ ${Number(model.view_count || 0)}</span>${model.owner_name ? `<span>${esc(model.owner_name)}</span>` : ""}</div>
    </div>
  </article>`;
}

export function initYSMHubPage(host: HubHost): void {
  const root = host._root;
  const content = root.getElementById("ysmhub-content");
  const search = root.getElementById("ysmhub-search") as HTMLInputElement | null;
  const sort = root.getElementById("ysmhub-sort") as HTMLSelectElement | null;
  const searchBtn = root.getElementById("ysmhub-search-btn");
  const loginBtn = root.getElementById("ysmhub-login-btn");
  if (!content || !search || !sort || !searchBtn || !loginBtn) return;

  let disposed = false;
  let loading = false;
  let pageNumber = 1;
  let hasMore = false;
  let models: YSMHubModel[] = [];
  let detailModel: YSMHubModel | null = null;

  const showStatus = (message: string): void => {
    content.innerHTML = `<div class="ysmhub-status">${esc(message)}</div>`;
  };

  const renderList = (): void => {
    const more = hasMore
      ? `<div class="ysmhub-more"><button class="btn-base sm" data-hub-more="1">${esc(t("hub.loadMore"))}</button></div>`
      : "";
    content.innerHTML = `<div class="ysmhub-grid">${models.map(modelCard).join("")}</div>${more}`;
  };

  const load = async (reset = true): Promise<void> => {
    if (loading || disposed) return;
    if (reset) {
      pageNumber = 1;
      models = [];
      detailModel = null;
    }
    loading = true;
    showStatus(t("hub.loading"));
    try {
      const page = await listYSMHubModels({ query: search.value.trim(), sort: sort.value, page: pageNumber, pageSize: 24 });
      if (disposed) return;
      if (reset) models = [];
      models.push(...page.items);
      hasMore = page.page < page.total_pages;
      if (!models.length) {
        showStatus(t("hub.noModels"));
        return;
      }
      renderList();
      if (hasMore) pageNumber += 1;
    } catch (error) {
      if (!disposed) showStatus(t("hub.loadFailed", { error: errorMessage(error) }));
    } finally {
      loading = false;
    }
  };

  const openDetail = async (slug: string): Promise<void> => {
    if (!slug || disposed) return;
    showStatus(t("hub.loadingDetail"));
    try {
      const detail = await getYSMHubModel(slug);
      if (disposed) return;
      const model = detail.model;
      detailModel = model;
      const versions = detail.versions || [];
      const tags = (detail.tags || []).map(labelOf).filter(Boolean);
      const links = (detail.links || []).map((link) => {
        const label = labelOf(link);
        const url = safeExternalURL(typeof link === "object" && link !== null ? (link as Record<string, unknown>).url : link);
        return url ? `<a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(label || url)}</a>` : "";
      }).filter(Boolean);
      const tagsHTML = tags.length ? `<div class="ysmhub-detail-section"><div class="ysmhub-section-title">${esc(t("hub.tags"))}</div><div class="ysmhub-tags">${tags.map((tag) => `<span>${esc(tag)}</span>`).join("")}</div></div>` : "";
      const linksHTML = links.length ? `<div class="ysmhub-detail-section"><div class="ysmhub-section-title">${esc(t("hub.links"))}</div><div class="ysmhub-links">${links.join("")}</div></div>` : "";
      const versionRows = versions.length
        ? versions.map((version: YSMHubVersion) => `<div class="ysmhub-version">
            <span class="ysmhub-version-name">${esc(text(version.version_name || t("hub.unnamedVersion")))}${version.is_recommended ? ` · ${esc(t("hub.recommended"))}` : ""}</span>
            <button class="btn-base accent sm" data-hub-download="${esc(String(version.id))}">${esc(t("hub.download"))}</button>
          </div>`).join("")
        : `<div class="ysmhub-status">${esc(t("hub.noVersions"))}</div>`;
      content.innerHTML = `<div class="ysmhub-detail">
        <div class="ysmhub-detail-head">
          ${coverHTML(model, "ysmhub-detail-cover")}
          <div class="ysmhub-detail-copy">
            <button class="btn-base sm ysmhub-back" id="ysmhub-back">← ${esc(t("common.back"))}</button>
            <div class="ysmhub-detail-title">${esc(text(model.title || model.slug))}</div>
            <div class="ysmhub-detail-desc">${esc(descriptionText(model))}</div>
            <div class="ysmhub-card-meta"><span>${esc(t("hub.author", { name: text(model.owner_name || t("hub.unknown")) }))}</span><span>↓ ${Number(model.download_count || 0)}</span></div>
          </div>
        </div>
        <div class="ysmhub-detail-section"><div class="ysmhub-section-title">${esc(t("hub.versions"))}</div>${versionRows}</div>${tagsHTML}${linksHTML}
      </div>`;
    } catch (error) {
      showStatus(t("hub.detailFailed", { error: errorMessage(error) }));
    }
  };

  const download = async (model: YSMHubModel, versionID: string, button: HTMLButtonElement): Promise<void> => {
    const oldText = button.textContent || t("hub.download");
    button.disabled = true;
    button.textContent = t("hub.downloading");
    try {
      const app = await getApp();
      const saveDir = await app.GetRepoRoot("ysm");
      if (!saveDir) throw new Error(t("hub.repoNotConfigured"));
      const result = await downloadYSMHubModel(model.id, versionID, saveDir);
      bus.emit("toast:show", { msg: t("hub.downloaded", { path: result.path }), duration: 5000, type: "success" });
      bus.emit("tree:reload");
    } catch (error) {
      bus.emit("toast:show", { msg: t("hub.downloadFailed", { error: errorMessage(error) }), duration: 5000, type: "error" });
    } finally {
      button.disabled = false;
      button.textContent = oldText;
    }
  };

  listen(content, "click", (event) => {
    const target = event.target as Element | null;
    const card = target?.closest<HTMLElement>("[data-hub-slug]");
    if (card) {
      void openDetail(card.dataset.hubSlug || "");
      return;
    }
    const more = target?.closest<HTMLButtonElement>("[data-hub-more]");
    if (more) {
      void load(false);
      return;
    }
    const back = target?.closest<HTMLButtonElement>("#ysmhub-back");
    if (back) {
      void load(true);
      return;
    }
    const downloadButton = target?.closest<HTMLButtonElement>("[data-hub-download]");
    if (downloadButton && detailModel) {
      void download(detailModel, downloadButton.dataset.hubDownload || "", downloadButton);
    }
  }, host._unsubs);
  listen(searchBtn, "click", () => { void load(true); }, host._unsubs);
  listen(search, "keydown", (event) => { if ((event as KeyboardEvent).key === "Enter") void load(true); }, host._unsubs);
  listen(sort, "change", () => { void load(true); }, host._unsubs);
  listen(loginBtn, "click", async () => {
    loginBtn.setAttribute("disabled", "true");
    loginBtn.textContent = t("hub.authorizing");
    try {
      await loginYSMHub();
      bus.emit("toast:show", { msg: t("hub.loginSuccess"), duration: 3000, type: "success" });
      await load();
    } catch (error) {
      bus.emit("toast:show", { msg: t("hub.loginFailed", { error: errorMessage(error) }), duration: 5000, type: "error" });
    } finally {
      loginBtn.removeAttribute("disabled");
      loginBtn.textContent = t("hub.login");
    }
  }, host._unsubs);

  host._unsubs.push(() => { disposed = true; });
  void load();
}
