// 模块加载器 - 将独立 HTML 模板注入 DOM 插槽
// 加载顺序：loader.js 必须先于其他 JS 引入

const MODULE_MAP = [
  { id: "slot-topbar",    url: "./js/modules/topbar.html" },
  { id: "slot-sidebar",   url: "./js/modules/sidebar.html" },
  { id: "slot-main",      url: "./js/modules/main-panel.html" },
  { id: "slot-preview",   url: "./js/modules/preview.html" },
];

async function loadModules() {
  for (const mod of MODULE_MAP) {
    const slot = document.getElementById(mod.id);
    if (!slot) {
      console.warn("模块插槽不存在:", mod.id);
      continue;
    }
    try {
      const resp = await fetch(mod.url + "?v=" + Date.now());
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const html = await resp.text();
      // 用模板内容替换插槽（保留插槽作为容器，替换其 innerHTML）
      slot.innerHTML = html;
    } catch (e) {
      console.error("模块加载失败:", mod.url, e);
      slot.innerHTML = "<div style=\"color:#f38ba8;padding:12px;text-align:center;font-size:11px\">⚠️ 模块加载失败: " + mod.url + "</div>";
    }
  }
}

// DOM 就绪时加载模块
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", loadModules);
} else {
  loadModules();
}
