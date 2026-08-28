// ===== YSM Web 解码 Spike（ADR-049 Phase 0）=====
// 验证：base64 内嵌 YSMParser WASM 在无 Wails 壳的纯浏览器中解码 .ysm
// （decodeYsmFileFromMemory 内存解析路径，零 binding 依赖）。
import { initYSMParser, decodeYsmFileFromMemory } from "../wasm/ysm-parser.ts";
import { initI18n } from "../core/i18n/locale.ts";
import { t } from "../core/i18n/t.ts";
import { summarizeDecoded } from "../utils/format/summarize.ts";
import { safeErrorMessage } from "../utils/safe-error-msg.ts";

// 本页是独立入口（web.html），不经主 UI 的启动链——需自行加载语言包，
// 否则 t() 拿到空 bundle 会回落显示裸 key
const i18nReady = initI18n();

const dropZone = document.getElementById("drop") as HTMLElement;
const fileInput = document.getElementById("file") as HTMLInputElement;
const out = document.getElementById("out") as HTMLElement;

function append(html: string): void {
  out.insertAdjacentHTML("beforeend", html + "\n");
  out.scrollTop = out.scrollHeight;
}

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", async (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  const f = e.dataTransfer?.files?.[0];
  if (f) await handle(f);
});
fileInput.addEventListener("change", async () => {
  const f = fileInput.files?.[0];
  if (f) await handle(f);
  fileInput.value = "";
});

async function handle(file: File): Promise<void> {
  await i18nReady;
  out.innerHTML = "";
  append(`📄 ${file.name}（${(file.size / 1024 / 1024).toFixed(2)} MB）`);
  try {
    append(t("web.wasmInit"));
    const ok = await initYSMParser();
    if (!ok) {
      append(t("web.wasmInitFailed"));
      return;
    }
    append(t("web.wasmReady"));
    append(t("web.decoding"));
    const bytes = new Uint8Array(await file.arrayBuffer());
    const files = await decodeYsmFileFromMemory(bytes);
    if (!files || files.length === 0) {
      append(t("web.decodeNoOutput"));
      return;
    }
    const { bones, cubes, texCount } = summarizeDecoded(files);
    append(t("web.decodeSuccess", { n: files.length }));
    append(`<table><tr><th>${t("web.metric")}</th><th>${t("web.value")}</th></tr>
      <tr><td>${t("web.outputFileCount")}</td><td>${files.length}</td></tr>
      <tr><td>${t("web.metric.boneCount")}</td><td>${bones}</td></tr>
      <tr><td>${t("web.cubeCount")}</td><td>${cubes}</td></tr>
      <tr><td>${t("web.textureCount")}</td><td>${texCount}</td></tr></table>`);
    append("\n" + t("web.fileListTitle"));
    for (const f of files.slice(0, 40)) {
      append(`  • ${f.path}（${f.data.byteLength} B）`);
    }
    if (files.length > 40) append(`  … ${t("web.omitted", { n: files.length - 40 })}`);
  } catch (e) {
    append(`<span class="err">❌ ${safeErrorMessage(e)}</span>`);
  }
}
