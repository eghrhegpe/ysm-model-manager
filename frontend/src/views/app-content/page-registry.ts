// ===== 页面路由注册表（抽出 _render 的 switch，ADR-040 延伸）=====
// 新增页面只需在此处添加一行，无需触碰 _render()。
// 每项定义：html（模板函数）+ init（页面初始化函数）。

import {
  repositoryHTML,
  instancesHTML,
  settingsHTML,
  diagnosticsHTML,
  workshopHTML,
  ysmHubHTML,
  githubHTML,
} from "./tpl.ts";
import {
  initRepositoryPage,
  initInstancesPage,
  initSettingsPage,
  initWorkshopPage,
  initYSMHubPage,
  initGithubPage,
  initDiagnosticsPage,
} from "./init-pages.ts";

export interface PageDefinition {
  html: () => string;
  // init 接收组件实例（调用方用 this as never 传入，与 init-pages.ts 接口对齐）。
  // 可 async（如 settings）；调用方负责 reject 转 toast（ADR-044 ①异步范式）。
  init: (host: never) => void | Promise<void>;
}

export const PAGE_REGISTRY: Record<string, PageDefinition> = {
  repository:   { html: repositoryHTML,  init: initRepositoryPage },
  instances:    { html: instancesHTML,   init: initInstancesPage },
  workshop:     { html: workshopHTML,    init: initWorkshopPage },
  ysmhub:       { html: ysmHubHTML,       init: initYSMHubPage },
  github:       { html: githubHTML,      init: initGithubPage },
  diagnostics:  { html: diagnosticsHTML, init: initDiagnosticsPage },
  oldest:       { html: diagnosticsHTML, init: initDiagnosticsPage }, // 复用诊断页
  settings:     { html: settingsHTML,    init: initSettingsPage },
};
